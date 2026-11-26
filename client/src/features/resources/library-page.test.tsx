import type { PublicUser, ResourceSummary, Role } from "@dhruva/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/features/auth/auth-context";
import { AppRoutes } from "@/routes";

function person(role: Role, resources = false): PublicUser {
  return {
    id: `${role}-1`,
    name: role === "STUDENT" ? "Ada Lovelace" : "Grace Hopper",
    email: `${role.toLowerCase()}@example.com`,
    role,
    branch: role === "STUDENT" ? "CSE" : null,
    cohortId: null,
    status: "ACTIVE",
    capabilities: { canCreateResources: resources, canCreateAssessments: false, canGradeAssessments: false },
  };
}

function summary(title: string): ResourceSummary {
  return {
    id: "resource-1",
    title,
    description: "How arrays work",
    type: "ARTICLE",
    topic: "Data structures",
    tags: ["arrays"],
    difficulty: "BEGINNER",
    estimatedDurationMin: 25,
    status: "PUBLISHED",
    visibility: "GLOBAL",
    targetIds: [],
    version: 1,
    revision: 1,
    createdBy: "ADMIN-1",
    publishedAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:00:00.000Z",
    attachmentCount: 0,
  };
}

function mockSession(user: PublicUser, resources: ResourceSummary[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" } }) };
      }
      if (url.includes("/auth/me")) {
        return { ok: true, status: 200, json: async () => ({ data: user }) };
      }
      if (url.includes("/resources")) {
        return { ok: true, status: 200, json: async () => ({ data: resources, page: 1, limit: 20, total: resources.length }) };
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

describe("resource library screens", () => {
  beforeEach(() => {
    mockSession(person("STUDENT"), [summary("Arrays")]);
  });

  it("shows a student only the resources the library returned", async () => {
    renderAt("/student/resources");
    expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Arrays" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Write" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Drafts" })).not.toBeInTheDocument();
  });

  it("gives an administrator the draft, published, and archived library", async () => {
    mockSession(person("ADMIN", true), [summary("Arrays")]);
    renderAt("/admin/resources");
    expect(await screen.findByRole("tab", { name: "Drafts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Published" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Archived" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write" })).toBeInTheDocument();
  });

  it("hides the library from a mentor until the resources permission is on", async () => {
    mockSession(person("MENTOR", false));
    renderAt("/mentor/dashboard");
    expect(await screen.findByRole("heading", { name: "Mentor dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Library" })).not.toBeInTheDocument();
  });

  it("opens a form where an administrator can write and publish", async () => {
    mockSession(person("ADMIN", true));
    renderAt("/admin/resources/new");
    expect(await screen.findByRole("heading", { name: "Write" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.getByLabelText("Who can read this")).toBeInTheDocument();
  });

  it("shows the library to a mentor who can create resources", async () => {
    mockSession(person("MENTOR", true), []);
    renderAt("/mentor/resources");
    expect(await screen.findByRole("link", { name: "Library" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Write" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Archived" })).toBeInTheDocument();
  });
});
