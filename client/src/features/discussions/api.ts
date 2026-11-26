import {
  API_PREFIX,
  CSRF_HEADER,
  discussionListResponseSchema,
  discussionResponseSchema,
  discussionThreadResponseSchema,
  reactionResultSchema,
  reportResponseSchema,
  type CreateDoubtInput,
  type CreateForumPostInput,
  type DiscussionCategory,
  type DiscussionFilter,
  type DiscussionPost,
  type DiscussionThread,
  type ReactionKind,
  type ReactionTarget,
  type ReportTarget,
  type ReportView,
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

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export async function listResourcePosts(resourceId: string): Promise<DiscussionPost[]> {
  const response = await request(`/resources/${resourceId}/posts`);
  return discussionListResponseSchema.parse(await response.json()).data;
}

export async function createDoubt(resourceId: string, input: CreateDoubtInput): Promise<DiscussionPost> {
  const response = await request(`/resources/${resourceId}/posts`, { method: "POST", body: JSON.stringify(input) });
  return discussionResponseSchema.parse(await response.json()).data;
}

export async function listForumPosts(filters: {
  q?: string;
  category?: DiscussionCategory;
  status?: DiscussionFilter;
  page?: number;
}): Promise<{ data: DiscussionPost[]; total: number }> {
  const response = await request(`/forum/posts${query(filters)}`);
  const parsed = discussionListResponseSchema.parse(await response.json());
  return { data: parsed.data, total: parsed.total };
}

export async function createForumPost(input: CreateForumPostInput): Promise<DiscussionPost> {
  const response = await request("/forum/posts", { method: "POST", body: JSON.stringify(input) });
  return discussionResponseSchema.parse(await response.json()).data;
}

export async function getThread(postId: string): Promise<DiscussionThread> {
  const response = await request(`/posts/${postId}`);
  return discussionThreadResponseSchema.parse(await response.json()).data;
}

export async function createComment(postId: string, body: string, parentCommentId: string | null): Promise<void> {
  await request(`/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, parentCommentId }),
  });
}

export async function acceptAnswer(postId: string, commentId: string): Promise<void> {
  await request(`/posts/${postId}/accept`, { method: "POST", body: JSON.stringify({ commentId }) });
}

export async function resolveThread(postId: string): Promise<void> {
  await request(`/posts/${postId}/resolve`, { method: "POST" });
}

export async function highlightThread(postId: string): Promise<void> {
  await request(`/posts/${postId}/highlight`, { method: "POST" });
}

export async function escalateThread(postId: string, reason: string): Promise<ReportView> {
  const response = await request(`/posts/${postId}/escalate`, { method: "POST", body: JSON.stringify({ reason }) });
  return reportResponseSchema.parse(await response.json()).data;
}

export async function react(targetType: ReactionTarget, targetId: string, kind: ReactionKind): Promise<void> {
  const response = await request("/reactions", { method: "POST", body: JSON.stringify({ targetType, targetId, kind }) });
  reactionResultSchema.parse((await response.json()).data);
}

export async function reportContent(targetType: ReportTarget, targetId: string, reason: string): Promise<ReportView> {
  const response = await request("/reports", {
    method: "POST",
    body: JSON.stringify({ targetType, targetId, reason }),
  });
  return reportResponseSchema.parse(await response.json()).data;
}
