import nodemailer from "nodemailer";
import type { AppLogger } from "./logger.js";

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
};

export interface Mailer {
  send(message: OutboundMail): Promise<void>;
}

type SmtpSettings = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

type MailTransport = {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

const RESEND_URL = "https://api.resend.com/emails";

export function createMailer(options: {
  logger: AppLogger;
  from?: string;
  apiKey?: string;
  smtp?: SmtpSettings;
  transport?: MailTransport;
  fetchImpl?: typeof fetch;
}): Mailer {
  const transport =
    options.transport ??
    (options.smtp
      ? nodemailer.createTransport({
          host: options.smtp.host,
          port: options.smtp.port,
          secure: options.smtp.port === 465,
          auth: { user: options.smtp.user, pass: options.smtp.pass },
        })
      : undefined);
  const from = options.from ?? options.smtp?.user;

  return {
    async send(message) {
      if (transport && from) {
        try {
          await transport.sendMail({
            from,
            to: message.to,
            subject: message.subject,
            text: message.text,
          });
        } catch (error) {
          options.logger.error({ err: error, to: message.to }, "email provider rejected the message");
          throw new Error("The invite email could not be sent.");
        }
        options.logger.info({ to: message.to, subject: message.subject }, "email sent");
        return;
      }

      if (!options.apiKey || !from) {
        options.logger.info(
          { to: message.to, subject: message.subject },
          "email not sent: provider is not configured",
        );
        return;
      }

      const response = await (options.fetchImpl ?? fetch)(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        options.logger.error({ status: response.status, body }, "email provider rejected the message");
        throw new Error("The invite email could not be sent.");
      }

      options.logger.info({ to: message.to, subject: message.subject }, "email sent");
    },
  };
}
