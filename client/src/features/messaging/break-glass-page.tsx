import type { ChatMessage } from "@dhruva/shared";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, breakGlass } from "./api";

export function BreakGlassPage() {
  const [params] = useSearchParams();
  const [conversationId, setConversationId] = useState(params.get("conversation") ?? "");
  const [reason, setReason] = useState("");
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setMessages(await breakGlass(conversationId.trim(), reason.trim()));
    } catch (caught: unknown) {
      setMessages(null);
      setError(caught instanceof ApiError ? caught.message : "The conversation could not be opened.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Private conversation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Opening a conversation you are not part of requires a written reason. The read is audited and another administrator is notified.
        </p>
      </div>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <Input aria-label="Conversation id" value={conversationId} onChange={(event) => setConversationId(event.target.value)} placeholder="Conversation id" />
        <textarea
          aria-label="Reason"
          className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this conversation has to be read"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={saving || !conversationId.trim() || !reason.trim()}>
          Open with reason
        </Button>
      </form>
      {messages ? (
        <ol className="space-y-3 rounded-lg border bg-card p-4">
          {messages.map((message) => (
            <li key={message.id} className="text-sm">
              <p className="font-medium">{message.senderName}</p>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
