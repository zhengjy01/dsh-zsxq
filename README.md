# dsh-zsxq

知识星球（zsxq）集成插件 for DeepSeek Harness：基于知识星球**非官方** web API（`api.zsxq.com/v2`）+ 登录 Cookie 认证，把星球内容能力暴露为 agent 工具，并提供扫码登录与 Web 设置面板。

> ⚠️ 知识星球**没有官方开放平台 API**。读操作（星球列表 / 主题列表 / 主题详情 / 搜索）在开源社区实践中稳定可用；写操作（发布 / 评论 / 点赞）为逆向接口，可能被知识星球风控，请谨慎使用。

## 功能

| 工具 | 说明 | 参数 |
| --- | --- | --- |
| `zsxq_status` | 登录状态（Cookie 配置/有效期、登录流程进度） | — |
| `zsxq_config` | 配置/清除 Cookie | `cookie` / `reset` |
| `zsxq_login` | 扫码登录（弹出系统 Chrome 窗口） | — |
| `zsxq_groups` | 我加入的星球列表 | — |
| `zsxq_topics` | 星球主题列表 | `group_id`, `scope`(all/digested), `count`, `end_time` |
| `zsxq_topic` | 主题详情 + 评论 | `topic_id`, `with_comments` |
| `zsxq_search` | 星球内搜索 | `group_id`, `keyword`, `count` |
| `zsxq_publish` | 发布主题（写操作） | `group_id`, `content` |
| `zsxq_comment` | 发表评论（写操作） | `topic_id`, `content` |
| `zsxq_like` | 点赞（写操作） | `topic_id` |

Web 设置面板：设置 → 知识星球（扫码登录 / 粘贴 Cookie / 测试连接 / 清除登录）。

## 安装

```bash
# 本地开发（link 挂载）
dsh plugin --profile web add link:/path/to/dsh-zsxq

# 或 npm 安装（发布后）
dsh plugin --profile web add dsh-zsxq
```

安装后重启 DSH GUI 生效。

## 使用

1. **登录**：`zsxq_login`（弹出 Chrome 窗口微信扫码，自动保存 Cookie），或 `zsxq_config` 粘贴 Cookie（浏览器打开 wx.zsxq.com → DevTools → Network → 任选 api.zsxq.com 请求 → 复制 Cookie 请求头），或在设置面板操作。
2. **读内容**：`zsxq_groups` 拿星球 ID → `zsxq_topics` 拿主题列表 → `zsxq_topic` 看详情评论；`zsxq_search` 站内搜索。
3. **写内容**（风险自担）：`zsxq_publish` / `zsxq_comment` / `zsxq_like`。

Cookie 有效期约 1–3 个月，过期后 API 返回 401，重新登录即可。凭据存 `~/.dsh/dsh-zsxq.json`（权限 0600）。

## 技术说明

- API 基址 `https://api.zsxq.com/v2`，请求头需 `Accept: application/json` + 浏览器 UA + `Referer/Origin: https://wx.zsxq.com/` + `Cookie`（**web 版接口无需签名**；带 MD5 签名的 `/v1/*` 是 App 端接口，本项目不涉及）。
- 扫码登录用 `playwright-core`（`channel: 'chrome'`，使用系统 Chrome，不下载 Chromium），无头关闭、窗口可见以便扫码。
- 结构：`src/zsxq/client.ts`（API 客户端）/ `login.ts`（扫码登录）/ `store.ts`（凭据 0600）/ `routes.ts`（`/api/dsh-zsxq/*`，loopback-only）/ `client/`（设置面板）。

## 开发

```bash
pnpm install        # 干净安装（勿复制其他插件的 node_modules）
pnpm typecheck
pnpm build          # tsc 声明 + tsdown（lib/index.js + lib/client.js）
pnpm test           # smoke 测试（fake fetch，无网络）
```

## License

MIT
