import type { RequestHandler } from "express";
import type { ZodError, ZodTypeAny } from "zod";
import { AppError } from "./errors.js";

function fieldErrors(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new AppError(400, "VALIDATION_ERROR", "Request validation failed.", fieldErrors(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}
