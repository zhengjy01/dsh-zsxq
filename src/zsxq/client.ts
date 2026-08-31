/**
 * dsh-zsxq — Knowledge Planet (知识星球) unofficial web API client.
 *
 * ZSXQ has NO official open API. Everything here talks to the web front-end
 * API at https://api.zsxq.com/v2 authenticated by the browser login cookie
 * (zsxq_access_token / zsxqsessionid). Read endpoints (groups / topics /
 * topic detail / search) are plain GET + cookie + browser headers — no
 * signature (the signed /v1/* endpoints are the mobile-app surface; /v2/*
 * is the web surface and is what every working open-source client uses).
 *
 * Write endpoints (publish / comment / like) are reverse-engineered and may
 * be rate-limited or risk-flagged by ZSXQ's anti-bot — the plugin always
 * surfaces this caveat to the user.
 */

const API_BASE = 'https://api.zsxq.com/v2'
const WEB_ORIGIN = 'https://wx.zsxq.com'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** ZSXQ topic types seen in the wild. */
export type TopicType = 'talk' | 'q&a' | 'solution' | 'task' | 'file' | string

export interface ZsxqOwner {
  user_id: number
  name: string
  avatar_url: string
}

export interface ZsxqImage {
  image_id?: number
  type?: string
  thumbnail?: { url: string }
  large?: { url: string }
}

export interface ZsxqTopic {
  topic_id: number
  topic_uid?: string
  type: TopicType
  create_time: string
  likes_count: number
  comments_count: number
  rewards_count: number
  digested: boolean
  group_id?: number
  talk?: {
    owner: ZsxqOwner
    text: string
    images?: ZsxqImage[]
  }
  question?: {
    owner: ZsxqOwner
    text: string
  }
  answer?: {
    owner: ZsxqOwner
    text: string
  }
}

export interface ZsxqComment {
  comment_id: number
  create_time: string
  owner: ZsxqOwner
  text: string
}

export interface ZsxqGroup {
  group_id: number
  name: string
  description?: string
  type?: string
  background_url?: string
  topic_count?: number
  members_count?: number
  category?: { name: string }
  create_time?: string
}

/** Standard ZSXQ envelope: { succeeded, resp_data } (errors also carry resp_err). */
interface ZsxqEnvelope<T> {
  succeeded: boolean
  resp_data?: T
  resp_err?: { code: number; msg: string }
}

export class ZsxqError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly apiCode?: number,
  ) {
    super(message)
    this.name = 'ZsxqError'
  }
}

/** Normalize a raw cookie header string for storage/round-trip. */
export function normalizeCookie(cookie: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ')
}

/** Extract the first zsxq_access_token value (used for masked display). */
export function accessTokenFromCookie(cookie: string): string {
  const m = /zsxq_access_token=([^;\s]+)/.exec(cookie)
  return m ? m[1] : ''
}

export function maskToken(token: string): string {
  if (!token) return ''
  return token.length <= 8 ? token.slice(0, 2) + '…' : token.slice(0, 4) + '…' + token.slice(-4)
}

export class ZsxqClient {
  constructor(private readonly cookie: string) {}

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': BROWSER_UA,
      Referer: WEB_ORIGIN + '/',
      Origin: WEB_ORIGIN,
      Cookie: this.cookie,
      ...extra,
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, string | number>,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(API_BASE + path)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
      }
    }
    const headers = this.buildHeaders(
      body !== undefined ? { 'Content-Type': 'application/json;charset=UTF-8' } : undefined,
    )
    const resp = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // ZSXQ anti-bot may stall; keep a generous timeout.
      signal: AbortSignal.timeout(30_000),
    })
    if (resp.status === 401 || resp.status === 403) {
      throw new ZsxqError(
        `知识星球返回 ${resp.status}（Cookie 无效或已过期，请重新登录）`,
        resp.status,
      )
    }
    let json: ZsxqEnvelope<T>
    try {
      json = (await resp.json()) as ZsxqEnvelope<T>
    } catch {
      const raw = await resp.text().catch(() => '')
      throw new ZsxqError(
        `知识星球返回非 JSON（HTTP ${resp.status}）${raw !== '' ? ': ' + raw.slice(0, 200) : ''}，可能是风控或接口变更`,
        resp.status,
      )
    }
    if (!json.succeeded) {
      const msg = json.resp_err?.msg ?? `succeeded=false（code=${json.resp_err?.code ?? '?'}）`
      throw new ZsxqError(`知识星球接口失败: ${msg}`, resp.status, json.resp_err?.code)
    }
    return json.resp_data as T
  }

  /** 我加入的星球列表。scope=joined 为主端点，401/404 时回退到无参 /groups。 */
  async listGroups(): Promise<ZsxqGroup[]> {
    try {
      const data = await this.request<{ groups: ZsxqGroup[] }>('GET', '/groups', { scope: 'joined' })
      return data.groups ?? []
    } catch (error) {
      if (error instanceof ZsxqError && error.status === 401) throw error
      // 部分账号/时段 scope=joined 不可用，回退无参
      const data = await this.request<{ groups: ZsxqGroup[] }>('GET', '/groups')
      return data.groups ?? []
    }
  }

  /** 星球内主题列表。scope: all=全部 / digested=精华；endTime 用于分页（返回的 next_end_time 或最后一条 create_time）。 */
  async listTopics(groupId: string | number, scope: 'all' | 'digested' = 'all', count = 20, endTime?: string): Promise<{ topics: ZsxqTopic[]; nextEndTime?: string }> {
    const data = await this.request<{ topics: ZsxqTopic[]; next_end_time?: string }>(
      'GET',
      `/groups/${groupId}/topics`,
      { scope, count, end_time: endTime ?? '' },
    )
    return { topics: data.topics ?? [], nextEndTime: data.next_end_time }
  }

  /** 主题详情（含 talk/question/answer 内容）。 */
  async getTopic(topicId: string | number): Promise<{ topic: ZsxqTopic }> {
    return this.request<{ topic: ZsxqTopic }>('GET', `/topics/${topicId}`)
  }

  /** 主题评论列表。 */
  async listComments(topicId: string | number, count = 30): Promise<{ comments: ZsxqComment[] }> {
    const data = await this.request<{ comments: ZsxqComment[] }>(
      'GET',
      `/topics/${topicId}/comments`,
      { count },
    )
    return { comments: data.comments ?? [] }
  }

  /** 星球内搜索主题。 */
  async searchTopics(groupId: string | number, keyword: string, count = 20): Promise<{ topics: ZsxqTopic[] }> {
    const data = await this.request<{ topics: ZsxqTopic[] }>(
      'GET',
      `/groups/${groupId}/topics/search`,
      { keyword, count },
    )
    return { topics: data.topics ?? [] }
  }

  /** 发布主题（写操作，非官方接口，可能被风控）。 */
  async publish(groupId: string | number, content: string): Promise<{ topic_id: number }> {
    return this.request<{ topic_id: number }>('POST', `/groups/${groupId}/topics`, undefined, {
      req_data: { text: content, image_ids: [] },
    })
  }

  /** 发表评论（写操作）。 */
  async comment(topicId: string | number, content: string): Promise<{ comment_id: number }> {
    return this.request<{ comment_id: number }>('POST', `/topics/${topicId}/comments`, undefined, {
      req_data: { text: content },
    })
  }

  /** 点赞主题（写操作）。 */
  async like(topicId: string | number): Promise<Record<string, never>> {
    return this.request<Record<string, never>>('POST', `/topics/${topicId}/likes`)
  }

  /** 轻量连通性自检：拉取星球列表（不打印内容）。 */
  async ping(): Promise<{ groupCount: number; firstGroup?: string }> {
    const groups = await this.listGroups()
    return { groupCount: groups.length, firstGroup: groups[0]?.name }
  }
}

/** 把主题渲染成便于阅读的文本（agent 工具输出用）。 */
export function formatTopic(topic: ZsxqTopic): string {
  const typeLabel: Record<string, string> = {
    talk: '说说',
    'q&a': '问答',
    solution: '解答',
    task: '任务',
    file: '文件',
  }
  const kind = typeLabel[topic.type] ?? topic.type
  const owner = topic.talk?.owner ?? topic.question?.owner ?? topic.answer?.owner
  const text = topic.talk?.text ?? topic.question?.text ?? topic.answer?.text ?? ''
  const images = (topic.talk?.images ?? [])
    .map((img) => img.large?.url ?? img.thumbnail?.url ?? '')
    .filter(Boolean)
  const lines = [
    `[${kind}] ${owner?.name ?? '匿名'} · ${topic.create_time}`,
    `topic_id: ${topic.topic_id}`,
    `👍${topic.likes_count} 💬${topic.comments_count} ⭐${topic.rewards_count}${topic.digested ? ' · 精华' : ''}`,
    '',
    text || '（无文本内容）',
  ]
  for (const url of images) lines.push('', `![图片](${url})`)
  return lines.join('\n')
}
