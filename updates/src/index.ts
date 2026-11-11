/**
 * PorAuto 后端，只有一件事：把发版、运行日志、AI 配置放在同一个域名下。
 *
 *   GET  /latest          最新版本（App 检查更新）
 *   GET  /latest.apk      最新安装包
 *   POST /api/runs        App 上传一次完整运行日志（x-ingest-key）
 *   GET  /api/runs        管理端列日志（Authorization: Bearer ADMIN_TOKEN）
 *   GET  /api/runs/<id>   管理端看单条日志
 *   GET  /api/config      App 拉取 AI 配置（x-ingest-key）
 *   PUT  /api/config      管理端写入 AI 配置
 *   POST /api/config/models  管理端按 /models 拉取模型列表
 *   POST /api/config/test    管理端发一次最小请求验证配置
 *   其余路径               交给静态资源，也就是管理端页面
 */
interface Env {
  RELEASES: R2Bucket
  ASSETS: Fetcher
  INGEST_KEY: string
  ADMIN_TOKEN: string
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

const unauthorized = (message: string) => json({ error: message }, 401)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/latest') {
      const object = await env.RELEASES.get('latest.json')
      if (!object) return json({ error: 'no release' }, 404)
      return new Response(object.body, { headers: JSON_HEADERS })
    }

    if (path === '/latest.apk') {
      const object = await env.RELEASES.get('latest.apk')
      if (!object) return new Response('not found', { status: 404 })
      return new Response(object.body, {
        headers: {
          'content-type': 'application/vnd.android.package-archive',
          'content-length': String(object.size),
          'cache-control': 'no-store',
        },
      })
    }

    if (path === '/api/runs' && request.method === 'POST') {
      if (!env.INGEST_KEY || request.headers.get('x-ingest-key') !== env.INGEST_KEY) {
        return unauthorized('ingest key 不对')
      }
      const text = await request.text()
      if (text.length > 512 * 1024) return json({ error: '日志太大' }, 413)
      let payload: { id?: string; startedAt?: number }
      try {
        payload = JSON.parse(text)
      } catch {
        return json({ error: '不是合法 JSON' }, 400)
      }
      const startedAt = Number(payload.startedAt) || Date.now()
      const id = `${new Date(startedAt).toISOString()}-${crypto.randomUUID().slice(0, 8)}`
      await env.RELEASES.put(`runs/${id}.json`, text, {
        httpMetadata: { contentType: 'application/json' },
      })
      return json({ id })
    }

    if (path === '/api/runs' && request.method === 'GET') {
      if (!isAdmin(request, env)) return unauthorized('需要管理令牌')
      const requested = Number(url.searchParams.get('limit')) || 50
      const limit = Math.min(Math.max(requested, 1), 200)
      // R2 按 key 升序返回，先取全量再自己倒序，否则只拿到最旧的一页。
      const listed = await env.RELEASES.list({ prefix: 'runs/', limit: 1000 })
      const runs = await Promise.all(
        listed.objects
          .sort((a, b) => b.key.localeCompare(a.key))
          .slice(0, limit)
          .map(async (object) => {
            const stored = await env.RELEASES.get(object.key)
            if (!stored) return null
            const raw = await stored.text()
            try {
              const run = JSON.parse(raw)
              return summarize(run, object.key.replace(/^runs\//, '').replace(/\.json$/, ''))
            } catch {
              return null
            }
          }),
      )
      return json({ runs: runs.filter(Boolean) })
    }

    if (path.startsWith('/api/runs/') && request.method === 'GET') {
      if (!isAdmin(request, env)) return unauthorized('需要管理令牌')
      const id = decodeURIComponent(path.slice('/api/runs/'.length))
      const object = await env.RELEASES.get(`runs/${id}.json`)
      if (!object) return json({ error: '没有这条日志' }, 404)
      const run = await object.json<Record<string, unknown>>()
      return json({ ...summarize(run, id), results: run.results ?? [], log: run.log ?? [] })
    }

    if (path === '/api/passcode' && request.method === 'GET') {
      if (!env.INGEST_KEY || request.headers.get('x-ingest-key') !== env.INGEST_KEY) {
        return unauthorized('ingest key 不对')
      }
      const object = await env.RELEASES.get('config/passcode.json')
      if (!object) return json({ error: '还没设置口令' }, 404)
      // 只回版本号：指纹本身不能下发，否则拿到 APK 的人就能直接换配置。
      const { version } = await object.json<{ version: number }>()
      return json({ version })
    }

    if (path === '/api/passcode' && request.method === 'PUT') {
      if (!isAdmin(request, env)) return unauthorized('需要管理令牌')
      const body = await request.json<{ passcode?: string }>().catch(() => null)
      const passcode = body?.passcode?.trim()
      if (!passcode) return json({ error: '口令不能为空' }, 400)
      const previous = await env.RELEASES.get('config/passcode.json')
      const version = previous ? ((await previous.json<{ version: number }>()).version || 0) + 1 : 1
      const stored = { version, sha256: await sha256(passcode), updatedAt: new Date().toISOString() }
      await env.RELEASES.put('config/passcode.json', JSON.stringify(stored), {
        httpMetadata: { contentType: 'application/json' },
      })
      return json(stored)
    }

    if (path === '/api/config' && request.method === 'GET') {
      if (!isAdmin(request, env)) {
        if (!env.INGEST_KEY || request.headers.get('x-ingest-key') !== env.INGEST_KEY) {
          return unauthorized('ingest key 不对')
        }
        // 服务端设了口令就必须带上正确的口令指纹，AI 配置才不会被人白拿。
        const guard = await env.RELEASES.get('config/passcode.json')
        if (guard) {
          const { sha256: expected } = await guard.json<{ sha256: string }>()
          if (request.headers.get('x-passcode-sha256') !== expected) {
            return unauthorized('口令不对')
          }
        }
      }
      const object = await env.RELEASES.get('config/ai.json')
      if (!object) return json({ error: '还没配置' }, 404)
      return new Response(object.body, { headers: JSON_HEADERS })
    }

    if (path === '/api/config' && request.method === 'PUT') {
      if (!isAdmin(request, env)) return unauthorized('需要管理令牌')
      const text = await request.text()
      try {
        JSON.parse(text)
      } catch {
        return json({ error: '不是合法 JSON' }, 400)
      }
      await env.RELEASES.put('config/ai.json', text, {
        httpMetadata: { contentType: 'application/json' },
      })
      return json({ ok: true })
    }

    if (path === '/api/config/models' && request.method === 'POST') {
      if (!isAdmin(request, env)) return unauthorized('需要管理令牌')
      const probe = await readProbe(request, env, false)
      if (probe instanceof Response) return probe
      let response: Response
      try {
        response = await fetch(`${probe.baseUrl}/models`, {
          headers: { accept: 'application/json', ...aiHeaders(probe) },
          signal: AbortSignal.timeout(15_000),
        })
      } catch (error) {
        return json({ error: timeoutMessage(error) }, 502)
      }
      if (!response.ok) return json({ error: await upstreamMessage(response) }, 502)
      const models = modelIds(await response.json().catch(() => null))
      if (!models.length) return json({ error: '/models 没有返回模型列表' }, 502)
      return json({ models })
    }

    if (path === '/api/config/test' && request.method === 'POST') {
      if (!isAdmin(request, env)) return unauthorized('需要管理令牌')
      const probe = await readProbe(request, env, true)
      if (probe instanceof Response) return probe
      const anthropic = probe.provider === 'anthropic'
      const prompt = '回复两个字：可用'
      const payload = anthropic
        ? { model: probe.model, max_tokens: 64, messages: [{ role: 'user', content: prompt }] }
        : { model: probe.model, messages: [{ role: 'user', content: prompt }] }
      const startedAt = Date.now()
      let response: Response
      try {
        response = await fetch(`${probe.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...aiHeaders(probe),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        })
      } catch (error) {
        return json({ error: timeoutMessage(error) }, 502)
      }
      if (!response.ok) return json({ error: await upstreamMessage(response) }, 502)
      const reply = replyText(probe.provider, await response.json().catch(() => null))
      if (!reply) return json({ error: '接口通了，但没有解析到回复内容' }, 502)
      return json({ reply, model: probe.model, latencyMs: Date.now() - startedAt })
    }

    return env.ASSETS.fetch(request)
  },
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isAdmin(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false
  const header = request.headers.get('authorization') || ''
  return header === `Bearer ${env.ADMIN_TOKEN}`
}

type Provider = 'openai' | 'anthropic' | 'opencode'

interface Probe {
  provider: Provider
  baseUrl: string
  model: string
  apiKey: string
}

const normalizeBase = (value: string) => value.trim().replace(/\/+$/, '')

/** 管理端提交的探测参数；Key 留空时沿用已保存配置（仅在协议和地址都没变时）。 */
async function readProbe(request: Request, env: Env, needModel: boolean): Promise<Probe | Response> {
  const body = await request
    .json<{ provider?: string; baseUrl?: string; model?: string; apiKey?: string }>()
    .catch(() => null)
  if (!body) return json({ error: '不是合法 JSON' }, 400)

  const { provider } = body
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'opencode') {
    return json({ error: '服务商不认识' }, 400)
  }

  const baseUrl = normalizeBase(body.baseUrl ?? '')
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return json({ error: 'Base URL 不合法' }, 400)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return json({ error: 'Base URL 只支持 http/https' }, 400)
  }

  const model = (body.model ?? '').trim()
  if (needModel && !model) return json({ error: '先填模型名' }, 400)

  let apiKey = (body.apiKey ?? '').trim()
  if (!apiKey) {
    const saved = await env.RELEASES.get('config/ai.json')
    const stored = saved
      ? await saved
          .json<{ provider?: string; baseUrl?: string; apiKey?: string }>()
          .catch(() => null)
      : null
    if (
      stored?.apiKey &&
      stored.provider === provider &&
      normalizeBase(stored.baseUrl ?? '') === baseUrl
    ) {
      apiKey = stored.apiKey
    }
  }
  if (!apiKey) return json({ error: '没有可用的 API Key：填上再试，或先保存一次配置' }, 400)

  return { provider, baseUrl, model, apiKey }
}

function aiHeaders(probe: Probe): Record<string, string> {
  const base = { 'user-agent': 'PorAuto-Agent/0.1.0' }
  switch (probe.provider) {
    case 'anthropic':
      return { ...base, 'x-api-key': probe.apiKey, 'anthropic-version': '2023-06-01' }
    case 'opencode':
      return {
        ...base,
        authorization: `Bearer ${probe.apiKey}`,
        'x-opencode-session': crypto.randomUUID(),
      }
    default:
      return { ...base, authorization: `Bearer ${probe.apiKey}` }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function modelIds(body: unknown): string[] {
  const list = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : []
  const ids = list
    .map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''
      const id = item.id ?? item.name ?? item.model
      return typeof id === 'string' ? id : ''
    })
    .filter((id) => id.length > 0)
  return [...new Set(ids)].sort()
}

function replyText(provider: Provider, body: unknown): string {
  if (!isRecord(body)) return ''
  if (provider === 'anthropic') {
    const block = Array.isArray(body.content) ? body.content.find(isRecord) : undefined
    return typeof block?.text === 'string' ? block.text.trim() : ''
  }
  const choice = Array.isArray(body.choices) ? body.choices.find(isRecord) : undefined
  const message = choice && isRecord(choice.message) ? choice.message : undefined
  return typeof message?.content === 'string' ? message.content.trim() : ''
}

async function upstreamMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  // 这个是 Cloudflare 自己拦的，请求没到网关；直说原因，别让人去查 API Key。
  if (response.status === 403 && /error code:\s*1003/i.test(text)) {
    return 'Cloudflare 拦截了 Worker 到非标准端口的请求（error 1003）：Base URL 请改用 443 的 HTTPS 域名'
  }
  let detail = text.trim().slice(0, 300)
  try {
    const body: unknown = JSON.parse(text)
    if (isRecord(body)) {
      const error = body.error
      const message =
        typeof error === 'string'
          ? error
          : isRecord(error) && typeof error.message === 'string'
            ? error.message
            : ''
      if (message) detail = message
    }
  } catch {
    // 不是 JSON，保留原始片段
  }
  return `上游 HTTP ${response.status}${detail ? `：${detail}` : ''}`
}

function timeoutMessage(error: unknown): string {
  return error instanceof Error && error.name === 'TimeoutError'
    ? '请求超时，检查 Base URL 和网络'
    : '连不上这个 Base URL'
}

function summarize(run: Record<string, unknown>, id: string) {
  const results = Array.isArray(run.results) ? (run.results as Array<Record<string, unknown>>) : []
  const count = (status: string) => results.filter((item) => item.status === status).length
  return {
    id,
    startedAt: run.startedAt ?? 0,
    kind: run.kind ?? '',
    dryRun: run.dryRun,
    scope: run.scope,
    text: run.text,
    device: run.device ?? {},
    error: run.error,
    total: results.length,
    sent: count('sent'),
    rehearsed: count('rehearsed'),
    failed: count('failed'),
    skipped: count('skipped'),
  }
}
