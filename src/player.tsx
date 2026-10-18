import { useEffect, useRef, useState } from "react";
import { cacheAudio } from "./github";
import { database, audioKey, setting, putSetting } from "./db";
import { subjects, type Knowledge, type Config, type Position } from "./domain";
import {
  PlaybackController,
  initialPlayback,
  playbackModes,
  type PlaybackMode,
} from "./playback";
export function usePlayer(
  config: Config,
  token: string,
  report: (s: string) => void,
  refresh: () => void,
  trackChanged: (k: Knowledge) => void,
) {
  const latest = useRef({ config, token, report, refresh, trackChanged });
  latest.current = { config, token, report, refresh, trackChanged };
  const [state, setState] = useState(initialPlayback);
  const engine = useRef<PlaybackController | null>(null);
  const modeEdited = useRef(false);
  if (!engine.current)
    engine.current = new PlaybackController(new Audio(), {
      loadAudio: (k) =>
        cacheAudio(k, latest.current.config, latest.current.token),
      readPosition: async (k) =>
        (
          (await (await database()).get("positions", audioKey(k))) as
            Position | undefined
        )?.seconds,
      writePosition: async (k, seconds) =>
        (await database()).put("positions", {
          key: audioKey(k),
          seconds,
          updated_at: new Date().toISOString(),
        }),
      changed: setState,
      trackChanged: (k) => latest.current.trackChanged(k),
      cached: () => latest.current.refresh(),
      report: (message) => latest.current.report(message),
    });
  const controller = engine.current;
  useEffect(() => {
    void setting<PlaybackMode>("playback-mode", "once").then((mode) => {
      if (!modeEdited.current && playbackModes.includes(mode))
        controller.setMode(mode);
    });
    const persist = () => {
      void controller.save();
    };
    document.addEventListener("visibilitychange", persist);
    window.addEventListener("pagehide", persist);
    const handlers: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => {
        if (controller.audio.paused) controller.toggle();
      },
      pause: () => controller.audio.pause(),
      previoustrack: () => controller.skip(-1),
      nexttrack: () => controller.skip(1),
      seekto: (d) => controller.seek(d.seekTime || 0),
      seekbackward: (d) =>
        controller.seek(controller.audio.currentTime - (d.seekOffset || 15)),
      seekforward: (d) =>
        controller.seek(controller.audio.currentTime + (d.seekOffset || 15)),
    };
    if ("mediaSession" in navigator)
      for (const [name, handler] of Object.entries(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(
            name as MediaSessionAction,
            handler!,
          );
        } catch {
          /* optional action */
        }
      }
    return () => {
      document.removeEventListener("visibilitychange", persist);
      window.removeEventListener("pagehide", persist);
      controller.dispose();
      if ("mediaSession" in navigator)
        for (const name of Object.keys(handlers)) {
          try {
            navigator.mediaSession.setActionHandler(
              name as MediaSessionAction,
              null,
            );
          } catch {
            /* optional action */
          }
        }
    };
  }, [controller]);
  useEffect(() => {
    const k = state.current;
    if (
      k &&
      "mediaSession" in navigator &&
      typeof MediaMetadata !== "undefined"
    )
      navigator.mediaSession.metadata = new MediaMetadata({
        title: k.title,
        artist: subjects.find((s) => s.id === k.subject)!.name,
        album: k.chapter,
      });
  }, [state.current]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
    if (Number.isFinite(state.duration) && state.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: state.duration,
          playbackRate: state.speed,
          position: Math.min(state.time, state.duration),
        });
      } catch {
        /* optional Safari support */
      }
    }
  }, [state.playing, state.time, state.duration, state.speed]);
  return {
    ...state,
    start: (k: Knowledge, list?: Knowledge[]) => controller.start(k, list),
    skip: (direction: -1 | 1) => controller.skip(direction),
    toggle: () => controller.toggle(),
    seek: (time: number) => controller.seek(time),
    changeSpeed: (speed: number) => controller.changeSpeed(speed),
    changeMode: (mode: PlaybackMode) => {
      modeEdited.current = true;
      controller.setMode(mode);
      void putSetting("playback-mode", mode).catch(() =>
        report("播放模式未能保存，本次仍可使用"),
      );
    },
  };
}
export type Player = ReturnType<typeof usePlayer>;
