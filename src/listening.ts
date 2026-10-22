import { subjects, type Knowledge, type Subject } from "./domain";
import { database } from "./db";

export interface ListeningSession {
  schema_version: 1;
  id: string;
  key: string;
  namespace: string;
  subject: Subject;
  knowledge_id: string;
  title: string;
  seconds: number;
  updated_at: string;
}
const prefix = "listening:v1:";
export function validListening(s: ListeningSession) {
  return (
    !!s &&
    s.schema_version === 1 &&
    typeof s.id === "string" &&
    /^[a-f0-9-]{36}$/.test(s.id) &&
    typeof s.namespace === "string" &&
    !!s.namespace &&
    subjects.some((subject) => subject.id === s.subject) &&
    typeof s.knowledge_id === "string" &&
    !!s.knowledge_id &&
    s.key === `${s.namespace}::${s.subject}::${s.knowledge_id}` &&
    typeof s.title === "string" &&
    s.title.length > 0 &&
    s.title.length < 500 &&
    Number.isFinite(s.seconds) &&
    s.seconds >= 0 &&
    typeof s.updated_at === "string" &&
    Number.isFinite(Date.parse(s.updated_at))
  );
}
export function listeningKey(s: ListeningSession) {
  return prefix + s.id;
}
export async function saveListening(s: ListeningSession) {
  if (!validListening(s)) throw Error("收听时长记录无效");
  const db = await database(),
    tx = db.transaction("settings", "readwrite");
  const previous = (await tx.store.get(listeningKey(s))) as
    ListeningSession | undefined;
  if (previous && previous.key !== s.key) {
    tx.abort();
    await tx.done.catch(() => {});
    throw Error("收听记录编号冲突");
  }
  if (!previous || s.seconds > previous.seconds)
    await tx.store.put(s, listeningKey(s));
  await tx.done;
}
export async function listeningSessions() {
  const db = await database();
  const keys = (await db.getAllKeys("settings")).filter((key) =>
    key.startsWith(prefix),
  );
  const result = await Promise.all(keys.map((key) => db.get("settings", key)));
  return result.filter((s): s is ListeningSession =>
    validListening(s as ListeningSession),
  );
}
export function listeningTotals(
  sessions: ListeningSession[],
  namespace: string,
) {
  let total = 0;
  const bySubject = new Map<string, number>(),
    byCard = new Map<string, number>();
  for (const s of sessions)
    if (s.namespace === namespace) {
      total += s.seconds;
      bySubject.set(s.subject, (bySubject.get(s.subject) || 0) + s.seconds);
      byCard.set(s.key, (byCard.get(s.key) || 0) + s.seconds);
    }
  return { total, bySubject, byCard };
}
export function listeningTime(seconds: number) {
  const s = Math.floor(seconds),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}小时` : ""}${m || h ? `${m}分` : ""}${s % 60}秒`;
}

/** Count elapsed listening time, capped by actual media advancement / playback rate. */
export class ListeningMeter {
  private session?: ListeningSession;
  private running = false;
  private position = 0;
  private at = 0;
  private rate = 1;
  private emitted = 0;
  constructor(
    private emit: (s: ListeningSession) => void,
    private now = () => performance.now(),
  ) {}
  begin(k: Knowledge, position: number, rate: number) {
    if (this.session?.key !== k.key) {
      this.flush();
      this.session = {
        schema_version: 1,
        id: crypto.randomUUID(),
        key: k.key,
        namespace: k.namespace,
        subject: k.subject,
        knowledge_id: k.knowledge_id,
        title: k.title,
        seconds: 0,
        updated_at: new Date().toISOString(),
      };
      this.emitted = 0;
    }
    this.running = true;
    this.anchor(position, rate);
  }
  anchor(position: number, rate = this.rate) {
    this.position = position;
    this.rate = rate > 0 ? rate : 1;
    this.at = this.now();
  }
  sample(position: number, duration: number, loop: boolean, rate: number) {
    const elapsed = Math.max(0, (this.now() - this.at) / 1000);
    let advancement = position - this.position;
    if (loop && advancement < 0 && Number.isFinite(duration))
      advancement += duration;
    if (
      this.running &&
      this.session &&
      Number.isFinite(advancement) &&
      advancement > 0 &&
      advancement <= elapsed * this.rate + 0.75
    ) {
      this.session.seconds += Math.min(elapsed, advancement / this.rate);
      if (this.session.seconds - this.emitted >= 5) this.flush();
    }
    this.anchor(position, rate);
  }
  stop(position: number, duration: number, loop: boolean, rate: number) {
    this.sample(position, duration, loop, rate);
    this.running = false;
    this.flush();
  }
  flush() {
    if (!this.session || this.session.seconds <= this.emitted) return;
    this.session.updated_at = new Date().toISOString();
    this.emit({ ...this.session });
    this.emitted = this.session.seconds;
  }
  finish() {
    this.running = false;
    this.flush();
    this.session = undefined;
  }
}
