import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiStatus } from "@/components/api-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { useAuth } from "@/features/auth/auth-context";

type Student = { id: string; name: string; email: string; branch: string | null };

export function MentorDashboard() {
  const { user, listMentorStudents } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    if (!user) {
      return;
    }
    void listMentorStudents(user.id)
      .then((rows) => setStudents(Array.isArray(rows) ? rows : []))
      .catch(() => setStudents([]));
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Assigned students</CardDescription>
            <CardTitle className="text-3xl">{students.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>
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
