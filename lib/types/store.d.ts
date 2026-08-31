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
export declare const DEFAULT_CONFIG_FILE: string;
/** Test override for the config location. */
export declare function configPath(): string;
/** Persisted shape. Only the cookie string is secret. */
export interface ZsxqCredentials {
    /** Full login cookie header (zsxq_access_token=…; zsxqsessionid=…). */
    cookie: string;
    /** ISO timestamp of the last cookie capture / update. */
    cookieUpdatedAt: string;
    /** Optional display name captured during login (not reliable). */
    username: string;
}
/** Public, secret-free status view. */
export interface ZsxqConfigView {
    configured: boolean;
    hasAccessToken: boolean;
    accessTokenMasked: string;
    cookieUpdatedAt: string;
    cookieAgeDays: number;
    configPath: string;
}
/**
 * Small credential store backed by ~/.dsh/dsh-zsxq.json.
 * Reads are lazy and cached; writes use mode 0600 so secrets never leak
 * to other local users.
 */
export declare class ZsxqStore {
    config: ZsxqCredentials | null;
    load(): Promise<ZsxqCredentials>;
    save(credentials: ZsxqCredentials): Promise<void>;
    /** Update just the cookie, stamping cookieUpdatedAt. */
    setCookie(cookie: string, username?: string): Promise<ZsxqCredentials>;
    /** Clear credentials (logout). */
    clear(): Promise<void>;
    /** Public view with secrets masked. */
    view(): Promise<ZsxqConfigView>;
}
