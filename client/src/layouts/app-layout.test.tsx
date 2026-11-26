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
    capabilities: {
      canCreateResources: false,
      canCreateAssessments: false,
      canGradeAssessments: false,
    },
  };
}

function mockSession(user: PublicUser | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" } }) };
      }
      if (url.includes("/auth/me")) {
        if (!user) {
          return { ok: false, status: 401, json: async () => ({ error: { message: "Sign in to continue." } }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: user }) };
      }
      if (url.includes("/health")) {
        return { ok: true, status: 200, json: async () => ({ data: { status: "ok" } }) };
      }
      if (url.includes("/me/plan")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { date: "2026-08-01", dayNumber: null, path: null, items: [], deadlines: [] },
          }),
        };
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

describe("application shell", () => {
  beforeEach(() => {
    mockSession(person("STUDENT", "Ada Lovelace"));
  });

  it("sends the home page to the student dashboard", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(await screen.findByText("API connected")).toBeInTheDocument();
  });

  it("shows only the student link to a student", async () => {
    renderAt("/student/dashboard");
    expect(await screen.findByRole("link", { name: "Today" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mentor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("sends a student away from the admin dashboard", async () => {
    renderAt("/admin/dashboard");
    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("opens notifications and the profile menu", async () => {
    const user = userEvent.setup();
    renderAt("/student/dashboard");

    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(await screen.findByRole("button", { name: "Open profile menu" })).toHaveTextContent("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Open profile menu" }));
    expect(await screen.findByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Change password" })).toBeInTheDocument();
  });

  it("shows an error when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderAt("/student/dashboard");
    expect(await screen.findByRole("alert")).toHaveTextContent("API unreachable");
    expect(screen.queryByRole("heading", { name: "Today" })).not.toBeInTheDocument();
  });

  it("shows a not-found state for an unknown page", async () => {
    renderAt("/missing");
    expect(await screen.findByRole("alert")).toHaveTextContent("Page not found");
  });

  it("shows the sign-in form when nobody is signed in", async () => {
    mockSession(null);
    renderAt("/login");
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows the invite form to an admin", async () => {
    mockSession(person("ADMIN", "Grace Hopper"));
    renderAt("/admin/dashboard");
    expect(await screen.findByRole("heading", { name: "Invite a user" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
    expect(screen.getByText("Invite from this page")).toBeInTheDocument();
  });
});
