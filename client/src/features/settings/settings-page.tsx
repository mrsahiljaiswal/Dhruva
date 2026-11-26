import { useEffect, useState, type FormEvent } from "react";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { ApiError, loadSettings, saveSettings } from "@/features/messaging/api";

export function SettingsPage() {
  const [studentDirectMessages, setStudentDirectMessages] = useState(false);
  const [groupChat, setGroupChat] = useState(false);
  const [etag, setEtag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadSettings()
      .then((result) => {
        setStudentDirectMessages(result.settings.studentDirectMessages);
        setGroupChat(result.settings.groupChat);
        setEtag(result.etag);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : "Settings could not be loaded.");
      });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!etag) {
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await saveSettings(etag, { studentDirectMessages, groupChat });
      setEtag(`"${next.version}"`);
      setSaved(true);
    } catch (caught: unknown) {
      setError(caught instanceof ApiError ? caught.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !etag) {
    return <ErrorState title="Settings could not be opened" description={error} />;
  }
  if (!etag) {
    return <Spinner />;
  }

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Student-to-student messages and group chats stay off until you turn them on.</p>
      </div>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={studentDirectMessages} onChange={(event) => setStudentDirectMessages(event.target.checked)} />
          Students can message each other
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={groupChat} onChange={(event) => setGroupChat(event.target.checked)} />
          Group chats are on
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {saved ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
        <Button type="submit" disabled={saving}>
          Save settings
        </Button>
      </form>
    </section>
  );
}
