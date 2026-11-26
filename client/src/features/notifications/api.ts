import {
  API_PREFIX,
  CSRF_HEADER,
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
  type Notification,
  type NotificationPreferences,
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

export async function listNotifications(): Promise<{ data: Notification[]; unread: number }> {
  const response = await request("/notifications");
  return notificationListResponseSchema.parse(await response.json());
}

export async function markNotificationRead(id: string): Promise<void> {
  await request(`/notifications/${id}/read`, { method: "POST" });
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await request("/me/notification-preferences");
  return notificationPreferencesResponseSchema.parse(await response.json()).data;
}

export async function updateNotificationPreferences(email: boolean): Promise<NotificationPreferences> {
  const response = await request("/me/notification-preferences", { method: "PATCH", body: JSON.stringify({ email }) });
  return notificationPreferencesResponseSchema.parse(await response.json()).data;
}
