import { X } from "lucide-react";
export function Toast({ message, updateReady, close, apply }: { message: string; updateReady: boolean; close: () => void; apply: () => void }) {
  return <div className="toast-stack" aria-label="应用消息">
    {message && <div className="toast-bubble" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={close}><X size={18} /></button></div>}
    {updateReady && <div className="toast-bubble" role="status"><span>随身听有新版本</span><button className="text-button" onClick={apply}>立即更新</button></div>}
  </div>;
}
