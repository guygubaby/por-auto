/**
 * 本地自检：假 R2 + 本地假服务商，跑通模型列表和连通性测试。
 *
 *   node selftest.mjs
 *
 * 不需要 wrangler，Node 24 直接执行 TypeScript。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import worker from './src/index.ts'

const seen = []

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }] }))
    } else if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({ choices: [{ message: { content: '可用' } }] }))
    } else if (req.url === '/anthropic/models') {
      res.end(JSON.stringify({ data: [{ id: 'claude-test' }] }))
    } else if (req.url === '/anthropic/messages') {
      res.end(JSON.stringify({ content: [{ type: 'text', text: '可用' }] }))
    } else if (req.url === '/fail/models') {
      res.statusCode = 401
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
    } else if (req.url === '/blocked/models') {
      // Cloudflare 对非标准端口的出站拦截。
      res.statusCode = 403
      res.end('error code: 1003')
    } else {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'nope' }))
    }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const files = new Map([
  [
    'config/ai.json',
    JSON.stringify({
      provider: 'openai',
      baseUrl: `${origin}/v1`,
      model: 'old-model',
      apiKey: 'stored-key',
    }),
  ],
])
const env = {
  RELEASES: {
    async get(key) {
      const value = files.get(key)
      if (value == null) return null
      return {
        json: async () => JSON.parse(value),
        text: async () => value,
        body: value,
        size: value.length,
      }
    },
    async put(key, value) {
      files.set(key, value)
    },
  },
  ASSETS: { fetch: () => new Response('assets') },
  INGEST_KEY: 'ingest',
  ADMIN_TOKEN: 'admin',
}

const call = (path, body, token = 'admin') =>
  worker.fetch(
    new Request(`https://example.com${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  )

// 1. 列表：末尾斜杠被去掉，Key 留空沿用已保存配置，结果去重排序。
let response = await call('/api/config/models', { provider: 'openai', baseUrl: `${origin}/v1/` })
assert.equal(response.status, 200)
assert.deepEqual((await response.json()).models, ['a-model', 'b-model'])
assert.equal(seen.at(-1).headers.authorization, 'Bearer stored-key')
assert.equal(seen.at(-1).headers['user-agent'], 'PorAuto-Agent/0.1.0')

// 2. 测试：走 chat/completions，解析回复和耗时。
response = await call('/api/config/test', {
  provider: 'openai',
  baseUrl: `${origin}/v1`,
  model: 'test-model',
})
assert.equal(response.status, 200)
const tested = await response.json()
assert.equal(tested.reply, '可用')
assert.equal(tested.model, 'test-model')
assert.equal(typeof tested.latencyMs, 'number')
assert.equal(JSON.parse(seen.at(-1).body).model, 'test-model')

// 3. Anthropic 用自己的头和 /messages。
response = await call('/api/config/models', {
  provider: 'anthropic',
  baseUrl: `${origin}/anthropic`,
  apiKey: 'ant-key',
})
assert.deepEqual((await response.json()).models, ['claude-test'])
assert.equal(seen.at(-1).headers['x-api-key'], 'ant-key')
response = await call('/api/config/test', {
  provider: 'anthropic',
  baseUrl: `${origin}/anthropic`,
  model: 'claude-test',
  apiKey: 'ant-key',
})
assert.equal((await response.json()).reply, '可用')

// 4. 管理令牌不对是 401；上游 401 也不能透传，否则前端会误判管理令牌失效。
response = await call('/api/config/models', { provider: 'openai', baseUrl: `${origin}/v1` }, 'wrong')
assert.equal(response.status, 401)

// 5. 没有可用的 Key 是 400。
files.clear()
response = await call('/api/config/models', { provider: 'openai', baseUrl: `${origin}/v1` })
assert.equal(response.status, 400)
assert.match((await response.json()).error, /API Key/)

// 6. 上游报错是 502，并带上游消息。
response = await call('/api/config/models', {
  provider: 'openai',
  baseUrl: `${origin}/fail`,
  apiKey: 'bad-key',
})
assert.equal(response.status, 502)
assert.match((await response.json()).error, /bad key/)

// 7. Cloudflare 的 1003 换成明确提示，别再让人去查 Key。
response = await call('/api/config/models', {
  provider: 'openai',
  baseUrl: `${origin}/blocked`,
  apiKey: 'bad-key',
})
assert.equal(response.status, 502)
assert.match((await response.json()).error, /443 的 HTTPS 域名/)

server.close()
console.log('worker selftest: ok')
