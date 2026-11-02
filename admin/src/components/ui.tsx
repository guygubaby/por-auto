import { AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { isApiError } from '../lib/api'

export const cardClass = 'rounded-[10px] border border-line bg-white'

export const buttonClass =
  'inline-flex items-center gap-2 rounded-lg bg-amber px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-amber-deep disabled:cursor-not-allowed disabled:opacity-50'

export const secondaryButtonClass =
  'inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] text-ink transition hover:border-ink/25 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50'

export const inputClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-[14px] text-ink outline-none transition placeholder:text-muted/60 focus:border-amber focus:ring-2 focus:ring-amber/20'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`${cardClass} ${className}`}>{children}</section>
}

const STATUS_LABELS: Record<string, string> = {
  sent: '已发送',
  rehearsed: '已演练',
  failed: '失败',
  uncertain: '结果不明',
  skipped: '已跳过',
}

const STATUS_STYLES: Record<string, string> = {
  sent: 'border-sent/30 text-sent',
  rehearsed: 'border-sent/30 text-sent',
  failed: 'border-danger/30 text-danger',
  uncertain: 'border-danger/30 text-danger',
  skipped: 'border-line text-muted',
}

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        STATUS_STYLES[status] ?? 'border-line text-muted'
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function DryRunChip({ dryRun }: { dryRun: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        dryRun ? 'border-amber/50 bg-amber/10 text-ink' : 'border-line text-muted'
      }`}
    >
      {dryRun ? '试运行' : '正式'}
    </span>
  )
}

interface RequestErrorProps {
  error: unknown
  onRetry?: () => void
  onSignOut?: () => void
}

export function RequestError({ error, onRetry, onSignOut }: RequestErrorProps) {
  const unauthorized = isApiError(error) && error.status === 401
  const message = unauthorized
    ? '令牌不对'
    : error instanceof Error
      ? error.message
      : '请求失败'

  return (
    <Card className="border-danger/25 p-5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div>
          <p className="text-[14px] text-danger">{message}</p>
          <p className="mt-1 text-[12px] text-muted">
            {unauthorized ? '请重新输入有效的管理令牌。' : '请确认后端服务可用后重试。'}
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        {unauthorized && onSignOut && (
          <button type="button" onClick={onSignOut} className={secondaryButtonClass}>
            重新输入令牌
          </button>
        )}
        {!unauthorized && onRetry && (
          <button type="button" onClick={onRetry} className={secondaryButtonClass}>
            重试
          </button>
        )}
      </div>
    </Card>
  )
}

/** 密码类输入：右侧一个眼睛按钮，点一下在明文和掩码之间切换。 */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  autoFocus = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        className={`${inputClass} pr-11`}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setShown((current) => !current)}
        aria-label={shown ? '隐藏' : '显示'}
        title={shown ? '隐藏' : '显示'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition hover:text-ink"
      >
        {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}
