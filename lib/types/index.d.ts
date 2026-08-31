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
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ZsxqStore } from './store.ts';
import { type LoginManager } from './zsxq/login.ts';
/** Stable cordis plugin name. */
export declare const name = "zsxq-mcp";
/** Services required before the plugin surfaces can mount. */
export declare const inject: string[];
/** Model-facing announcement: plugin presence, capabilities, and limits. */
export declare const ZSXQ_GUIDANCE: string;
/** Plugin config, read from the composition row. */
export interface Config {
    /** When true (default), a system-prompt section announces the plugin. */
    announceToAgent?: boolean;
    /** Master switch for the plugin (routes, prompt section, tools). */
    enabled?: boolean;
}
/** Shared tool dependencies. */
export interface ToolContext {
    store: ZsxqStore;
    login: LoginManager;
}
/** Status tool: cookie + login flow state. */
export declare function zsxqStatusTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Config tool: set/clear the cookie. */
export declare function zsxqConfigTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Login tool: start the QR login flow. */
export declare function zsxqLoginTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Groups tool: my planet list. */
export declare function zsxqGroupsTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Topics tool: topic list of a group. */
export declare function zsxqTopicsTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Topic detail tool: detail + comments. */
export declare function zsxqTopicTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Search tool: in-group search. */
export declare function zsxqSearchTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Publish tool (write). */
export declare function zsxqPublishTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Comment tool (write). */
export declare function zsxqCommentTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Like tool (write). */
export declare function zsxqLikeTool(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition;
/** Build the tool list for registration. */
export declare function buildTools(ctx: ToolContext): import("@deepseek-ai/dsh-tools").ToolDefinition[];
/**
 * Mount the ZSXQ tools, routes, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - plugin config from the composition row.
 */
export declare function apply(ctx: Context, config?: Config): void;
/** Re-exports for host consumers and the smoke tests. */
export { ZsxqStore, configPath, DEFAULT_CONFIG_FILE, type ZsxqCredentials, type ZsxqConfigView } from './store.ts';
export { ZsxqClient, formatTopic, ZsxqError, normalizeCookie, accessTokenFromCookie, maskToken, type ZsxqTopic, type ZsxqGroup, type ZsxqComment } from './zsxq/client.ts';
export { loginManager, type LoginManager, type LoginState, type LoginPhase } from './zsxq/login.ts';
export { makeRoutes, ZSXQ_API } from './routes.ts';
export { defineTool };
