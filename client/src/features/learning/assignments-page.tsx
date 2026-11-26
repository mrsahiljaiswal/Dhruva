import { zodResolver } from "@hookform/resolvers/zod";
import {
  BRANCHES,
  PRIORITIES,
  SUBMISSION_TYPES,
  createAssignmentSchema,
  type AssignmentTarget,
  type Branch,
} from "@dhruva/shared";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { listResources } from "@/features/resources/api";
import { ApiError, archiveAssignment, createAssignment, listAssignmentDefinitions, publishAssignment } from "./api";

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

type Definition = Awaited<ReturnType<typeof listAssignmentDefinitions>>[number];

export function AssignmentsPage() {
  const { user, listCohorts, listPeople, listMentorStudents } = useAuth();
  const [rows, setRows] = useState<Definition[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; role: string }[]>([]);
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [resources, setResources] = useState<{ id: string; title: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === "ADMIN";
  const form = useForm({
    resolver: zodResolver(createAssignmentSchema),
    defaultValues: {
      title: "",
      description: "",
      resourceId: null as string | null,
      targetType: (isAdmin ? "COHORT" : "INDIVIDUAL") as AssignmentTarget,
      targetIds: [] as string[],
      branches: [] as Branch[],
      dueDate: "",
      priority: "NORMAL" as const,
      submissionType: "TEXT" as const,
      language: null as string | null,
      testCases: [] as { name: string; input: string; expectedOutput: string; hidden: boolean }[],
      rubric: [] as { criterion: string; maxPoints: number }[],
    },
  });
  const tests = useFieldArray({ control: form.control, name: "testCases" });
  const targetType = form.watch("targetType");

  function reload() {
    void listAssignmentDefinitions()
      .then(setRows)
      .catch(() => setRows([]));
  }

  useEffect(() => {
    reload();
    void listCohorts()
      .then((result) => setCohorts(Array.isArray(result) ? result : []))
      .catch(() => setCohorts([]));
    if (isAdmin) {
      void listPeople()
        .then((result) => setPeople(Array.isArray(result) ? result : []))
        .catch(() => setPeople([]));
    } else if (user) {
      void listMentorStudents(user.id)
        .then((result) => setMine(Array.isArray(result) ? result : []))
        .catch(() => setMine([]));
    }
    void listResources({ status: "PUBLISHED" })
      .then((result) => setResources(result.data.map((row) => ({ id: row.id, title: row.title }))))
      .catch(() => setResources([]));
  }, [isAdmin, listCohorts, listMentorStudents, listPeople, user]);

  const students = isAdmin ? people.filter((person) => person.role === "STUDENT") : mine;
  const mentors = people.filter((person) => person.role === "MENTOR");

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          A draft stays private. Publishing gives one copy to each student the target covers.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>New assignment</CardTitle>
          <CardDescription>Due dates are stored in UTC. Overdue is calculated when someone reads the work.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={form.handleSubmit(async (values) => {
              setError(null);
              setNotice(null);
              try {
                const created = await createAssignment({
                  ...values,
                  resourceId: values.resourceId || null,
                  language: values.language || null,
                });
                setNotice(`Saved “${created.title}” as a draft.`);
                form.reset();
                reload();
              } catch (caught) {
                setError(caught instanceof ApiError ? caught.message : "Could not save the assignment.");
              }
            })}
          >
            <label className="space-y-1 text-sm">
              <span>Title</span>
              <Input {...form.register("title")} />
            </label>
            <label className="space-y-1 text-sm">
              <span>What to do</span>
              <Input {...form.register("description")} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Due date</span>
                <Input
                  type="date"
                  onChange={(event) =>
                    form.setValue("dueDate", event.target.value ? `${event.target.value}T23:59:00.000Z` : "", {
                      shouldValidate: true,
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Priority</span>
                <select className={selectClass} {...form.register("priority")}>
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="space-y-1 text-sm">
              <span>How it will be submitted</span>
              <select className={selectClass} {...form.register("submissionType")}>
                {SUBMISSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Reading</span>
              <select
                className={selectClass}
                value={form.watch("resourceId") ?? ""}
                onChange={(event) => form.setValue("resourceId", event.target.value || null)}
              >
                <option value="">None</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>Who receives it</span>
              <select
                className={selectClass}
                value={targetType}
                onChange={(event) => {
                  const next = event.target.value as AssignmentTarget;
                  form.setValue("targetType", next);
                  form.setValue("branches", []);
                  form.setValue("targetIds", !isAdmin && next === "MENTOR_GROUP" && user ? [user.id] : []);
                }}
              >
                {isAdmin ? <option value="COHORT">A cohort</option> : null}
                {isAdmin ? <option value="BRANCH">Branches in a cohort</option> : null}
                {isAdmin ? <option value="MENTOR_GROUP">A mentor's students</option> : null}
                <option value="INDIVIDUAL">Chosen students</option>
                {isAdmin ? null : <option value="MENTOR_GROUP">All of my students</option>}
              </select>
            </label>
            {targetType === "COHORT" || targetType === "BRANCH" ? (
              <label className="space-y-1 text-sm">
                <span>Cohort</span>
                <select
                  className={selectClass}
                  value={form.watch("targetIds")[0] ?? ""}
                  onChange={(event) => form.setValue("targetIds", event.target.value ? [event.target.value] : [])}
                >
                  <option value="">Select a cohort</option>
                  {cohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {targetType === "BRANCH" ? (
              <fieldset className="space-y-1 text-sm">
                <legend>Branches</legend>
                <div className="flex flex-wrap gap-3">
                  {BRANCHES.map((branch) => (
                    <label key={branch} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={form.watch("branches").includes(branch)}
                        onChange={(event) => {
                          const current = form.getValues("branches");
                          form.setValue(
                            "branches",
                            event.target.checked ? [...current, branch] : current.filter((item) => item !== branch),
                          );
                        }}
                      />
                      {branch}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {targetType === "MENTOR_GROUP" && isAdmin ? (
              <label className="space-y-1 text-sm">
                <span>Mentor</span>
                <select
                  className={selectClass}
                  value={form.watch("targetIds")[0] ?? ""}
                  onChange={(event) => form.setValue("targetIds", event.target.value ? [event.target.value] : [])}
                >
                  <option value="">Select a mentor</option>
                  {mentors.map((mentor) => (
                    <option key={mentor.id} value={mentor.id}>
                      {mentor.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {targetType === "MENTOR_GROUP" && !isAdmin ? (
              <p className="text-sm text-muted-foreground">This goes to every student currently assigned to you.</p>
            ) : null}
            {targetType === "INDIVIDUAL" ? (
              <fieldset className="space-y-1 text-sm">
                <legend>Students</legend>
                {students.length === 0 ? <p className="text-muted-foreground">No students to choose.</p> : null}
                {students.map((student) => (
                  <label key={student.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.watch("targetIds").includes(student.id)}
                      onChange={(event) => {
                        const current = form.getValues("targetIds");
                        form.setValue(
                          "targetIds",
                          event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id),
                        );
                      }}
                    />
                    {student.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <label className="space-y-1 text-sm">
              <span>Language</span>
              <Input
                placeholder="Optional, for a coding task"
                value={form.watch("language") ?? ""}
                onChange={(event) => form.setValue("language", event.target.value.trim() === "" ? null : event.target.value)}
              />
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm">Test cases</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => tests.append({ name: "", input: "", expectedOutput: "", hidden: false })}
                >
                  Add test case
                </Button>
              </div>
              {tests.fields.map((field, index) => (
                <div key={field.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  <Input placeholder="Name" {...form.register(`testCases.${index}.name`)} />
                  <Input placeholder="Input" {...form.register(`testCases.${index}.input`)} />
                  <Input placeholder="Expected output" {...form.register(`testCases.${index}.expectedOutput`)} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" {...form.register(`testCases.${index}.hidden`)} />
                    Hidden
                  </label>
                </div>
              ))}
            </div>
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
              <p className="text-sm text-muted-foreground">
                {row.targetType} · {row.recipientCount} recipient{row.recipientCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge>{row.status}</Badge>
              {row.status === "DRAFT" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void publishAssignment(row.id, row.revision)
                      .then(() => {
                        setNotice(`Published “${row.title}”.`);
                        reload();
                      })
                      .catch((caught: unknown) => {
                        setError(caught instanceof ApiError ? caught.message : "Could not publish.");
                      });
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
                    void archiveAssignment(row.id, row.revision)
                      .then(() => {
                        setNotice(`Archived “${row.title}”.`);
                        reload();
                      })
                      .catch((caught: unknown) => {
                        setError(caught instanceof ApiError ? caught.message : "Could not archive.");
                      });
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
