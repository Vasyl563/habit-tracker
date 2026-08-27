import { Readable } from "node:stream";
import type { Storage } from "@habit-tracker/storage";
import { Hono } from "hono";
import type { AppEnv } from "../../app-env.js";
import { UnauthorizedError } from "../../lib/errors.js";
import type { FilesService } from "./files.service.js";

/**
 * Streaming download (L12) — a plain Hono route because we set headers and
 * pipe a stream. The object body flows chunk-by-chunk from storage to the
 * client; a 2 GB export uses the same RAM as a 20 KB avatar.
 */
export function createFilesDownloadRoutes(files: FilesService, storage: Storage) {
  const routes = new Hono<AppEnv>();

  routes.get("/files/:id/content", async (c) => {
    const session = c.get("session");
    if (!session) throw new UnauthorizedError();

    const file = await files.getReadable(session.user.id, c.req.param("id"));
    const stream = await storage.getStream(file.key);

    c.header("Content-Type", file.contentType);
    c.header("Content-Length", String(file.size));
    c.header("Cache-Control", "private, max-age=60");
    // attachment for anything not a plain image → the browser never "runs" it
    c.header(
      "Content-Disposition",
      `${file.contentType.startsWith("image/") ? "inline" : "attachment"}; filename="${file.originalName.replace(/"/g, "")}"`
    );
    // Node Readable → Web ReadableStream, which Hono forwards without buffering
    return c.body(Readable.toWeb(stream) as ReadableStream);
  });

  return routes;
}
