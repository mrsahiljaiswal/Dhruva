import type { AppLogger } from "../platform/logger.js";

export type DomainEvent = {
  action: string;
  actorId?: string | null;
  subjectType: string;
  subjectId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
  ip?: string | null;
};

type Handler = (event: DomainEvent) => Promise<void> | void;

export class EventBus {
  private readonly handlers = new Map<string, Handler[]>();

  constructor(private readonly logger: AppLogger) {}

  on(action: string, handler: Handler): void {
    const current = this.handlers.get(action) ?? [];
    current.push(handler);
    this.handlers.set(action, current);
  }

  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.action) ?? [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        this.logger.error({ err: error, action: event.action }, "event subscriber failed");
      }
    }
  }
}
