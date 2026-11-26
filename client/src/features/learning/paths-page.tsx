import { zodResolver } from "@hookform/resolvers/zod";
import { learningPathWriteSchema } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { listResources } from "@/features/resources/api";
import { ApiError, archiveLearningPath, createLearningPath, listLearningPaths, publishLearningPath } from "./api";

function formError(errors: Record<string, unknown>): string | null {
  for (const value of Object.values(errors)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    if ("message" in value && typeof value.message === "string" && value.message) {
      return value.message;
    }
    const nested = formError(value as Record<string, unknown>);
    if (nested) {
      return nested;
    }
  }
  return null;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Summary = Awaited<ReturnType<typeof listLearningPaths>>[number];

export function PathsPage() {
  const { listCohorts } = useAuth();
  const [rows, setRows] = useState<Summary[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [resources, setResources] = useState<{ id: string; title: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(learningPathWriteSchema),
    defaultValues: {
      title: "",
      description: "",
      cohortId: "",
      durationDays: 14,
      modules: [
        {
          order: 1,
          title: "Core",
          weeks: [
            {
              weekNumber: 1,
              title: "Week 1",
              days: [{ dayNumber: 1, title: "Day 1", items: [{ kind: "RESOURCE" as const, refId: "", required: true }] }],
            },
          ],
        },
      ],
    },
  });

  function reload() {
    void listLearningPaths()
      .then(setRows)
      .catch(() => setRows([]));
  }

  useEffect(() => {
    reload();
    void listCohorts()
      .then((result) => setCohorts(Array.isArray(result) ? result : []))
      .catch(() => setCohorts([]));
    void listResources({ status: "PUBLISHED" })
      .then((result) => setResources(result.data.map((row) => ({ id: row.id, title: row.title }))))
      .catch(() => setResources([]));
  }, [listCohorts]);

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Learning paths</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Day 1 is the cohort start date. Students see that day’s reading on their dashboard.
        </p>
      </div>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>New path</CardTitle>
          <CardDescription>This creates one module, one week, and the first day. Publish it for the cohort.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={form.handleSubmit(async (values) => {
              setError(null);
              setNotice(null);
              try {
                const created = await createLearningPath(values);
                setNotice(`Saved “${created.title}”. Publish it when the first day is ready.`);
                form.reset();
                reload();
              } catch (caught) {
                setError(caught instanceof ApiError ? caught.message : "Could not save the path.");
              }
            })}
          >
            <label className="space-y-1 text-sm">
              <span>Title</span>
              <Input {...form.register("title")} />
            </label>
            <label className="space-y-1 text-sm">
              <span>Description</span>
              <Input {...form.register("description")} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Cohort</span>
                <select className={selectClass} {...form.register("cohortId")}>
                  <option value="">Select a cohort</option>
                  {cohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Length in days</span>
                <Input type="number" {...form.register("durationDays", { valueAsNumber: true })} />
              </label>
            </div>
            <label className="space-y-1 text-sm">
              <span>Day 1 title</span>
              <Input {...form.register("modules.0.weeks.0.days.0.title")} />
            </label>
            <label className="space-y-1 text-sm">
              <span>Day 1 reading</span>
              <select className={selectClass} {...form.register("modules.0.weeks.0.days.0.items.0.refId")}>
                <option value="">Select a resource</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.title}
                  </option>
                ))}
              </select>
            </label>
            {formError(form.formState.errors) ? <p className="text-sm text-destructive">{formError(form.formState.errors)}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {notice ? <p className="text-sm">{notice}</p> : null}
            <Button type="submit">Save draft</Button>
          </form>
        </CardContent>
      </Card>
      <ul className="grid gap-3">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <div>
              <p className="font-medium">{row.title}</p>
              <p className="text-sm text-muted-foreground">{row.durationDays} days</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{row.status}</Badge>
              {row.status === "DRAFT" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void publishLearningPath(row.id, row.revision)
                      .then(() => {
                        setNotice(`Published “${row.title}”.`);
                        reload();
                      })
                      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not publish."));
                  }}
                >
                  Publish
                </Button>
              ) : null}
              {row.status !== "ARCHIVED" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void archiveLearningPath(row.id, row.revision)
                      .then(() => {
                        setNotice(`Archived “${row.title}”.`);
                        reload();
                      })
                      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not archive."));
                  }}
                >
                  Archive
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
