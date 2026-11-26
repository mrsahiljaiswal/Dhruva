import type { DiscussionComment, DiscussionThread, ReportTarget, Role } from "@dhruva/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { MarkdownBody } from "@/features/resources/markdown-body";
import { libraryBase } from "@/features/resources/labels";
import {
  ApiError,
  acceptAnswer,
  createComment,
  escalateThread,
  getThread,
  highlightThread,
  react,
  reportContent,
  resolveThread,
} from "./api";
import { CATEGORY_LABELS, areaClass } from "./labels";

function canModerate(role: Role | undefined): boolean {
  return role === "MENTOR" || role === "ADMIN";
}

export function ThreadPage() {
  const { postId = "" } = useParams();
  const { user } = useAuth();
  const [thread, setThread] = useState<DiscussionThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<{ type: ReportTarget; id: string } | null>(null);
  const [reportReason, setReportReason] = useState("");

  function load() {
    setError(null);
    setDenied(false);
    void getThread(postId)
      .then(setThread)
      .catch((caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 403) {
          setDenied(true);
          return;
        }
        setError(caught instanceof Error ? caught.message : "The thread could not be opened.");
      });
  }

  useEffect(() => {
    setThread(null);
    load();
    // The post id is the only input. load closes over the latest helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function run(action: () => Promise<void>) {
    setNotice(null);
    setError(null);
    try {
      await action();
      load();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "That could not be saved.");
    }
  }

  if (denied) {
    return <ErrorState title="This thread is not for you" description="It belongs to a reading you cannot open." />;
  }
  if (error && !thread) {
    return <ErrorState title="This thread could not be opened" description={error} />;
  }
  if (!thread || !user) {
    return <Spinner />;
  }

  const opened = thread;
  const moderate = canModerate(user.role);
  const canAccept = moderate || user.id === opened.authorId;
  const topLevel = opened.comments.filter((comment) => !comment.parentCommentId);
  const repliesTo = (id: string) => opened.comments.filter((comment) => comment.parentCommentId === id);

  const commentBlock = (comment: DiscussionComment, nested: boolean) => {
    return (
      <li key={comment.id} className={nested ? "ml-6 border-l pl-4" : "space-y-3"}>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {comment.authorName}
            {comment.accepted ? " · Accepted answer" : ""}
          </p>
          <MarkdownBody source={comment.body} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void run(() => react("COMMENT", comment.id, "HELPFUL"))}>
              Helpful{comment.helpfulCount > 0 ? ` ${comment.helpfulCount}` : ""}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void run(() => react("COMMENT", comment.id, "LIKE"))}>
              Like{comment.likeCount > 0 ? ` ${comment.likeCount}` : ""}
            </Button>
            {canAccept ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void run(() => acceptAnswer(opened.id, comment.id))}>
                Accept
              </Button>
            ) : null}
            {!nested ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setReplyTo(comment.id)}>
                Reply
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setReportTarget({ type: "COMMENT", id: comment.id });
                setReportReason("");
              }}
            >
              Report
            </Button>
          </div>
        </div>
        {repliesTo(comment.id).length > 0 ? <ul className="space-y-4">{repliesTo(comment.id).map((reply) => commentBlock(reply, true))}</ul> : null}
      </li>
    );
  };

  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <Link to="/forum" className="hover:text-foreground">
            Forum
          </Link>
          {thread.resourceId ? (
            <Link to={`${libraryBase(user.role)}/${thread.resourceId}`} className="hover:text-foreground">
              Reading
            </Link>
          ) : null}
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {thread.category ? CATEGORY_LABELS[thread.category] : "Resource doubt"} · {thread.authorName}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{thread.title}</h1>
        <p className="text-sm text-muted-foreground">
          {thread.status === "RESOLVED" ? "Resolved" : "Open"}
          {thread.highlighted ? " · Highlighted" : ""}
        </p>
      </header>

      <MarkdownBody source={thread.body} />
      {thread.codeSnippet ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{thread.codeSnippet}</pre>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void run(() => react("POST", thread.id, "HELPFUL"))}>
          Helpful{thread.helpfulCount > 0 ? ` ${thread.helpfulCount}` : ""}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void run(() => react("POST", thread.id, "LIKE"))}>
          Like{thread.likeCount > 0 ? ` ${thread.likeCount}` : ""}
        </Button>
        {moderate ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void run(() => resolveThread(thread.id))} disabled={thread.status === "RESOLVED"}>
              {thread.status === "RESOLVED" ? "Resolved" : "Mark resolved"}
            </Button>
            <Button type="button" variant="outline" size="sm" aria-pressed={thread.highlighted} onClick={() => void run(() => highlightThread(thread.id))}>
              {thread.highlighted ? "Highlighted" : "Highlight"}
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setReportTarget({ type: "POST", id: thread.id });
            setReportReason("");
          }}
        >
          Report
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setReportTarget({ type: "USER", id: thread.authorId });
            setReportReason("");
          }}
        >
          Report author
        </Button>
      </div>

      {reportTarget ? (
        <form
          className="space-y-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const target = reportTarget;
            void run(async () => {
              await reportContent(target.type, target.id, reportReason);
              setReportTarget(null);
              setReportReason("");
              setNotice("The report was filed.");
            });
          }}
        >
          <label className="block space-y-1 text-sm">
            Why are you reporting this?
            <textarea className={areaClass} value={reportReason} onChange={(event) => setReportReason(event.target.value)} required />
          </label>
          <Button type="submit">File report</Button>
        </form>
      ) : null}

      {moderate ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await escalateThread(thread.id, reason);
              setReason("");
              setNotice("The escalation was filed for an administrator.");
            });
          }}
        >
          <label className="block space-y-1 text-sm">
            Escalate to an administrator
            <textarea className={areaClass} value={reason} onChange={(event) => setReason(event.target.value)} required />
          </label>
          <Button type="submit" variant="outline">
            Escalate
          </Button>
        </form>
      ) : null}

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-semibold">Replies</h2>
        {topLevel.length === 0 ? <p className="text-sm text-muted-foreground">No replies yet.</p> : null}
        <ul className="space-y-6">{topLevel.map((comment) => commentBlock(comment, false))}</ul>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const parent = replyTo;
            void run(async () => {
              await createComment(thread.id, reply, parent);
              setReply("");
              setReplyTo(null);
            });
          }}
        >
          <label className="block space-y-1 text-sm">
            {replyTo ? "Reply one level down" : "Reply"}
            <textarea className={areaClass} value={reply} onChange={(event) => setReply(event.target.value)} required />
          </label>
          <div className="flex gap-2">
            <Button type="submit">Post reply</Button>
            {replyTo ? (
              <Button type="button" variant="outline" onClick={() => setReplyTo(null)}>
                Reply to the post
              </Button>
            ) : null}
          </div>
        </form>
      </section>
    </article>
  );
}
