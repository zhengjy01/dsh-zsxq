window.__ModuleLoader__.load({
	id: "dsh-zsxq",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/** Error carrying the route's JSON error message. */
		var ZsxqApiError = class extends Error {
			constructor(message) {
				super(message);
				this.name = "ZsxqApiError";
			}
		};
		/** Parse a JSON response or throw a ZsxqApiError. */
		async function readJson(response) {
			let body;
			try {
				body = await response.json();
			} catch {
				throw new ZsxqApiError(`HTTP ${response.status}: invalid JSON response`);
			}
			if (!response.ok) throw new ZsxqApiError(typeof body === "object" && body !== null && typeof body.error === "string" ? body.error : typeof body === "object" && body !== null && typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
			return body;
		}
		/** Plain fetch helper with an error wrapper. */
		async function request(path, init) {
			let response;
			try {
				response = await fetch(path, init);
			} catch (error) {
				throw new ZsxqApiError("网络请求失败: " + String(error instanceof Error ? error.message : error));
			}
			return readJson(response);
		}
		/** Browser-side client for the zsxq settings API. */
		var ZsxqApi = class {
			getStatus() {
				return request("/api/dsh-zsxq/status");
			}
			getLoginStatus() {
				return request("/api/dsh-zsxq/login/status");
			}
			saveCookie(cookie) {
				return request("/api/dsh-zsxq/config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ cookie })
				});
			}
			reset() {
				return request("/api/dsh-zsxq/config", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ reset: true })
				});
			}
			startLogin() {
				return request("/api/dsh-zsxq/login", { method: "POST" });
			}
			test() {
				return request("/api/dsh-zsxq/test", { method: "POST" });
			}
		};
		//#endregion
		//#region src/client/ZsxqPanel.tsx
		/**
		* ZSXQ settings panel — rendered inside the web settings page
		* (settings.section entry). Login status, QR-login button (polls the flow),
		* manual cookie paste, test-connection and reset. Plain React, no emoji, no
		* external UI package — inline styles only.
		*/
		/** Module-level API client (stateless; the component closes over it). */
		const api = new ZsxqApi();
		/** One shared style sheet (kept tiny and theme-agnostic). */
		const s = {
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				maxWidth: "680px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid rgba(128,128,128,0.3)",
				fontSize: "13px",
				color: "inherit"
			},
			title: {
				fontWeight: 600,
				fontSize: "13px",
				margin: 0
			},
			status: {
				fontSize: "12px",
				opacity: .85,
				whiteSpace: "pre-wrap",
				margin: 0
			},
			hint: {
				fontSize: "12px",
				opacity: .85,
				lineHeight: "1.5",
				margin: 0
			},
			row: {
				display: "flex",
				gap: "6px",
				alignItems: "center",
				flexWrap: "wrap"
			},
			label: {
				fontSize: "12px",
				opacity: .85,
				whiteSpace: "nowrap"
			},
			textarea: {
				width: "100%",
				boxSizing: "border-box",
				minHeight: "64px",
				padding: "5px 8px",
				borderRadius: "6px",
				border: "1px solid rgba(128,128,128,0.35)",
				background: "rgba(128,128,128,0.08)",
				color: "inherit",
				fontSize: "11px",
				fontFamily: "monospace",
				resize: "vertical"
			},
			button: {
				padding: "4px 10px",
				borderRadius: "6px",
				cursor: "pointer",
				border: "1px solid rgba(128,128,128,0.4)",
				background: "rgba(128,128,128,0.14)",
				color: "inherit",
				fontSize: "12px"
			},
			buttonPrimary: {
				padding: "4px 10px",
				borderRadius: "6px",
				cursor: "pointer",
				border: "1px solid rgba(62,92,154,0.7)",
				background: "rgba(62,92,154,0.18)",
				color: "inherit",
				fontSize: "12px",
				fontWeight: 600
			},
			msg: {
				fontSize: "12px",
				whiteSpace: "pre-wrap",
				wordBreak: "break-all",
				opacity: .9,
				margin: 0
			}
		};
		/** Status line for the current config view. */
		function statusText(view, login) {
			if (view === null) return "加载中…";
			return (view.configured ? `已登录（token ${view.accessTokenMasked}，Cookie ${view.cookieAgeDays} 天前更新）` : "未登录") + (login !== null && login.phase !== "idle" ? ` · 登录流程：${login.message}` : "");
		}
		/** The ZSXQ settings panel component. */
		function ZsxqPanel() {
			const [view, setView] = (0, react.useState)(null);
			const [login, setLogin] = (0, react.useState)(null);
			const [cookieInput, setCookieInput] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)("");
			const [testResult, setTestResult] = (0, react.useState)(null);
			const pollRef = (0, react.useRef)(null);
			const refresh = (0, react.useCallback)(async () => {
				try {
					const [v, l] = await Promise.all([api.getStatus(), api.getLoginStatus()]);
					setView(v);
					setLogin(l);
				} catch (error) {
					setMsg("读取状态失败: " + String(error instanceof Error ? error.message : error));
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			(0, react.useEffect)(() => {
				return () => {
					if (pollRef.current !== null) window.clearInterval(pollRef.current);
				};
			}, []);
			/** Run one async panel action with busy/message bookkeeping. */
			const run = async (action) => {
				setBusy(true);
				setMsg("");
				try {
					setMsg(await action());
				} catch (error) {
					setMsg("操作失败: " + String(error instanceof Error ? error.message : error));
				} finally {
					setBusy(false);
				}
			};
			const startLogin = async () => {
				await run(async () => {
					const result = await api.startLogin();
					if (pollRef.current !== null) window.clearInterval(pollRef.current);
					pollRef.current = window.setInterval(async () => {
						try {
							const state = await api.getLoginStatus();
							setLogin(state);
							if (state.phase === "succeeded" || state.phase === "timeout" || state.phase === "failed") {
								if (pollRef.current !== null) {
									window.clearInterval(pollRef.current);
									pollRef.current = null;
								}
								await refresh();
							}
						} catch {
							if (pollRef.current !== null) {
								window.clearInterval(pollRef.current);
								pollRef.current = null;
							}
						}
					}, 2e3);
					return result.message;
				});
			};
			const saveCookie = async () => {
				await run(async () => {
					if (cookieInput.trim() === "") return "请先粘贴 Cookie";
					const result = await api.saveCookie(cookieInput.trim());
					setCookieInput("");
					await refresh();
					return result.message;
				});
			};
			const reset = async () => {
				await run(async () => {
					const result = await api.reset();
					setCookieInput("");
					await refresh();
					return result.message;
				});
			};
			const test = async () => {
				await run(async () => {
					const result = await api.test();
					setTestResult(result);
					return result.message;
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: s.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: s.title,
						children: "知识星球（zsxq）"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: s.status,
						children: statusText(view, login)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: s.hint,
						children: "基于知识星球非官方 web API（api.zsxq.com/v2）+ 登录 Cookie 认证。知识星球无官方 API， 读操作（星球/主题/搜索）较稳定；写操作（发布/评论/点赞）可能被风控。 支持两种登录方式：扫码登录（推荐）或手动粘贴 Cookie。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.row,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.buttonPrimary,
								disabled: busy,
								onClick: () => void startLogin(),
								children: "扫码登录"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								disabled: busy,
								onClick: () => void test(),
								children: "测试连接"
							}),
							view?.configured === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								style: s.button,
								disabled: busy,
								onClick: () => void reset(),
								children: "清除登录"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: s.hint,
						children: "扫码登录会弹出系统 Chrome 窗口（需本机安装 Chrome），微信扫码后自动保存登录态。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: "6px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: s.label,
								children: "或手动粘贴 Cookie（浏览器打开 wx.zsxq.com → DevTools → Network → 任选 api.zsxq.com 请求 → 复制 Cookie 请求头）："
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								style: s.textarea,
								value: cookieInput,
								onChange: (event) => setCookieInput(event.target.value),
								placeholder: "zsxq_access_token=…; zsxqsessionid=…; …"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: s.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: s.button,
									disabled: busy || cookieInput.trim() === "",
									onClick: () => void saveCookie(),
									children: "保存 Cookie"
								})
							})
						]
					}),
					testResult !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: s.msg,
						children: [testResult.ok ? "✅ " : "❌ ", testResult.message]
					}),
					msg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: s.msg,
						children: msg
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services. */
		const inject = ["slots"];
		/**
		* Register the ZSXQ settings page.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			try {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "zsxq-mcp",
					order: 335,
					label: () => "知识星球"
				}, ZsxqPanel));
			} catch (error) {
				console.warn("[dsh-zsxq] settings panel registration failed:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map