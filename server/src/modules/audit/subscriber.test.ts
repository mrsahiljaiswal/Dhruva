import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { EventBus } from "../../events/bus.js";
import type { AuditRecord, AuditWriter } from "./subscriber.js";
import { registerAuditSubscriber } from "./subscriber.js";

const logger = pino({ level: "silent" });

function memoryWriter() {
  const records: AuditRecord[] = [];
  const writer: AuditWriter = {
    async write(record) {
      records.push(record);
    },
  };
  return { records, writer };
}

describe("audit subscriber", () => {
  it("records an audited event", async () => {
    const bus = new EventBus(logger);
    const { records, writer } = memoryWriter();
    registerAuditSubscriber(bus, writer);

    await bus.emit({
      action: "user.created",
      subjectType: "User",
      after: { email: "student@example.com" },
      requestId: "req-audit-1",
    });

    expect(records).toEqual([
      {
        action: "user.created",
        actorId: null,
        subjectType: "User",
        subjectId: null,
        before: null,
        after: { email: "student@example.com" },
        reason: null,
        requestId: "req-audit-1",
        ip: null,
      },
    ]);
  });

  it("ignores events that are not audit actions", async () => {
    const bus = new EventBus(logger);
    const { records, writer } = memoryWriter();
    registerAuditSubscriber(bus, writer);

    await bus.emit({ action: "resource.opened", subjectType: "Resource" });

    expect(records).toHaveLength(0);
  });
});
