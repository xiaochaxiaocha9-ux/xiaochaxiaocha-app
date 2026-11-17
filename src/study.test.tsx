import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyCard } from "ts-fsrs";
import { MaskedMarkdown } from "./MaskedMarkdown";
import { RecallActions } from "./RecallActions";
import { rate, schedule } from "./review";
import { advancePractice, pickNext, RECALL_GAP_MS } from "./study";
import { due, keyOf, localDay, reviewDue, type Knowledge, type Review } from "./domain";
import { database } from "./db";
import { exportBackup, restoreBackup } from "./backup";
const now = new Date("2026-11-18T08:00:00Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const card = (id: string, subject: Knowledge["subject"] = "politics", namespace = "demo"): Knowledge => ({
  schema_version: 1, subject, module_id: "POL-1", module_title: "模块", chapter: "章节",
  knowledge_id: id, title: id, reading_path: "assets/a.md", reading_hash: "a".repeat(64), content_hash: "b".repeat(64),
  learning_revision: 1, status: "active", order: 1, namespace, key: keyOf(namespace, { subject, knowledge_id: id }), reading: "定义：{{答案}}",
});
beforeEach(async () => { const db = await database(); for (const name of db.objectStoreNames) await db.clear(name); });
describe("same-day recall and FSRS", () => {
  it("requires two later correct confirmations after a miss, without inflating progress on reveal", async () => {
    const k = card("A"), db = await database();
    await rate(k, 1, "miss", now);
    let r = (await db.get("reviews", k.key))!;
    expect(r.practice?.remaining).toBe(2);
    expect(due(k, r, now)).toBe(true);
    expect(pickNext([k], [r], k.subject, k.namespace, k.key, later(44))).toBeUndefined();
    expect(await rate(k, 3, "too-early", later(44))).toBe(false);
    await rate(k, 3, "first", later(45));
    r = (await db.get("reviews", k.key))!;
    expect(r.practice?.remaining).toBe(1);
    expect(pickNext([k], [r], k.subject, k.namespace, k.key, later(89))).toBeUndefined();
    await rate(k, 3, "second", later(90));
    r = (await db.get("reviews", k.key))!;
    expect(r.practice?.remaining).toBe(0);
    expect(due(k, r, later(91))).toBe(false);
    expect(r.card.due.getTime()).toBeGreaterThanOrEqual(later(90).getTime() + 86400000);
    expect(await db.getAll("events")).toHaveLength(3);
  });
  it("a corrected mistake or another miss resets two confirmations", () => {
    const wrong = advancePractice(undefined, 1, now);
    const first = advancePractice(wrong, 3, later(45));
    expect(advancePractice(first, 1, later(90)).remaining).toBe(2);
  });
  it("unfinished cards survive midnight, completed cards return by their due date", () => {
    const k = card("A");
    const practice = advancePractice(undefined, 1, now);
    const r: Review = { ...schedule(undefined, k, 1, now), practice };
    expect(due(k, r, later(86400))).toBe(true);
    expect(advancePractice(practice, 3, later(86400)).remaining).toBe(1);
  });
  it("caps mature schedules at five days and makes old multiweek dates eligible without deleting evidence", () => {
    const k = card("A");
    const r: Review = { key: k.key, revision: 1, updated_at: now.toISOString(), card: { ...createEmptyCard(now), due: later(20 * 86400), last_review: now, state: 2, stability: 200, difficulty: 3, reps: 100 } };
    expect(reviewDue(r)).toEqual(later(5 * 86400));
    expect(due(k, r, later(5 * 86400))).toBe(true);
    expect(r.card.due).toEqual(later(20 * 86400));
    const next = schedule(r, k, 3, later(5 * 86400));
    expect(next.card.scheduled_days).toBeLessThanOrEqual(5);
  });
  it("randomizes within subject and repository, prefers ready misses, excludes completed and archived cards", () => {
    const a = card("A"), b = card("B"), c = card("C");
    const list = [a, b, c, card("ENV", "environment"), card("other", "politics", "private"), { ...card("archived"), status: "archived" as const }];
    expect(pickNext(list, [], "politics", "demo", a.key, now, () => 0)?.key).toBe(b.key);
    expect(pickNext(list, [], "politics", "demo", a.key, now, () => .99)?.key).toBe(c.key);
    const r = { ...schedule(undefined, b, 1, now), practice: advancePractice(undefined, 1, now) };
    expect(pickNext(list, [r], "politics", "demo", a.key, later(RECALL_GAP_MS / 1000), () => .99)?.key).toBe(b.key);
    expect(pickNext([b], [{ ...r, practice: { ...r.practice, day: localDay(now), remaining: 0 } }], "politics", "demo", undefined, now)).toBeUndefined();
  });
  it("backs up and restores pending reinforcement, and rejects malformed progress before writing", async () => {
    const k = card("A"), db = await database();
    await rate(k, 1, "pending", now);
    const backup = JSON.parse(JSON.stringify(await exportBackup()));
    await db.clear("reviews");
    await restoreBackup(backup);
    expect((await db.get("reviews", k.key))?.practice?.remaining).toBe(2);
    backup.reviews[0].practice.remaining = 99;
    await expect(restoreBackup(backup)).rejects.toThrow("复习记录");
    expect((await db.get("reviews", k.key))?.practice?.remaining).toBe(2);
  });
  it("substantive revisions start fresh and duplicate taps cannot count as two recalls", async () => {
    const k = card("A"), db = await database();
    await rate(k, 1, "wrong", now);
    await Promise.all([rate(k, 3, "same", later(45)), rate(k, 3, "same", later(45))]);
    expect((await db.get("reviews", k.key))?.practice?.remaining).toBe(1);
    await rate({ ...k, learning_revision: 2 }, 3, "revision", later(48));
    expect((await db.get("reviews", k.key))?.practice?.remaining).toBe(0);
    expect(await db.getAll("events")).toHaveLength(3);
  });
});
describe("opt-in recall rendering", () => {
  const render = (content: string, revealed = false) => renderToStaticMarkup(<MaskedMarkdown content={content} revealed={revealed} />);
  it("keeps the term visible while concealing only annotated answers; revealing removes masking", () => {
    const html = render("**A**：{{这是**规范定义**，以及 $x^2$。}}");
    expect(html).toContain("<strong>A</strong>");
    expect(html).toContain('class="recall-mask concealed"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="katex"');
    expect(html).toContain("style="); // preserve KaTeX layout attributes
    expect(render("A：{{定义}}", true)).not.toContain("concealed");
  });
  it("supports multiple spans, tables and lists without requiring a new content schema", () => {
    const html = render("- 定义：{{甲}}；条件：{{乙}}\n\n|名词|内容|\n|---|---|\n|A|{{丙}}|");
    expect(html.match(/recall-mask concealed/g)).toHaveLength(3);
    expect(html).toContain("<table>");
  });
  it("leaves unmarked content and invalid/nested/cross-paragraph markers visible", () => {
    for (const text of ["A：定义", "A：{{未闭合", "A：{{嵌套{{内容}}}}", "A：{{甲\n\n乙}}"])
      expect(render(text)).not.toContain("concealed");
  });
  it("does not treat code or LaTeX braces as mask instructions or render raw HTML", () => {
    const html = render("`{{代码}}`\n\n$x^{{2}}$\n\n<script>alert(1)</script>");
    expect(html).not.toContain("concealed");
    expect(html).not.toContain("<script>");
  });
  it.each([ ["hidden", ["不记得", "记得"]], ["remembered", ["记错了", "下一张"]], ["forgotten", ["下一张"]] ] as const)("%s has only the intended action buttons", (phase, labels) => {
    const html = renderToStaticMarkup(<RecallActions phase={phase} busy={false} remaining={0} cooldown={0} onRemember={() => {}} onForget={() => {}} onNext={() => {}} />);
    expect(html.match(/<button/g)).toHaveLength(labels.length);
    labels.forEach(label => expect(html).toContain(label));
  });
});
