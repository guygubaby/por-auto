# 手机 JS 脚本发布与更新

手机使用官方 AutoJs6 6.7.0+，运行一次导入的固定启动器。业务 JS 按版本独立下载，不必为脚本改动重新安装 AutoJs6 或 PC 客户端。

## 客户首次使用

1. 手机安装官方 [AutoJs6](https://github.com/SuperMonster003/AutoJs6/releases/tag/v6.7.0)。
2. 按 AutoJs6 提示完成文件访问、弹窗/悬浮窗等首次设置。下载 [启动器 bootstrap.js](../mobile/autojs6/bootstrap.js)，在 AutoJs6 中打开并运行。只需这一个文件，不需要把开发源码目录一起导入。内置测试不要求无障碍权限；自动操作目标应用时，再按业务需要授权。
3. 在启动器选择「运行已安装脚本 → 手机脚本更新测试」。内置示例只显示“你好”，记录版本和运行次数，不打开微信、不发送消息。
4. 以后仍运行这个启动器：启动时自动检查已安装脚本；可手动「检查已安装脚本更新」，或从来源安装新脚本。

默认来源是 `https://github.com/guygubaby/por-auto` / `main`。可在「设置 GitHub 来源」修改仓库和分支；更换来源会隔离其安装状态、配置和数据，旧来源仍保留。

私有仓库先通过「输入 / 清除私有仓库令牌」填写有仓库 Contents 只读权限的 GitHub 令牌，再检查更新。令牌输入隐藏内容，只保留本次启动器会话，退出后清除，不写入配置、业务脚本或日志。启动时尚未填写令牌，私有来源可能提示检查失败，但已有脚本仍可离线运行。

## 你如何写脚本

```text
mobile-workflows/
  registry.json                    # 生成的目录，不能手工改摘要
  offline-bundle.json              # 生成的离线包
  your-script/
    workflow.json                  # 名称、版本、入口和最低运行环境
    src/
      main.js
      lib/helper.js                # 可选的依赖文件
```

`workflow.json`：

```json
{
  "schemaVersion": 1,
  "id": "your-script",
  "name": "我的手机脚本",
  "version": "1.0.0",
  "versionCode": 1,
  "minLauncher": 1,
  "minAutoJs6": "6.7.0",
  "description": "说明此脚本会做什么",
  "entry": "main.js"
}
```

`src/main.js` 使用同步 CommonJS 入口：

```js
module.exports = function (por) {
  var config = por.readConfig();
  // 在此编写业务操作，可使用 AutoJs6 API。
  por.log('开始处理', { version: por.version });
  config.lastVersion = por.version;
  por.saveConfig(config);
};
```

可用的 `por` 字段：`id`、`version`、`versionCode`、`runId`、`dataDir`；方法：`readConfig()`、`saveConfig(object)`、`log(message, details)`。相对 `require('./lib/helper.js')` 从当前版本目录加载。入口不能返回 Promise；创建线程时，必须先等待其结束再返回。当前不支持脱离入口生命周期的后台线程、异步 UI 脚本或独立子引擎管理。脚本是受信任的作者代码，拥有 AutoJs6 权限，不是沙箱。

## 发布一个新版本

1. 修改 `src/` 中的脚本；增加 `workflow.json` 的 `versionCode`，同时更新展示用 `version`。比较新旧版本以 `versionCode` 为准，拒绝降级和同版本替换不同内容。
2. 在仓库根目录执行：

   ```sh
   pnpm mobile:bundle
   pnpm test:mobile
   pnpm mobile:check
   ```

3. 提交并推送脚本源码、`mobile-workflows/registry.json`、`mobile-workflows/offline-bundle.json` 和生成的 `mobile/autojs6/bootstrap.js`。客户已导入的旧启动器可以直接更新业务脚本，不必重新导入生成的新文件。

发布工具会生成每个文件的 SHA-256 与字节数，检查 JS 语法和路径，并要求已有包内容变更时递增 `versionCode`。CI 检查生成文件是否过期并运行更新回归测试。

不需要创建新的桌面版本或覆盖现有 GitHub Release。手机通过 GitHub API 先锁定分支的单个提交，再从该提交下载目录和全部文件，避免混合两个提交的代码。

SHA-256 用于发现下载损坏和内容不一致，不证明脚本行为安全；只有你配置并信任的仓库才能用来分发脚本。GitHub 下载失败、令牌失效或限流时不会移除当前版本。

## 离线更新与 PC 传输

`pnpm mobile:bundle` 同时生成：

- `deliverables/PorAuto-AutoJs6-bootstrap.js`：可直接导入手机的固定启动器，约几十 KiB，包含安全测试示例。
- `deliverables/PorAuto-mobile-scripts.json`：自包含离线脚本包。PC 将此文件传到手机后，在启动器选择「导入本地脚本包」，输入实际文件路径；校验规则与在线安装相同。它不是 APK，不需要安装或解压。

离线包支持多文件和相对依赖，使用 Base64 表示字节；整包上限 10 MiB。在线目录最多 32 个脚本，每个脚本最多 128 个文件、总计 10 MiB，单个文件最多 2 MiB。路径不接受绝对路径、`..`、反斜杠、大小写重复或 Windows 保留名称。PC 图形化一键安装宿主/同步脚本入口和 PC→AutoJs6 任务通信不在本轮实现范围。

## 更新、配置和日志怎样保存

数据保存在 AutoJs6 的应用私有目录 `files/por-auto-mobile/`：

```text
settings.json
operation.lock
sources/<来源摘要>/
  state.json
  catalog.json
  versions/<脚本ID>-<版本号>-<内容摘要>/
  config/<脚本ID>.json
  data/<脚本ID>/
runs/<运行ID>/
  summary.json
  events.jsonl
```

完整下载先写临时目录，校验所有文件后改名为独立版本目录，最后原子替换安装状态文件。当前状态写入失败时旧状态仍保留；残留的完整版本可在下次检查时复用。业务配置、数据和日志不在脚本版本目录里，更新不覆盖它们。

任务与更新使用同一个跨启动器文件锁，不会同时执行；脚本文件不原地覆盖。当前入口必须同步完成。任务失败只记录一次，不自动重试，更不会自动重发消息。宿主被强行停止可能留下未完成记录，导出时标为中断；不会自动恢复这些任务。

「导出运行日志」生成最近 10 次运行的 JSON，包含来源、脚本版本、内容摘要、步骤日志和错误，不包含仓库令牌。每次运行最多保存 500 条脚本日志，超出时记录截断提示；日志文件本身保留在本机，不自动删除。导出文件写入宿主的外部私有目录 `por-auto-exports/`，随后尝试交由系统查看器打开。

不要卸载 AutoJs6 来升级，否则应用私有数据可能丢失。正常覆盖升级与本业务脚本更新是两条独立流程。升级 AutoJs6 的能力由官方宿主管理；如果未来业务脚本需要更高 `minLauncher`，需重新导入新版固定启动器，现有私有数据目录保持不变。

## 验证边界

自动化测试覆盖版本切换、离线运行、网络失败、摘要不符、下载中断、状态写入失败、配置保留、并发互斥、凭据不落盘和路径攻击；Node 语法检查不等于全部 Android API 已完成真机测试。手机系统、品牌限制、无障碍权限和业务页面仍需按实际设备验收。
