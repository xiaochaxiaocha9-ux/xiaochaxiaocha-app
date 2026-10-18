import { beforeEach, describe, it, expect, vi } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { database, commitContent, snapshot, audioKey } from "./db";
import { schedule, rate } from "./review";
import {
  sha256,
  validateManifest,
  keyOf,
  dueQueue,
  type Knowledge,
  type Manifest,
  defaultConfig,
} from "./domain";
import { exportBackup, restoreBackup } from "./backup";
import { syncContent, cacheAudio } from "./github";
const now = new Date("2026-10-18T08:00:00Z");
const ns = "me/study/manifest.json";
const entry = async (id = "1.1.1"): Promise<Knowledge> => ({
  schema_version: 1,
  subject: "math",
  module_id: "1.1",
  module_title: "函数",
  chapter: "定义域",
  knowledge_id: id,
  title: "定义域",
  reading_path: "assets/a.md",
  reading_hash: await sha256("正文"),
  content_hash: "a".repeat(64),
  learning_revision: 1,
  status: "active",
  order: 1,
  namespace: ns,
  key: keyOf(ns, { subject: "math", knowledge_id: id }),
  reading: "正文",
});
const manifest = (k: Knowledge): Manifest => ({
  schema_version: 1,
  revision: "b".repeat(64),
  generated_at: now.toISOString(),
  items: [k],
});
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const db = await database();
  for (const name of db.objectStoreNames) await db.clear(name);
});
describe("FSRS and local persistence", () => {
  it("only maps Again/Good and Good schedules later than Again", async () => {
    const k = await entry(),
      a = schedule(undefined, k, 1, now),
      g = schedule(undefined, k, 3, now);
    expect(g.card.due.getTime()).toBeGreaterThan(a.card.due.getTime());
    expect(g.card.reps).toBe(1);
  });
  it("deduplicates operation IDs and concurrent rapid taps transactionally", async () => {
    const k = await entry();
    const results = await Promise.all([
      rate(k, 3, "same", now),
      rate(k, 3, "same", now),
      rate(k, 1, "different", now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await (await database()).getAll("events")).toHaveLength(1);
    expect((await snapshot()).reviews[0].card.reps).toBe(1);
  });
  it("retains persisted dates across JSON round trips", async () => {
    const k = await entry();
    await rate(k, 3, "op", now);
    const b = JSON.parse(JSON.stringify(await exportBackup()));
    await (await database()).clear("reviews");
    await restoreBackup(b);
    expect((await snapshot()).reviews[0].card.due).toBeInstanceOf(Date);
  });
  it("substantive revision starts new schedule without dropping old events", async () => {
    const k = await entry();
    await rate(k, 3, "old", now);
    const updated = { ...k, learning_revision: 2 };
    await rate(updated, 3, "new", new Date(now.getTime() + 3000));
    const db = await database();
    expect(await db.getAll("events")).toHaveLength(2);
    const r = await db.get("reviews", k.key);
    expect(r!.revision).toBe(2);
    expect(r!.card.reps).toBe(1);
  });
  it("sorts overdue items before unseen items", async () => {
    const k = await entry(),
      other = await entry("1.1.2"),
      r = schedule(undefined, k, 1, new Date(now.getTime() - 86400000));
    expect(dueQueue([other, k], [r], now).map((k) => k.key)).toEqual([
      k.key,
      other.key,
    ]);
  });
});
describe("incremental content and repository isolation", () => {
  it("preserves history when text changes and archives omitted items", async () => {
    const k = await entry();
    await commitContent(ns, [k]);
    await rate(k, 3, "op", now);
    await commitContent(ns, [{ ...k, reading: "新正文" }]);
    expect((await snapshot()).reviews).toHaveLength(1);
    await commitContent(ns, []);
    expect((await snapshot()).items[0].status).toBe("archived");
    expect((await snapshot()).reviews).toHaveLength(1);
  });
  it("scopes IDs by repository and subject", async () => {
    const k = await entry();
    expect(keyOf("other", k)).not.toBe(k.key);
    expect(keyOf(ns, { ...k, subject: "english" })).not.toBe(k.key);
  });
  it("rejects duplicate IDs and hostile attachment paths", async () => {
    const k = await entry();
    expect(() => validateManifest({ ...manifest(k), items: [k, k] })).toThrow(
      "重复",
    );
    for (const p of [
      "../secret",
      "https://evil.test/x",
      "/root",
      "a\\b",
      "%2e%2e/a",
    ])
      expect(() =>
        validateManifest(manifest({ ...k, reading_path: p })),
      ).toThrow();
  });
  it("stages all downloads before commit and leaves local data on failure", async () => {
    const k = await entry(),
      b = await entry("1.1.2");
    await commitContent(ns, [k]);
    const m = {
      ...manifest(k),
      items: [{ ...k, reading_hash: await sha256("changed") }, b],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/commits/")
          ? new Response(JSON.stringify({ sha: "c".repeat(40) }))
          : url.includes("manifest.json")
            ? new Response(JSON.stringify(m))
            : new Response("wrong bytes"),
      ),
    );
    await expect(
      syncContent({ ...defaultConfig, owner: "me", repo: "study" }, "secret"),
    ).rejects.toThrow("校验");
    expect((await snapshot()).items[0].reading).toBe("正文");
  });
  it("pins every request and skips unchanged bodies", async () => {
    const k = await entry();
    await commitContent(ns, [k]);
    const fetcher = vi.fn(async (url: string) =>
      url.includes("/commits/")
        ? new Response(JSON.stringify({ sha: "c".repeat(40) }))
        : new Response(JSON.stringify(manifest(k))),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await syncContent(
      { ...defaultConfig, owner: "me", repo: "study" },
      "secret",
    );
    expect(result).toMatchObject({ added: 0, updated: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain("ref=" + "c".repeat(40));
  });
  it.each([
    [401, "令牌"],
    [403, "权限"],
    [404, "不存在"],
  ])(
    "reports GitHub status %i without exposing token",
    async (status, message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status })),
      );
      await expect(
        syncContent(
          { ...defaultConfig, owner: "me", repo: "study" },
          "SUPERSECRET",
        ),
      ).rejects.toThrow(message);
    },
  );
  it("reads downloaded MP3 without network", async () => {
    const k = {
        ...(await entry()),
        audio_path: "assets/test.mp3",
        audio_hash: "e".repeat(64),
      },
      db = await database();
    await db.put("audio", { key: audioKey(k), blob: new Blob(["fake audio"]) });
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    expect((await cacheAudio(k, defaultConfig, "")).size).toBe(10);
    expect(network).not.toHaveBeenCalled();
  });
});
describe("backup", () => {
  it("never includes credentials and merges newer records", async () => {
    const k = await entry();
    await commitContent(ns, [k]);
    await rate(k, 1, "a", now);
    const b = await exportBackup();
    await (await database()).put("settings", "secret", "token");
    await rate(k, 3, "b", new Date(now.getTime() + 5000));
    await restoreBackup(JSON.parse(JSON.stringify(b)));
    expect((await snapshot()).reviews[0].updated_at).toBe(
      new Date(now.getTime() + 5000).toISOString(),
    );
    expect(JSON.stringify(await exportBackup())).not.toContain("secret");
    expect(await (await database()).getAll("events")).toHaveLength(2);
  });
  it("validates whole backup before writing", async () => {
    const k = await entry();
    const b = {
      schema_version: 1,
      kind: "suishenting-backup",
      exported_at: now.toISOString(),
      knowledge: [k],
      reviews: [
        {
          key: k.key,
          revision: 1,
          updated_at: now.toISOString(),
          card: { ...createEmptyCard(now), reps: -2 },
        },
      ],
      events: [],
      positions: [],
    };
    await expect(restoreBackup(b)).rejects.toThrow();
    expect((await snapshot()).items).toHaveLength(0);
  });
});
