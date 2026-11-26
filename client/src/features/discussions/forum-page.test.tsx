import type { DiscussionPost, DiscussionThread, PublicUser, Role } from "@dhruva/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/features/auth/auth-context";
import { AppRoutes } from "@/routes";

function person(role: Role): PublicUser {
  return {
    id: `${role}-1`,
    name: role === "STUDENT" ? "Ada Lovelace" : "Grace Hopper",
    email: `${role.toLowerCase()}@example.com`,
    role,
    branch: role === "STUDENT" ? "CSE" : null,
    cohortId: null,
    status: "ACTIVE",
    capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
  };
}

function post(title: string, status: DiscussionPost["status"] = "OPEN"): DiscussionPost {
  return {
    id: title === "Binary search" ? "post-1" : "post-2",
    scope: "FORUM",
    resourceId: null,
    category: "DSA",
    authorId: "STUDENT-1",
    authorName: "Ada Lovelace",
    title,
    body: "How does the range shrink?",
    codeSnippet: "mid = (low + high) / 2",
    status,
    acceptedCommentId: null,
    highlighted: false,
    replyCount: status === "RESOLVED" ? 1 : 0,
    helpfulCount: 0,
    likeCount: 0,
    viewerHelpful: false,
    viewerLike: false,
    createdAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:00:00.000Z",
  };
}

function thread(): DiscussionThread {
  return {
    ...post("Binary search"),
    comments: [
      {
        id: "comment-1",
        postId: "post-1",
        parentCommentId: null,
        authorId: "MENTOR-1",
        authorName: "Grace Hopper",
        body: "Halve the range each time.",
        helpfulCount: 0,
        likeCount: 0,
        viewerHelpful: false,
        viewerLike: false,
        accepted: false,
        createdAt: "2026-11-26T01:00:00.000Z",
      },
      {
        id: "comment-2",
        postId: "post-1",
        parentCommentId: "comment-1",
        authorId: "STUDENT-1",
        authorName: "Ada Lovelace",
        body: "That helped.",
        helpfulCount: 0,
        likeCount: 0,
        viewerHelpful: false,
        viewerLike: false,
        accepted: false,
        createdAt: "2026-11-26T02:00:00.000Z",
      },
    ],
  };
}

function mockForum(user: PublicUser) {
  const created: DiscussionPost[] = [];
  const doubts: DiscussionPost[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ data: { csrfToken: "csrf-token" } }) };
      }
      if (url.includes("/auth/me")) {
        return { ok: true, status: 200, json: async () => ({ data: user }) };
      }
      if (url.includes("/posts/post-1") && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ data: thread() }) };
      }
      if (url.includes("/posts/post-1/accept")) {
        return { ok: true, status: 200, json: async () => ({ data: thread() }) };
      }
      if (url.includes("/forum/posts") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { title: string; body: string; category: DiscussionPost["category"] };
        const row = { ...post(body.title), title: body.title, body: body.body, category: body.category };
        created.unshift(row);
        return { ok: true, status: 201, json: async () => ({ data: row }) };
      }
      if (url.includes("/forum/posts")) {
        const parsed = new URL(url, "http://localhost");
        const status = parsed.searchParams.get("status");
        const rows = status === "RESOLVED" ? [post("Sorting", "RESOLVED")] : [post("Binary search"), ...created];
        return { ok: true, status: 200, json: async () => ({ data: rows, page: 1, limit: 20, total: rows.length }) };
      }
      if (url.includes("/resources/resource-1/posts") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { title: string };
        const row: DiscussionPost = { ...post(body.title), scope: "RESOURCE", resourceId: "resource-1", title: body.title };
        doubts.unshift(row);
        return { ok: true, status: 201, json: async () => ({ data: row }) };
      }
      if (url.includes("/resources/resource-1/posts")) {
        return { ok: true, status: 200, json: async () => ({ data: doubts, page: 1, limit: 20, total: doubts.length }) };
      }
      if (url.includes("/resources/resource-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: "resource-1",
              title: "Arrays",
              description: "How arrays work",
              type: "ARTICLE",
              topic: "Data structures",
              tags: [],
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
              content: "Use an index.",
              externalLink: null,
              attachments: [],
              language: null,
              testCases: [],
            },
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

describe("forum and doubts", () => {
  beforeEach(() => {
    mockForum(person("STUDENT"));
  });

  it("filters the forum and posts a new thread", async () => {
    const user = userEvent.setup();
    renderAt("/forum");
    expect(await screen.findByRole("heading", { name: "Forum" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Binary search" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Forum" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "Linked lists");
    await user.type(screen.getByLabelText("Question"), "Where does the next pointer go?");
    await user.selectOptions(screen.getByLabelText("Post category"), "DSA");
    await user.click(screen.getByRole("button", { name: "Post to the forum" }));
    expect(await screen.findByRole("link", { name: "Linked lists" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Resolved" }));
    expect(await screen.findByRole("link", { name: "Sorting" })).toBeInTheDocument();
  });

  it("shows a nested reply and lets the author accept it", async () => {
    const user = userEvent.setup();
    renderAt("/forum/post-1");
    expect(await screen.findByRole("heading", { name: "Binary search" })).toBeInTheDocument();
    expect(screen.getByText("mid = (low + high) / 2")).toBeInTheDocument();
    expect(screen.getByText("Halve the range each time.")).toBeInTheDocument();
    expect(screen.getByText("That helped.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reply" })).toHaveLength(1);
    await user.click(screen.getAllByRole("button", { name: "Accept" })[0]!);
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]).includes("/accept"))).toBe(true);
  });

  it("lets a mentor resolve and escalate", async () => {
    mockForum(person("MENTOR"));
    renderAt("/forum/post-1");
    expect(await screen.findByRole("button", { name: "Mark resolved" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Highlight" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escalate" })).toBeInTheDocument();
    expect(screen.getByLabelText("Escalate to an administrator")).toBeInTheDocument();
  });

  it("asks a doubt from the reading", async () => {
    const user = userEvent.setup();
    renderAt("/student/resources/resource-1");
    expect(await screen.findByRole("heading", { name: "Doubts" })).toBeInTheDocument();
    expect(await screen.findByText("No doubts on this reading yet.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Index question");
    await user.type(screen.getByLabelText("Question"), "Does the first slot start at zero?");
    await user.type(screen.getByLabelText("Code snippet"), "values[0]");
    await user.click(screen.getByRole("button", { name: "Ask a doubt" }));
    expect(await screen.findByRole("link", { name: "Index question" })).toBeInTheDocument();
  });
});
