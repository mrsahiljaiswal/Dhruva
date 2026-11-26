import type { UserRepository } from "../users/repository.js";
import type { PreferenceRepository } from "./preferences.js";
import type { NotificationRepository } from "./repository.js";

export function createNotificationService(deps: {
  users: UserRepository;
  notifications: NotificationRepository;
  preferences: PreferenceRepository;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function owner(userId: string) {
    const user = await deps.users.findById(userId);
    if (!user || user.status !== "ACTIVE") {
      return null;
    }
    return user;
  }

  return {
    async list(userId: string) {
      const user = await owner(userId);
      if (!user) {
        return { data: [], unread: 0 };
      }
      const page = await deps.notifications.listForUser(user.id, 50);
      return {
        data: page.rows.map((row) => ({
          id: row.id,
          type: row.type,
          text: row.text,
          payload: row.payload,
          readAt: row.readAt ? row.readAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
        })),
        unread: page.unread,
      };
    },

    async markRead(userId: string, id: string) {
      const row = await deps.notifications.markRead(userId, id, now());
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        type: row.type,
        text: row.text,
        payload: row.payload,
        readAt: row.readAt ? row.readAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    },

    async markAllRead(userId: string) {
      const updated = await deps.notifications.markAllRead(userId, now());
      return { updated };
    },

    async preferences(userId: string) {
      return deps.preferences.get(userId);
    },

    async updatePreferences(userId: string, email: boolean) {
      return deps.preferences.set(userId, email);
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
