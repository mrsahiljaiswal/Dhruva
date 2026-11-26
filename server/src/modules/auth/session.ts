import type { Request, RequestHandler } from "express";

export const SESSION_COOKIE = "dhruva.sid";
export const CSRF_COOKIE = "dhruva.csrf";
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export function establishSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      req.session.userId = userId;
      req.session.issuedAt = Date.now();
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

type SessionStore = NonNullable<Request["session"]> extends never ? never : {
  all?: (callback: (error: unknown, sessions?: Record<string, { userId?: string }> | null) => void) => void;
  destroy: (sessionId: string, callback: (error?: unknown) => void) => void;
};

export async function revokeOtherSessions(req: Request, userId: string): Promise<void> {
  const store = req.sessionStore as SessionStore | undefined;
  if (!store?.all) {
    return;
  }
  const sessions = await new Promise<Record<string, { userId?: string }>>((resolve, reject) => {
    store.all?.((error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? {});
    });
  });
  const current = req.sessionID;
  await Promise.all(
    Object.entries(sessions)
      .filter(([sessionId, data]) => data?.userId === userId && sessionId !== current)
      .map(
        ([sessionId]) =>
          new Promise<void>((resolve, reject) => {
            store.destroy(sessionId, (error) => (error ? reject(error) : resolve()));
          }),
      ),
  );
}

export async function revokeUserSessions(req: Request, userId: string): Promise<void> {
  const store = req.sessionStore as SessionStore | undefined;
  if (!store?.all) {
    return;
  }
  const sessions = await new Promise<Record<string, { userId?: string }>>((resolve, reject) => {
    store.all?.((error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? {});
    });
  });
  await Promise.all(
    Object.entries(sessions)
      .filter(([, data]) => data?.userId === userId)
      .map(
        ([sessionId]) =>
          new Promise<void>((resolve, reject) => {
            store.destroy(sessionId, (error) => (error ? reject(error) : resolve()));
          }),
      ),
  );
}

export function asyncRoute(handler: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    issuedAt: number;
  }
}
