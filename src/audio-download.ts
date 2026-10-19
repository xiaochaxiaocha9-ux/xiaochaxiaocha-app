import { active, type Knowledge } from "./domain";
export interface AudioDownloadProgress {
  ready: number;
  total: number;
  failed: number;
  title: string;
}
/** Each completed file is committed separately; retry resumes through the audio cache. */
export async function downloadAudioLibrary(
  items: Knowledge[],
  load: (k: Knowledge) => Promise<Blob>,
  progress: (p: AudioDownloadProgress) => void,
  signal?: AbortSignal,
) {
  const list = items.filter((k) => active(k) && k.audio_path);
  let ready = 0;
  const failures: string[] = [];
  for (const k of list) {
    if (signal?.aborted) break;
    progress({
      ready,
      total: list.length,
      failed: failures.length,
      title: k.title,
    });
    try {
      await load(k);
      ++ready;
    } catch (e) {
      const message = e instanceof Error ? e.message : "下载失败";
      failures.push(`${k.title}：${message}`);
      // A shared permission/storage problem needs user action, not dozens of repeated requests.
      if (/令牌|权限|不存在|存储空间|未授权/.test(message)) break;
    }
    progress({ ready, total: list.length, failed: failures.length, title: "" });
  }
  return { ready, total: list.length, failures, stopped: !!signal?.aborted };
}
