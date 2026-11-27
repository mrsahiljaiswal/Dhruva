import type { MentorAnalytics } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiStatus } from "@/components/api-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { mentorAnalytics } from "@/features/analytics/api";
import { IndicatorBadge } from "@/features/analytics/progress-panel";
import { useAuth } from "@/features/auth/auth-context";

type Student = { id: string; name: string; email: string; branch: string | null };

export function MentorDashboard() {
  const { user, listMentorStudents } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [analytics, setAnalytics] = useState<MentorAnalytics | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    void listMentorStudents(user.id)
      .then((rows) => setStudents(Array.isArray(rows) ? rows : []))
      .catch(() => setStudents([]));
    void mentorAnalytics()
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
  }, [listMentorStudents, user]);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mentor dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Students assigned to you.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild variant="outline">
            <Link to="/mentor/assignments">Assignments</Link>
          </Button>
          {user?.capabilities.canCreateResources ? (
            <Button asChild variant="outline">
              <Link to="/mentor/resources">Library</Link>
            </Button>
          ) : null}
          <ApiStatus />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Assigned students", analytics?.assignedStudents ?? students.length],
          ["Completion", analytics?.completionPct === null || analytics?.completionPct === undefined ? "—" : `${analytics.completionPct}%`],
          ["Pending submissions", analytics?.pendingSubmissions ?? "—"],
          ["Unanswered doubts", analytics?.unansweredDoubts ?? "—"],
        ].map(([label, value]) => (
          <Card key={String(label)} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {analytics ? <p className="text-sm text-muted-foreground">{analytics.supportNote}</p> : null}
      {students.length === 0 ? (
        <EmptyState
          title="No students yet"
          description="When an administrator assigns students to you, they will appear in this list."
        />
      ) : (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Your students</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {students.map((student) => (
              <div key={student.id} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3">
                <div>
                  <p className="font-medium">{student.name}</p>
                  <p className="text-sm text-muted-foreground">{student.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {analytics?.students.find((row) => row.id === student.id) ? (
                    <IndicatorBadge indicator={analytics.students.find((row) => row.id === student.id)!.supportIndicator} />
                  ) : null}
                  {student.branch ? <Badge>{student.branch}</Badge> : null}
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/mentor/students/${student.id}/assignments`}>Work</Link>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
