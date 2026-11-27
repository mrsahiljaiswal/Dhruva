import {
  API_PREFIX,
  CSRF_HEADER,
  announcementListResponseSchema,
  announcementResponseSchema,
  auditHistoryResponseSchema,
  auditListResponseSchema,
  reportQueueItemResponseSchema,
  reportQueueResponseSchema,
  type Announcement,
  type AuditEntry,
  type CreateAnnouncementInput,
  type PatchAnnouncementInput,
  type ReportQueueItem,
  type ReportStatus,
  type ResolveReportInput,
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

export async function listAnnouncements(): Promise<Announcement[]> {
  const response = await request("/announcements");
  return announcementListResponseSchema.parse(await response.json()).data;
}

export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  const response = await request("/announcements", { method: "POST", body: JSON.stringify(input) });
  return announcementResponseSchema.parse(await response.json()).data;
}

export async function updateAnnouncement(id: string, input: PatchAnnouncementInput): Promise<Announcement> {
  const response = await request(`/announcements/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  return announcementResponseSchema.parse(await response.json()).data;
}

export async function listReports(status?: ReportStatus): Promise<ReportQueueItem[]> {
  const query = status ? `?status=${status}` : "";
  const response = await request(`/reports${query}`);
  return reportQueueResponseSchema.parse(await response.json()).data;
}

export async function resolveReport(id: string, input: ResolveReportInput): Promise<ReportQueueItem> {
  const response = await request(`/reports/${id}/resolve`, { method: "POST", body: JSON.stringify(input) });
  return reportQueueItemResponseSchema.parse(await response.json()).data;
}

export async function listAudit(query: Record<string, string>): Promise<{ data: AuditEntry[]; total: number }> {
  const params = new URLSearchParams(query);
  const response = await request(`/audit?${params.toString()}`);
  const body = auditListResponseSchema.parse(await response.json());
  return { data: body.data, total: body.total };
}

export async function auditHistory(subjectType: string, subjectId: string): Promise<AuditEntry[]> {
  const response = await request(`/audit/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}`);
  return auditHistoryResponseSchema.parse(await response.json()).data;
}
