import type { Conversation, PublicUser } from "@dhruva/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/features/auth/auth-context";
import { AppRoutes } from "@/routes";

const user: PublicUser = {
  id: "student-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "STUDENT",
  branch: "CSE",
  cohortId: "cohort-1",
  status: "ACTIVE",
  capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
};

const conversation: Conversation = {
  id: "conversation-1",
  type: "DIRECT",
  purpose: "MENTORSHIP",
  title: null,
  participants: [
    { id: "student-1", name: "Ada Lovelace", role: "STUDENT" },
    { id: "mentor-1", name: "Grace Hopper", role: "MENTOR" },
  ],
  lastMessageAt: "2026-11-26T10:00:00.000Z",
  unreadCount: 0,
  writable: true,
};

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, headers: { get: () => null } };
}

describe("messages", () => {
  beforeEach(() => {
    const thread = [
      {
        id: "message-1",
        conversationId: "conversation-1",
        senderId: "mentor-1",
        senderName: "Grace Hopper",
        body: "Start with the first exercise.",
        attachments: [],
        sentAt: "2026-11-26T10:00:00.000Z",
        readBy: [],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/auth/csrf")) return json({ data: { csrfToken: "csrf-token" } });
        if (url.includes("/auth/me")) return json({ data: user });
        if (url.includes("/health")) return json({ data: { status: "ok" } });
        if (url.includes("/notifications")) return json({ data: [], unread: 0 });
        if (url.includes("/notification-preferences")) return json({ data: { email: false } });
        if (url.includes("/settings/features")) return json({ data: { studentDirectMessages: false, groupChat: false } });
        if (url.endsWith("/conversations") && (!init?.method || init.method === "GET")) return json({ data: [conversation] });
        if (url.endsWith("/conversations") && init?.method === "POST") return json({ data: conversation }, 201);
        if (url.includes("/messages") && init?.method === "POST") {
          thread.unshift({
            id: "message-2",
            conversationId: "conversation-1",
            senderId: "student-1",
            senderName: "Ada Lovelace",
            body: "hello mentor",
            attachments: [],
            sentAt: "2026-11-26T10:01:00.000Z",
            readBy: [],
          });
          return json({ data: thread[0] }, 201);
        }
        if (url.includes("/messages")) {
          return json({ data: thread, page: 1, limit: 20, total: thread.length });
        }
        if (url.includes("/read")) return json({ data: { messageId: "message-1", readAt: "2026-11-26T10:02:00.000Z" } });
        return json({ data: [] });
      }),
    );
  });

  it("opens the mentor conversation and sends a message", async () => {
    const actor = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/messages"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Messages" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Message a student" })).not.toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Grace Hopper" }));
    expect(await screen.findByText("Start with the first exercise.")).toBeInTheDocument();
    await actor.type(screen.getByRole("textbox", { name: "Message" }), "hello mentor");
    await actor.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("hello mentor")).toBeInTheDocument();
  });
});
