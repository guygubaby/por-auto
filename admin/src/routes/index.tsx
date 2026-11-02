import { createFileRoute } from '@tanstack/react-router'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, RequestError, buttonClass } from '../components/ui'
import { apiUrl, fetchLatest } from '../lib/api'
import { formatDate, formatSize } from '../lib/format'
import type { ReleaseInfo } from '../lib/types'

export const Route = createFileRoute('/')({
  component: DownloadPage,
})

type LatestState =
  | { status: 'loading' }
  | { status: 'ready'; release: ReleaseInfo }
  | { status: 'empty' }
  | { status: 'error'; error: unknown }

function DownloadPage() {
  const [state, setState] = useState<LatestState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    fetchLatest()
      .then((release) => {
        if (!active) return
        setState(release ? { status: 'ready', release } : { status: 'empty' })
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', error })
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
        Android · 企业微信群发
      </p>
      <h1 className="mt-3 font-serif text-[34px] leading-tight tracking-tight sm:text-[44px]">
        把群发，交给 PorAuto
      </h1>
      <p className="mt-4 max-w-xl text-[14px] leading-7 text-muted">
        读屏点击、逐群核对、结果留档。下载最新的 Android 安装包，装完即可运行。
      </p>

      <div className="mt-10">
        {state.status === 'loading' && (
          <Card className="p-6 sm:p-8">
            <p className="motion-safe:animate-pulse text-[13px] text-muted">正在获取版本信息…</p>
          </Card>
        )}

        {state.status === 'empty' && (
          <Card className="p-6 sm:p-8">
            <p className="font-serif text-xl">暂无可用版本</p>
            <p className="mt-2 text-[13px] text-muted">服务端还没有上传安装包，请稍后再来。</p>
          </Card>
        )}

        {state.status === 'error' && (
          <RequestError error={state.error} onRetry={() => setReloadKey((key) => key + 1)} />
        )}

        {state.status === 'ready' && <ReleaseCard release={state.release} />}
      </div>

      <p className="mt-8 text-[12px] leading-6 text-muted">
        固定边界：只处理企微「群聊」分类；有草稿、标题不符、按钮不唯一都会停止；结果不明不重发。
      </p>
    </div>
  )
}

function ReleaseCard({ release }: { release: ReleaseInfo }) {
  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif text-[26px] leading-none">v{release.versionName}</span>
            <span className="text-[12px] tabular-nums text-muted">版本 {release.versionCode}</span>
          </div>
          <p className="mt-2 text-[12px] text-muted">发布于 {formatDate(release.publishedAt)}</p>
        </div>
        <span className="rounded-full border border-line px-2.5 py-1 text-[11px] tabular-nums text-muted">
          {formatSize(release.size)}
        </span>
      </div>

      {release.notes && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">更新说明</p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7">{release.notes}</p>
        </div>
      )}

      <div className="mt-7">
        <a href={apiUrl('/latest.apk')} download className={`${buttonClass} px-6 py-3 text-[15px]`}>
          <Download size={18} aria-hidden="true" />
          下载安装包
        </a>
      </div>

      <p className="mt-6 break-all font-mono text-[10px] leading-5 text-muted/80">
        SHA-256 · {release.sha256}
      </p>
    </Card>
  )
}
