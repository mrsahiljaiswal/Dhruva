import { API_PREFIX, CSRF_HEADER, type PublicUser, type Role, authUserResponseSchema, csrfResponseSchema } from "@dhruva/shared";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type InviteInput = {
  name: string;
  email: string;
  role: Role;
  branch?: PublicUser["branch"];
  cohortId?: string;
};

type Person = {
  id: string;
  name: string;
  email: string;
  role: Role;
  branch: string | null;
  cohortId: string | null;
  status: "INVITED" | "ACTIVE" | "DEACTIVATED";
  capabilities: {
    canCreateResources: boolean;
    canCreateAssessments: boolean;
    canGradeAssessments: boolean;
  };
};

type ImportPreview = {
  previewId: string;
  rows: { line: number; name: string; email: string; errors: string[] }[];
};

type AuthContextValue = {
  user: PublicUser | null;
  ready: boolean;
  unreachable: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  invite: (input: InviteInput) => Promise<string | null>;
  listCohorts: () => Promise<{ id: string; name: string }[]>;
  createCohort: (input: { name: string; academicYear: string; startDate: string; endDate: string }) => Promise<void>;
  listPeople: (role?: Role) => Promise<Person[]>;
  assignMentor: (mentorId: string, studentIds: string[]) => Promise<void>;
  reassignMentor: (mentorId: string, studentIds: string[]) => Promise<void>;
  updatePerson: (
    id: string,
    patch: Partial<Pick<Person, "name" | "branch" | "cohortId" | "capabilities">>,
  ) => Promise<void>;
  deactivatePerson: (id: string) => Promise<void>;
  reactivatePerson: (id: string) => Promise<string | null>;
  reinvitePerson: (id: string) => Promise<string | null>;
  previewImport: (csv: string) => Promise<ImportPreview>;
  commitImport: (previewId: string) => Promise<{ created: number }>;
  listMentorStudents: (mentorId: string) => Promise<{ id: string; name: string; email: string; branch: string | null }[]>;
  acceptInvite: (token: string, password: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "Request failed.";
}

function readInviteUrl(body: unknown): string | null {
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data?: { inviteUrl?: unknown } }).data;
    if (data && typeof data.inviteUrl === "string") {
      return data.inviteUrl;
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const csrfToken = useRef<string | null>(null);

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body) {
      headers.set("content-type", "application/json");
    }
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && csrfToken.current) {
      headers.set(CSRF_HEADER, csrfToken.current);
    }
    const response = await fetch(`${API_PREFIX}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    return response;
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const csrfResponse = await fetch(`${API_PREFIX}/auth/csrf`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!csrfResponse.ok) {
          throw new Error("csrf");
        }
        const csrf = csrfResponseSchema.parse(await csrfResponse.json());
        csrfToken.current = csrf.data.csrfToken;

        const meResponse = await fetch(`${API_PREFIX}/auth/me`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (meResponse.status === 401) {
          setUser(null);
          setReady(true);
          return;
        }
        if (!meResponse.ok) {
          throw new Error("me");
        }
        const me = authUserResponseSchema.parse(await meResponse.json());
        setUser(me.data);
        setReady(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setUnreachable(true);
        setReady(true);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      unreachable,
      async login(email, password) {
        const response = await request("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setUser(authUserResponseSchema.parse(await response.json()).data);
      },
      async logout() {
        await request("/auth/logout", { method: "POST" });
        setUser(null);
      },
      async invite(input) {
        const response = await request("/users", { method: "POST", body: JSON.stringify(input) });
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "inviteUrl" in body && typeof body.inviteUrl === "string") {
          return body.inviteUrl;
        }
        return null;
      },
      async listCohorts() {
        const response = await request("/cohorts");
        const body = (await response.json()) as { data: { id: string; name: string }[] };
        return body.data;
      },
      async createCohort(input) {
        await request("/cohorts", { method: "POST", body: JSON.stringify(input) });
      },
      async listPeople(role) {
        const response = await request(role ? `/users?role=${role}` : "/users");
        const body = (await response.json()) as { data: Person[] };
        return Array.isArray(body.data) ? body.data : [];
      },
      async assignMentor(mentorId, studentIds) {
        await request("/mentor-assignments", { method: "POST", body: JSON.stringify({ mentorId, studentIds }) });
      },
      async reassignMentor(mentorId, studentIds) {
        await request("/mentor-assignments/reassign", {
          method: "POST",
          body: JSON.stringify({ mentorId, studentIds }),
        });
      },
      async updatePerson(id, patch) {
        await request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      },
      async deactivatePerson(id) {
        await request(`/users/${id}/deactivate`, { method: "POST" });
      },
      async reactivatePerson(id) {
        const response = await request(`/users/${id}/reactivate`, { method: "POST" });
        return readInviteUrl(await response.json());
      },
      async reinvitePerson(id) {
        const response = await request(`/users/${id}/reinvite`, { method: "POST" });
        return readInviteUrl(await response.json());
      },
      async previewImport(csv) {
        const response = await request("/users/import", { method: "POST", body: JSON.stringify({ csv }) });
        return ((await response.json()) as { data: ImportPreview }).data;
      },
      async commitImport(previewId) {
        const response = await request(`/users/import/${previewId}/commit`, { method: "POST" });
        return ((await response.json()) as { data: { created: number } }).data;
      },
      async listMentorStudents(mentorId) {
        const response = await request(`/mentors/${mentorId}/students`);
        const body = (await response.json()) as {
          data: { id: string; name: string; email: string; branch: string | null }[];
        };
        return body.data;
      },
      async acceptInvite(token, password) {
        const response = await request("/auth/accept-invite", {
          method: "POST",
          body: JSON.stringify({ token, password }),
        });
        setUser(authUserResponseSchema.parse(await response.json()).data);
      },
      async forgotPassword(email) {
        await request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      },
      async resetPassword(token, password) {
        await request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      },
      async changePassword(currentPassword, newPassword) {
        await request("/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword }),
        });
      },
    }),
    [ready, unreachable, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}
