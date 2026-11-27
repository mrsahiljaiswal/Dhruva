import type { PublicUser } from "@dhruva/shared";
import { render, screen } from "@testing-library/react";
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

const progress = {
  studentId: "student-1",
  assignedCount: 4,
  completedCount: 2,
  pendingCount: 1,
  overdueCount: 1,
  completionPct: 50,
  averageScore: 80,
  topicScores: [{ topic: "Arrays", assignedCount: 2, completedCount: 1, completionPct: 50, averageScore: 80 }],
  weeklyActiveDays: 3,
  week: [
    { date: "2026-11-20", active: false },
    { date: "2026-11-21", active: true },
    { date: "2026-11-22", active: false },
    { date: "2026-11-23", active: true },
    { date: "2026-11-24", active: false },
    { date: "2026-11-25", active: true },
    { date: "2026-11-26", active: false },
  ],
  recentFeedback: [{ assignmentTitle: "Arrays practice", feedback: "Show the index check.", reviewedAt: "2026-11-26T00:00:00.000Z", score: 8 }],
  activity: [],
  computedAt: "2026-11-26T00:00:00.000Z",
};

describe("student progress", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/auth/csrf")) {
          return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" } }) };
        }
        if (url.includes("/auth/me")) {
          return { ok: true, status: 200, json: async () => ({ data: student }) };
        }
        if (url.includes("/me/progress")) {
          return { ok: true, status: 200, json: async () => ({ data: progress }) };
        }
        if (url.includes("/me/plan")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { date: "2026-11-26", dayNumber: null, path: null, items: [], deadlines: [] } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }),
    );
  });

  it("shows completion and assessment scores without a support label", async () => {
    render(
      <MemoryRouter initialEntries={["/student/dashboard"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Progress" })).toBeInTheDocument();
    expect(screen.getByText("Assignment completion and assessment scores are tracked separately.")).toBeInTheDocument();
    expect(screen.getByText("Arrays practice")).toBeInTheDocument();
    expect(screen.getByText("Show the index check.")).toBeInTheDocument();
    expect(screen.queryByText(/support indicator/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });
});
