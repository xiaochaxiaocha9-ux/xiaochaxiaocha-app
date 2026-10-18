# GitHub Pages 与 iPhone

本次实际部署地址：[随身听](https://xiaochaxiaocha9-ux.github.io/xiaochaxiaocha-app/)。账号为 `xiaochaxiaocha9-ux`，公开 App 仓库 `xiaochaxiaocha-app`，私人资料仓库 `kaoyan-review`，分支均为 `main`，索引路径 `manifest.json`。以下通用说明也适用于迁移到其他账号。

## 首次部署

1. 用现有 GitHub 账号新建 `xiaochaxiaocha-app`，设为 **Public**，不要上传任何私人资料。描述可以填“小查小查的仓库”。新建 `kaoyan-review`，设为 **Private**，描述“考研复习”。仓库 URL 名只能用 ASCII 字母、数字、`.`、`-`、`_`；中文可以用作说明与应用标题。
2. App 仓库的 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 本地项目已包含 `.github/workflows/pages.yml`。审核待提交文件，确认 `.local/`、`.env`、令牌和主模型未列入，再首次上传。

```powershell
git init -b main
git add .
git diff --cached --stat
git commit -m "Build personal study listening PWA"
git remote add origin https://github.com/YOUR_LOGIN/xiaochaxiaocha-app.git
git push -u origin main
```

登录与推送使用 Git Credential Manager。不要把 Token 嵌入 remote URL，不要把令牌发给其他会话。已有 remote 时不重复添加。

4. Actions 中 `Test and deploy Pages` 应成功完成测试、构建、部署。生产网址通常为 `https://YOUR_LOGIN.github.io/xiaochaxiaocha-app/`，以 Pages 实际返回为准。
5. 工作流根据仓库名设置 `BASE_PATH`，支持 Pages 子目录部署。若使用自定义域名或 `YOUR_LOGIN.github.io` 根仓库，改为 `BASE_PATH: /` 后重新构建。改变路径可能改变本地资料空间，事先导出备份。

手动构建同一子目录（Windows PowerShell）：

```powershell
$env:BASE_PATH='/xiaochaxiaocha-app/'
npm run build
Remove-Item Env:BASE_PATH
```

公开页面只交付 App 壳和虚拟资料。私人内容不会经 Actions 进入构建，也不需要把私人 Token 写成仓库 Secret。

## 私人内容与手机令牌

1. 在私人仓库初始化一个 README 或通过 Git 首次推送，确保存在 `main` 分支。
2. 按 [发布说明](PUBLISHING.md) 将私人仓库克隆到单独目录，生成并发布 `manifest.json` 和 `assets/`。
3. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。选择自己的 Resource owner、设置到期日，Repository access 只选 `kaoyan-review`。Repository permissions 仅 **Contents: Read-only**（Metadata 的基础读取可能由 GitHub 自动附带）。
4. 在手机 PWA 设置页填账号、`kaoyan-review`、`main`、`manifest.json`，再手动输入 Token。默认不勾选“在本机保存令牌”，点击“同步资料”。
5. 持久保存是方便选项，IndexedDB 中的 Token 没有额外加密，同源脚本和设备访问者可能读取。丢失手机时在 GitHub 撤销 Token。“清除令牌”只清本机，不替代 GitHub 撤销。

私人内容的单个文件不超过 100 MB。建议每个知识点音频几分钟以内，章节合并也控制大小；不要用 Git LFS 指针替代 MP3，前端没有 LFS 下载实现。

## iPhone 安装与备份

1. 用 **Safari** 打开已部署的 HTTPS 网址，等待首页与演示资料加载。
2. 分享 → 添加到主屏幕；若系统显示“作为 Web App 打开”，保持开启。名称可设为“小查小查”或“随身听”。
3. 从主屏幕图标进入，配置私人仓库并同步。进入科目章节，点击“缓存本章”，确认音频有“已下载”标记。
4. 正常播放需要先手动点击。锁屏后测试暂停、恢复、下一首与自动跨文件切换。
5. 每周在设置中“导出 JSON 备份”，把文件保存到 iCloud Drive。换机或清理数据前再次导出。新设备同步资料后“恢复备份”；音频重新缓存。

Safari 标签页与主屏幕 Web App 的存储行为可能因系统版本、安装方式而异。以最终从主屏幕打开的实例作为日常使用和备份入口，不假定两个入口永远共用同一个本地数据库。

## 真机验收清单

记录 iPhone 型号、iOS 版本、网络、耳机类型和结果；下列项目尚不能由 Windows 证明。

| 检查     | 操作                             | 通过标准                           |
| -------- | -------------------------------- | ---------------------------------- |
| 单段锁屏 | 开始播放后锁屏 5 分钟            | 音频持续、进度可恢复               |
| 连续播放 | 缓存政治演示两段，接近结尾后锁屏 | 第二段自动开始，无需解锁           |
| 耳机     | 耳机按钮暂停，再恢复             | 状态与声音一致                     |
| 控制中心 | 暂停 / 恢复 / 前后切换           | 标题、位置和曲目一致               |
| 飞行模式 | 缓存后退出再打开主屏幕 App       | 可阅读、可播已下载音频             |
| 系统打断 | 来电或其他音频中断后返回         | 点击可恢复，不自动记“认识”         |
| 内容更新 | 同 ID 增量同步                   | 复习记录保留，实质变更提示重新学习 |
| 备份     | 导出、另一个浏览器实例恢复       | 日期、历史和播放位置恢复           |

跨文件后台播放失败时，发布工具可生成章节 MP3 与 cue JSON，用系统播放器对比验证。**本版章节合并结果尚未自动接入 PWA 的时间偏移导航**；真机确认需要后再扩展，不宣称已有原生播放器的后台可靠性。

参考：[Apple 主屏幕 Web App](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iph42ab2f3a7/ios)、[GitHub Contents API 与权限](https://docs.github.com/en/rest/repos/contents#get-repository-content)、[仓库命名](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)、[Vite PWA](https://vite-pwa-org.netlify.app/guide/)。
