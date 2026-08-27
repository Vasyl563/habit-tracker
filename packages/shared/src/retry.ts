import { sleep } from "./sleep.js";

/**
 * Retry with exponential backoff + *equal jitter* (L9).
 *
 * Why jitter: without it, 1000 clients hit by the same outage all retry at
 * exactly 200 ms, 400 ms, 800 ms — three synchronised stampedes. Equal jitter
 * keeps half of the delay deterministic and randomises the other half.
 *
 * Retry ONLY retriable failures (network, 5xx, 429). A 4xx will not fix itself.
 */
export interface RetryOptions {
  /** How many *extra* attempts after the first one. Default 3. */
  retries?: number;
  /** First backoff in ms. Default 200. */
  baseMs?: number;
  /** Cap for a single backoff in ms. Default 4000. */
  maxMs?: number;
  /** Decide whether an error is worth retrying. Default: `isRetriableError`. */
  isRetriable?: (error: unknown) => boolean;
  /** Called before every wait — handy for logging. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Cancels waiting between attempts. */
  signal?: AbortSignal;
  /** Injected for tests; defaults to Math.random. */
  random?: () => number;
}

/** Errors that mark themselves as permanent (worker code throws these on 4xx). */
export class UnrecoverableError extends Error {
  override readonly name = "UnrecoverableError";
}

const RETRIABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "ENOTFOUND",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT"
]);

/**
 * Default classifier: network-ish errors and HTTP 5xx / 429 are retriable.
 * Anything with `status` in 400..499 (except 429) is the caller's fault.
 */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof UnrecoverableError) return false;
  if (typeof error !== "object" || error === null) return false;

  const err = error as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
  const status = typeof err.status === "number" ? err.status : err.statusCode;

  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500) return true;
    return false;
  }
  if (typeof err.code === "string" && RETRIABLE_CODES.has(err.code)) return true;
  if (err.name === "AbortError") return false;
  // Unknown shape without an HTTP status — e.g. fetch's TypeError on network failure.
  return err.name === "TypeError" || err.name === "FetchError";
}

/** Exponential backoff with equal jitter: expo/2 + random(0, expo/2). */
export function backoffDelay(
  attempt: number,
  { baseMs = 200, maxMs = 4_000, random = Math.random } = {}
): number {
  const expo = Math.min(baseMs * 2 ** attempt, maxMs);
  return Math.round(expo / 2 + random() * (expo / 2));
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseMs = 200,
    maxMs = 4_000,
    isRetriable = isRetriableError,
    onRetry,
    signal,
    random
  } = options;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRetriable(error)) throw error;
      const delayMs = backoffDelay(attempt, { baseMs, maxMs, random });
      onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs, signal);
      attempt += 1;
    }
  }
}
