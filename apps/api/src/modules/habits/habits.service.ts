import type { Habit } from "@habit-tracker/db";
import type {
  CreateHabitInput,
  HabitDto,
  ListHabitsQuery,
  OffsetPage,
  UpdateHabitInput
} from "@habit-tracker/types";
import { type Cache, cacheKey, hashQuery } from "../../lib/cache.js";
import { ForbiddenError, NotFoundError } from "../../lib/errors.js";
import type { FollowsRepository } from "../follows/follows.repository.js";
import type { UsersService } from "../users/users.service.js";
import { toHabitDto } from "./habits.mapper.js";
import type { HabitsRepository } from "./habits.repository.js";

const LIST_TTL_SECONDS = 30;
export const habitsNamespace = (userId: string) => `habits:${userId}`;

export class HabitsService {
  constructor(
    private readonly repo: HabitsRepository,
    private readonly followsRepo: FollowsRepository,
    private readonly usersService: UsersService,
    private readonly cache: Cache
  ) {}

  /**
   * Cached list (L8): key = user + version + hashed query. Any write bumps the
   * user's version → every cached page of that user is stale at once, and the
   * old keys simply expire. TTL is the safety net.
   */
  async list(userId: string, query: ListHabitsQuery): Promise<OffsetPage<HabitDto>> {
    const version = await this.cache.version(habitsNamespace(userId));
    return this.cache.getOrSet(
      cacheKey("habits", userId, version, hashQuery(query)),
      LIST_TTL_SECONDS,
      async () => {
        const { items, total } = await this.repo.list(userId, query);
        return { items: items.map(toHabitDto), total, limit: query.limit, offset: query.offset };
      }
    );
  }

  /** Read with per-habit visibility enforced server-side (course NFR). */
  async get(viewerId: string, habitId: string): Promise<HabitDto> {
    const habit = await this.getVisible(viewerId, habitId);
    return toHabitDto(habit);
  }

  async create(userId: string, input: CreateHabitInput): Promise<HabitDto> {
    const habit = await this.repo.create({
      userId,
      name: input.name,
      description: input.description ?? null,
      schedule: input.schedule,
      weekdays: input.schedule === "weekly" ? (input.weekdays ?? null) : null,
      visibility: input.visibility
    });
    await this.invalidate(userId);
    return toHabitDto(habit);
  }

  async update(userId: string, input: UpdateHabitInput): Promise<HabitDto> {
    const habit = await this.getOwned(userId, input.id);
    const { id: _id, ...patch } = input;
    const schedule = patch.schedule ?? habit.schedule;
    const updated = await this.repo.update(habit.id, {
      ...patch,
      description: patch.description === undefined ? undefined : patch.description,
      weekdays: schedule === "weekly" ? (patch.weekdays ?? habit.weekdays) : null
    });
    await this.invalidate(userId);
    return toHabitDto(updated);
  }

  async archive(userId: string, habitId: string): Promise<HabitDto> {
    const habit = await this.getOwned(userId, habitId);
    const updated = await this.repo.update(habit.id, { archivedAt: new Date() });
    await this.invalidate(userId);
    return toHabitDto(updated);
  }

  async remove(userId: string, habitId: string): Promise<void> {
    await this.getOwned(userId, habitId);
    await this.repo.remove(habitId);
    await this.invalidate(userId);
  }

  // ── shared rules used by check-ins / feed too ─────────────────────────────

  /** 404 if missing; 403 if it belongs to someone else (mutations). */
  async getOwned(userId: string, habitId: string): Promise<Habit> {
    const habit = await this.repo.findById(habitId);
    if (!habit) throw new NotFoundError("Habit");
    if (habit.userId !== userId) throw new ForbiddenError("This habit belongs to another user");
    return habit;
  }

  /**
   * Visibility rules — reads:
   *   owner   → always
   *   public  → anyone signed in
   *   friends → mutual follow only
   *   private → nobody else (404, privacy-safe: we don't reveal it exists)
   */
  async getVisible(viewerId: string, habitId: string): Promise<Habit> {
    const habit = await this.repo.findById(habitId);
    if (!habit) throw new NotFoundError("Habit");
    if (await this.canView(viewerId, habit)) return habit;
    throw new NotFoundError("Habit");
  }

  async canView(viewerId: string, habit: Habit): Promise<boolean> {
    if (habit.userId === viewerId) return true;
    if (habit.visibility === "public") return true;
    if (habit.visibility === "friends") return this.followsRepo.isMutual(viewerId, habit.userId);
    return false;
  }

  /** habits list + profile stats both change on any habit write */
  async invalidate(userId: string): Promise<void> {
    await Promise.all([
      this.cache.bumpVersion(habitsNamespace(userId)),
      this.usersService.invalidateProfile(userId)
    ]);
  }
}
