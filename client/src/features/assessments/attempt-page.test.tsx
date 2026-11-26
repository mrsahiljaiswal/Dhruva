import type { PublicUser } from "@dhruva/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/features/auth/auth-context";
import { AppRoutes } from "@/routes";

const student: PublicUser = {
  id: "student-1",
  name: "Ada Lovelace",
  email: "student@example.com",
  role: "STUDENT",
  branch: "CSE",
  cohortId: "cohort-1",
  status: "ACTIVE",
  capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
};

const mentor: PublicUser = {
  ...student,
  id: "mentor-1",
  name: "Grace Hopper",
  email: "mentor@example.com",
  role: "MENTOR",
  branch: null,
  cohortId: null,
  capabilities: { canCreateResources: false, canCreateAssessments: true, canGradeAssessments: true },
};

function summary() {
  return {
    id: "assessment-1",
    title: "Weekly quiz",
    description: "Answer every part.",
    questionIds: ["q-1"],
    durationMin: 30,
    totalMarks: 2,
    passingMarks: 1,
    attemptsAllowed: 1,
    attemptsUsed: 0,
    availableFrom: "2020-01-01T00:00:00.000Z",
    availableUntil: "2099-01-01T00:00:00.000Z",
    answersReleaseAt: "2099-01-02T00:00:00.000Z",
    targetType: "COHORT",
    targetIds: ["cohort-1"],
    branches: [],
    status: "PUBLISHED",
    version: 1,
    createdBy: "admin-1",
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    attempts: [],
  };
}

function attempt(status = "IN_PROGRESS") {
  return {
    id: "attempt-1",
    assessmentId: "assessment-1",
    assessmentTitle: "Weekly quiz",
    studentId: "student-1",
    attemptNo: 1,
    assessmentVersion: 1,
    questions: [
      {
        questionId: "q-1",
        type: "MCQ",
        prompt: "What is 2 + 2?",
        options: [
          { id: "a", text: "3" },
          { id: "b", text: "4" },
        ],
        marks: 2,
        topic: "Arithmetic",
        difficulty: "BEGINNER",
        language: null,
        testCases: [],
        answerKey: { optionIds: ["b"], text: "photosynthesis" },
      },
    ],
    answers: [],
    startedAt: "2026-08-01T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    submittedAt: status === "IN_PROGRESS" ? null : "2026-08-01T12:10:00.000Z",
    status,
    autoScore: status === "IN_PROGRESS" ? null : 2,
    manualScore: status === "GRADED" ? 0 : null,
    totalScore: status === "IN_PROGRESS" ? null : 2,
    gradedBy: null,
    answersReleased: false,
    passingMarks: 1,
    pendingManual: false,
  };
}

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("assessment attempt", () => {
  beforeEach(() => {
    let started = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/auth/csrf")) {
          return json({ data: { csrfToken: "csrf-token" } });
        }
        if (url.includes("/auth/me")) {
          return json({ data: student });
        }
        if (url.includes("/assessments") && method === "GET") {
          return json({ data: [summary()] });
        }
        if (url.includes("/attempts") && method === "POST" && url.includes("/assessments")) {
          started = true;
          return json({ data: attempt() }, 201);
        }
        if (url.includes("/answers") && method === "PATCH") {
          return json({ data: { ...attempt(), answers: [{ questionId: "q-1", value: "b", autoSavedAt: "2026-08-01T12:05:00.000Z" }] } });
        }
        if (url.includes("/submit") && method === "POST") {
          return json({ data: attempt("GRADED") });
        }
        if (url.includes("/attempts/") && method === "GET") {
          return json({ data: started ? attempt() : attempt() });
        }
        return json({ data: [] });
      }),
    );
  });

  it("starts an attempt, saves an answer, and submits without showing the answer key", async () => {
    const user = userEvent.setup();
    renderAt("/student/assessments");
    expect(await screen.findByRole("heading", { name: "Assessments" })).toBeInTheDocument();
    expect(await screen.findByText(/1 attempt remaining/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start Weekly quiz" }));
    expect(await screen.findByRole("heading", { name: "What is 2 + 2?" })).toBeInTheDocument();
    expect(screen.queryByText("photosynthesis")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "4" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/Score 2 of 2/)).toBeInTheDocument();
    expect(screen.queryByText("photosynthesis")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save marks" })).not.toBeInTheDocument();
  });
});

describe("manual grading", () => {
  beforeEach(() => {
    const sitting = {
      ...attempt("SUBMITTED"),
      pendingManual: true,
      autoScore: 0,
      totalScore: 0,
      questions: [
        {
          questionId: "q-short",
          type: "SHORT_ANSWER",
          prompt: "Name the process.",
          options: [],
          marks: 3,
          topic: "Biology",
          difficulty: "BEGINNER",
          language: null,
          testCases: [],
        },
      ],
      answers: [{ questionId: "q-short", value: "sunlight", autoSavedAt: "2026-08-01T12:05:00.000Z" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/auth/csrf")) {
          return json({ data: { csrfToken: "csrf-token" } });
        }
        if (url.includes("/auth/me")) {
          return json({ data: mentor });
        }
        if (url.includes("/grade") && method === "POST") {
          return json({ data: { ...sitting, status: "GRADED", pendingManual: false, manualScore: 3, totalScore: 3, gradedBy: "mentor-1" } });
        }
        if (url.includes("/attempts/")) {
          return json({ data: sitting });
        }
        return json({ data: [] });
      }),
    );
  });

  it("lets a mentor record marks for a written answer", async () => {
    const user = userEvent.setup();
    renderAt("/mentor/attempts/attempt-1");
    expect(await screen.findByRole("heading", { name: "Name the process." })).toBeInTheDocument();
    expect(screen.queryByText("photosynthesis")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Marks for/), "3");
    await user.click(screen.getByRole("button", { name: "Save marks" }));
    expect(await screen.findByText("Marks saved.")).toBeInTheDocument();
    expect(screen.getByText(/Score 3 of 3/)).toBeInTheDocument();
  });
});
