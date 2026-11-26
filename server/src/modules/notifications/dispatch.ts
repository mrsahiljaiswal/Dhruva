import type { NotificationType } from "@dhruva/shared";
import type { AppLogger } from "../../platform/logger.js";
import type { Mailer } from "../../platform/mail.js";
import type { Delivery } from "../../realtime/delivery.js";
import type { UserRepository } from "../users/repository.js";
import type { PreferenceRepository } from "./preferences.js";
import type { NewNotification, NotificationRepository } from "./repository.js";

const SUBJECTS: Record<NotificationType, string> = {
  ASSIGNMENT_PUBLISHED: "New assignment",
  DEADLINE_UPCOMING: "Upcoming deadline",
  MENTOR_FEEDBACK: "Mentor feedback",
  DOUBT_REPLY: "Doubt reply",
  DOUBT_ASKED: "New doubt",
  MESSAGE: "New message",
  ANNOUNCEMENT: "New announcement",
  MENTOR_REASSIGNED: "Mentor reassignment",
  DISCUSSION_REPORTED: "New report",
  BREAK_GLASS: "Private conversation opened",
};

export async function deliverNotification(
  deps: {
    users: UserRepository;
    notifications: NotificationRepository;
    preferences: PreferenceRepository;
    mailer?: Mailer;
    delivery: Delivery;
    logger: AppLogger;
    now?: () => Date;
  },
  input: NewNotification,
): Promise<void> {
  const user = await deps.users.findById(input.userId);
  if (!user || user.status !== "ACTIVE") {
    return;
  }
  const created = await deps.notifications.insert(input);
  if (!created) {
    return;
  }
  deps.delivery.notificationNew(user.id);
  const preference = await deps.preferences.get(user.id);
  if (!preference.email || !deps.mailer) {
    return;
  }
  try {
    await deps.mailer.send({
      to: user.email,
      subject: `Dhruva: ${SUBJECTS[input.type]}`,
      text: `${input.text}\n\nSign in to Dhruva to read it.`,
    });
    await deps.notifications.markEmailed(created.id, (deps.now ?? (() => new Date()))());
  } catch (error) {
    deps.logger.error({ err: error, userId: user.id, type: input.type }, "notification email failed");
  }
}
