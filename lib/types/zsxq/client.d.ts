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
/** ZSXQ topic types seen in the wild. */
export type TopicType = 'talk' | 'q&a' | 'solution' | 'task' | 'file' | string;
export interface ZsxqOwner {
    user_id: number;
    name: string;
    avatar_url: string;
}
export interface ZsxqImage {
    image_id?: number;
    type?: string;
    thumbnail?: {
        url: string;
    };
    large?: {
        url: string;
    };
}
export interface ZsxqTopic {
    topic_id: number;
    topic_uid?: string;
    type: TopicType;
    create_time: string;
    likes_count: number;
    comments_count: number;
    rewards_count: number;
    digested: boolean;
    group_id?: number;
    talk?: {
        owner: ZsxqOwner;
        text: string;
        images?: ZsxqImage[];
    };
    question?: {
        owner: ZsxqOwner;
        text: string;
    };
    answer?: {
        owner: ZsxqOwner;
        text: string;
    };
}
export interface ZsxqComment {
    comment_id: number;
    create_time: string;
    owner: ZsxqOwner;
    text: string;
}
export interface ZsxqGroup {
    group_id: number;
    name: string;
    description?: string;
    type?: string;
    background_url?: string;
    topic_count?: number;
    members_count?: number;
    category?: {
        name: string;
    };
    create_time?: string;
}
export declare class ZsxqError extends Error {
    readonly status?: number | undefined;
    readonly apiCode?: number | undefined;
    constructor(message: string, status?: number | undefined, apiCode?: number | undefined);
}
/** Normalize a raw cookie header string for storage/round-trip. */
export declare function normalizeCookie(cookie: string): string;
/** Extract the first zsxq_access_token value (used for masked display). */
export declare function accessTokenFromCookie(cookie: string): string;
export declare function maskToken(token: string): string;
export declare class ZsxqClient {
    private readonly cookie;
    constructor(cookie: string);
    private buildHeaders;
    private request;
    /** 我加入的星球列表。scope=joined 为主端点，401/404 时回退到无参 /groups。 */
    listGroups(): Promise<ZsxqGroup[]>;
    /** 星球内主题列表。scope: all=全部 / digested=精华；endTime 用于分页（返回的 next_end_time 或最后一条 create_time）。 */
    listTopics(groupId: string | number, scope?: 'all' | 'digested', count?: number, endTime?: string): Promise<{
        topics: ZsxqTopic[];
        nextEndTime?: string;
    }>;
    /** 主题详情（含 talk/question/answer 内容）。 */
    getTopic(topicId: string | number): Promise<{
        topic: ZsxqTopic;
    }>;
    /** 主题评论列表。 */
    listComments(topicId: string | number, count?: number): Promise<{
        comments: ZsxqComment[];
    }>;
    /** 星球内搜索主题。 */
    searchTopics(groupId: string | number, keyword: string, count?: number): Promise<{
        topics: ZsxqTopic[];
    }>;
    /** 发布主题（写操作，非官方接口，可能被风控）。 */
    publish(groupId: string | number, content: string): Promise<{
        topic_id: number;
    }>;
    /** 发表评论（写操作）。 */
    comment(topicId: string | number, content: string): Promise<{
        comment_id: number;
    }>;
    /** 点赞主题（写操作）。 */
    like(topicId: string | number): Promise<Record<string, never>>;
    /** 轻量连通性自检：拉取星球列表（不打印内容）。 */
    ping(): Promise<{
        groupCount: number;
        firstGroup?: string;
    }>;
}
/** 把主题渲染成便于阅读的文本（agent 工具输出用）。 */
export declare function formatTopic(topic: ZsxqTopic): string;
