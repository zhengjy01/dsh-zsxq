/**
 * dsh-zsxq — live read-API verification.
 *
 * Reads the login cookie from the plugin store (~/.dsh/dsh-zsxq.json) and
 * exercises the four READ endpoints exactly as the plugin client does:
 *   groups  -> GET /v2/groups?scope=joined
 *   topics  -> GET /v2/groups/{id}/topics?scope=all&count=20
 *   topic   -> GET /v2/topics/{id}   (+ comments)
 *   search  -> GET /v2/groups/{id}/topics/search?keyword=…&count=20
 *
 * Usage:
 *   node scripts/verify-read.mjs [keyword] [count]
 *
 * No cookie  -> exits with a clear message.
 * Cookie set -> prints a compact summary per endpoint (no secret leak).
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const API_BASE = 'https://api.zsxq.com/v2'
const WEB_ORIGIN = 'https://wx.zsxq.com'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CONFIG = path.join(homedir(), '.dsh', 'dsh-zsxq.json')

async function readCookie() {
  try {
    const raw = JSON.parse(await readFile(CONFIG, 'utf8'))
    return typeof raw.cookie === 'string' ? raw.cookie : ''
  } catch {
    return ''
  }
}

function headers(cookie, hasBody = false) {
  return {
    Accept: 'application/json',
    'User-Agent': UA,
    Referer: WEB_ORIGIN + '/',
    Origin: WEB_ORIGIN,
    Cookie: cookie,
    ...(hasBody ? { 'Content-Type': 'application/json;charset=UTF-8' } : {}),
  }
}

async function request(cookie, method, pathname, query, body) {
  const url = new URL(API_BASE + pathname)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const resp = await fetch(url, {
    method,
    headers: headers(cookie, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`HTTP ${resp.status}（Cookie 无效或已过期）`)
  }
  const json = await resp.json().catch(() => null)
  if (!json || json.succeeded !== true) {
    const msg = json?.resp_err?.msg ?? `succeeded=false (code=${json?.resp_err?.code ?? '?'})`
    throw new Error(`接口失败: ${msg}`)
  }
  return json.resp_data ?? {}
}

function topicPreview(t) {
  const text = t?.talk?.text ?? t?.question?.text ?? t?.answer?.text ?? ''
  const owner = t?.talk?.owner ?? t?.question?.owner ?? t?.answer?.owner
  return `[${t?.type}] #${t?.topic_id} ${owner?.name ?? '匿名'} ${text.slice(0, 60).replace(/\s+/g, ' ')}`
}

const keyword = process.argv[2] ?? '知识'
const count = Math.min(Math.max(Number(process.argv[3]) || 20, 1), 50)

const cookie = await readCookie()
if (!cookie) {
  console.error('未找到登录 cookie。请先扫码登录或在面板粘贴 cookie（~/.dsh/dsh-zsxq.json）。')
  process.exit(2)
}

console.log('== 1. groups (我的星球列表) ==')
const { groups = [] } = await request(cookie, 'GET', '/groups', { scope: 'joined' })
console.log(`共 ${groups.length} 个星球`)
groups.forEach((g, i) => {
  console.log(`  ${i + 1}. ${g.name}  group_id=${g.group_id}  members=${g.members_count ?? '?'}  topics=${g.topic_count ?? '?'}`)
})
if (groups.length === 0) {
  console.log('没有加入任何星球，无法继续。')
  process.exit(0)
}
const group = groups[0]

console.log(`\n== 2. topics (${group.name} 主题列表, scope=all count=${count}) ==`)
const { topics = [], next_end_time } = await request(cookie, 'GET', `/groups/${group.group_id}/topics`, {
  scope: 'all',
  count,
})
console.log(`共 ${topics.length} 条`)
topics.forEach((t, i) => console.log(`  ${i + 1}. ${topicPreview(t)}`))
if (topics.length === 0) {
  console.log('该星球暂无主题，跳过详情/评论。')
  process.exit(0)
}
const first = topics[0]

console.log(`\n== 3. topic (详情 + 评论, topic_id=${first.topic_id}) ==`)
const { topic } = await request(cookie, 'GET', `/topics/${first.topic_id}`)
console.log(`  ${topicPreview(topic)}`)
const { comments = [] } = await request(cookie, 'GET', `/topics/${first.topic_id}/comments`, { count: 30 })
console.log(`  评论 ${comments.length} 条`)
comments.slice(0, 3).forEach((c) => console.log(`    - ${c.owner?.name}: ${String(c.text ?? '').slice(0, 60)}`))

console.log(`\n== 4. search (在 ${group.name} 内搜「${keyword}」) ==`)
const search = await request(cookie, 'GET', `/groups/${group.group_id}/topics/search`, { keyword, count })
const hits = search.topics ?? []
console.log(`搜到 ${hits.length} 条`)
hits.slice(0, 5).forEach((t, i) => console.log(`  ${i + 1}. ${topicPreview(t)}`))

console.log('\n✅ 读 API 全部通过')
