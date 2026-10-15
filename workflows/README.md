# 工作流 Registry v1

默认源：`https://github.com/guygubaby/por-auto`，分支 `main`。客户端直接通过 GitHub REST API 读取本仓库 `workflows/registry.json`，不需要后端或客户电脑安装 Git。

## 发布工作流

1. 新建 `workflows/<唯一标识>/workflow.json`，标识使用英文字母、数字、`-` 或 `_`。
2. 按下述格式编写工作流，调整页面文字、步骤和版本。现有示例：`wechat-nickname`、`wechat-open`。
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

顶层字段必须包含：`schemaVersion: 1`、`minEngine: 1`、`id`、`name`、`version`、`description`、`package`、`steps`。未知字段会被拒绝。

每个步骤包含 `name` 和 `action`。现有动作：

| type | 参数 | 行为 |
| --- | --- | --- |
| `wake` | 无 | 点亮屏幕，不绕过密码锁屏 |
| `launch` | `activity` | 启动顶层 `package` 指定应用的 Activity |
| `wait` | `ms` | 有限等待；单步最多 10 秒，合计最多 30 秒 |
| `tap` | `selector`、可选 `skip_if`、`recover_back` | 唯一匹配才点击；存在跳过条件时跳过；可最多返回 3 次寻找入口 |
| `back` | 无 | 系统返回并等待界面稳定 |
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

工作流为受约束的 JSON 脚本，不执行仓库内任意 JavaScript、Python、EXE 或 shell 命令。新流程组合已支持的动作即可。每个工作流一次最多 40 步，一次只能运行一个任务；页面操作前检查目标应用是否可见。

## 私有仓库与本地配置

私有仓库使用有该仓库 Contents 只读权限的 GitHub 访问令牌。令牌只保留在本次请求内存中，提交表单后清空，不写配置、日志或安装包。仓库不会因设为默认源而自动获得授权；客户需自行具备仓库访问权限。

应用在本地用户数据目录保存 `workflow-store.json`，包含源列表、已同步目录及已安装工作流快照；刷新目录不会自动替换已安装版本，必须点击安装/更新。同步失败时保留原有文件。运行结果保存在同目录的 `runs/`，记录工作流版本和 Git 提交。关闭应用后安装结果仍保留；已安装工作流不依赖联网运行。

默认随软件附带微信昵称工作流，私有仓库还未授权时也可先试用。当前根目录 Python 示例属于前期验证工具，桌面运行器不依赖 Python。
