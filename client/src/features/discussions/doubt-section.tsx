import type { DiscussionPost } from "@dhruva/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, createDoubt, listResourcePosts } from "./api";
import { areaClass } from "./labels";

export function DoubtSection({ resourceId }: { resourceId: string }) {
  const [posts, setPosts] = useState<DiscussionPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    void listResourcePosts(resourceId)
      .then(setPosts)
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "The doubts could not be loaded.");
      });
  }

  useEffect(() => {
    setPosts(null);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createDoubt(resourceId, { title, body, codeSnippet: code.trim() ? code : null });
      setTitle("");
      setBody("");
      setCode("");
      load();
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "The doubt could not be posted.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-6">
      <h2 className="text-lg font-semibold">Doubts</h2>
      <p className="text-sm text-muted-foreground">Ask about this reading. A code snippet stays as text.</p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {posts === null ? null : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No doubts on this reading yet.</p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id}>
              <Link to={`/forum/${post.id}`} className="font-medium hover:underline">
                {post.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {post.authorName} · {post.status === "RESOLVED" ? "Resolved" : "Open"} · {post.replyCount}{" "}
                {post.replyCount === 1 ? "reply" : "replies"}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <label className="block space-y-1 text-sm">
          Title
          <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          Question
          <textarea className={areaClass} value={body} onChange={(event) => setBody(event.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          Code snippet
          <textarea className={areaClass} value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} />
        </label>
        <Button type="submit" disabled={saving}>
          Ask a doubt
        </Button>
      </form>
    </section>
  );
}
