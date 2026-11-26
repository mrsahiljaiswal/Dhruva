import type { ChatMessage, Conversation, MessagingFeatures } from "@dhruva/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import {
  ApiError,
  listConversations,
  listMessages,
  markConversationRead,
  mentorStudents,
  messagingFeatures,
  openConversation,
  sendMessage,
} from "./api";

const fieldClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

function titleFor(conversation: Conversation, selfId: string): string {
  if (conversation.title) {
    return conversation.title;
  }
  const others = conversation.participants.filter((person) => person.id !== selfId);
  return others.map((person) => person.name).join(", ") || "Conversation";
}

export function MessagesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get("conversation");
  const [features, setFeatures] = useState<MessagingFeatures | null>(null);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [studentId, setStudentId] = useState("");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [peerEmail, setPeerEmail] = useState("");
  const [groupEmails, setGroupEmails] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const socketRef = useRef<{ emit: (event: string, payload: unknown) => void } | null>(null);

  async function refreshList() {
    const rows = await listConversations();
    setConversations(rows);
    return rows;
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([messagingFeatures(), listConversations()])
      .then(([flags, rows]) => {
        if (!controller.signal.aborted) {
          setFeatures(flags);
          setConversations(rows);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "Messages could not be loaded.");
        }
      });
    if (user?.role === "MENTOR") {
      void mentorStudents(user.id)
        .then((rows) => {
          if (!controller.signal.aborted) {
            setStudents(rows);
          }
        })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!selected) {
      setMessages(null);
      return;
    }
    const controller = new AbortController();
    void listMessages(selected)
      .then((rows) => {
        if (controller.signal.aborted) {
          return;
        }
        setMessages(rows);
        const newest = rows[0];
        if (newest) {
          void markConversationRead(selected, newest.id);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "That conversation could not be opened.");
        }
      });
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    if (!selected || import.meta.env.VITEST) {
      return;
    }
    let connection: { emit: (event: string, payload: unknown) => void; disconnect: () => void } | undefined;
    let cancelled = false;
    void import("socket.io-client").then(({ io }) => {
      if (cancelled) {
        return;
      }
      const socket = io({ withCredentials: true, path: "/socket.io" });
      socket.emit("notification.subscribe");
      socket.emit("conversation.join", { conversationId: selected });
      socket.on("message.new", () => {
        void listMessages(selected).then(setMessages);
      });
      socket.on("message.read", () => {
        void listMessages(selected).then(setMessages);
      });
      socket.on("typing", (payload: { userId?: string }) => {
        if (payload.userId && payload.userId !== user?.id) {
          setTyping(true);
          window.setTimeout(() => setTyping(false), 2000);
        }
      });
      connection = socket;
      socketRef.current = socket;
    });
    return () => {
      cancelled = true;
      socketRef.current = null;
      connection?.disconnect();
    };
  }, [selected, user?.id]);

  async function choose(body: unknown) {
    setSaving(true);
    setError(null);
    try {
      const conversation = await openConversation(body);
      await refreshList();
      setParams({ conversation: conversation.id });
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "That conversation could not be opened.");
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim()) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendMessage(selected, draft.trim());
      setDraft("");
      setMessages(await listMessages(selected));
      await refreshList();
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "The message could not be sent.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !conversations) {
    return <ErrorState title="Messages could not be opened" description={error} />;
  }
  if (!conversations || !features || !user) {
    return <Spinner />;
  }

  const current = conversations.find((conversation) => conversation.id === selected) ?? null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">Conversations stay in the record. An open thread updates as messages arrive.</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div className="space-y-3">
          {user.role === "STUDENT" ? (
            <Button type="button" className="w-full" disabled={saving} onClick={() => void choose({ type: "DIRECT", withMentor: true })}>
              Message your mentor
            </Button>
          ) : null}
          {user.role === "MENTOR" ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (studentId) {
                  void choose({ type: "DIRECT", participantId: studentId });
                }
              }}
            >
              <select aria-label="Assigned student" className={fieldClass} value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                <option value="">Assigned student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
              <Button type="submit" className="w-full" disabled={saving || !studentId}>
                Message student
              </Button>
            </form>
          ) : null}
          {features.studentDirectMessages && user.role === "STUDENT" ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void choose({ type: "DIRECT", email: peerEmail });
              }}
            >
              <Input aria-label="Student email" value={peerEmail} onChange={(event) => setPeerEmail(event.target.value)} placeholder="Student email" />
              <Button type="submit" variant="outline" className="w-full" disabled={saving}>
                Message a student
              </Button>
            </form>
          ) : null}
          {features.groupChat && user.role !== "ADMIN" ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const emails = groupEmails.split(",").map((item) => item.trim()).filter(Boolean);
                void choose({ type: "GROUP", emails, title: groupTitle || undefined });
              }}
            >
              <Input aria-label="Group title" value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Group title" />
              <textarea
                aria-label="Group emails"
                className={fieldClass}
                value={groupEmails}
                onChange={(event) => setGroupEmails(event.target.value)}
                placeholder="Emails, separated by commas"
              />
              <Button type="submit" variant="outline" className="w-full" disabled={saving}>
                Start a group
              </Button>
            </form>
          ) : null}
          <ul className="space-y-1">
            {conversations.length === 0 ? <li className="text-sm text-muted-foreground">No conversations yet</li> : null}
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => setParams({ conversation: conversation.id })}
                >
                  {titleFor(conversation, user.id)}
                  {conversation.unreadCount > 0 ? <span className="ml-2 text-xs">({conversation.unreadCount})</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-h-64 rounded-lg border bg-card p-4">
          {!current || !messages ? (
            <p className="text-sm text-muted-foreground">Choose a conversation.</p>
          ) : (
            <div className="flex h-full flex-col gap-3">
              <h2 className="font-medium">{titleFor(current, user.id)}</h2>
              <ol className="flex flex-1 flex-col-reverse gap-3">
                {messages.map((message) => (
                  <li key={message.id} className="text-sm">
                    <p className="font-medium">{message.senderName}</p>
                    <p>{message.body}</p>
                    {message.senderId === user.id && message.readBy.some((receipt) => receipt.userId !== user.id) ? (
                      <p className="text-xs text-muted-foreground">Read</p>
                    ) : null}
                  </li>
                ))}
              </ol>
              {typing ? <p className="text-xs text-muted-foreground">Someone is typing</p> : null}
              {current.writable ? (
                <form className="flex gap-2" onSubmit={(event) => void submit(event)}>
                  <Input
                    aria-label="Message"
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      if (selected) {
                        socketRef.current?.emit("conversation.typing", { conversationId: selected });
                      }
                    }}
                  />
                  <Button type="submit" disabled={saving}>
                    Send
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">This conversation is closed to new messages.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
