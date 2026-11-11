# 部署与发版（devops）

> 最后核对：2026-11-11。当前 APK：`0.3.0` / `versionCode 17`。
> 本文件是部署与发版的入口；Android 细节见 [android/README.md](android/README.md)，后端与数据见 [updates/README.md](updates/README.md)。

## 1. 资源

| 资源 | 值 |
|---|---|
| 站点 | `https://por-auto.guygubaby.top` |
| Cloudflare Worker | `por-auto-updates` |
| Worker 配置 | `updates/wrangler.jsonc` |
| R2 桶 | `por-auto-releases` |
| GitHub | `guygubaby/por-auto`，默认分支 `main` |
| 管理台 | `admin/`（React SPA，构建到 `admin/dist`） |
| App | `android/`（单个 APK） |

Cloudflare 账号先用 `pnpm dlx wrangler@latest whoami` 确认，再执行部署或发版。

## 2. 站点部署（手动）

当前站点是**手动部署**。Cloudflare 的 GitHub/Git 构建已经断开，不要重新连接（原因见第 6 节）。

前置：Node `>= 22`（用 fnm 选择）、pnpm（`admin/package.json` 的 `packageManager` 是 `pnpm@12.14.0`）、本机已登录 Wrangler（`pnpm dlx wrangler@latest login`）。

```sh
cd admin
pnpm install --frozen-lockfile
pnpm build

cd ../updates
pnpm dlx wrangler@latest deploy
```

`updates/wrangler.jsonc` 负责 Worker 名称、R2 绑定、`admin/dist` 静态资源和自定义域；不要改 Worker 名称，否则会部署到另一个 Worker。

部署后检查：

1. `https://por-auto.guygubaby.top/` 返回 200。
2. `https://por-auto.guygubaby.top/latest` 返回 JSON，`versionName` / `versionCode` 正确。
3. `/api/runs` 带管理令牌返回 200，不带令牌返回 401：

```sh
ADMIN=$(sed -n 's/^ADMIN_TOKEN=//p' ~/.por-auto/backend-keys.txt)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ADMIN" https://por-auto.guygubaby.top/api/runs
```

4. 在 `updates/` 执行 `pnpm dlx wrangler@latest secret list`，应至少有 `INGEST_KEY`、`ADMIN_TOKEN`。

Runtime secrets 丢失时（只在 Worker 被错误部署成 assets-only 后发生过），从本机文件重新写入，不要把值打印出来：

```sh
cd updates
ADMIN=$(sed -n 's/^ADMIN_TOKEN=//p' ~/.por-auto/backend-keys.txt)
printf '%s' "$ADMIN" | pnpm dlx wrangler@latest secret put ADMIN_TOKEN
INGEST=$(sed -n 's/^INGEST_KEY=//p' ~/.por-auto/backend-keys.txt)
printf '%s' "$INGEST" | pnpm dlx wrangler@latest secret put INGEST_KEY
```

## 3. APK 发版（推荐：tag 自动）

1. 修改 `android/app/build.gradle.kts`：
   - `versionCode` 必须比线上大（当前是 17）。
   - `versionName` 不要带 `v`（当前是 `0.3.0`）。
2. 提交到 `main`。
3. 打带说明的 tag 并推送：

```sh
git tag -a v0.2.6 -m "更新说明"
git push origin v0.2.6
```

本机推送需要代理时：

```sh
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 ALL_PROXY=http://127.0.0.1:7890 git -c http.version=HTTP/1.1 push origin v0.2.6
```

4. GitHub Actions `Release APK`（`.github/workflows/release.yml`）会自动：
   - 跑 `:app:testDebugUnitTest` 和 `:app:assembleRelease`；
   - 从仓库 Secrets 恢复签名，tag 去掉 `v` 必须等于 APK 的 `versionName`；
   - 校验签名证书 SHA-256；
   - `versionCode` 低于线上 `/latest` 时拒绝发布；
   - 调用 `updates/publish.sh` 把 `latest.apk`、`latest.json` 传到 R2；
   - 上传 APK artifact。
5. 发布后核对 `/latest` 和下载包的 SHA-256。

GitHub Secrets（只记录名字，值不进仓库）：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `POR_INGEST_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`（APK 发版只需要 R2 写权限；不要拿它做站点部署）

`GITHUB_TOKEN` 由 Actions 自带，不需要配置。签名相关 Secrets 由 `~/.por-auto/por-auto-release.jks` 和 `android/keystore.properties` 生成；`POR_INGEST_KEY` 对应 `android/local.properties` 的 `ingestKey`。只在 GitHub 仓库设置里维护，不要写进仓库。

### 本地手动发版（应急）

```sh
cd android
ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:testDebugUnitTest :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk dist/PorAuto-Agent-0.2.6-release.apk
$HOME/Library/Android/sdk/build-tools/35.0.0/apksigner verify --print-certs dist/PorAuto-Agent-0.2.6-release.apk

cd ../updates
./publish.sh ../android/dist/PorAuto-Agent-0.2.6-release.apk 0.2.6 17 "更新说明"
```

- `publish.sh` 会用 `aapt2` 核对 APK 的 `versionName` / `versionCode` 与参数；不一致会退出。
- 签名材料：`~/.por-auto/por-auto-release.jks` + `android/keystore.properties`（已 gitignore）。
- 证书 SHA-256：`922f3b9f3b2403ccfc81de42d43e404602ad99cd3ccdbfbbfb8dc7c143167ca5`。
- **不要换签名或卸载重装**；老用户靠同一签名覆盖更新，`versionCode` 必须递增。

## 4. 密钥与文件

| 内容 | 位置 / 说明 |
|---|---|
| Worker runtime secrets | `INGEST_KEY`、`ADMIN_TOKEN`；在 Cloudflare Worker；本机副本 `~/.por-auto/backend-keys.txt` |
| App 入网令牌 | 构建时从 `android/local.properties` 的 `ingestKey` 注入 `BuildConfig.INGEST_KEY`；CI 用 `POR_INGEST_KEY` |
| 管理令牌 | 只存在浏览器 localStorage，后台退出会清掉 |
| 签名 keystore | `~/.por-auto/por-auto-release.jks` |
| 签名配置 | `android/keystore.properties`（已 gitignore） |
| R2 数据 | `latest.json`、`latest.apk`、`runs/*` |

不要提交：`android/local.properties`、`android/keystore.properties`、`android/dist/`、`*.jks`、`admin/dist/`、`.wrangler/`、`.cloudflare/`。

## 5. GitHub Actions

- `.github/workflows/release.yml`：只在推 `v*` tag 时运行，负责 APK 构建、签名和发布。
- 没有站点部署 workflow；站点是手动部署。不要为了自动化重新接上 Cloudflare Git 构建。

## 6. 已知故障与边界

- **不要重新连接 Cloudflare 的 Git 构建。** 之前试过一次：根目录配置不对时，首次构建把 Worker 部署成 assets-only（没有 `main_module`、R2 绑定和 runtime secrets），`/latest`、`/api/*` 全部 404。恢复方式是回滚到上一个带 `main_module` 的版本，再重新写入两个 secrets。用已登录的 `cf` 执行（`cf auth whoami` 确认；它和 Wrangler 的登录是两套）：

```sh
cf workers versions list --worker-id por-auto-updates
cf workers deployments create --worker por-auto-updates --strategy percentage \
  --versions '[{"version_id":"<上一个带 main_module 的版本>","percentage":100}]'
```

- 站点部署依赖 `updates/wrangler.jsonc` 的 `name`、`assets.directory`、`run_worker_first` 和 `routes`；不要随意改 Worker 名称或自定义域。
- 锁屏时定时任务会跳过；APK 只做前台无障碍，不建虚拟屏、不需要无线调试。
- 发送成功只代表界面出现新消息，不代表对方已收到。

## 7. 相关文档

- [android/README.md](android/README.md)：Android 构建、签名、测试和已知限制。
- [updates/README.md](updates/README.md)：Worker 路由、R2 数据和密钥。
- [README.md](README.md)：项目总览。
