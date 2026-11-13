# Codex / Muse / Rei 共用的卡片发布协议

适用于同一个私人卡库的所有发布端。手机接受四科资料；本机自动导出的启用科目仍由私人配置控制，本次不改变教学开关、原卡ID、学习主模型或手机历史。

## 四个容易混淆的约定

1. `learning_state` 是简短的来源状态，不是学习日志。若存在，必须非空且不超过160个**UTF-16代码单元**，与JavaScript的`text.length`一致。普通汉字/英文字母通常各算1，常见emoji算2。详细依据放`source_note`，不要静默截断，也不要把状态写成已经掌握。Python发布器在入队前按相同单位检查。
2. `reading_hash` = 正文文件原始字节的SHA-256；`listening_hash`和`audio_hash`各自校验对应文件。正文UTF-8、LF、末尾换行都影响哈希。`content_hash`是**整条记录的版本令牌**，用于变化识别和`expected_content_hash`并发检查。本项目生成的是除`content_hash`自身外整个条目的规范JSON摘要，包含音频/来源/状态等元数据，因此通常不等于`reading_hash`。已发布的旧端条目即使采用正文哈希作为版本令牌也保持兼容，不批量归一化。以后修改任何发布字段都应更新版本令牌。
3. `source_node_id`在手机端是可选字段。存在时必须等于本卡ID，或等于`-K01`（至少两位ASCII数字）子卡的父节点。新建此类子卡时，本机发布器要求明确填写父节点。英语/数学既有非子卡不要求批量补来源，不根据`EN-A`、`EN-G`、`LA-A`等前缀猜造层级。
4. ID在**科目内唯一**，不是跨科全库唯一。稳定身份是`namespace::subject::knowledge_id`。`learning_revision`是正安全整数；仅概念/边界/记忆对象的实质变化才升号，纯排版不升号。升号会要求重学但保留原历史。已有模块ID、已有父节点映射不得改变，修订号不得下降。

文件完整性以对应的`*_hash`和实际字节比对为准，不能单靠文件名，也不能把`content_hash`当文件哈希。工具生成的`assets/ab/<sha>.md`只是内容寻址布局，手机也允许其他安全相对路径。

`manifest.revision`是整份清单的版本标识，本机生成方式为按固定顺序排列后的`items`规范JSON摘要，不是Git提交SHA。手机当前检查其64位小写hex格式，但不重新计算整份JSON的规范摘要；不要以此冒充已经验证了整库文件。一次同步通过固定Git提交SHA读取所有资源，并单独检查正文哈希。

## 推荐：文字差量交给统一发布器

能够访问本项目目录的发布端使用`publisher.ps1 submit`，只提交本科本批次JSON，不自己覆盖`manifest.json`。MP3走现有Python TTS + 普通Git提交，Git支持二进制；不把MP3转成UTF-8文本去调用文本上传工具。没有二进制上传能力的外部会话只交付听觉文本，由统一发布器合成和上传。资料留在私人仓库。

本地队列的锁只保护同一台电脑。独立电脑、浏览器上传或API发布端**不会**受本地锁保护。新增的远端发布检查会在推送前fetch，比较本次声明范围之外的条目是否有任何变化、修订号是否回退、原条目是否消失。发现冲突保留批次、暂存音频和事务，不强推、不自动改写Git历史。

## 外部发布端必须遵守的步骤

1. 每次开始都获取私人仓库当前main提交SHA，按这个SHA读取清单，保存为`base.json`。仅“先前拉过最新”不够。
2. 事先列出本次允许修改的`subject:knowledge_id`，例如`english:EN-DEMO-01`。在此基线上按稳定ID局部修改；其他条目连同未知字段、音频引用、修订号和归档状态原样保留。
3. 生成新资源及`candidate.json`。既有条目必须核对本次基线的`content_hash`；不要拿旧stage的整份清单替换新清单。归档/删除保留tombstone，不直接从数组移除旧卡。
4. 发布前运行下面的只读检查。校验失败不能上传清单，不能靠删字段、降修订号或批量覆盖哈希绕过。
5. 用**以第1步SHA为父提交**的新提交配合普通非强制push，或等价的远端条件更新。基线之后如果另一端提交，拒绝后重新获取基线、合并本科差量、重新检查；不要把旧candidate重新挂到新的父提交来躲避冲突。
6. 推送成功后按返回提交SHA再读清单及本次资源核对，才能报告已发布。单纯重新打开手机不会下载新卡，仍需点击同步资料。

非强制分支更新只允许快进，见[GitHub引用更新说明](https://docs.github.com/en/rest/git/refs#update-a-reference)。**快进保护不能识别“新父提交装着旧清单”这种逻辑覆盖**，因此还必须做第2—4步的变更范围检查。没有父提交/预期版本控制能力的上传工具，不能独立负责覆盖主清单，应转交统一发布器。

## 可执行的只读预检

在本项目目录运行，不需要配置文件、TTS、Git登录或写入权限：

```powershell
.\tools\publisher.ps1 check-manifest .local\candidate.json

.\tools\publisher.ps1 check-manifest .local\candidate.json `
  --base .local\base.json `
  --change english:EN-DEMO-01 `
  --root .local\candidate-content
```

`--root`目录应包含整份清单引用的资源，包括未修改的旧资源；可以省略它只检查结构与清单差量。多张卡重复传`--change`。`valid:true`才表示检查通过；`verified_assets:null`表示没有检查资源字节，不等于资源已完整。`changed`列出实际变更ID。

其他Python环境可直接运行：

```text
python tools/content_contract.py candidate.json --base base.json --change english:EN-DEMO-01 --root candidate-content
```

检查器仅使用Python标准库。它是离线预检，**不是远端锁，也不会替上传工具自动执行条件提交**。非本机发布端若无法运行，应按此协议实现等价检查或把差量交给统一发布器，不能假称受到保护。

Python与手机共用`tests/fixtures/manifest-validation-cases.json`边界样例，防止两端再次对长度、父节点或类型产生不同解释。作业JSON Schema里的`maxLength`按Unicode字符定义，只做基础校验，不能替代这里的UTF-16语义与跨字段检查。
