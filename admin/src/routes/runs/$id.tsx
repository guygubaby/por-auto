import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { AdminGate } from '../../components/admin-gate'
import {
  Card,
  DryRunChip,
  RequestError,
  StatusChip,
  cardClass,
} from '../../components/ui'
import { fetchRun } from '../../lib/api'
import { formatDateTime, kindLabel, scopeLabel } from '../../lib/format'
import type { RunDetail } from '../../lib/types'

export const Route = createFileRoute('/runs/$id')({
  component: RunDetailRoute,
})

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; run: RunDetail }
  | { status: 'error'; error: unknown }

function RunDetailRoute() {
  return (
    <AdminGate>
      {(token, signOut) => <RunDetailPage token={token} signOut={signOut} />}
    </AdminGate>
  )
}

function RunDetailPage({ token, signOut }: { token: string; signOut: () => void }) {
  const { id } = Route.useParams()
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    fetchRun(token, id)
      .then((run) => {
        if (active) setState({ status: 'ready', run })
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', error })
      })
    return () => {
      active = false
    }
  }, [token, id, reloadKey])

  return (
    <div>
      <Link
        to="/runs"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted transition hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        返回运行日志
      </Link>

      {state.status === 'loading' && (
        <Card className="mt-4 p-8">
          <p className="motion-safe:animate-pulse text-[13px] text-muted">正在加载运行详情…</p>
        </Card>
      )}

      {state.status === 'error' && (
        <div className="mt-4">
          <RequestError
            error={state.error}
            onRetry={() => setReloadKey((key) => key + 1)}
            onSignOut={signOut}
          />
        </div>
      )}

      {state.status === 'ready' && <RunDetailView run={state.run} id={id} />}
    </div>
  )
}

function RunDetailView({ run, id }: { run: RunDetail; id: string }) {
  return (
    <div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-[26px] leading-tight tracking-tight sm:text-[30px]">
            {kindLabel(run.kind)} · {formatDateTime(run.startedAt)}
          </h1>
          <p className="mt-1.5 text-[12px] text-muted">
            日志 ID：<span className="break-all font-mono">{id}</span>
          </p>
        </div>
        <DryRunChip dryRun={run.dryRun} />
      </div>

      {run.error && (
        <div className="mt-5 rounded-[10px] border border-danger/25 bg-white p-4 text-[13px] leading-6 text-danger">
          <span className="font-medium">运行错误：</span>
          {run.error}
        </div>
      )}

      <Card className="mt-6 p-5 sm:p-6">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="范围">{scopeLabel(run.scope)}</Meta>
          <Meta label="设备">
            {run.device.model || '—'} · Android {run.device.android || '—'}
          </Meta>
          <Meta label="App / 企微">
            {run.device.appVersion || '—'} / {run.device.wecomVersion || '—'}
          </Meta>
          <Meta label="消息内容">{run.text || '—'}</Meta>
        </dl>

        <div className="mt-6 grid grid-cols-5 divide-x divide-line border-t border-line pt-5">
          <Stat label="总计" value={run.total} />
          <Stat label="已发送" value={run.sent} tone="sent" />
          <Stat label="已演练" value={run.rehearsed} tone="sent" />
          <Stat label="失败" value={run.failed} tone="danger" />
          <Stat label="跳过" value={run.skipped} tone="muted" />
        </div>
      </Card>

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-lg">发送结果</h2>
          <span className="text-[12px] tabular-nums text-muted">{run.results.length} 个群</span>
        </div>
        {run.results.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">没有逐群结果。</p>
        ) : (
          <div className={`${cardClass} mt-3 divide-y divide-line`}>
            {run.results.map((result, index) => (
              <div
                key={`${result.title}-${index}`}
                className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="break-words text-[13px]">{result.title || '（无标题）'}</p>
                  {result.error && (
                    <p className="mt-0.5 break-words text-[12px] leading-5 text-danger">
                      {result.error}
                    </p>
                  )}
                </div>
                <StatusChip status={result.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-lg">运行日志</h2>
          <span className="text-[12px] tabular-nums text-muted">{run.log.length} 行</span>
        </div>
        {run.log.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">没有日志。</p>
        ) : (
          <ol
            className={`${cardClass} mt-3 max-h-[420px] list-none overflow-auto p-4 font-mono text-[12px] leading-6`}
          >
            {run.log.map((line, index) => (
              <li key={index} className="whitespace-pre-wrap break-words">
                {line}
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className={`${cardClass} mt-8 overflow-hidden`}>
        <summary className="cursor-pointer select-none px-4 py-3 text-[13px] text-muted transition hover:text-ink">
          原始 JSON
        </summary>
        <pre className="max-h-[420px] overflow-auto border-t border-line bg-paper/50 p-4 font-mono text-[11px] leading-5">
          {JSON.stringify(run, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="mt-1.5 break-words text-[13px]">{children}</dd>
    </div>
  )
}

const STAT_TONES = {
  ink: 'text-ink',
  sent: 'text-sent',
  danger: 'text-danger',
  muted: 'text-muted',
} as const

function Stat({
  label,
  value,
  tone = 'ink',
}: {
  label: string
  value: number
  tone?: keyof typeof STAT_TONES
}) {
  return (
    <div className="px-1 text-center">
      <div className={`font-serif text-[22px] leading-none tabular-nums ${STAT_TONES[tone]}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-muted">{label}</div>
    </div>
  )
}
