import { openDB, type DBSchema } from "idb";
import type { Knowledge, Review, ReviewEvent, Position } from "./domain";
interface Schema extends DBSchema {
  knowledge: { key: string; value: Knowledge };
  reviews: { key: string; value: Review };
  events: { key: string; value: ReviewEvent };
  audio: { key: string; value: { key: string; blob: Blob } };
  positions: { key: string; value: Position };
  settings: { key: string; value: unknown };
}
export const database = () =>
  openDB<Schema>("suishenting-v1", 1, {
    upgrade(db) {
      for (const s of [
        "knowledge",
        "reviews",
        "events",
        "audio",
        "positions",
      ] as const)
        db.createObjectStore(s, { keyPath: s === "events" ? "id" : "key" });
      db.createObjectStore("settings");
    },
  });
export async function setting<T>(key: string, fallback: T): Promise<T> {
  const db = await database();
  return ((await db.get("settings", key)) as T | undefined) ?? fallback;
}
export async function putSetting(key: string, value: unknown) {
  const db = await database();
  await db.put("settings", value, key);
}
export async function snapshot() {
  const db = await database();
  return {
    items: await db.getAll("knowledge"),
    reviews: await db.getAll("reviews"),
    positions: await db.getAll("positions"),
  };
}
export async function commitContent(namespace: string, items: Knowledge[]) {
  const db = await database(),
    tx = db.transaction("knowledge", "readwrite"),
    incoming = new Set(items.map((i) => i.key));
  for (const old of await tx.store.getAll())
    if (old.namespace === namespace && !incoming.has(old.key))
      await tx.store.put({ ...old, status: "archived" });
  for (const item of items) await tx.store.put(item);
  await tx.done;
}
export const audioKey = (k: Knowledge) =>
  `${k.namespace}::${k.audio_path}::${k.audio_hash}`;
