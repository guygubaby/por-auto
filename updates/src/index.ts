/**
 * 应用内更新后端。只做两件事：
 *   GET /latest       读 R2 里的 latest.json（版本号、大小、sha256、更新说明）
 *   GET /latest.apk   读 R2 里的 latest.apk，直接吐给手机
 * 发版由 scripts/publish.sh 上传，这里不做写入。
 */
interface Env {
  RELEASES: R2Bucket
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/latest') {
      const object = await env.RELEASES.get('latest.json')
      if (!object) {
        return new Response('{"error":"no release"}', { status: 404, headers: JSON_HEADERS })
      }
      return new Response(object.body, { headers: JSON_HEADERS })
    }

    if (pathname === '/latest.apk') {
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

    return new Response('not found', { status: 404 })
  },
}
