import dayjs from 'dayjs'

export function formatDateTime(value: string | number): string {
  const date = dayjs(value)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : '—'
}

export function formatDate(value: string | number): string {
  const date = dayjs(value)
  return date.isValid() ? date.format('YYYY年M月D日 HH:mm') : '—'
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const KIND_LABELS: Record<string, string> = {
  broadcast: '群发',
  schedule: '定时',
  agent: '智能体',
  assistant: '助手',
}

const SCOPE_LABELS: Record<string, string> = {
  groups: '群聊',
  phone: '手机',
}

function labelFor(labels: Record<string, string>, value: string): string {
  return labels[value] ?? (value || '—')
}

export const kindLabel = (value: string): string => labelFor(KIND_LABELS, value)
export const scopeLabel = (value: string): string => labelFor(SCOPE_LABELS, value)
