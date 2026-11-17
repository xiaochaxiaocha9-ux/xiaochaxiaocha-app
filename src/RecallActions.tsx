import { Check, RotateCcw, ChevronRight } from "lucide-react";
export type RecallPhase = "hidden" | "remembered" | "forgotten";
export function RecallActions({ phase, busy, remaining, cooldown, onRemember, onForget, onNext }: {
  phase: RecallPhase; busy: boolean; remaining: number; cooldown: number;
  onRemember: () => void; onForget: () => void; onNext: () => void;
}) {
  return <section className="rating-panel" aria-label="回忆与确认">
    <p>{phase === "hidden" ? "先回想，再揭示核对" : phase === "remembered" ? "核对后，刚才记对了吗？" : "先理解，再继续；稍后会再次出现"}
      <small>{cooldown && phase === "hidden" ? `${cooldown}秒后再回想，可先返回听读复习 · ` : ""}{remaining ? `还需确认记对 ${remaining} 次 · ` : ""}自评不等于考试式独立掌握</small>
    </p>
    <div>
      {phase === "hidden" ? <>
        <button className="again" disabled={busy || cooldown > 0} onClick={onForget}><RotateCcw size={18} />不记得</button>
        <button className="good" disabled={busy || cooldown > 0} onClick={onRemember}><Check size={18} />记得</button>
      </> : <>
        {phase === "remembered" && <button className="again" disabled={busy} onClick={onForget}><RotateCcw size={18} />记错了</button>}
        <button className="good" disabled={busy} onClick={onNext}><ChevronRight size={18} />{busy ? "正在保存…" : "下一张"}</button>
      </>}
    </div>
  </section>;
}
