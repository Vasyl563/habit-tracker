import type { Db } from "@habit-tracker/db";
import { computeStreaks, crossedMilestone, todayIso } from "@habit-tracker/shared";
import type {
  CheckInDto,
  CheckInResultDto,
  CreateCheckInInput,
  CursorPage,
  ListCheckInsQuery
} from "@habit-tracker/types";
import { decodeCursor, toCursorPage } from "../../lib/cursor.js";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError
} from "../../lib/errors.js";
import { writeOutboxEvent } from "../../lib/outbox.js";
import type { FilesRepository } from "../files/files.repository.js";
import type { HabitsRepository } from "../habits/habits.repository.js";
import type { HabitsService } from "../habits/habits.service.js";
import { toCheckInDto } from "./check-ins.mapper.js";
import type { CheckInsRepository } from "./check-ins.repository.js";

export class CheckInsService {
  constructor(
    private readonly db: Db,
    private readonly repo: CheckInsRepository,
    private readonly habitsRepo: HabitsRepository,
    private readonly habitsService: HabitsService,
    private readonly filesRepo: FilesRepository
  ) {}

  /**
   * THE atomic operation of the theme: insert the check-in AND recompute the
   * streak counters in one transaction (course NFR).
   *
   *  - `SELECT … FOR UPDATE` on the habit serialises concurrent check-ins from
   *    two devices: the second waits, then sees the first's row.
   *  - UNIQUE (habit_id, date) makes the duplicate a 409 at the DB boundary.
   *  - The `checkin.created` event goes to the outbox in the same tx (L11), so
   *    a milestone notification can never be lost or invented.
   */
  async create(userId: string, input: CreateCheckInInput): Promise<CheckInResultDto> {
    const today = todayIso();
    const date = input.date ?? today;
    if (date > today) throw new UnprocessableError("You cannot check in a future date");

    const result = await this.db.transaction(async (tx) => {
      const habit = await this.habitsRepo.lockForUpdate(input.habitId, tx);
      if (!habit) throw new NotFoundError("Habit");
      if (habit.userId !== userId) throw new ForbiddenError("This habit belongs to another user");
      if (habit.archivedAt) throw new UnprocessableError("This habit is archived");

      if (input.photoFileId) {
        const photo = await this.filesRepo.findById(input.photoFileId, tx);
        if (!photo || photo.userId !== userId || photo.kind !== "checkin_photo") {
          throw new ValidationError("photoFileId must reference your own uploaded photo", {
            path: ["photoFileId"]
          });
        }
      }

      const checkIn = await this.repo.create(
        {
          habitId: habit.id,
          date,
          note: input.note ?? null,
          photoFileId: input.photoFileId ?? null
        },
        tx
      );

      const dates = await this.repo.listDates(habit.id, tx);
      const streaks = computeStreaks(dates, habit, today);
      const milestone = crossedMilestone(habit.currentStreak, streaks.current);

      await this.habitsRepo.updateCounters(
        habit.id,
        {
          currentStreak: streaks.current,
          longestStreak: Math.max(streaks.longest, habit.longestStreak),
          totalCheckIns: dates.length,
          lastCheckInDate: dates[dates.length - 1] ?? null
        },
        tx
      );

      await writeOutboxEvent(
        tx,
        { type: "habit", id: habit.id },
        {
          type: "checkin.created",
          payload: {
            checkInId: checkIn.id,
            habitId: habit.id,
            habitName: habit.name,
            userId,
            date,
            streakBefore: habit.currentStreak,
            streakAfter: streaks.current,
            milestone
          }
        }
      );

      return { checkIn, streaks, milestone };
    });

    await this.habitsService.invalidate(userId);
    return {
      checkIn: toCheckInDto(result.checkIn),
      streak: {
        current: result.streaks.current,
        longest: result.streaks.longest,
        milestone: result.milestone
      }
    };
  }

  /** Undo a check-in — same locking + recompute discipline. */
  async remove(userId: string, habitId: string, date: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const habit = await this.habitsRepo.lockForUpdate(habitId, tx);
      if (!habit) throw new NotFoundError("Habit");
      if (habit.userId !== userId) throw new ForbiddenError("This habit belongs to another user");

      const removed = await this.repo.remove(habit.id, date, tx);
      if (!removed) throw new NotFoundError("Check-in");

      const dates = await this.repo.listDates(habit.id, tx);
      const streaks = computeStreaks(dates, habit, todayIso());
      await this.habitsRepo.updateCounters(
        habit.id,
        {
          currentStreak: streaks.current,
          longestStreak: streaks.longest,
          totalCheckIns: dates.length,
          lastCheckInDate: dates[dates.length - 1] ?? null
        },
        tx
      );
    });
    await this.habitsService.invalidate(userId);
  }

  /** Cursor-paginated history of one habit — visibility enforced first. */
  async list(viewerId: string, query: ListCheckInsQuery): Promise<CursorPage<CheckInDto>> {
    const habit = await this.habitsService.getVisible(viewerId, query.habitId);
    const rows = await this.repo.listForHabit(habit.id, {
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: decodeCursor(query.cursor)
    });
    const page = toCursorPage(rows, query.limit);
    return { items: page.items.map(toCheckInDto), nextCursor: page.nextCursor };
  }
}
