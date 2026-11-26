import { CSRF_HEADER } from "@dhruva/shared";
import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { AppError } from "../../middleware/errors.js";
import { CSRF_COOKIE } from "./session.js";

export function issueCsrfToken(secure: boolean): RequestHandler {
  return (_req, res) => {
    const csrfToken = randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      sameSite: "lax",
      secure,
      path: "/",
    });
    res.json({ data: { csrfToken } });
  };
}

export function requireCsrf(): RequestHandler {
  return (req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const header = req.get(CSRF_HEADER);
    const cookie = req.cookies?.[CSRF_COOKIE];
    if (!header || !cookie || header !== cookie) {
      next(new AppError(403, "FORBIDDEN", "CSRF token is missing or invalid."));
      return;
    }
    next();
  };
}
