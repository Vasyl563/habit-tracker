import type { CursorPage, CursorQuery, FeedItemDto } from "@habit-tracker/types";
import { decodeCursor, toCursorPage } from "../../lib/cursor.js";
import type { FeedRepository, FeedRow } from "./feed.repository.js";

function toFeedItemDto(row: FeedRow): FeedItemDto {
  return {
    id: row.id,
    user: { id: row.userId, name: row.userName, image: row.userImage },
    habit: {
      id: row.habitId,
      name: row.habitName,
      visibility: row.visibility,
      currentStreak: row.currentStreak
    },
    date: row.date,
    note: row.note,
    createdAt: row.createdAt.toISOString()
  };
}

export class FeedService {
  constructor(private readonly repo: FeedRepository) {}

  /** Feed-shaped resource → cursor pagination (never offset). Not cached: it's per-user and changes constantly. */
  async list(viewerId: string, query: CursorQuery): Promise<CursorPage<FeedItemDto>> {
    const rows = await this.repo.list(viewerId, decodeCursor(query.cursor), query.limit);
    const page = toCursorPage(rows, query.limit);
    return { items: page.items.map(toFeedItemDto), nextCursor: page.nextCursor };
  }
}
