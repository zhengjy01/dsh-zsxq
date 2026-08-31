/**
 * dsh-zsxq — credential store.
 *
 * Persists the Knowledge Planet (知识星球) login cookie (zsxq_access_token /
 * zsxqsessionid/…, captured by the QR-login flow or pasted manually) to
 * ~/.dsh/dsh-zsxq.json (mode 0600). Secrets never leave this module; the
 * public view() masks everything. The config path can be overridden with
 * DSH_ZSXQ_CONFIG (used by tests).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { normalizeCookie, accessTokenFromCookie, maskToken } from './zsxq/client.ts'

/** Default machine-wide config location (mode 0600). */
export const DEFAULT_CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-zsxq.json')

/** Test override for the config location. */
export function configPath(): string {
  const override = process.env.DSH_ZSXQ_CONFIG
  return override !== undefined && override !== '' ? override : DEFAULT_CONFIG_FILE
}

/** Persisted shape. Only the cookie string is secret. */
export interface ZsxqCredentials {
  /** Full login cookie header (zsxq_access_token=…; zsxqsessionid=…). */
  cookie: string
  /** ISO timestamp of the last cookie capture / update. */
  cookieUpdatedAt: string
  /** Optional display name captured during login (not reliable). */
  username: string
}

/** Public, secret-free status view. */
export interface ZsxqConfigView {
  configured: boolean
  hasAccessToken: boolean
  accessTokenMasked: string
  cookieUpdatedAt: string
  cookieAgeDays: number
  configPath: string
}

function empty(): ZsxqCredentials {
  return { cookie: '', cookieUpdatedAt: '', username: '' }
}

function parse(raw: unknown): ZsxqCredentials {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  return {
    cookie: str(record.cookie),
    cookieUpdatedAt: str(record.cookieUpdatedAt),
    username: str(record.username),
  }
}

/**
 * Small credential store backed by ~/.dsh/dsh-zsxq.json.
 * Reads are lazy and cached; writes use mode 0600 so secrets never leak
 * to other local users.
 */
export class ZsxqStore {
  config: ZsxqCredentials | null = null

  async load(): Promise<ZsxqCredentials> {
    if (this.config !== null) return this.config
    try {
      const raw = await readFile(configPath(), 'utf8')
      this.config = parse(JSON.parse(raw))
    } catch {
      this.config = empty()
    }
    return this.config
  }

  async save(credentials: ZsxqCredentials): Promise<void> {
    this.config = credentials
    const file = configPath()
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(credentials, null, 2), { mode: 0o600 })
  }

  /** Update just the cookie, stamping cookieUpdatedAt. */
  async setCookie(cookie: string, username = ''): Promise<ZsxqCredentials> {
    const current = await this.load()
    const updated: ZsxqCredentials = {
      ...current,
      cookie: normalizeCookie(cookie),
      cookieUpdatedAt: new Date().toISOString(),
      username: username || current.username,
    }
    await this.save(updated)
    return updated
  }

  /** Clear credentials (logout). */
  async clear(): Promise<void> {
    await this.save(empty())
  }

  /** Public view with secrets masked. */
  async view(): Promise<ZsxqConfigView> {
    const config = await this.load()
    const token = accessTokenFromCookie(config.cookie)
    const ageDays = config.cookieUpdatedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(config.cookieUpdatedAt)) / 86_400_000))
      : 0
    return {
      configured: config.cookie !== '',
      hasAccessToken: token !== '',
      accessTokenMasked: maskToken(token),
      cookieUpdatedAt: config.cookieUpdatedAt,
      cookieAgeDays: ageDays,
      configPath: configPath(),
    }
  }
}
