import { describe, expect, it, vi } from "vitest";
import { PlaybackController, subjectPlaylist } from "./playback";
import { keyOf, type Knowledge } from "./domain";

const card = (id: string, overrides: Partial<Knowledge> = {}): Knowledge => {
  const k = {
    schema_version: 1 as const,
    subject: "politics" as const,
    module_id: "POL-1.1",
    module_title: "模块",
    chapter: "章节",
    knowledge_id: id,
    title: id,
    reading_path: "a.md",
    reading_hash: "a".repeat(64),
    content_hash: "b".repeat(64),
    learning_revision: 1,
    status: "active" as const,
    order: 1,
    namespace: "private",
    reading: id,
    audio_path: id + ".mp3",
    ...overrides,
  };
  return { ...k, key: keyOf(k.namespace, k) };
};
class FakeAudio {
  src = "";
  currentTime = 0;
  duration = 30;
  paused = true;
  loop = false;
  playbackRate = 1;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {
    this.onloadedmetadata?.();
    this.paused = false;
    this.onplay?.();
  });
  pause() {
    const wasPlaying = !this.paused;
    this.paused = true;
    if (wasPlaying) this.onpause?.();
  }
  load() {
    this.currentTime = 0;
  }
  removeAttribute() {
    this.src = "";
  }
  finish() {
    this.paused = true;
    this.currentTime = 30;
    this.onended?.();
  }
}
function setup() {
  const audio = new FakeAudio();
  const deps = {
    loadAudio: vi.fn(async (_k: Knowledge) => new Blob(["MP3"])),
    cachedAudio: vi.fn(
      async (_k: Knowledge): Promise<Blob | undefined> => undefined,
    ),
    readPosition: vi.fn(
      async (_k: Knowledge): Promise<number | undefined> => 12,
    ),
    writePosition: vi.fn(async (_k: Knowledge, _seconds: number) => {}),
    changed: vi.fn(),
    trackChanged: vi.fn(),
    cached: vi.fn(),
    report: vi.fn(),
  };
  const player = new PlaybackController(
    audio as unknown as HTMLAudioElement,
    deps,
  );
  return { player, audio, deps };
}
describe("inline audio playback", () => {
  it("builds an ordered subject-only playlist across chapters and modules", () => {
    const first = card("POL-1.1-K01"),
      second = card("POL-1.1-K02", { order: 2, chapter: "第二章" });
    const later = card("POL-1.10-K01", { module_id: "POL-1.10" });
    const earlier = card("POL-1.2-K01", { module_id: "POL-1.2" });
    expect(
      subjectPlaylist(
        [
          later,
          second,
          card("ENV-1", { subject: "environment" }),
          card("readonly", { audio_path: undefined }),
          card("hidden", { status: "archived" }),
          card("otherrepo", { namespace: "other" }),
          earlier,
          first,
        ],
        first,
      ).map((k) => k.knowledge_id),
    ).toEqual([
      first.knowledge_id,
      second.knowledge_id,
      earlier.knowledge_id,
      later.knowledge_id,
    ]);
  });
  it("once stops at the end, resets progress, and keeps the same text", async () => {
    const { player, audio, deps } = setup(),
      first = card("A"),
      next = card("B", { order: 2 });
    await player.start(first, [first, next]);
    expect(audio.currentTime).toBe(12);
    audio.finish();
    expect(player.state).toMatchObject({
      current: first,
      playing: false,
      time: 0,
    });
    expect(deps.loadAudio).toHaveBeenCalledTimes(1);
    expect(deps.trackChanged).toHaveBeenLastCalledWith(first);
    expect(deps.writePosition).toHaveBeenLastCalledWith(first, 0);
    player.dispose();
  });
  it("loops the native audio without another download and allows manual next", async () => {
    const { player, audio, deps } = setup(),
      first = card("A"),
      next = card("B", { order: 2 });
    player.setMode("repeat");
    await player.start(first, [first, next]);
    expect(audio.loop).toBe(true);
    audio.finish();
    expect(audio.currentTime).toBe(0);
    expect(player.state.playing).toBe(true);
    expect(deps.loadAudio).toHaveBeenCalledTimes(1);
    player.skip(1);
    await vi.waitFor(() => expect(player.state.loading).toBe(false));
    expect(player.state.current?.key).toBe(next.key);
    expect(audio.loop).toBe(true);
    player.dispose();
  });
  it("auto next changes the text, starts at zero, and stops at the subject boundary", async () => {
    const { player, audio, deps } = setup(),
      first = card("A"),
      next = card("B", { order: 2, chapter: "第二章" });
    player.setMode("next");
    await player.start(first, [
      card("ENV-1", { subject: "environment" }),
      first,
      next,
    ]);
    audio.finish();
    await vi.waitFor(() => expect(player.state.loading).toBe(false));
    expect(player.state.current?.key).toBe(next.key);
    expect(deps.trackChanged).toHaveBeenLastCalledWith(next);
    expect(audio.currentTime).toBe(0);
    expect(deps.readPosition).toHaveBeenCalledTimes(2);
    audio.finish();
    player.skip(1);
    expect(deps.loadAudio).toHaveBeenCalledTimes(2);
    expect(player.state).toMatchObject({ playing: false, hasNext: false });
    player.skip(-1);
    await vi.waitFor(() => expect(player.state.loading).toBe(false));
    expect(player.state.current?.key).toBe(first.key);
    player.skip(-1);
    expect(deps.loadAudio).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("applies mode changes during playback immediately", async () => {
    const { player, audio, deps } = setup(),
      first = card("A"),
      next = card("B", { order: 2 });
    await player.start(first, [first, next]);
    player.setMode("repeat");
    expect(audio.loop).toBe(true);
    player.setMode("once");
    expect(audio.loop).toBe(false);
    audio.finish();
    expect(deps.loadAudio).toHaveBeenCalledTimes(1);
    player.dispose();
  });
  it("ignores a stale download after a rapid manual skip", async () => {
    const { player, audio, deps } = setup(),
      first = card("A"),
      next = card("B", { order: 2 });
    let release!: (blob: Blob) => void;
    deps.loadAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = player.start(first, [first, next]);
    player.skip(1);
    await vi.waitFor(() => expect(player.state.loading).toBe(false));
    const currentSrc = audio.src;
    release(new Blob(["old MP3"]));
    await old;
    expect(player.state.current?.key).toBe(next.key);
    expect(audio.src).toBe(currentSrc);
    expect(audio.play).toHaveBeenCalledTimes(1);
    player.dispose();
  });
  it("ignores a stale saved-position lookup after a rapid skip", async () => {
    const { player, audio, deps } = setup(),
      first = card("A"),
      next = card("B", { order: 2 });
    let release!: (seconds: number) => void;
    deps.readPosition.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = player.start(first, [first, next]);
    await vi.waitFor(() => expect(deps.readPosition).toHaveBeenCalledTimes(1));
    player.skip(1);
    await vi.waitFor(() => expect(player.state.loading).toBe(false));
    release(20);
    await old;
    expect(player.state.current?.key).toBe(next.key);
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(deps.writePosition).not.toHaveBeenCalled();
    player.dispose();
  });
  it("keeps the failed card selected and can retry its download", async () => {
    const { player, deps } = setup(),
      first = card("A");
    deps.loadAudio.mockRejectedValueOnce(Error("离线"));
    await player.start(first, [first]);
    expect(player.state).toMatchObject({
      current: first,
      loading: false,
      playing: false,
    });
    expect(deps.report).toHaveBeenCalledWith("离线");
    player.toggle();
    await vi.waitFor(() => expect(player.state.playing).toBe(true));
    expect(deps.loadAudio).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("plays prepared local audio in the click stack without another async read", async () => {
    const { player, audio, deps } = setup(),
      first = card("A");
    deps.cachedAudio.mockResolvedValue(
      new Blob(["cached"], { type: "application/octet-stream" }),
    );
    await player.prepareCached([first]);
    const started = player.start(first, [first]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(deps.loadAudio).not.toHaveBeenCalled();
    await started;
    player.dispose();
  });
  it("prepares next ahead of ended and swaps sources without clearing the media element", async () => {
    const { player, audio, deps } = setup(),
      first = card("A"),
      next = card("B", { order: 2 });
    const clearSource = vi.spyOn(audio, "removeAttribute");
    player.setMode("next");
    await player.start(first, [first, next]);
    await vi.waitFor(() => expect(deps.readPosition).toHaveBeenCalledTimes(2));
    // Wait for the position promise to populate the prepared source.
    await player.prepareCached([next]);
    audio.finish();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(deps.trackChanged).toHaveBeenLastCalledWith(next);
    expect(clearSource).not.toHaveBeenCalled();
    expect(deps.loadAudio).toHaveBeenCalledTimes(2);
    player.dispose();
  });
  it("distinguishes autoplay permission denial and resumes with a manual tap", async () => {
    const { player, audio, deps } = setup(),
      first = card("A");
    audio.play.mockRejectedValueOnce(
      new DOMException("Blocked", "NotAllowedError"),
    );
    await player.start(first, [first]);
    expect(deps.report).toHaveBeenCalledWith(
      expect.stringContaining("系统阻止自动播放"),
    );
    player.toggle();
    await vi.waitFor(() => expect(player.state.playing).toBe(true));
    expect(deps.loadAudio).toHaveBeenCalledTimes(1);
    player.dispose();
  });
  it("clearing audio cancels late preparation and requires a new load", async () => {
    const { player, audio, deps } = setup(),
      first = card("A");
    let release!: (blob: Blob) => void;
    deps.loadAudio.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = player.start(first, [first]);
    player.clearAudio();
    release(new Blob(["old"]));
    await old;
    expect(audio.src).toBe("");
    expect(player.state.current).toBeUndefined();
    expect(audio.play).not.toHaveBeenCalled();
    await player.start(first, [first]);
    expect(deps.loadAudio).toHaveBeenCalledTimes(2);
    player.dispose();
  });
});
