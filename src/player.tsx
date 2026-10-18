import { useEffect, useRef, useState } from "react";
import { cacheAudio } from "./github";
import { database, audioKey } from "./db";
import { subjects, type Knowledge, type Config, type Position } from "./domain";
export function usePlayer(
  config: Config,
  token: string,
  report: (s: string) => void,
  refresh: () => void,
) {
  const audio = useRef<HTMLAudioElement | null>(null);
  if (!audio.current) audio.current = new Audio();
  const [current, setCurrent] = useState<Knowledge>(),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [speed, setSpeed] = useState(1),
    [loading, setLoading] = useState(false);
  const queue = useRef<Knowledge[]>([]),
    currentRef = useRef<Knowledge | undefined>(undefined),
    url = useRef(""),
    generation = useRef(0),
    lastSaved = useRef(0),
    speedRef = useRef(1);
  const save = async () => {
    const k = currentRef.current,
      a = audio.current!;
    if (!k || !Number.isFinite(a.currentTime)) return;
    const seconds = a.currentTime,
      at = new Date().toISOString();
    const db = await database();
    await db.put("positions", { key: audioKey(k), seconds, updated_at: at });
  };
  const start = async (k: Knowledge, list: Knowledge[] = queue.current) => {
    const gen = ++generation.current;
    void save().catch(() => {});
    audio.current!.pause();
    audio.current!.removeAttribute("src");
    audio.current!.load();
    queue.current = list.filter((x) => x.audio_path);
    setLoading(true);
    setCurrent(k);
    currentRef.current = k;
    try {
      const blob = await cacheAudio(k, config, token);
      if (gen !== generation.current) return;
      const db = await database(),
        pos = (await db.get("positions", audioKey(k))) as Position | undefined,
        a = audio.current!;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob);
      a.src = url.current;
      a.playbackRate = speedRef.current;
      setTime(0);
      setDuration(0);
      a.onloadedmetadata = () => {
        setDuration(a.duration);
        a.currentTime = pos && pos.seconds < a.duration - 1 ? pos.seconds : 0;
      };
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: k.title,
          artist: subjects.find((s) => s.id === k.subject)!.name,
          album: k.chapter,
        });
      }
      await a.play();
      refresh();
    } catch (e) {
      report(e instanceof Error ? e.message : "播放失败，请重新点击播放");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  };
  const skip = (direction: number) => {
    const index = queue.current.findIndex(
        (k) => k.key === currentRef.current?.key,
      ),
      k = queue.current[index + direction];
    if (k) void start(k);
  };
  const toggle = () => {
    const a = audio.current!;
    if (!a.src && currentRef.current) {
      void start(currentRef.current);
      return;
    }
    if (a.paused)
      void a.play().catch(() => report("播放被系统暂停，请再次点击播放"));
    else a.pause();
  };
  const seek = (t: number) => {
    const a = audio.current!;
    if (Number.isFinite(a.duration))
      a.currentTime = Math.max(0, Math.min(t, a.duration));
    setTime(a.currentTime);
    void save().catch(() => {});
  };
  useEffect(() => {
    const a = audio.current!;
    a.onplay = () => {
      setPlaying(true);
      if ("mediaSession" in navigator)
        navigator.mediaSession.playbackState = "playing";
    };
    a.onpause = () => {
      setPlaying(false);
      void save().catch(() => {});
      if ("mediaSession" in navigator)
        navigator.mediaSession.playbackState = "paused";
    };
    a.ontimeupdate = () => {
      setTime(a.currentTime);
      if (
        "mediaSession" in navigator &&
        Number.isFinite(a.duration) &&
        a.duration > 0
      ) {
        try {
          navigator.mediaSession.setPositionState({
            duration: a.duration,
            playbackRate: a.playbackRate,
            position: Math.min(a.currentTime, a.duration),
          });
        } catch {
          /* unsupported on some Safari versions */
        }
      }
      if (Date.now() - lastSaved.current > 4000) {
        lastSaved.current = Date.now();
        void save().catch(() => {});
      }
    };
    a.onended = () => {
      const k = currentRef.current;
      if (k)
        void database().then((db) =>
          db.put("positions", {
            key: audioKey(k),
            seconds: 0,
            updated_at: new Date().toISOString(),
          }),
        );
      skip(1);
    };
    a.onerror = () => report("音频解码或播放失败，请重新下载并尝试");
    const handlers: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => {
        void a.play().catch(() => report("请在页面点击播放以恢复"));
      },
      pause: () => a.pause(),
      previoustrack: () => skip(-1),
      nexttrack: () => skip(1),
      seekto: (d) => seek(d.seekTime || 0),
      seekbackward: (d) => seek(a.currentTime - (d.seekOffset || 15)),
      seekforward: (d) => seek(a.currentTime + (d.seekOffset || 15)),
    };
    if ("mediaSession" in navigator)
      for (const [name, fn] of Object.entries(handlers))
        try {
          navigator.mediaSession.setActionHandler(
            name as MediaSessionAction,
            fn!,
          );
        } catch {
          /* optional action */
        }
    const persist = () => {
      void save().catch(() => {});
    };
    document.addEventListener("visibilitychange", persist);
    window.addEventListener("pagehide", persist);
    return () => {
      document.removeEventListener("visibilitychange", persist);
      window.removeEventListener("pagehide", persist);
    };
  });
  useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  const changeSpeed = (v: number) => {
    setSpeed(v);
    speedRef.current = v;
    audio.current!.playbackRate = v;
  };
  return {
    current,
    playing,
    time,
    duration,
    speed,
    loading,
    start,
    skip,
    toggle,
    seek,
    changeSpeed,
  };
}
