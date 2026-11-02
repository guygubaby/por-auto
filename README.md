# por-auto

企业微信自动化，单个 Android APK，装完即用。

## 目录

```
android/    当前交付物：PorAuto APK
admin/      管理台与下载页（React SPA）
updates/    后端 Worker：发版、运行日志、AI 配置、口令（Cloudflare）
docs/       方案与说明文档
archive/    旧栈存档（Go 桌面端 / AutoJs6 / 工作流 Registry），只读保留
```

## 后端

`https://por-auto.guygubaby.top` 一个域名同时提供：

- 下载页与管理台（浏览器打开就是下载页，`/runs` 看运行日志，`/config` 配 AI 与 App 口令）；
- App 检查更新（`/latest`、`/latest.apk`）；
- App 上报运行日志与拉取 AI 配置（`/api/*`，带构建时注入的入网令牌）。

管理员用部署时的口令进入管理台；App 另有一道口令闸门，通过后才会拿到服务端的 AI 配置。
详见 [updates/README.md](updates/README.md)。

## 当前能力（P0–P2）

- **读屏**：无障碍读取企业微信页面，导出 JSON，便于核对控件与资源 ID。
- **群发**：试运行（只写草稿再清理）与正式发送（只点一次、回读气泡、不重发）。
- **定时**：每天固定时间执行一次群发，支持暂停 / 立即运行 / 删除。
- **更新**：设置里检查新版本，下载后交给系统安装。

固定边界：只处理企微「群聊」分类；名单先冻结；标题必须完整；有草稿、标题不符、按钮不唯一都停止；发送结果不明不重发。

## 构建与安装

```sh
cd android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

详见 [android/README.md](android/README.md)。

## 文档

- [Mika 原理与复刻方案](docs/2026-11-01-mika-apk-replication-plan.md)

## 旧栈

`archive/` 里的 Go 桌面端、AutoJs6 手机脚本、工作流 Registry 已冻结，不再更新；
对应的构建脚本、依赖清单也一起归档，需要查历史实现时在这里看。
