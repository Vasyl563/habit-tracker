import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger } from "pino";

export interface CreateLoggerOptions {
  /** Service name stamped on every line — `api`, `worker`. */
  name: string;
  /** trace | debug | info | warn | error | fatal. Default `info`. */
  level?: string;
  /** Pretty-print for humans (dev). JSON otherwise (prod, aggregators). */
  pretty?: boolean;
}

/**
 * Structured logging with Pino (L9).
 *
 *  - JSON by default so Datadog / Loki / ELK ingest it directly.
 *  - `redact` scrubs PII/secrets *before* serialisation — mandatory before prod.
 *  - Use `logger.child({ requestId })` so every line of one request shares an id.
 *  - First argument is the object, second is the human message:
 *      logger.info({ userId, habitId }, "check-in created")
 */
export function createLogger({
  name,
  level = "info",
  pretty = false
}: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    name,
    level,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label })
    },
    redact: {
      paths: [
        "password",
        "*.password",
        "token",
        "*.token",
        "authorization",
        "*.authorization",
        "req.headers.authorization",
        "req.headers.cookie",
        "*.cookie",
        "*.secret",
        "*.apiKey"
      ],
      censor: "[Redacted]"
    },
    serializers: {
      err: pino.stdSerializers.err
    }
  };

  if (pretty) {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service" }
      }
    });
  }
  return pino(options);
}
