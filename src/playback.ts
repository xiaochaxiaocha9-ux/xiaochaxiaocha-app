import { active, type Knowledge } from "./domain";

export type PlaybackMode = "once" | "repeat" | "next";
export const playbackModes: PlaybackMode[] = ["once", "repeat", "next"];
export const playbackLabels: Record<PlaybackMode, string> = {
  once: "仅播放一次",
  repeat: "循环本卡片",
  next: "自动下一节",
};
export function subjectPlaylist(items: Knowledge[], current: Knowledge) {
  return items
    .filter(
      (k) =>
        active(k) &&
        k.audio_path &&
        k.namespace === current.namespace &&
        k.subject === current.subject,
    )
    .sort(
      (a, b) =>
        a.module_id.localeCompare(b.module_id, "zh-CN", { numeric: true }) ||
        a.order - b.order ||
        a.knowledge_id.localeCompare(b.knowledge_id, "zh-CN", {
          numeric: true,
        }),
    );
}
export interface PlaybackState {
  current?: Knowledge;
  playing: boolean;
  time: number;
  duration: number;
  speed: number;
  loading: boolean;
  mode: PlaybackMode;
  hasPrevious: boolean;
  hasNext: boolean;
}
export const initialPlayback: PlaybackState = {
  playing: false,
  time: 0,
  duration: 0,
  speed: 1,
  loading: false,
  mode: "once",
  hasPrevious: false,
  hasNext: false,
};
interface Dependencies {
  loadAudio(k: Knowledge): Promise<Blob>;
  readPosition(k: Knowledge): Promise<number | undefined>;
  writePosition(k: Knowledge, seconds: number): Promise<unknown>;
  changed(state: PlaybackState): void;
  trackChanged(k: Knowledge): void;
  cached(): void;
  report(message: string): void;
}

/** Audio transitions live outside React so ended events and rapid skips can be tested. */
export class PlaybackController {
  state = { ...initialPlayback };
  private queue: Knowledge[] = [];
  private generation = 0;
  private objectUrl = "";
  private lastSaved = 0;
  private disposed = false;
  constructor(
    readonly audio: HTMLAudioElement,
    private deps: Dependencies,
  ) {
    audio.onplay = () => this.update({ playing: true });
    audio.onpause = () => {
      this.update({ playing: false });
      void this.save();
    };
    audio.ontimeupdate = () => {
      this.update({ time: audio.currentTime });
      if (Date.now() - this.lastSaved > 4000) {
        this.lastSaved = Date.now();
        void this.save();
      }
    };
    audio.onended = () => this.ended();
    audio.onerror = () => {
      this.update({ playing: false, loading: false });
      this.deps.report("音频解码或播放失败，请重新下载并尝试");
    };
  }
  private update(patch: Partial<PlaybackState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.deps.changed(this.state);
  }
  async save() {
    const k = this.state.current;
    if (k && this.audio.src && Number.isFinite(this.audio.currentTime)) {
      try {
        await this.deps.writePosition(k, this.audio.currentTime);
      } catch {
        /* retry at next checkpoint */
      }
    }
  }
  setMode(mode: PlaybackMode) {
    this.audio.loop = mode === "repeat";
    this.update({ mode });
  }
  changeSpeed(speed: number) {
    this.audio.playbackRate = speed;
    this.update({ speed });
  }
  async start(k: Knowledge, list = this.queue, resume = true) {
    if (this.disposed || !k.audio_path || !active(k)) return;
    const generation = ++this.generation;
    void this.save();
    this.audio.pause();
    this.audio.onloadedmetadata = null;
    this.audio.removeAttribute("src");
    this.audio.load();
    this.queue = subjectPlaylist(
      list.some((x) => x.key === k.key) ? list : [...list, k],
      k,
    );
    const index = this.queue.findIndex((x) => x.key === k.key);
    this.update({
      current: k,
      playing: false,
      loading: true,
      time: 0,
      duration: 0,
      hasPrevious: index > 0,
      hasNext: index >= 0 && index < this.queue.length - 1,
    });
    this.deps.trackChanged(k);
    try {
      const blob = await this.deps.loadAudio(k);
      if (generation !== this.generation || this.disposed) return;
      const position = resume ? await this.deps.readPosition(k) : undefined;
      if (generation !== this.generation || this.disposed) return;
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = URL.createObjectURL(blob);
      this.audio.src = this.objectUrl;
      this.audio.playbackRate = this.state.speed;
      this.audio.loop = this.state.mode === "repeat";
      this.audio.onloadedmetadata = () => {
        if (generation !== this.generation || this.disposed) return;
        this.audio.onloadedmetadata = null;
        const duration = this.audio.duration;
        this.audio.currentTime =
          position && position < duration - 1 ? position : 0;
        this.update({ duration, time: this.audio.currentTime });
      };
      this.deps.cached();
      await this.audio.play();
    } catch (e) {
      if (generation === this.generation && !this.disposed)
        this.deps.report(
          e instanceof Error ? e.message : "播放失败，请重新点击播放",
        );
    } finally {
      if (generation === this.generation) this.update({ loading: false });
    }
  }
  skip(direction: -1 | 1) {
    const index = this.queue.findIndex(
      (k) => k.key === this.state.current?.key,
    );
    const next = index >= 0 ? this.queue[index + direction] : undefined;
    if (next) void this.start(next, this.queue, false);
  }
  private ended() {
    this.audio.currentTime = 0;
    this.update({ playing: false, time: 0 });
    void this.save();
    if (this.state.mode === "repeat") this.toggle();
    else if (this.state.mode === "next") this.skip(1);
  }
  toggle() {
    if (this.state.loading) return;
    if (!this.audio.src && this.state.current) {
      void this.start(this.state.current);
      return;
    }
    if (!this.audio.src) return;
    if (this.audio.paused) {
      void this.audio
        .play()
        .catch(() => this.deps.report("播放被系统暂停，请再次点击播放"));
    } else this.audio.pause();
  }
  seek(time: number) {
    if (!Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration));
    this.update({ time: this.audio.currentTime });
    void this.save();
  }
  dispose() {
    void this.save();
    this.disposed = true;
    ++this.generation;
    this.audio.onplay =
      this.audio.onpause =
      this.audio.ontimeupdate =
      this.audio.onended =
      this.audio.onerror =
      this.audio.onloadedmetadata =
        null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}
