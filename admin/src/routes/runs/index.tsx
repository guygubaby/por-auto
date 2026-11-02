import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AdminGate } from '../../components/admin-gate'
import {
  Card,
  DryRunChip,
  RequestError,
  cardClass,
  secondaryButtonClass,
} from '../../components/ui'
import { fetchRuns } from '../../lib/api'
import { formatDateTime, kindLabel, scopeLabel } from '../../lib/format'
import type { RunSummary } from '../../lib/types'

export const Route = createFileRoute('/runs/')({
  component: RunsRoute,
})

type RunsState =
  | { status: 'loading' }
  | { status: 'ready'; runs: RunSummary[] }
  | { status: 'error'; error: unknown }

function RunsRoute() {
  return (
    <AdminGate>
      {(token, signOut) => <RunsPage token={token} signOut={signOut} />}
    </AdminGate>
  )
}

function RunsPage({ token, signOut }: { token: string; signOut: () => void }) {
  const [state, setState] = useState<RunsState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    fetchRuns(token)
      .then((runs) => {
        if (active) setState({ status: 'ready', runs })
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', error })
      })
    return () => {
      active = false
    }
  }, [token, reloadKey])

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[26px] tracking-tight sm:text-[30px]">运行日志</h1>
          <p className="mt-1.5 text-[13px] text-muted">
            最新 50 次上报。点击一行查看完整结果与日志。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={state.status === 'loading'}
          className={secondaryButtonClass}
        >
          <RefreshCw
            size={13}
            className={state.status === 'loading' ? 'motion-safe:animate-spin' : undefined}
            aria-hidden="true"
          />
          刷新
        </button>
      </div>

      {state.status === 'loading' && (
        <Card className="mt-6 p-8">
          <p className="motion-safe:animate-pulse text-[13px] text-muted">正在加载运行日志…</p>
        </Card>
      )}

      {state.status === 'error' && (
        <div className="mt-6">
          <RequestError
            error={state.error}
            onRetry={() => setReloadKey((key) => key + 1)}
            onSignOut={signOut}
          />
        </div>
      )}

      {state.status === 'ready' && state.runs.length === 0 && (
        <Card className="mt-6 px-6 py-12 text-center">
          <p className="font-serif text-xl">暂无运行记录</p>
          <p className="mt-2 text-[13px] text-muted">App 完成一次群发后，运行日志会出现在这里。</p>
        </Card>
      )}

      {state.status === 'ready' && state.runs.length > 0 && (
        <>
          <p className="mt-6 text-[12px] tabular-nums text-muted">共 {state.runs.length} 条记录</p>

          <div className={`${cardClass} mt-2 hidden overflow-x-auto md:block`}>
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-line bg-paper/50 text-[11px] text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">时间</th>
                  <th scope="col" className="px-4 py-3 font-medium">类型</th>
                  <th scope="col" className="px-4 py-3 font-medium">范围</th>
                  <th scope="col" className="px-4 py-3 font-medium">模式</th>
                  <th scope="col" className="px-4 py-3 font-medium">计数</th>
                  <th scope="col" className="px-4 py-3 font-medium">设备</th>
                  <th scope="col" className="px-4 py-3 font-medium">错误</th>
                </tr>
              </thead>
              <tbody>
                {state.runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => {
                      void navigate({ to: '/runs/$id', params: { id: run.id } })
                    }}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-paper/60"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      <Link
                        to="/runs/$id"
                        params={{ id: run.id }}
                        onClick={(event) => event.stopPropagation()}
                        className="hover:underline underline-offset-2"
                      >
                        {formatDateTime(run.startedAt)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{kindLabel(run.kind)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {scopeLabel(run.scope)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <DryRunChip dryRun={run.dryRun} />
                    </td>
                    <td className="px-4 py-3">
                      <RunCounts run={run} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {run.device?.model || '—'}
                      <span className="block text-[11px] text-muted/80">
                        Android {run.device?.android || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {run.error ? (
                        <span
                          className="block max-w-[220px] truncate text-danger"
                          title={run.error}
                        >
                          {run.error}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-3 md:hidden">
            {state.runs.map((run) => (
              <Link
                key={run.id}
                to="/runs/$id"
                params={{ id: run.id }}
                className={`${cardClass} block p-4 transition hover:border-ink/20`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] tabular-nums text-muted">
                    {formatDateTime(run.startedAt)}
                  </span>
                  <DryRunChip dryRun={run.dryRun} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
                  <span className="font-medium">{kindLabel(run.kind)}</span>
                  <span className="text-muted">·</span>
                  <span className="text-muted">{scopeLabel(run.scope)}</span>
                  <span className="text-muted">·</span>
                  <span className="text-muted">{run.device?.model || '—'}</span>
                </div>
                <RunCounts run={run} className="mt-3" />
                {run.error && (
                  <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-danger">{run.error}</p>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RunCounts({ run, className = '' }: { run: RunSummary; className?: string }) {
  return (
    <div
      className={`flex flex-wrap gap-x-3 gap-y-1 text-[12px] tabular-nums text-muted ${className}`}
    >
      <span>
        总 <span className="text-ink">{run.total}</span>
      </span>
      <span>
        已发 <span className="text-ink">{run.sent}</span>
      </span>
      <span>
        演练 <span className="text-ink">{run.rehearsed}</span>
      </span>
      <span>
        失败 <span className={run.failed > 0 ? 'text-danger' : 'text-ink'}>{run.failed}</span>
      </span>
      <span>
        跳过 <span className="text-ink">{run.skipped}</span>
      </span>
    </div>
  )
}
