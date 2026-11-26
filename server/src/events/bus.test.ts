import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { EventBus } from "./bus.js";

const logger = pino({ level: "silent" });

describe("EventBus", () => {
  it("delivers an event to its subscriber", async () => {
    const bus = new EventBus(logger);
    const received: string[] = [];
    bus.on("user.created", (event) => {
      received.push(event.action);
    });

    await bus.emit({ action: "user.created", subjectType: "User" });

    expect(received).toEqual(["user.created"]);
  });

  it("does not fail the caller when a subscriber throws", async () => {
    const error = vi.fn();
    const bus = new EventBus({ error } as never);
    bus.on("user.created", () => {
      throw new Error("subscriber failed");
    });

    await expect(bus.emit({ action: "user.created", subjectType: "User" })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
