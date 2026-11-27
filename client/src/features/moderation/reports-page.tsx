import type { ModerationAction, ReportQueueItem } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { ApiError, listReports, resolveReport } from "./api";

const ACTIONS: { action: ModerationAction; label: string }[] = [
  { action: "DISMISS", label: "Dismiss" },
  { action: "HIDE", label: "Hide content" },
  { action: "WARN", label: "Warn" },
  { action: "SUSPEND", label: "Suspend account" },
];

export function ReportsPage() {
  const [rows, setRows] = useState<ReportQueueItem[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  async function reload(includeClosed: boolean) {
    const next = await listReports(includeClosed ? undefined : "OPEN");
    setRows(next);
  }

  useEffect(() => {
    void reload(closed).catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : "Reports could not be loaded.");
    });
  }, [closed]);

  async function act(report: ReportQueueItem, action: ModerationAction) {
    const note = notes[report.id]?.trim() ?? "";
    if (!note) {
      setError("Write a note before resolving a report.");
      return;
    }
    setPending(report.id);
    setError(null);
    try {
      await resolveReport(report.id, { action, note });
      await reload(closed);
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "The report could not be resolved.");
    } finally {
      setPending(null);
    }
  }

  if (error && !rows) {
    return <ErrorState title="Reports could not be opened" description={error} />;
  }
  if (!rows) {
    return <Spinner />;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Moderation queue</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Dismiss a report, hide the content, warn the person, or suspend the account. Suspending deactivates the account. Every decision is audited.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={closed} onChange={(event) => setClosed(event.target.checked)} />
          Show closed reports
        </label>
      </div>
      {error ? <ErrorState title="Something went wrong" description={error} /> : null}
      {rows.length === 0 ? (
        <EmptyState title="No reports" description={closed ? "Nothing has been reported." : "The open queue is clear."} />
      ) : (
        <ul className="space-y-3">
          {rows.map((report) => (
            <li key={report.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">
                      {report.targetType} · {report.target?.excerpt ?? "Content no longer available"}
                    </CardTitle>
                    <Badge>{report.status}</Badge>
                    {report.target?.hidden ? <Badge>Hidden</Badge> : null}
                  </div>
                  <CardDescription>
                    Reported by {report.reportedByName}
                    {report.target?.authorName ? ` · about ${report.target.authorName}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">{report.reason}</p>
                  {report.status === "OPEN" ? (
                    <>
                      <textarea
                        aria-label={`Note for ${report.target?.excerpt ?? "report"}`}
                        className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                        value={notes[report.id] ?? ""}
                        onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))}
                        placeholder="Why you are resolving it this way"
                      />
                      <div className="flex flex-wrap gap-2">
                        {ACTIONS.map((item) => (
                          <Button
                            key={item.action}
                            type="button"
                            variant={item.action === "SUSPEND" ? "destructive" : "outline"}
                            disabled={pending === report.id || (item.action === "HIDE" && report.targetType === "USER")}
                            onClick={() => void act(report, item.action)}
                          >
                            {item.label}
                          </Button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {report.resolution ?? "Closed"}
                      {report.resolvedAt ? ` · ${new Date(report.resolvedAt).toLocaleString()}` : ""}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
