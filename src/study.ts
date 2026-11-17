import { active, due, localDay, type Knowledge, type Practice, type Review } from "./domain";

export const RECALL_GAP_MS = 45_000;
export function advancePractice(previous: Practice | undefined, rating: 1 | 3, now: Date): Practice {
  const remaining = rating === 1 ? 2 : Math.max(0,
    (previous?.remaining || 1) - 1) as 0 | 1;
  return { day: localDay(now), remaining, ready_at: new Date(now.getTime() + (remaining ? RECALL_GAP_MS : 0)).toISOString() };
}
export function readyToStudy(k: Knowledge, review: Review | undefined, now = new Date()) {
  return due(k, review, now) && (!review || review.revision !== k.learning_revision ||
    !review.practice?.remaining || Date.parse(review.practice.ready_at) <= now.getTime());
}
/** Random within one repository and subject. Ready reinforcement cards take priority. */
export function pickNext(items: Knowledge[], reviews: Review[], subject: string, namespace: string,
  current?: string, now = new Date(), random = Math.random): Knowledge | undefined {
  const map = new Map(reviews.map(r => [r.key, r]));
  let candidates = items.filter(k => active(k) && k.subject === subject && k.namespace === namespace && readyToStudy(k, map.get(k.key), now));
  const others = candidates.filter(k => k.key !== current);
  if (others.length) candidates = others;
  const reinforcement = candidates.filter(k => map.get(k.key)?.revision === k.learning_revision && map.get(k.key)?.practice?.remaining);
  if (reinforcement.length) candidates = reinforcement;
  return candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, random()) * candidates.length))];
}
