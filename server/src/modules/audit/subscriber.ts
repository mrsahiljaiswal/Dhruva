import type { DomainEvent, EventBus } from "../../events/bus.js";
import { AUDIT_ACTIONS, isAuditAction } from "./actions.js";
import { AuditLog } from "./model.js";

export type AuditRecord = {
  action: string;
  actorId: string | null;
  subjectType: string;
  subjectId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  requestId: string | null;
  ip: string | null;
};

export interface AuditWriter {
  write(record: AuditRecord): Promise<void>;
}

export const mongooseAuditWriter: AuditWriter = {
  async write(record) {
    await AuditLog.create(record);
  },
};

function toRecord(event: DomainEvent): AuditRecord {
  return {
    action: event.action,
    actorId: event.actorId ?? null,
    subjectType: event.subjectType,
    subjectId: event.subjectId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason ?? null,
    requestId: event.requestId ?? null,
    ip: event.ip ?? null,
  };
}

export function registerAuditSubscriber(bus: EventBus, writer: AuditWriter = mongooseAuditWriter): void {
  for (const action of AUDIT_ACTIONS) {
    bus.on(action, async (event) => {
      if (!isAuditAction(event.action)) {
        return;
      }
      await writer.write(toRecord(event));
    });
  }
}
