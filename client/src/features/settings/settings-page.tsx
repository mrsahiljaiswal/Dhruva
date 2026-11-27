import { DEFAULT_SUPPORT_THRESHOLDS, type SupportThresholds } from "@dhruva/shared";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { ApiError, loadSettings, saveSettings } from "@/features/messaging/api";

export function SettingsPage() {
  const [studentDirectMessages, setStudentDirectMessages] = useState(false);
  const [groupChat, setGroupChat] = useState(false);
  const [supportThresholds, setSupportThresholds] = useState<SupportThresholds>({ ...DEFAULT_SUPPORT_THRESHOLDS });
  const [etag, setEtag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadSettings()
      .then((result) => {
        setStudentDirectMessages(result.settings.studentDirectMessages);
        setGroupChat(result.settings.groupChat);
        setSupportThresholds(result.settings.supportThresholds);
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
      const next = await saveSettings(etag, { studentDirectMessages, groupChat, supportThresholds });
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
        <p className="mt-1 text-sm text-muted-foreground">
          Student-to-student messages and group chats stay off until you turn them on. Support thresholds only change the labels mentors and admins see.
        </p>
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
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="text-sm font-medium">Support thresholds</legend>
          {(
            [
              ["attentionCompletionPct", "Attention below this completion %"],
              ["interventionCompletionPct", "Intervention below this completion %"],
              ["attentionAverageScore", "Attention below this assessment %"],
              ["interventionAverageScore", "Intervention below this assessment %"],
              ["attentionOverdueCount", "Attention at this many overdue"],
              ["interventionOverdueCount", "Intervention at this many overdue"],
              ["inactiveDays", "Days without activity"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              <span>{label}</span>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                type="number"
                value={supportThresholds[key]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    setSupportThresholds((current) => ({ ...current, [key]: value }));
                  }
                }}
              />
            </label>
          ))}
        </fieldset>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {saved ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
        <Button type="submit" disabled={saving}>
          Save settings
        </Button>
      </form>
    </section>
  );
}
