import type { EventBus } from "../../events/bus.js";
import { AppError } from "../../middleware/errors.js";
import type { UserRecord, UserRepository } from "./repository.js";

export async function deactivateAccount(input: {
  users: UserRepository;
  bus: EventBus;
  actorId: string;
  userId: string;
  requestId?: string | null;
  revokeSessions?: (userId: string) => Promise<void>;
}): Promise<UserRecord> {
  if (input.actorId === input.userId) {
    throw new AppError(400, "VALIDATION_ERROR", "You cannot deactivate your own account.");
  }
  const current = await input.users.findById(input.userId);
  if (!current) {
    throw new AppError(404, "NOT_FOUND", "That person was not found.");
  }
  const updated = await input.users.update(current.id, { status: "DEACTIVATED" });
  if (!updated) {
    throw new AppError(404, "NOT_FOUND", "That person was not found.");
  }
  await input.bus.emit({
    action: "user.deactivated",
    actorId: input.actorId,
    subjectType: "User",
    subjectId: current.id,
    requestId: input.requestId ?? null,
  });
  await input.revokeSessions?.(current.id);
  return updated;
}
