# 桌面工作流注册与运行契约调研

核对日期：2026-10-20。范围：n8n、Activepieces、Windmill 官方文档和官方 GitHub，以及本仓库 Rust 接口。以下「建议」是针对本项目的取舍，不代表三者共有标准。

结论：保留 Tauri 2 + Vue 3 + Rust、GitHub 注册源、固定 commit + SHA-256 安装和线性 typed steps。借鉴成熟产品的**注册描述、输入契约、版本固定、运行日志**，本次补齐持久卸载、参数化群发及逐群状态即可。

## 官方模式与可借鉴部分

| 产品 | 注册、包与输入 | 版本、运行与恢复 | 本项目采用 |
| --- | --- | --- | --- |
| n8n | npm 包的 `package.json.n8n` 显式列出 `nodes`、`credentials`、`n8nNodesApiVersion`；节点 `description.properties` 定义输入及 UI。[官方示例](https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/create-nodes/build-your-node/tutorial-build-a-declarative-style-node.md)、[参数](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/base-files/standard-parameters.md) | 已保存流程继续使用原节点版本；界面提供安装指定包版本及卸载。失败运行可以选择原工作流或当前工作流重跑。[节点版本](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/versioning.md)、[包管理](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation.md)、[执行记录](https://docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions.md) | 动作必须显式注册；展示名与机器 ID 分离；安装、同步来源、卸载是不同操作。 |
| Activepieces | `createPiece` 显式登记 `actions` / `triggers` 和 `minimumSupportedRelease`；`props` 定义输入，提供文本和多选等字段。[定义](https://www.activepieces.com/docs/build-pieces/building-pieces/piece-definition)、[输入](https://www.activepieces.com/docs/build-pieces/piece-reference/properties) | pieces 使用 SemVer；删除/改名输入、增加必填输入或改变行为属于破坏性变更。步骤固定 piece 版本。运行日志保存步骤输入、输出、状态、耗时和错误；恢复会跳过已完成步骤，重新执行未完成步骤。[版本规则](https://www.activepieces.com/docs/build-pieces/piece-reference/piece-versioning)、[固定版本](https://www.activepieces.com/docs/admin-guide/guides/manage-pieces)、[持久执行](https://www.activepieces.com/docs/install/architecture/durable-execution) | 分清工作流版本与引擎兼容性；日志按步骤和目标保存。发送动作不能直接照搬「重跑未完成步骤」。 |
| Windmill | OpenFlow 将描述、输入 JSON Schema 和 `value.modules` 分开；模块有稳定 `id`，输入可来自流程参数和前面步骤结果。官方 OpenAPI 文件是完整契约的事实来源。[OpenFlow](https://www.windmill.dev/docs/openflow)、[官方契约](https://github.com/windmill-labs/windmill/blob/main/openflow.openapi.yaml)、[线性步骤及数据映射](https://www.windmill.dev/docs/flows/architecture) | 脚本 hash 是不可变版本引用；步骤重试显式设置次数与延迟。[版本](https://www.windmill.dev/docs/core_concepts/versioning)、[重试](https://www.windmill.dev/docs/flows/retries) | 输入与步骤分离；保留不可变快照；群发循环先封装成一个原生动作，不增加 DAG / JS 表达式引擎。 |

三者没有共同的、可直接装进本客户端的 workflow manifest。可借鉴的是设计原则；现有 JSON 应继续作为本地专用协议，也不需要引入 npm 插件执行能力或后台服务。

## 仓库现状与直接缺口

- [workflow.rs](/Users/bryceloskie/i/por/por-auto/src-tauri/src/workflow.rs:16)：引擎 2、schema 1、严格拒绝未知字段；`Action` 是封闭枚举。现有发送要求先确认首个会话，文字写死在步骤中，每流程最多一次。新增群发应是独立动作，保留旧动作的限制。
- [registry.rs](/Users/bryceloskie/i/por/por-auto/src-tauri/src/registry.rs:102)：每次 `load` 都会重新安装缺少的 bundled 示例；仅删除 `installed` 项会复活。已有 `remove` 删除的是来源，并且有意保留已安装快照。下载已固定 commit，并校验原始文件 SHA-256。
- [schedule.rs](/Users/bryceloskie/i/por/por-auto/src-tauri/src/schedule.rs:20)：任务保存 `Installed` 快照，已有明确的更新快照开关，应沿用；输入配置也需随任务保存。
- [history.rs](/Users/bryceloskie/i/por/por-auto/src-tauri/src/history.rs:12)：已有运行摘要、JSONL 步骤日志和工作流快照；日志缺少群目标 ID 与发送阶段，`flush()` 也不等同于崩溃后的发送状态确认。

## 最小可落地契约（建议）

### 1. 注册与兼容

继续使用 `workflows/registry.json → workflows/{id}/workflow.json`；索引中的 `id/path/sha256`、安装项的来源与 commit 保持原义。同步只更新目录，用户点安装/更新才替换本地快照。

保留 `schemaVersion`（JSON 结构版本）、`version`（工作流 SemVer）、`minEngine`（原生动作支持下限）三个层次。新客户端继续解析现有 schema 1；本次若仅增加可选输入描述和新动作，可仍用 schema 1，但新工作流必须声明 `minEngine: 3`。旧客户端会因未知字段/动作拒绝安装；只有新引擎支持且旧流程 fixture 通过才发布。真正改变既有字段结构时再增加 schema 版本，禁止静默重释旧动作。

新增动作继续登记在 Rust `Action`，通过同一个解析/校验/执行入口；无需再建动态插件注册表。每步可增加可选稳定 `id`，旧步骤按序生成内部 ID。增加 `inputSchema` 作为注册描述，先支持本次固定的消息来源与群选择字段：Rust enum 校验是执行事实来源，Vue 显示对应固定表单，JSON Schema 用 `oneOf + type.const` 描述两个 tagged union，必填字段放 `required`，对象设 `additionalProperties: false`；暂不开发通用 Schema 表单生成器。未知动作、缺参数或不支持的 schema 在操作手机前报错。

### 2. 参数与执行快照

工作流仅描述可配置项；具体参数属于手动运行输入/定时任务，不写进共享注册源。以下是 **RunInput 草案**，不是当前已支持格式：

```json
{
  "message": { "type": "manual", "text": "Ok" },
  "recipients": { "type": "selected", "groups": ["已核对的群名称"] }
}
```

消息另一分支为 `{"type":"http","url":"https://example.com/message","method":"GET","response":{"type":"json","pointer":"/message"}}`；请求配置先覆盖 GET / POST、可选请求头及 POST JSON 请求体即可。也可支持 `response.type: "text"` 读取纯文本。使用 JSON Pointer 取值，不运行服务器返回的 JS。群选择另一分支为 `{"type":"all"}`。

HTTP 由本机 Rust 发起，是出站消息数据源，不开 webhook 服务。允许用户设置必要请求头；凭据只保存在本机，日志脱敏，公共 workflow 中不能携带。设置超时、响应体上限、重定向策略；非 2xx、字段不存在、非字符串、空白或超出当前 500 字节限额均在发送前失败。每次运行先取一次消息，保存结果/哈希和配置快照，随后所有目标使用相同内容；不在循环中反复请求。手动输入同样校验。

每台手机独立发现群聊并冻结去重后的收件人清单，再开始发送。`all` 的范围是**本次原生群聊列表确实枚举出的全部群**；仅靠当前可访问的 UI 无法承诺找到账号历史上所有群，应显示发现数量/列表来源。逐屏滚动到确认末尾，不能把首屏称作全部。勾选组必须精确命中；同名群不能凭标题或列表序号猜测，缺失/歧义时停止对应目标并保留原因。

### 3. 原生导航与群发动作

在共享微信原生模块增加幂等的「恢复第一个 Tab」能力：确认前台包 → 有限次数返回到微信根页 → 用 hierarchy 的 text/content-desc/resource-id 与结构确认底部导航 → 点第一个「微信」Tab → 验证会话列表。每个现有微信流程开头及每轮群目标导航前复用；异常页面无法确认时停止。不能只 `Launch` 后假定已回首页，也不能用固定屏幕坐标或 OCR 猜测。

线性步骤保留为 `wake → launch → wechat_first_tab → wechat_group_send`。`wechat_group_send` 内部顺序遍历已确认目标，复用现有原生控件输入与发送验证。同一设备运行互斥；不同设备可沿用现有批量调度。取消在下一个目标开始前生效，界面显示已发送、待发送和当前目标。

### 4. 逐目标日志与不确定发送

沿用运行目录和 JSONL，补充 `targetId/title`、`stepId`、阶段与时间。最小目标状态为 `pending / sending / sent / failed / uncertain / skipped`；外层摘要保存数量，UI 订阅同一事件并能重载历史。这里的 `sent` 只表示原生 UI 已确认发出，不代表对方阅读或服务端唯一投递。

点击发送前先持久化该目标的发送意图并确保落盘；点击后确认成功再记录 `sent`。点击返回异常、断线、进程退出，或只剩发送意图时归为 `uncertain`，本轮停止，剩余目标为 `skipped`。下次启动仅恢复记录，不能自动恢复发送；也不能把新一次定时触发当作失败运行续传。为消息和目标生成本地指纹有助排查，但微信没有本应用可用的幂等提交键，不能由此承诺 exactly-once。

这比 Activepieces 的通用 checkpoint replay 更保守：其未完成步骤会重跑，而微信点击发送后可能已经产生外部副作用。[官方恢复机制](https://www.activepieces.com/docs/install/architecture/durable-execution) 因此，本次不增加重试发送或「从失败步骤继续」按钮；不确定目标留给用户核对。

### 5. 持久卸载

新增独立 `uninstall(installedKey)`，不复用删除来源。Store 增加默认空的 `uninstalledKeys` 集合；卸载时删除安装快照、记入集合并原子保存，bundled 自动补全跳过这些 key。用户主动重新安装时移除该 key，恢复正常更新；无论重新加载、同步源或新增 bundled 示例，都不能撤销卸载意图。旧 Store 缺少字段时用默认值兼容。

卸载不删除历史记录。正在运行该快照时阻止卸载；引用此 key 的启用定时任务需要随卸载暂停，保留其配置与快照并显示原因。所有入口还应在运行前检查安装有效性，避免分文件写入失败或旧任务快照绕过卸载；不能继续发送后才发现工作流已卸载。此行为属于本项目的产品建议，并非上述平台的统一规定。

## 本次验收范围

1. 一个离线回归集：现有四个工作流均可解析；新增参数无效时不碰手机；卸载 → save → reload → sync 不复活，重新安装可恢复；逐目标状态可重载，不确定发送没有重试路径。
2. 一轮真机原生控件验证：从会话内、其他 Tab、通讯录子页开始，分别确认所有现有流程能恢复首 Tab；再检查群发现完整滚动、勾选、同名歧义和逐目标进度。
3. 本次群发真实测试只允许 `Ok`；文件传输助手示例按用户指定发送 `1`。HTTP 先取值核对为 `Ok`，再启动群发。本文没有执行任何设备操作或发消息。

未引入服务器、完整 OpenFlow/n8n 兼容层、任意脚本、图编辑器或自动恢复发送。
未核验具体手机微信版本的群列表覆盖与控件稳定性；这些仍须真机确认，不能由文档调研替代。
