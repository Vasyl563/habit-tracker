import { addDays, computeStreaks, todayIso } from "@habit-tracker/shared";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { truncateAll } from "./reset.js";
import {
  accounts,
  checkIns,
  follows,
  habits,
  notifications,
  userSettings,
  users
} from "./schema/index.js";

/**
 * Demo seed — realistic data through Drizzle, ≥ 20 rows per core entity,
 * relations resolved, denormalised counters consistent with the check-ins.
 * Idempotent: truncates first, then inserts a deterministic data set.
 *
 * Every user can sign in with password `Password123!` (better-auth credential
 * account, hashed the same way better-auth does it).
 */

// deterministic PRNG so the seed is reproducible (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(42);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)] as T;

const PEOPLE = [
  ["Ada Lovelace", "ada"],
  ["Alan Turing", "alan"],
  ["Grace Hopper", "grace"],
  ["Linus Torvalds", "linus"],
  ["Margaret Hamilton", "margaret"],
  ["Dennis Ritchie", "dennis"],
  ["Barbara Liskov", "barbara"],
  ["Ken Thompson", "ken"],
  ["Radia Perlman", "radia"],
  ["Tim Berners-Lee", "tim"],
  ["Hedy Lamarr", "hedy"],
  ["Donald Knuth", "donald"],
  ["Frances Allen", "frances"],
  ["Guido van Rossum", "guido"],
  ["Katherine Johnson", "katherine"],
  ["Brendan Eich", "brendan"],
  ["Anita Borg", "anita"],
  ["James Gosling", "james"],
  ["Adele Goldberg", "adele"],
  ["Rob Pike", "rob"],
  ["Sophie Wilson", "sophie"],
  ["Bjarne Stroustrup", "bjarne"],
  ["Mary Kenneth Keller", "mary"],
  ["Ryan Dahl", "ryan"]
] as const;

const HABIT_TEMPLATES = [
  { name: "Read 20 pages", description: "Any book, paper or long-form article", schedule: "daily" },
  { name: "Morning run", description: "5 km, easy pace", schedule: "weekly", weekdays: [1, 3, 5] },
  { name: "Meditate 10 min", description: null, schedule: "daily" },
  { name: "Drink 2 L water", description: "Track with the bottle", schedule: "daily" },
  { name: "Practice Ukrainian", description: "Duolingo or a podcast", schedule: "daily" },
  {
    name: "Strength training",
    description: "Gym or bodyweight",
    schedule: "weekly",
    weekdays: [2, 4]
  },
  { name: "No sugar", description: "Fruit is fine", schedule: "daily" },
  { name: "Write journal", description: "Three lines are enough", schedule: "daily" },
  { name: "Call parents", description: null, schedule: "weekly", weekdays: [0] },
  {
    name: "Code kata",
    description: "One exercise before work",
    schedule: "weekly",
    weekdays: [1, 2, 3, 4, 5]
  },
  { name: "Walk 8k steps", description: null, schedule: "daily" },
  { name: "Sleep before 23:00", description: "Phone out of the bedroom", schedule: "daily" }
] as const;

const NOTES = [
  null,
  null,
  null,
  "Felt great",
  "Barely made it",
  "Did a bit more than planned",
  "Tough day but done",
  "Streak saved at 23:55 😅"
];

async function main(): Promise<void> {
  const today = todayIso();
  const passwordHash = await hashPassword("Password123!");

  await truncateAll(db);

  // ── users + settings + credential accounts ────────────────────────────────
  const insertedUsers = await db
    .insert(users)
    .values(
      PEOPLE.map(([name, handle], i) => ({
        name,
        email: `${handle}@example.com`,
        bio:
          i % 3 === 0 ? `Hi, I'm ${name.split(" ")[0]}. Building habits one day at a time.` : null,
        emailVerified: true
      }))
    )
    .returning();

  await db.insert(userSettings).values(
    insertedUsers.map((u, i) => ({
      userId: u.id,
      timezone: pick(["Europe/Kyiv", "UTC", "Europe/Berlin", "America/New_York"]),
      emailNotifications: i % 4 !== 3,
      weeklyDigest: i % 2 === 0
    }))
  );

  await db.insert(accounts).values(
    insertedUsers.map((u) => ({
      userId: u.id,
      issuer: "local:credential",
      providerId: "credential",
      accountId: u.id,
      password: passwordHash
    }))
  );

  // ── habits: 1–3 per user, ≥ 40 total ──────────────────────────────────────
  const habitRows: (typeof habits.$inferInsert)[] = [];
  for (const user of insertedUsers) {
    const count = 1 + Math.floor(random() * 3);
    const used = new Set<number>();
    for (let i = 0; i < count; i += 1) {
      let idx = Math.floor(random() * HABIT_TEMPLATES.length);
      while (used.has(idx)) idx = (idx + 1) % HABIT_TEMPLATES.length;
      used.add(idx);
      const t = HABIT_TEMPLATES[idx] as (typeof HABIT_TEMPLATES)[number];
      habitRows.push({
        userId: user.id,
        name: t.name,
        description: t.description,
        schedule: t.schedule,
        weekdays: "weekdays" in t ? [...t.weekdays] : null,
        visibility: pick(["public", "public", "friends", "private"] as const)
      });
    }
  }
  const insertedHabits = await db.insert(habits).values(habitRows).returning();

  // ── check-ins: last 45 days, realistic gaps; then streaks from the data ───
  const checkInRows: (typeof checkIns.$inferInsert)[] = [];
  const perHabitDates = new Map<string, string[]>();
  for (const habit of insertedHabits) {
    const consistency = 0.45 + random() * 0.5; // some users are more disciplined
    const dates: string[] = [];
    for (let back = 45; back >= 0; back -= 1) {
      const date = addDays(today, -back);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const scheduled = habit.schedule === "daily" || (habit.weekdays ?? []).includes(weekday);
      if (!scheduled) continue;
      if (random() < consistency) {
        dates.push(date);
        checkInRows.push({ habitId: habit.id, date, note: pick(NOTES) });
      }
    }
    perHabitDates.set(habit.id, dates);
  }
  // one INSERT with hundreds of rows — much cheaper than N round-trips
  for (let i = 0; i < checkInRows.length; i += 500) {
    await db.insert(checkIns).values(checkInRows.slice(i, i + 500));
  }

  for (const habit of insertedHabits) {
    const dates = perHabitDates.get(habit.id) ?? [];
    const streaks = computeStreaks(dates, habit, today);
    await db
      .update(habits)
      .set({
        currentStreak: streaks.current,
        longestStreak: streaks.longest,
        totalCheckIns: dates.length,
        lastCheckInDate: dates.length ? (dates[dates.length - 1] ?? null) : null
      })
      .where(eq(habits.id, habit.id));
  }

  // ── follows: each user follows 2–4 others (no self-follow, no dupes) ─────
  const followRows: (typeof follows.$inferInsert)[] = [];
  const seen = new Set<string>();
  for (const follower of insertedUsers) {
    const n = 2 + Math.floor(random() * 3);
    for (let i = 0; i < n; i += 1) {
      const followee = pick(insertedUsers);
      const key = `${follower.id}:${followee.id}`;
      if (followee.id === follower.id || seen.has(key)) continue;
      seen.add(key);
      followRows.push({ followerId: follower.id, followeeId: followee.id });
    }
  }
  await db.insert(follows).values(followRows);

  // ── a few notifications so the inbox isn't empty ─────────────────────────
  const notificationRows: (typeof notifications.$inferInsert)[] = [];
  for (const f of followRows.slice(0, 30)) {
    const follower = insertedUsers.find((u) => u.id === f.followerId);
    notificationRows.push({
      userId: f.followeeId,
      type: "follow.created",
      title: `${follower?.name ?? "Someone"} started following you`,
      body: null,
      data: { followerId: f.followerId },
      readAt: random() < 0.5 ? new Date() : null
    });
  }
  await db.insert(notifications).values(notificationRows);

  // ── round-trip SELECT to prove the data lives ─────────────────────────────
  const sample = await db.query.users.findFirst({
    with: { habits: { with: { checkIns: { limit: 3 } } }, settings: true }
  });
  console.log(JSON.stringify(sample, null, 2));
  console.log(
    `\n✅ Seeded ${insertedUsers.length} users, ${insertedHabits.length} habits, ` +
      `${checkInRows.length} check-ins, ${followRows.length} follows, ` +
      `${notificationRows.length} notifications.\n   Sign in with any user + password "Password123!"`
  );

  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
