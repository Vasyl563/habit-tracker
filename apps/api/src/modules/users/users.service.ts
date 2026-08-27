import type {
  MeDto,
  OffsetPage,
  ProfileDto,
  PublicUserDto,
  SearchUsersQuery,
  UpdateMeInput,
  UpdateSettingsInput
} from "@habit-tracker/types";
import { type Cache, cacheKey } from "../../lib/cache.js";
import { NotFoundError } from "../../lib/errors.js";
import { toMeDto, toPublicUserDto } from "./users.mapper.js";
import type { UsersRepository } from "./users.repository.js";

const PROFILE_TTL_SECONDS = 60;
export const profileNamespace = (userId: string) => `profile:${userId}`;

/**
 * Service (L4): business rules live here. It knows whether a missing row is
 * a 404, what the caller may see, and when caches must be invalidated.
 * It never touches Hono/oRPC types — controllers are the only HTTP-aware layer.
 */
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly cache: Cache
  ) {}

  async me(userId: string): Promise<MeDto> {
    const [user, settings] = await Promise.all([
      this.repo.findById(userId),
      this.repo.findSettings(userId)
    ]);
    if (!user) throw new NotFoundError("User");
    return toMeDto(user, settings);
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<MeDto> {
    const patch: { name?: string; bio?: string | null } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.bio !== undefined) patch.bio = input.bio;
    if (Object.keys(patch).length > 0) await this.repo.updateProfile(userId, patch);
    await this.invalidateProfile(userId); // name/bio are part of the cached profile
    return this.me(userId);
  }

  async updateSettings(userId: string, input: UpdateSettingsInput): Promise<MeDto> {
    await this.repo.upsertSettings(userId, input);
    return this.me(userId);
  }

  async search(query: SearchUsersQuery): Promise<OffsetPage<PublicUserDto>> {
    const { items, total } = await this.repo.search(query.q, query.limit, query.offset);
    return { items: items.map(toPublicUserDto), total, limit: query.limit, offset: query.offset };
  }

  /**
   * Public profile = cached (user + stats) with TTL + event invalidation,
   * plus the viewer's relationship computed fresh (it's per-viewer and cheap).
   */
  async profile(viewerId: string, targetId: string): Promise<ProfileDto> {
    const version = await this.cache.version(profileNamespace(targetId));
    const cached = await this.cache.getOrSet(
      cacheKey("profile", targetId, version),
      PROFILE_TTL_SECONDS,
      async () => {
        const user = await this.repo.findById(targetId);
        if (!user) return null;
        const stats = await this.repo.stats(targetId);
        return { user: toPublicUserDto(user), stats };
      }
    );
    if (!cached) throw new NotFoundError("User");

    const isMe = viewerId === targetId;
    const rel = isMe
      ? { isFollowing: false, isFollowedBy: false }
      : await this.repo.relationship(viewerId, targetId);

    return { ...cached, viewer: { isMe, ...rel } };
  }

  /** Called by habits/check-ins/follows services after writes that change stats. */
  invalidateProfile(userId: string): Promise<void> {
    return this.cache.bumpVersion(profileNamespace(userId));
  }
}
