# 随身听 · 小查小查的考研听读 PWA

一个本地优先的个人听读工具。四科目录、Markdown / LaTeX 阅读、真实 MP3、章节连续播放、离线下载，以及 FSRS 的“忘了 / 认识”两级自评。**不会读取、修改或替代《考研总控模型》**，也不会把自评写成独立掌握证据。

第一版已部署：[打开随身听](https://xiaochaxiaocha9-ux.github.io/xiaochaxiaocha-app/)。iPhone 锁屏、耳机控制及后台跨文件连续播放需要按真机清单验收，不能用桌面浏览器结果代替。

## Windows 开始使用

需要 Node.js 22.12+、Git；发布端需要 Python 3.11+。项目内附有虚拟演示资料和四段真实 MP3，无需令牌即可试用。

```powershell
npm ci
npm run dev
```

打开终端显示的本地地址。生产版离线能力通过构建后的 Service Worker 提供，开发模式不启用离线壳缓存。

```powershell
npm test
python -m unittest discover -s tools -p "test_*.py" -v
npm run build
npm run preview
```

构建结果在 `dist/`。预览服务默认只监听本机。手机正式使用 HTTPS Pages 网址；iPhone 的 localhost 指向手机自身。

## 两个仓库

| 用途           | 建议仓库名           | 可见性 | 内容                                       |
| -------------- | -------------------- | ------ | ------------------------------------------ |
| 小查小查的仓库 | `xiaochaxiaocha-app` | 公开   | 代码、说明、虚拟演示                       |
| 考研复习       | `kaoyan-review`      | 私人   | 已学派生 Markdown、听觉文本、MP3、manifest |

不要把完整总控模型放进任一 App 静态资源目录。私人资料和配置放到项目外，或被忽略的 `.local/`。设置页填写仓库信息及只读 Token；Token 默认只放本次会话内存，可主动选择本机保存并随时清除。

具体操作见 [部署与 iPhone 安装](docs/DEPLOYMENT.md)、[内容发布](docs/PUBLISHING.md)、[给四科会话的提示词](docs/SESSION_PROMPT.md)。

## 架构与目录

```text
src/
  domain.ts           v1 数据契约、稳定 ID、复习队列、验证
  db.ts               IndexedDB：资料 / 复习 / 日志 / 音频 / 位置 / 设置
  review.ts           ts-fsrs；原子写入与防重复评价
  github.ts           固定 commit 的 GitHub 读取、哈希校验、增量合并
  backup.ts           无令牌备份，校验后合并恢复
  player.tsx          单一 Audio 实例、Blob 缓存、Media Session
  App.tsx             六个主要界面
  demo.ts             明确标注的虚拟演示
tools/
  publish.py          入队、独占处理、TTS、内容寻址资源、可选 Git 推送
  publisher.ps1       Windows 调用入口，可配置 Python 与配置文件
  test_publish.py     发布、冲突和 ID 稳定性测试
public/               仅图标和虚拟演示 MP3
.github/workflows/    测试、构建、Pages 部署
.local/               私人运行数据（不进 Git / dist）
```

没有业务服务器、在线用户数据库或手机反向写 GitHub。网页中不使用实时 speechSynthesis；真实资料下载并校验后写入 IndexedDB，播放器使用本地 Blob URL。PWA 只预缓存公开应用壳及演示音频，不缓存带授权头的 API 响应。

## 数据与维护规则

- 主模型是唯一学习依据。派生文件可重建，不记录教学游标或“掌握率”。
- 主键是 `namespace::subject::knowledge_id`。科目名解决数学与英语相同编号冲突；仓库及 manifest 路径构成 namespace。更换仓库路径相当于新空间，不会自动转移历史。
- 修改正文沿用 ID。普通补充保留排程；实质修改增加 `learning_revision`，提示重新学习，下次自评从新卡排程开始，旧事件仍保留。
- 同步先下载全部变更正文、校验哈希，最后一次事务提交；失败不覆盖旧资料。归档、删除及索引中移除只隐藏资料，保留本机复习历史。删除是软删除，不清理 Git 历史或旧资源。
- TTS 仅生成明确撰写的听觉文本。复杂公式与推导可以只读。Edge 服务会接收听觉文本，失败最多重试三次；可替换为本地命令适配器。
- 两个评价固定对应 Again / Good。阅读、播放或下载完成都不自动评价。FSRS 初期 Good 也可能安排在数分钟后，这是学习阶段排程。
- 备份不含 Token 和 MP3；恢复只增加缺失资料、保留时间更新的记录、按事件 ID 去重。音频可重新下载。定期把 JSON 存到“文件”或 iCloud Drive。
- iOS 可能清理本地存储。持久存储请求不是系统绝不清理的承诺。换机、清除 Safari 数据、切换部署域名或主路径前必须备份。
- Schema 升级需要显式迁移；不得直接删库重建。未来跨设备同步以事件 ID 为去重依据，不能用整库覆盖。
- 私人仓库同步的 404 可能代表资源不存在，也可能是仓库未授权；GitHub 不总能将两者区分。403 / 429 提示权限或速率限制，401 提示令牌失效。

[验证记录与限制](docs/VALIDATION.md)包含实际检查和未验项目。后续维护先运行适合修改范围的测试，保留 `package-lock.json`；新增依赖、改变同步权限或接入新 TTS 前说明原因。
