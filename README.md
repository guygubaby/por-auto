# por-auto

手机 AI 助手：说一句话，AI 看着当前屏幕一步步操作 App。企业微信群发是内置的一套专用工作流。

## 目录

```
android/    当前交付物：PorAuto APK
admin/      管理台与下载页（React SPA）
updates/    后端 Worker：发版、运行日志（Cloudflare）
docs/       方案与说明文档
archive/    旧栈存档（Go 桌面端 / AutoJs6 / 工作流 Registry），只读保留
```

## 后端

`https://por-auto.guygubaby.top` 一个域名同时提供：

- 下载页与管理台（浏览器打开就是下载页，`/runs` 看运行日志）；
- App 检查更新（`/latest`、`/latest.apk`）；
- App 上报运行日志（`/api/*`，带构建时注入的入网令牌）。

管理员用部署时设置的管理令牌进入管理台。AI 配置只存在 App 本地，在 App 设置页填写和测试。
详见 [updates/README.md](updates/README.md)。

## 当前能力（P0–P2）

- **助手（主功能）**：输入一句目标，AI 读当前屏幕、每一步给出一个动作（点击、长按、输入、滚动、滑动、返回、回桌面、通知栏、打开应用），执行后看结果继续；失败会带着原因换做法，随时可停。
- **读屏**：无障碍读取当前屏幕，助手据此定位控件，不截图、不上传屏幕。
- **群发**：面向企业微信的专用工作流；试运行（只写草稿再清理）与正式发送（只点一次、回读气泡、不重发）。
- **定时**：每天固定时间执行一次群发，支持暂停 / 立即运行 / 删除。
- **更新**：设置里检查新版本，下载后交给系统安装。

固定边界：助手只做前台可见操作，锁屏或切走就停；付款、转账、删除、注销这类不可撤销的操作，目标里没提到就不做。群发只处理企微「群聊」分类；名单先冻结；标题必须完整；有草稿、标题不符、按钮不唯一都停止；发送结果不明不重发。

## 构建与安装

```sh
cd android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

详见 [android/README.md](android/README.md)。

## 文档

- [部署与发版（devops）](devops.md)
- [Mika 原理与复刻方案](docs/2026-11-01-mika-apk-replication-plan.md)

## 旧栈

`archive/` 里的 Go 桌面端、AutoJs6 手机脚本、工作流 Registry 已冻结，不再更新；
对应的构建脚本、依赖清单也一起归档，需要查历史实现时在这里看。
