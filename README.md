# por-auto

手机 AI 助手：说一句话，AI 看着屏幕把 App 里的事办完。当前交付物是 **PorAuto 0.5.1**，基于 [Mika](https://github.com/wangzan101/Mika)（Apache-2.0）二次开发。

## 目录

```
android/    PorAuto APK（Mika 底座 + por-auto 的服务端接入）
admin/      管理台与下载页（React SPA）
updates/    后端 Worker：发版、运行日志（Cloudflare）
docs/       方案与说明文档
archive/    旧技术栈与旧 APK 存档，只读保留
```

## 当前能力

- **助手（主功能）**：说一句话，AI 读屏、点按、输入、滚动，直到办完；在后台虚拟屏上操作，不打断你正在用的屏幕。
- **模型服务商**：设置里可接任意 OpenAI 兼容 / Anthropic / Gemini / OpenAI Responses 服务；内置「PorAuto 网关」预设（`http://120.48.165.190:3425/v1`），Key 由用户在 App 内填写。
- **任务**：对话里的任务中心能看到进行中与已结束的任务，支持插话、停止和继续。
- **定时**：按时间、间隔或条件触发任务，支持暂停、立即运行和编辑。
- **运行日志上报**：每次任务结束时把目标、执行步骤和结果发到 por-auto 后端；设置 › 高级与其他 › 服务端可以关闭。失败的上报会留到下次启动补传。
- **应用内更新**：关于页检查 por-auto 后端的 `/latest`，下载 `/latest.apk`，校验大小、SHA-256、包名、版本号和签名后交给系统安装；也可以只在 Wi-Fi 下自动下载。
- **其他 Mika 能力**：知识/技能、记忆、路线回放、内置浏览器、沙箱、微信渠道、MCP/电脑连接等。

手机操作需要 Android 12 以上（推荐 14 以上），首次使用要按 App 里的「手机操作」向导配对一次无线调试或跑一次 adb。锁屏或切走时任务会停。

## 后端

`https://por-auto.guygubaby.top` 一个域名同时提供：

- 下载页与管理台（浏览器打开就是下载页，`/runs` 看运行日志）；
- App 检查更新（`/latest`、`/latest.apk`）；
- App 上报运行日志（`/api/runs`，带构建时注入的入网令牌）。

管理员用部署时设置的管理令牌进入管理台。AI 配置只存在 App 本地，在 App 设置页填写和测试。
详见 [updates/README.md](updates/README.md)。

## 构建与安装

```sh
cd android
ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

正式包用仓库外的 `android/keystore.properties` 签名。产物：

```
app/build/outputs/apk/release/app-universal-release.apk   # 全架构
app/build/outputs/apk/release/app-arm64-v8a-release.apk   # 仅 arm64
```

详见 [android/README.md](android/README.md)。

## 发版

版本号在 `android/app/build.gradle.kts`。推 `v*` tag 后 GitHub Actions 会跑测试、构建、签名、
校验证书，并把 APK 和 `latest.json` 发到 R2。流程见 [devops.md](devops.md)。

## 上游与许可

Mika 以 Apache-2.0 发布；本仓库保留其 `LICENSE`、`NOTICE` 和第三方声明（`android/licenses/`）。
二次开发的改动包括：包名/应用名、PorAuto 网关预设、后端更新源、运行日志上报、管理台对助手日志的展示，
以及构建与发版配置。上游项目地址：<https://github.com/wangzan101/Mika>。

旧的自写 APK（`com.por.auto.agent` 0.4.0）已移到 `archive/por-auto-android/`，只作参考。
