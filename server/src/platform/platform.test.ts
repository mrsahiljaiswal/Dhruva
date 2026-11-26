import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { createMailer } from "./mail.js";
import { initSentry } from "./sentry.js";

describe("platform adapters", () => {
  it("skips email when no provider is configured", async () => {
    const info = vi.fn();
    const mailer = createMailer({ logger: { info } as never });

    await mailer.send({ to: "student@example.com", subject: "Welcome", text: "Set your password" });

    expect(info).toHaveBeenCalledWith(
      { to: "student@example.com", subject: "Welcome" },
      "email not sent: provider is not configured",
    );
  });

  it("sends the message through Gmail SMTP", async () => {
    const info = vi.fn();
    const sendMail = vi.fn().mockResolvedValue({});
    const mailer = createMailer({
      logger: { info, error: vi.fn() } as never,
      from: "admin@example.com",
      smtp: { host: "smtp.gmail.com", port: 587, user: "admin@example.com", pass: "app-password" },
      transport: { sendMail },
    });

    await mailer.send({ to: "mentor@example.com", subject: "Create your password", text: "Open the link" });

    expect(sendMail).toHaveBeenCalledWith({
      from: "admin@example.com",
      to: "mentor@example.com",
      subject: "Create your password",
      text: "Open the link",
    });
    expect(info).toHaveBeenCalledWith(
      { to: "mentor@example.com", subject: "Create your password" },
      "email sent",
    );
  });

  it("sends the message through Resend", async () => {
    const info = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    const mailer = createMailer({
      logger: { info, error: vi.fn() } as never,
      from: "Dhruva <invites@example.com>",
      apiKey: "re_test",
      fetchImpl,
    });

    await mailer.send({ to: "student@example.com", subject: "Create your password", text: "Open the link" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          from: "Dhruva <invites@example.com>",
          to: ["student@example.com"],
          subject: "Create your password",
          text: "Open the link",
        }),
      }),
    );
    expect(info).toHaveBeenCalledWith(
      { to: "student@example.com", subject: "Create your password" },
      "email sent",
    );
  });

  it("reports a provider rejection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" });
    const mailer = createMailer({
      logger: { info: vi.fn(), error: vi.fn() } as never,
      from: "Dhruva <invites@example.com>",
      apiKey: "re_test",
      fetchImpl,
    });

    await expect(
      mailer.send({ to: "student@example.com", subject: "Create your password", text: "Open the link" }),
    ).rejects.toThrow("The invite email could not be sent.");
  });

  it("does not start Sentry without a DSN", () => {
    expect(() => initSentry(undefined)).not.toThrow();
  });

  it("creates a silent logger", () => {
    const logger = pino({ level: "silent" });
    expect(() => logger.info("hidden")).not.toThrow();
  });
});
