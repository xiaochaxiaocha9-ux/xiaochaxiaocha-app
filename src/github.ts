import {
  type Config,
  type Manifest,
  type Knowledge,
  namespaceOf,
  keyOf,
  safePath,
  validateManifest,
  sha256,
} from "./domain";
import { database, commitContent, audioKey } from "./db";
export class GitHubError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function validateConfig(c: Config) {
  if (
    !/^[\w.-]+$/.test(c.owner) ||
    !/^[\w.-]+$/.test(c.repo) ||
    !c.branch ||
    !safePath(c.manifest_path)
  )
    throw Error("请填写有效的 GitHub 用户、仓库、分支和索引路径");
}
async function request(url: string, token: string, raw = false) {
  let r: Response;
  try {
    r = await fetch(url, {
      headers: {
        Accept: raw
          ? "application/vnd.github.raw+json"
          : "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new GitHubError(
      "network",
      "网络连接失败或请求超时，已有资料仍可使用",
    );
  }
  if (r.status === 401)
    throw new GitHubError("token", "令牌失效或已过期，请重新配置");
  if (r.status === 403 || r.status === 429)
    throw new GitHubError(
      "permission",
      "权限不足或 API 请求受限；检查 Contents 读取权限及用量",
    );
  if (r.status === 404)
    throw new GitHubError(
      "missing",
      "仓库、分支或资源不存在；私人仓库未授权时 GitHub 也会返回此错误",
    );
  if (!r.ok)
    throw new GitHubError(
      "server",
      `GitHub 请求失败（${r.status}），请稍后重试`,
    );
  return r;
}
const base = (c: Config) =>
  `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
async function pin(c: Config, token: string) {
  const j = await (
    await request(`${base(c)}/commits/${encodeURIComponent(c.branch)}`, token)
  ).json();
  if (!/^[a-f0-9]{40}$/.test(j.sha)) throw Error("远端版本无效");
  return j.sha as string;
}
async function raw(c: Config, token: string, path: string, ref: string) {
  if (!safePath(path)) throw Error("资料路径无效");
  return request(
    `${base(c)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    token,
    true,
  );
}
function resolve(c: Config, p: string) {
  const dir = c.manifest_path.split("/").slice(0, -1).join("/");
  return dir ? `${dir}/${p}` : p;
}
export async function checkVersion(
  c: Config,
  token: string,
): Promise<{ manifest: Manifest; ref: string }> {
  validateConfig(c);
  const ref = await pin(c, token);
  return {
    manifest: validateManifest(
      await (await raw(c, token, c.manifest_path, ref)).json(),
    ),
    ref,
  };
}
export async function syncContent(
  c: Config,
  token: string,
  onProgress = (s: string) => {},
) {
  const { manifest, ref } = await checkVersion(c, token),
    ns = namespaceOf(c),
    db = await database(),
    old = (await db.getAll("knowledge")).filter((k) => k.namespace === ns),
    map = new Map(old.map((k) => [k.key, k]));
  let added = 0,
    updated = 0;
  const next: Knowledge[] = [];
  for (const e of manifest.items) {
    const key = keyOf(ns, e),
      prev = map.get(key);
    if (
      prev &&
      (prev.module_id !== e.module_id ||
        e.learning_revision < prev.learning_revision)
    )
      throw Error("远端更改了稳定模块 ID 或回退内容修订号，请在发布端检查");
    let reading = prev?.reading || "";
    if (
      e.status === "active" &&
      (!prev || prev.reading_hash !== e.reading_hash)
    ) {
      onProgress(`正在获取：${e.title}`);
      const bytes = await (
        await raw(c, token, resolve(c, e.reading_path), ref)
      ).arrayBuffer();
      if ((await sha256(bytes)) !== e.reading_hash)
        throw Error("正文校验失败，本次同步未写入，请重试");
      reading = new TextDecoder().decode(bytes);
    }
    if (!prev) added++;
    else if (prev.content_hash !== e.content_hash || prev.status !== e.status)
      updated++;
    next.push({ ...e, key, namespace: ns, reading });
  }
  await commitContent(ns, next);
  await db.put(
    "settings",
    { revision: manifest.revision, ref, at: new Date().toISOString() },
    `sync:${ns}`,
  );
  return {
    added,
    updated,
    total: next.filter((k) => k.status === "active").length,
  };
}
let audioEpoch = 0;
const audioRequests = new Map<string, Promise<Blob>>();
export async function cachedAudio(k: Knowledge): Promise<Blob | undefined> {
  const cached = await (await database()).get("audio", audioKey(k));
  return cached ? new Blob([cached.blob], { type: "audio/mpeg" }) : undefined;
}
export async function clearAudioCache() {
  ++audioEpoch;
  audioRequests.clear();
  await (await database()).clear("audio");
}
export function cacheAudio(
  k: Knowledge,
  c: Config,
  token: string,
): Promise<Blob> {
  const key = audioKey(k);
  const existing = audioRequests.get(key);
  if (existing) return existing;
  const request = fetchAudio(k, c, token, audioEpoch).finally(() => {
    if (audioRequests.get(key) === request) audioRequests.delete(key);
  });
  audioRequests.set(key, request);
  return request;
}
async function fetchAudio(
  k: Knowledge,
  c: Config,
  token: string,
  epoch: number,
) {
  if (!k.audio_path || !k.audio_hash) throw Error("该知识点只有阅读版");
  const db = await database(),
    key = audioKey(k),
    cached = await db.get("audio", key);
  if (cached) return new Blob([cached.blob], { type: "audio/mpeg" });
  let blob: Blob;
  if (k.namespace === "demo") {
    const r = await fetch(import.meta.env.BASE_URL + k.audio_path);
    if (!r.ok) throw Error("演示音频不可用");
    blob = await r.blob();
  } else {
    if (namespaceOf(c) !== k.namespace)
      throw Error("请切换到这份资料对应的仓库");
    const version = (await db.get("settings", `sync:${k.namespace}`)) as
      { ref: string } | undefined;
    if (!version) throw Error("请先同步资料");
    blob = await (
      await raw(c, token, resolve(c, k.audio_path), version.ref)
    ).blob();
  }
  if ((await sha256(await blob.arrayBuffer())) !== k.audio_hash)
    throw Error("音频校验失败，请重新同步");
  if (epoch !== audioEpoch) throw Error("音频缓存已清理，请重新点击播放");
  const mp3 = new Blob([blob], { type: "audio/mpeg" });
  try {
    await db.put("audio", {
      key,
      blob: mp3,
    });
  } catch {
    throw Error("存储空间不足，音频未下载；请清理音频缓存");
  }
  return mp3;
}
