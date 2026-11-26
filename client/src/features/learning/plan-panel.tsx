import type { DailyPlan } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { EmptyState } from "@/components/states/empty-state";
import { Spinner } from "@/components/states/spinner";
import { Badge } from "@/components/ui/badge";
import { ApiError, getMyPlan } from "./api";

function formatDue(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function PlanPanel() {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getMyPlan()
      .then((result) => {
        if (!controller.signal.aborted) {
          setPlan(result);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "Today's plan could not be loaded.");
        }
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return <ErrorState title="Plan unavailable" description={error} />;
  }
  if (!plan) {
    return <Spinner />;
  }

  const quiet = plan.items.length === 0 && plan.deadlines.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{plan.date}</p>
        <h2 className="text-lg font-semibold">
          {plan.path ? `${plan.path.title} · ${plan.path.dayTitle}` : "No scheduled day"}
        </h2>
        {plan.dayNumber ? <p className="text-sm text-muted-foreground">Day {plan.dayNumber} of the program</p> : null}
      </div>
      {quiet ? <EmptyState title="Nothing scheduled" description="A published plan or assignment will show up here." /> : null}
      {plan.items.length > 0 ? (
        <ul className="grid gap-3">
          {plan.items.map((item) => (
            <li key={`${item.source}-${item.kind}-${item.refId}`} className="rounded-lg border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {item.source === "INDIVIDUAL" ? "Assigned to you" : item.kind === "RESOURCE" ? "Reading" : "Assignment"}
                  </p>
                  {item.kind === "RESOURCE" && item.title ? (
                    <Link className="font-medium underline" to={`/student/resources/${item.refId}`}>
                      {item.title}
                    </Link>
                  ) : (
                    <p className="font-medium">{item.title ?? "Untitled"}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {item.required ? <Badge>Required</Badge> : null}
                  {item.state ? <Badge>{item.state.replaceAll("_", " ")}</Badge> : null}
                  {item.overdue ? <Badge className="border-amber-200 bg-amber-50 text-amber-800">Overdue</Badge> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {plan.deadlines.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Deadlines</h3>
          <ul className="grid gap-2">
            {plan.deadlines.map((item) => (
              <li key={item.recipientId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{item.title}</span>
                <span className="text-muted-foreground">
                  {formatDue(item.dueDate)}
                  {item.overdue ? " · Overdue" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
