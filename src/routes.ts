/**
 * dsh-zsxq — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-zsxq/*. All routes are loopback-only
 * (127.0.0.1/localhost, same-origin) — the settings panel is the only
 * consumer.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ZsxqStore } from './store.ts'
import type { LoginManager } from './zsxq/login.ts'
import { ZsxqClient } from './zsxq/client.ts'

/** Route paths. */
export const ZSXQ_API = {
  config: '/api/dsh-zsxq/config',
  status: '/api/dsh-zsxq/status',
  login: '/api/dsh-zsxq/login',
  loginStatus: '/api/dsh-zsxq/login/status',
  test: '/api/dsh-zsxq/test',
} as const

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 256 * 1024

/** Strict loopback fence for all routes. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Route handler context. */
export interface RouteContext {
  store: ZsxqStore
  login: LoginManager
}

/**
 * Build every /api/dsh-zsxq route as exact-match WebRoute entries.
 * @param deps - store + login manager.
 */
export function makeRoutes(deps: RouteContext) {
  const { store, login } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  return [
    {
      kind: 'exact' as const,
      path: ZSXQ_API.status,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          writeJson(res, 200, { ok: true, ...(await store.view()) })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String(error instanceof Error ? error.message : error) })
        }
      },
    },
    {
      kind: 'exact' as const,
      path: ZSXQ_API.config,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { ok: false, error: 'invalid JSON body' })
          return
        }
        if (body.reset === true) {
          await store.clear()
          writeJson(res, 200, { ok: true, message: '已清除知识星球凭据' })
          return
        }
        const cookie = typeof body.cookie === 'string' && body.cookie.trim() !== '' ? body.cookie.trim() : ''
        if (cookie === '') {
          writeJson(res, 400, { ok: false, error: 'cookie 不能为空' })
          return
        }
        await store.setCookie(cookie)
        writeJson(res, 200, { ok: true, message: 'Cookie 已保存', ...(await store.view()) })
      },
    },
    {
      kind: 'exact' as const,
      path: ZSXQ_API.login,
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        if (!guard(_req, res, 'POST')) return
        const state = await login.start({
          save: async (cookie) => {
            await store.setCookie(cookie)
          },
        })
        writeJson(res, 200, { ok: state.phase === 'succeeded' || state.phase === 'waiting' || state.phase === 'launching', ...state })
      },
    },
    {
      kind: 'exact' as const,
      path: ZSXQ_API.loginStatus,
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        if (!guard(_req, res, 'GET')) return
        writeJson(res, 200, { ok: true, ...login.getState() })
      },
    },
    {
      kind: 'exact' as const,
      path: ZSXQ_API.test,
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        if (!guard(_req, res, 'POST')) return
        const config = await store.load()
        if (config.cookie === '') {
          writeJson(res, 400, { ok: false, error: '未配置 Cookie，请先登录或粘贴 Cookie' })
          return
        }
        try {
          const client = new ZsxqClient(config.cookie)
          const ping = await client.ping()
          writeJson(res, 200, { ok: true, message: `连接成功：${ping.groupCount} 个星球`, groupCount: ping.groupCount, firstGroup: ping.firstGroup })
        } catch (error) {
          writeJson(res, 502, { ok: false, error: String(error instanceof Error ? error.message : error) })
        }
      },
    },
  ]
}
