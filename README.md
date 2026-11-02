# por-auto

企业微信自动化，单个 Android APK，装完即用。

## 目录

```
android/    当前交付物：PorAuto Agent APK
docs/       方案与说明文档
archive/    旧栈存档（Go 桌面端 / AutoJs6 / 工作流 Registry），只读保留
```

## 当前能力（P0–P2）

- **读屏**：无障碍读取企业微信页面，导出 JSON，便于核对控件与资源 ID。
- **群发**：试运行（只写草稿再清理）与正式发送（只点一次、回读气泡、不重发）。
- **定时**：每天固定时间执行一次群发，支持暂停 / 立即运行 / 删除。

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
