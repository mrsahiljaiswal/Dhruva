import { Link } from "react-router-dom";
import { ApiStatus } from "@/components/api-status";
import { ProgressPanel } from "@/features/analytics/progress-panel";
import { PlanPanel } from "@/features/learning/plan-panel";

export function StudentDashboard() {
  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your plan for today, plus anything assigned just to you.</p>
        </div>
        <ApiStatus />
      </div>
      <ProgressPanel />
      <PlanPanel />
      <Link to="/student/assignments" className="inline-block text-sm underline">
        All assignments
      </Link>
    </section>
  );
}
