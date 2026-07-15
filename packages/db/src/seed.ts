import { db, pool } from "./client.js";
import { users, habits, checkIns, follows } from "./schema.js";

async function main(): Promise<void> {
  // Idempotent: wipe in FK-safe order so re-running the seed is safe.
  await db.delete(follows);
  await db.delete(checkIns);
  await db.delete(habits);
  await db.delete(users);

  const [ada, alan, grace] = await db
    .insert(users)
    .values([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "alan@example.com", name: "Alan Turing" },
      { email: "grace@example.com", name: "Grace Hopper" }
    ])
    .returning();

  if (!ada || !alan || !grace) {
    throw new Error("failed to seed users");
  }

  const [reading, running] = await db
    .insert(habits)
    .values([
      {
        userId: ada.id,
        name: "Read 20 pages",
        schedule: "daily",
        visibility: "friends",
        currentStreak: 3,
        longestStreak: 7
      },
      {
        userId: ada.id,
        name: "Morning run",
        schedule: "weekly",
        weekdays: [1, 3, 5],
        visibility: "public",
        currentStreak: 1,
        longestStreak: 4
      },
      {
        userId: alan.id,
        name: "Meditate 10 min",
        schedule: "daily",
        visibility: "private"
      }
    ])
    .returning();

  if (!reading || !running) {
    throw new Error("failed to seed habits");
  }

  await db.insert(checkIns).values([
    { habitId: reading.id, date: "2026-06-15" },
    { habitId: reading.id, date: "2026-06-16" },
    { habitId: reading.id, date: "2026-06-17" },
    { habitId: running.id, date: "2026-06-17" }
  ]);

  await db.insert(follows).values([
    { followerId: alan.id, followeeId: ada.id },
    { followerId: grace.id, followeeId: ada.id }
  ]);

  // ── Round-trip SELECT to prove the data lives ──────────────────────────────
  const seeded = await db.query.users.findMany({
    with: { habits: { with: { checkIns: true } } }
  });

  console.log(JSON.stringify(seeded, null, 2));
  const habitCount = seeded.reduce((n, u) => n + u.habits.length, 0);
  console.log(
    `\n✅ Seeded ${seeded.length} users, ${habitCount} habits, and their check-ins.`
  );

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
