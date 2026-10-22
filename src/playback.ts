import { active, type Knowledge } from "./domain";
import { audioKey } from "./db";
import { ListeningMeter, type ListeningSession } from "./listening";

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
  cachedAudio?(k: Knowledge): Promise<Blob | undefined>;
  readPosition(k: Knowledge): Promise<number | undefined>;
  writePosition(k: Knowledge, seconds: number): Promise<unknown>;
  changed(state: PlaybackState): void;
  trackChanged(k: Knowledge): void;
  cached(): void;
  report(message: string): void;
  listening?(session: ListeningSession): void;
}

/** Audio transitions live outside React so ended events and rapid skips can be tested. */
export class PlaybackController {
  state = { ...initialPlayback };
  private queue: Knowledge[] = [];
  private generation = 0;
  private prepared = new Map<string, { url: string; position?: number }>();
  private preparing = new Map<
    string,
    Promise<{ url: string; position?: number } | undefined>
  >();
  private cacheEpoch = 0;
  private loadedKey = "";
  private lastSaved = 0;
  private disposed = false;
  private meter: ListeningMeter;
  constructor(
    readonly audio: HTMLAudioElement,
    private deps: Dependencies,
  ) {
    this.meter = new ListeningMeter((s) => this.deps.listening?.(s));
    const beginListening = () => {
      if (this.state.current && this.loadedKey === audioKey(this.state.current))
        this.meter.begin(
          this.state.current,
          audio.currentTime,
          audio.playbackRate,
        );
    };
    audio.onplay = () => {
      beginListening();
      this.update({ playing: true });
    };
    audio.onplaying = beginListening;
    audio.onwaiting = () => this.stopListening();
    audio.onseeking = () =>
      this.meter.anchor(audio.currentTime, audio.playbackRate);
    audio.onseeked = () =>
      this.meter.anchor(audio.currentTime, audio.playbackRate);
    audio.onpause = () => {
      this.stopListening();
      this.update({ playing: false });
      void this.save();
    };
    audio.ontimeupdate = () => {
      this.sampleListening();
      this.update({ time: audio.currentTime });
      if (Date.now() - this.lastSaved > 4000) {
        this.lastSaved = Date.now();
        void this.save();
      }
    };
    audio.onended = () => this.ended();
    audio.onerror = () => {
      this.stopListening();
      this.update({ playing: false, loading: false });
      this.deps.report(
        this.audio.error?.code === 2
          ? "音频读取中断，请先下载全部音频后重试"
          : "本节音频无法解码，请清理音频缓存后重新下载",
      );
    };
  }
  private sampleListening() {
    this.meter.sample(
      this.audio.currentTime,
      this.audio.duration,
      this.audio.loop,
      this.audio.playbackRate,
    );
  }
  private stopListening() {
    this.meter.stop(
      this.audio.currentTime,
      this.audio.duration,
      this.audio.loop,
      this.audio.playbackRate,
    );
  }
  private update(patch: Partial<PlaybackState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.deps.changed(this.state);
  }
  async save() {
    this.sampleListening();
    this.meter.flush();
    const k = this.state.current;
    if (
      k &&
      this.loadedKey === audioKey(k) &&
      this.audio.src &&
      Number.isFinite(this.audio.currentTime)
    ) {
      const prepared = this.prepared.get(audioKey(k));
      if (prepared) prepared.position = this.audio.currentTime;
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
    if (mode === "next") this.prepareNext();
  }
  private prepareOne(k: Knowledge, cachedOnly = false) {
    const key = audioKey(k),
      existing = this.prepared.get(key);
    if (existing) return Promise.resolve(existing);
    const pendingKey = key + (cachedOnly ? ":cached" : ":download");
    const pending = this.preparing.get(pendingKey);
    if (pending) return pending;
    const epoch = this.cacheEpoch;
    const request = (async () => {
      const blob = cachedOnly
        ? await this.deps.cachedAudio?.(k)
        : await this.deps.loadAudio(k);
      if (!blob || epoch !== this.cacheEpoch || this.disposed) return;
      const position = await this.deps.readPosition(k).catch(() => undefined);
      if (epoch !== this.cacheEpoch || this.disposed) return;
      const already = this.prepared.get(key);
      if (already) return already;
      const prepared = {
        url: URL.createObjectURL(new Blob([blob], { type: "audio/mpeg" })),
        position,
      };
      this.prepared.set(key, prepared);
      return prepared;
    })().finally(() => {
      if (this.preparing.get(pendingKey) === request)
        this.preparing.delete(pendingKey);
    });
    this.preparing.set(pendingKey, request);
    return request;
  }
  async prepareCached(items: Knowledge[]) {
    for (const k of items.filter((k) => active(k) && k.audio_path)) {
      if (this.disposed) return;
      try {
        await this.prepareOne(k, true);
      } catch {
        /* on-demand playback reports errors */
      }
    }
  }
  private prepareNext() {
    if (this.state.mode !== "next") return;
    const index = this.queue.findIndex(
      (k) => k.key === this.state.current?.key,
    );
    const next = index >= 0 ? this.queue[index + 1] : undefined;
    const epoch = this.cacheEpoch;
    if (next)
      void this.prepareOne(next).catch((e) => {
        if (epoch === this.cacheEpoch && !this.disposed)
          this.deps.report(
            `下一节尚未准备好：${e instanceof Error ? e.message : "下载失败"}。可在设置中下载全部音频后重试。`,
          );
      });
  }
  changeSpeed(speed: number) {
    this.sampleListening();
    this.audio.playbackRate = speed;
    this.meter.anchor(this.audio.currentTime, speed);
    this.update({ speed });
  }
  async start(k: Knowledge, list = this.queue, resume = true) {
    if (this.disposed || !k.audio_path || !active(k)) return;
    const generation = ++this.generation;
    void this.save();
    this.stopListening();
    this.audio.pause();
    this.audio.onloadedmetadata = null;
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
      // A prepared track reaches play() synchronously in the click/ended handler.
      // Keep the same media element and avoid clearing its src between tracks.
      const prepared =
        this.prepared.get(audioKey(k)) || (await this.prepareOne(k));
      if (!prepared || generation !== this.generation || this.disposed) return;
      const position = resume ? prepared.position : undefined;
      this.audio.onloadedmetadata = () => {
        if (generation !== this.generation || this.disposed) return;
        this.audio.onloadedmetadata = null;
        const duration = this.audio.duration;
        this.audio.currentTime =
          position && position < duration - 1 ? position : 0;
        this.update({ duration, time: this.audio.currentTime });
      };
      this.loadedKey = audioKey(k);
      this.audio.src = prepared.url;
      this.audio.playbackRate = this.state.speed;
      this.audio.loop = this.state.mode === "repeat";
      const playing = this.audio.play();
      this.prepareNext();
      this.deps.cached();
      await playing;
    } catch (e) {
      if (generation === this.generation && !this.disposed)
        this.deps.report(
          e instanceof Error && e.name === "NotAllowedError"
            ? "音频已准备好，但系统阻止自动播放。请点“继续播放”；建议先下载全部音频。"
            : e instanceof Error
              ? e.message
              : "播放失败，请重新点击播放",
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
    this.stopListening();
    this.audio.currentTime = 0;
    this.update({ playing: false, time: 0 });
    void this.save();
    if (this.state.mode === "repeat") this.toggle();
    else if (this.state.mode === "next") this.skip(1);
  }
  toggle() {
    if (this.state.loading) return;
    if (
      this.state.current &&
      (!this.audio.src || this.loadedKey !== audioKey(this.state.current))
    ) {
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
    this.sampleListening();
    this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration));
    this.meter.anchor(this.audio.currentTime, this.audio.playbackRate);
    this.update({ time: this.audio.currentTime });
    void this.save();
  }
  dispose() {
    this.clearAudio();
    this.disposed = true;
    this.audio.onplay =
      this.audio.onpause =
      this.audio.ontimeupdate =
      this.audio.onended =
      this.audio.onerror =
      this.audio.onloadedmetadata =
      this.audio.onplaying =
      this.audio.onwaiting =
      this.audio.onseeking =
      this.audio.onseeked =
        null;
  }
  clearAudio() {
    void this.save();
    this.stopListening();
    this.meter.finish();
    ++this.generation;
    ++this.cacheEpoch;
    this.audio.pause();
    this.loadedKey = "";
    this.audio.onloadedmetadata = null;
    this.audio.removeAttribute("src");
    this.audio.load();
    for (const prepared of this.prepared.values())
      URL.revokeObjectURL(prepared.url);
    this.prepared.clear();
    this.preparing.clear();
    this.queue = [];
    this.update({
      ...initialPlayback,
      current: undefined,
      mode: this.state.mode,
      speed: this.state.speed,
    });
  }
}
