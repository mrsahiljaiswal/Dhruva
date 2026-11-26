import type { PublicUser, Role } from "@dhruva/shared";
import { AppError } from "../../middleware/errors.js";
import type { AppLogger } from "../../platform/logger.js";
import type { Mailer } from "../../platform/mail.js";
import type { EventBus } from "../../events/bus.js";
import { DuplicateEmailError, type NewUser, type UserRecord, type UserRepository } from "../users/repository.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./passwords.js";
import { hashToken, newRawToken, type TokenPurpose, type TokenRepository } from "./tokens.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

const INVALID_LINK = "This link is invalid or has expired.";

export type InviteInput = {
  name: string;
  email: string;
  role: Role;
  branch?: UserRecord["branch"];
  cohortId?: string | null;
  actorId: string | null;
};

export class AuthService {
  private readonly dummyHash: string;

  constructor(
    private readonly options: {
      users: UserRepository;
      tokens: TokenRepository;
      mailer: Mailer;
      bus: EventBus;
      logger: AppLogger;
      appBaseUrl: string;
      passwordRounds?: number;
      exposeInviteLinks?: boolean;
      now?: () => Date;
    },
  ) {
    this.dummyHash = dummyPasswordHash(options.passwordRounds ?? 12);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private rounds(): number {
    return this.options.passwordRounds ?? 12;
  }

  toPublic(user: UserRecord): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branch: user.branch,
      cohortId: user.cohortId,
      status: user.status,
      capabilities: user.capabilities,
    };
  }

  async invite(input: InviteInput): Promise<{ user: UserRecord; inviteUrl: string | null }> {
    const email = input.email.toLowerCase();
    const now = this.now();
    const existing = await this.options.users.findByEmail(email);
    let user: UserRecord;
    let created = false;

    if (existing && existing.status !== "INVITED") {
      throw new AppError(409, "CONFLICT", "An account with this email already exists.");
    }

    const draft: NewUser = {
      name: input.name.trim(),
      email,
      passwordHash: null,
      role: input.role,
      branch: input.branch ?? null,
      cohortId: input.role === "STUDENT" ? (input.cohortId ?? null) : null,
      status: "INVITED",
      capabilities: {
        canCreateResources: false,
        canCreateAssessments: false,
        canGradeAssessments: false,
      },
      invitedAt: existing?.invitedAt ?? now,
      activatedAt: null,
    };

    if (existing) {
      user =
        (await this.options.users.update(existing.id, {
          name: draft.name,
          role: draft.role,
          branch: draft.branch,
        })) ?? existing;
    } else {
      try {
        user = await this.options.users.create(draft);
        created = true;
      } catch (error) {
        if (error instanceof DuplicateEmailError) {
          throw new AppError(409, "CONFLICT", error.message);
        }
        throw error;
      }
    }

    const raw = await this.issueToken(user.id, "INVITE", INVITE_TTL_MS, now);
    const url = `${this.options.appBaseUrl}/accept-invite?token=${raw}`;
    const roleLabel =
      input.role === "ADMIN" ? "an administrator" : input.role === "MENTOR" ? "a mentor" : "a student";
    let delivered = true;
    try {
      await this.options.mailer.send({
        to: user.email,
        subject: "Create your Dhruva password",
        text: `You have been invited to Dhruva as ${roleLabel}.\n\nCreate your password with this link. It expires in 7 days and works once.\n\n${url}\n`,
      });
    } catch (error) {
      delivered = false;
      this.options.logger.error({ err: error, to: user.email }, "invite email failed");
      this.options.logger.info({ to: user.email, url }, "invite link");
    }
    if (delivered && this.options.exposeInviteLinks) {
      this.options.logger.info({ to: user.email, url }, "invite link");
    }
    if (created) {
      await this.options.bus.emit({
        action: "user.created",
        actorId: input.actorId,
        subjectType: "User",
        subjectId: user.id,
        after: { email: user.email, role: user.role },
      });
    }
    return { user, inviteUrl: !delivered || this.options.exposeInviteLinks ? url : null };
  }

  async reinvite(userId: string): Promise<{ user: UserRecord; inviteUrl: string | null }> {
    const user = await this.options.users.findById(userId);
    if (!user) {
      throw new AppError(404, "NOT_FOUND", "That person was not found.");
    }
    if (user.status !== "INVITED") {
      throw new AppError(400, "INVALID_STATE", "Only an invited person can receive a new link.");
    }
    const raw = await this.issueToken(user.id, "INVITE", INVITE_TTL_MS, this.now());
    const url = `${this.options.appBaseUrl}/accept-invite?token=${raw}`;
    const roleLabel = user.role === "ADMIN" ? "an administrator" : user.role === "MENTOR" ? "a mentor" : "a student";
    let delivered = true;
    try {
      await this.options.mailer.send({
        to: user.email,
        subject: "Create your Dhruva password",
        text: `You have been invited to Dhruva as ${roleLabel}.\n\nCreate your password with this link. It expires in 7 days and works once.\n\n${url}\n`,
      });
    } catch (error) {
      delivered = false;
      this.options.logger.error({ err: error, to: user.email }, "invite email failed");
    }
    return { user, inviteUrl: !delivered || this.options.exposeInviteLinks ? url : null };
  }

  async acceptInvite(rawToken: string, password: string): Promise<UserRecord> {
    return this.consumeToken(rawToken, "INVITE", password);
  }

  async login(email: string, password: string): Promise<UserRecord> {
    const user = await this.options.users.findByEmail(email.toLowerCase());
    const matches = await verifyPassword(password, user?.passwordHash ?? this.dummyHash);
    if (!user?.passwordHash || !matches) {
      throw new AppError(401, "UNAUTHENTICATED", "Email or password is incorrect.");
    }
    if (user.status === "DEACTIVATED") {
      throw new AppError(403, "ACCOUNT_INACTIVE", "This account is deactivated.");
    }
    if (user.status !== "ACTIVE") {
      throw new AppError(401, "UNAUTHENTICATED", "Email or password is incorrect.");
    }
    return user;
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.options.users.findByEmail(email.toLowerCase());
    if (!user || user.status !== "ACTIVE" || !user.passwordHash) {
      return;
    }
    const raw = await this.issueToken(user.id, "RESET", RESET_TTL_MS, this.now());
    const url = `${this.options.appBaseUrl}/reset-password?token=${raw}`;
    await this.options.mailer.send({
      to: user.email,
      subject: "Reset your Dhruva password",
      text: `Open this link to choose a new password. It expires in 1 hour.\n\n${url}\n`,
    });
  }

  async resetPassword(rawToken: string, password: string): Promise<UserRecord> {
    return this.consumeToken(rawToken, "RESET", password);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.options.users.findById(userId);
    if (!user?.passwordHash) {
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    const matches = await verifyPassword(currentPassword, user.passwordHash);
    if (!matches) {
      throw new AppError(401, "UNAUTHENTICATED", "Current password is incorrect.");
    }
    const passwordHash = await hashPassword(newPassword, this.rounds());
    await this.options.users.update(user.id, { passwordHash });
  }

  private async issueToken(userId: string, purpose: TokenPurpose, ttlMs: number, now: Date): Promise<string> {
    await this.options.tokens.invalidateActive(userId, purpose, now);
    const raw = newRawToken();
    await this.options.tokens.create({
      userId,
      tokenHash: hashToken(raw),
      purpose,
      expiresAt: new Date(now.getTime() + ttlMs),
      usedAt: null,
    });
    return raw;
  }

  private async consumeToken(rawToken: string, purpose: TokenPurpose, password: string): Promise<UserRecord> {
    const now = this.now();
    const token = await this.options.tokens.findValid(hashToken(rawToken), purpose, now);
    const user = token ? await this.options.users.findById(token.userId) : null;
    if (!token || !user || user.status === "DEACTIVATED") {
      throw new AppError(400, "VALIDATION_ERROR", INVALID_LINK);
    }
    const passwordHash = await hashPassword(password, this.rounds());
    const updated = await this.options.users.update(user.id, {
      passwordHash,
      status: "ACTIVE",
      activatedAt: user.activatedAt ?? now,
    });
    await this.options.tokens.markUsed(token.id, now);
    if (!updated) {
      throw new AppError(400, "VALIDATION_ERROR", INVALID_LINK);
    }
    return updated;
  }
}
