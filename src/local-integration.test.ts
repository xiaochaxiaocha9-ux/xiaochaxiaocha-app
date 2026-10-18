import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { syncContent } from "./github";
import { database, snapshot } from "./db";
import { rate } from "./review";
import { defaultConfig } from "./domain";
// Optional real derived fixtures live only in ignored .local; CI uses synthetic unit fixtures.
it.skipIf(!process.env.STUDY_CONTENT_FIXTURE)(
  "publishes real derived fixtures through pinned GitHub transport and preserves review on update",
  async () => {
    const root = resolve(process.env.STUDY_CONTENT_FIXTURE!),
      manifest = JSON.parse(
        readFileSync(resolve(root, "manifest.json"), "utf8"),
      );
    const db = await database();
    for (const name of db.objectStoreNames) await db.clear(name);
    const request = vi.fn(async (url: string) => {
      if (url.includes("/commits/"))
        return new Response(JSON.stringify({ sha: "c".repeat(40) }));
      const path = decodeURIComponent(url.split("/contents/")[1].split("?")[0]);
      return new Response(
        path === "manifest.json"
          ? JSON.stringify(manifest)
          : readFileSync(resolve(root, path)),
      );
    });
    vi.stubGlobal("fetch", request);
    try {
      const c = { ...defaultConfig, owner: "fixture", repo: "private" };
      const first = await syncContent(c, "FAKE-TOKEN");
      expect(first.added).toBe(3);
      const item = (await snapshot()).items[0];
      await rate(item, 3, "fixture-review", new Date("2026-10-18T10:00:00Z"));
      manifest.items = manifest.items.map((e: { content_hash: string }) => ({
        ...e,
        content_hash: "d".repeat(64),
      }));
      await syncContent(c, "FAKE-TOKEN");
      expect((await snapshot()).reviews).toHaveLength(1);
      expect(await db.getAll("events")).toHaveLength(1);
      expect(
        (await snapshot()).items.every((i) => i.namespace !== "demo"),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
