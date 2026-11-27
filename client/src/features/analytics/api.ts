import {
  API_PREFIX,
  CSRF_HEADER,
  adminAnalyticsResponseSchema,
  exportJobResponseSchema,
  mentorAnalyticsResponseSchema,
  studentProgressResponseSchema,
  supportedProgressResponseSchema,
  type AdminAnalytics,
  type CreateExportInput,
  type ExportJob,
  type MentorAnalytics,
  type StudentProgressView,
  type SupportedProgress,
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

export async function myProgress(): Promise<StudentProgressView> {
  const response = await request("/me/progress");
  return studentProgressResponseSchema.parse(await response.json()).data;
}

export async function studentProgress(studentId: string): Promise<SupportedProgress> {
  const response = await request(`/students/${studentId}/progress`);
  return supportedProgressResponseSchema.parse(await response.json()).data;
}

export async function mentorAnalytics(): Promise<MentorAnalytics> {
  const response = await request("/analytics/mentor");
  return mentorAnalyticsResponseSchema.parse(await response.json()).data;
}

export async function adminAnalytics(): Promise<AdminAnalytics> {
  const response = await request("/analytics/overview");
  return adminAnalyticsResponseSchema.parse(await response.json()).data;
}

export async function createExport(input: CreateExportInput): Promise<ExportJob> {
  const response = await request("/exports", { method: "POST", body: JSON.stringify(input) });
  return exportJobResponseSchema.parse(await response.json()).data;
}

export async function readExport(id: string): Promise<ExportJob> {
  const response = await request(`/exports/${id}`);
  return exportJobResponseSchema.parse(await response.json()).data;
}
