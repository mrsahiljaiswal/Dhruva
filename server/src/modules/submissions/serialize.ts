import type { SubmissionRevision } from "@dhruva/shared";
import type { RevisionRecord } from "./repository.js";

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function presentRevision(row: RevisionRecord): SubmissionRevision {
  return {
    id: row.id,
    recipientId: row.recipientId,
    studentId: row.studentId,
    revisionNo: row.revisionNo,
    submissionType: row.submissionType,
    textAnswer: row.textAnswer,
    fileKey: row.fileKey,
    fileName: row.fileName,
    repositoryUrl: row.repositoryUrl,
    editorUrl: row.editorUrl,
    resourceVersion: row.resourceVersion,
    submittedAt: row.submittedAt.toISOString(),
    status: row.status,
    score: row.score,
    rubricScores: row.rubricScores.map((item) => ({ ...item })),
    feedback: row.feedback,
    reviewedBy: row.reviewedBy,
    reviewedAt: iso(row.reviewedAt),
  };
}
