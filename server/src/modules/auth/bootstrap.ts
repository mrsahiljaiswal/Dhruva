import type { UserRepository } from "../users/repository.js";
import type { AuthService } from "./service.js";

export async function ensureBootstrapAdmin(
  service: AuthService,
  users: UserRepository,
  email: string | undefined,
  name: string | undefined,
): Promise<void> {
  if (!email) {
    return;
  }
  const existing = await users.findByEmail(email);
  if (existing) {
    return;
  }
  await service.invite({
    name: name ?? "Administrator",
    email,
    role: "ADMIN",
    actorId: null,
  });
}
