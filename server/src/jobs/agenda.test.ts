import { describe, expect, it } from "vitest";
import { createAgenda } from "./agenda.js";

describe("createAgenda", () => {
  it("builds a scheduler without connecting", () => {
    const agenda = createAgenda("mongodb://127.0.0.1:27017/dhruva-test");
    expect(typeof agenda.start).toBe("function");
    expect(typeof agenda.stop).toBe("function");
  });
});
