import * as Sentry from "@sentry/node";

export function initSentry(dsn: string | undefined): void {
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate: 0,
  });
}
