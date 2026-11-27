import { BRANCHES, type AnnouncementAudience } from "@dhruva/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError, createAnnouncement, listAnnouncements, updateAnnouncement } from "./api";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function toIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

export function AnnouncementsPage() {
  const { user, listCohorts, listPeople } = useAuth();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listAnnouncements>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("ALL");
  const [targets, setTargets] = useState<string[]>([]);
  const [publishAt, setPublishAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [cohorts, setCohorts] = useState<{ id: string; name: string }[]>([]);
  const [mentors, setMentors] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    const next = await listAnnouncements();
    setRows(next);
  }

  useEffect(() => {
    void reload().catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.message : "Announcements could not be loaded.");
    });
  }, []);

  useEffect(() => {
    if (user?.role !== "ADMIN") {
      return;
    }
    void listCohorts()
      .then((items) => setCohorts(Array.isArray(items) ? items : []))
      .catch(() => setCohorts([]));
    void listPeople("MENTOR")
      .then((items) => setMentors(items.filter((person) => person.status !== "DEACTIVATED").map((person) => ({ id: person.id, name: person.name }))))
      .catch(() => setMentors([]));
  }, [user?.role, listCohorts, listPeople]);

  function toggle(id: string) {
    setTargets((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await createAnnouncement({
        title,
        body,
        audience,
        targetIds: audience === "ALL" ? [] : targets,
        publishAt: toIso(publishAt),
        expiresAt: toIso(expiresAt) ?? null,
      });
      setTitle("");
      setBody("");
      setTargets([]);
      setPublishAt("");
      setExpiresAt("");
      setNotice("The announcement was saved.");
      await reload();
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "The announcement could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function expire(id: string) {
    setError(null);
    try {
      await updateAnnouncement(id, { expireNow: true });
      await reload();
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "The announcement could not be expired.");
    }
  }

  if (error && !rows) {
    return <ErrorState title="Announcements could not be opened" description={error} />;
  }
  if (!rows) {
    return <Spinner />;
  }

  const choices =
    audience === "COHORT"
      ? cohorts
      : audience === "MENTOR_GROUP"
        ? mentors
        : audience === "BRANCH"
          ? BRANCHES.map((branch) => ({ id: branch, name: branch }))
          : [];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
        <p className="mt-1 text-sm text-muted-foreground">Messages published to you, a cohort, a branch, or a mentor group.</p>
      </div>
      {error ? <ErrorState title="Something went wrong" description={error} /> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {user?.role === "ADMIN" ? (
        <Card>
          <CardHeader>
            <CardTitle>New announcement</CardTitle>
            <CardDescription>Publish it now, or set a time. It leaves the list after it expires.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(event) => void publish(event)}>
              <Input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" required />
              <textarea
                aria-label="Announcement"
                className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What people should know"
                required
              />
              <label className="block space-y-1 text-sm">
                <span>Audience</span>
                <select
                  aria-label="Audience"
                  className={selectClass}
                  value={audience}
                  onChange={(event) => {
                    setAudience(event.target.value as AnnouncementAudience);
                    setTargets([]);
                  }}
                >
                  <option value="ALL">Everyone</option>
                  <option value="COHORT">Cohort</option>
                  <option value="BRANCH">Branch</option>
                  <option value="MENTOR_GROUP">Mentor group</option>
                </select>
              </label>
              {choices.length > 0 ? (
                <fieldset className="space-y-1">
                  <legend className="text-sm">Who should see it</legend>
                  {choices.map((choice) => (
                    <label key={choice.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={targets.includes(choice.id)} onChange={() => toggle(choice.id)} />
                      {choice.name}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>Publish at</span>
                  <Input aria-label="Publish at" type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <span>Expires at</span>
                  <Input aria-label="Expires at" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                </label>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving" : "Save announcement"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="No announcements" description="Nothing is published for you right now." />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{row.title}</CardTitle>
                    <Badge>{row.status}</Badge>
                  </div>
                  <CardDescription>
                    {row.audience === "ALL" ? "Everyone" : row.audience} · {new Date(row.publishAt).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm">{row.body}</p>
                  {user?.role === "ADMIN" && row.status !== "EXPIRED" ? (
                    <Button type="button" variant="outline" onClick={() => void expire(row.id)}>
                      Expire now
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
