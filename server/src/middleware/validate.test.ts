import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pino } from "pino";
import { errorHandler } from "./error-handler.js";
import { requestId } from "./request-id.js";
import { validateBody } from "./validate.js";

function testApp() {
  const app = express();
  app.use(express.json());
  app.use(requestId);
  app.post(
    "/names",
    validateBody(z.object({ name: z.string().min(1) })),
    (req, res) => {
      res.status(201).json({ data: req.body });
    },
  );
  app.use(errorHandler(pino({ level: "silent" })));
  return app;
}

describe("validateBody", () => {
  it("rejects an invalid body with the error envelope", async () => {
    const response = await request(testApp()).post("/names").send({ name: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details[0].path).toBe("name");
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("passes a valid body through", async () => {
    const response = await request(testApp()).post("/names").send({ name: "Ada" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { name: "Ada" } });
  });
});
