/**
 * dsh-zsxq smoke test — validates the store round-trip, cookie
 * normalization/masking, and the ZsxqClient request shaping against a fake
 * fetch (no network, no real ZSXQ credentials). Sets a temp config path via
 * DSH_ZSXQ_CONFIG.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(tmpdir(), 'dsh-zsxq-'))
process.env.DSH_ZSXQ_CONFIG = path.join(root, 'config.json')

const { ZsxqStore, normalizeCookie, accessTokenFromCookie, maskToken, ZsxqClient, ZsxqError, formatTopic } = await import('../lib/index.js')

let failures = 0
function check(label, cond, detail) {
  if (cond) {
    console.log('  ✔ ' + label)
  } else {
    failures++
    console.error('  ✘ ' + label + (detail !== undefined ? ' → ' + String(detail) : ''))
  }
}

console.log('run 1: store round-trip')
const store = new ZsxqStore()
let view = await store.view()
check('unconfigured by default', view.configured === false, JSON.stringify(view))
check('no token masked', view.accessTokenMasked === '', view.accessTokenMasked)

await store.setCookie(' zsxq_access_token=abc12345; zsxqsessionid=xyz;  ')
view = await store.view()
check('configured after cookie', view.configured === true, JSON.stringify(view))
check('token masked', view.accessTokenMasked === 'ab…', view.accessTokenMasked)
check('cookie age >= 0', view.cookieAgeDays >= 0, view.cookieAgeDays)

const cfg = await store.load()
check('raw cookie persisted (normalized)', cfg.cookie === 'zsxq_access_token=abc12345; zsxqsessionid=xyz', JSON.stringify(cfg.cookie))

await store.clear()
view = await store.view()
check('clear resets', view.configured === false && view.accessTokenMasked === '')

console.log('run 2: cookie helpers')
check('normalize trims', normalizeCookie(' a=1;   b=2 ') === 'a=1; b=2', normalizeCookie(' a=1;   b=2 '))
check('access token extracted', accessTokenFromCookie('zsxq_access_token=tok123; zsxqsessionid=sid') === 'tok123')
check('maskToken short', maskToken('abcdefgh') === 'ab…', maskToken('abcdefgh'))
check('maskToken long', maskToken('1234567890abcdef') === '1234…cdef', maskToken('1234567890abcdef'))

console.log('run 3: ZsxqClient against fake fetch')
const seen = []
const fakeFetch = async (url, init) => {
  seen.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body })
  if (String(url).includes('/groups?scope=joined')) {
    return { status: 200, json: async () => ({ succeeded: true, resp_data: { groups: [{ group_id: 111, name: '测试星球' }] } }) }
  }
  if (String(url).includes('/topics?scope=all')) {
    return { status: 200, json: async () => ({ succeeded: true, resp_data: { topics: [{ topic_id: 999, type: 'talk', create_time: '2026-01-01T00:00:00.000+0800', likes_count: 1, comments_count: 2, rewards_count: 0, digested: false, talk: { owner: { user_id: 1, name: '小明', avatar_url: '' }, text: '你好知识星球' } }] } }) }
  }
  return { status: 404, json: async () => ({}) }
}
const originalFetch = globalThis.fetch
globalThis.fetch = fakeFetch
try {
  const client = new ZsxqClient('zsxq_access_token=tok123')
  const groups = await client.listGroups()
  check('groups parsed', groups.length === 1 && groups[0].name === '测试星球', JSON.stringify(groups))
  check('request has cookie header', seen[0].headers.Cookie === 'zsxq_access_token=tok123', JSON.stringify(seen[0].headers))
  check('request has browser UA', typeof seen[0].headers['User-Agent'] === 'string' && seen[0].headers['User-Agent'].includes('Mozilla'), seen[0].headers['User-Agent'])
  check('request has referer/origin', seen[0].headers.Referer === 'https://wx.zsxq.com/' && seen[0].headers.Origin === 'https://wx.zsxq.com', JSON.stringify(seen[0].headers))

  const { topics } = await client.listTopics(111)
  check('topics parsed', topics.length === 1 && topics[0].topic_id === 999, JSON.stringify(topics))
  const formatted = formatTopic(topics[0])
  check('formatTopic contains text', formatted.includes('你好知识星球') && formatted.includes('topic_id: 999'), formatted)

  let authError = false
  try {
    await client.listGroups()
  } catch {
    // fetch stub returns 200 for groups; force the error path below
  }
  globalThis.fetch = async (url) => ({ status: 401, json: async () => ({}) })
  try {
    await new ZsxqClient('zsxq_access_token=x').listTopics(1)
  } catch (error) {
    authError = error instanceof ZsxqError && String(error.message).includes('401')
  }
  check('401 raises ZsxqError with hint', authError)
} finally {
  globalThis.fetch = originalFetch
}

console.log('run 4: routes contract (paths only)')
const { ZSXQ_API } = await import('../lib/index.js')
check('route family present', ZSXQ_API.status === '/api/dsh-zsxq/status' && ZSXQ_API.login === '/api/dsh-zsxq/login' && ZSXQ_API.loginStatus === '/api/dsh-zsxq/login/status' && ZSXQ_API.config === '/api/dsh-zsxq/config' && ZSXQ_API.test === '/api/dsh-zsxq/test', JSON.stringify(ZSXQ_API))

await rm(root, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nsmoke: all checks passed')
