import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("rejects a missing database uri", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        CLIENT_ORIGIN: "http://localhost:5173",
      }),
    ).toThrow(/MONGODB_URI/);
  });

  it("accepts a local test configuration and applies defaults", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      MONGODB_URI: "mongodb://127.0.0.1:27017/dhruva-test",
      PORT: "4100",
      SESSION_SECRET: "test-session-secret",
      CSRF_SECRET: "test-csrf-secret-value",
    });

    expect(env.PORT).toBe(4100);
    expect(env.CLIENT_ORIGIN).toBe("http://localhost:5173");
    expect(env.APP_BASE_URL).toBe("http://localhost:5173");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("requires the S3 settings when that driver is selected", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "test",
        MONGODB_URI: "mongodb://127.0.0.1:27017/dhruva-test",
        SESSION_SECRET: "test-session-secret",
        CSRF_SECRET: "test-csrf-secret-value",
        STORAGE_DRIVER: "s3",
      }),
    ).toThrow(/STORAGE_BUCKET/);
  });

  it("requires session secrets in production", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://127.0.0.1:27017/dhruva",
        CLIENT_ORIGIN: "https://dhruva.example",
      }),
    ).toThrow(/SESSION_SECRET/);
  });
});
