import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RefreshCw,
  Repeat,
  ListMusic,
  CirclePlay,
} from "lucide-react";
import { playbackLabels, playbackModes } from "./playback";
import type { Knowledge } from "./domain";
import type { Player } from "./player";
const clock = (time: number) =>
  Number.isFinite(time)
    ? `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`
    : "0:00";
export function PlaybackControls({
  player,
  item,
  onStart,
}: {
  player: Player;
  item: Knowledge;
  onStart: () => void;
}) {
  const selected = player.current?.key === item.key;
  const ModeIcon =
    player.mode === "repeat"
      ? Repeat
      : player.mode === "next"
        ? ListMusic
        : CirclePlay;
  return (
    <section className="inline-audio panel" aria-label="本节音频">
      <div className="inline-transport">
        <button
          className="primary"
          disabled={selected && player.loading}
          onClick={selected ? player.toggle : onStart}
        >
          {selected && player.loading ? (
            <RefreshCw size={17} className="spin" />
          ) : selected && player.playing ? (
            <Pause size={17} />
          ) : (
            <Play size={17} />
          )}
          {selected && player.loading
            ? "正在加载"
            : selected && player.playing
              ? "暂停"
              : selected
                ? "继续播放"
                : "收听本节"}
        </button>
        <button
          className="audio-icon"
          aria-label="上一小节"
          disabled={!selected || !player.hasPrevious}
          onClick={() => player.skip(-1)}
        >
          <SkipBack size={20} />
        </button>
        <button
          className="audio-icon"
          aria-label="下一小节"
          disabled={!selected || !player.hasNext}
          onClick={() => player.skip(1)}
        >
          <SkipForward size={20} />
        </button>
        <button
          className="audio-mode"
          aria-label={`播放模式：${playbackLabels[player.mode]}，点击切换`}
          onClick={() =>
            player.changeMode(
              playbackModes[
                (playbackModes.indexOf(player.mode) + 1) % playbackModes.length
              ],
            )
          }
        >
          <ModeIcon size={17} />
          {playbackLabels[player.mode]}
        </button>
      </div>
      <div className="inline-progress">
        <span>{clock(selected ? player.time : 0)}</span>
        <input
          className="seek"
          aria-label="播放进度"
          type="range"
          min="0"
          max={
            selected && Number.isFinite(player.duration) ? player.duration : 0
          }
          step="0.1"
          disabled={!selected || !player.duration}
          value={selected ? Math.min(player.time, player.duration || 0) : 0}
          onChange={(e) => player.seek(Number(e.target.value))}
        />
        <span>{clock(selected ? player.duration : 0)}</span>
        <select
          aria-label="播放速度"
          value={player.speed}
          onChange={(e) => player.changeSpeed(Number(e.target.value))}
        >
          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
