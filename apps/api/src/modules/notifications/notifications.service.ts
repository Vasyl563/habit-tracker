import type { Notification } from "@habit-tracker/db";
import {
  type CursorPage,
  type NotificationDto,
  notificationTypeSchema
} from "@habit-tracker/types";
import { decodeCursor, toCursorPage } from "../../lib/cursor.js";
import { NotFoundError } from "../../lib/errors.js";
import type { SseHub } from "../../lib/sse-hub.js";
import type { NotificationsRepository } from "./notifications.repository.js";

export function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    type: notificationTypeSchema.parse(row.type),
    title: row.title,
    body: row.body,
    data: row.data ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly sse: SseHub
  ) {}

  async list(
    userId: string,
    query: { limit: number; cursor?: string; unreadOnly: boolean }
  ): Promise<CursorPage<NotificationDto>> {
    const rows = await this.repo.list(userId, {
      unreadOnly: query.unreadOnly,
      limit: query.limit,
      cursor: decodeCursor(query.cursor)
    });
    const page = toCursorPage(rows, query.limit);
    return { items: page.items.map(toNotificationDto), nextCursor: page.nextCursor };
  }

  unreadCount(userId: string): Promise<number> {
    return this.repo.unreadCount(userId);
  }

  async markRead(userId: string, id: string): Promise<NotificationDto> {
    const existing = await this.repo.findById(id);
    if (!existing || existing.userId !== userId) throw new NotFoundError("Notification");
    const row = (await this.repo.markRead(id)) ?? existing;
    await this.pushUnreadCount(userId);
    return toNotificationDto(row);
  }

  async markAllRead(userId: string): Promise<number> {
    const updated = await this.repo.markAllRead(userId);
    await this.pushUnreadCount(userId);
    return updated;
  }

  /** other tabs/devices see the badge drop without polling (SSE, L11) */
  private async pushUnreadCount(userId: string): Promise<void> {
    const count = await this.repo.unreadCount(userId);
    await this.sse.publish(userId, { type: "unread-count", count });
  }
}
