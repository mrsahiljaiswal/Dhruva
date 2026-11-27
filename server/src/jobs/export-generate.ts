import type Agenda from "agenda";
import type { Job } from "agenda";
import { generateExport, type AnalyticsDeps } from "../modules/analytics/rebuild.js";

export function registerExportJob(agenda: Agenda, deps: AnalyticsDeps): void {
  agenda.define("export.generate", async (job: Job<{ exportId?: string }>) => {
    const exportId = job.attrs.data?.exportId;
    if (typeof exportId === "string") {
      await generateExport(deps, exportId);
    }
  });
}
