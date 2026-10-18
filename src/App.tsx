import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Headphones,
  House,
  CalendarDays,
  Settings,
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Download,
  RefreshCw,
  Search,
  Check,
  Cloud,
  WifiOff,
  Moon,
  Sun,
  Volume2,
  Leaf,
  CheckCircle2,
  RotateCcw,
  Plus,
  ShieldCheck,
  FileDown,
  Upload,
  X,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { database, snapshot, setting, putSetting, audioKey } from "./db";
import {
  subjects,
  defaultConfig,
  namespaceOf,
  active,
  due,
  dueQueue,
  type Config,
  type Knowledge,
  type Review,
} from "./domain";
import { seedDemo } from "./demo";
import { rate } from "./review";
import {
  syncContent,
  cacheAudio,
  checkVersion,
  validateConfig,
} from "./github";
import { exportBackup, restoreBackup } from "./backup";
import { usePlayer } from "./player";
type Page = "home" | "subject" | "read" | "player" | "review" | "settings";
const dateText = (s: string | Date) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const clock = (t: number) =>
  Number.isFinite(t)
    ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
    : "0:00";
export default function App() {
  const [page, setPage] = useState<Page>("home"),
    [subject, setSubject] = useState("politics"),
    [selected, setSelected] = useState<string>(),
    [items, setItems] = useState<Knowledge[]>([]),
    [reviews, setReviews] = useState<Review[]>([]),
    [cached, setCached] = useState(new Set<string>()),
    [config, setConfig] = useState<Config>(defaultConfig),
    [token, setToken] = useState(""),
    [namespace, setNamespace] = useState("demo"),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [rating, setRating] = useState(false),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [theme, setTheme] = useState("system"),
    [reviewMode, setReviewMode] = useState(false),
    [last, setLast] = useState<string>(),
    [syncInfo, setSyncInfo] = useState("尚未同步"),
    [updateReady, setUpdateReady] = useState(false);
  const file = useRef<HTMLInputElement>(null),
    ratingLock = useRef(false),
    busyLock = useRef(false),
    init = useRef(false);
  const report = (s: string) => setNotice(s);
  const refresh = async () => {
    const data = await snapshot();
    setItems(data.items);
    setReviews(data.reviews);
    const db = await database();
    setCached(new Set(await db.getAllKeys("audio")));
  };
  const player = usePlayer(config, token, report, () => {
    void refresh();
  });
  const go = (p: Page) => {
    if (p === "review") setFilter("all");
    location.hash = p;
    setPage(p);
    window.scrollTo(0, 0);
  };
  const open = (k: Knowledge, mode = false) => {
    setSelected(k.key);
    setSubject(k.subject);
    setReviewMode(mode);
    setLast(k.key);
    void putSetting("last", k.key);
    go("read");
  };
  useEffect(() => {
    const listener = () => {
      const p = location.hash.slice(1);
      if (
        ["home", "subject", "read", "player", "review", "settings"].includes(p)
      )
        setPage(p as Page);
    };
    window.addEventListener("hashchange", listener);
    listener();
    const update = () => setUpdateReady(true);
    window.addEventListener("app-update-ready", update);
    if (!init.current) {
      init.current = true;
      void (async () => {
        try {
          await seedDemo();
          await refresh();
          const c = await setting("config", defaultConfig),
            ns = await setting("namespace", "demo"),
            t = await setting("theme", "system"),
            savedToken = c.rememberToken ? await setting("token", "") : "";
          const lastKey = await setting<string | undefined>("last", undefined);
          setConfig(c);
          setNamespace(ns);
          setToken(savedToken);
          setTheme(t);
          setLast(lastKey);
          setSelected(lastKey);
          if (lastKey) {
            const s = lastKey.split("::")[1];
            if (subjects.some((x) => x.id === s)) setSubject(s);
          }
          setReady(true);
          if (c.checkOnOpen && c.owner && c.repo && navigator.onLine) {
            try {
              const remote = await checkVersion(c, savedToken),
                old = await setting<{ revision?: string }>(
                  "sync:" + namespaceOf(c),
                  {},
                );
              if (old.revision !== remote.manifest.revision)
                report("发现新资料，可在设置中点击同步");
            } catch (e) {
              report(e instanceof Error ? e.message : "版本检查失败");
            }
          }
        } catch (e) {
          report(
            e instanceof Error
              ? e.message
              : "初始化失败，请检查浏览器是否允许本地存储",
          );
        }
      })();
    }
    return () => {
      window.removeEventListener("hashchange", listener);
      window.removeEventListener("app-update-ready", update);
    };
  }, []);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)"),
      apply = () => {
        document.documentElement.dataset.theme =
          theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const tick = setInterval(() => {
      setReviews((r) => [...r]);
    }, 60000);
    return () => clearInterval(tick);
  }, []);
  const visible = items.filter((k) => k.namespace === namespace && active(k)),
    queue = dueQueue(visible, reviews),
    reviewMap = new Map(reviews.map((r) => [r.key, r])),
    current = items.find((k) => k.key === selected),
    subjectInfo = subjects.find((s) => s.id === subject)!,
    subjectItems = visible.filter((k) => k.subject === subject),
    lastItem = visible.find((k) => k.key === last);
  const locked = (work: () => Promise<void>) => {
    if (busyLock.current) return;
    busyLock.current = true;
    setBusy(true);
    void work()
      .catch((e) => report(e instanceof Error ? e.message : "操作失败"))
      .finally(() => {
        busyLock.current = false;
        setBusy(false);
      });
  };
  const download = async (k: Knowledge) => {
    await cacheAudio(k, config, token);
    await refresh();
  };
  const chapterOf = (k: Knowledge) =>
    visible
      .filter(
        (x) =>
          x.subject === k.subject &&
          x.module_id === k.module_id &&
          x.chapter === k.chapter,
      )
      .sort((a, b) => a.order - b.order);
  const listen = (k: Knowledge) => {
    void player.start(k, chapterOf(k));
    go("player");
  };
  const reviewRate = async (value: 1 | 3) => {
    if (!current || ratingLock.current) return;
    ratingLock.current = true;
    setRating(true);
    try {
      const did = await rate(current, value, crypto.randomUUID());
      await refresh();
      if (did)
        report(`已记录“${value === 1 ? "忘了" : "认识"}”，仅用于安排复习`);
      else report("刚刚已记录，请稍后再评价");
    } catch {
      report("记录保存失败，请备份或检查本地存储");
    } finally {
      setRating(false);
      setTimeout(() => {
        ratingLock.current = false;
      }, 2600);
    }
  };
  const saveConfig = async () => {
    validateConfig(config);
    await putSetting("config", config);
    await putSetting("token", config.rememberToken ? token : "");
    report("连接设置已保存在本机");
  };
  const synchronize = () =>
    locked(async () => {
      await saveConfig();
      setSyncInfo("正在连接 GitHub…");
      try {
        const result = await syncContent(config, token, setSyncInfo);
        const ns = namespaceOf(config);
        await putSetting("namespace", ns);
        setNamespace(ns);
        await refresh();
        const msg = `同步成功 · 新增 ${result.added} · 更新 ${result.updated} · 共 ${result.total} 条`;
        setSyncInfo(msg);
        report(msg);
      } catch (e) {
        setSyncInfo("同步失败，原资料已保留");
        throw e;
      }
    });
  const backup = () =>
    locked(async () => {
      const data = JSON.stringify(await exportBackup(), null, 2),
        url = URL.createObjectURL(
          new Blob([data], { type: "application/json" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `随身听备份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      await putSetting("backup-at", new Date().toISOString());
      report("备份已导出，请保存到“文件”或 iCloud Drive；不含令牌和音频");
    });
  const row = (k: Knowledge) => {
    const r = reviewMap.get(k.key),
      isDue = due(k, r);
    return (
      <button className="knowledge-row" key={k.key} onClick={() => open(k)}>
        <span className="row-icon">
          <BookOpen size={19} />
        </span>
        <span className="row-copy">
          <strong>{k.title}</strong>
          <small>
            {k.knowledge_id} ·{" "}
            {r
              ? r.revision !== k.learning_revision
                ? "内容已变更 · 需要重新学习"
                : isDue
                  ? "已到复习时间"
                  : `下次 ${dateText(r.card.due)}`
              : "尚未复习"}
          </small>
        </span>
        <span
          className={
            "audio-badge " + (cached.has(audioKey(k)) ? "downloaded" : "")
          }
        >
          {k.audio_path ? (
            cached.has(audioKey(k)) ? (
              <Check size={15} />
            ) : (
              <Headphones size={15} />
            )
          ) : (
            "阅读"
          )}
        </span>
        <ChevronRight size={16} />
      </button>
    );
  };
  const nav = [
    { id: "home", name: "首页", icon: House },
    { id: "review", name: "今日复习", icon: CalendarDays },
    { id: "player", name: "随身听", icon: Headphones },
    { id: "settings", name: "设置", icon: Settings },
  ] as const;
  return (
    <div className="shell">
      <aside className="desktop-side">
        <a className="brand" href="#home" onClick={() => go("home")}>
          <span className="brand-mark">
            <Headphones size={25} />
          </span>
          <span>
            随身听<small>把知识，带在身边</small>
          </span>
        </a>
        <div className="sidebar-label">我的学习空间</div>
        {nav.map((n) => (
          <button
            key={n.id}
            className={"side-nav " + (page === n.id ? "chosen" : "")}
            onClick={() => go(n.id)}
          >
            <n.icon size={19} />
            {n.name}
            {n.id === "review" && queue.length > 0 && <i>{queue.length}</i>}
          </button>
        ))}
        <div className="side-bottom">
          <Leaf size={20} />
          <p>
            每一次回想
            <br />
            都让知识更清晰。
          </p>
          <small>自评记录不等于独立掌握证据</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <a className="mobile-brand" href="#home">
            <Headphones size={22} />
            随身听
          </a>
          <span className="desktop-crumb">
            我的学习空间 <span>/</span>{" "}
            {page === "home"
              ? "概览"
              : page === "settings"
                ? "设置"
                : page === "review"
                  ? "间隔复习"
                  : page === "player"
                    ? "随身听"
                    : "知识资料"}
          </span>
          <div className="top-actions">
            <span className="connection">
              {navigator.onLine ? <Cloud size={15} /> : <WifiOff size={15} />}{" "}
              {namespace === "demo" ? "演示空间" : "私人资料"}
            </span>
            <button
              className="icon-button"
              title="切换深色模式"
              aria-label="切换深色模式"
              onClick={() => {
                const t =
                  document.documentElement.dataset.theme === "dark"
                    ? "light"
                    : "dark";
                setTheme(t);
                void putSetting("theme", t);
              }}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {updateReady && (
          <div className="notice">
            <span>应用有新版本。暂停音频后，重新打开应用更新。</span>
          </div>
        )}
        {!ready ? (
          <div className="empty">
            <RefreshCw />
            正在准备本地资料…
          </div>
        ) : (
          <div className="content">
            {page === "home" && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">A LITTLE, EVERY DAY</p>
                    <h1>
                      让知识，慢慢变熟悉<span className="heading-dot">。</span>
                    </h1>
                    <p className="subtitle">
                      阅读、听一听，或花几分钟回想。按你的节奏来。
                    </p>
                  </div>
                  <span className="date-label">
                    {new Date().toLocaleDateString("zh-CN", {
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    })}
                  </span>
                </div>
                <div className="hero-grid">
                  <section className="review-hero">
                    <div className="hero-top">
                      <span>
                        <span className="live-dot" /> 间隔复习
                      </span>
                      <CalendarDays size={22} />
                    </div>
                    <div className="hero-count">
                      {queue.length}
                      <span>个知识点等待回想</span>
                    </div>
                    <p>
                      到期内容优先，新知识随后。
                      <br />
                      每次只需选择「忘了」或「认识」。
                    </p>
                    <button
                      className="light-button"
                      onClick={() => go("review")}
                    >
                      开始今日复习 <ArrowUpRight size={18} />
                    </button>
                    <div className="hero-rings" aria-hidden="true" />
                  </section>
                  <section className="listen-hero">
                    <div className="listen-copy">
                      <span className="pill">
                        <Headphones size={14} /> 自由听读
                      </span>
                      <h2>
                        把碎片时间
                        <br />
                        留给一点新收获
                      </h2>
                      <p>同一份知识，换一种相遇方式。</p>
                      <button
                        className="text-button"
                        onClick={() => {
                          const k = lastItem?.audio_path
                            ? lastItem
                            : visible.find((k) => k.audio_path);
                          if (k) listen(k);
                          else report("当前资料尚无音频，可先自由阅读");
                        }}
                      >
                        听一听 <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="sound-art" aria-hidden="true">
                      <Headphones />
                      <div className="sound-bars">
                        {[18, 36, 54, 30, 66, 44, 22, 40, 18].map((v, i) => (
                          <i key={i} style={{ height: v }} />
                        ))}
                      </div>
                      <span>随时，随地</span>
                    </div>
                  </section>
                </div>
                <div className="section-heading">
                  <div>
                    <h2>我的四科</h2>
                    <p>沿用原有学习体系，只带上已经学过的知识。</p>
                  </div>
                  <span className="subtle">{visible.length} 个知识点</span>
                </div>
                <div className="subjects-grid">
                  {subjects.map((s) => {
                    const list = visible.filter((k) => k.subject === s.id),
                      count = queue.filter((k) => k.subject === s.id).length;
                    return (
                      <button
                        key={s.id}
                        className={"subject-card " + s.color}
                        onClick={() => {
                          setSubject(s.id);
                          setSearch("");
                          setFilter("all");
                          go("subject");
                        }}
                      >
                        <div className="subject-card-top">
                          <span className="subject-letter">{s.short}</span>
                          <ArrowUpRight size={19} />
                        </div>
                        <small>{s.en}</small>
                        <h3>{s.name}</h3>
                        <div className="subject-card-footer">
                          <span>{list.length} 个知识点</span>
                          <span className="due-dot">{count} 待复习</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="section-heading">
                  <div>
                    <h2>接着上次的节奏</h2>
                    <p>自由浏览，无需每次都评价。</p>
                  </div>
                  <BookOpen size={20} />
                </div>
                <section className="panel continue-panel">
                  {lastItem ? (
                    row(lastItem)
                  ) : visible[0] ? (
                    row(visible[0])
                  ) : (
                    <div className="empty">在设置中同步你的第一份资料</div>
                  )}
                </section>
                {namespace === "demo" && (
                  <div className="demo-note">
                    <ShieldCheck size={17} />
                    <span>
                      当前为虚拟演示资料，不代表你的学习或掌握进度。
                      <button onClick={() => go("settings")}>
                        连接私人仓库 <ChevronRight size={14} />
                      </button>
                    </span>
                  </div>
                )}
              </>
            )}
            {page === "subject" && (
              <>
                <button className="back" onClick={() => go("home")}>
                  <ArrowLeft size={17} />
                  我的四科
                </button>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">{subjectInfo.en}</p>
                    <h1>{subjectInfo.name}</h1>
                    <p className="subtitle">
                      按模块与章节自由浏览，也可以连续收听。
                    </p>
                  </div>
                </div>
                <div className="search-box">
                  <Search size={18} />
                  <input
                    aria-label="搜索标题和正文"
                    placeholder="搜索标题或正文…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="tabs">
                  {[
                    ["all", "全部资料"],
                    ["new", "尚未复习"],
                    ["due", "到期复习"],
                  ].map(([v, n]) => (
                    <button
                      key={v}
                      className={filter === v ? "active" : ""}
                      onClick={() => setFilter(v)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {(() => {
                  const filtered = subjectItems.filter(
                    (k) =>
                      (k.title + k.reading)
                        .toLowerCase()
                        .includes(search.toLowerCase()) &&
                      (filter === "all" ||
                        (filter === "new" && !reviewMap.has(k.key)) ||
                        (filter === "due" &&
                          !!reviewMap.get(k.key) &&
                          due(k, reviewMap.get(k.key)))),
                  );
                  const modules = [
                    ...new Set(filtered.map((k) => k.module_id)),
                  ];
                  return modules.length ? (
                    modules.map((m) => (
                      <section key={m} className="module">
                        <h2>
                          {
                            filtered.find((k) => k.module_id === m)!
                              .module_title
                          }
                          <small>{m}</small>
                        </h2>
                        {[
                          ...new Set(
                            filtered
                              .filter((k) => k.module_id === m)
                              .map((k) => k.chapter),
                          ),
                        ].map((ch) => {
                          const list = filtered
                            .filter(
                              (k) => k.module_id === m && k.chapter === ch,
                            )
                            .sort((a, b) => a.order - b.order);
                          return (
                            <div className="panel" key={ch}>
                              <div className="chapter-heading">
                                <strong>{ch}</strong>
                                <div>
                                  <button
                                    className="text-button"
                                    disabled={
                                      busy || !list.some((k) => k.audio_path)
                                    }
                                    onClick={() =>
                                      locked(async () => {
                                        for (const k of list.filter(
                                          (k) => k.audio_path,
                                        ))
                                          await download(k);
                                        report("本章音频已下载，可离线播放");
                                      })
                                    }
                                  >
                                    <Download size={15} />
                                    缓存本章
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      const k = list.find((k) => k.audio_path);
                                      if (k) {
                                        void player.start(k, list);
                                        go("player");
                                      } else report("本章仅提供阅读");
                                    }}
                                  >
                                    <Play size={15} />
                                    连续听
                                  </button>
                                </div>
                              </div>
                              {list.map(row)}
                            </div>
                          );
                        })}
                      </section>
                    ))
                  ) : (
                    <div className="empty">
                      <Search />
                      没有匹配的知识点
                    </div>
                  );
                })()}
              </>
            )}
            {page === "review" && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">SPACED REPETITION</p>
                    <h1>今日，回想一下。</h1>
                    <p className="subtitle">
                      到期优先 · 自评只决定下次复习时间
                    </p>
                  </div>
                  <div className="count-label">
                    {queue.length}
                    <small>待复习</small>
                  </div>
                </div>
                <div className="tabs">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    全部
                  </button>
                  {subjects.map((s) => (
                    <button
                      key={s.id}
                      className={filter === s.id ? "active" : ""}
                      onClick={() => setFilter(s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                {(() => {
                  const list = queue.filter(
                    (k) => filter === "all" || k.subject === filter,
                  );
                  return list.length ? (
                    <>
                      <button
                        className="primary large"
                        onClick={() => open(list[0], true)}
                      >
                        开始回想 <ArrowUpRight size={18} />
                      </button>
                      <div className="panel review-list">
                        {list.map((k) => (
                          <div
                            key={k.key}
                            onClick={() => {
                              setSelected(k.key);
                              setReviewMode(true);
                            }}
                          >
                            {row(k)}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty">
                      <CheckCircle2 />
                      这一组已没有待复习内容
                      <p>也可以随时回到四科目录自由听读。</p>
                    </div>
                  );
                })()}
              </>
            )}
            {page === "read" &&
              (current ? (
                <>
                  <button
                    className="back"
                    onClick={() => go(reviewMode ? "review" : "subject")}
                  >
                    <ArrowLeft size={17} />
                    {reviewMode ? "今日复习" : current.module_title}
                  </button>
                  <div className="reading-header">
                    <p className="eyebrow">
                      {subjects.find((s) => s.id === current.subject)!.name} /{" "}
                      {current.chapter}
                    </p>
                    <h1>{current.title}</h1>
                    <div className="reading-meta">
                      <span>{current.knowledge_id}</span>
                      <span>
                        {current.namespace === "demo"
                          ? "虚拟演示"
                          : "已学内容派生资料"}
                      </span>
                      <span>修订 {current.learning_revision}</span>
                    </div>
                  </div>
                  {reviewMap.get(current.key) &&
                    reviewMap.get(current.key)!.revision !==
                      current.learning_revision && (
                      <div className="notice">
                        内容有实质修改，请重新学习后自评。以往记录仍保留。
                      </div>
                    )}
                  <div className="reading-actions">
                    <button
                      className="primary"
                      disabled={!current.audio_path}
                      onClick={() => listen(current)}
                    >
                      <Headphones size={17} />
                      {current.audio_path ? "收听本节" : "仅阅读"}
                    </button>
                    {current.audio_path && (
                      <button
                        className="secondary"
                        disabled={busy || cached.has(audioKey(current))}
                        onClick={() =>
                          locked(async () => {
                            await download(current);
                            report("音频已下载");
                          })
                        }
                      >
                        {cached.has(audioKey(current)) ? (
                          <Check size={16} />
                        ) : (
                          <Download size={16} />
                        )}{" "}
                        {cached.has(audioKey(current)) ? "已下载" : "下载音频"}
                      </button>
                    )}
                  </div>
                  <article className="markdown panel">
                    <Markdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[
                        [rehypeKatex, { strict: false, trust: false }],
                      ]}
                      components={{
                        img: () => null,
                        a: ({ children, href }) =>
                          /^https?:\/\//.test(href || "") ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          ) : (
                            <span>{children}</span>
                          ),
                      }}
                    >
                      {current.reading}
                    </Markdown>
                  </article>
                  {current.source_note && (
                    <p className="source-note">来源：{current.source_note}</p>
                  )}
                  <section className="rating-panel">
                    <p>
                      刚才的内容，你还记得吗？
                      <small>自评认识 ≠ 考试式独立掌握</small>
                    </p>
                    <div>
                      <button
                        className="again"
                        disabled={rating}
                        onClick={() => void reviewRate(1)}
                      >
                        <RotateCcw size={18} />
                        <span>
                          忘了<small>尽快再复习</small>
                        </span>
                      </button>
                      <button
                        className="good"
                        disabled={rating}
                        onClick={() => void reviewRate(3)}
                      >
                        <Check size={20} />
                        <span>
                          认识<small>适当延长间隔</small>
                        </span>
                      </button>
                    </div>
                    {reviewMap.get(current.key) && (
                      <small className="next-date">
                        下次复习：
                        {dateText(reviewMap.get(current.key)!.card.due)}
                      </small>
                    )}
                    {reviewMode && (
                      <button
                        className="text-button next-review"
                        onClick={() => {
                          const next = queue.find((k) => k.key !== current.key);
                          if (next) open(next, true);
                          else go("review");
                        }}
                      >
                        下一个知识点 <ChevronRight size={16} />
                      </button>
                    )}
                  </section>
                </>
              ) : (
                <div className="empty">
                  请先从资料目录选择一个知识点
                  <button className="primary" onClick={() => go("home")}>
                    返回首页
                  </button>
                </div>
              ))}
            {page === "player" && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">TAKE KNOWLEDGE WITH YOU</p>
                    <h1>随身听</h1>
                    <p className="subtitle">让熟悉的知识，在耳边再经过一次。</p>
                  </div>
                </div>
                {player.current ? (
                  <section className="player-panel panel">
                    <div className="album-art">
                      <Headphones size={86} />
                      <span>
                        {
                          subjects.find(
                            (s) => s.id === player.current?.subject,
                          )!.name
                        }
                      </span>
                      <div className="album-lines" />
                    </div>
                    <p className="eyebrow">{player.current.chapter}</p>
                    <h2>{player.current.title}</h2>
                    <p className="subtle">
                      {cached.has(audioKey(player.current))
                        ? "音频已下载 · 可离线播放"
                        : "正在获取音频"}
                    </p>
                    <input
                      className="seek"
                      aria-label="播放进度"
                      type="range"
                      min="0"
                      max={
                        Number.isFinite(player.duration) ? player.duration : 0
                      }
                      step="0.1"
                      value={Math.min(player.time, player.duration || 0)}
                      onChange={(e) => player.seek(Number(e.target.value))}
                    />
                    <div className="time-labels">
                      <span>{clock(player.time)}</span>
                      <span>{clock(player.duration)}</span>
                    </div>
                    <div className="transport">
                      <button
                        aria-label="上一知识点"
                        onClick={() => player.skip(-1)}
                      >
                        <SkipBack size={24} />
                      </button>
                      <button
                        className="play-main"
                        disabled={player.loading}
                        aria-label={player.playing ? "暂停" : "播放"}
                        onClick={player.toggle}
                      >
                        {player.loading ? (
                          <RefreshCw className="spin" />
                        ) : player.playing ? (
                          <Pause size={30} />
                        ) : (
                          <Play size={30} />
                        )}
                      </button>
                      <button
                        aria-label="下一知识点"
                        onClick={() => player.skip(1)}
                      >
                        <SkipForward size={24} />
                      </button>
                    </div>
                    <div className="player-tools">
                      <label>
                        <Volume2 size={16} />
                        <select
                          aria-label="播放速度"
                          value={player.speed}
                          onChange={(e) =>
                            player.changeSpeed(Number(e.target.value))
                          }
                        >
                          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => (
                            <option key={v} value={v}>
                              {v}×
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="text-button"
                        onClick={() => open(player.current!)}
                      >
                        <BookOpen size={16} />
                        阅读正文
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          locked(async () => {
                            const list = chapterOf(player.current!);
                            for (const k of list.filter((k) => k.audio_path))
                              await download(k);
                            report("本章已缓存");
                          })
                        }
                      >
                        <Download size={16} />
                        缓存本章
                      </button>
                    </div>
                    <div className="ios-note">
                      首次请手动点击播放。锁屏、耳机控制及跨文件连续播放仍需
                      iPhone 真机验证。播放完成不会自动记录“认识”。
                    </div>
                  </section>
                ) : (
                  <div className="empty">
                    <Headphones size={40} />
                    <h2>选一段知识，带着走</h2>
                    <p>从四科目录打开知识点，点击“收听本节”。</p>
                    <button className="primary" onClick={() => go("home")}>
                      浏览四科 <ArrowUpRight size={17} />
                    </button>
                  </div>
                )}
                {player.current && (
                  <div className="module">
                    <h2>本章播放列表</h2>
                    <section className="panel">
                      {chapterOf(player.current)
                        .filter((k) => k.audio_path)
                        .map((k) => (
                          <button
                            key={k.key}
                            className="knowledge-row"
                            onClick={() => void player.start(k, chapterOf(k))}
                          >
                            <span className="row-icon">
                              {k.key === player.current?.key ? (
                                <Volume2 size={19} />
                              ) : (
                                <Play size={17} />
                              )}
                            </span>
                            <span className="row-copy">
                              <strong>{k.title}</strong>
                              <small>
                                {cached.has(audioKey(k)) ? "已下载" : "未下载"}
                              </small>
                            </span>
                          </button>
                        ))}
                    </section>
                  </div>
                )}
              </>
            )}
            {page === "settings" && (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">YOUR PERSONAL SPACE</p>
                    <h1>设置</h1>
                    <p className="subtitle">
                      资料从私人仓库来，复习记录留在本机。
                    </p>
                  </div>
                </div>
                <section className="panel settings-panel">
                  <h2>
                    <Cloud size={20} />
                    GitHub 私人仓库
                  </h2>
                  <div className="form-grid">
                    {[
                      ["owner", "GitHub 用户或组织", "例如 your-name"],
                      ["repo", "资料仓库名称", "例如 study-content"],
                      ["branch", "分支", "main"],
                      ["manifest_path", "索引路径", "manifest.json"],
                    ].map(([k, n, p]) => (
                      <label key={k}>
                        {n}
                        <input
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          value={String(config[k as keyof Config])}
                          placeholder={p}
                          onChange={(e) =>
                            setConfig({ ...config, [k]: e.target.value.trim() })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label className="token-label">
                    Fine-grained Token
                    <input
                      aria-label="GitHub 只读令牌"
                      type="password"
                      autoComplete="off"
                      placeholder="仅限本仓库 · Contents: Read-only"
                      value={token}
                      onChange={(e) => setToken(e.target.value.trim())}
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={config.rememberToken}
                      onChange={(e) => {
                        const remember = e.target.checked;
                        setConfig({ ...config, rememberToken: remember });
                        if (!remember) void putSetting("token", "");
                      }}
                    />
                    在本机保存令牌（默认仅在本次打开期间使用）
                  </label>
                  <p className="help">
                    保存的令牌未加密，同源脚本及能访问本设备的人可能读取。只授权一个私人仓库的
                    Contents 读取权限。请勿在聊天中发送令牌。
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={config.checkOnOpen}
                      onChange={(e) =>
                        setConfig({ ...config, checkOnOpen: e.target.checked })
                      }
                    />
                    打开时检查资料版本（不自动下载）
                  </label>
                  <div className="button-row">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => locked(saveConfig)}
                    >
                      保存设置
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={synchronize}
                    >
                      <RefreshCw size={16} className={busy ? "spin" : ""} />
                      同步资料
                    </button>
                    <button
                      className="text-button danger-text"
                      onClick={() =>
                        locked(async () => {
                          setToken("");
                          setConfig({ ...config, rememberToken: false });
                          await putSetting("token", "");
                          await putSetting("config", {
                            ...config,
                            rememberToken: false,
                          });
                          report(
                            "本机令牌已清除；如需撤销访问，请在 GitHub 中撤销该令牌",
                          );
                        })
                      }
                    >
                      清除令牌
                    </button>
                  </div>
                  <p className="help" role="status">
                    {syncInfo}
                  </p>
                  <label>
                    当前资料空间
                    <select
                      value={namespace}
                      onChange={(e) => {
                        setNamespace(e.target.value);
                        void putSetting("namespace", e.target.value);
                        player.playing && player.toggle();
                      }}
                    >
                      {[
                        ...new Set(["demo", ...items.map((k) => k.namespace)]),
                      ].map((ns) => (
                        <option key={ns} value={ns}>
                          {ns === "demo" ? "演示资料（虚拟）" : ns}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                <section className="panel settings-panel">
                  <h2>
                    <FileDown size={20} />
                    备份与本地存储
                  </h2>
                  <p>
                    iOS 可能清理 PWA 的本地存储。建议每周导出一次备份，保存到
                    iCloud Drive；更新、换机或清理 Safari 数据前再备份一次。
                  </p>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={backup}
                    >
                      <FileDown size={17} />
                      导出 JSON 备份
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => file.current?.click()}
                    >
                      <Upload size={17} />
                      恢复备份
                    </button>
                  </div>
                  <input
                    ref={file}
                    hidden
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        locked(async () => {
                          if (f.size > 50000000)
                            throw Error("备份超过 50 MB，请检查文件");
                          await restoreBackup(JSON.parse(await f.text()));
                          await refresh();
                          report("备份已合并恢复，较新的本地记录保留");
                        });
                      e.target.value = "";
                    }}
                  />
                  <p className="help">
                    备份包括阅读资料、复习历史和播放位置，不含令牌及
                    MP3。恢复按时间合并；音频可重新下载。
                  </p>
                  <div className="settings-divider" />
                  <div className="cache-line">
                    <span>
                      <strong>{cached.size}</strong> 份已下载音频
                    </span>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        locked(async () => {
                          player.playing && player.toggle();
                          const db = await database();
                          await db.clear("audio");
                          await refresh();
                          report("音频缓存已清除，阅读和复习记录保留");
                        })
                      }
                    >
                      清理音频缓存
                    </button>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      locked(async () => {
                        const ok = await navigator.storage?.persist?.();
                        const usage = await navigator.storage?.estimate?.();
                        report(
                          `${ok ? "已获得持久存储许可" : "系统未保证持久存储，请继续定期备份"}${usage?.usage ? ` · 已用约 ${(usage.usage / 1048576).toFixed(1)} MB` : ""}`,
                        );
                      })
                    }
                  >
                    请求持久存储 / 查看用量 <ArrowUpRight size={15} />
                  </button>
                </section>
                <section className="panel settings-panel">
                  <h2>
                    <ShieldCheck size={20} />
                    使用边界
                  </h2>
                  <p>
                    本工具只保存从已学内容派生的资料，不修改《考研总控模型》，不推进四科教学游标。自评“认识”只用于
                    FSRS 排程，不能作为考试式独立掌握的证据。
                  </p>
                  <p>
                    添加到 iPhone：在 Safari 打开部署网址，点击分享 →
                    添加到主屏幕。先在线打开一次，再缓存需要的章节。离线时使用主屏幕图标进入。
                  </p>
                  <p>
                    锁屏和耳机媒体控制已接入浏览器
                    API，但连续播放效果需要真机确认。若跨文件切换不稳定，使用发布工具合并章节音频。
                  </p>
                  <label>
                    外观
                    <select
                      value={theme}
                      onChange={(e) => {
                        setTheme(e.target.value);
                        void putSetting("theme", e.target.value);
                      }}
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </label>
                  <small className="help">
                    随身听 v0.1 · 数据结构 v1 · 本地优先
                  </small>
                </section>
              </>
            )}
          </div>
        )}
        <footer className="footer">
          <span>
            <Leaf size={14} />
            学习是一个慢慢熟悉的过程
          </span>
          <span>随身听 · 个人考研知识库</span>
        </footer>
      </main>
      {player.current && page !== "player" && (
        <div className="mini-player">
          <button className="mini-title" onClick={() => go("player")}>
            <Headphones size={20} />
            <span>
              {player.current.title}
              <small>
                {player.playing ? "正在收听" : "继续收听"} ·{" "}
                {clock(player.time)}
              </small>
            </span>
          </button>
          <button
            aria-label={player.playing ? "暂停音频" : "继续音频"}
            disabled={player.loading}
            onClick={player.toggle}
          >
            {player.playing ? <Pause size={21} /> : <Play size={21} />}
          </button>
          <button aria-label="下一条音频" onClick={() => player.skip(1)}>
            <SkipForward size={20} />
          </button>
        </div>
      )}
      <nav className="bottom-nav">
        {nav.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "chosen" : ""}
            onClick={() => {
              if (n.id === "review") setFilter("all");
              go(n.id);
            }}
          >
            <n.icon size={22} />
            <span>{n.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
