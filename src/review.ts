import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";
import { database } from "./db";
import type { Knowledge, Review } from "./domain";
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });
export const reviveCard = (c: Card): Card => ({
  ...c,
  due: new Date(c.due),
  last_review: c.last_review ? new Date(c.last_review) : undefined,
});
export function schedule(
  previous: Review | undefined,
  k: Knowledge,
  rating: 1 | 3,
  now = new Date(),
): Review {
  const card =
    previous?.revision === k.learning_revision
      ? reviveCard(previous.card)
      : createEmptyCard(now);
  const next = scheduler.next(
    card,
    now,
    rating === 1 ? Rating.Again : Rating.Good,
  );
  return {
    key: k.key,
    card: next.card,
    revision: k.learning_revision,
    updated_at: now.toISOString(),
  };
}
export async function rate(
  k: Knowledge,
  rating: 1 | 3,
  operationId: string,
  now = new Date(),
) {
  const db = await database(),
    tx = db.transaction(["reviews", "events"], "readwrite");
  if (await tx.objectStore("events").get(operationId)) {
    await tx.done;
    return false;
  }
  const previous = await tx.objectStore("reviews").get(k.key);
  if (previous && now.getTime() - Date.parse(previous.updated_at) < 2500) {
    await tx.done;
    return false;
  }
  const next = schedule(previous, k, rating, now);
  await tx.objectStore("reviews").put(next);
  await tx
    .objectStore("events")
    .put({
      id: operationId,
      key: k.key,
      rating,
      at: now.toISOString(),
      revision: k.learning_revision,
      card: next.card,
    });
  await tx.done;
  return true;
}
