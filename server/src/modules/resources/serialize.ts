import type { ResourceViewer } from "./access.js";
import type { ResourceRecord, ResourceTestCase } from "./repository.js";

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function visibleTests(cases: ResourceTestCase[], reveal: boolean) {
  if (reveal) {
    return cases;
  }
  return cases.filter((item) => !item.hidden).map((item) => ({ name: item.name, input: item.input, hidden: false }));
}

export function summarizeResource(resource: ResourceRecord, viewer: ResourceViewer) {
  const manage = viewer.role === "ADMIN" || viewer.id === resource.createdBy;
  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    type: resource.type,
    topic: resource.topic,
    tags: resource.tags,
    difficulty: resource.difficulty,
    estimatedDurationMin: resource.estimatedDurationMin,
    status: resource.status,
    visibility: resource.visibility,
    targetIds: manage ? resource.targetIds : [],
    version: resource.version,
    revision: resource.revision,
    createdBy: resource.createdBy,
    publishedAt: iso(resource.publishedAt),
    updatedAt: resource.updatedAt.toISOString(),
    attachmentCount: resource.attachments.length,
  };
}

export function presentResource(resource: ResourceRecord, viewer: ResourceViewer) {
  const reveal = viewer.role === "ADMIN" || viewer.id === resource.createdBy;
  return {
    ...summarizeResource(resource, viewer),
    content: resource.content,
    externalLink: resource.externalLink,
    attachments: resource.attachments,
    language: resource.language,
    testCases: resource.type === "CODING_EXERCISE" ? visibleTests(resource.testCases, reveal) : [],
  };
}
