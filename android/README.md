# PorAuto Android

基于 [Mika](https://github.com/wangzan101/Mika)（Apache-2.0，快照 `f8f4be0`）的 PorAuto APK。
包名沿用 `com.por.auto.agent`，用同一张发布证书覆盖升级老用户；应用名是 PorAuto。

## 与上游的差异

| 项 | 改动 |
|---|---|
| 包名 / 应用名 | `com.por.auto.agent` / PorAuto（代码命名空间仍是 `com.wangzan101.mika`） |
| 模型服务商 | 新增「PorAuto 网关」预设：`http://120.48.165.190:3425/v1`，OpenAI 兼容，Key 在 App 内填写 |
| 检查更新 | 从 GitHub Releases 改为 por-auto 后端 `/latest` + `/latest.apk`，按 `versionCode` 比较，下载后校验大小、SHA-256、包名、版本号和签名 |
| 运行日志上报 | `porauto/PorAutoReport.kt`：任务结束时上报目标和步骤到 `/api/runs`；可在设置里关闭，失败下次启动补传 |
| 构建 | 读取 `local.properties` 的 `ingestKey` 注入 `BuildConfig.INGEST_KEY`；release 用 `keystore.properties` 签名 |
| 管理台 | `/runs` 能显示 `kind=assistant` 的执行步骤和完成/失败计数 |

其余功能、文案和目录结构保持上游原样，便于之后合并 Mika 的更新。

## 构建

需要 JDK 17（`jvmToolchain(17)`）和 Android SDK 36。

```sh
cd android
export ANDROID_HOME=$HOME/Library/Android/sdk
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
./gradlew :app:assembleDebug
```

产物：`app/build/outputs/apk/debug/app-debug.apk`。

正式包（本机有 `keystore.properties` 时自动签名）：

```sh
./gradlew :app:assembleRelease
```

产物：

- `app/build/outputs/apk/release/app-universal-release.apk`（全架构，发版用）
- `app/build/outputs/apk/release/app-arm64-v8a-release.apk`（仅 arm64，体积更小）

沙箱运行时只带 arm64 原生库；x86_64 模拟器上 App 可用，但「文件与计算环境」会显示不支持。

## 测试

```sh
./gradlew :core:test :app:testDebugUnitTest
```

新增逻辑的单测在 `app/src/test/java/com/wangzan101/mika/porauto/`：
`PorAutoReleasesTest` 校验后端版本解析，`PorAutoReportTest` 校验上报 JSON 的步骤和状态。

## 配置

`local.properties`（已 gitignore，CI 构建前写入）：

```properties
sdk.dir=/Users/you/Library/Android/sdk
ingestKey=...
```

`ingestKey` 是日志上报的入网令牌；为空时 App 不显示「运行日志上报」开关，也不会上报。

`keystore.properties`（已 gitignore，CI 用 Secrets 生成）：

```properties
storeFile=/absolute/path/por-auto-release.jks
storePassword=...
keyAlias=...
keyPassword=...
```

**不要换签名。** 老用户和 `versionCode` 递增都依赖同一张证书；证书 SHA-256 必须和
`devops.md` 记录的一致。

## 手机操作

- 安装 Android 11+；操作 App 需要 Android 12+，推荐 14+。
- 首次使用按设置里的「手机操作」向导配对一次无线调试（或在电脑上跑 `usb-start.sh`）。
- 操作在后台虚拟屏上进行；锁屏、完全退出或切走时任务会停。
- 助手只做前台可见操作；付款、转账、删除、注销这类不可逆操作，目标里没提到就不做。

## 更新

关于页「检查更新」请求 `https://por-auto.guygubaby.top/latest`，下载 `/latest.apk`。
后端返回的 `versionCode` 必须大于已装版本；下载后校验 `size`、`sha256`、包名、版本号和签名，
任何一项不符都会删掉安装包。自动更新只在 Wi-Fi 下后台下载，安装前仍会询问。

## 许可

上游 Mika 以 Apache-2.0 发布。本目录保留 `LICENSE`、`NOTICE` 和 `licenses/THIRD_PARTY_NOTICES.md`；
分发修改版时请保留这些文件并标记改动。
