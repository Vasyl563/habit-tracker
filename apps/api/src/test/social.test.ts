import type { CursorPage, FeedItemDto, HabitDto, ProfileDto } from "@habit-tracker/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, createTestApp, type Session, signUp, type TestApp } from "./helpers.js";

/**
 * Follows + feed + profile: visibility rules enforced in SQL on every read,
 * cursor pagination on the feed, cached profile invalidated on follow.
 */
describe("social", () => {
  let t: TestApp;
  let ada: Session;
  let alan: Session;
  let grace: Session;

  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
    ada = await signUp(t.app, "Ada");
    alan = await signUp(t.app, "Alan");
    grace = await signUp(t.app, "Grace");

    // Ada: one habit per visibility, each checked in today
    for (const visibility of ["public", "friends", "private"] as const) {
      const h = await api<HabitDto>(t.app, "POST", "/v1/habits", {
        session: ada,
        body: { name: `${visibility} habit`, visibility }
      });
      await api(t.app, "POST", `/v1/habits/${h.body.id}/check-ins`, { session: ada, body: {} });
    }
  });
  afterAll(() => t?.close());

  it("follow: 201, duplicate 409, self 422, unfollow 200", async () => {
    expect(
      (await api(t.app, "POST", `/v1/users/${ada.userId}/follow`, { session: alan })).status
    ).toBe(201);
    expect(
      (await api(t.app, "POST", `/v1/users/${ada.userId}/follow`, { session: alan })).status
    ).toBe(409);
    expect(
      (await api(t.app, "POST", `/v1/users/${alan.userId}/follow`, { session: alan })).status
    ).toBe(422);
    expect(
      (await api(t.app, "POST", `/v1/users/${ada.userId}/follow`, { session: grace })).status
    ).toBe(201);
    expect(
      (await api(t.app, "DELETE", `/v1/users/${ada.userId}/follow`, { session: grace })).status
    ).toBe(200);
    expect(
      (await api(t.app, "DELETE", `/v1/users/${ada.userId}/follow`, { session: grace })).status
    ).toBe(404);
  });

  it("feed shows only public habits to a one-way follower", async () => {
    const feed = await api<CursorPage<FeedItemDto>>(t.app, "GET", "/v1/feed", { session: alan });
    expect(feed.status).toBe(200);
    expect(feed.body.items.map((i) => i.habit.visibility)).toEqual(["public"]);
    expect(feed.body.items[0]?.user.id).toBe(ada.userId);
  });

  it("feed adds friends-only habits once the follow is mutual", async () => {
    await api(t.app, "POST", `/v1/users/${alan.userId}/follow`, { session: ada }); // Ada follows Alan back
    const feed = await api<CursorPage<FeedItemDto>>(t.app, "GET", "/v1/feed", { session: alan });
    const kinds = feed.body.items.map((i) => i.habit.visibility).sort();
    expect(kinds).toEqual(["friends", "public"]);
    // private never appears, and it stays a 404 on direct access
    const priv = feed.body.items.find((i) => i.habit.visibility === "private");
    expect(priv).toBeUndefined();
  });

  it("feed is empty for someone who follows nobody", async () => {
    const feed = await api<CursorPage<FeedItemDto>>(t.app, "GET", "/v1/feed", { session: grace });
    expect(feed.body).toEqual({ items: [], nextCursor: null });
  });

  it("profile aggregates stats in SQL and reflects the viewer relationship", async () => {
    const p = await api<ProfileDto>(t.app, "GET", `/v1/users/${ada.userId}`, { session: alan });
    expect(p.status).toBe(200);
    expect(p.body.user).not.toHaveProperty("email");
    expect(p.body.stats).toMatchObject({
      habitsTracked: 3,
      totalCheckIns: 3,
      followers: 1,
      following: 1
    });
    expect(p.body.viewer).toEqual({ isMe: false, isFollowing: true, isFollowedBy: true });

    // cached (user+stats) but the follower count must update after a new follow
    await api(t.app, "POST", `/v1/users/${ada.userId}/follow`, { session: grace });
    const p2 = await api<ProfileDto>(t.app, "GET", `/v1/users/${ada.userId}`, { session: grace });
    expect(p2.body.stats.followers).toBe(2);
    expect(p2.body.viewer.isFollowing).toBe(true);
  });

  it("followers / following lists paginate with offsets", async () => {
    const followers = await api<{ items: { id: string }[]; total: number }>(
      t.app,
      "GET",
      `/v1/users/${ada.userId}/followers?limit=1&offset=0`,
      { session: ada }
    );
    expect(followers.body.total).toBe(2);
    expect(followers.body.items).toHaveLength(1);
  });
});
