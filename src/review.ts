import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";
import { database } from "./db";
import { MAX_REVIEW_DAYS, type Knowledge, type Review } from "./domain";
import { advancePractice } from "./study";
const scheduler = fsrs({ request_retention: 0.95, maximum_interval: MAX_REVIEW_DAYS, enable_fuzz: false });
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
  // FSRS may enforce an interval progression floor on mature imported cards.
  // Apply our exam-preparation horizon explicitly as well as via its parameter.
  next.card.due = new Date(Math.min(next.card.due.getTime(), now.getTime() + MAX_REVIEW_DAYS * 86400000));
  next.card.scheduled_days = Math.min(next.card.scheduled_days, MAX_REVIEW_DAYS);
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
  if (previous?.revision === k.learning_revision && previous.practice?.remaining &&
    Date.parse(previous.practice.ready_at) > now.getTime()) {
    await tx.done;
    return false;
  }
  const next = schedule(previous, k, rating, now);
  next.practice = advancePractice(previous?.revision === k.learning_revision ? previous.practice : undefined, rating, now);
  // Same-day reinforcement and long-term scheduling have distinct responsibilities.
  next.card.due = next.practice.remaining
    ? new Date(next.practice.ready_at)
    : new Date(Math.min(now.getTime() + MAX_REVIEW_DAYS * 86400000,
      Math.max(now.getTime() + 86400000, next.card.due.getTime())));
  next.card.scheduled_days = Math.floor((next.card.due.getTime() - now.getTime()) / 86400000);
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
