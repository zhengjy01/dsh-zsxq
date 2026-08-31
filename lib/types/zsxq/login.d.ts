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
export type LoginPhase = 'idle' | 'launching' | 'waiting' | 'succeeded' | 'timeout' | 'failed';
export interface LoginState {
    phase: LoginPhase;
    message: string;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
}
export interface LoginStartOptions {
    /** How long to wait for the scan+confirm, default 4 minutes. */
    timeoutMs?: number;
    /** Persist the captured cookie (store.setCookie). */
    save: (cookie: string, username?: string) => Promise<void>;
    /** Optional callback once the cookie is captured (before persistence). */
    onCookie?: (cookie: string) => void;
}
export declare class LoginManager {
    private state;
    getState(): LoginState;
    private set;
    isRunning(): boolean;
    /** Assemble the zsxq.com cookie header from a browser context. */
    private static cookieHeader;
    start(options: LoginStartOptions): Promise<LoginState>;
    /** Reset to idle (e.g. after the panel/agent read a terminal state). */
    reset(): void;
}
/** Shared singleton for the host process. */
export declare const loginManager: LoginManager;
