# Por Auto 原生输入组件

仅提供 Android InputMethodService 和受校验的本地 ContentProvider，不包含应用页面、网络访问、截图、OCR 或发送动作。电脑和 AutoJs6 共用相同的原生完整文本读取与输入协议。

微信 8.0.79 / Android 9 已验证中文搜索、文件传输助手草稿 1、完整回读、已有草稿保护及清理；优化后的 Kotlin 版本已通过手机真实工作流调用，并验证切换与恢复原键盘。完整群聊与桌面执行仍需继续验收，不能据此宣称所有工作流已完成。

构建：JDK 17+、Android SDK 34 / build-tools 34.0.0，运行 `./gradlew testDebugUnitTest assembleRelease`。Release 启用 R8 与资源裁剪；签名通过外部环境变量 `POR_INPUT_KEYSTORE`、`POR_INPUT_STORE_PASSWORD`、`POR_INPUT_KEY_PASSWORD` 提供，别名为 `por-input`。密钥不得放入仓库。未提供签名时只生成未签名验证包。

输入组件需要先在 Android 输入法设置中启用。PC 可通过已授权的 ADB 配置并在执行后恢复原键盘；手机端使用系统键盘选择器。组件没有普通键盘界面，停止自动化后应恢复原键盘。

签名构建后，运行 `ANDROID_HOME=/path/to/sdk node scripts/input-artifact.mjs --write` 将 APK 与源码摘要写入 `artifacts/`。字节变化必须递增 `versionCode`；普通桌面与手机打包只读取已经签名、校验通过的组件，不需要重新安装 Android 构建环境。密钥与密码只保存在仓库外。

版本组合遵循 [Kotlin / Gradle / AGP 兼容表](https://kotlinlang.org/docs/gradle-configure-project.html) 与 [AGP 8.6 兼容要求](https://developer.android.com/build/releases/agp-8-6-0-release-notes)。输入通过 [InputMethodService](https://developer.android.com/reference/android/inputmethodservice/InputMethodService) 和 [InputConnection](https://developer.android.com/reference/android/view/inputmethod/InputConnection) 实现，完整提取失败时停止。

IPC：`content://com.por.auto.input` 的 `call(method, JSON, null)`，JSON 包含 `protocolVersion: 1`。`read` 需要 `packageName`；`write` 另需 `sessionId/requestId/text`；`clearOwned` 需要本轮返回的 `ownerId`。每次写入和清理完整回读，无连接、密码框、已有草稿、连接变化、重复请求或结果未知均停止。没有 Send、Enter 或 editorAction 接口。

仅允许已授权 ADB shell、组件自身及签名符合固定官方证书的 AutoJs6 调用。微信与企微以外的输入框和密码输入框不可读取或写入。
