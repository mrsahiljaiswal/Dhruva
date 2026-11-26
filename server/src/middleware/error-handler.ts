import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppLogger } from "../platform/logger.js";
import { AppError } from "./errors.js";

export function errorHandler(logger: AppLogger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const requestId = req.id ?? "";

    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues.map((issue) => ({
            path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
            message: issue.message,
          })),
          requestId,
        },
      });
      return;
    }

    const appError =
      error instanceof AppError ? error : new AppError(500, "INTERNAL", "Something went wrong.");

    if (appError.status >= 500) {
      logger.error({ err: error, requestId }, "request failed");
    } else {
      logger.warn({ code: appError.code, requestId }, "request rejected");
    }

    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
        requestId,
      },
    });
  };
}
