import { RESOURCE_MIME_TYPES, SUBMISSION_MAX_BYTES, type RecipientView, type SubmissionRevision } from "@dhruva/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  getMyAssignments,
  getStudentAssignments,
  listSubmissions,
  openSubmissionReview,
  reviewSubmission,
  startAssignment,
  submitRevision,
  uploadSubmissionFile,
} from "./api";

const STATE_LABELS: Record<RecipientView["state"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  REVISION_REQUESTED: "Revision requested",
  COMPLETED: "Completed",
};

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function SubmissionPage({ audience }: { audience: "student" | "mentor" | "admin" }) {
  const params = useParams();
  const recipientId = params.recipientId ?? "";
  const studentId = params.studentId;
  const [recipient, setRecipient] = useState<RecipientView | null>(null);
  const [revisions, setRevisions] = useState<SubmissionRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState("");
  const [rubric, setRubric] = useState<Record<string, string>>({});
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setRecipient(null);
    setRevisions(null);
    setError(null);
    setMissing(false);
    const loadRows = audience === "student" || !studentId ? getMyAssignments() : getStudentAssignments(studentId);
    void Promise.all([loadRows, listSubmissions(recipientId)])
      .then(([rows, history]) => {
        if (controller.signal.aborted) {
          return;
        }
        const found = rows.find((row) => row.id === recipientId) ?? null;
        setRecipient(found);
        setMissing(!found);
        setRevisions(history);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "This assignment could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [audience, recipientId, studentId]);

  async function refreshHistory(next: RecipientView) {
    setRecipient(next);
    setRevisions(await listSubmissions(next.id));
  }

  async function onStart() {
    setBusy(true);
    setError(null);
    try {
      setRecipient(await startAssignment(recipientId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The assignment could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!recipient || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    try {
      const type = recipient.assignment.submissionType;
      let body: Parameters<typeof submitRevision>[2];
      if (type === "TEXT") {
        body = { textAnswer: text };
      } else if (type === "FILE") {
        if (!file) {
          setError("Choose a file.");
          return;
        }
        if (!RESOURCE_MIME_TYPES.includes(file.type as (typeof RESOURCE_MIME_TYPES)[number]) || file.size > SUBMISSION_MAX_BYTES) {
          setError("Use a PDF, PNG, JPEG, WEBP, or plain-text file up to 10 MB.");
          return;
        }
        body = { fileKey: await uploadSubmissionFile(recipient.id, file) };
      } else if (type === "REPOSITORY") {
        body = { repositoryUrl: link };
      } else if (type === "EDITOR_LINK") {
        body = { editorUrl: link };
      } else {
        setError("This assignment does not accept a submission.");
        return;
      }
      const result = await submitRevision(recipient.id, key, body);
      idempotencyKey.current = null;
      setText("");
      setLink("");
      setFile(null);
      await refreshHistory(result.recipient);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The submission could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function onOpen(revisionId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await openSubmissionReview(revisionId);
      await refreshHistory(result.recipient);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The submission could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function onReview(decision: "APPROVE" | "REQUEST_CHANGES") {
    const latest = revisions?.at(-1);
    if (!latest || !recipient) {
      return;
    }
    if (!feedback.trim()) {
      setError("Write feedback.");
      return;
    }
    if (decision === "APPROVE" && score.trim() === "") {
      setError("An approval needs a score.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await reviewSubmission(latest.id, {
        decision,
        feedback,
        score: decision === "APPROVE" ? Number(score) : null,
        rubricScores: recipient.assignment.rubric.flatMap((item) => {
          const raw = rubric[item.criterion];
          if (!raw) {
            return [];
          }
          return [{ criterion: item.criterion, points: Number(raw) }];
        }),
      });
      setFeedback("");
      setScore("");
      await refreshHistory(result.recipient);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The review could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !recipient) {
    return <ErrorState title="Assignment unavailable" description={error} />;
  }
  if (missing) {
    return <ErrorState title="Assignment unavailable" description="That assignment was not found." />;
  }
  if (!recipient || !revisions) {
    return <Spinner />;
  }

  const latest = revisions.at(-1) ?? null;
  const canSubmit =
    audience === "student" &&
    recipient.assignment.status !== "ARCHIVED" &&
    (recipient.state === "IN_PROGRESS" || recipient.state === "REVISION_REQUESTED") &&
    recipient.assignment.submissionType !== "NONE";
  const canStart = audience === "student" && recipient.state === "NOT_STARTED" && recipient.assignment.status !== "ARCHIVED";
  const canOpen = audience !== "student" && recipient.state === "SUBMITTED" && latest?.status === "PENDING";
  const canReview = audience !== "student" && recipient.state === "UNDER_REVIEW" && latest?.status === "PENDING";
  const back = audience === "student" ? "/student/assignments" : `/${audience}/students/${studentId}/assignments`;

  return (
    <section className="space-y-6">
      <div>
        <Link className="text-sm underline" to={back}>
          Back to assignments
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{recipient.assignment.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{recipient.assignment.description}</p>
          </div>
          <div className="flex gap-2">
            <Badge>{STATE_LABELS[recipient.state]}</Badge>
            {recipient.overdue ? <Badge className="border-amber-200 bg-amber-50 text-amber-800">Overdue</Badge> : null}
            {recipient.score !== null ? <Badge>Score {recipient.score}</Badge> : null}
          </div>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {recipient.state === "REVISION_REQUESTED" && latest?.feedback ? (
        <p className="rounded-md border bg-card px-4 py-3 text-sm">Changes requested: {latest.feedback}</p>
      ) : null}

      {recipient.assignment.status === "ARCHIVED" ? <p className="text-sm">This assignment is archived.</p> : null}

      {canStart ? (
        <Button type="button" onClick={() => void onStart()} disabled={busy}>
          Start assignment
        </Button>
      ) : null}

      {canSubmit ? (
        <form
          className="space-y-3 rounded-lg border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <h2 className="text-sm font-medium">{recipient.state === "REVISION_REQUESTED" ? "Submit a new revision" : "Your submission"}</h2>
          {recipient.assignment.submissionType === "TEXT" ? (
            <label className="block space-y-1 text-sm">
              <span>Answer</span>
              <textarea
                className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
              />
            </label>
          ) : null}
          {recipient.assignment.submissionType === "FILE" ? (
            <label className="block space-y-1 text-sm">
              <span>File</span>
              <Input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,text/plain"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </label>
          ) : null}
          {recipient.assignment.submissionType === "REPOSITORY" ? (
            <label className="block space-y-1 text-sm">
              <span>Repository URL</span>
              <Input
                type="url"
                value={link}
                placeholder="https://github.com/owner/repository"
                onChange={(event) => setLink(event.target.value)}
                required
              />
            </label>
          ) : null}
          {recipient.assignment.submissionType === "EDITOR_LINK" ? (
            <label className="block space-y-1 text-sm">
              <span>Editor link</span>
              <Input type="url" value={link} onChange={(event) => setLink(event.target.value)} required />
            </label>
          ) : null}
          <Button type="submit" disabled={busy}>
            Submit
          </Button>
        </form>
      ) : null}

      {canOpen && latest ? (
        <Button type="button" onClick={() => void onOpen(latest.id)} disabled={busy}>
          Open for review
        </Button>
      ) : null}

      {canReview ? (
        <form
          className="space-y-3 rounded-lg border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <h2 className="text-sm font-medium">Review</h2>
          <label className="block space-y-1 text-sm">
            <span>Feedback</span>
            <textarea
              className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              required
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Score</span>
            <Input type="number" min={0} value={score} onChange={(event) => setScore(event.target.value)} />
          </label>
          {recipient.assignment.rubric.map((item) => (
            <label key={item.criterion} className="block space-y-1 text-sm">
              <span>
                {item.criterion} (max {item.maxPoints})
              </span>
              <Input
                type="number"
                min={0}
                max={item.maxPoints}
                value={rubric[item.criterion] ?? ""}
                onChange={(event) => setRubric((current) => ({ ...current, [item.criterion]: event.target.value }))}
              />
            </label>
          ))}
          <div className="flex gap-2">
            <Button type="button" onClick={() => void onReview("APPROVE")} disabled={busy}>
              Approve
            </Button>
            <Button type="button" variant="outline" onClick={() => void onReview("REQUEST_CHANGES")} disabled={busy}>
              Request changes
            </Button>
          </div>
        </form>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Revisions</h2>
        {revisions.length === 0 ? <p className="text-sm text-muted-foreground">No revisions yet.</p> : null}
        <ol className="grid gap-3">
          {revisions.map((revision) => (
            <li key={revision.id} className="rounded-lg border bg-card px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Revision {revision.revisionNo}</p>
                <Badge>{revision.status.replaceAll("_", " ")}</Badge>
              </div>
              <p className="mt-1 text-muted-foreground">{formatWhen(revision.submittedAt)}</p>
              {revision.resourceVersion !== null ? (
                <p className="mt-1 text-muted-foreground">Written against resource version {revision.resourceVersion}</p>
              ) : null}
              {revision.textAnswer ? <p className="mt-2 whitespace-pre-wrap">{revision.textAnswer}</p> : null}
              {revision.fileName ? <p className="mt-2">{revision.fileName}</p> : null}
              {revision.repositoryUrl ? (
                <a className="mt-2 inline-block underline" href={revision.repositoryUrl} rel="noreferrer">
                  {revision.repositoryUrl}
                </a>
              ) : null}
              {revision.editorUrl ? (
                <a className="mt-2 inline-block underline" href={revision.editorUrl} rel="noreferrer">
                  {revision.editorUrl}
                </a>
              ) : null}
              {revision.feedback ? <p className="mt-2">Feedback: {revision.feedback}</p> : null}
              {revision.score !== null ? <p className="mt-1">Score {revision.score}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
