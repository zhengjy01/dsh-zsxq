/**
 * dsh-zsxq — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-zsxq/*. All routes are loopback-only
 * (127.0.0.1/localhost, same-origin) — the settings panel is the only
 * consumer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZsxqStore } from './store.ts';
import type { LoginManager } from './zsxq/login.ts';
/** Route paths. */
export declare const ZSXQ_API: {
    readonly config: "/api/dsh-zsxq/config";
    readonly status: "/api/dsh-zsxq/status";
    readonly login: "/api/dsh-zsxq/login";
    readonly loginStatus: "/api/dsh-zsxq/login/status";
    readonly test: "/api/dsh-zsxq/test";
};
/** Route handler context. */
export interface RouteContext {
    store: ZsxqStore;
    login: LoginManager;
}
/**
 * Build every /api/dsh-zsxq route as exact-match WebRoute entries.
 * @param deps - store + login manager.
 */
export declare function makeRoutes(deps: RouteContext): ({
    kind: "exact";
    path: "/api/dsh-zsxq/status";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-zsxq/config";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-zsxq/login";
    handler: (_req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-zsxq/login/status";
    handler: (_req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-zsxq/test";
    handler: (_req: IncomingMessage, res: ServerResponse) => Promise<void>;
})[];
