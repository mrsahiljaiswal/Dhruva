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

const mentor: PublicUser = { ...student, id: "mentor-1", name: "Grace Hopper", email: "mentor@example.com", role: "MENTOR", branch: null, cohortId: null };

function recipient(state: string) {
  return {
    id: "recipient-1",
    assignmentId: "assignment-1",
    studentId: "student-1",
    state,
    startedAt: state === "NOT_STARTED" ? null : "2026-08-01T12:00:00.000Z",
    submittedAt: state === "NOT_STARTED" || state === "IN_PROGRESS" ? null : "2026-08-01T12:05:00.000Z",
    completedAt: state === "COMPLETED" ? "2026-08-01T13:00:00.000Z" : null,
    score: state === "COMPLETED" ? 8 : null,
    overdue: false,
    assignment: {
      title: "Explain arrays",
      description: "Show your work.",
      resourceId: null,
      dueDate: "2026-08-20T00:00:00.000Z",
      priority: "NORMAL",
      submissionType: "TEXT",
      language: null,
      testCases: [],
      rubric: [{ criterion: "Correctness", maxPoints: 10 }],
      status: "PUBLISHED",
    },
  };
}

function revision(text: string, status = "PENDING", feedback: string | null = null) {
  return {
    id: "revision-1",
    recipientId: "recipient-1",
    studentId: "student-1",
    revisionNo: 1,
    submissionType: "TEXT",
    textAnswer: text,
    fileKey: null,
    fileName: null,
    repositoryUrl: null,
    editorUrl: null,
    resourceVersion: 1,
    submittedAt: "2026-08-01T12:05:00.000Z",
    status,
    score: status === "APPROVED" ? 8 : null,
    rubricScores: [],
    feedback,
    reviewedBy: status === "PENDING" ? null : "mentor-1",
    reviewedAt: status === "PENDING" ? null : "2026-08-01T13:00:00.000Z",
  };
}

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("submission page", () => {
  beforeEach(() => {
    let state = "NOT_STARTED";
    let revisions: ReturnType<typeof revision>[] = [];
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
        if (url.includes("/assignments") && !url.includes("/submissions")) {
          return json({ data: [recipient(state)] });
        }
        if (url.includes("/start")) {
          state = "IN_PROGRESS";
          return json({ data: recipient(state) });
        }
        if (url.includes("/submissions") && method === "POST") {
          const body = JSON.parse(String(init?.body)) as { textAnswer: string };
          state = "SUBMITTED";
          revisions = [revision(body.textAnswer)];
          return json({ data: { revision: revisions[0], recipient: recipient(state) } }, 201);
        }
        if (url.includes("/submissions")) {
          return json({ data: revisions });
        }
        return json({ data: [] });
      }),
    );
  });

  it("starts an assignment and stores the answer as a revision", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/student/assignments"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("link", { name: "Explain arrays" }));
    await user.click(await screen.findByRole("button", { name: "Start assignment" }));
    await user.type(await screen.findByRole("textbox", { name: "Answer" }), "An array stores values by index.");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("An array stores values by index.")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByText("Written against resource version 1")).toBeInTheDocument();
  });
});

describe("mentor review", () => {
  beforeEach(() => {
    let state = "SUBMITTED";
    let status = "PENDING";
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
        if (url.includes("/assignments") && !url.includes("/submissions")) {
          return json({ data: [recipient(state)] });
        }
        if (url.endsWith("/open")) {
          state = "UNDER_REVIEW";
          return json({ data: { revision: revision("An array stores values by index.", status), recipient: recipient(state) } });
        }
        if (url.endsWith("/review") && method === "POST") {
          state = "COMPLETED";
          status = "APPROVED";
          return json({
            data: {
              revision: revision("An array stores values by index.", "APPROVED", "Clear explanation."),
              recipient: recipient(state),
            },
          });
        }
        if (url.includes("/submissions")) {
          return json({
            data: [revision("An array stores values by index.", status, status === "APPROVED" ? "Clear explanation." : null)],
          });
        }
        return json({ data: [] });
      }),
    );
  });

  it("opens a submission and approves it with feedback and a score", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/mentor/students/student-1/assignments/recipient-1"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Open for review" }));
    await user.type(await screen.findByRole("textbox", { name: "Feedback" }), "Clear explanation.");
    await user.type(screen.getByRole("spinbutton", { name: "Score" }), "8");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Feedback: Clear explanation.")).toBeInTheDocument();
    const calls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.endsWith("/open"))).toBe(true);
    const reviewCall = vi.mocked(fetch).mock.calls.find((call) => String(call[0]).endsWith("/review"));
    expect(JSON.parse(String(reviewCall?.[1]?.body))).toMatchObject({
      decision: "APPROVE",
      feedback: "Clear explanation.",
      score: 8,
    });
  });
});
