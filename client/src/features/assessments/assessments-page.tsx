import type { AssessmentSummary, Question, QuestionType, Role } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError, createAssessment, createQuestion, listAssessments, listQuestions, publishAssessment, startAttempt } from "./api";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function attemptPath(role: Role, id: string): string {
  if (role === "ADMIN") {
    return `/admin/attempts/${id}`;
  }
  if (role === "MENTOR") {
    return `/mentor/attempts/${id}`;
  }
  return `/student/attempts/${id}`;
}

function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function StudentAssessments() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AssessmentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    void listAssessments()
      .then(setRows)
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load assessments."));
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assessments</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          The server keeps the time. You can start only while an assessment is open and you still have an attempt.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No assessments yet.</p> : null}
      {rows.map((row) => {
        const now = Date.now();
        const open = now >= new Date(row.availableFrom).getTime() && now <= new Date(row.availableUntil).getTime();
        const remaining = Math.max(0, row.attemptsAllowed - row.attemptsUsed);
        const current = row.attempts.find((attempt) => attempt.status === "IN_PROGRESS");
        const latest = row.attempts[row.attempts.length - 1];
        return (
          <Card key={row.id} className="shadow-sm">
            <CardHeader>
              <CardTitle>{row.title}</CardTitle>
              <CardDescription>
                {row.durationMin} minutes · {row.totalMarks} marks · {remaining === 0 ? "No attempts remain" : `${remaining} attempt${remaining === 1 ? "" : "s"} remaining`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Badge>{open ? "Open" : now < new Date(row.availableFrom).getTime() ? "Not open yet" : "Closed"}</Badge>
              {current && user ? <Link to={attemptPath(user.role, current.id)} className="text-sm font-medium hover:underline">Continue</Link> : null}
              {!current && open && remaining > 0 ? (
                <Button
                  type="button"
                  onClick={() => {
                    setError(null);
                    void startAttempt(row.id)
                      .then((attempt) => navigate(attemptPath("STUDENT", attempt.id)))
                      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not start."));
                  }}
                >
                  Start {row.title}
                </Button>
              ) : null}
              {!current && latest && user ? (
                <Link to={attemptPath(user.role, latest.id)} className="text-sm hover:underline">
                  Review
                </Link>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function StaffAssessments() {
  const { user, listCohorts, listMentorStudents } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const canAuthor = isAdmin || Boolean(user?.capabilities.canCreateAssessments);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [rows, setRows] = useState<AssessmentSummary[]>([]);
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<QuestionType>("MCQ");
  const [optionA, setOptionA] = useState("");
  const [optionB, setOptionB] = useState("");
  const [correct, setCorrect] = useState("a");
  const [expected, setExpected] = useState("");
  const [language, setLanguage] = useState("python");
  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState("30");
  const [passingMarks, setPassingMarks] = useState("1");
  const [attemptsAllowed, setAttemptsAllowed] = useState("1");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [releaseAt, setReleaseAt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [cohortId, setCohortId] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reload() {
    void listAssessments().then(setRows).catch(() => setRows([]));
    if (canAuthor) {
      void listQuestions().then(setQuestions).catch(() => setQuestions([]));
    }
  }

  useEffect(() => {
    reload();
    if (isAdmin) {
      void listCohorts().then((result) => setCohorts(Array.isArray(result) ? result : [])).catch(() => setCohorts([]));
    } else if (user) {
      void listMentorStudents(user.id).then((result) => setStudents(Array.isArray(result) ? result : [])).catch(() => setStudents([]));
    }
  }, [canAuthor, isAdmin, listCohorts, listMentorStudents, user]);

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assessments</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Questions live in the bank. An administrator publishes an assessment to a target. Correct answers stay on the server until the release time.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {canAuthor ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Add question</CardTitle>
            <CardDescription>Editing a question does not change an attempt that already started.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const objective = type === "MCQ" || type === "MULTI_SELECT" || type === "TRUE_FALSE";
                const options = type === "TRUE_FALSE"
                  ? [{ id: "true", text: "True" }, { id: "false", text: "False" }]
                  : objective
                    ? [{ id: "a", text: optionA }, { id: "b", text: optionB }]
                    : [];
                const optionIds = type === "TRUE_FALSE" ? [correct] : type === "MULTI_SELECT"
                  ? [correct === "a" || correct === "both" ? "a" : "", correct === "b" || correct === "both" ? "b" : ""].filter(Boolean)
                  : objective ? [correct] : [];
                void createQuestion({
                  type,
                  prompt,
                  options,
                  answerKey: { optionIds, text: expected.trim() ? expected.trim() : null },
                  marks: 1,
                  topic: "General",
                  difficulty: "BEGINNER",
                  language: type === "CODING" ? language : null,
                  testCases: type === "CODING" && expected.trim()
                    ? [{ name: "sample", input: "", expectedOutput: expected.trim(), hidden: true }]
                    : [],
                })
                  .then((created) => {
                    setNotice(`Added “${created.prompt}”.`);
                    setPrompt("");
                    setError(null);
                    reload();
                  })
                  .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not add the question."));
              }}
            >
              <label className="space-y-1 text-sm">
                <span>Prompt</span>
                <Input value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span>Type</span>
                <select className={selectClass} value={type} onChange={(event) => setType(event.target.value as QuestionType)}>
                  <option value="MCQ">Multiple choice</option>
                  <option value="MULTI_SELECT">Multiple select</option>
                  <option value="TRUE_FALSE">True or false</option>
                  <option value="SHORT_ANSWER">Short answer</option>
                  <option value="CODING">Coding</option>
                </select>
              </label>
              {type === "MCQ" || type === "MULTI_SELECT" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm"><span>Option A</span><Input value={optionA} onChange={(event) => setOptionA(event.target.value)} /></label>
                  <label className="space-y-1 text-sm"><span>Option B</span><Input value={optionB} onChange={(event) => setOptionB(event.target.value)} /></label>
                </div>
              ) : null}
              {type === "MCQ" || type === "TRUE_FALSE" || type === "MULTI_SELECT" ? (
                <label className="space-y-1 text-sm">
                  <span>Correct option</span>
                  <select className={selectClass} value={correct} onChange={(event) => setCorrect(event.target.value)}>
                    {type === "TRUE_FALSE" ? <option value="true">True</option> : <option value="a">A</option>}
                    {type === "TRUE_FALSE" ? <option value="false">False</option> : <option value="b">B</option>}
                    {type === "MULTI_SELECT" ? <option value="both">Both</option> : null}
                  </select>
                </label>
              ) : null}
              {type === "SHORT_ANSWER" || type === "CODING" ? (
                <label className="space-y-1 text-sm">
                  <span>{type === "CODING" ? "Hidden expected output" : "Expected answer"}</span>
                  <Input value={expected} onChange={(event) => setExpected(event.target.value)} />
                </label>
              ) : null}
              {type === "CODING" ? (
                <label className="space-y-1 text-sm">
                  <span>Language</span>
                  <Input value={language} onChange={(event) => setLanguage(event.target.value)} />
                </label>
              ) : null}
              <Button type="submit">Add question</Button>
            </form>
            {questions.length > 0 ? (
              <ul className="mt-4 space-y-1 text-sm">
                {questions.map((question) => <li key={question.id}>{question.prompt}</li>)}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {canAuthor ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>New assessment</CardTitle>
            <CardDescription>Publishing is limited to an administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const targetIds = isAdmin ? [cohortId] : studentIds;
                void createAssessment({
                  title,
                  description: "",
                  questionIds: selected,
                  durationMin: Number(durationMin),
                  passingMarks: Number(passingMarks),
                  attemptsAllowed: Number(attemptsAllowed),
                  availableFrom: toIso(opens),
                  availableUntil: toIso(closes),
                  answersReleaseAt: releaseAt ? toIso(releaseAt) : null,
                  targetType: isAdmin ? "COHORT" : "INDIVIDUAL",
                  targetIds,
                  branches: [],
                })
                  .then((created) => {
                    setNotice(`Saved “${created.title}” as a draft.`);
                    setTitle("");
                    setSelected([]);
                    setError(null);
                    reload();
                  })
                  .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not save the assessment."));
              }}
            >
              <label className="space-y-1 text-sm"><span>Title</span><Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm"><span>Minutes</span><Input value={durationMin} onChange={(event) => setDurationMin(event.target.value)} /></label>
                <label className="space-y-1 text-sm"><span>Passing marks</span><Input value={passingMarks} onChange={(event) => setPassingMarks(event.target.value)} /></label>
                <label className="space-y-1 text-sm"><span>Attempts</span><Input value={attemptsAllowed} onChange={(event) => setAttemptsAllowed(event.target.value)} /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm"><span>Opens</span><Input type="datetime-local" value={opens} onChange={(event) => setOpens(event.target.value)} /></label>
                <label className="space-y-1 text-sm"><span>Closes</span><Input type="datetime-local" value={closes} onChange={(event) => setCloses(event.target.value)} /></label>
              </div>
              {isAdmin ? (
                <label className="space-y-1 text-sm">
                  <span>Cohort</span>
                  <select className={selectClass} value={cohortId} onChange={(event) => setCohortId(event.target.value)}>
                    <option value="">Choose a cohort</option>
                    {cohorts.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
                  </select>
                </label>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="text-sm">Students</legend>
                  {students.map((student) => (
                    <label key={student.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={studentIds.includes(student.id)}
                        onChange={(event) => {
                          setStudentIds((current) => event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id));
                        }}
                      />
                      <span>{student.name}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <fieldset className="space-y-2">
                <legend className="text-sm">Questions</legend>
                {questions.map((question) => (
                  <label key={question.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(question.id)}
                      onChange={(event) => {
                        setSelected((current) => event.target.checked ? [...current, question.id] : current.filter((id) => id !== question.id));
                      }}
                    />
                    <span>{question.prompt}</span>
                  </label>
                ))}
              </fieldset>
              <Button type="submit">Save assessment</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.id} className="shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {row.title}
                <Badge>{row.status === "PUBLISHED" ? "Published" : "Draft"}</Badge>
              </CardTitle>
              <CardDescription>{row.attempts.length} attempt{row.attempts.length === 1 ? "" : "s"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {isAdmin && row.status === "DRAFT" ? (
                <Button
                  type="button"
                  onClick={() => {
                    void publishAssessment(row.id, row.version)
                      .then(() => {
                        setNotice(`Published “${row.title}”.`);
                        reload();
                      })
                      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not publish."));
                  }}
                >
                  Publish {row.title}
                </Button>
              ) : null}
              <ul className="space-y-1 text-sm">
                {row.attempts.map((attempt) => (
                  <li key={attempt.id}>
                    <Link to={attemptPath(user?.role ?? "MENTOR", attempt.id)} className="hover:underline">
                      {attempt.studentName} · {attempt.status === "IN_PROGRESS" ? "In progress" : attempt.status === "SUBMITTED" ? "Submitted" : attempt.status === "EXPIRED" ? "Expired" : "Graded"}
                      {attempt.totalScore !== null ? ` · ${attempt.totalScore}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function AssessmentsPage() {
  const { user } = useAuth();
  if (user?.role === "STUDENT") {
    return <StudentAssessments />;
  }
  return <StaffAssessments />;
}
