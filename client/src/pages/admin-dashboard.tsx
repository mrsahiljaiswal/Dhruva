import { zodResolver } from "@hookform/resolvers/zod";
import { BRANCHES, createCohortSchema, createUserSchema, type Role } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { ApiStatus } from "@/components/api-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminAnalyticsPanel } from "@/features/analytics/admin-analytics";
import { useAuth } from "@/features/auth/auth-context";

const AREAS = [
  ["Accounts", "Invite from this page"],
  ["Mentor allocation", "Assign from this page"],
  ["Learning paths", "Open paths"],
  ["Assignments", "Open assignments"],
  ["Resources", "Open the library"],
];

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Person = Awaited<ReturnType<ReturnType<typeof useAuth>["listPeople"]>>[number];

const STATUS_STYLE: Record<Person["status"], string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  INVITED: "border-amber-200 bg-amber-50 text-amber-800",
  DEACTIVATED: "border-transparent bg-muted text-muted-foreground",
};

function roleLabel(role: string) {
  if (role === "ADMIN") return "Admin";
  if (role === "MENTOR") return "Mentor";
  return "Student";
}

export function AdminDashboard() {
  const {
    user,
    invite,
    listCohorts,
    createCohort,
    listPeople,
    assignMentor,
    reassignMentor,
    updatePerson,
    deactivatePerson,
    reactivatePerson,
    reinvitePerson,
    previewImport,
    commitImport,
  } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [cohortNotice, setCohortNotice] = useState<string | null>(null);
  const [assignNotice, setAssignNotice] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<Awaited<ReturnType<typeof previewImport>> | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const form = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", role: "MENTOR" as Role, branch: undefined, cohortId: undefined },
  });
  const cohortForm = useForm({
    resolver: zodResolver(createCohortSchema),
    defaultValues: { name: "", academicYear: "", startDate: "", endDate: "" },
  });
  const role = form.watch("role");
  const mentors = people.filter((person) => person.role === "MENTOR" && person.status !== "DEACTIVATED");
  const students = people.filter((person) => person.role === "STUDENT" && person.status !== "DEACTIVATED");

  useEffect(() => {
    void listCohorts()
      .then((rows) => setCohorts(Array.isArray(rows) ? rows : []))
      .catch(() => setCohorts([]));
    void listPeople()
      .then((rows) => setPeople(Array.isArray(rows) ? rows : []))
      .catch(() => setPeople([]));
  }, [listCohorts, listPeople, refreshKey]);

  function refresh() {
    setRefreshKey((value) => value + 1);
  }

  async function share(action: () => Promise<string | null>, fallback: string) {
    setNotice(null);
    setInviteUrl(null);
    setError(null);
    try {
      const link = await action();
      setInviteUrl(link);
      setNotice(link ? "The email could not be sent. Share this link so they can create a password." : fallback);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That action failed.");
    }
  }

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Administration</p>
          <h1 className="text-2xl font-semibold tracking-tight">Admin dashboard</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Invite people, group students into a cohort, and choose who mentors them.
          </p>
        </div>
        <ApiStatus />
      </div>

      <AdminAnalyticsPanel />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Cohorts", cohorts.length],
          ["Mentors", mentors.length],
          ["Students", students.length],
        ].map(([label, count]) => (
          <Card key={String(label)} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-3xl">{count}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>Status, mentor permissions, and account actions.</CardDescription>
        </CardHeader>
        <CardContent>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet. Send an invite to add the first one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell>
                      <p className="font-medium">{person.name}</p>
                      <p className="text-xs text-muted-foreground">{person.email}</p>
                      {person.role === "MENTOR" ? (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs">
                          {(
                            [
                              ["canCreateResources", "Resources"],
                              ["canCreateAssessments", "Assessments"],
                              ["canGradeAssessments", "Grading"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={Boolean(person.capabilities?.[key])}
                                onChange={(event) => {
                                  const capabilities = {
                                    canCreateResources: Boolean(person.capabilities?.canCreateResources),
                                    canCreateAssessments: Boolean(person.capabilities?.canCreateAssessments),
                                    canGradeAssessments: Boolean(person.capabilities?.canGradeAssessments),
                                    [key]: event.target.checked,
                                  };
                                  void updatePerson(person.id, { capabilities }).then(refresh).catch((caught: unknown) => {
                                    setError(caught instanceof Error ? caught.message : "Could not save permissions.");
                                  });
                                }}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{roleLabel(person.role)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLE[person.status] ?? ""}>{person.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {person.status === "INVITED" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void share(() => reinvitePerson(person.id), `A new invite was sent to ${person.email}.`)}
                          >
                            Resend invite
                          </Button>
                        ) : null}
                        {person.status === "DEACTIVATED" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void share(() => reactivatePerson(person.id), `Invite email sent to ${person.email}.`)
                            }
                          >
                            Reactivate
                          </Button>
                        ) : null}
                        {person.status !== "DEACTIVATED" && person.id !== user?.id ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (!window.confirm(`Deactivate ${person.name}? They will be signed out.`)) {
                                return;
                              }
                              void deactivatePerson(person.id)
                                .then(refresh)
                                .catch((caught: unknown) => {
                                  setError(caught instanceof Error ? caught.message : "Could not deactivate that account.");
                                });
                            }}
                          >
                            Deactivate
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {error ? (
            <p className="mt-3 text-sm" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="mt-3 text-sm">{notice}</p> : null}
          {inviteUrl ? (
            <p className="mt-1 break-all text-sm">
              <a href={inviteUrl}>{inviteUrl}</a>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Invite a user</CardTitle>
            <CardDescription>They receive an email and choose their own password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={form.handleSubmit(async (values) => {
                setError(null);
                setNotice(null);
                setInviteUrl(null);
                try {
                  const link = await invite({
                    name: values.name,
                    email: values.email,
                    role: values.role,
                    branch: values.role === "STUDENT" ? values.branch : undefined,
                    cohortId: values.role === "STUDENT" ? values.cohortId : undefined,
                  });
                  setInviteUrl(link);
                  setNotice(
                    link
                      ? `The email could not be sent. Share this link so ${values.email} can create a password.`
                      : `Invite email sent to ${values.email}. They create their password from that email.`,
                  );
                  form.reset({ name: "", email: "", role: "MENTOR", branch: undefined, cohortId: undefined });
                  refresh();
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Invite failed.");
                }
              })}
            >
              <label className="space-y-1 text-sm">
                <span>Name</span>
                <Input {...form.register("name")} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Email</span>
                <Input type="email" {...form.register("email")} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Role</span>
                <select className={selectClass} {...form.register("role")}>
                  <option value="MENTOR">Mentor</option>
                  <option value="STUDENT">Student</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
              {role === "STUDENT" ? (
                <label className="space-y-1 text-sm">
                  <span>Branch</span>
                  <select className={selectClass} {...form.register("branch")}>
                    <option value="">Select a branch</option>
                    {BRANCHES.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {role === "STUDENT" ? (
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
              ) : null}
              <Button type="submit">Send invite</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Cohort</CardTitle>
            <CardDescription>A cohort is the class a student belongs to.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={cohortForm.handleSubmit(async (values) => {
                setCohortNotice(null);
                await createCohort(values);
                setCohorts(await listCohorts().catch(() => []));
                setCohortNotice(`Created ${values.name}`);
                cohortForm.reset();
                refresh();
              })}
            >
              <label className="space-y-1 text-sm">
                <span>Name</span>
                <Input {...cohortForm.register("name")} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Academic year</span>
                <Input {...cohortForm.register("academicYear")} placeholder="2026-27" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-sm">
                  <span>Start</span>
                  <Input type="date" {...cohortForm.register("startDate")} />
                </label>
                <label className="space-y-1 text-sm">
                  <span>End</span>
                  <Input type="date" {...cohortForm.register("endDate")} />
                </label>
              </div>
              <Button type="submit">Create cohort</Button>
              {cohortNotice ? <p className="text-sm">{cohortNotice}</p> : null}
              {cohorts.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {cohorts.map((cohort) => (
                    <li key={cohort.id}>
                      <Badge>{cohort.name}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Assign a mentor</CardTitle>
            <CardDescription>A student can have one active mentor.</CardDescription>
          </CardHeader>
          <CardContent>
            <MentorForm
              mentors={mentors}
              students={students}
              submitLabel="Assign"
              onSubmit={async (mentorId, studentIds) => {
                setAssignNotice(null);
                try {
                  await assignMentor(mentorId, studentIds);
                  setAssignNotice("Mentor assigned.");
                  refresh();
                } catch (caught) {
                  setAssignNotice(caught instanceof Error ? caught.message : "Could not assign the mentor.");
                }
              }}
            />
            {assignNotice ? <p className="mt-3 text-sm">{assignNotice}</p> : null}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Move to another mentor</CardTitle>
            <CardDescription>The previous assignment ends and the new one starts.</CardDescription>
          </CardHeader>
          <CardContent>
            <MentorForm
              mentors={mentors}
              students={students}
              submitLabel="Move"
              onSubmit={async (mentorId, studentIds) => {
                setMoveNotice(null);
                try {
                  await reassignMentor(mentorId, studentIds);
                  setMoveNotice("Students moved.");
                  refresh();
                } catch (caught) {
                  setMoveNotice(caught instanceof Error ? caught.message : "Could not move those students.");
                }
              }}
            />
            {moveNotice ? <p className="mt-3 text-sm">{moveNotice}</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Import from a spreadsheet</CardTitle>
          <CardDescription>Columns: Name, Email, Branch, Cohort, Role. Invalid rows are skipped.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(async (csv) => {
                setImportNotice(null);
                try {
                  setImportPreview(await previewImport(csv));
                } catch (caught) {
                  setImportNotice(caught instanceof Error ? caught.message : "Could not read that file.");
                }
              });
            }}
          />
          {importPreview ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importPreview.rows.map((row) => (
                    <TableRow key={row.line}>
                      <TableCell>{row.line}</TableCell>
                      <TableCell>{row.email || "—"}</TableCell>
                      <TableCell>{row.errors.length === 0 ? "Ready" : row.errors.join(" ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                type="button"
                onClick={() => {
                  void commitImport(importPreview.previewId)
                    .then((result) => {
                      setImportNotice(`Created ${result.created} account${result.created === 1 ? "" : "s"}.`);
                      setImportPreview(null);
                      refresh();
                    })
                    .catch((caught: unknown) => {
                      setImportNotice(caught instanceof Error ? caught.message : "Import failed.");
                    });
                }}
              >
                Create valid accounts
              </Button>
            </>
          ) : null}
          {importNotice ? <p className="text-sm">{importNotice}</p> : null}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AREAS.map(([area, state]) => (
                <TableRow key={area}>
                  <TableCell>{area}</TableCell>
                  <TableCell>
                    {area === "Resources" ? (
                      <Link className="underline" to="/admin/resources">
                        {state}
                      </Link>
                    ) : area === "Learning paths" ? (
                      <Link className="underline" to="/admin/learning-paths">
                        {state}
                      </Link>
                    ) : area === "Assignments" ? (
                      <Link className="underline" to="/admin/assignments">
                        {state}
                      </Link>
                    ) : (
                      state
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function MentorForm({
  mentors,
  students,
  submitLabel,
  onSubmit,
}: {
  mentors: { id: string; name: string }[];
  students: { id: string; name: string }[];
  submitLabel: string;
  onSubmit: (mentorId: string, studentIds: string[]) => Promise<void>;
}) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const mentorId = String(data.get("mentorId") ?? "");
        const studentIds = data.getAll("studentId").map(String);
        void onSubmit(mentorId, studentIds);
        event.currentTarget.reset();
      }}
    >
      <label className="space-y-1 text-sm">
        <span>Mentor</span>
        <select className={selectClass} name="mentorId" defaultValue="">
          <option value="">Select a mentor</option>
          {mentors.map((mentor) => (
            <option key={mentor.id} value={mentor.id}>
              {mentor.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1 text-sm">
        <legend>Students</legend>
        {students.length === 0 ? <p className="text-muted-foreground">No students yet.</p> : null}
        {students.map((student) => (
          <label key={student.id} className="flex items-center gap-2">
            <input type="checkbox" name="studentId" value={student.id} />
            {student.name}
          </label>
        ))}
      </fieldset>
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
