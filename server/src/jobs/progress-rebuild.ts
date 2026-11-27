import type Agenda from "agenda";
import { rebuildProgress, type AnalyticsDeps } from "../modules/analytics/rebuild.js";

export function registerRebuildJob(agenda: Agenda, deps: AnalyticsDeps): void {
  agenda.define("progress.rebuild", async () => {
    await rebuildProgress(deps);
  });
}

export async function ensureRebuildSchedule(agenda: Agenda): Promise<void> {
  const existing = await agenda.jobs({ name: "progress.rebuild" });
  if (existing.length === 0) {
    await agenda.every("0 2 * * *", "progress.rebuild");
  }
}
