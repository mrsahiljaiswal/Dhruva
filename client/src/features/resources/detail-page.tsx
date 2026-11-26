import type { ResourceDetail } from "@dhruva/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError, downloadResource, getResource } from "./api";
import { DIFFICULTY_LABELS, TYPE_LABELS, libraryBase } from "./labels";
import { MarkdownBody } from "./markdown-body";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ResourceDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [resource, setResource] = useState<ResourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const base = libraryBase(user?.role);
  const canEdit = Boolean(
    user && resource && (user.role === "ADMIN" || user.id === resource.createdBy) && resource.status !== "ARCHIVED",
  );

  useEffect(() => {
    const controller = new AbortController();
    setResource(null);
    setError(null);
    setDenied(false);
    void getResource(id)
      .then((found) => {
        if (!controller.signal.aborted) {
          setResource(found);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 403) {
          setDenied(true);
          return;
        }
        setError(caught instanceof Error ? caught.message : "The resource could not be opened.");
      });
    return () => controller.abort();
  }, [id]);

  async function openFile(storageKey: string) {
    setDownloadError(null);
    try {
      const link = await downloadResource(id, storageKey);
      window.open(link.url, "_blank", "noopener,noreferrer");
    } catch (caught: unknown) {
      setDownloadError(caught instanceof Error ? caught.message : "The file could not be opened.");
    }
  }

  if (denied) {
    return <ErrorState title="This reading is not for you" description="It was published for someone else." />;
  }
  if (error) {
    return <ErrorState title="This reading could not be opened" description={error} />;
  }
  if (!resource) {
    return <Spinner />;
  }

  const showChecks = resource.type === "CODING_EXERCISE" && (resource.language || resource.testCases.length > 0);

  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Link to={base} className="text-sm text-muted-foreground hover:text-foreground">
            Library
          </Link>
          {canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`${base}/${resource.id}/edit`}>Edit</Link>
            </Button>
          ) : null}
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{resource.topic}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{resource.title}</h1>
        <p className="text-sm text-muted-foreground">
          {TYPE_LABELS[resource.type]} · {DIFFICULTY_LABELS[resource.difficulty]} · {resource.estimatedDurationMin} min
          {resource.status === "ARCHIVED" ? " · Archived" : ""}
          {canEdit ? ` · v${resource.version}` : ""}
        </p>
        {resource.tags.length > 0 ? <p className="text-sm text-muted-foreground">{resource.tags.join(" · ")}</p> : null}
      </header>

      {resource.description ? <p className="text-lg leading-relaxed text-foreground/80">{resource.description}</p> : null}
      {resource.externalLink ? (
        <a
          href={resource.externalLink}
          className="inline-flex text-sm font-medium underline underline-offset-4"
          target="_blank"
          rel="noreferrer"
        >
          Open {linkHost(resource.externalLink)}
        </a>
      ) : null}
      <MarkdownBody source={resource.content} />

      {showChecks ? (
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {resource.language ? resource.language : "Examples"}
          </h2>
          <ul className="space-y-3">
            {resource.testCases.map((testCase) => (
              <li key={testCase.name} className="rounded-md bg-muted/60 p-4">
                <p className="text-sm font-medium">{testCase.name}</p>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-5">{testCase.input}</pre>
                {testCase.expectedOutput ? (
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-5 text-muted-foreground">
                    {testCase.expectedOutput}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {resource.attachments.length > 0 ? (
        <section className="space-y-2 border-t pt-6">
          {resource.attachments.map((file) => (
            <div key={file.storageKey} className="flex items-center justify-between gap-3 py-1">
              <div>
                <p className="text-sm font-medium">{file.fileName}</p>
                <p className="text-xs text-muted-foreground">{formatSize(file.sizeBytes)}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void openFile(file.storageKey)}>
                Download
              </Button>
            </div>
          ))}
          {downloadError ? <p className="text-sm text-destructive">{downloadError}</p> : null}
        </section>
      ) : null}
    </article>
  );
}
