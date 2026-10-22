import { database } from "./db";
import {
  validateManifest,
  type Knowledge,
  type Review,
  type ReviewEvent,
  type Position,
} from "./domain";
import { reviveCard } from "./review";
import {
  listeningSessions,
  listeningKey,
  validListening,
  type ListeningSession,
} from "./listening";
interface Backup {
  schema_version: 1;
  kind: "suishenting-backup";
  exported_at: string;
  knowledge: Knowledge[];
  reviews: Review[];
  events: ReviewEvent[];
  positions: Position[];
  listening?: ListeningSession[];
}
function validCard(c: Review["card"]) {
  return (
    c &&
    Number.isFinite(new Date(c.due).getTime()) &&
    (!c.last_review || Number.isFinite(new Date(c.last_review).getTime())) &&
    [
      "stability",
      "difficulty",
      "elapsed_days",
      "scheduled_days",
      "reps",
      "lapses",
      "learning_steps",
    ].every(
      (k) =>
        typeof c[k as keyof typeof c] === "number" &&
        Number.isFinite(c[k as keyof typeof c]) &&
        Number(c[k as keyof typeof c]) >= 0,
    ) &&
    [0, 1, 2, 3].includes(c.state)
  );
}
export async function exportBackup() {
  const db = await database();
  return {
    schema_version: 1,
    kind: "suishenting-backup",
    exported_at: new Date().toISOString(),
    knowledge: await db.getAll("knowledge"),
    reviews: await db.getAll("reviews"),
    events: await db.getAll("events"),
    positions: await db.getAll("positions"),
    listening: await listeningSessions(),
  } satisfies Backup;
}
export async function restoreBackup(input: unknown) {
  const b = input as Backup;
  if (
    !b ||
    b.schema_version !== 1 ||
    b.kind !== "suishenting-backup" ||
    !["knowledge", "reviews", "events", "positions"].every(
      (k) =>
        Array.isArray(b[k as keyof Backup]) &&
        (b[k as "knowledge"] as unknown[]).length <= 100000,
    )
  )
    throw Error("备份格式不受支持");
  for (const k of b.knowledge) {
    validateManifest({
      schema_version: 1,
      revision: "0".repeat(64),
      generated_at: b.exported_at,
      items: [k],
    });
    if (
      typeof k.namespace !== "string" ||
      k.key !== `${k.namespace}::${k.subject}::${k.knowledge_id}` ||
      typeof k.reading !== "string"
    )
      throw Error("备份资料无效");
  }
  const time = (s: string) =>
    typeof s === "string" && Number.isFinite(Date.parse(s));
  for (const r of b.reviews)
    if (
      typeof r.key !== "string" ||
      !validCard(r.card) ||
      !time(r.updated_at) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1
    )
      throw Error("备份复习记录无效");
  for (const e of b.events)
    if (
      typeof e.id !== "string" ||
      typeof e.key !== "string" ||
      ![1, 3].includes(e.rating) ||
      !time(e.at) ||
      !validCard(e.card) ||
      !Number.isSafeInteger(e.revision) ||
      e.revision < 1
    )
      throw Error("备份日志无效");
  for (const p of b.positions)
    if (
      typeof p.key !== "string" ||
      !Number.isFinite(p.seconds) ||
      p.seconds < 0 ||
      !time(p.updated_at)
    )
      throw Error("备份播放进度无效");
  const listening = b.listening === undefined ? [] : b.listening;
  if (
    !Array.isArray(listening) ||
    listening.length > 100000 ||
    listening.some((s) => !validListening(s))
  )
    throw Error("备份收听时长无效");
  const db = await database(),
    tx = db.transaction(
      ["knowledge", "reviews", "events", "positions", "settings"],
      "readwrite",
    );
  for (const k of b.knowledge)
    if (!(await tx.objectStore("knowledge").get(k.key)))
      await tx.objectStore("knowledge").put(k);
  for (const r of b.reviews) {
    const prev = await tx.objectStore("reviews").get(r.key);
    if (!prev || Date.parse(r.updated_at) > Date.parse(prev.updated_at))
      await tx.objectStore("reviews").put({ ...r, card: reviveCard(r.card) });
  }
  for (const e of b.events)
    if (!(await tx.objectStore("events").get(e.id)))
      await tx.objectStore("events").put({ ...e, card: reviveCard(e.card) });
  for (const p of b.positions) {
    const prev = await tx.objectStore("positions").get(p.key);
    if (!prev || Date.parse(p.updated_at) > Date.parse(prev.updated_at))
      await tx.objectStore("positions").put(p);
  }
  for (const session of listening) {
    const previous = (await tx
      .objectStore("settings")
      .get(listeningKey(session))) as ListeningSession | undefined;
    if (previous && previous.key !== session.key) {
      tx.abort();
      await tx.done.catch(() => {});
      throw Error("备份收听记录编号冲突");
    }
    if (!previous || session.seconds > previous.seconds)
      await tx.objectStore("settings").put(session, listeningKey(session));
  }
  await tx.done;
}
