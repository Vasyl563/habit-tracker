import { authed, rateLimited } from "../../lib/orpc.js";

/** presigning is cheap for us but each URL is a write slot in storage — cap it */
const presignLimit = rateLimited("files:presign", { limit: 30, windowSeconds: 60 });

export const filesController = {
  presignUpload: authed.files.presignUpload
    .use(presignLimit)
    .handler(({ context, input }) => context.services.files.presignUpload(context.user.id, input)),

  ack: authed.files.ack.handler(({ context, input }) =>
    context.services.files.ack(context.user.id, input.id)
  ),

  get: authed.files.get.handler(({ context, input }) =>
    context.services.files.get(context.user.id, input.id)
  ),

  list: authed.files.list.handler(({ context, input }) =>
    context.services.files.list(context.user.id, input)
  ),

  remove: authed.files.remove.handler(async ({ context, input }) => {
    await context.services.files.remove(context.user.id, input.id);
    return { ok: true as const };
  })
};
