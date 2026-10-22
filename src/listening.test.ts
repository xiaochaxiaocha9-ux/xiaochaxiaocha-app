import { beforeEach, describe, expect, it } from "vitest";
import { database } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { clearAudioCache } from "./github";
import {
  ListeningMeter,
  listeningSessions,
  listeningTotals,
  saveListening,
  type ListeningSession,
} from "./listening";
import { keyOf, type Knowledge } from "./domain";
const card = (id = "ENV-1-K01"): Knowledge => ({
  schema_version: 1,
  subject: "environment",
  module_id: "ENV-1",
  module_title: "环境学",
  chapter: "基础",
  knowledge_id: id,
  title: id,
  reading_path: "a.md",
  reading_hash: "a".repeat(64),
  content_hash: "b".repeat(64),
  learning_revision: 1,
  status: "active",
  order: 1,
  namespace: "private",
  reading: "正文",
  key: keyOf("private", { subject: "environment", knowledge_id: id }),
});
const session = (seconds = 10): ListeningSession => ({
  schema_version: 1,
  id: crypto.randomUUID(),
  key: card().key,
  namespace: "private",
  subject: "environment",
  knowledge_id: card().knowledge_id,
  title: "概念",
  seconds,
  updated_at: new Date().toISOString(),
});
beforeEach(async () => {
  const db = await database();
  for (const name of db.objectStoreNames) await db.clear(name);
});
describe("actual listening time", () => {
  it("counts real elapsed time at 2x and excludes pause and buffering", () => {
    let now = 0;
    const writes: ListeningSession[] = [],
      meter = new ListeningMeter(
        (s) => writes.push(s),
        () => now,
      );
    meter.begin(card(), 0, 2);
    now = 2000;
    meter.stop(4, 30, false, 2);
    expect(writes.at(-1)?.seconds).toBe(2);
    now = 12000;
    meter.sample(4, 30, false, 2);
    meter.begin(card(), 4, 2);
    now = 22000;
    meter.stop(4, 30, false, 2);
    expect(writes.at(-1)?.seconds).toBe(2);
    meter.begin(card(), 4, 2);
    now = 23000;
    meter.stop(6, 30, false, 2);
    expect(writes.at(-1)?.seconds).toBe(3);
    expect(new Set(writes.map((s) => s.id)).size).toBe(1);
  });
  it("ignores seeks and counts replay including loop boundaries", () => {
    let now = 0;
    const writes: ListeningSession[] = [],
      meter = new ListeningMeter(
        (s) => writes.push(s),
        () => now,
      );
    meter.begin(card(), 0, 1);
    now = 2000;
    meter.sample(2, 10, false, 1);
    now = 2500;
    meter.sample(9, 10, false, 1); // unobserved progress jump
    meter.anchor(9);
    now = 4500;
    meter.sample(1, 10, true, 1);
    meter.stop(1, 10, true, 1);
    expect(writes.at(-1)?.seconds).toBe(4);
  });
  it("attributes track changes separately and excludes other libraries", () => {
    let now = 0;
    const writes: ListeningSession[] = [],
      meter = new ListeningMeter(
        (s) => writes.push(s),
        () => now,
      );
    meter.begin(card(), 0, 1);
    now = 1000;
    meter.stop(1, 30, false, 1);
    meter.begin(card("ENV-2-K01"), 0, 1);
    now = 3000;
    meter.stop(2, 30, false, 1);
    const totals = listeningTotals(
      [...writes, { ...session(99), namespace: "demo" }],
      "private",
    );
    expect(totals.total).toBe(3);
    expect(totals.bySubject.get("environment")).toBe(3);
    expect(totals.byCard.get(card().key)).toBe(1);
    expect(totals.byCard.get(card("ENV-2-K01").key)).toBe(2);
  });
});
describe("persistent listening and compatible backups", () => {
  it("keeps maximum cumulative duration per session instead of double counting writes", async () => {
    const s = session(10);
    await Promise.all([
      saveListening(s),
      saveListening({ ...s, seconds: 5 }),
      saveListening({ ...s, seconds: 15 }),
    ]);
    expect(listeningTotals(await listeningSessions(), "private").total).toBe(
      15,
    );
    await clearAudioCache();
    expect(listeningTotals(await listeningSessions(), "private").total).toBe(
      15,
    );
  });
  it("restores statistics idempotently and accepts old backups without statistics", async () => {
    const s = session(8);
    await saveListening(s);
    await (await database()).put("settings", "secret-token", "token");
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    expect(backup.listening).toHaveLength(1);
    expect(JSON.stringify(backup)).not.toContain("secret-token");
    await saveListening({ ...s, seconds: 12 });
    await restoreBackup(backup);
    await restoreBackup(backup);
    expect(listeningTotals(await listeningSessions(), "private").total).toBe(
      12,
    );
    const old = { ...backup };
    delete old.listening;
    await restoreBackup(old);
    expect(listeningTotals(await listeningSessions(), "private").total).toBe(
      12,
    );
    await (await database()).delete("settings", "listening:v1:" + s.id);
    await restoreBackup(backup);
    expect(listeningTotals(await listeningSessions(), "private").total).toBe(8);
  });
  it("rejects invalid listening data before merging anything", async () => {
    const backup = await exportBackup();
    await expect(
      restoreBackup({ ...backup, listening: [{ ...session(), seconds: -1 }] }),
    ).rejects.toThrow("收听时长");
    expect(await listeningSessions()).toHaveLength(0);
  });
});
