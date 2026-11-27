import type Agenda from "agenda";
import { runAnnouncementSchedule, type ScheduleDeps } from "../modules/moderation/service.js";

export function registerAnnouncementJob(agenda: Agenda, deps: ScheduleDeps): void {
  agenda.define("announcement.publish_scheduled", async () => {
    const now = deps.now?.() ?? new Date();
    await runAnnouncementSchedule(deps, now);
  });
}

export async function ensureAnnouncementSchedule(agenda: Agenda): Promise<void> {
  const existing = await agenda.jobs({ name: "announcement.publish_scheduled" });
  if (existing.length === 0) {
    await agenda.every("1 minute", "announcement.publish_scheduled");
  }
}
