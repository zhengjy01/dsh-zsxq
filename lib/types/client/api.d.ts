/**
 * Browser-side API client for the /api/dsh-zsxq route family.
 * The only data access path the settings panel uses — plain fetch, same origin.
 */
/** Public config view (mirrors the host contract). */
export interface ZsxqConfigView {
    configured: boolean;
    hasAccessToken: boolean;
    accessTokenMasked: string;
    cookieUpdatedAt: string;
    cookieAgeDays: number;
    configPath: string;
}
/** Login flow state (mirrors the host LoginState). */
export interface ZsxqLoginState {
    phase: string;
    message: string;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
}
/** Test result. */
export interface ZsxqTestResult {
    ok: boolean;
    message: string;
    groupCount?: number;
    firstGroup?: string;
}
/** Error carrying the route's JSON error message. */
export declare class ZsxqApiError extends Error {
    constructor(message: string);
}
/** Browser-side client for the zsxq settings API. */
export declare class ZsxqApi {
    getStatus(): Promise<ZsxqConfigView>;
    getLoginStatus(): Promise<ZsxqLoginState>;
    saveCookie(cookie: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    reset(): Promise<{
        ok: boolean;
        message: string;
    }>;
    startLogin(): Promise<{
        ok: boolean;
        message: string;
        phase: string;
    }>;
    test(): Promise<ZsxqTestResult>;
}
