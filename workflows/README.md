# 工作流 Registry v1

默认源：`https://github.com/guygubaby/por-auto`，分支 `main`。客户端直接通过 GitHub REST API 读取本仓库 `workflows/registry.json`，不需要后端或客户电脑安装 Git。

## 发布工作流

1. 新建 `workflows/<唯一标识>/workflow.json`，标识使用英文字母、数字、`-` 或 `_`。
2. 按下述格式编写工作流，调整页面文字、步骤和版本。现有示例：`wechat-nickname`、`wechat-open`、`wechat-first-chat`、`wechat-send-hello`、`wechat-broadcast`。
3. 执行 `pnpm registry:index`，生成包含 SHA-256 的统一索引；执行 `pnpm registry:check` 检查是否同步。
4. 提交并推送工作流文件及 `workflows/registry.json`。客户在软件“工作流商店”填写仓库地址和分支，点击“添加 / 刷新仓库”，然后安装或更新相应工作流。

脚本只使用已有执行引擎能力时，无需重新发版客户端。增加新的动作类型、协议或原生能力时仍需升级客户端。客户端遇到未知动作或不兼容引擎版本会停止安装并给出提示。

## 目录约定

```text
workflows/
  registry.json
  README.md
  wechat-nickname/
    workflow.json
  wechat-open/
    workflow.json
```

索引由脚本生成，不手工填写散列。客户端要求每项路径严格为 `workflows/<id>/workflow.json`，并校验文件内容、标识和 SHA-256；整次刷新使用同一个 Git 提交，避免拉取到新旧版本混合的文件。每个源最多 32 个工作流，文件各不超过 256 KiB，最多可配置 20 个源。

## 工作流格式

顶层字段必须包含：`schemaVersion: 1`、`minEngine: 1`（旧动作）、`minEngine: 2`（首会话/固定文字）或 `minEngine: 3`（首页恢复/指定会话/可配置发送）、`id`、`name`、`version`、`description`、`package`、`steps`。未知字段会被拒绝。

每个步骤包含 `name` 和 `action`，推荐提供唯一且稳定的 `id`。工作流 `version` 使用 SemVer（例如 `2.0.0`），与 JSON 结构版本和 `minEngine` 分开演进。现有动作：

| type | 参数 | 行为 |
| --- | --- | --- |
| `wake` | 无 | 点亮屏幕，不绕过密码锁屏 |
| `launch` | `activity` | 启动顶层 `package` 指定应用的 Activity |
| `wait` | `ms` | 有限等待；单步最多 10 秒，合计最多 30 秒 |
| `tap` | `selector`、可选 `skip_if`、`recover_back` | 唯一匹配才点击；存在跳过条件时跳过；可最多返回 3 次寻找入口 |
| `back` | 无 | 系统返回并等待界面稳定 |
| `wechat_first_chat` | `output` | 引擎 2；回到微信会话列表并滚动到顶，打开第一个会话、核对标题，输出会话名（含置顶） |
| `wechat_send_text` | `text` | 引擎 2；必须先 `wechat_first_chat` 或 `wechat_open_chat`，核对标题与草稿后输入 Unicode 文字并单次发送，输出 `message`、`send_status`；只支持原版简体中文微信 |
| `wechat_home` | 无 | 引擎 3；从当前微信页面返回并确认首页第一个 Tab |
| `wechat_open_chat` | `target`、`output` | 引擎 3；搜索完整名称，唯一匹配才打开并核对标题 |
| `wechat_broadcast` | 无 | 引擎 3；读取本地输入配置、冻结完整名单、逐会话发送并记录；需要 `inputSchema` |
| `read_row` | `page`、`labels`、`output` | 确认页面标题，从标签同行容器读取唯一文本，写入结果字段 |

`selector` 可包含 `text`（精确文字候选列表）、`prefix`（文字前缀候选列表）、`bottom`（只查找屏幕底部）、`peers`（要求指定文字在同一行）。`text` 和 `prefix` 至少存在一项。`skip_if` 是选择器列表，只检查文字存在性，不使用位置约束。匹配歧义会停止，不凭猜测点击。

示例：

```json
{
  "name": "进入「我」页面",
  "action": {
    "type": "tap",
    "selector": { "text": ["我"], "bottom": true, "peers": ["通讯录", "发现"] },
    "skip_if": [{ "prefix": ["微信号：", "微信号:"] }, { "text": ["个人信息"] }],
    "recover_back": 3
  }
}
```

工作流为受约束的 JSON 脚本，不执行仓库内任意 JavaScript、Python、EXE 或 shell 命令。新流程组合已支持的动作即可。每个工作流一次最多 40 步，同手机任务按到达顺序排队，全局最多 4 台并发；页面操作前检查目标应用是否可见。固定文字发送动作每个工作流最多一次，文字 1–500 字节；批量消息支持 1–4000 UTF-8 字节；目标确认后不要插入其他导航动作。失败不会自动重发。

## 私有仓库与本地配置

私有仓库使用有该仓库 Contents 只读权限的 GitHub 访问令牌。令牌只保留在本次请求内存中，提交表单后清空，不写配置、日志或安装包。仓库不会因设为默认源而自动获得授权；客户需自行具备仓库访问权限。

应用在本地用户数据目录保存 `workflow-store.json`，包含源列表、已同步目录及已安装工作流快照；刷新目录不会自动替换已安装版本，必须点击安装/更新。同步失败时保留原有文件。运行结果保存在同目录的 `runs/`，记录工作流版本和 Git 提交。关闭应用后安装结果仍保留；已安装工作流不依赖联网运行。

默认随软件附带上述 5 个工作流，私有仓库还未授权时也可先试用。当前根目录 Python 示例属于前期验证工具，桌面运行器直接调用 uiautomator2 官方手机端服务，不依赖 Python。首次加入引擎 2 的动作需要更新客户端到 0.2.1；之后仅修改 `text` 等现有参数并提高工作流版本，只需更新商店。旧客户端暂不能同步含引擎 2 的目录，请先升级软件。


## 输入、生命周期与执行快照（引擎 3）

`wechat-broadcast` 声明 `"inputSchema": {"$ref":"por-auto://schemas/wechat-send-input/v1"}`，定义见 [输入 JSON Schema](../schemas/wechat-send-input.schema.json)。客户端只接受已实现的输入协议；Rust 的类型与校验是运行事实来源。工作流作者不在公共 manifest 放客户的消息、接收名单或凭据。

在已安装卡片点击「配置」，分别设置：

1. **运行前 Hook**：可选 HTTP 请求，开始手机操作前执行；失败就不运行手机工作流。消息来源可选它的解析结果。
2. **运行主体**：消息可手动填写、使用前置结果，或配置独立 HTTP 请求。HTTP 可在本轮发送前获取一次，或在每个接收会话前获取最新数据。后者参数值可用 `{{recipient.title}}`、`{{recipient.index}}`、`{{recipient.total}}`；两者都可用 `{{device.serial}}`、`{{workflow.id}}`。
3. **运行后 Hook**：成功或失败均执行一次，可在参数、请求头值和 JSON 请求体中使用 `{{run.id}}`、`{{run.status}}`、`{{device.serial}}` 和 `{{outputs.nickname}}` 等已存在字段。不存在的变量报错，不执行 JS 表达式。后置请求失败只记警告，绝不重跑手机动作。

HTTP 支持 GET/POST、查询参数、普通请求头、JSON 请求体、Bearer/Basic/API Key（请求头或查询参数）。鉴权值保存在 macOS 钥匙串/Windows 凭据管理器，配置仅存随机引用。超时 1–60 秒、响应最多 1 MiB；不跟随重定向、不自动重试。鉴权配置不要塞进普通参数；请求配置不会写入运行导出文件。系统凭据不可用时保存失败，不降级为明文。

解析支持 UTF-8 纯文本，或 JSON Pointer（如 `/data/message`）选出字符串；后置回调还可忽略响应，支持 204。HTTP 错误、解析失败、空内容或超限会停止发送。「测试请求与解析」只发起配置的 HTTP 请求，不操作手机；含变量时使用示例值。响应样本也可离线单独解析，不发起网络请求。

配置保存在安装实例上；更新工作流保留配置。每个定时任务冻结安装版本、输入与 Hook 配置；已有任务要显式更新快照才采用新配置。数据本身在每轮执行时获取，不使用测试预览作为正式消息。

## 目标与发送记录

「仅群聊」尝试读取微信「选择一个群」列表；「全部会话类型」读取首页会话列表，排除公众号等系统入口。所谓全部是本次原生列表可枚举的全部可发送会话，不能承诺覆盖微信未展示的历史群。逐屏读取到确定末尾后才发送；缺失、同名、列表变化或无法确认末尾时停止，不把第一屏当作全部。

运行目录的 `targets.json` 保存 `pending/sending/sent/failed/uncertain/skipped` 状态，每个目标另有页面证据及 `send_requested` 日志。发送意图先落盘，点击后只观察，不自动重试；中断时 `sending` 显示为 `uncertain`，留待核对。可以停止后续操作，当前发送会先完成结果校验。发送成功仅表示原生 UI 已观察到新消息，不表示网络送达。

## 卸载

已安装工作流可单独卸载，官方 Registry 本身仍常驻。卸载意图保存在 `uninstalledKeys`，重启、同步来源不会自动装回；主动重新安装才清除。关联定时任务暂停，历史记录保留，旧快照也不能绕过卸载继续运行。

## 设备兼容性

运行器仅使用原生 UI 控件，不使用 OCR。当前 vivo X21 / Android 9 / 微信 8.0.79 在 uiautomator2 与 AutoJs6 下都曾返回空节点；此状态会停止操作，不会猜坐标发送。新增流程需要完成该真机的原生兼容性验证后才能按「全部通过」交付；单元测试不代表机型适配通过。
