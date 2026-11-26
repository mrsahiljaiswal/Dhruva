import type { DiscussionCategory, DiscussionFilter, DiscussionPost } from "@dhruva/shared";
import { DISCUSSION_CATEGORIES } from "@dhruva/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, createForumPost, listForumPosts } from "./api";
import { CATEGORY_LABELS, areaClass, fieldClass } from "./labels";

const FILTERS: { id: "" | Extract<DiscussionFilter, "UNANSWERED" | "RESOLVED">; label: string }[] = [
  { id: "", label: "All" },
  { id: "UNANSWERED", label: "Unanswered" },
  { id: "RESOLVED", label: "Resolved" },
];

export function ForumPage() {
  const [posts, setPosts] = useState<DiscussionPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<DiscussionCategory | "">("");
  const [status, setStatus] = useState<"" | "UNANSWERED" | "RESOLVED">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postCategory, setPostCategory] = useState<DiscussionCategory>("GENERAL");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void listForumPosts({
      q: query || undefined,
      category: category || undefined,
      status: status || undefined,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPosts(result.data);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "The forum could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [category, query, status]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createForumPost({
        title,
        body,
        category: postCategory,
        codeSnippet: code.trim() ? code : null,
      });
      setTitle("");
      setBody("");
      setCode("");
      const result = await listForumPosts({
        q: query || undefined,
        category: category || undefined,
        status: status || undefined,
      });
      setPosts(result.data);
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "The post could not be published.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !posts) {
    return <ErrorState title="The forum could not be opened" description={error} />;
  }
  if (!posts) {
    return <Spinner />;
  }

  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Forum</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Anyone signed in can read and post. Search stays inside the words of the title and the question.
        </p>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <label className="min-w-48 flex-1 space-y-1 text-sm">
          Search
          <Input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          Filter by category
          <select className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value as DiscussionCategory | "")}>
            <option value="">All categories</option>
            {DISCUSSION_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {CATEGORY_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Search</Button>
      </form>

      <div className="inline-flex rounded-full border bg-card p-1" role="tablist" aria-label="Thread status">
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            role="tab"
            aria-selected={status === filter.id}
            className={`rounded-full px-4 py-1.5 text-sm ${status === filter.id ? "bg-foreground text-background" : "text-muted-foreground"}`}
            onClick={() => setStatus(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {posts.length === 0 ? <p className="text-sm text-muted-foreground">No posts match.</p> : null}
      <ul className="space-y-4">
        {posts.map((post) => (
          <li key={post.id} className="border-b pb-4">
            <Link to={`/forum/${post.id}`} className="font-medium hover:underline">
              {post.highlighted ? "Highlighted · " : ""}
              {post.title}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {post.category ? CATEGORY_LABELS[post.category] : "Forum"} · {post.authorName} ·{" "}
              {post.status === "RESOLVED" ? "Resolved" : post.acceptedCommentId ? "Answered" : "Unanswered"} · {post.replyCount}{" "}
              {post.replyCount === 1 ? "reply" : "replies"}
            </p>
          </li>
        ))}
      </ul>

      <form className="space-y-3 border-t pt-6" onSubmit={(event) => void publish(event)}>
        <h2 className="text-lg font-semibold">New post</h2>
        <label className="block space-y-1 text-sm">
          Title
          <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="block space-y-1 text-sm">
          Category
          <select
            className={fieldClass}
            aria-label="Post category"
            value={postCategory}
            onChange={(event) => setPostCategory(event.target.value as DiscussionCategory)}
          >
            {DISCUSSION_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {CATEGORY_LABELS[item]}
              </option>
            ))}
          </select>
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
          Post to the forum
        </Button>
      </form>
    </section>
  );
}
