package com.wangzan101.mika.porauto

import com.wangzan101.mika.BuildConfig

/**
 * por-auto 后端：发版信息、安装包和运行日志都在同一个域名下。
 * 地址与 `updates/src/index.ts` 的路由一一对应；换域名只需要改这里。
 */
object PorAutoBackend {
    const val BASE_URL = "https://por-auto.guygubaby.top"
    const val LATEST_URL = "$BASE_URL/latest"
    const val APK_URL = "$BASE_URL/latest.apk"
    const val RUNS_URL = "$BASE_URL/api/runs"
    const val DOWNLOAD_PAGE = "$BASE_URL/"

    /** 日志上报的入网令牌，构建时从仓库外的 local.properties 注入。为空时上报功能不可用。 */
    val ingestKey: String get() = BuildConfig.INGEST_KEY

    val enabled: Boolean get() = ingestKey.isNotBlank()
}
