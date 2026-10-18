# 四科统一发布

这条链路只处理已确认学过的派生资料，不解析或写回长期主模型。

## 配置一次

四个会话共用 **同一份队列与私人仓库工作副本**，每个会话只提交唯一 JSON 作业。只有一个处理进程生成 MP3、更新索引与执行 Git。不同 Windows 电脑不能靠本地锁协调，需统一在同一台发布电脑处理。

```powershell
New-Item -ItemType Directory -Force .local
Copy-Item tools/publisher.config.example.json .local/publisher.config.json
git clone https://github.com/YOUR_LOGIN/kaoyan-review.git .local/content-repo
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r tools/requirements.txt
```

配置文件中的路径相对**配置文件所在目录**解析。因此示例配置的 `content-repo` 和 `publish-queue` 都位于 `.local/`。也可配置为项目外的绝对路径。不要让私人仓库位于 `public/`、`src/` 等公开目录。先保留 `allow_push: false`，本地检查完成并获得用户授权后才设置为 `true`。

```powershell
.\tools\publisher.ps1 init
.\tools\publisher.ps1 enqueue .local\draft-unique-id.json
.\tools\publisher.ps1 process
```

`publisher.ps1` 优先使用 `STUDY_PYTHON`，其次项目虚拟环境，再尝试系统 Python 与可用的 Codex 运行时。可以用 `STUDY_PUBLISH_CONFIG` 指定配置文件。脚本兼容本项目当前机器通过 `.local/python-packages` 隔离安装的依赖；普通电脑建议使用 venv。

## 作业结构 v1

`examples/knowledge.example.json` 是可复制的虚拟示例。每个小单元一个作业，阅读版 Markdown 与听觉版纯文本明确分别编写。

| 字段                      | 规则                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `schema_version`          | 固定 1                                                           |
| `subject`                 | politics / english / math / environment                          |
| `module_id`               | 沿用主模型原模块 ID，不重新编号                                  |
| `module_title`, `chapter` | 浏览分组名称，允许补充说明                                       |
| `knowledge_id`            | 原节点 ID，科目内唯一、长期稳定                                  |
| `title`                   | 当前派生内容的清晰标题                                           |
| `reading_content`         | 小型 Markdown，可用 `$...$` 和 `$$...$$`                         |
| `listening_content`       | 适合连续收听的纯文本；不适合听则留空                             |
| `confirmed_learned`       | 必须为 true；由教学会话依据实际已讲内容确认，不代表掌握          |
| `source_note`             | 主模型章节 / 节点 / 教学记录定位，不包含用户个人答题或私密信息   |
| `change`                  | minor 普通补充、排版；substantive 实质修正或边界改变             |
| `expected_content_hash`   | 新条目省略；修改、归档、删除必须抄取最新 manifest 中的旧 hash    |
| `operation`               | 默认 upsert；另支持 archive / delete                             |
| `order`                   | 科目内排序数字                                                   |
| `tts`                     | 可选，只能覆盖 `voice` 与 `rate`；引擎命令只允许可信本地配置指定 |

原模型不同科目可以都有 `1.1.1`，前端会按科目隔离。一个原节点只保留一个发布条目；补充内容合并到该条目的正文。需要真正拆为多个独立单元时先制定并保留原 ID 映射，不能随意加编号假装原模型已有。

初次发布不读取主模型的掌握证据，所有手机卡片都从“尚未复习”开始。原节点只讲过部分时，只导出实际讲过的部分，在来源中注明范围，不能把整章或未教内容塞入该条。

## 自动生成物

私人仓库布局：

```text
manifest.json
assets/ab/<完整sha256>.md
assets/cd/<完整sha256>.txt
assets/ef/<完整sha256>.mp3
```

正文与听觉文本规范换行为 LF，正文末尾保留换行。生成的索引为 v1，包含所有浏览字段、reading/listening/audio 路径及各自 SHA-256、`content_hash`、`learning_revision` 和 `status`。`revision` 是排序后的索引条目摘要。资源内容寻址，未变更的资源不重写；听觉文本与 TTS 设置未变就复用原 MP3。

`applied_jobs` 保留已处理作业 ID，防止程序在写索引后意外退出导致重放。索引最后写入，四个会话不得自己编辑索引或资源文件。

## 推送与并发

用户授权私人仓库推送后，在配置中设 `allow_push: true`。私人仓库已有上游与 Git Credential Manager 登录时运行：

```powershell
.\tools\publisher.ps1 process --push
```

此命令持有唯一锁，先检查干净工作副本与 `git pull --ff-only`，再处理队列、提交生成物并普通 push。不会使用 force，也不会自动 rebase 或覆盖冲突。

若已经执行过不带 `--push` 的本地生成，工作副本会有未提交变更。先检查并提交生成物，然后再次执行 `process --push`，不要删文件来绕过工作区检查：

```powershell
git -C .local/content-repo status
git -C .local/content-repo add manifest.json assets
git -C .local/content-repo commit -m "Publish reviewed derived materials"
.\tools\publisher.ps1 process --push
```

四个会话的并发保护有两层：独占 worker.lock 避免同时写 Git；`expected_content_hash` 避免两个会话先后覆盖同一知识点的旧版本。冲突会停止队列并保留作业。重新读取最新条目，人工合并该节点，移走旧 pending 作业并重新入队，不能简单替换 hash 来强行接受旧内容。

进程异常退出留下锁时，先查看 `worker.lock` 内的 PID，并确认对应进程确实退出后，才手动删除这个锁文件。不要自动超时夺锁。TTS 失败也保留 pending，可换网络重试。若前面已有作业成功而后续作业失败，先审核并提交已生成文件，再重试。

## 修改、归档与删除

- 修改：相同科目、module_id、knowledge_id，带旧 hash 入队。细小排版或补充用 minor；概念纠错、适用范围或记忆对象改变用 substantive。
- 实质修改：revision 自增，手机保留旧历史并要求重新学习；不会继承旧“认识”作为当前掌握。
- 归档：`operation: archive`。从手机可用目录隐藏，记录保留。
- 删除：`operation: delete`。保留 tombstone 和 ID，避免同步误把历史删掉。这不是永久擦除，Git 历史与旧哈希资源仍可能存在。隐私擦除需要单独任务，不自动清理。
- 恢复：以最新 tombstone hash 再次 upsert。原 ID 必须保留。

## TTS 替换与章节合并

默认 Edge TTS 是可用性未经服务级承诺的在线接口。每条最多三次尝试、单次 120 秒超时；失败不发布缺音频条目。没有听觉文本则仅发布阅读，不用浏览器朗读兜底冒充 MP3。

可信配置支持命令适配器：

```json
{
  "tts": {
    "engine": "command",
    "command": ["MY_TRUSTED_TTS_EXECUTABLE", "--output", "{output}"]
  }
}
```

命令接收 UTF-8 文本 stdin，需输出真实 MP3；不经过 shell，不记录命令输出。四科作业不能传命令。

已有 FFmpeg / ffprobe 时，可以生成单章 MP3 + cue JSON 供真机对比：

```powershell
.\tools\publisher.ps1 merge-chapter --subject politics --module POL-1.1 --chapter "章节名称" --output .local\chapter.mp3
```

此工具不改变节点 ID 或复习历史。本版未自动将合并音频接入 PWA 时间偏移播放器，待 iPhone 测试确认需要后扩展。无 FFmpeg 时单节音频与发布功能照常可用。
