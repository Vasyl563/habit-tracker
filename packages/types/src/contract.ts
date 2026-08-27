import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  billingStatusSchema,
  checkInResultSchema,
  checkInSchema,
  checkoutResultSchema,
  createCheckInSchema,
  createHabitSchema,
  cursorPageSchema,
  deleteCheckInSchema,
  errorResponseSchema,
  feedItemSchema,
  feedQuerySchema,
  fileIdSchema,
  fileSchema,
  followTargetSchema,
  habitSchema,
  listCheckInsQuerySchema,
  listFilesQuerySchema,
  listFollowsQuerySchema,
  listHabitsQuerySchema,
  listNotificationsQuerySchema,
  meSchema,
  notificationSchema,
  offsetPageSchema,
  okSchema,
  presignUploadResultSchema,
  presignUploadSchema,
  profileSchema,
  publicUserSchema,
  searchUsersQuerySchema,
  unreadCountSchema,
  updateHabitSchema,
  updateMeSchema,
  updateSettingsSchema,
  uuidSchema
} from "./schemas/index.js";

/**
 * The API contract (oRPC, contract-first).
 *
 * One place declares, for every procedure: HTTP method + path (for the OpenAPI
 * surface under /v1), the input schema (validated at the edge), and the output
 * schema (the DTO the API *promises*). The server implements it, the web client
 * consumes the same types — no hand-written DTOs anywhere.
 */

// Shared error docs so OpenAPI shows the unified envelope on every route.
const base = oc.errors({
  VALIDATION_ERROR: { status: 400, data: errorResponseSchema },
  UNAUTHORIZED: { status: 401, data: errorResponseSchema },
  FORBIDDEN: { status: 403, data: errorResponseSchema },
  NOT_FOUND: { status: 404, data: errorResponseSchema },
  CONFLICT: { status: 409, data: errorResponseSchema },
  RATE_LIMITED: { status: 429, data: errorResponseSchema }
});

const users = {
  me: base
    .route({ method: "GET", path: "/me", summary: "Current user + settings", tags: ["users"] })
    .output(meSchema),
  updateMe: base
    .route({ method: "PATCH", path: "/me", summary: "Update own profile", tags: ["users"] })
    .input(updateMeSchema)
    .output(meSchema),
  updateSettings: base
    .route({
      method: "PATCH",
      path: "/me/settings",
      summary: "Update own settings",
      tags: ["users"]
    })
    .input(updateSettingsSchema)
    .output(meSchema),
  search: base
    .route({ method: "GET", path: "/users", summary: "Search users (offset)", tags: ["users"] })
    .input(searchUsersQuerySchema)
    .output(offsetPageSchema(publicUserSchema)),
  profile: base
    .route({
      method: "GET",
      path: "/users/{userId}",
      summary: "Public profile + stats",
      tags: ["users"]
    })
    .input(z.object({ userId: uuidSchema }))
    .output(profileSchema)
};

const habits = {
  list: base
    .route({
      method: "GET",
      path: "/habits",
      summary: "My habits (offset, filters, sort)",
      tags: ["habits"]
    })
    .input(listHabitsQuerySchema)
    .output(offsetPageSchema(habitSchema)),
  get: base
    .route({
      method: "GET",
      path: "/habits/{id}",
      summary: "One habit (owner or visible)",
      tags: ["habits"]
    })
    .input(z.object({ id: uuidSchema }))
    .output(habitSchema),
  create: base
    .route({
      method: "POST",
      path: "/habits",
      successStatus: 201,
      summary: "Create habit",
      tags: ["habits"]
    })
    .input(createHabitSchema)
    .output(habitSchema),
  update: base
    .route({ method: "PATCH", path: "/habits/{id}", summary: "Update habit", tags: ["habits"] })
    .input(updateHabitSchema)
    .output(habitSchema),
  archive: base
    .route({
      method: "POST",
      path: "/habits/{id}/archive",
      summary: "Archive habit",
      tags: ["habits"]
    })
    .input(z.object({ id: uuidSchema }))
    .output(habitSchema),
  remove: base
    .route({ method: "DELETE", path: "/habits/{id}", summary: "Delete habit", tags: ["habits"] })
    .input(z.object({ id: uuidSchema }))
    .output(okSchema)
};

const checkIns = {
  create: base
    .route({
      method: "POST",
      path: "/habits/{habitId}/check-ins",
      successStatus: 201,
      summary: "Check in a habit for a day (atomic streak update)",
      tags: ["check-ins"]
    })
    .input(createCheckInSchema)
    .output(checkInResultSchema),
  remove: base
    .route({
      method: "DELETE",
      path: "/habits/{habitId}/check-ins/{date}",
      summary: "Undo a check-in",
      tags: ["check-ins"]
    })
    .input(deleteCheckInSchema)
    .output(okSchema),
  list: base
    .route({
      method: "GET",
      path: "/habits/{habitId}/check-ins",
      summary: "Check-ins of a habit (cursor)",
      tags: ["check-ins"]
    })
    .input(listCheckInsQuerySchema)
    .output(cursorPageSchema(checkInSchema))
};

const follows = {
  follow: base
    .route({
      method: "POST",
      path: "/users/{userId}/follow",
      successStatus: 201,
      summary: "Follow user",
      tags: ["social"]
    })
    .input(followTargetSchema)
    .output(okSchema),
  unfollow: base
    .route({
      method: "DELETE",
      path: "/users/{userId}/follow",
      summary: "Unfollow user",
      tags: ["social"]
    })
    .input(followTargetSchema)
    .output(okSchema),
  followers: base
    .route({
      method: "GET",
      path: "/users/{userId}/followers",
      summary: "Followers (offset)",
      tags: ["social"]
    })
    .input(listFollowsQuerySchema)
    .output(offsetPageSchema(publicUserSchema)),
  following: base
    .route({
      method: "GET",
      path: "/users/{userId}/following",
      summary: "Following (offset)",
      tags: ["social"]
    })
    .input(listFollowsQuerySchema)
    .output(offsetPageSchema(publicUserSchema))
};

const feed = {
  list: base
    .route({
      method: "GET",
      path: "/feed",
      summary: "Activity feed of followed users (cursor)",
      tags: ["social"]
    })
    .input(feedQuerySchema)
    .output(cursorPageSchema(feedItemSchema))
};

const notifications = {
  list: base
    .route({
      method: "GET",
      path: "/notifications",
      summary: "My notifications (cursor)",
      tags: ["notifications"]
    })
    .input(listNotificationsQuerySchema)
    .output(cursorPageSchema(notificationSchema)),
  unreadCount: base
    .route({
      method: "GET",
      path: "/notifications/unread-count",
      summary: "Unread badge",
      tags: ["notifications"]
    })
    .output(unreadCountSchema),
  markRead: base
    .route({
      method: "POST",
      path: "/notifications/{id}/read",
      summary: "Mark one read",
      tags: ["notifications"]
    })
    .input(z.object({ id: uuidSchema }))
    .output(notificationSchema),
  markAllRead: base
    .route({
      method: "POST",
      path: "/notifications/read-all",
      summary: "Mark all read",
      tags: ["notifications"]
    })
    .output(z.object({ updated: z.number().int() }))
};

const files = {
  presignUpload: base
    .route({
      method: "POST",
      path: "/files/presign",
      successStatus: 201,
      summary: "Step 1: get a presigned PUT URL",
      tags: ["files"]
    })
    .input(presignUploadSchema)
    .output(presignUploadResultSchema),
  ack: base
    .route({
      method: "POST",
      path: "/files/{id}/ack",
      summary: "Step 3: client finished uploading",
      tags: ["files"]
    })
    .input(fileIdSchema)
    .output(fileSchema),
  get: base
    .route({
      method: "GET",
      path: "/files/{id}",
      summary: "File metadata + presigned GET",
      tags: ["files"]
    })
    .input(fileIdSchema)
    .output(fileSchema),
  list: base
    .route({ method: "GET", path: "/files", summary: "My files (cursor)", tags: ["files"] })
    .input(listFilesQuerySchema)
    .output(cursorPageSchema(fileSchema)),
  remove: base
    .route({ method: "DELETE", path: "/files/{id}", summary: "Delete file", tags: ["files"] })
    .input(fileIdSchema)
    .output(okSchema)
};

const billing = {
  checkout: base
    .route({
      method: "POST",
      path: "/billing/checkout",
      successStatus: 201,
      summary: "Create Payment Intent for Pro",
      tags: ["billing"]
    })
    .output(checkoutResultSchema),
  status: base
    .route({
      method: "GET",
      path: "/billing/status",
      summary: "Plan + payment history",
      tags: ["billing"]
    })
    .output(billingStatusSchema)
};

export const contract = {
  users,
  habits,
  checkIns,
  follows,
  feed,
  notifications,
  files,
  billing
};

export type Contract = typeof contract;
