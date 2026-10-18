# 给四科 Codex 会话的资料发布提示词

下面整段复制给政治、英语二、数学二、838 环境学会话即可。第一次告诉会话本软件的项目目录，或设置 `STUDY_APP_DIR`、`STUDY_PUBLISH_CONFIG`；以后沿用同一配置。

---

请继续按最新《考研总控模型.md》推进本科目，教学主线、游标和证据仍只在原主文件局部维护。软件只是派生听读工具，不能成为第二套长期学习记录，也不能把手机自评“认识”写成独立掌握证据。

每次完成实际教学后，从本次已讲且经过核对的内容中，挑选少量可独立理解的小单元发布到“随身听”。先阅读软件项目的 `docs/PUBLISHING.md` 和现有私人仓库 manifest；沿用原 `module_id` 与 `knowledge_id`，每节点只保留一个条目，不重编号、不批量导出历史、不导入原掌握度。只讲过部分的节点仅导出该部分并注明。

请在软件项目的 `.local/` 或既定私人目录中建立唯一文件名的 v1 JSON 作业：subject、module_id、module_title、chapter、knowledge_id、title、reading_content、listening_content、source_note、confirmed_learned:true、change、order。更新旧条目必须提供最新 manifest 的 expected_content_hash；正文或概念发生实质修改用 change:substantive，否则 minor。来源只定位已讲记录，不复制我的答题、学习游标、完整主模型或其他隐私。

阅读版用准确的 Markdown 和 LaTeX，保留条件与易混边界；听觉版根据阅读版改写为自然纯文本，人工处理公式、表格和衔接，不机械去除 Markdown 后朗读。数学推导不适合听就留空。英语保留现有扇贝体系，不另建庞大词库。不得生成问答卡、测试卷或未讲过的考点。

完成作业后，调用软件项目的 `tools/publisher.ps1 enqueue <作业路径>`，将材料送入统一队列。不直接改 assets 或 manifest，不同时运行多个处理器，不自行 force push。若已配置唯一发布进程且已有用户推送授权，可按既定方式触发 `process --push`；否则只入队并简短报告“已入队 N 条，待统一发布”，不重复申请已有授权。

同节点内容冲突时，重新读取当前版本，合并这一个节点后重新入队；保护其他科目。缺少软件目录、私人仓库配置或推送授权时，先完成不依赖它们的教学与派生作业，说明具体缺项。手机自评记录可单独导出供查阅，不能自动覆盖主模型证据。

---
