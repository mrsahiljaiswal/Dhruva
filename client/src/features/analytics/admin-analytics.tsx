import type { AdminAnalytics, ExportKind } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminAnalytics, ApiError, createExport, readExport } from "./api";
import { IndicatorBadge } from "./progress-panel";

const EXPORTS: { kind: ExportKind; label: string }[] = [
  { kind: "STUDENT_PROGRESS", label: "Student progress" },
  { kind: "MENTOR_ALLOCATION", label: "Mentor allocation" },
  { kind: "ASSESSMENTS", label: "Assessments" },
  { kind: "COHORT_PERFORMANCE", label: "Cohort performance" },
];

export function AdminAnalyticsPanel() {
  const [overview, setOverview] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExportKind | null>(null);

  useEffect(() => {
    void adminAnalytics()
      .then(setOverview)
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "The overview could not be loaded.");
      });
  }, []);

  async function requestReport(kind: ExportKind) {
    setBusy(kind);
    setExportError(null);
    setDownloadUrl(null);
    try {
      let job = await createExport({ kind });
      for (let attempt = 0; attempt < 10 && job.status === "PENDING"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        job = await readExport(job.id);
      }
      if (job.status === "FAILED" || !job.downloadUrl) {
        setExportError("The report could not be prepared.");
        return;
      }
      setDownloadUrl(job.downloadUrl);
    } catch (caught: unknown) {
      setExportError(caught instanceof ApiError ? caught.message : "The report could not be requested.");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }
  if (!overview) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Active users", overview.totals.activeUsers],
          ["Students", overview.totals.students],
          ["Mentors", overview.totals.mentors],
          ["Flagged", overview.flagged.length],
        ].map(([label, value]) => (
          <Card key={String(label)} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{overview.supportNote}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Mentor workload</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {overview.mentorWorkload.length === 0 ? <p className="text-muted-foreground">No mentors yet.</p> : null}
            {overview.mentorWorkload.map((mentor) => (
              <div key={mentor.mentorId} className="flex justify-between gap-3">
                <span>{mentor.name}</span>
                <span className="text-muted-foreground">
                  {mentor.students} students · {mentor.pendingSubmissions} to review · {mentor.needingSupport} flagged
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Cohorts and branches</CardTitle>
            <CardDescription>
              Resources opened: {overview.resourceCompletion.opened}/{overview.resourceCompletion.published}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {overview.cohorts.map((cohort) => (
              <div key={cohort.cohortId} className="flex justify-between gap-3">
                <span>{cohort.name}</span>
                <span className="text-muted-foreground">
                  {cohort.completionPct ?? "—"}% complete · {cohort.needingSupport} flagged
                </span>
              </div>
            ))}
            {overview.branches.map((branch) => (
              <div key={branch.branch} className="flex justify-between gap-3">
                <span>{branch.branch}</span>
                <span className="text-muted-foreground">{branch.averageScore ?? "—"}% assessment average</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {overview.flagged.length > 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Students flagged for support</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {overview.flagged.map((student) => (
              <div key={student.studentId} className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{student.name}</p>
                  <p className="text-sm text-muted-foreground">{student.supportReasons.join(" ")}</p>
                </div>
                <IndicatorBadge indicator={student.supportIndicator} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>Each report runs as a job and returns a download link that lasts 15 minutes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {EXPORTS.map((item) => (
            <Button key={item.kind} type="button" variant="outline" disabled={busy !== null} onClick={() => void requestReport(item.kind)}>
              {busy === item.kind ? "Preparing…" : item.label}
            </Button>
          ))}
          {downloadUrl ? (
            <a className="self-center text-sm underline" href={downloadUrl}>
              Download report
            </a>
          ) : null}
          {exportError ? <p className="w-full text-sm text-destructive">{exportError}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
