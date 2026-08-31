/**
 * ZSXQ settings panel — rendered inside the web settings page
 * (settings.section entry). Login status, QR-login button (polls the flow),
 * manual cookie paste, test-connection and reset. Plain React, no emoji, no
 * external UI package — inline styles only.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ZsxqApi, type ZsxqConfigView, type ZsxqLoginState, type ZsxqTestResult } from './api.ts'

/** Module-level API client (stateless; the component closes over it). */
const api = new ZsxqApi()

/** One shared style sheet (kept tiny and theme-agnostic). */
const s = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '680px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(128,128,128,0.3)',
    fontSize: '13px',
    color: 'inherit',
  } as const,
  title: { fontWeight: 600, fontSize: '13px', margin: 0 } as const,
  status: { fontSize: '12px', opacity: 0.85, whiteSpace: 'pre-wrap', margin: 0 } as const,
  hint: { fontSize: '12px', opacity: 0.85, lineHeight: '1.5', margin: 0 } as const,
  row: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } as const,
  label: { fontSize: '12px', opacity: 0.85, whiteSpace: 'nowrap' } as const,
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '64px',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)',
    color: 'inherit',
    fontSize: '11px',
    fontFamily: 'monospace',
    resize: 'vertical',
  } as const,
  button: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(128,128,128,0.4)',
    background: 'rgba(128,128,128,0.14)',
    color: 'inherit',
    fontSize: '12px',
  } as const,
  buttonPrimary: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(62,92,154,0.7)',
    background: 'rgba(62,92,154,0.18)',
    color: 'inherit',
    fontSize: '12px',
    fontWeight: 600,
  } as const,
  msg: { fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.9, margin: 0 } as const,
}

/** Status line for the current config view. */
function statusText(view: ZsxqConfigView | null, login: ZsxqLoginState | null): string {
  if (view === null) return '加载中…'
  const auth = view.configured
    ? `已登录（token ${view.accessTokenMasked}，Cookie ${view.cookieAgeDays} 天前更新）`
    : '未登录'
  const flow = login !== null && login.phase !== 'idle' ? ` · 登录流程：${login.message}` : ''
  return auth + flow
}

/** The ZSXQ settings panel component. */
export function ZsxqPanel(): JSX.Element {
  const [view, setView] = useState<ZsxqConfigView | null>(null)
  const [login, setLogin] = useState<ZsxqLoginState | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [testResult, setTestResult] = useState<ZsxqTestResult | null>(null)
  const pollRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [v, l] = await Promise.all([api.getStatus(), api.getLoginStatus()])
      setView(v)
      setLogin(l)
    } catch (error) {
      setMsg('读取状态失败: ' + String(error instanceof Error ? error.message : error))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Stop any pending poll on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [])

  /** Run one async panel action with busy/message bookkeeping. */
  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      setMsg(await action())
    } catch (error) {
      setMsg('操作失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const startLogin = async (): Promise<void> => {
    await run(async () => {
      const result = await api.startLogin()
      // Poll the flow until terminal while the browser window is open.
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
      pollRef.current = window.setInterval(async () => {
        try {
          const state = await api.getLoginStatus()
          setLogin(state)
          if (state.phase === 'succeeded' || state.phase === 'timeout' || state.phase === 'failed') {
            if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null }
            await refresh()
          }
        } catch {
          if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null }
        }
      }, 2000)
      return result.message
    })
  }

  const saveCookie = async (): Promise<void> => {
    await run(async () => {
      if (cookieInput.trim() === '') return '请先粘贴 Cookie'
      const result = await api.saveCookie(cookieInput.trim())
      setCookieInput('')
      await refresh()
      return result.message
    })
  }

  const reset = async (): Promise<void> => {
    await run(async () => {
      const result = await api.reset()
      setCookieInput('')
      await refresh()
      return result.message
    })
  }

  const test = async (): Promise<void> => {
    await run(async () => {
      const result = await api.test()
      setTestResult(result)
      return result.message
    })
  }

  return (
    <div style={s.card}>
      <p style={s.title}>知识星球（zsxq）</p>
      <p style={s.status}>{statusText(view, login)}</p>
      <p style={s.hint}>
        基于知识星球非官方 web API（api.zsxq.com/v2）+ 登录 Cookie 认证。知识星球无官方 API，
        读操作（星球/主题/搜索）较稳定；写操作（发布/评论/点赞）可能被风控。
        支持两种登录方式：扫码登录（推荐）或手动粘贴 Cookie。
      </p>

      <div style={s.row}>
        <button style={s.buttonPrimary} disabled={busy} onClick={() => void startLogin()}>
          扫码登录
        </button>
        <button style={s.button} disabled={busy} onClick={() => void test()}>
          测试连接
        </button>
        {view?.configured === true && (
          <button style={s.button} disabled={busy} onClick={() => void reset()}>
            清除登录
          </button>
        )}
      </div>
      <p style={s.hint}>扫码登录会弹出系统 Chrome 窗口（需本机安装 Chrome），微信扫码后自动保存登录态。</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={s.label}>或手动粘贴 Cookie（浏览器打开 wx.zsxq.com → DevTools → Network → 任选 api.zsxq.com 请求 → 复制 Cookie 请求头）：</span>
        <textarea
          style={s.textarea}
          value={cookieInput}
          onChange={(event) => setCookieInput(event.target.value)}
          placeholder={'zsxq_access_token=…; zsxqsessionid=…; …'}
        />
        <div style={s.row}>
          <button style={s.button} disabled={busy || cookieInput.trim() === ''} onClick={() => void saveCookie()}>
            保存 Cookie
          </button>
        </div>
      </div>

      {testResult !== null && (
        <p style={s.msg}>{testResult.ok ? '✅ ' : '❌ '}{testResult.message}</p>
      )}
      {msg !== '' && <p style={s.msg}>{msg}</p>}
    </div>
  )
}
