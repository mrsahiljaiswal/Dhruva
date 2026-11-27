import type { AuditEntry, LearningActivity } from "@dhruva/shared";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { ApiError as ProgressError, studentProgress } from "@/features/analytics/api";
import { ApiError, auditHistory, listAudit } from "./api";

const fields = [
  ["actorId", "Actor"],
  ["action", "Action"],
  ["subjectType", "Subject type"],
  ["subjectId", "Subject id"],
  ["from", "From"],
  ["to", "To"],
] as const;

function presentWhen(value: string) {
  return new Date(value).toLocaleString();
}

export function AuditPage() {
  const [filters, setFilters] = useState<Record<(typeof fields)[number][0], string>>({
    actorId: "",
    action: "",
    subjectType: "",
    subjectId: "",
    from: "",
    to: "",
  });
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [activity, setActivity] = useState<LearningActivity[] | null>(null);
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!value) {
        continue;
      }
      query[key] = key === "from" || key === "to" ? new Date(value).toISOString() : value;
    }
    try {
      const page = await listAudit(query);
      setRows(page.data);
      setTotal(page.total);
      setHistory(null);
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "The audit log could not be loaded.");
    }
  }

  async function loadHistory() {
    if (!filters.subjectType || !filters.subjectId) {
      setError("Enter a subject type and id to read one record's history.");
      return;
    }
    setError(null);
    try {
      setHistory(await auditHistory(filters.subjectType, filters.subjectId));
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "That history could not be loaded.");
    }
  }

  async function loadActivity(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setActivity(null);
    try {
      const progress = await studentProgress(studentId.trim());
      setActivity(progress.activity);
    } catch (caught: unknown) {
      setError(caught instanceof ProgressError ? caught.message : "Learning activity could not be loaded.");
    }
  }

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Read who did what. The log cannot be edited. Learning activity is kept in a separate record and shown below.
        </p>
      </div>
      {error ? <ErrorState title="Something went wrong" description={error} /> : null}
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => void search(event)}>
        {fields.map(([key, label]) => (
          <label key={key} className="space-y-1 text-sm">
            <span>{label}</span>
            <Input
              aria-label={label}
              type={key === "from" || key === "to" ? "datetime-local" : "text"}
              value={filters[key]}
              onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
            />
          </label>
        ))}
        <div className="flex items-end gap-2">
          <Button type="submit">Search</Button>
          <Button type="button" variant="outline" onClick={() => void loadHistory()}>
            Record history
          </Button>
        </div>
      </form>
      {rows && rows.length === 0 ? <EmptyState title="No audit entries" description="Nothing matches these filters." /> : null}
      {rows && rows.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{total} entries</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{presentWhen(row.createdAt)}</TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell>{row.actorId ?? "System"}</TableCell>
                  <TableCell>
                    {row.subjectType}
                    {row.subjectId ? ` ${row.subjectId}` : ""}
                  </TableCell>
                  <TableCell>{row.reason ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {history ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Record history</h2>
          {history.length === 0 ? (
            <EmptyState title="No history" description="This record has no audit entries." />
          ) : (
            <ul className="space-y-2 text-sm">
              {history.map((row) => (
                <li key={row.id}>
                  {presentWhen(row.createdAt)} · {row.action}
                  {row.reason ? ` · ${row.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <form className="space-y-3" onSubmit={(event) => void loadActivity(event)}>
        <h2 className="text-lg font-semibold">Learning activity</h2>
        <p className="text-sm text-muted-foreground">This list is the student's learning events. It is not written into the audit log.</p>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Student id" value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="Student id" required />
          <Button type="submit">Show activity</Button>
        </div>
        {activity && activity.length === 0 ? <EmptyState title="No learning activity" description="This student has no learning events yet." /> : null}
        {activity && activity.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {activity.map((event) => (
              <li key={`${event.type}-${event.refId}-${event.occurredAt}`}>
                {presentWhen(event.occurredAt)} · {event.type} · {event.refType}
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    </section>
  );
}
