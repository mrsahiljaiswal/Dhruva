import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { EventBus } from "../../events/bus.js";
import type { OutboundMail } from "../../platform/mail.js";
import { createMemoryUserRepository } from "../users/repository.js";
import { hashPassword } from "./passwords.js";
import { AuthService } from "./service.js";
import { createMemoryTokenRepository } from "./tokens.js";

const logger = pino({ level: "silent" });

function setup(now = new Date("2026-01-01T00:00:00Z")) {
  const sent: OutboundMail[] = [];
  const users = createMemoryUserRepository();
  const service = new AuthService({
    users,
    tokens: createMemoryTokenRepository(),
    mailer: {
      async send(message) {
        sent.push(message);
      },
    },
    bus: new EventBus(logger),
    logger,
    appBaseUrl: "http://localhost:5173",
    passwordRounds: 4,
    now: () => now,
  });
  return { service, users, sent, setNow: (value: Date) => (now = value) };
}

function tokenFrom(message: OutboundMail): string {
  const match = message.text.match(/token=([^&\s]+)/);
  if (!match?.[1]) {
    throw new Error("missing token");
  }
  return match[1];
}

describe("AuthService", () => {
  it("invites a user, accepts the link once, and then allows login", async () => {
    const { service, sent } = setup();
    const invited = (
      await service.invite({
        name: "Ada Lovelace",
        email: "Ada@Example.com",
        role: "STUDENT",
        branch: "CSE",
        actorId: null,
      })
    ).user;

    expect(invited.status).toBe("INVITED");
    expect(invited.email).toBe("ada@example.com");
    expect(sent).toHaveLength(1);

    const user = await service.acceptInvite(tokenFrom(sent[0]!), "Correct1");
    expect(user.status).toBe("ACTIVE");
    await expect(service.acceptInvite(tokenFrom(sent[0]!), "Correct1")).rejects.toMatchObject({ status: 400 });
    const loggedIn = await service.login("ada@example.com", "Correct1");
    expect(loggedIn.id).toBe(user.id);
  });

  it("rejects a wrong password and a deactivated account", async () => {
    const { service, users } = setup();
    const passwordHash = await hashPassword("Correct1", 4);
    const user = await users.create({
      name: "Grace",
      email: "grace@example.com",
      passwordHash,
      role: "MENTOR",
      branch: null,
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });

    await expect(service.login(user.email, "wrong")).rejects.toMatchObject({ status: 401 });
    await users.update(user.id, { status: "DEACTIVATED" });
    await expect(service.login(user.email, "Correct1")).rejects.toMatchObject({
      status: 403,
      code: "ACCOUNT_INACTIVE",
    });
  });

  it("does not send a reset email for an unknown address", async () => {
    const { service, sent } = setup();
    await service.forgotPassword("missing@example.com");
    expect(sent).toHaveLength(0);
  });

  it("rejects an invite after it expires", async () => {
    const { service, sent, setNow } = setup(new Date("2026-01-01T00:00:00Z"));
    await service.invite({
      name: "Ada",
      email: "ada2@example.com",
      role: "MENTOR",
      actorId: null,
    });
    setNow(new Date("2026-01-10T00:00:00Z"));
    await expect(service.acceptInvite(tokenFrom(sent[0]!), "Correct1")).rejects.toMatchObject({ status: 400 });
  });
});
