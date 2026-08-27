/**
 * Pub/Sub channel names shared by the api (subscriber) and the worker
 * (publisher). One channel per user — never a global one — so an SSE
 * connection only ever receives its own user's events (L11).
 */
export const sseUserChannel = (userId: string): string => `sse:user:${userId}`;
