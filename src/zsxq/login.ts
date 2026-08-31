/**
 * dsh-zsxq — QR login helper.
 *
 * Launches the system Chrome (playwright-core, channel: 'chrome' — no
 * bundled Chromium download) in a visible window at wx.zsxq.com. The user
 * scans the WeChat QR code; the flow polls the browser context cookies
 * until zsxq_access_token appears, then assembles the full zsxq.com cookie
 * header and hands it to the caller (persisted by the store).
 *
 * A single LoginManager singleton guards concurrent runs per host process.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright-core'

export type LoginPhase = 'idle' | 'launching' | 'waiting' | 'succeeded' | 'timeout' | 'failed'

export interface LoginState {
  phase: LoginPhase
  message: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface LoginStartOptions {
  /** How long to wait for the scan+confirm, default 4 minutes. */
  timeoutMs?: number
  /** Persist the captured cookie (store.setCookie). */
  save: (cookie: string, username?: string) => Promise<void>
  /** Optional callback once the cookie is captured (before persistence). */
  onCookie?: (cookie: string) => void
}

const DEFAULT_TIMEOUT_MS = 4 * 60_000
const POLL_MS = 2_000

function idleState(): LoginState {
  return { phase: 'idle', message: '未启动登录' }
}

export class LoginManager {
  private state: LoginState = idleState()

  getState(): LoginState {
    return { ...this.state }
  }

  private set(partial: Partial<LoginState>): LoginState {
    this.state = { ...this.state, ...partial }
    return this.getState()
  }

  isRunning(): boolean {
    return this.state.phase === 'launching' || this.state.phase === 'waiting'
  }

  /** Assemble the zsxq.com cookie header from a browser context. */
  private static async cookieHeader(context: BrowserContext): Promise<string> {
    const cookies = await context.cookies()
    return cookies
      .filter((c) => c.domain.includes('zsxq.com') && c.value !== '')
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
  }

  async start(options: LoginStartOptions): Promise<LoginState> {
    if (this.isRunning()) {
      return this.set({ message: '登录流程已在运行中，请勿重复启动' })
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const startedAt = new Date().toISOString()
    this.state = { phase: 'launching', message: '正在启动浏览器…', startedAt }

    let browser: Browser | undefined
    try {
      browser = await chromium.launch({
        channel: 'chrome',
        headless: false,
      })
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto('https://wx.zsxq.com', { waitUntil: 'domcontentloaded' })
      this.set({ phase: 'waiting', message: '请在弹出的浏览器窗口中用微信扫码登录知识星球（4 分钟超时）' })

      const deadline = Date.now() + timeoutMs
      let cookie = ''
      while (Date.now() < deadline) {
        cookie = await LoginManager.cookieHeader(context)
        if (cookie.includes('zsxq_access_token=')) break
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }

      if (!cookie.includes('zsxq_access_token=')) {
        this.set({ phase: 'timeout', message: '扫码登录超时（4 分钟未完成），请重试', finishedAt: new Date().toISOString() })
        return this.getState()
      }

      options.onCookie?.(cookie)
      await options.save(cookie)
      this.set({ phase: 'succeeded', message: '扫码登录成功，Cookie 已保存', finishedAt: new Date().toISOString() })
      return this.getState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.set({
        phase: 'failed',
        message: `扫码登录失败: ${message}`,
        error: message,
        finishedAt: new Date().toISOString(),
      })
      return this.getState()
    } finally {
      // 延迟关闭浏览器，避免用户在窗口关闭前错过提示
      setTimeout(() => {
        void browser?.close().catch(() => {})
      }, 1_500)
    }
  }

  /** Reset to idle (e.g. after the panel/agent read a terminal state). */
  reset(): void {
    if (!this.isRunning()) this.state = idleState()
  }
}

/** Shared singleton for the host process. */
export const loginManager = new LoginManager()
