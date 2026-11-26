import { z } from "zod";
import {
  API_PREFIX,
  CSRF_HEADER,
  conversationListResponseSchema,
  conversationResponseSchema,
  messageListResponseSchema,
  messageResponseSchema,
  messagingFeaturesResponseSchema,
  platformSettingsResponseSchema,
  type Conversation,
  type ChatMessage,
  type MessagingFeatures,
  type PlatformSettings,
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

export async function mentorStudents(mentorId: string): Promise<{ id: string; name: string }[]> {
  const response = await request(`/mentors/${mentorId}/students`);
  return z.object({ data: z.array(z.object({ id: z.string(), name: z.string() })) }).parse(await response.json()).data;
}

export async function messagingFeatures(): Promise<MessagingFeatures> {
  const response = await request("/settings/features");
  return messagingFeaturesResponseSchema.parse(await response.json()).data;
}

export async function listConversations(): Promise<Conversation[]> {
  const response = await request("/conversations");
  return conversationListResponseSchema.parse(await response.json()).data;
}

export async function openConversation(body: unknown): Promise<Conversation> {
  const response = await request("/conversations", { method: "POST", body: JSON.stringify(body) });
  return conversationResponseSchema.parse(await response.json()).data;
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const response = await request(`/conversations/${conversationId}/messages`);
  return messageListResponseSchema.parse(await response.json()).data;
}

export async function sendMessage(conversationId: string, body: string): Promise<ChatMessage> {
  const response = await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  return messageResponseSchema.parse(await response.json()).data;
}

export async function markConversationRead(conversationId: string, messageId: string): Promise<void> {
  await request(`/conversations/${conversationId}/read`, { method: "POST", body: JSON.stringify({ messageId }) });
}

export async function breakGlass(conversationId: string, reason: string): Promise<ChatMessage[]> {
  const response = await request(`/conversations/${conversationId}/break-glass`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  return messageListResponseSchema.parse(await response.json()).data;
}

export async function loadSettings(): Promise<{ settings: PlatformSettings; etag: string }> {
  const response = await request("/settings");
  const settings = platformSettingsResponseSchema.parse(await response.json()).data;
  return { settings, etag: response.headers.get("etag") ?? `"${settings.version}"` };
}

export async function saveSettings(
  etag: string,
  patch: Partial<Pick<PlatformSettings, "studentDirectMessages" | "groupChat">>,
): Promise<PlatformSettings> {
  const response = await request("/settings", {
    method: "PATCH",
    headers: { "if-match": etag },
    body: JSON.stringify(patch),
  });
  return platformSettingsResponseSchema.parse(await response.json()).data;
}
