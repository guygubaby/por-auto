import ky, { HTTPError } from 'ky'
import type { AiConfig, ReleaseInfo, RunDetail, RunSummary } from './types'

/**
 * 同源部署时留空；以后要指向别的域名，只改这一处。
 */
export const API_BASE = ''

export const apiUrl = (path: string): string => `${API_BASE}${path}`

const http = ky.create({ timeout: 15_000 })

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError

const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
})

function readErrorMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const message = (body as Record<string, unknown>).error
  return typeof message === 'string' ? message : null
}

async function fail(error: unknown): Promise<never> {
  if (error instanceof HTTPError) {
    let message = `请求失败（HTTP ${error.response.status}）`
    try {
      const body: unknown = await error.response.json()
      message = readErrorMessage(body) ?? message
    } catch {
      // 响应不是 JSON，保留默认文案
    }
    throw new ApiError(error.response.status, message)
  }
  if (error instanceof ApiError) throw error
  throw new ApiError(0, error instanceof Error ? `无法连接服务：${error.message}` : '无法连接服务')
}

export async function fetchLatest(): Promise<ReleaseInfo | null> {
  try {
    return await http.get(apiUrl('/latest')).json<ReleaseInfo>()
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 404) return null
    return fail(error)
  }
}

export async function fetchRuns(token: string): Promise<RunSummary[]> {
  try {
    const body = await http
      .get(apiUrl('/api/runs?limit=50'), { headers: bearer(token) })
      .json<{ runs: RunSummary[] }>()
    return body.runs
  } catch (error) {
    return fail(error)
  }
}

export async function fetchRun(token: string, id: string): Promise<RunDetail> {
  try {
    return await http
      .get(apiUrl(`/api/runs/${encodeURIComponent(id)}`), { headers: bearer(token) })
      .json<RunDetail>()
  } catch (error) {
    return fail(error)
  }
}

export async function fetchAiConfig(token: string): Promise<AiConfig | null> {
  try {
    return await http.get(apiUrl('/api/config'), { headers: bearer(token) }).json<AiConfig>()
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 404) return null
    return fail(error)
  }
}

export async function saveAiConfig(token: string, config: AiConfig): Promise<void> {
  try {
    await http.put(apiUrl('/api/config'), { headers: bearer(token), json: config })
  } catch (error) {
    return fail(error)
  }
}

export async function savePasscode(token: string, passcode: string): Promise<number> {
  try {
    const body = await http
      .put(apiUrl('/api/passcode'), { headers: bearer(token), json: { passcode } })
      .json<{ version: number }>()
    return body.version
  } catch (error) {
    return fail(error)
  }
}
