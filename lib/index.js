import { defineTool } from "@deepseek-ai/dsh-tools";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
//#region src/zsxq/client.ts
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
const API_BASE = "https://api.zsxq.com/v2";
const WEB_ORIGIN = "https://wx.zsxq.com";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
var ZsxqError = class extends Error {
	status;
	apiCode;
	constructor(message, status, apiCode) {
		super(message);
		this.status = status;
		this.apiCode = apiCode;
		this.name = "ZsxqError";
	}
};
/** Normalize a raw cookie header string for storage/round-trip. */
function normalizeCookie(cookie) {
	return cookie.split(";").map((part) => part.trim()).filter(Boolean).join("; ");
}
/** Extract the first zsxq_access_token value (used for masked display). */
function accessTokenFromCookie(cookie) {
	const m = /zsxq_access_token=([^;\s]+)/.exec(cookie);
	return m ? m[1] : "";
}
function maskToken(token) {
	if (!token) return "";
	return token.length <= 8 ? token.slice(0, 2) + "…" : token.slice(0, 4) + "…" + token.slice(-4);
}
var ZsxqClient = class {
	cookie;
	constructor(cookie) {
		this.cookie = cookie;
	}
	buildHeaders(extra) {
		return {
			Accept: "application/json",
			"User-Agent": BROWSER_UA,
			Referer: "https://wx.zsxq.com/",
			Origin: WEB_ORIGIN,
			Cookie: this.cookie,
			...extra
		};
	}
	async request(method, path, query, body) {
		const url = new URL(API_BASE + path);
		if (query) {
			for (const [k, v] of Object.entries(query)) if (v !== void 0 && v !== "") url.searchParams.set(k, String(v));
		}
		const headers = this.buildHeaders(body !== void 0 ? { "Content-Type": "application/json;charset=UTF-8" } : void 0);
		const resp = await fetch(url, {
			method,
			headers,
			body: body !== void 0 ? JSON.stringify(body) : void 0,
			signal: AbortSignal.timeout(3e4)
		});
		if (resp.status === 401 || resp.status === 403) throw new ZsxqError(`知识星球返回 ${resp.status}（Cookie 无效或已过期，请重新登录）`, resp.status);
		let json;
		try {
			json = await resp.json();
		} catch {
			const raw = await resp.text().catch(() => "");
			throw new ZsxqError(`知识星球返回非 JSON（HTTP ${resp.status}）${raw !== "" ? ": " + raw.slice(0, 200) : ""}，可能是风控或接口变更`, resp.status);
		}
		if (!json.succeeded) throw new ZsxqError(`知识星球接口失败: ${json.resp_err?.msg ?? `succeeded=false（code=${json.resp_err?.code ?? "?"}）`}`, resp.status, json.resp_err?.code);
		return json.resp_data;
	}
	/** 我加入的星球列表。scope=joined 为主端点，401/404 时回退到无参 /groups。 */
	async listGroups() {
		try {
			return (await this.request("GET", "/groups", { scope: "joined" })).groups ?? [];
		} catch (error) {
			if (error instanceof ZsxqError && error.status === 401) throw error;
			return (await this.request("GET", "/groups")).groups ?? [];
		}
	}
	/** 星球内主题列表。scope: all=全部 / digested=精华；endTime 用于分页（返回的 next_end_time 或最后一条 create_time）。 */
	async listTopics(groupId, scope = "all", count = 20, endTime) {
		const data = await this.request("GET", `/groups/${groupId}/topics`, {
			scope,
			count,
			end_time: endTime ?? ""
		});
		return {
			topics: data.topics ?? [],
			nextEndTime: data.next_end_time
		};
	}
	/** 主题详情（含 talk/question/answer 内容）。 */
	async getTopic(topicId) {
		return this.request("GET", `/topics/${topicId}`);
	}
	/** 主题评论列表。 */
	async listComments(topicId, count = 30) {
		return { comments: (await this.request("GET", `/topics/${topicId}/comments`, { count })).comments ?? [] };
	}
	/** 星球内搜索主题。 */
	async searchTopics(groupId, keyword, count = 20) {
		return { topics: (await this.request("GET", `/groups/${groupId}/topics/search`, {
			keyword,
			count
		})).topics ?? [] };
	}
	/** 发布主题（写操作，非官方接口，可能被风控）。 */
	async publish(groupId, content) {
		return this.request("POST", `/groups/${groupId}/topics`, void 0, { req_data: {
			text: content,
			image_ids: []
		} });
	}
	/** 发表评论（写操作）。 */
	async comment(topicId, content) {
		return this.request("POST", `/topics/${topicId}/comments`, void 0, { req_data: { text: content } });
	}
	/** 点赞主题（写操作）。 */
	async like(topicId) {
		return this.request("POST", `/topics/${topicId}/likes`);
	}
	/** 轻量连通性自检：拉取星球列表（不打印内容）。 */
	async ping() {
		const groups = await this.listGroups();
		return {
			groupCount: groups.length,
			firstGroup: groups[0]?.name
		};
	}
};
/** 把主题渲染成便于阅读的文本（agent 工具输出用）。 */
function formatTopic(topic) {
	const kind = {
		talk: "说说",
		"q&a": "问答",
		solution: "解答",
		task: "任务",
		file: "文件"
	}[topic.type] ?? topic.type;
	const owner = topic.talk?.owner ?? topic.question?.owner ?? topic.answer?.owner;
	const text = topic.talk?.text ?? topic.question?.text ?? topic.answer?.text ?? "";
	const images = (topic.talk?.images ?? []).map((img) => img.large?.url ?? img.thumbnail?.url ?? "").filter(Boolean);
	const lines = [
		`[${kind}] ${owner?.name ?? "匿名"} · ${topic.create_time}`,
		`topic_id: ${topic.topic_id}`,
		`👍${topic.likes_count} 💬${topic.comments_count} ⭐${topic.rewards_count}${topic.digested ? " · 精华" : ""}`,
		"",
		text || "（无文本内容）"
	];
	for (const url of images) lines.push("", `![图片](${url})`);
	return lines.join("\n");
}
//#endregion
//#region src/store.ts
/**
* dsh-zsxq — credential store.
*
* Persists the Knowledge Planet (知识星球) login cookie (zsxq_access_token /
* zsxqsessionid/…, captured by the QR-login flow or pasted manually) to
* ~/.dsh/dsh-zsxq.json (mode 0600). Secrets never leave this module; the
* public view() masks everything. The config path can be overridden with
* DSH_ZSXQ_CONFIG (used by tests).
*/
/** Default machine-wide config location (mode 0600). */
const DEFAULT_CONFIG_FILE = path.join(homedir(), ".dsh", "dsh-zsxq.json");
/** Test override for the config location. */
function configPath() {
	const override = process.env.DSH_ZSXQ_CONFIG;
	return override !== void 0 && override !== "" ? override : DEFAULT_CONFIG_FILE;
}
function empty() {
	return {
		cookie: "",
		cookieUpdatedAt: "",
		username: ""
	};
}
function parse(raw) {
	const record = typeof raw === "object" && raw !== null ? raw : {};
	const str = (value) => typeof value === "string" ? value : "";
	return {
		cookie: str(record.cookie),
		cookieUpdatedAt: str(record.cookieUpdatedAt),
		username: str(record.username)
	};
}
/**
* Small credential store backed by ~/.dsh/dsh-zsxq.json.
* Reads are lazy and cached; writes use mode 0600 so secrets never leak
* to other local users.
*/
var ZsxqStore = class {
	config = null;
	async load() {
		if (this.config !== null) return this.config;
		try {
			const raw = await readFile(configPath(), "utf8");
			this.config = parse(JSON.parse(raw));
		} catch {
			this.config = empty();
		}
		return this.config;
	}
	async save(credentials) {
		this.config = credentials;
		const file = configPath();
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, JSON.stringify(credentials, null, 2), { mode: 384 });
	}
	/** Update just the cookie, stamping cookieUpdatedAt. */
	async setCookie(cookie, username = "") {
		const current = await this.load();
		const updated = {
			...current,
			cookie: normalizeCookie(cookie),
			cookieUpdatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			username: username || current.username
		};
		await this.save(updated);
		return updated;
	}
	/** Clear credentials (logout). */
	async clear() {
		await this.save(empty());
	}
	/** Public view with secrets masked. */
	async view() {
		const config = await this.load();
		const token = accessTokenFromCookie(config.cookie);
		const ageDays = config.cookieUpdatedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(config.cookieUpdatedAt)) / 864e5)) : 0;
		return {
			configured: config.cookie !== "",
			hasAccessToken: token !== "",
			accessTokenMasked: maskToken(token),
			cookieUpdatedAt: config.cookieUpdatedAt,
			cookieAgeDays: ageDays,
			configPath: configPath()
		};
	}
};
//#endregion
//#region src/zsxq/login.ts
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
const DEFAULT_TIMEOUT_MS = 4 * 6e4;
const POLL_MS = 2e3;
function idleState() {
	return {
		phase: "idle",
		message: "未启动登录"
	};
}
/** Shared singleton for the host process. */
const loginManager = new class LoginManager {
	state = idleState();
	getState() {
		return { ...this.state };
	}
	set(partial) {
		this.state = {
			...this.state,
			...partial
		};
		return this.getState();
	}
	isRunning() {
		return this.state.phase === "launching" || this.state.phase === "waiting";
	}
	/** Assemble the zsxq.com cookie header from a browser context. */
	static async cookieHeader(context) {
		return (await context.cookies()).filter((c) => c.domain.includes("zsxq.com") && c.value !== "").map((c) => `${c.name}=${c.value}`).join("; ");
	}
	async start(options) {
		if (this.isRunning()) return this.set({ message: "登录流程已在运行中，请勿重复启动" });
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const startedAt = (/* @__PURE__ */ new Date()).toISOString();
		this.state = {
			phase: "launching",
			message: "正在启动浏览器…",
			startedAt
		};
		let browser;
		try {
			browser = await chromium.launch({
				channel: "chrome",
				headless: false
			});
			const context = await browser.newContext();
			await (await context.newPage()).goto("https://wx.zsxq.com", { waitUntil: "domcontentloaded" });
			this.set({
				phase: "waiting",
				message: "请在弹出的浏览器窗口中用微信扫码登录知识星球（4 分钟超时）"
			});
			const deadline = Date.now() + timeoutMs;
			let cookie = "";
			while (Date.now() < deadline) {
				cookie = await LoginManager.cookieHeader(context);
				if (cookie.includes("zsxq_access_token=")) break;
				await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			}
			if (!cookie.includes("zsxq_access_token=")) {
				this.set({
					phase: "timeout",
					message: "扫码登录超时（4 分钟未完成），请重试",
					finishedAt: (/* @__PURE__ */ new Date()).toISOString()
				});
				return this.getState();
			}
			options.onCookie?.(cookie);
			await options.save(cookie);
			this.set({
				phase: "succeeded",
				message: "扫码登录成功，Cookie 已保存",
				finishedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			return this.getState();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.set({
				phase: "failed",
				message: `扫码登录失败: ${message}`,
				error: message,
				finishedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			return this.getState();
		} finally {
			setTimeout(() => {
				browser?.close().catch(() => {});
			}, 1500);
		}
	}
	/** Reset to idle (e.g. after the panel/agent read a terminal state). */
	reset() {
		if (!this.isRunning()) this.state = idleState();
	}
}();
//#endregion
//#region src/routes.ts
/** Route paths. */
const ZSXQ_API = {
	config: "/api/dsh-zsxq/config",
	status: "/api/dsh-zsxq/status",
	login: "/api/dsh-zsxq/login",
	loginStatus: "/api/dsh-zsxq/login/status",
	test: "/api/dsh-zsxq/test"
};
/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 256 * 1024;
/** Strict loopback fence for all routes. */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** One JSON response. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}
/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > MAX_JSON_BODY_BYTES) return void 0;
		chunks.push(buffer);
	}
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}
/**
* Build every /api/dsh-zsxq route as exact-match WebRoute entries.
* @param deps - store + login manager.
*/
function makeRoutes(deps) {
	const { store, login } = deps;
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			writeJson(res, 403, { error: "forbidden: loopback-only" });
			return false;
		}
		if (req.method !== method) {
			writeJson(res, 405, { error: `method not allowed: ${req.method}` });
			return false;
		}
		return true;
	};
	return [
		{
			kind: "exact",
			path: ZSXQ_API.status,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				try {
					writeJson(res, 200, {
						ok: true,
						...await store.view()
					});
				} catch (error) {
					writeJson(res, 500, {
						ok: false,
						error: String(error instanceof Error ? error.message : error)
					});
				}
			}
		},
		{
			kind: "exact",
			path: ZSXQ_API.config,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				const body = await readJsonBody(req);
				if (body === void 0) {
					writeJson(res, 400, {
						ok: false,
						error: "invalid JSON body"
					});
					return;
				}
				if (body.reset === true) {
					await store.clear();
					writeJson(res, 200, {
						ok: true,
						message: "已清除知识星球凭据"
					});
					return;
				}
				const cookie = typeof body.cookie === "string" && body.cookie.trim() !== "" ? body.cookie.trim() : "";
				if (cookie === "") {
					writeJson(res, 400, {
						ok: false,
						error: "cookie 不能为空"
					});
					return;
				}
				await store.setCookie(cookie);
				writeJson(res, 200, {
					ok: true,
					message: "Cookie 已保存",
					...await store.view()
				});
			}
		},
		{
			kind: "exact",
			path: ZSXQ_API.login,
			handler: async (_req, res) => {
				if (!guard(_req, res, "POST")) return;
				const state = await login.start({ save: async (cookie) => {
					await store.setCookie(cookie);
				} });
				writeJson(res, 200, {
					ok: state.phase === "succeeded" || state.phase === "waiting" || state.phase === "launching",
					...state
				});
			}
		},
		{
			kind: "exact",
			path: ZSXQ_API.loginStatus,
			handler: async (_req, res) => {
				if (!guard(_req, res, "GET")) return;
				writeJson(res, 200, {
					ok: true,
					...login.getState()
				});
			}
		},
		{
			kind: "exact",
			path: ZSXQ_API.test,
			handler: async (_req, res) => {
				if (!guard(_req, res, "POST")) return;
				const config = await store.load();
				if (config.cookie === "") {
					writeJson(res, 400, {
						ok: false,
						error: "未配置 Cookie，请先登录或粘贴 Cookie"
					});
					return;
				}
				try {
					const ping = await new ZsxqClient(config.cookie).ping();
					writeJson(res, 200, {
						ok: true,
						message: `连接成功：${ping.groupCount} 个星球`,
						groupCount: ping.groupCount,
						firstGroup: ping.firstGroup
					});
				} catch (error) {
					writeJson(res, 502, {
						ok: false,
						error: String(error instanceof Error ? error.message : error)
					});
				}
			}
		}
	];
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name. */
const name = "zsxq-mcp";
/** Services required before the plugin surfaces can mount. */
const inject = [
	"webServer",
	"tools",
	"systemPrompt"
];
/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 220;
/** Model-facing announcement: plugin presence, capabilities, and limits. */
const ZSXQ_GUIDANCE = "本机已安装 dsh-zsxq 插件（知识星球 zsxq 集成）：基于知识星球非官方 web API（api.zsxq.com/v2）+ 登录 Cookie 认证，提供读与写能力。工具：zsxq_status（状态）、zsxq_config（配置/清除 Cookie）、zsxq_login（扫码登录）、zsxq_groups（我的星球列表）、zsxq_topics（星球主题列表）、zsxq_topic（主题详情+评论）、zsxq_search（星球内搜索）、zsxq_publish（发布主题）、zsxq_comment（评论）、zsxq_like（点赞）。前提：需先完成登录（zsxq_login 弹出浏览器窗口扫码，或在设置面板粘贴 Cookie）。注意：知识星球无官方 API，读操作（列表/详情/搜索）较稳定；写操作（发布/评论/点赞）为非官方接口，可能被风控，使用前请确认。用户提到「知识星球 / zsxq / 星球内容」时即指本插件，请据此协作。";
/** One text content block (the only render shape these tools emit). */
function text(value) {
	return [{
		type: "text",
		text: value
	}];
}
/** Build a ZsxqClient from the stored cookie (throws ZsxqError when absent). */
async function clientOf(store) {
	const config = await store.load();
	if (config.cookie === "") throw new ZsxqError("未配置知识星球 Cookie，请先 zsxq_login 扫码登录或在设置面板粘贴 Cookie");
	return new ZsxqClient(config.cookie);
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Cast typed object arrays to the tool-output schema shape (Record<string, JsonValue>). */
function toJsonArray(items) {
	return items;
}
/** Cast one typed object to the schema shape (undefined when null/absent). */
function toJson(item) {
	return item === null || item === void 0 ? void 0 : item;
}
/** Status tool: cookie + login flow state. */
function zsxqStatusTool(ctx) {
	return defineTool({
		name: "zsxq_status",
		description: "查看 dsh-zsxq 插件状态：是否已登录知识星球（Cookie 是否配置/有效）、Cookie 更新时间与年龄、扫码登录流程状态。不会泄露 Cookie。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					configured: { type: "boolean" },
					hasAccessToken: { type: "boolean" },
					accessTokenMasked: { type: "string" },
					cookieUpdatedAt: { type: "string" },
					cookieAgeDays: { type: "number" },
					loginPhase: { type: "string" },
					loginMessage: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			try {
				const view = await ctx.store.view();
				const login = ctx.login.getState();
				return {
					ok: true,
					message: ["知识星球：" + (view.configured ? `已登录（token ${view.accessTokenMasked}，Cookie ${view.cookieAgeDays} 天前更新）` : "未登录（请 zsxq_login 扫码登录或粘贴 Cookie）"), "登录流程：" + login.message].join("\n"),
					...view,
					loginPhase: login.phase,
					loginMessage: login.message
				};
			} catch (error) {
				return {
					ok: false,
					message: "读取状态失败: " + errorMessage(error)
				};
			}
		}
	});
}
/** Config tool: set/clear the cookie. */
function zsxqConfigTool(ctx) {
	return defineTool({
		name: "zsxq_config",
		description: "配置 dsh-zsxq 知识星球凭据：cookie 为浏览器知识星球（wx.zsxq.com）登录态的完整 Cookie 字符串（含 zsxq_access_token）。配置持久化到 ~/.dsh/dsh-zsxq.json（0600）。传 reset: true 清除凭据（退出登录）。",
		parameters: {
			cookie: {
				type: "string",
				description: "知识星球登录 Cookie（浏览器 DevTools 里从 api.zsxq.com 请求复制）"
			},
			reset: {
				type: "boolean",
				description: "设为 true 清除已保存的 Cookie"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					configured: { type: "boolean" },
					accessTokenMasked: { type: "string" },
					configPath: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			try {
				if (args !== void 0 && args.reset === true) {
					await ctx.store.clear();
					return {
						ok: true,
						message: "已清除知识星球凭据（退出登录）。",
						configured: false,
						accessTokenMasked: "",
						configPath: (await ctx.store.view()).configPath
					};
				}
				const cookie = typeof args?.cookie === "string" ? args.cookie.trim() : "";
				if (cookie === "") return {
					ok: false,
					message: "缺少 cookie 参数。",
					configured: false,
					accessTokenMasked: "",
					configPath: (await ctx.store.view()).configPath
				};
				await ctx.store.setCookie(cookie);
				const view = await ctx.store.view();
				return {
					ok: true,
					message: `Cookie 已保存（token ${view.accessTokenMasked}），可用 zsxq_groups 验证。`,
					configured: true,
					accessTokenMasked: view.accessTokenMasked,
					configPath: view.configPath
				};
			} catch (error) {
				return {
					ok: false,
					message: "配置失败: " + errorMessage(error)
				};
			}
		}
	});
}
/** Login tool: start the QR login flow. */
function zsxqLoginTool(ctx) {
	return defineTool({
		name: "zsxq_login",
		description: "开始知识星球扫码登录：弹出系统 Chrome 窗口打开 wx.zsxq.com，用户用微信扫码登录，插件自动抓取 Cookie 保存。登录中可用 zsxq_status 查看进度。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					phase: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			try {
				const state = await ctx.login.start({ save: async (cookie) => {
					await ctx.store.setCookie(cookie);
				} });
				const message = state.phase === "succeeded" ? "扫码登录成功，Cookie 已保存。" : state.phase === "failed" ? `登录失败：${state.message}` : `已启动扫码登录：${state.message}`;
				return {
					ok: state.phase === "succeeded" || state.phase === "waiting" || state.phase === "launching",
					message,
					phase: state.phase
				};
			} catch (error) {
				return {
					ok: false,
					message: "启动登录失败: " + errorMessage(error)
				};
			}
		}
	});
}
/** Groups tool: my planet list. */
function zsxqGroupsTool(ctx) {
	return defineTool({
		name: "zsxq_groups",
		description: "获取知识星球登录账号加入的星球列表（星球 ID、名称、成员数等）。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					groups: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					}
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute() {
			try {
				const groups = await (await clientOf(ctx.store)).listGroups();
				if (groups.length === 0) return {
					ok: true,
					message: "没有加入任何星球。",
					groups: []
				};
				const lines = groups.map((g, i) => `${i + 1}. ${g.name}（group_id: ${g.group_id}${g.members_count ? `，成员 ${g.members_count}` : ""}${g.topic_count ? `，主题 ${g.topic_count}` : ""}）`);
				return {
					ok: true,
					message: `共 ${groups.length} 个星球：\n` + lines.join("\n"),
					groups: toJsonArray(groups)
				};
			} catch (error) {
				return {
					ok: false,
					message: "获取星球列表失败: " + errorMessage(error),
					groups: []
				};
			}
		}
	});
}
/** Topics tool: topic list of a group. */
function zsxqTopicsTool(ctx) {
	return defineTool({
		name: "zsxq_topics",
		description: "获取指定星球（group_id，见 zsxq_groups）的主题/帖子列表。scope=all（默认）全部 / digested 只看精华；count 条数（默认 20，最多 50）；end_time 分页游标（上一页返回的 nextEndTime）。",
		parameters: {
			group_id: {
				type: "string",
				description: "星球 ID（zsxq_groups 获取）"
			},
			scope: {
				type: "string",
				enum: ["all", "digested"],
				description: "all=全部（默认），digested=精华"
			},
			count: {
				type: "number",
				description: "条数（默认 20，最多 50）"
			},
			end_time: {
				type: "string",
				description: "可选：分页游标（上一页 nextEndTime）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					topics: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					},
					nextEndTime: { type: "string" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			try {
				const groupId = String(args?.group_id ?? "");
				if (groupId === "") return {
					ok: false,
					message: "缺少 group_id 参数。",
					topics: [],
					nextEndTime: ""
				};
				const scope = args?.scope === "digested" ? "digested" : "all";
				const count = Math.min(Math.max(Number(args?.count) || 20, 1), 50);
				const endTime = typeof args?.end_time === "string" ? args.end_time : void 0;
				const { topics, nextEndTime } = await (await clientOf(ctx.store)).listTopics(groupId, scope, count, endTime);
				if (topics.length === 0) return {
					ok: true,
					message: "该星球暂无主题。",
					topics: [],
					nextEndTime: nextEndTime ?? ""
				};
				const lines = topics.map((t, i) => `${i + 1}. ${formatTopic(t)}`);
				return {
					ok: true,
					message: `共 ${topics.length} 条主题：\n\n` + lines.join("\n\n---\n\n"),
					topics: toJsonArray(topics),
					nextEndTime: nextEndTime ?? ""
				};
			} catch (error) {
				return {
					ok: false,
					message: "获取主题失败: " + errorMessage(error),
					topics: [],
					nextEndTime: ""
				};
			}
		}
	});
}
/** Topic detail tool: detail + comments. */
function zsxqTopicTool(ctx) {
	return defineTool({
		name: "zsxq_topic",
		description: "获取知识星球主题详情（topic_id，见 zsxq_topics）与评论。with_comments=false 时不拉评论。",
		parameters: {
			topic_id: {
				type: "string",
				description: "主题 ID"
			},
			with_comments: {
				type: "boolean",
				description: "是否同时返回评论（默认 true）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					topic: {
						type: "object",
						additionalProperties: true
					},
					comments: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					}
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			try {
				const topicId = String(args?.topic_id ?? "");
				if (topicId === "") return {
					ok: false,
					message: "缺少 topic_id 参数。",
					comments: []
				};
				const withComments = args?.with_comments !== false;
				const client = await clientOf(ctx.store);
				const { topic } = await client.getTopic(topicId);
				const parts = [formatTopic(topic)];
				let comments = [];
				if (withComments) {
					const list = await client.listComments(topicId);
					comments = toJsonArray(list.comments);
					if (list.comments.length > 0) {
						parts.push("", `💬 评论（${list.comments.length}）：`);
						for (const c of list.comments) parts.push(`- ${c.owner.name}（${c.create_time}）：${c.text}`);
					}
				}
				return {
					ok: true,
					message: parts.join("\n"),
					topic: toJson(topic),
					comments
				};
			} catch (error) {
				return {
					ok: false,
					message: "获取主题详情失败: " + errorMessage(error),
					comments: []
				};
			}
		}
	});
}
/** Search tool: in-group search. */
function zsxqSearchTool(ctx) {
	return defineTool({
		name: "zsxq_search",
		description: "在指定知识星球（group_id）内按关键词搜索主题。",
		parameters: {
			group_id: {
				type: "string",
				description: "星球 ID"
			},
			keyword: {
				type: "string",
				description: "搜索关键词"
			},
			count: {
				type: "number",
				description: "条数（默认 20，最多 50）"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					topics: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: true
						}
					}
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			try {
				const groupId = String(args?.group_id ?? "");
				const keyword = typeof args?.keyword === "string" ? args.keyword.trim() : "";
				if (groupId === "") return {
					ok: false,
					message: "缺少 group_id 参数。",
					topics: []
				};
				if (keyword === "") return {
					ok: false,
					message: "缺少 keyword 参数。",
					topics: []
				};
				const count = Math.min(Math.max(Number(args?.count) || 20, 1), 50);
				const { topics } = await (await clientOf(ctx.store)).searchTopics(groupId, keyword, count);
				if (topics.length === 0) return {
					ok: true,
					message: `星球内未搜到「${keyword}」相关内容。`,
					topics: []
				};
				const lines = topics.map((t, i) => `${i + 1}. ${formatTopic(t)}`);
				return {
					ok: true,
					message: `搜到 ${topics.length} 条「${keyword}」：\n\n` + lines.join("\n\n---\n\n"),
					topics: toJsonArray(topics)
				};
			} catch (error) {
				return {
					ok: false,
					message: "搜索失败: " + errorMessage(error),
					topics: []
				};
			}
		}
	});
}
/** Publish tool (write). */
function zsxqPublishTool(ctx) {
	return defineTool({
		name: "zsxq_publish",
		description: "向指定知识星球（group_id）发布一条文字主题。⚠️ 写操作：基于非官方接口，可能被知识星球风控；发布前请与用户确认内容。",
		parameters: {
			group_id: {
				type: "string",
				description: "星球 ID"
			},
			content: {
				type: "string",
				description: "发布内容正文"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					topic_id: { type: "number" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			try {
				const groupId = String(args?.group_id ?? "");
				const content = typeof args?.content === "string" ? args.content.trim() : "";
				if (groupId === "") return {
					ok: false,
					message: "缺少 group_id 参数。"
				};
				if (content === "") return {
					ok: false,
					message: "缺少 content 参数。"
				};
				const result = await (await clientOf(ctx.store)).publish(groupId, content);
				return {
					ok: true,
					message: `发布成功（topic_id: ${result.topic_id}）。`,
					topic_id: result.topic_id
				};
			} catch (error) {
				return {
					ok: false,
					message: "发布失败: " + errorMessage(error)
				};
			}
		}
	});
}
/** Comment tool (write). */
function zsxqCommentTool(ctx) {
	return defineTool({
		name: "zsxq_comment",
		description: "在指定知识星球主题（topic_id）下发表评论。⚠️ 写操作：基于非官方接口，可能被知识星球风控；评论内容请先与用户确认。",
		parameters: {
			topic_id: {
				type: "string",
				description: "主题 ID"
			},
			content: {
				type: "string",
				description: "评论内容"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					comment_id: { type: "number" }
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			try {
				const topicId = String(args?.topic_id ?? "");
				const content = typeof args?.content === "string" ? args.content.trim() : "";
				if (topicId === "") return {
					ok: false,
					message: "缺少 topic_id 参数。"
				};
				if (content === "") return {
					ok: false,
					message: "缺少 content 参数。"
				};
				const result = await (await clientOf(ctx.store)).comment(topicId, content);
				return {
					ok: true,
					message: `评论成功（comment_id: ${result.comment_id}）。`,
					comment_id: result.comment_id
				};
			} catch (error) {
				return {
					ok: false,
					message: "评论失败: " + errorMessage(error)
				};
			}
		}
	});
}
/** Like tool (write). */
function zsxqLikeTool(ctx) {
	return defineTool({
		name: "zsxq_like",
		description: "为指定知识星球主题（topic_id）点赞。⚠️ 写操作：基于非官方接口，可能被知识星球风控。",
		parameters: { topic_id: {
			type: "string",
			description: "主题 ID"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					message: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => text(String(value.message ?? ""))
		},
		async execute(args) {
			try {
				const topicId = String(args?.topic_id ?? "");
				if (topicId === "") return {
					ok: false,
					message: "缺少 topic_id 参数。"
				};
				await (await clientOf(ctx.store)).like(topicId);
				return {
					ok: true,
					message: `已点赞主题 ${topicId}。`
				};
			} catch (error) {
				return {
					ok: false,
					message: "点赞失败: " + errorMessage(error)
				};
			}
		}
	});
}
/** Build the tool list for registration. */
function buildTools(ctx) {
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
		zsxqLikeTool(ctx)
	];
}
/**
* Mount the ZSXQ tools, routes, and announcement.
* @param ctx - host plugin context carrying webServer/tools/systemPrompt.
* @param config - plugin config from the composition row.
*/
function apply(ctx, config) {
	const announceToAgent = config?.announceToAgent !== false;
	const enabled = config?.enabled !== false;
	const store = new ZsxqStore();
	const context = {
		store,
		login: loginManager
	};
	let disposeTools;
	let disposeRoutes;
	let disposeSection;
	const sync = () => {
		if (disposeTools !== void 0) {
			disposeTools();
			disposeTools = void 0;
		}
		if (disposeRoutes !== void 0) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
		if (disposeSection !== void 0) {
			disposeSection();
			disposeSection = void 0;
		}
		if (!enabled) return;
		disposeTools = ctx.effect(() => {
			const disposers = buildTools(context).map((tool) => ctx.tools.register(tool));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-zsxq: tools");
		disposeRoutes = ctx.effect(() => {
			const disposers = makeRoutes({
				store,
				login: loginManager
			}).map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "dsh-zsxq: routes");
		if (announceToAgent) disposeSection = ctx.systemPrompt.section({
			name: "plugin:dsh-zsxq",
			order: SECTION_ORDER,
			text: ZSXQ_GUIDANCE
		});
	};
	sync();
	ctx.effect(() => {
		return () => {};
	}, "dsh-zsxq: teardown");
}
//#endregion
export { DEFAULT_CONFIG_FILE, ZSXQ_API, ZSXQ_GUIDANCE, ZsxqClient, ZsxqError, ZsxqStore, accessTokenFromCookie, apply, buildTools, configPath, defineTool, formatTopic, inject, loginManager, makeRoutes, maskToken, name, normalizeCookie, zsxqCommentTool, zsxqConfigTool, zsxqGroupsTool, zsxqLikeTool, zsxqLoginTool, zsxqPublishTool, zsxqSearchTool, zsxqStatusTool, zsxqTopicTool, zsxqTopicsTool };
