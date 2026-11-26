import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const REQUEST_ID = /^[\w-]{1,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
};

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}
