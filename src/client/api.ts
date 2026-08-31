/**
 * Browser-side API client for the /api/dsh-zsxq route family.
 * The only data access path the settings panel uses — plain fetch, same origin.
 */

/** Public config view (mirrors the host contract). */
export interface ZsxqConfigView {
  configured: boolean
  hasAccessToken: boolean
  accessTokenMasked: string
  cookieUpdatedAt: string
  cookieAgeDays: number
  configPath: string
}

/** Login flow state (mirrors the host LoginState). */
export interface ZsxqLoginState {
  phase: string
  message: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

/** Test result. */
export interface ZsxqTestResult {
  ok: boolean
  message: string
  groupCount?: number
  firstGroup?: string
}

/** Error carrying the route's JSON error message. */
export class ZsxqApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZsxqApiError'
  }
}

/** Parse a JSON response or throw a ZsxqApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ZsxqApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `HTTP ${response.status}`
    throw new ZsxqApiError(message)
  }
  return body as T
}

/** Plain fetch helper with an error wrapper. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new ZsxqApiError('网络请求失败: ' + String(error instanceof Error ? error.message : error))
  }
  return readJson<T>(response)
}

/** Browser-side client for the zsxq settings API. */
export class ZsxqApi {
  getStatus(): Promise<ZsxqConfigView> {
    return request('/api/dsh-zsxq/status')
  }

  getLoginStatus(): Promise<ZsxqLoginState> {
    return request('/api/dsh-zsxq/login/status')
  }

  saveCookie(cookie: string): Promise<{ ok: boolean; message: string }> {
    return request('/api/dsh-zsxq/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie }),
    })
  }

  reset(): Promise<{ ok: boolean; message: string }> {
    return request('/api/dsh-zsxq/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })
  }

  startLogin(): Promise<{ ok: boolean; message: string; phase: string }> {
    return request('/api/dsh-zsxq/login', { method: 'POST' })
  }

  test(): Promise<ZsxqTestResult> {
    return request('/api/dsh-zsxq/test', { method: 'POST' })
  }
}
