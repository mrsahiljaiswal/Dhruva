import {
  API_PREFIX,
  CSRF_HEADER,
  downloadLinkResponseSchema,
  resourceListResponseSchema,
  resourceResponseSchema,
  uploadSlotResponseSchema,
  type CreateResourceInput,
  type PublishResourceInput,
  type ResourceDetail,
  type ResourceMimeType,
  type ResourceStatus,
  type ResourceSummary,
  type UpdateResourceInput,
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

export async function listResources(query: { status?: ResourceStatus; page?: number } = {}): Promise<{
  data: ResourceSummary[];
  page: number;
  limit: number;
  total: number;
}> {
  const params = new URLSearchParams();
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.page) {
    params.set("page", String(query.page));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const response = await request(`/resources${suffix}`);
  return resourceListResponseSchema.parse(await response.json());
}

export async function getResource(id: string): Promise<ResourceDetail> {
  const response = await request(`/resources/${id}`);
  return resourceResponseSchema.parse(await response.json()).data;
}

export async function createResource(input: CreateResourceInput): Promise<ResourceDetail> {
  const response = await request("/resources", { method: "POST", body: JSON.stringify(input) });
  return resourceResponseSchema.parse(await response.json()).data;
}

export async function updateResource(id: string, revision: number, input: UpdateResourceInput): Promise<ResourceDetail> {
  const response = await request(`/resources/${id}`, {
    method: "PATCH",
    headers: matchHeader(revision),
    body: JSON.stringify(input),
  });
  return resourceResponseSchema.parse(await response.json()).data;
}

export async function publishResource(id: string, revision: number, input: PublishResourceInput): Promise<ResourceDetail> {
  const response = await request(`/resources/${id}/publish`, {
    method: "POST",
    headers: matchHeader(revision),
    body: JSON.stringify(input),
  });
  return resourceResponseSchema.parse(await response.json()).data;
}

export async function archiveResource(id: string, revision: number): Promise<ResourceDetail> {
  const response = await request(`/resources/${id}/archive`, { method: "POST", headers: matchHeader(revision) });
  return resourceResponseSchema.parse(await response.json()).data;
}

export async function uploadResourceFile(id: string, revision: number, file: File): Promise<ResourceDetail> {
  const slotResponse = await request("/uploads", {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
  });
  const slot = uploadSlotResponseSchema.parse(await slotResponse.json()).data;
  if (slot.method === "PUT") {
    const uploaded = await fetch(slot.uploadUrl, { method: "PUT", headers: slot.headers, body: file });
    if (!uploaded.ok) {
      throw new ApiError("The file could not be uploaded.", uploaded.status);
    }
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries(slot.fields)) {
      form.append(key, value);
    }
    form.append("file", file);
    const uploaded = await fetch(slot.uploadUrl, { method: "POST", body: form });
    if (!uploaded.ok) {
      throw new ApiError("The file could not be uploaded.", uploaded.status);
    }
  }
  const attached = await request(`/resources/${id}/attachments`, {
    method: "POST",
    headers: matchHeader(revision),
    body: JSON.stringify({ storageKey: slot.storageKey }),
  });
  return resourceResponseSchema.parse(await attached.json()).data;
}

export async function downloadResource(id: string, storageKey: string): Promise<{ url: string; expiresAt: string }> {
  const params = new URLSearchParams({ storageKey });
  const response = await request(`/resources/${id}/download?${params.toString()}`);
  return downloadLinkResponseSchema.parse(await response.json()).data;
}

export function isAllowedResourceFile(file: File): file is File & { type: ResourceMimeType } {
  return (
    file.type === "application/pdf" ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.type === "image/webp" ||
    file.type === "text/plain"
  );
}
