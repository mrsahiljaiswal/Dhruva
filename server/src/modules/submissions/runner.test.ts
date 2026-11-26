import { describe, expect, it } from "vitest";
import { ManualReviewRunner } from "./runner.js";

describe("ManualReviewRunner", () => {
  it("leaves the submission for a mentor and does not execute the source", async () => {
    const runner = new ManualReviewRunner();
    const result = await runner.run({
      source: "import os; os.system('echo executed')",
      language: "python",
      tests: [{ name: "sample", input: "1", expectedOutput: "1" }],
      limits: { timeMs: 1_000, memoryMb: 64 },
    });
    expect(runner.mode).toBe("manual");
    expect(result).toEqual({ status: "pending_review", cases: [] });
  });
});
