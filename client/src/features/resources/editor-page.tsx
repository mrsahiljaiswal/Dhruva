import { zodResolver } from "@hookform/resolvers/zod";
import {
  DIFFICULTIES,
  RESOURCE_ATTACHMENT_MAX_BYTES,
  RESOURCE_TYPES,
  VISIBILITIES,
  createResourceSchema,
  type CreateResourceInput,
  type ResourceDetail,
  type Visibility,
} from "@dhruva/shared";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";
import {
  archiveResource,
  createResource,
  getResource,
  isAllowedResourceFile,
  publishResource,
  updateResource,
  uploadResourceFile,
} from "./api";
import { DIFFICULTY_LABELS, TYPE_LABELS, fieldClass, libraryBase } from "./labels";

const emptyResource: CreateResourceInput = {
  title: "",
  description: "",
  type: "ARTICLE",
  content: "",
  externalLink: null,
  topic: "",
  tags: [],
  difficulty: "BEGINNER",
  estimatedDurationMin: 30,
  language: null,
  testCases: [],
};

type Choice = { id: string; name: string };

export function ResourceEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, listCohorts, listPeople, listMentorStudents } = useAuth();
  const base = libraryBase(user?.role);
  const canManage = user?.role === "ADMIN" || (user?.role === "MENTOR" && user.capabilities.canCreateResources);
  const [resource, setResource] = useState<ResourceDetail | null>(null);
  const [tagText, setTagText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(user?.role === "ADMIN" ? "GLOBAL" : "MENTOR_GROUP");
  const [audience, setAudience] = useState<"group" | "students">("group");
  const [selected, setSelected] = useState<string[]>([]);
  const [cohorts, setCohorts] = useState<Choice[]>([]);
  const [mentors, setMentors] = useState<Choice[]>([]);
  const [students, setStudents] = useState<Choice[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const form = useForm<CreateResourceInput>({
    resolver: zodResolver(createResourceSchema),
    defaultValues: emptyResource,
  });
  const tests = useFieldArray({ control: form.control, name: "testCases" });
  const type = form.watch("type");
  const reset = form.reset;

  useEffect(() => {
    if (!id || !canManage) {
      return;
    }
    const controller = new AbortController();
    void getResource(id)
      .then((found) => {
        if (controller.signal.aborted) {
          return;
        }
        setResource(found);
        setTagText(found.tags.join(", "));
        reset({
          title: found.title,
          description: found.description,
          type: found.type,
          content: found.content,
          externalLink: found.externalLink,
          topic: found.topic,
          tags: found.tags,
          difficulty: found.difficulty,
          estimatedDurationMin: found.estimatedDurationMin,
          language: found.language,
          testCases: found.testCases.map((item) => ({
            name: item.name,
            input: item.input,
            expectedOutput: item.expectedOutput ?? "",
            hidden: item.hidden,
          })),
        });
        if (found.visibility) {
          setVisibility(found.visibility);
          setSelected(found.targetIds);
          setAudience(found.visibility === "INDIVIDUAL" ? "students" : "group");
        }
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "The resource could not be opened.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [canManage, id, reset]);

  useEffect(() => {
    if (!user || !canManage) {
      return;
    }
    if (user.role === "ADMIN") {
      void listCohorts().then((rows) => setCohorts(rows.map((row) => ({ id: row.id, name: row.name }))));
      void listPeople("MENTOR").then((rows) => setMentors(rows.map((row) => ({ id: row.id, name: row.name }))));
      void listPeople("STUDENT").then((rows) => setStudents(rows.map((row) => ({ id: row.id, name: row.name }))));
      return;
    }
    void listMentorStudents(user.id).then((rows) => setStudents(rows.map((row) => ({ id: row.id, name: row.name }))));
  }, [canManage, listCohorts, listMentorStudents, listPeople, user]);

  function toggle(targetId: string) {
    setSelected((current) => (current.includes(targetId) ? current.filter((item) => item !== targetId) : [...current, targetId]));
  }

  function scope(): { visibility: Visibility; targetIds: string[] } | null {
    if (!user) {
      return null;
    }
    if (user.role === "MENTOR") {
      if (audience === "group") {
        return { visibility: "MENTOR_GROUP", targetIds: [user.id] };
      }
      if (selected.length === 0) {
        setError("Choose at least one student.");
        return null;
      }
      return { visibility: "INDIVIDUAL", targetIds: selected };
    }
    if (visibility !== "GLOBAL" && selected.length === 0) {
      setError("Choose at least one target.");
      return null;
    }
    return { visibility, targetIds: visibility === "GLOBAL" ? [] : selected };
  }

  async function persist(values: CreateResourceInput, andPublish: boolean) {
    if (!user) {
      return;
    }
    setError(null);
    setNotice(null);
    const payload: CreateResourceInput = {
      ...values,
      externalLink: values.externalLink || null,
      language: values.type === "CODING_EXERCISE" ? values.language : null,
      testCases: values.type === "CODING_EXERCISE" ? values.testCases : [],
    };
    try {
      let saved = resource
        ? await updateResource(resource.id, resource.revision, payload)
        : await createResource(payload);
      if (andPublish) {
        const target = scope();
        if (!target) {
          setResource(saved);
          if (!id) {
            navigate(`${base}/${saved.id}/edit`, { replace: true });
          }
          return;
        }
        saved = await publishResource(saved.id, saved.revision, target);
        navigate(`${base}/${saved.id}`);
        return;
      }
      setResource(saved);
      setNotice("Saved.");
      if (!id) {
        navigate(`${base}/${saved.id}/edit`, { replace: true });
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The resource could not be saved.");
    }
  }

  async function archive() {
    if (!resource) {
      return;
    }
    setError(null);
    try {
      await archiveResource(resource.id, resource.revision);
      navigate(base);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The resource could not be archived.");
    }
  }

  async function attach(file: File) {
    if (!resource) {
      setError("Save the draft before attaching a file.");
      return;
    }
    if (!isAllowedResourceFile(file)) {
      setError("Use a PDF, PNG, JPEG, WEBP, or plain text file.");
      return;
    }
    if (file.size > RESOURCE_ATTACHMENT_MAX_BYTES || file.size < 1) {
      setError("Resource files must be 20 MB or smaller.");
      return;
    }
    setError(null);
    try {
      const saved = await uploadResourceFile(resource.id, resource.revision, file);
      setResource(saved);
      setNotice("File attached.");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The file could not be attached.");
    }
  }

  if (!user) {
    return <Spinner />;
  }
  if (!canManage) {
    return (
      <ErrorState
        title="Resources permission is off"
        description="An administrator can turn on the Resources checkbox for your account."
      />
    );
  }
  if (loading) {
    return <Spinner />;
  }
  if (id && error && !resource) {
    return <ErrorState title="Resource unavailable" description={error} />;
  }

  const choices = visibility === "COHORT" ? cohorts : visibility === "MENTOR_GROUP" ? mentors : students;
  const archived = resource?.status === "ARCHIVED";
  const showLink = type === "EXTERNAL_LINK" || type === "VIDEO" || Boolean(form.watch("externalLink"));
  const difficulty = form.watch("difficulty");
  const label = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link to={base} className="text-sm text-muted-foreground hover:text-foreground">
          Library
        </Link>
        {resource ? <p className="text-xs text-muted-foreground">v{resource.version}</p> : null}
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{resource ? "Edit" : "Write"}</h1>
      {archived ? <p className="text-sm text-muted-foreground">Archived.</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      {error && resource ? <p className="text-sm text-destructive">{error}</p> : null}

      <form className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]" onSubmit={form.handleSubmit((values) => persist(values, false))}>
        <div className="space-y-5">
          <label className="block space-y-2">
            <span className={label}>Title</span>
            <Input className="h-12 text-lg" {...form.register("title")} disabled={archived} />
            {form.formState.errors.title ? <span className="text-sm text-destructive">{form.formState.errors.title.message}</span> : null}
          </label>
          <label className="block space-y-2">
            <span className={label}>Description</span>
            <textarea
              className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="The line students see on the shelf"
              {...form.register("description")}
              disabled={archived}
            />
          </label>
          <label className="block space-y-2">
            <span className={label}>Body</span>
            <textarea
              className="min-h-80 w-full rounded-md border border-input bg-background px-3 py-3 text-base leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...form.register("content")}
              disabled={archived}
            />
          </label>

          {type === "CODING_EXERCISE" ? (
            <div className="space-y-3 border-t pt-5">
              <p className={label}>Examples</p>
              <label className="block space-y-2">
                <span className={label}>Language</span>
                <Input
                  value={form.watch("language") ?? ""}
                  disabled={archived}
                  onChange={(event) => form.setValue("language", event.target.value.trim() === "" ? null : event.target.value)}
                />
              </label>
              {tests.fields.map((field, index) => (
                <div key={field.id} className="space-y-2 border-l-2 border-foreground/15 pl-3">
                  <Input placeholder="Name" {...form.register(`testCases.${index}.name`)} disabled={archived} />
                  <textarea
                    className="h-16 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Input"
                    {...form.register(`testCases.${index}.input`)}
                    disabled={archived}
                  />
                  <textarea
                    className="h-16 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Expected output"
                    {...form.register(`testCases.${index}.expectedOutput`)}
                    disabled={archived}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" {...form.register(`testCases.${index}.hidden`)} disabled={archived} />
                      Hidden from students
                    </label>
                    <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => tests.remove(index)} disabled={archived}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="text-sm font-medium underline underline-offset-4"
                disabled={archived}
                onClick={() => tests.append({ name: "", input: "", expectedOutput: "", hidden: false })}
              >
                Add an example
              </button>
            </div>
          ) : null}

          {!archived ? (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit">Save</Button>
              <Button type="button" variant="secondary" onClick={form.handleSubmit((values) => persist(values, true))}>
                Publish
              </Button>
              {resource ? (
                <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => void archive()}>
                  Archive
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20">
          <label className="block space-y-2">
            <span className={label}>Kind</span>
            <select className={fieldClass} {...form.register("type")} disabled={archived}>
              {RESOURCE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {TYPE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-2">
            <p className={label}>Difficulty</p>
            <div className="flex flex-wrap gap-1">
              {DIFFICULTIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={archived}
                  aria-pressed={difficulty === item}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs",
                    difficulty === item ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                  )}
                  onClick={() => form.setValue("difficulty", item)}
                >
                  {DIFFICULTY_LABELS[item]}
                </button>
              ))}
            </div>
          </div>
          <label className="block space-y-2">
            <span className={label}>Topic</span>
            <Input {...form.register("topic")} disabled={archived} />
            {form.formState.errors.topic ? <span className="text-sm text-destructive">{form.formState.errors.topic.message}</span> : null}
          </label>
          <label className="block space-y-2">
            <span className={label}>Minutes</span>
            <Input type="number" min={1} {...form.register("estimatedDurationMin", { valueAsNumber: true })} disabled={archived} />
          </label>
          <label className="block space-y-2">
            <span className={label}>Tags</span>
            <Input
              value={tagText}
              disabled={archived}
              placeholder="arrays, loops"
              onChange={(event) => {
                setTagText(event.target.value);
                form.setValue(
                  "tags",
                  event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                );
              }}
            />
          </label>
          {showLink ? (
            <label className="block space-y-2">
              <span className={label}>Link</span>
              <Input
                value={form.watch("externalLink") ?? ""}
                disabled={archived}
                placeholder="https://"
                onChange={(event) => form.setValue("externalLink", event.target.value.trim() === "" ? null : event.target.value)}
              />
              {form.formState.errors.externalLink ? (
                <span className="text-sm text-destructive">{form.formState.errors.externalLink.message}</span>
              ) : null}
            </label>
          ) : null}

          {!archived ? (
            <div className="space-y-3 border-t pt-5">
              {user.role === "ADMIN" ? (
                <label className="block space-y-2">
                  <span className={label}>Who can read this</span>
                  <select
                    className={fieldClass}
                    value={visibility}
                    onChange={(event) => {
                      setVisibility(event.target.value as Visibility);
                      setSelected([]);
                    }}
                  >
                    {VISIBILITIES.map((item) => (
                      <option key={item} value={item}>
                        {item === "GLOBAL"
                          ? "Everyone"
                          : item === "COHORT"
                            ? "A cohort"
                            : item === "MENTOR_GROUP"
                              ? "A mentor's students"
                              : "Named students"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="flex flex-col gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={audience === "group"} onChange={() => setAudience("group")} />
                    My students
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={audience === "students"} onChange={() => setAudience("students")} />
                    Chosen students
                  </label>
                </div>
              )}
              {(user.role === "MENTOR" ? audience === "students" : visibility !== "GLOBAL") ? (
                <div className="grid max-h-48 gap-2 overflow-y-auto">
                  {choices.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to choose yet.</p> : null}
                  {choices.map((choice) => (
                    <label key={choice.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected.includes(choice.id)} onChange={() => toggle(choice.id)} />
                      {choice.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {resource && !archived ? (
            <div className="space-y-3 border-t pt-5">
              <p className={label}>Files</p>
              <ul className="space-y-1 text-sm">
                {resource.attachments.map((file) => (
                  <li key={file.storageKey}>{file.fileName}</li>
                ))}
              </ul>
              <label className="block text-sm">
                <span className="sr-only">Add a file</span>
                <Input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,.pdf,.png,.jpg,.jpeg,.webp,.txt"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      void attach(file);
                    }
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground">PDF, image, or text. 20 MB.</p>
            </div>
          ) : null}
        </aside>
      </form>
    </section>
  );
}
