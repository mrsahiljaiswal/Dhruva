import {
  API_PREFIX,
  CSRF_HEADER,
  assignmentDefinitionSchema,
  dailyPlanSchema,
  learningPathDetailSchema,
  learningPathSummarySchema,
  recipientViewSchema,
  type AssignmentDefinition,
  type CreateAssignmentInput,
  type DailyPlan,
  type LearningPathDetail,
  type LearningPathSummary,
  type LearningPathWrite,
  type RecipientView,
} from "@dhruva/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | null {
  const row = document.cookie.split("; ").find((part) => part.startsWith("dhruva.csrf="));
  if (!row) {
    return null;
  }
  return decodeURIComponent(row.slice("dhruva.csrf=".length));
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  const token = csrfToken();
  if (method !== "GET" && method !== "HEAD" && token) {
    headers.set(CSRF_HEADER, token);
  }
  const response = await fetch(`${API_PREFIX}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: { message?: unknown } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : "Request failed.";
    throw new ApiError(message, response.status);
  }
  return response;
}

function matchHeader(revision: number): HeadersInit {
  return { "if-match": `"${revision}"` };
}

export async function getMyPlan(date?: string): Promise<DailyPlan> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await request(`/me/plan${suffix}`);
  return dailyPlanSchema.parse((await response.json()).data);
}

export async function getMyAssignments(): Promise<RecipientView[]> {
  const response = await request("/me/assignments");
  return recipientViewSchema.array().parse((await response.json()).data);
}

export async function getStudentPlan(studentId: string): Promise<DailyPlan> {
  const response = await request(`/students/${studentId}/plan`);
  return dailyPlanSchema.parse((await response.json()).data);
}

export async function getStudentAssignments(studentId: string): Promise<RecipientView[]> {
  const response = await request(`/students/${studentId}/assignments`);
  return recipientViewSchema.array().parse((await response.json()).data);
}

export async function listLearningPaths(): Promise<LearningPathSummary[]> {
  const response = await request("/learning-paths");
  return learningPathSummarySchema.array().parse((await response.json()).data);
}

export async function createLearningPath(input: LearningPathWrite): Promise<LearningPathDetail> {
  const response = await request("/learning-paths", { method: "POST", body: JSON.stringify(input) });
  return learningPathDetailSchema.parse((await response.json()).data);
}

export async function publishLearningPath(id: string, revision: number): Promise<LearningPathDetail> {
  const response = await request(`/learning-paths/${id}/publish`, { method: "POST", headers: matchHeader(revision) });
  return learningPathDetailSchema.parse((await response.json()).data);
}

export async function archiveLearningPath(id: string, revision: number): Promise<LearningPathDetail> {
  const response = await request(`/learning-paths/${id}/archive`, { method: "POST", headers: matchHeader(revision) });
  return learningPathDetailSchema.parse((await response.json()).data);
}

export async function listAssignmentDefinitions(): Promise<AssignmentDefinition[]> {
  const response = await request("/assignments");
  return assignmentDefinitionSchema.array().parse((await response.json()).data);
}

export async function createAssignment(input: CreateAssignmentInput): Promise<AssignmentDefinition> {
  const response = await request("/assignments", { method: "POST", body: JSON.stringify(input) });
  return assignmentDefinitionSchema.parse((await response.json()).data);
}

export async function publishAssignment(id: string, revision: number): Promise<AssignmentDefinition> {
  const response = await request(`/assignments/${id}/publish`, { method: "POST", headers: matchHeader(revision) });
  return assignmentDefinitionSchema.parse((await response.json()).data);
}

export async function archiveAssignment(id: string, revision: number): Promise<AssignmentDefinition> {
  const response = await request(`/assignments/${id}/archive`, { method: "POST", headers: matchHeader(revision) });
  return assignmentDefinitionSchema.parse((await response.json()).data);
}
