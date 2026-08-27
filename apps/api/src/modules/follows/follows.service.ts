import type { Db } from "@habit-tracker/db";
import type { OffsetPage, OffsetQuery, PublicUserDto } from "@habit-tracker/types";
import { NotFoundError, UnprocessableError } from "../../lib/errors.js";
import { writeOutboxEvent } from "../../lib/outbox.js";
import { toPublicUserDto } from "../users/users.mapper.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { UsersService } from "../users/users.service.js";
import type { FollowsRepository } from "./follows.repository.js";

export class FollowsService {
  constructor(
    private readonly db: Db,
    private readonly repo: FollowsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly usersService: UsersService
  ) {}

  /**
   * Follow = one row + one domain event, in ONE transaction (L11 outbox).
   * The DB CHECK forbids self-follow too, but we say it nicely first.
   */
  async follow(followerId: string, followeeId: string): Promise<void> {
    if (followerId === followeeId) throw new UnprocessableError("You cannot follow yourself");
    const target = await this.usersRepo.findById(followeeId);
    if (!target) throw new NotFoundError("User");

    await this.db.transaction(async (tx) => {
      await this.repo.create(followerId, followeeId, tx);
      await writeOutboxEvent(
        tx,
        { type: "user", id: followeeId },
        { type: "follow.created", payload: { followerId, followeeId } }
      );
    });

    // follower/following counts live in both cached profiles
    await Promise.all([
      this.usersService.invalidateProfile(followerId),
      this.usersService.invalidateProfile(followeeId)
    ]);
  }

  async unfollow(followerId: string, followeeId: string): Promise<void> {
    const removed = await this.repo.remove(followerId, followeeId);
    if (!removed) throw new NotFoundError("Follow");
    await Promise.all([
      this.usersService.invalidateProfile(followerId),
      this.usersService.invalidateProfile(followeeId)
    ]);
  }

  async followers(userId: string, query: OffsetQuery): Promise<OffsetPage<PublicUserDto>> {
    const { items, total } = await this.repo.listFollowers(userId, query.limit, query.offset);
    return { items: items.map(toPublicUserDto), total, limit: query.limit, offset: query.offset };
  }

  async following(userId: string, query: OffsetQuery): Promise<OffsetPage<PublicUserDto>> {
    const { items, total } = await this.repo.listFollowing(userId, query.limit, query.offset);
    return { items: items.map(toPublicUserDto), total, limit: query.limit, offset: query.offset };
  }
}
