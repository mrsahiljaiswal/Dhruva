import { healthResponseSchema } from "@dhruva/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { createApp } from "./app.js";

const logger = pino({ level: "silent" });

function app(ready: boolean, limits?: { limit: number; windowMs: number }) {
  return createApp({
    clientOrigin: "http://localhost:5173",
    isDbReady: () => ready,
    logger,
    rateLimit: limits ?? false,
  });
}

describe("HTTP shell", () => {
  it("returns ok for liveness and echoes a safe request id", async () => {
    const response = await request(app(false)).get("/api/v1/health").set("x-request-id", "req-123");

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(response.body)).toEqual({ data: { status: "ok" } });
    expect(response.headers["x-request-id"]).toBe("req-123");
  });

  it("reports not ready when the database is down", async () => {
    const response = await request(app(false)).get("/api/v1/ready");

    expect(response.status).toBe(503);
    expect(response.body.data.status).toBe("down");
  });

  it("reports ready when the database is up", async () => {
    const response = await request(app(true)).get("/api/v1/ready");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });

  it("returns the error envelope for an unknown route", async () => {
    const response = await request(app(true)).get("/api/v1/missing");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("allows the configured browser origin", async () => {
    const response = await request(app(true))
      .get("/api/v1/health")
      .set("Origin", "http://localhost:5173");

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("does not allow an unknown origin", async () => {
    const response = await request(app(true))
      .get("/api/v1/health")
      .set("Origin", "https://evil.example");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate limits with the standard error envelope", async () => {
    const limited = app(true, { limit: 1, windowMs: 60_000 });
    const first = await request(limited).get("/api/v1/health");
    const second = await request(limited).get("/api/v1/health");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("RATE_LIMITED");
    expect(second.headers["retry-after"]).toBeTruthy();
  });
});
