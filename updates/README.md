# PorAuto 后端（Cloudflare Worker）

一个 Worker、一个域名 `https://por-auto.guygubaby.top`，同时干四件事：

| 路径 | 用途 | 鉴权 |
|---|---|---|
| `/` | 管理端 + 下载页（`admin/` 构建产物） | 无（管理操作要令牌） |
| `/latest`、`/latest.apk` | App 检查更新、下安装包 | 无 |
| `POST /api/runs` | App 上报一次完整运行日志 | `x-ingest-key` |
| `GET /api/runs`、`/api/runs/<id>` | 管理端查看日志 | `Authorization: Bearer <ADMIN_TOKEN>` |
| `GET /api/config` | App 拉取 AI 配置 | `x-ingest-key` + `x-passcode-sha256` |
| `PUT /api/config` | 管理端写 AI 配置 | `Authorization: Bearer <ADMIN_TOKEN>` |
| `GET /api/passcode` | App 读取口令指纹与版本 | `x-ingest-key` |
| `PUT /api/passcode` | 管理端改口令 | `Authorization: Bearer <ADMIN_TOKEN>` |

数据都在 R2 桶 `por-auto-releases`：

- `latest.json`、`latest.apk`：最新版本
- `runs/<时间>-<随机>.json`：运行日志（保留全部，管理端取最近 50 条）
- `config/ai.json`：AI 配置
- `config/passcode.json`：口令的 sha256 与版本号，明文不落库

## 部署

站点由 Cloudflare Workers Builds 从 GitHub 构建：推送到 `main` 且改动 `admin/` 或 `updates/` 时自动部署。

已连接 Cloudflare Workers Builds。重新连接或换账号时：Cloudflare Dashboard → Workers & Pages → `por-auto-updates` → Settings → Builds → Connect，选择 `guygubaby/por-auto`、生产分支 `main`，然后填：

- Root directory：`updates`
- Build command：`cd ../admin && pnpm install --frozen-lockfile && pnpm build`
- Deploy command：`npx wrangler deploy`
- Include paths：`admin/**`、`updates/**`

Worker 名称必须和 `updates/wrangler.jsonc` 里的 `name` 一致（`por-auto-updates`）。

本地应急仍可手动部署：

```sh
cd admin && pnpm install && pnpm build     # 先出静态资源，Worker 从 ../admin/dist 读
cd ../updates && pnpm dlx wrangler@latest deploy
```

## 发版

推 `v*` tag 会触发 GitHub Actions：构建、签名、校验，并上传 `latest.apk` / `latest.json` 到 R2。

```sh
git tag -a v0.2.6 -m "更新说明"
git push origin v0.2.6
```

版本号要和 `android/app/build.gradle.kts` 里的一致，否则 App 的更新判断会错。本地应急仍可用：

```sh
cd updates
./publish.sh ../android/dist/PorAuto-Agent-0.2.6-release.apk 0.2.6 17 "更新说明"
```

## 密钥

- `INGEST_KEY`、`ADMIN_TOKEN` 用 `wrangler secret put` 写进 Worker，构建机上的副本在
  `~/.por-auto/backend-keys.txt`，不进仓库。
- App 的入网令牌在构建时从 `android/local.properties` 的 `ingestKey` 注入
  （`BuildConfig.INGEST_KEY`），仓库里没有这个值，别人构建出来的包无法上报。
- 管理令牌只存在浏览器 localStorage，后台「退出」会清掉。
