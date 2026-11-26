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

const plan = {
  date: "2026-08-01",
  dayNumber: 1,
  path: { id: "path-1", title: "First fortnight", dayTitle: "Arrays" },
  items: [
    {
      source: "PATH",
      kind: "RESOURCE",
      refId: "resource-1",
      title: "Arrays",
      required: true,
      recipientId: null,
      state: null,
      overdue: false,
    },
    {
      source: "INDIVIDUAL",
      kind: "ASSIGNMENT",
      refId: "assignment-1",
      title: "Ada's practice",
      required: true,
      recipientId: "recipient-1",
      state: "NOT_STARTED",
      overdue: true,
    },
  ],
  deadlines: [],
};

describe("student plan", () => {
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
        if (url.includes("/me/plan")) {
          return { ok: true, status: 200, json: async () => ({ data: plan }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }),
    );
  });

  it("shows today's path item and an overdue personal assignment", async () => {
    render(
      <MemoryRouter initialEntries={["/student/dashboard"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Arrays" })).toBeInTheDocument();
    expect(screen.getByText("Ada's practice")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Day 1 of the program")).toBeInTheDocument();
  });
});
