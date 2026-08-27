import type { CheckIn } from "@habit-tracker/db";
import type { CheckInDto } from "@habit-tracker/types";

export function toCheckInDto(row: CheckIn): CheckInDto {
  return {
    id: row.id,
    habitId: row.habitId,
    date: row.date,
    note: row.note,
    photoFileId: row.photoFileId,
    createdAt: row.createdAt.toISOString()
  };
}
