import type { RecipientView } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { EmptyState } from "@/components/states/empty-state";
import { Spinner } from "@/components/states/spinner";
import { Badge } from "@/components/ui/badge";
import { ApiError, getMyAssignments, getStudentAssignments } from "./api";

function formatDue(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function WorkList({ studentId }: { studentId?: string }) {
  const [rows, setRows] = useState<RecipientView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = studentId ? getStudentAssignments(studentId) : getMyAssignments();
    void load
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "Assignments could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [studentId]);

  if (error) {
    return <ErrorState title="Assignments unavailable" description={error} />;
  }
  if (!rows) {
    return <Spinner />;
  }
  if (rows.length === 0) {
    return <EmptyState title="No assignments" description="Published work for this student will be listed here." />;
  }

  return (
    <ul className="grid gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border bg-card px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{row.assignment.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{row.assignment.description}</p>
              <p className="mt-2 text-sm">Due {formatDue(row.assignment.dueDate)}</p>
              {row.assignment.resourceId && !studentId ? (
                <Link className="mt-2 inline-block text-sm underline" to={`/student/resources/${row.assignment.resourceId}`}>
                  Open the reading
                </Link>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Badge>{row.state.replaceAll("_", " ")}</Badge>
              {row.overdue ? <Badge className="border-amber-200 bg-amber-50 text-amber-800">Overdue</Badge> : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
