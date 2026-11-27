import type { StudentProgressView, SupportIndicator } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, myProgress } from "./api";

const INDICATOR_LABEL: Record<SupportIndicator, string> = {
  ON_TRACK: "On track",
  NEEDS_ATTENTION: "Needs attention",
  MENTOR_INTERVENTION: "Mentor intervention",
};

function count(value: number | null, suffix = ""): string {
  if (value === null) {
    return "—";
  }
  return `${value}${suffix}`;
}

export function ProgressPanel() {
  const [progress, setProgress] = useState<StudentProgressView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void myProgress()
      .then((result) => {
        if (!controller.signal.aborted) {
          setProgress(result);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "Progress could not be loaded.");
        }
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return <ErrorState title="Progress unavailable" description={error} />;
  }
  if (!progress) {
    return <Spinner />;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Progress</h2>
        <p className="text-sm text-muted-foreground">Assignment completion and assessment scores are tracked separately.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Assigned", progress.assignedCount],
          ["Completed", progress.completedCount],
          ["Pending", progress.pendingCount],
          ["Overdue", progress.overdueCount],
        ].map(([label, value]) => (
          <Card key={String(label)} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Assignment completion</CardDescription>
            <CardTitle className="text-3xl">{count(progress.completionPct, "%")}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Assessment average</CardDescription>
            <CardTitle className="text-3xl">{count(progress.averageScore, "%")}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Active days this week</CardDescription>
            <CardTitle className="text-3xl">{progress.weeklyActiveDays}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-1 pb-4">
            {progress.week.map((day) => (
              <span
                key={day.date}
                title={day.date}
                className={day.active ? "h-2 flex-1 rounded-full bg-primary" : "h-2 flex-1 rounded-full bg-muted"}
              />
            ))}
          </CardContent>
        </Card>
      </div>
      {progress.topicScores.length > 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Topics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {progress.topicScores.map((topic) => (
              <div key={topic.topic} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{topic.topic}</span>
                <span className="text-muted-foreground">
                  {topic.completedCount}/{topic.assignedCount} assignments
                  {topic.averageScore === null ? "" : ` · ${topic.averageScore}% assessments`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Recent feedback</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {progress.recentFeedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">Feedback from your mentor will show up here.</p>
          ) : (
            progress.recentFeedback.map((item) => (
              <div key={`${item.reviewedAt}-${item.assignmentTitle}`}>
                <p className="text-sm font-medium">{item.assignmentTitle}</p>
                <p className="text-sm text-muted-foreground">{item.feedback}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function IndicatorBadge({ indicator }: { indicator: SupportIndicator }) {
  const tone =
    indicator === "ON_TRACK"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : indicator === "NEEDS_ATTENTION"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-rose-200 bg-rose-50 text-rose-800";
  return <Badge className={tone}>{INDICATOR_LABEL[indicator]}</Badge>;
}
