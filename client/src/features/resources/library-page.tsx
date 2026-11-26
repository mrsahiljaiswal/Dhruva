import type { ResourceStatus } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";
import { ApiError, listResources } from "./api";
import { DIFFICULTY_LABELS, TYPE_LABELS, difficultyAccent, libraryBase } from "./labels";

const TABS: ResourceStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

const EMPTY: Record<ResourceStatus, string> = {
  DRAFT: "No drafts.",
  PUBLISHED: "Nothing is published.",
  ARCHIVED: "Nothing is archived.",
};

export function ResourceLibraryPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || (user?.role === "MENTOR" && user.capabilities.canCreateResources);
  const [status, setStatus] = useState<ResourceStatus>("PUBLISHED");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listResources>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = libraryBase(user?.role);

  useEffect(() => {
    if (!user || (user.role === "MENTOR" && !canManage)) {
      return;
    }
    const controller = new AbortController();
    setRows(null);
    setError(null);
    void listResources(canManage ? { status, page } : { page })
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : "The library could not be loaded.");
        }
      });
    return () => controller.abort();
  }, [canManage, page, status, user]);

  if (!user) {
    return <Spinner />;
  }

  if (user.role === "MENTOR" && !canManage) {
    return (
      <ErrorState
        title="You cannot add reading yet"
        description="An administrator turns that on with the Resources checkbox."
      />
    );
  }

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {canManage ? "Reading you can hand to a cohort, your students, or one person." : "Reading published for you."}
          </p>
        </div>
        {canManage ? (
          <Button asChild>
            <Link to={`${base}/new`}>Write</Link>
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <div className="inline-flex rounded-full border bg-card p-1" role="tablist" aria-label="Resource state">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={status === tab}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm",
                status === tab ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setStatus(tab);
                setPage(1);
              }}
            >
              {tab === "DRAFT" ? "Drafts" : tab === "PUBLISHED" ? "Published" : "Archived"}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <ErrorState title="The library did not load" description={error} /> : null}
      {!error && !rows ? <Spinner /> : null}
      {rows && rows.data.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
          {canManage ? EMPTY[status] : "Nothing has been published for you yet."}
        </p>
      ) : null}
      {rows && rows.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.data.map((resource) => (
            <Link
              key={resource.id}
              to={`${base}/${resource.id}`}
              aria-label={resource.title}
              className={cn(
                "flex flex-col rounded-lg border border-l-4 bg-card p-5 transition-colors hover:bg-accent/40",
                difficultyAccent(resource.difficulty),
              )}
            >
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{resource.topic}</p>
              <h2 className="mt-2 text-lg font-semibold leading-snug">{resource.title}</h2>
              {resource.description ? (
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{resource.description}</p>
              ) : null}
              <p className="mt-4 text-xs text-muted-foreground">
                {TYPE_LABELS[resource.type]} · {DIFFICULTY_LABELS[resource.difficulty]} · {resource.estimatedDurationMin} min
                {resource.attachmentCount > 0 ? ` · ${resource.attachmentCount} file${resource.attachmentCount === 1 ? "" : "s"}` : ""}
              </p>
            </Link>
          ))}
        </div>
      ) : null}
      {rows && rows.total > rows.limit ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {rows.page} / {Math.ceil(rows.total / rows.limit)}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page * rows.limit >= rows.total}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
