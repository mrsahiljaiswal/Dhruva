import type { PublicUser, Role } from "@dhruva/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/features/auth/auth-context";
import { AppRoutes } from "@/routes";

function person(role: Role, name: string): PublicUser {
  return {
    id: `${role}-1`,
    name,
    email: `${role.toLowerCase()}@example.com`,
    role,
    branch: role === "STUDENT" ? "CSE" : null,
    cohortId: null,
    status: "ACTIVE",
    capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
  };
}

const announcement = {
  id: "announcement-1",
  title: "Lab move",
  body: "The lab is in room 2.",
  audience: "ALL",
  targetIds: [],
  publishAt: "2026-11-27T09:00:00.000Z",
  expiresAt: null,
  createdBy: "ADMIN-1",
  status: "PUBLISHED",
  createdAt: "2026-11-27T08:00:00.000Z",
};

const report = {
  id: "report-1",
  targetType: "POST",
  targetId: "post-1",
  reportedBy: "MENTOR-1",
  reportedByName: "Grace",
  reason: "Off topic",
  status: "OPEN",
  resolution: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: "2026-11-27T08:00:00.000Z",
  target: { authorId: "STUDENT-1", authorName: "Ada", excerpt: "Spam post", hidden: false },
};

function mockSession(user: PublicUser) {
  let resolved = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" } }) };
      }
      if (url.includes("/auth/me")) {
        return { ok: true, status: 200, json: async () => ({ data: user }) };
      }
      if (url.includes("/health")) {
        return { ok: true, status: 200, json: async () => ({ data: { status: "ok" } }) };
      }
      if (url.includes("/notifications")) {
        return { ok: true, status: 200, json: async () => ({ data: [], unread: 0 }) };
      }
      if (url.includes("/announcements") && (!init?.method || init.method === "GET")) {
        return { ok: true, status: 200, json: async () => ({ data: [announcement] }) };
      }
      if (url.includes("/reports") && url.includes("/resolve")) {
        resolved = true;
        return { ok: true, status: 200, json: async () => ({ data: { ...report, status: "DISMISSED", resolution: "DISMISS" } }) };
      }
      if (url.includes("/reports")) {
        const row = resolved ? { ...report, status: "DISMISSED", resolution: "DISMISS" } : report;
        return { ok: true, status: 200, json: async () => ({ data: [row] }) };
      }
      if (url.includes("/audit/Report/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "audit-1",
                actorId: "ADMIN-1",
                action: "moderation.action_taken",
                subjectType: "Report",
                subjectId: "report-1",
                before: { status: "OPEN" },
                after: { action: "DISMISS" },
                reason: "Allowed.",
                requestId: null,
                ip: null,
                createdAt: "2026-11-27T08:05:00.000Z",
              },
            ],
          }),
        };
      }
      if (url.includes("/audit")) {
        return { ok: true, status: 200, json: async () => ({ data: [], page: 1, limit: 20, total: 0 }) };
      }
      if (url.includes("/students/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              studentId: "STUDENT-1",
              assignedCount: 0,
              completedCount: 0,
              pendingCount: 0,
              overdueCount: 0,
              completionPct: null,
              averageScore: null,
              topicScores: [],
              weeklyActiveDays: 0,
              week: [],
              recentFeedback: [],
              activity: [
                {
                  type: "RESOURCE_OPENED",
                  refType: "Resource",
                  refId: "resource-1",
                  occurredAt: "2026-11-27T08:00:00.000Z",
                },
              ],
              computedAt: "2026-11-27T08:00:00.000Z",
              supportIndicator: "ON_TRACK",
              supportReasons: [],
              thresholds: {
                attentionCompletionPct: 70,
                interventionCompletionPct: 40,
                attentionAverageScore: 60,
                interventionAverageScore: 40,
                attentionOverdueCount: 1,
                interventionOverdueCount: 3,
                inactiveDays: 7,
              },
              supportNote: "Support indicator. It does not block the student or change a grade.",
            },
          }),
        };
      }
      if (url.includes("/cohorts") || url.includes("/users")) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }),
  );
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

describe("moderation screens", () => {
  beforeEach(() => {
    mockSession(person("STUDENT", "Ada Lovelace"));
  });

  it("shows a published announcement to a student and keeps the editor with admin", async () => {
    renderAt("/announcements");
    expect(await screen.findByRole("heading", { name: "Lab move" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save announcement" })).not.toBeInTheDocument();

    mockSession(person("ADMIN", "Grace Hopper"));
    renderAt("/announcements");
    expect(await screen.findByRole("button", { name: "Save announcement" })).toBeInTheDocument();
  });

  it("lets an admin dismiss a report and read learning activity beside the audit log", async () => {
    mockSession(person("ADMIN", "Grace Hopper"));
    const user = userEvent.setup();
    renderAt("/admin/reports");
    expect(await screen.findByText("Off topic")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Note for Spam post"), "Allowed.");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("DISMISS")).toBeInTheDocument();

    renderAt("/admin/audit");
    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Subject type"), "Report");
    await user.type(screen.getByLabelText("Subject id"), "report-1");
    await user.click(screen.getByRole("button", { name: "Record history" }));
    expect(await screen.findByText(/moderation.action_taken/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Student id"), "STUDENT-1");
    await user.click(screen.getByRole("button", { name: "Show activity" }));
    expect(await screen.findByText(/RESOURCE_OPENED/)).toBeInTheDocument();
  });
});
