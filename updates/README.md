# PorAuto 后端（Cloudflare Worker）

> 部署、发版与密钥的完整清单见 [../devops.md](../devops.md)。

一个 Worker、一个域名 `https://por-auto.guygubaby.top`，同时干三件事：

| 路径 | 用途 | 鉴权 |
|---|---|---|
| `/` | 管理端 + 下载页（`admin/` 构建产物） | 无（管理操作要令牌） |
| `/latest`、`/latest.apk` | App 检查更新、下安装包 | 无 |
| `POST /api/runs` | App 上报一次完整运行日志 | `x-ingest-key` |
| `GET /api/runs`、`/api/runs/<id>` | 管理端查看日志 | `Authorization: Bearer <ADMIN_TOKEN>` |

AI 配置只存在 App 本地，由 App 设置页填写和测试，服务端不保存。

数据都在 R2 桶 `por-auto-releases`：

- `latest.json`、`latest.apk`：最新版本
- `runs/<时间>-<随机>.json`：运行日志（保留全部，管理端取最近 50 条）

## 部署

站点手动部署：

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
