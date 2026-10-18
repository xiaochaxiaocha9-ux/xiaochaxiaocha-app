import type { Card } from "ts-fsrs";
export const subjects = [
  { id: "politics", name: "政治", short: "政", en: "POLITICS", color: "rose" },
  {
    id: "english",
    name: "英语二",
    short: "英",
    en: "ENGLISH II",
    color: "blue",
  },
  {
    id: "math",
    name: "数学二",
    short: "数",
    en: "MATHEMATICS II",
    color: "amber",
  },
  {
    id: "environment",
    name: "838 环境学",
    short: "环",
    en: "ENVIRONMENT",
    color: "green",
  },
] as const;
export type Subject = (typeof subjects)[number]["id"];
export interface Entry {
  schema_version: 1;
  subject: Subject;
  module_id: string;
  module_title: string;
  chapter: string;
  knowledge_id: string;
  title: string;
  reading_path: string;
  reading_hash: string;
  listening_path?: string;
  listening_hash?: string;
  audio_path?: string;
  audio_hash?: string;
  content_hash: string;
  learning_revision: number;
  status: "active" | "archived" | "deleted";
  order: number;
  source_note?: string;
}
export interface Manifest {
  schema_version: 1;
  revision: string;
  generated_at: string;
  items: Entry[];
}
export interface Knowledge extends Entry {
  key: string;
  namespace: string;
  reading: string;
}
export interface Review {
  key: string;
  card: Card;
  revision: number;
  updated_at: string;
}
export interface ReviewEvent {
  id: string;
  key: string;
  rating: 1 | 3;
  at: string;
  revision: number;
  card: Card;
}
export interface Position {
  key: string;
  seconds: number;
  updated_at: string;
}
export interface Config {
  owner: string;
  repo: string;
  branch: string;
  manifest_path: string;
  rememberToken: boolean;
  checkOnOpen: boolean;
}
export const defaultConfig: Config = {
  owner: "",
  repo: "",
  branch: "main",
  manifest_path: "manifest.json",
  rememberToken: false,
  checkOnOpen: false,
};
export const namespaceOf = (c: Config) =>
  `${c.owner.toLowerCase()}/${c.repo.toLowerCase()}/${c.manifest_path}`;
export const keyOf = (ns: string, e: Pick<Entry, "subject" | "knowledge_id">) =>
  `${ns}::${e.subject}::${e.knowledge_id}`;
export const active = (k: Knowledge) => k.status === "active";
export const safePath = (p: unknown): p is string =>
  typeof p === "string" &&
  p.length > 0 &&
  p.length < 500 &&
  !p.startsWith("/") &&
  !/[\\?#:%\u0000-\u001f]/.test(p) &&
  p.split("/").every((s) => s !== "." && s !== ".." && s !== "");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validateManifest(value: unknown): Manifest {
  const m = value as Manifest;
  if (
    !m ||
    m.schema_version !== 1 ||
    !hash(m.revision) ||
    !Array.isArray(m.items) ||
    m.items.length > 20000 ||
    !Number.isFinite(Date.parse(m.generated_at))
  )
    throw Error("资料索引格式不受支持");
  const ids = new Set<string>();
  for (const e of m.items) {
    if (
      !e ||
      e.schema_version !== 1 ||
      !subjects.some((s) => s.id === e.subject) ||
      !["module_id", "module_title", "chapter", "knowledge_id", "title"].every(
        (k) =>
          typeof e[k as keyof Entry] === "string" &&
          String(e[k as keyof Entry]).length > 0 &&
          String(e[k as keyof Entry]).length < 500,
      ) ||
      !safePath(e.reading_path) ||
      !hash(e.reading_hash) ||
      !hash(e.content_hash) ||
      !Number.isSafeInteger(e.learning_revision) ||
      e.learning_revision < 1 ||
      !Number.isFinite(e.order) ||
      !["active", "archived", "deleted"].includes(e.status)
    )
      throw Error("知识点格式无效");
    if (
      (e.audio_path && (!safePath(e.audio_path) || !hash(e.audio_hash))) ||
      (e.listening_path &&
        (!safePath(e.listening_path) || !hash(e.listening_hash)))
    )
      throw Error("附件格式无效");
    const id = e.subject + "::" + e.knowledge_id;
    if (ids.has(id)) throw Error("资料存在重复知识点 ID");
    ids.add(id);
  }
  return m;
}
export async function sha256(data: string | ArrayBuffer) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function due(k: Knowledge, r: Review | undefined, now = new Date()) {
  return (
    !r || r.revision !== k.learning_revision || new Date(r.card.due) <= now
  );
}
export function dueQueue(
  items: Knowledge[],
  reviews: Review[],
  now = new Date(),
) {
  const map = new Map(reviews.map((r) => [r.key, r]));
  return items
    .filter((k) => active(k) && due(k, map.get(k.key), now))
    .sort((a, b) => {
      const x = map.get(a.key),
        y = map.get(b.key);
      return (
        (x ? new Date(x.card.due).getTime() : Infinity) -
          (y ? new Date(y.card.due).getTime() : Infinity) || a.order - b.order
      );
    });
}
