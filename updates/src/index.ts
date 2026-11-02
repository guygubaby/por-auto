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
