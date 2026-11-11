export interface ReleaseInfo {
  versionCode: number
  versionName: string
  notes: string
  size: number
  sha256: string
  publishedAt: string
}

export interface RunDevice {
  model?: string
  android?: string
  appVersion?: string
  wecomVersion?: string
}

export interface RunSummary {
  id: string
  startedAt: number
  kind: string
  dryRun: boolean
  scope: string
  text: string
  device?: RunDevice
  error: string | null
  total: number
  sent: number
  rehearsed: number
  /** 助手任务执行完的步骤数；群发记录里是 0。 */
  done: number
  failed: number
  skipped: number
}

export type ResultStatus = 'sent' | 'rehearsed' | 'done' | 'failed' | 'skipped' | 'uncertain'

export interface RunResult {
  title: string
  status: ResultStatus
  error: string | null
}

export interface RunDetail extends RunSummary {
  results: RunResult[]
  log: string[]
}
