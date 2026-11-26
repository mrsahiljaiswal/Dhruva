import type { AttemptDetail, AttemptQuestion, Role } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError, getAttempt, gradeAttempt, saveAnswers, submitAttempt } from "./api";

function listPath(role: Role | undefined): string {
  if (role === "ADMIN") {
    return "/admin/assessments";
  }
  if (role === "MENTOR") {
    return "/mentor/assessments";
  }
  return "/student/assessments";
}

function useCountdown(expiresAt: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, expiresAt]);
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function valueFor(attempt: AttemptDetail, questionId: string): string | string[] {
  const saved = attempt.answers.find((answer) => answer.questionId === questionId);
  if (!saved) {
    return attempt.questions.find((question) => question.questionId === questionId)?.type === "MULTI_SELECT" ? [] : "";
  }
  return saved.value;
}

function QuestionFields({
  question,
  value,
  disabled,
  onChange,
}: {
  question: AttemptQuestion;
  value: string | string[];
  disabled: boolean;
  onChange: (value: string | string[]) => void;
}) {
  if (question.type === "SHORT_ANSWER" || question.type === "CODING") {
    return (
      <textarea
        className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        aria-label={question.prompt}
        disabled={disabled}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onChange(event.target.value)}
      />
    );
  }
  if (question.type === "MULTI_SELECT") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {question.options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id);
                onChange(next);
              }}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {question.options.map((option) => (
        <label key={option.id} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={question.questionId}
            value={option.id}
            checked={value === option.id}
            disabled={disabled}
            onChange={() => onChange(option.id)}
          />
          <span>{option.text}</span>
        </label>
      ))}
    </div>
  );
}

export function AttemptPage() {
  const { attemptId = "" } = useParams();
  const { user } = useAuth();
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, string | string[]>>({});
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const open = attempt?.status === "IN_PROGRESS";
  const countdown = useCountdown(attempt?.expiresAt ?? new Date().toISOString(), open === true);
  const canGrade = user?.role === "ADMIN" || Boolean(user?.role === "MENTOR" && user.capabilities.canGradeAssessments);
  const marking = Boolean(attempt && attempt.pendingManual && canGrade && user?.id !== attempt.studentId);

  useEffect(() => {
    let cancelled = false;
    void getAttempt(attemptId)
      .then((loaded) => {
        if (!cancelled) {
          setAttempt(loaded);
          const next: Record<string, string | string[]> = {};
          for (const question of loaded.questions) {
            next[question.questionId] = valueFor(loaded, question.questionId);
          }
          setDraft(next);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : "Could not open this attempt.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  async function persist(question: AttemptQuestion, value: string | string[]) {
    setDraft((current) => ({ ...current, [question.questionId]: value }));
    if (!open) {
      return;
    }
    try {
      const saved = await saveAnswers(attemptId, [{ questionId: question.questionId, value }]);
      setAttempt(saved);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the answer.");
      if (caught instanceof ApiError && caught.status === 422) {
        const refreshed = await getAttempt(attemptId).catch(() => null);
        if (refreshed) {
          setAttempt(refreshed);
        }
      }
    }
  }

  const total = attempt?.questions.reduce((sum, question) => sum + question.marks, 0) ?? 0;

  return (
    <section className="space-y-6">
      <div>
        <Link to={listPath(user?.role)} className="text-sm text-muted-foreground hover:underline">
          Assessments
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{attempt?.assessmentTitle ?? "Attempt"}</h1>
        {attempt ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {open ? `Time left ${countdown}. The server ends this attempt at ${new Date(attempt.expiresAt).toLocaleString()}.` : null}
            {attempt.status !== "IN_PROGRESS" && attempt.totalScore !== null ? ` Score ${attempt.totalScore} of ${total}.` : null}
            {attempt.pendingManual ? " A reviewer still has to mark the written answers." : null}
          </p>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {attempt?.questions.map((question) => (
        <Card key={question.questionId} className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{question.prompt}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <QuestionFields
              question={question}
              value={draft[question.questionId] ?? ""}
              disabled={!open}
              onChange={(value) => {
                void persist(question, value);
              }}
            />
            {question.answerKey && attempt.answersReleased ? (
              <p className="text-sm text-muted-foreground">
                Correct: {question.answerKey.text ?? question.options.filter((option) => question.answerKey?.optionIds.includes(option.id)).map((option) => option.text).join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
      {open ? (
        <Button
          type="button"
          onClick={() => {
            setError(null);
            void submitAttempt(attemptId)
              .then((submitted) => {
                setAttempt(submitted);
                setNotice(submitted.pendingManual ? "Submitted. Written answers are waiting for a reviewer." : "Submitted.");
              })
              .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not submit."));
          }}
        >
          Submit
        </Button>
      ) : null}
      {marking && attempt
        ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const manual = attempt.questions.filter((question) => question.type === "SHORT_ANSWER" || question.type === "CODING");
              void gradeAttempt(
                attempt.id,
                manual.map((question) => ({ questionId: question.questionId, awarded: Number(marks[question.questionId] ?? 0) })),
              )
                .then((graded) => {
                  setAttempt(graded);
                  setNotice("Marks saved.");
                  setError(null);
                })
                .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not save the marks."));
            }}
          >
            {attempt.questions
              .filter((question) => question.type === "SHORT_ANSWER" || question.type === "CODING")
              .map((question) => (
                <label key={question.questionId} className="block space-y-1 text-sm">
                  <span>Marks for “{question.prompt}” (out of {question.marks})</span>
                  <Input
                    type="number"
                    min={0}
                    max={question.marks}
                    value={marks[question.questionId] ?? ""}
                    onChange={(event) => setMarks((current) => ({ ...current, [question.questionId]: event.target.value }))}
                  />
                </label>
              ))}
            <Button type="submit">Save marks</Button>
          </form>
        )
        : null}
    </section>
  );
}
