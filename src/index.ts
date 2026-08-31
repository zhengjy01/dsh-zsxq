/**
 * dsh-zsxq — Knowledge Planet (知识星球) integration for DeepSeek Harness.
 * Host half.
 *
 * Mounts the /api/dsh-zsxq route family (settings panel + login flow),
 * the agent tools (zsxq_status / zsxq_config / zsxq_login / zsxq_groups /
 * zsxq_topics / zsxq_topic / zsxq_search / zsxq_publish / zsxq_comment /
 * zsxq_like), and a system-prompt announcement. Auth is the ZSXQ login
 * cookie captured by the QR-login flow (system Chrome window) or pasted
 * manually; every read call goes through the unofficial web API at
 * https://api.zsxq.com/v2. Plugin config lives in ~/.dsh/dsh-zsxq.json
 * (0600).
 *
 * NOTE: ZSXQ has NO official API. Read endpoints are stable in practice;
 * write endpoints (publish/comment/like) are reverse-engineered and may be
 * rate-limited or risk-flagged by ZSXQ's anti-bot.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { ZsxqStore } from './store.ts'
import { loginManager, type LoginManager } from './zsxq/login.ts'
import { ZsxqClient, formatTopic, ZsxqError } from './zsxq/client.ts'
import { makeRoutes, ZSXQ_API } from './routes.ts'

/** Stable cordis plugin name. */
export const name = 'zsxq-mcp'

/** Services required before the plugin surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 220

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const ZSXQ_GUIDANCE =
  '本机已安装 dsh-zsxq 插件（知识星球 zsxq 集成）：基于知识星球非官方 web API（api.zsxq.com/v2）+ 登录 Cookie 认证，提供读与写能力。' +
  '工具：zsxq_status（状态）、zsxq_config（配置/清除 Cookie）、zsxq_login（扫码登录）、zsxq_groups（我的星球列表）、zsxq_topics（星球主题列表）、zsxq_topic（主题详情+评论）、zsxq_search（星球内搜索）、zsxq_publish（发布主题）、zsxq_comment（评论）、zsxq_like（点赞）。' +
  '前提：需先完成登录（zsxq_login 弹出浏览器窗口扫码，或在设置面板粘贴 Cookie）。' +
  '注意：知识星球无官方 API，读操作（列表/详情/搜索）较稳定；写操作（发布/评论/点赞）为非官方接口，可能被风控，使用前请确认。' +
  '用户提到「知识星球 / zsxq / 星球内容」时即指本插件，请据此协作。'

/** Plugin config, read from the composition row. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, prompt section, tools). */
  enabled?: boolean
}

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Shared tool dependencies. */
export interface ToolContext {
  store: ZsxqStore
  login: LoginManager
}

/** Build a ZsxqClient from the stored cookie (throws ZsxqError when absent). */
async function clientOf(store: ZsxqStore): Promise<ZsxqClient> {
  const config = await store.load()
  if (config.cookie === '') {
    throw new ZsxqError('未配置知识星球 Cookie，请先 zsxq_login 扫码登录或在设置面板粘贴 Cookie')
  }
  return new ZsxqClient(config.cookie)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Cast typed object arrays to the tool-output schema shape (Record<string, JsonValue>). */
function toJsonArray<T extends object>(items: T[]): Array<Record<string, JsonValue>> {
  return items as unknown as Array<Record<string, JsonValue>>
}

/** Cast one typed object to the schema shape (undefined when null/absent). */
function toJson<T extends object>(item: T | null | undefined): Record<string, JsonValue> | undefined {
  return item === null || item === undefined ? undefined : (item as unknown as Record<string, JsonValue>)
}

/** Status tool: cookie + login flow state. */
export function zsxqStatusTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_status',
    description: '查看 dsh-zsxq 插件状态：是否已登录知识星球（Cookie 是否配置/有效）、Cookie 更新时间与年龄、扫码登录流程状态。不会泄露 Cookie。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          configured: { type: 'boolean' },
          accessTokenMasked: { type: 'string' },
          cookieUpdatedAt: { type: 'string' },
          cookieAgeDays: { type: 'number' },
          loginPhase: { type: 'string' },
          loginMessage: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      try {
        const view = await ctx.store.view()
        const login = ctx.login.getState()
        const parts: string[] = [
          '知识星球：' + (view.configured ? `已登录（token ${view.accessTokenMasked}，Cookie ${view.cookieAgeDays} 天前更新）` : '未登录（请 zsxq_login 扫码登录或粘贴 Cookie）'),
          '登录流程：' + login.message,
        ]
        return { ok: true, message: parts.join('\n'), ...view, loginPhase: login.phase, loginMessage: login.message }
      } catch (error) {
        return { ok: false, message: '读取状态失败: ' + errorMessage(error) }
      }
    },
  })
}

/** Config tool: set/clear the cookie. */
export function zsxqConfigTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_config',
    description: '配置 dsh-zsxq 知识星球凭据：cookie 为浏览器知识星球（wx.zsxq.com）登录态的完整 Cookie 字符串（含 zsxq_access_token）。配置持久化到 ~/.dsh/dsh-zsxq.json（0600）。传 reset: true 清除凭据（退出登录）。',
    parameters: {
      cookie: { type: 'string', description: '知识星球登录 Cookie（浏览器 DevTools 里从 api.zsxq.com 请求复制）' },
      reset: { type: 'boolean', description: '设为 true 清除已保存的 Cookie' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          configured: { type: 'boolean' },
          accessTokenMasked: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        if (args !== undefined && args.reset === true) {
          await ctx.store.clear()
          return { ok: true, message: '已清除知识星球凭据（退出登录）。', configured: false, accessTokenMasked: '', configPath: (await ctx.store.view()).configPath }
        }
        const cookie = typeof args?.cookie === 'string' ? args.cookie.trim() : ''
        if (cookie === '') return { ok: false, message: '缺少 cookie 参数。', configured: false, accessTokenMasked: '', configPath: (await ctx.store.view()).configPath }
        await ctx.store.setCookie(cookie)
        const view = await ctx.store.view()
        return { ok: true, message: `Cookie 已保存（token ${view.accessTokenMasked}），可用 zsxq_groups 验证。`, configured: true, accessTokenMasked: view.accessTokenMasked, configPath: view.configPath }
      } catch (error) {
        return { ok: false, message: '配置失败: ' + errorMessage(error) }
      }
    },
  })
}

/** Login tool: start the QR login flow. */
export function zsxqLoginTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_login',
    description: '开始知识星球扫码登录：弹出系统 Chrome 窗口打开 wx.zsxq.com，用户用微信扫码登录，插件自动抓取 Cookie 保存。登录中可用 zsxq_status 查看进度。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          phase: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      try {
        const state = await ctx.login.start({
          save: async (cookie) => {
            await ctx.store.setCookie(cookie)
          },
        })
        const message =
          state.phase === 'succeeded'
            ? '扫码登录成功，Cookie 已保存。'
            : state.phase === 'failed'
              ? `登录失败：${state.message}`
              : `已启动扫码登录：${state.message}`
        return { ok: state.phase === 'succeeded' || state.phase === 'waiting' || state.phase === 'launching', message, phase: state.phase }
      } catch (error) {
        return { ok: false, message: '启动登录失败: ' + errorMessage(error) }
      }
    },
  })
}

/** Groups tool: my planet list. */
export function zsxqGroupsTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_groups',
    description: '获取知识星球登录账号加入的星球列表（星球 ID、名称、成员数等）。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          groups: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      try {
        const client = await clientOf(ctx.store)
        const groups = await client.listGroups()
        if (groups.length === 0) return { ok: true, message: '没有加入任何星球。', groups: [] }
        const lines = groups.map((g, i) => `${i + 1}. ${g.name}（group_id: ${g.group_id}${g.members_count ? `，成员 ${g.members_count}` : ''}${g.topic_count ? `，主题 ${g.topic_count}` : ''}）`)
        return { ok: true, message: `共 ${groups.length} 个星球：\n` + lines.join('\n'), groups: toJsonArray(groups) }
      } catch (error) {
        return { ok: false, message: '获取星球列表失败: ' + errorMessage(error), groups: [] }
      }
    },
  })
}

/** Topics tool: topic list of a group. */
export function zsxqTopicsTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_topics',
    description: '获取指定星球（group_id，见 zsxq_groups）的主题/帖子列表。scope=all（默认）全部 / digested 只看精华；count 条数（默认 20，最多 50）；end_time 分页游标（上一页返回的 nextEndTime）。',
    parameters: {
      group_id: { type: 'string', description: '星球 ID（zsxq_groups 获取）' },
      scope: { type: 'string', enum: ['all', 'digested'], description: 'all=全部（默认），digested=精华' },
      count: { type: 'number', description: '条数（默认 20，最多 50）' },
      end_time: { type: 'string', description: '可选：分页游标（上一页 nextEndTime）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          topics: { type: 'array', items: { type: 'object', additionalProperties: true } },
          nextEndTime: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        const groupId = String(args?.group_id ?? '')
        if (groupId === '') return { ok: false, message: '缺少 group_id 参数。', topics: [], nextEndTime: '' }
        const scope = args?.scope === 'digested' ? 'digested' : 'all'
        const count = Math.min(Math.max(Number(args?.count) || 20, 1), 50)
        const endTime = typeof args?.end_time === 'string' ? args.end_time : undefined
        const client = await clientOf(ctx.store)
        const { topics, nextEndTime } = await client.listTopics(groupId, scope, count, endTime)
        if (topics.length === 0) return { ok: true, message: '该星球暂无主题。', topics: [], nextEndTime: nextEndTime ?? '' }
        const lines = topics.map((t, i) => `${i + 1}. ${formatTopic(t)}`)
        return { ok: true, message: `共 ${topics.length} 条主题：\n\n` + lines.join('\n\n---\n\n'), topics: toJsonArray(topics), nextEndTime: nextEndTime ?? '' }
      } catch (error) {
        return { ok: false, message: '获取主题失败: ' + errorMessage(error), topics: [], nextEndTime: '' }
      }
    },
  })
}

/** Topic detail tool: detail + comments. */
export function zsxqTopicTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_topic',
    description: '获取知识星球主题详情（topic_id，见 zsxq_topics）与评论。with_comments=false 时不拉评论。',
    parameters: {
      topic_id: { type: 'string', description: '主题 ID' },
      with_comments: { type: 'boolean', description: '是否同时返回评论（默认 true）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          topic: { type: 'object', additionalProperties: true },
          comments: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        const topicId = String(args?.topic_id ?? '')
        if (topicId === '') return { ok: false, message: '缺少 topic_id 参数。', topic: undefined, comments: [] }
        const withComments = args?.with_comments !== false
        const client = await clientOf(ctx.store)
        const { topic } = await client.getTopic(topicId)
        const parts = [formatTopic(topic)]
        let comments: Array<Record<string, JsonValue>> = []
        if (withComments) {
          const list = await client.listComments(topicId)
          comments = toJsonArray(list.comments)
          if (list.comments.length > 0) {
            parts.push('', `💬 评论（${list.comments.length}）：`)
            for (const c of list.comments) {
              parts.push(`- ${c.owner.name}（${c.create_time}）：${c.text}`)
            }
          }
        }
        return { ok: true, message: parts.join('\n'), topic: toJson(topic), comments }
      } catch (error) {
        return { ok: false, message: '获取主题详情失败: ' + errorMessage(error), topic: undefined, comments: [] }
      }
    },
  })
}

/** Search tool: in-group search. */
export function zsxqSearchTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_search',
    description: '在指定知识星球（group_id）内按关键词搜索主题。',
    parameters: {
      group_id: { type: 'string', description: '星球 ID' },
      keyword: { type: 'string', description: '搜索关键词' },
      count: { type: 'number', description: '条数（默认 20，最多 50）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          topics: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        const groupId = String(args?.group_id ?? '')
        const keyword = typeof args?.keyword === 'string' ? args.keyword.trim() : ''
        if (groupId === '') return { ok: false, message: '缺少 group_id 参数。', topics: [] }
        if (keyword === '') return { ok: false, message: '缺少 keyword 参数。', topics: [] }
        const count = Math.min(Math.max(Number(args?.count) || 20, 1), 50)
        const client = await clientOf(ctx.store)
        const { topics } = await client.searchTopics(groupId, keyword, count)
        if (topics.length === 0) return { ok: true, message: `星球内未搜到「${keyword}」相关内容。`, topics: [] }
        const lines = topics.map((t, i) => `${i + 1}. ${formatTopic(t)}`)
        return { ok: true, message: `搜到 ${topics.length} 条「${keyword}」：\n\n` + lines.join('\n\n---\n\n'), topics: toJsonArray(topics) }
      } catch (error) {
        return { ok: false, message: '搜索失败: ' + errorMessage(error), topics: [] }
      }
    },
  })
}

/** Publish tool (write). */
export function zsxqPublishTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_publish',
    description: '向指定知识星球（group_id）发布一条文字主题。⚠️ 写操作：基于非官方接口，可能被知识星球风控；发布前请与用户确认内容。',
    parameters: {
      group_id: { type: 'string', description: '星球 ID' },
      content: { type: 'string', description: '发布内容正文' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          topic_id: { type: 'number' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        const groupId = String(args?.group_id ?? '')
        const content = typeof args?.content === 'string' ? args.content.trim() : ''
        if (groupId === '') return { ok: false, message: '缺少 group_id 参数。' }
        if (content === '') return { ok: false, message: '缺少 content 参数。' }
        const client = await clientOf(ctx.store)
        const result = await client.publish(groupId, content)
        return { ok: true, message: `发布成功（topic_id: ${result.topic_id}）。`, topic_id: result.topic_id }
      } catch (error) {
        return { ok: false, message: '发布失败: ' + errorMessage(error) }
      }
    },
  })
}

/** Comment tool (write). */
export function zsxqCommentTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_comment',
    description: '在指定知识星球主题（topic_id）下发表评论。⚠️ 写操作：基于非官方接口，可能被知识星球风控；评论内容请先与用户确认。',
    parameters: {
      topic_id: { type: 'string', description: '主题 ID' },
      content: { type: 'string', description: '评论内容' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          comment_id: { type: 'number' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        const topicId = String(args?.topic_id ?? '')
        const content = typeof args?.content === 'string' ? args.content.trim() : ''
        if (topicId === '') return { ok: false, message: '缺少 topic_id 参数。' }
        if (content === '') return { ok: false, message: '缺少 content 参数。' }
        const client = await clientOf(ctx.store)
        const result = await client.comment(topicId, content)
        return { ok: true, message: `评论成功（comment_id: ${result.comment_id}）。`, comment_id: result.comment_id }
      } catch (error) {
        return { ok: false, message: '评论失败: ' + errorMessage(error) }
      }
    },
  })
}

/** Like tool (write). */
export function zsxqLikeTool(ctx: ToolContext) {
  return defineTool({
    name: 'zsxq_like',
    description: '为指定知识星球主题（topic_id）点赞。⚠️ 写操作：基于非官方接口，可能被知识星球风控。',
    parameters: {
      topic_id: { type: 'string', description: '主题 ID' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: Record<string, unknown>) {
      try {
        const topicId = String(args?.topic_id ?? '')
        if (topicId === '') return { ok: false, message: '缺少 topic_id 参数。' }
        const client = await clientOf(ctx.store)
        await client.like(topicId)
        return { ok: true, message: `已点赞主题 ${topicId}。` }
      } catch (error) {
        return { ok: false, message: '点赞失败: ' + errorMessage(error) }
      }
    },
  })
}

/** Build the tool list for registration. */
export function buildTools(ctx: ToolContext) {
  return [
    zsxqStatusTool(ctx),
    zsxqConfigTool(ctx),
    zsxqLoginTool(ctx),
    zsxqGroupsTool(ctx),
    zsxqTopicsTool(ctx),
    zsxqTopicTool(ctx),
    zsxqSearchTool(ctx),
    zsxqPublishTool(ctx),
    zsxqCommentTool(ctx),
    zsxqLikeTool(ctx),
  ]
}

/**
 * Mount the ZSXQ tools, routes, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - plugin config from the composition row.
 */
export function apply(ctx: Context, config?: Config): void {
  const announceToAgent = config?.announceToAgent !== false
  const enabled = config?.enabled !== false
  const store = new ZsxqStore()
  const context: ToolContext = { store, login: loginManager }

  let disposeTools: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const sync = (): void => {
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (!enabled) return
    disposeTools = ctx.effect(
      () => {
        const disposers = buildTools(context).map((tool) => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-zsxq: tools',
    )
    disposeRoutes = ctx.effect(
      () => {
        const disposers = makeRoutes({ store, login: loginManager }).map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-zsxq: routes',
    )
    if (announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-zsxq',
        order: SECTION_ORDER,
        text: ZSXQ_GUIDANCE,
      })
    }
  }

  sync()

  ctx.effect(() => {
    return () => { /* loginManager holds no persistent resources */ }
  }, 'dsh-zsxq: teardown')
}

/** Re-exports for host consumers and the smoke tests. */
export { ZsxqStore, configPath, DEFAULT_CONFIG_FILE, type ZsxqCredentials, type ZsxqConfigView } from './store.ts'
export { ZsxqClient, formatTopic, ZsxqError, normalizeCookie, accessTokenFromCookie, maskToken, type ZsxqTopic, type ZsxqGroup, type ZsxqComment } from './zsxq/client.ts'
export { loginManager, type LoginManager, type LoginState, type LoginPhase } from './zsxq/login.ts'
export { makeRoutes, ZSXQ_API } from './routes.ts'
export { defineTool }
