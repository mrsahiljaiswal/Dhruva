import { z, type RefinementCtx } from "zod";

export const ROLES = ["STUDENT", "MENTOR", "ADMIN"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const BRANCHES = [
  "CSE",
  "ISE",
  "CSE_ALLIED",
  "ECE",
  "EEE",
  "EIE",
  "ME",
  "CHE",
  "AE",
  "OTHER",
] as const;
export const branchSchema = z.enum(BRANCHES);
export type Branch = z.infer<typeof branchSchema>;

export const USER_STATUSES = ["INVITED", "ACTIVE", "DEACTIVATED"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const API_PREFIX = "/api/v1";

export const PAGINATION = {
  defaultLimit: 20,
  maxLimit: 100,
} as const;

export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(fieldErrorSchema),
    requestId: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.enum(["ok", "down"]),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const CSRF_HEADER = "x-csrf-token";

export const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128)
  .regex(/[A-Za-z]/, "Password must include a letter.")
  .regex(/[0-9]/, "Password must include a number.");

export const capabilitiesSchema = z.object({
  canCreateResources: z.boolean(),
  canCreateAssessments: z.boolean(),
  canGradeAssessments: z.boolean(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export const publicUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: emailSchema,
  role: roleSchema,
  branch: branchSchema.nullable(),
  cohortId: z.string().nullable(),
  status: userStatusSchema,
  capabilities: capabilitiesSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authUserResponseSchema = z.object({
  data: publicUserSchema,
});

export const csrfResponseSchema = z.object({
  data: z.object({
    csrfToken: z.string().min(1),
  }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const acceptInviteSchema = resetPasswordSchema;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: passwordSchema,
});

export const createUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: emailSchema,
    role: roleSchema,
    branch: branchSchema.optional(),
    cohortId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role === "STUDENT" && !value.branch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branch"],
        message: "Branch is required for a student.",
      });
    }
    if (value.role === "STUDENT" && !value.cohortId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cohortId"],
        message: "Cohort is required for a student.",
      });
    }
  });

export const COHORT_STATUSES = ["UPCOMING", "ACTIVE", "ARCHIVED"] as const;
export const cohortStatusSchema = z.enum(COHORT_STATUSES);
export type CohortStatus = z.infer<typeof cohortStatusSchema>;

export const createCohortSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    academicYear: z.string().trim().min(4).max(20),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date."),
  })
  .strict();

export const cohortSchema = z.object({
  id: z.string(),
  name: z.string(),
  academicYear: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: cohortStatusSchema,
});
export type Cohort = z.infer<typeof cohortSchema>;

export const assignMentorSchema = z
  .object({
    mentorId: z.string().min(1),
    studentIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    branch: branchSchema.nullable().optional(),
    cohortId: z.string().min(1).nullable().optional(),
    capabilities: capabilitiesSchema.optional(),
  })
  .strict();

export const csvImportSchema = z
  .object({
    csv: z.string().min(1).max(500_000),
  })
  .strict();

export const mentorStudentSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: emailSchema,
  branch: branchSchema.nullable(),
  status: userStatusSchema,
});

export const RESOURCE_TYPES = [
  "ARTICLE",
  "VIDEO",
  "PDF",
  "DOCUMENTATION",
  "CODING_EXERCISE",
  "QUIZ",
  "PROJECT",
  "EXTERNAL_LINK",
] as const;
export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const DIFFICULTIES = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export const difficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof difficultySchema>;

export const VISIBILITIES = ["GLOBAL", "COHORT", "MENTOR_GROUP", "INDIVIDUAL"] as const;
export const visibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof visibilitySchema>;

export const RESOURCE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const resourceStatusSchema = z.enum(RESOURCE_STATUSES);
export type ResourceStatus = z.infer<typeof resourceStatusSchema>;

export const RESOURCE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
] as const;
export const resourceMimeTypeSchema = z.enum(RESOURCE_MIME_TYPES);
export type ResourceMimeType = z.infer<typeof resourceMimeTypeSchema>;

export const RESOURCE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const SUBMISSION_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export const httpUrlSchema = z
  .string()
  .trim()
  .url("Use an http or https link.")
  .refine((value) => /^https?:\/\//i.test(value), "Use an http or https link.");

export const testCaseSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    input: z.string().max(20_000),
    expectedOutput: z.string().max(20_000),
    hidden: z.boolean(),
  })
  .strict();
export type TestCase = z.infer<typeof testCaseSchema>;

const resourceWriteFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  type: resourceTypeSchema,
  content: z.string().max(100_000),
  externalLink: httpUrlSchema.nullable(),
  topic: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  difficulty: difficultySchema,
  estimatedDurationMin: z.number().int().min(1).max(1_440),
  language: z.string().trim().min(1).max(40).nullable(),
  testCases: z.array(testCaseSchema).max(50),
};

function refineResourceContent(
  value: {
    type: ResourceType;
    externalLink: string | null;
    language: string | null;
    testCases: TestCase[];
  },
  ctx: RefinementCtx,
): void {
  if (value.type === "EXTERNAL_LINK" && !value.externalLink) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["externalLink"],
      message: "An external link resource needs a link.",
    });
  }
  if (value.type !== "CODING_EXERCISE" && (value.language || value.testCases.length > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["testCases"],
      message: "Language and test cases belong on a coding exercise.",
    });
  }
}

export const createResourceSchema = z.object(resourceWriteFields).strict().superRefine(refineResourceContent);
export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = z
  .object({
    title: resourceWriteFields.title.optional(),
    description: resourceWriteFields.description.optional(),
    type: resourceWriteFields.type.optional(),
    content: resourceWriteFields.content.optional(),
    externalLink: resourceWriteFields.externalLink.optional(),
    topic: resourceWriteFields.topic.optional(),
    tags: resourceWriteFields.tags.optional(),
    difficulty: resourceWriteFields.difficulty.optional(),
    estimatedDurationMin: resourceWriteFields.estimatedDurationMin.optional(),
    language: resourceWriteFields.language.optional(),
    testCases: resourceWriteFields.testCases.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const publishResourceSchema = z
  .object({
    visibility: visibilitySchema,
    targetIds: z.array(z.string().trim().min(1)).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.visibility === "GLOBAL" && value.targetIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetIds"],
        message: "A global resource has no targets.",
      });
    }
    if (value.visibility !== "GLOBAL" && value.targetIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetIds"],
        message: "Choose at least one target.",
      });
    }
  });
export type PublishResourceInput = z.infer<typeof publishResourceSchema>;

export const uploadSlotSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: resourceMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(RESOURCE_ATTACHMENT_MAX_BYTES),
  })
  .strict();
export type UploadSlotInput = z.infer<typeof uploadSlotSchema>;

export const attachFileSchema = z
  .object({
    storageKey: z.string().trim().min(1).max(300),
  })
  .strict();

export const resourceListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    status: resourceStatusSchema.optional(),
    topic: z.string().trim().min(1).max(80).optional(),
    difficulty: difficultySchema.optional(),
    type: resourceTypeSchema.optional(),
    sort: z.enum(["title", "-title", "createdAt", "-createdAt", "updatedAt", "-updatedAt"]).default("-updatedAt"),
  })
  .strict();
export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

export const RESOURCE_LIST_SORTS = ["title", "-title", "createdAt", "-createdAt", "updatedAt", "-updatedAt"] as const;

export const resourceAttachmentSchema = z.object({
  storageKey: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});

export const visibleTestCaseSchema = z.object({
  name: z.string(),
  input: z.string(),
  expectedOutput: z.string().optional(),
  hidden: z.boolean(),
});

export const resourceSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  type: resourceTypeSchema,
  topic: z.string(),
  tags: z.array(z.string()),
  difficulty: difficultySchema,
  estimatedDurationMin: z.number(),
  status: resourceStatusSchema,
  visibility: visibilitySchema.nullable(),
  targetIds: z.array(z.string()),
  version: z.number(),
  revision: z.number(),
  createdBy: z.string(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  attachmentCount: z.number(),
});
export type ResourceSummary = z.infer<typeof resourceSummarySchema>;

export const resourceDetailSchema = resourceSummarySchema.extend({
  content: z.string(),
  externalLink: z.string().nullable(),
  attachments: z.array(resourceAttachmentSchema),
  language: z.string().nullable(),
  testCases: z.array(visibleTestCaseSchema),
});
export type ResourceDetail = z.infer<typeof resourceDetailSchema>;

export const resourceListResponseSchema = z.object({
  data: z.array(resourceSummarySchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

export const resourceResponseSchema = z.object({
  data: resourceDetailSchema,
});

export const uploadSlotResponseSchema = z.object({
  data: z.object({
    storageKey: z.string(),
    uploadUrl: z.string().url(),
    method: z.enum(["PUT", "POST"]),
    headers: z.record(z.string()),
    fields: z.record(z.string()),
    expiresAt: z.string(),
  }),
});
export type UploadSlot = z.infer<typeof uploadSlotResponseSchema>["data"];

export const downloadLinkResponseSchema = z.object({
  data: z.object({
    url: z.string().url(),
    expiresAt: z.string(),
  }),
});

export const DAY_ITEM_KINDS = ["RESOURCE", "ASSIGNMENT", "ASSESSMENT"] as const;
export const dayItemKindSchema = z.enum(DAY_ITEM_KINDS);
export type DayItemKind = z.infer<typeof dayItemKindSchema>;

export const ASSIGNMENT_TARGETS = ["COHORT", "BRANCH", "MENTOR_GROUP", "INDIVIDUAL"] as const;
export const assignmentTargetSchema = z.enum(ASSIGNMENT_TARGETS);
export type AssignmentTarget = z.infer<typeof assignmentTargetSchema>;

export const PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

export const SUBMISSION_TYPES = ["TEXT", "FILE", "REPOSITORY", "EDITOR_LINK", "NONE"] as const;
export const submissionTypeSchema = z.enum(SUBMISSION_TYPES);
export type SubmissionType = z.infer<typeof submissionTypeSchema>;

export const SUBMISSION_STATUSES = ["PENDING", "APPROVED", "REVISION_REQUESTED"] as const;
export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.infer<typeof submissionStatusSchema>;

export const RECIPIENT_STATES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "UNDER_REVIEW",
  "REVISION_REQUESTED",
  "COMPLETED",
] as const;
export const recipientStateSchema = z.enum(RECIPIENT_STATES);
export type RecipientState = z.infer<typeof recipientStateSchema>;

export const SETTLED_RECIPIENT_STATES = ["SUBMITTED", "UNDER_REVIEW", "COMPLETED"] as const;

export const dayItemSchema = z
  .object({
    kind: dayItemKindSchema,
    refId: z.string().trim().min(1).max(80),
    required: z.boolean(),
  })
  .strict();
export type DayItemInput = z.infer<typeof dayItemSchema>;

export const learningDaySchema = z
  .object({
    dayNumber: z.number().int().min(1).max(7),
    title: z.string().trim().min(1).max(200),
    items: z.array(dayItemSchema).max(20),
  })
  .strict();

export const learningWeekSchema = z
  .object({
    weekNumber: z.number().int().min(1).max(52),
    title: z.string().trim().min(1).max(200),
    days: z.array(learningDaySchema).min(1).max(7),
  })
  .strict();

export const learningModuleSchema = z
  .object({
    order: z.number().int().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    weeks: z.array(learningWeekSchema).min(1).max(52),
  })
  .strict();

function rejectDuplicates(
  values: number[],
  path: (string | number)[],
  ctx: RefinementCtx,
  message: string,
): void {
  const seen = new Set<number>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, index], message });
    }
    seen.add(value);
  });
}

export const learningPathWriteSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5_000),
    cohortId: z.string().trim().min(1),
    durationDays: z.number().int().min(1).max(366),
    modules: z.array(learningModuleSchema).min(1).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    rejectDuplicates(
      value.modules.map((module) => module.order),
      ["modules"],
      ctx,
      "Module order must be unique.",
    );
    value.modules.forEach((module, moduleIndex) => {
      rejectDuplicates(
        module.weeks.map((week) => week.weekNumber),
        ["modules", moduleIndex, "weeks"],
        ctx,
        "Week numbers must be unique inside a module.",
      );
      module.weeks.forEach((week, weekIndex) => {
        rejectDuplicates(
          week.days.map((day) => day.dayNumber),
          ["modules", moduleIndex, "weeks", weekIndex, "days"],
          ctx,
          "Day numbers must be unique inside a week.",
        );
      });
    });
  });
export type LearningPathWrite = z.infer<typeof learningPathWriteSchema>;

export const storedDayItemSchema = dayItemSchema.extend({ title: z.string().nullable() });

export const learningPathDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  cohortId: z.string(),
  durationDays: z.number(),
  status: resourceStatusSchema,
  revision: z.number(),
  createdBy: z.string(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  modules: z.array(
    z.object({
      id: z.string(),
      order: z.number(),
      title: z.string(),
      weeks: z.array(
        z.object({
          id: z.string(),
          weekNumber: z.number(),
          title: z.string(),
          days: z.array(
            z.object({
              id: z.string(),
              dayNumber: z.number(),
              title: z.string(),
              items: z.array(storedDayItemSchema),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type LearningPathDetail = z.infer<typeof learningPathDetailSchema>;

export const learningPathSummarySchema = learningPathDetailSchema.omit({ modules: true }).extend({
  moduleCount: z.number(),
});
export type LearningPathSummary = z.infer<typeof learningPathSummarySchema>;

export const rubricCriterionSchema = z
  .object({
    criterion: z.string().trim().min(1).max(200),
    maxPoints: z.number().int().min(0).max(1_000),
  })
  .strict();
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

const assignmentWriteObject = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10_000),
    resourceId: z.string().trim().min(1).nullable(),
    targetType: assignmentTargetSchema,
    targetIds: z.array(z.string().trim().min(1)).min(1).max(500),
    branches: z.array(branchSchema).max(BRANCHES.length),
    dueDate: z.string().datetime(),
    priority: prioritySchema,
    submissionType: submissionTypeSchema,
    language: z.string().trim().min(1).max(40).nullable(),
    testCases: z.array(testCaseSchema).max(50),
    rubric: z.array(rubricCriterionSchema).max(20),
  })
  .strict();

export const createAssignmentSchema = assignmentWriteObject.superRefine((value, ctx) => {
  if (value.targetType === "BRANCH" && value.branches.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branches"],
      message: "Choose at least one branch.",
    });
  }
  if (value.targetType !== "BRANCH" && value.branches.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branches"],
      message: "Branches are only used when the target is a branch.",
    });
  }
});
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = assignmentWriteObject
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const assignmentDefinitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  resourceId: z.string().nullable(),
  assignedBy: z.string(),
  targetType: assignmentTargetSchema,
  targetIds: z.array(z.string()),
  branches: z.array(branchSchema),
  dueDate: z.string(),
  priority: prioritySchema,
  submissionType: submissionTypeSchema,
  language: z.string().nullable(),
  testCases: z.array(visibleTestCaseSchema),
  rubric: z.array(rubricCriterionSchema),
  status: resourceStatusSchema,
  publishedAt: z.string().nullable(),
  revision: z.number(),
  recipientCount: z.number(),
  updatedAt: z.string(),
});
export type AssignmentDefinition = z.infer<typeof assignmentDefinitionSchema>;

export const recipientViewSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  studentId: z.string(),
  state: recipientStateSchema,
  startedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  score: z.number().nullable(),
  overdue: z.boolean(),
  assignment: z.object({
    title: z.string(),
    description: z.string(),
    resourceId: z.string().nullable(),
    dueDate: z.string(),
    priority: prioritySchema,
    submissionType: submissionTypeSchema,
    language: z.string().nullable(),
    testCases: z.array(visibleTestCaseSchema),
    rubric: z.array(rubricCriterionSchema),
    status: resourceStatusSchema,
  }),
});
export type RecipientView = z.infer<typeof recipientViewSchema>;

export const githubRepositorySchema = z
  .string()
  .trim()
  .max(300)
  .url("Use a GitHub repository link.")
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.protocol !== "https:" || url.hostname !== "github.com") {
      return false;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) {
      return false;
    }
    const owner = parts[0] ?? "";
    const name = (parts[1] ?? "").replace(/\.git$/i, "");
    return /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(name);
  }, "Use a GitHub repository link.");

export const editorLinkSchema = httpUrlSchema.refine((value) => value.length <= 2_000, "Use a shorter link.");

export const createSubmissionSchema = z.union([
  z.object({ textAnswer: z.string().trim().min(1).max(100_000) }).strict(),
  z.object({ fileKey: z.string().trim().min(1).max(300) }).strict(),
  z.object({ repositoryUrl: githubRepositorySchema }).strict(),
  z.object({ editorUrl: editorLinkSchema }).strict(),
]);
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const submissionUploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: resourceMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(SUBMISSION_MAX_BYTES),
  })
  .strict();
export type SubmissionUploadInput = z.infer<typeof submissionUploadSchema>;

export const rubricScoreSchema = z
  .object({
    criterion: z.string().trim().min(1).max(200),
    points: z.number().int().min(0).max(1_000),
  })
  .strict();
export type RubricScore = z.infer<typeof rubricScoreSchema>;

export const reviewSubmissionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
    feedback: z.string().trim().min(1).max(10_000),
    score: z.number().min(0).max(1_000).nullable(),
    rubricScores: z.array(rubricScoreSchema).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "APPROVE" && value.score === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["score"], message: "An approval needs a score." });
    }
    if (value.decision === "REQUEST_CHANGES" && value.score !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["score"],
        message: "A score is recorded when the work is approved.",
      });
    }
  });
export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;

export const submissionRevisionSchema = z.object({
  id: z.string(),
  recipientId: z.string(),
  studentId: z.string(),
  revisionNo: z.number().int(),
  submissionType: submissionTypeSchema,
  textAnswer: z.string().nullable(),
  fileKey: z.string().nullable(),
  fileName: z.string().nullable(),
  repositoryUrl: z.string().nullable(),
  editorUrl: z.string().nullable(),
  resourceVersion: z.number().int().nullable(),
  submittedAt: z.string(),
  status: submissionStatusSchema,
  score: z.number().nullable(),
  rubricScores: z.array(z.object({ criterion: z.string(), points: z.number() })),
  feedback: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
});
export type SubmissionRevision = z.infer<typeof submissionRevisionSchema>;

export const submissionResultSchema = z.object({
  revision: submissionRevisionSchema,
  recipient: recipientViewSchema,
});
export type SubmissionResult = z.infer<typeof submissionResultSchema>;

export const planQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.").optional(),
  })
  .strict();

export const planItemSchema = z.object({
  source: z.enum(["PATH", "INDIVIDUAL"]),
  kind: dayItemKindSchema,
  refId: z.string(),
  title: z.string().nullable(),
  required: z.boolean(),
  recipientId: z.string().nullable(),
  state: recipientStateSchema.nullable(),
  overdue: z.boolean(),
});
export type PlanItem = z.infer<typeof planItemSchema>;

export const deadlineSchema = z.object({
  recipientId: z.string(),
  assignmentId: z.string(),
  title: z.string(),
  dueDate: z.string(),
  state: recipientStateSchema,
  overdue: z.boolean(),
  priority: prioritySchema,
});

export const dailyPlanSchema = z.object({
  date: z.string(),
  dayNumber: z.number().nullable(),
  path: z
    .object({
      id: z.string(),
      title: z.string(),
      dayTitle: z.string(),
    })
    .nullable(),
  items: z.array(planItemSchema),
  deadlines: z.array(deadlineSchema),
});
export type DailyPlan = z.infer<typeof dailyPlanSchema>;

export const QUESTION_TYPES = ["MCQ", "MULTI_SELECT", "TRUE_FALSE", "SHORT_ANSWER", "CODING"] as const;
export const questionTypeSchema = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const ATTEMPT_STATUSES = ["IN_PROGRESS", "SUBMITTED", "EXPIRED", "GRADED"] as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

export const questionOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    text: z.string().trim().min(1).max(500),
  })
  .strict();
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const answerKeySchema = z
  .object({
    optionIds: z.array(z.string().trim().min(1).max(40)).max(20),
    text: z.string().trim().max(20_000).nullable(),
  })
  .strict();
export type AnswerKey = z.infer<typeof answerKeySchema>;

const questionWriteObject = z
  .object({
    type: questionTypeSchema,
    prompt: z.string().trim().min(1).max(20_000),
    options: z.array(questionOptionSchema).max(12),
    answerKey: answerKeySchema,
    marks: z.number().min(0).max(1_000),
    topic: z.string().trim().min(1).max(80),
    difficulty: difficultySchema,
    language: z.string().trim().min(1).max(40).nullable(),
    testCases: z.array(testCaseSchema).max(50),
  })
  .strict();

function refineQuestion(
  value: {
    type: QuestionType;
    options: QuestionOption[];
    answerKey: AnswerKey;
    language: string | null;
    testCases: TestCase[];
  },
  ctx: RefinementCtx,
): void {
  const objective = value.type === "MCQ" || value.type === "MULTI_SELECT" || value.type === "TRUE_FALSE";
  const optionIds = new Set(value.options.map((option) => option.id));
  if (optionIds.size !== value.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Option ids must be unique." });
  }
  if (objective) {
    if (value.type === "TRUE_FALSE" && value.options.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "A true or false question needs two options.",
      });
    }
    if (value.type !== "TRUE_FALSE" && value.options.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Add at least two options." });
    }
    if (value.type === "MCQ" || value.type === "TRUE_FALSE") {
      if (value.answerKey.optionIds.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answerKey", "optionIds"],
          message: "Choose one correct option.",
        });
      }
    } else if (value.answerKey.optionIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answerKey", "optionIds"],
        message: "Choose at least one correct option.",
      });
    }
    if (value.answerKey.optionIds.some((id) => !optionIds.has(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answerKey", "optionIds"],
        message: "The correct option must be one of the choices.",
      });
    }
    if (value.language || value.testCases.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["testCases"],
        message: "Language and test cases belong on a coding question.",
      });
    }
  }
  if (value.type === "SHORT_ANSWER" || value.type === "CODING") {
    if (value.options.length > 0 || value.answerKey.optionIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "This question has no options.",
      });
    }
  }
  if (value.type === "SHORT_ANSWER" && (value.language || value.testCases.length > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["testCases"],
      message: "Language and test cases belong on a coding question.",
    });
  }
  if (value.type === "CODING" && !value.language) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["language"], message: "A coding question needs a language." });
  }
}

export const createQuestionSchema = questionWriteObject.superRefine(refineQuestion);
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const questionListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    topic: z.string().trim().min(1).max(80).optional(),
    type: questionTypeSchema.optional(),
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;

export const questionSchema = z.object({
  id: z.string(),
  type: questionTypeSchema,
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  answerKey: answerKeySchema,
  marks: z.number(),
  topic: z.string(),
  difficulty: difficultySchema,
  language: z.string().nullable(),
  testCases: z.array(
    z.object({
      name: z.string(),
      input: z.string(),
      expectedOutput: z.string(),
      hidden: z.boolean(),
    }),
  ),
  createdBy: z.string(),
  updatedAt: z.string(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionListResponseSchema = z.object({
  data: z.array(questionSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

const assessmentWriteObject = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10_000),
    questionIds: z.array(z.string().trim().min(1)).min(1).max(100),
    durationMin: z.number().int().min(1).max(24 * 60),
    passingMarks: z.number().min(0).max(100_000),
    attemptsAllowed: z.number().int().min(1).max(20),
    availableFrom: z.string().datetime(),
    availableUntil: z.string().datetime(),
    answersReleaseAt: z.string().datetime().nullable(),
    targetType: assignmentTargetSchema,
    targetIds: z.array(z.string().trim().min(1)).min(1).max(500),
    branches: z.array(branchSchema).max(BRANCHES.length),
  })
  .strict();

export const createAssessmentSchema = assessmentWriteObject.superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.questionIds.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questionIds", index],
        message: "Each question is included once.",
      });
    }
    seen.add(id);
  });
  if (Date.parse(value.availableUntil) <= Date.parse(value.availableFrom)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["availableUntil"],
      message: "The window must end after it starts.",
    });
  }
  if (value.answersReleaseAt && Date.parse(value.answersReleaseAt) < Date.parse(value.availableFrom)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answersReleaseAt"],
      message: "Answers can release only after the window opens.",
    });
  }
  if (value.targetType === "BRANCH" && value.branches.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["branches"], message: "Choose at least one branch." });
  }
  if (value.targetType !== "BRANCH" && value.branches.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branches"],
      message: "Branches are only used when the target is a branch.",
    });
  }
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

export const attemptSummarySchema = z.object({
  id: z.string(),
  studentId: z.string(),
  studentName: z.string(),
  attemptNo: z.number().int(),
  status: attemptStatusSchema,
  startedAt: z.string(),
  expiresAt: z.string(),
  submittedAt: z.string().nullable(),
  autoScore: z.number().nullable(),
  manualScore: z.number().nullable(),
  totalScore: z.number().nullable(),
  pendingManual: z.boolean(),
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

export const assessmentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  questionIds: z.array(z.string()),
  durationMin: z.number(),
  totalMarks: z.number(),
  passingMarks: z.number(),
  attemptsAllowed: z.number(),
  attemptsUsed: z.number(),
  availableFrom: z.string(),
  availableUntil: z.string(),
  answersReleaseAt: z.string().nullable(),
  targetType: assignmentTargetSchema,
  targetIds: z.array(z.string()),
  branches: z.array(branchSchema),
  status: resourceStatusSchema,
  version: z.number(),
  createdBy: z.string(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  attempts: z.array(attemptSummarySchema),
});
export type AssessmentSummary = z.infer<typeof assessmentSummarySchema>;

export const assessmentListResponseSchema = z.object({
  data: z.array(assessmentSummarySchema),
});

export const attemptQuestionSchema = z.object({
  questionId: z.string(),
  type: questionTypeSchema,
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  marks: z.number(),
  topic: z.string(),
  difficulty: difficultySchema,
  language: z.string().nullable(),
  testCases: z.array(visibleTestCaseSchema),
  answerKey: answerKeySchema.optional(),
});
export type AttemptQuestion = z.infer<typeof attemptQuestionSchema>;

export const answerValueSchema = z.union([z.string().max(100_000), z.array(z.string().trim().min(1).max(80)).max(20)]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

export const saveAnswersSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: z.string().trim().min(1),
            value: answerValueSchema,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type SaveAnswersInput = z.infer<typeof saveAnswersSchema>;

export const gradeAttemptSchema = z
  .object({
    marks: z
      .array(
        z
          .object({
            questionId: z.string().trim().min(1),
            awarded: z.number().min(0).max(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type GradeAttemptInput = z.infer<typeof gradeAttemptSchema>;

export const attemptDetailSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  assessmentTitle: z.string(),
  studentId: z.string(),
  attemptNo: z.number().int(),
  assessmentVersion: z.number().int(),
  questions: z.array(attemptQuestionSchema),
  answers: z.array(
    z.object({
      questionId: z.string(),
      value: answerValueSchema,
      autoSavedAt: z.string(),
    }),
  ),
  startedAt: z.string(),
  expiresAt: z.string(),
  submittedAt: z.string().nullable(),
  status: attemptStatusSchema,
  autoScore: z.number().nullable(),
  manualScore: z.number().nullable(),
  totalScore: z.number().nullable(),
  gradedBy: z.string().nullable(),
  answersReleased: z.boolean(),
  passingMarks: z.number(),
  pendingManual: z.boolean(),
});
export type AttemptDetail = z.infer<typeof attemptDetailSchema>;

export const attemptResponseSchema = z.object({
  data: attemptDetailSchema,
});

export const DISCUSSION_SCOPES = ["RESOURCE", "FORUM"] as const;
export const discussionScopeSchema = z.enum(DISCUSSION_SCOPES);
export type DiscussionScope = z.infer<typeof discussionScopeSchema>;

export const DISCUSSION_CATEGORIES = [
  "PROGRAMMING",
  "MATHEMATICS",
  "DSA",
  "BRANCH",
  "GENERAL",
  "ANNOUNCEMENTS",
] as const;
export const discussionCategorySchema = z.enum(DISCUSSION_CATEGORIES);
export type DiscussionCategory = z.infer<typeof discussionCategorySchema>;

export const DISCUSSION_STATUSES = ["OPEN", "RESOLVED"] as const;
export const discussionStatusSchema = z.enum(DISCUSSION_STATUSES);
export type DiscussionStatus = z.infer<typeof discussionStatusSchema>;

export const DISCUSSION_FILTERS = ["OPEN", "RESOLVED", "UNANSWERED"] as const;
export const discussionFilterSchema = z.enum(DISCUSSION_FILTERS);
export type DiscussionFilter = z.infer<typeof discussionFilterSchema>;

export const REACTION_TARGETS = ["POST", "COMMENT"] as const;
export const reactionTargetSchema = z.enum(REACTION_TARGETS);
export type ReactionTarget = z.infer<typeof reactionTargetSchema>;

export const REACTION_KINDS = ["HELPFUL", "LIKE"] as const;
export const reactionKindSchema = z.enum(REACTION_KINDS);
export type ReactionKind = z.infer<typeof reactionKindSchema>;

export const REPORT_TARGETS = ["POST", "COMMENT", "USER"] as const;
export const reportTargetSchema = z.enum(REPORT_TARGETS);
export type ReportTarget = z.infer<typeof reportTargetSchema>;

export const REPORT_STATUSES = ["OPEN", "DISMISSED", "ACTION_TAKEN"] as const;
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

const discussionText = {
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  codeSnippet: z.string().max(20_000).nullable().optional(),
};

export const createDoubtSchema = z
  .object({
    title: discussionText.title,
    body: discussionText.body,
    codeSnippet: discussionText.codeSnippet,
  })
  .strict();
export type CreateDoubtInput = z.infer<typeof createDoubtSchema>;

export const createForumPostSchema = z
  .object({
    title: discussionText.title,
    body: discussionText.body,
    category: discussionCategorySchema,
    codeSnippet: discussionText.codeSnippet,
  })
  .strict();
export type CreateForumPostInput = z.infer<typeof createForumPostSchema>;

export const createCommentSchema = z
  .object({
    body: discussionText.body,
    parentCommentId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const acceptAnswerSchema = z
  .object({
    commentId: z.string().trim().min(1),
  })
  .strict();
export type AcceptAnswerInput = z.infer<typeof acceptAnswerSchema>;

export const reasonSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type ReasonInput = z.infer<typeof reasonSchema>;

export const createReportSchema = z
  .object({
    targetType: reportTargetSchema,
    targetId: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const reactionWriteSchema = z
  .object({
    targetType: reactionTargetSchema,
    targetId: z.string().trim().min(1).max(80),
    kind: reactionKindSchema,
  })
  .strict();
export type ReactionWrite = z.infer<typeof reactionWriteSchema>;

export const forumListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    category: discussionCategorySchema.optional(),
    status: discussionFilterSchema.optional(),
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type ForumListQuery = z.infer<typeof forumListQuerySchema>;

export const resourcePostQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
    status: discussionFilterSchema.optional(),
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type ResourcePostQuery = z.infer<typeof resourcePostQuerySchema>;

export const discussionPostSchema = z.object({
  id: z.string(),
  scope: discussionScopeSchema,
  resourceId: z.string().nullable(),
  category: discussionCategorySchema.nullable(),
  authorId: z.string(),
  authorName: z.string(),
  title: z.string(),
  body: z.string(),
  codeSnippet: z.string().nullable(),
  status: discussionStatusSchema,
  acceptedCommentId: z.string().nullable(),
  highlighted: z.boolean(),
  replyCount: z.number(),
  helpfulCount: z.number(),
  likeCount: z.number(),
  viewerHelpful: z.boolean(),
  viewerLike: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DiscussionPost = z.infer<typeof discussionPostSchema>;

export const discussionCommentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  parentCommentId: z.string().nullable(),
  authorId: z.string(),
  authorName: z.string(),
  body: z.string(),
  helpfulCount: z.number(),
  likeCount: z.number(),
  viewerHelpful: z.boolean(),
  viewerLike: z.boolean(),
  accepted: z.boolean(),
  createdAt: z.string(),
});
export type DiscussionComment = z.infer<typeof discussionCommentSchema>;

export const discussionThreadSchema = discussionPostSchema.extend({
  comments: z.array(discussionCommentSchema),
});
export type DiscussionThread = z.infer<typeof discussionThreadSchema>;

export const discussionListResponseSchema = z.object({
  data: z.array(discussionPostSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

export const discussionResponseSchema = z.object({
  data: discussionPostSchema,
});

export const discussionThreadResponseSchema = z.object({
  data: discussionThreadSchema,
});

export const reportViewSchema = z.object({
  id: z.string(),
  targetType: reportTargetSchema,
  targetId: z.string(),
  reportedBy: z.string(),
  reason: z.string(),
  status: reportStatusSchema,
  createdAt: z.string(),
});
export type ReportView = z.infer<typeof reportViewSchema>;

export const reportResponseSchema = z.object({
  data: reportViewSchema,
});

export const reactionResultSchema = z.object({
  targetType: reactionTargetSchema,
  targetId: z.string(),
  kind: reactionKindSchema,
  active: z.boolean(),
});
export type ReactionResult = z.infer<typeof reactionResultSchema>;

export const CONVERSATION_TYPES = ["DIRECT", "GROUP"] as const;
export const conversationTypeSchema = z.enum(CONVERSATION_TYPES);
export type ConversationType = z.infer<typeof conversationTypeSchema>;

export const CONVERSATION_PURPOSES = ["MENTORSHIP", "PEER", "GROUP"] as const;
export const conversationPurposeSchema = z.enum(CONVERSATION_PURPOSES);
export type ConversationPurpose = z.infer<typeof conversationPurposeSchema>;

export const NOTIFICATION_TYPES = [
  "ASSIGNMENT_PUBLISHED",
  "DEADLINE_UPCOMING",
  "MENTOR_FEEDBACK",
  "DOUBT_REPLY",
  "DOUBT_ASKED",
  "MESSAGE",
  "ANNOUNCEMENT",
  "MENTOR_REASSIGNED",
  "DISCUSSION_REPORTED",
  "BREAK_GLASS",
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

const participantRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
});

export const conversationSchema = z.object({
  id: z.string(),
  type: conversationTypeSchema,
  purpose: conversationPurposeSchema,
  title: z.string().nullable(),
  participants: z.array(participantRefSchema),
  lastMessageAt: z.string().nullable(),
  unreadCount: z.number().int(),
  writable: z.boolean(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageAttachmentSchema = z.object({
  storageKey: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  body: z.string(),
  attachments: z.array(messageAttachmentSchema),
  sentAt: z.string(),
  readBy: z.array(z.object({ userId: z.string(), readAt: z.string() })),
});
export type ChatMessage = z.infer<typeof messageSchema>;

export const openConversationSchema = z.union([
  z.object({ type: z.literal("DIRECT"), participantId: z.string().trim().min(1).max(80) }).strict(),
  z.object({ type: z.literal("DIRECT"), withMentor: z.literal(true) }).strict(),
  z.object({ type: z.literal("DIRECT"), email: emailSchema }).strict(),
  z
    .object({
      type: z.literal("GROUP"),
      participantIds: z.array(z.string().trim().min(1).max(80)).min(2).max(20),
      title: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("GROUP"),
      emails: z.array(emailSchema).min(2).max(20),
      title: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
]);
export type OpenConversationInput = z.infer<typeof openConversationSchema>;

export const sendMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(5_000),
    attachments: z.array(z.string().trim().min(1).max(300)).max(5).optional(),
  })
  .strict();
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const markReadSchema = z
  .object({
    messageId: z.string().trim().min(1).max(80),
  })
  .strict();
export type MarkReadInput = z.infer<typeof markReadSchema>;

export const messageListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
  })
  .strict();
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

export const conversationListResponseSchema = z.object({
  data: z.array(conversationSchema),
});

export const conversationResponseSchema = z.object({
  data: conversationSchema,
});

export const messageListResponseSchema = z.object({
  data: z.array(messageSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
});

export const messageResponseSchema = z.object({
  data: messageSchema,
});

export const notificationSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  text: z.string(),
  payload: z.record(z.string()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  data: z.array(notificationSchema),
  unread: z.number().int().default(0),
});

export const notificationPreferencesSchema = z.object({
  email: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const notificationPreferencesResponseSchema = z.object({
  data: notificationPreferencesSchema,
});

export const updateNotificationPreferencesSchema = notificationPreferencesSchema.strict();

export const messagingFeaturesSchema = z.object({
  studentDirectMessages: z.boolean(),
  groupChat: z.boolean(),
});
export type MessagingFeatures = z.infer<typeof messagingFeaturesSchema>;

export const messagingFeaturesResponseSchema = z.object({
  data: messagingFeaturesSchema,
});

export const DEFAULT_SUPPORT_THRESHOLDS = {
  attentionCompletionPct: 70,
  interventionCompletionPct: 40,
  attentionAverageScore: 60,
  interventionAverageScore: 40,
  attentionOverdueCount: 1,
  interventionOverdueCount: 3,
  inactiveDays: 7,
} as const;

export const supportThresholdsSchema = z
  .object({
    attentionCompletionPct: z.number().min(0).max(100),
    interventionCompletionPct: z.number().min(0).max(100),
    attentionAverageScore: z.number().min(0).max(100),
    interventionAverageScore: z.number().min(0).max(100),
    attentionOverdueCount: z.number().int().min(0).max(1000),
    interventionOverdueCount: z.number().int().min(0).max(1000),
    inactiveDays: z.number().int().min(1).max(365),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.interventionCompletionPct > value.attentionCompletionPct) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interventionCompletionPct"],
        message: "The intervention completion threshold cannot be higher than the attention threshold.",
      });
    }
    if (value.interventionAverageScore > value.attentionAverageScore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interventionAverageScore"],
        message: "The intervention score threshold cannot be higher than the attention threshold.",
      });
    }
    if (value.interventionOverdueCount < value.attentionOverdueCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interventionOverdueCount"],
        message: "The intervention overdue count cannot be lower than the attention count.",
      });
    }
  });
export type SupportThresholds = z.infer<typeof supportThresholdsSchema>;

export const platformSettingsSchema = messagingFeaturesSchema.extend({
  supportThresholds: supportThresholdsSchema,
  version: z.number().int(),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const platformSettingsResponseSchema = z.object({
  data: platformSettingsSchema,
});

export const updatePlatformSettingsSchema = z
  .object({
    studentDirectMessages: z.boolean().optional(),
    groupChat: z.boolean().optional(),
    supportThresholds: supportThresholdsSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.studentDirectMessages !== undefined || value.groupChat !== undefined || value.supportThresholds !== undefined,
    { message: "Change at least one setting." },
  );
export type UpdatePlatformSettingsInput = z.infer<typeof updatePlatformSettingsSchema>;

export const LEARNING_EVENT_TYPES = [
  "RESOURCE_OPENED",
  "ASSIGNMENT_STARTED",
  "SUBMISSION_MADE",
  "ATTEMPT_STARTED",
  "ATTEMPT_GRADED",
  "DOUBT_ASKED",
] as const;
export const learningEventTypeSchema = z.enum(LEARNING_EVENT_TYPES);
export type LearningEventType = z.infer<typeof learningEventTypeSchema>;

export const SUPPORT_INDICATORS = ["ON_TRACK", "NEEDS_ATTENTION", "MENTOR_INTERVENTION"] as const;
export const supportIndicatorSchema = z.enum(SUPPORT_INDICATORS);
export type SupportIndicator = z.infer<typeof supportIndicatorSchema>;

export const SUPPORT_INDICATOR_NOTE =
  "Support indicator. It does not block the student or change a grade.";

export const topicProgressSchema = z.object({
  topic: z.string(),
  assignedCount: z.number().int(),
  completedCount: z.number().int(),
  completionPct: z.number().nullable(),
  averageScore: z.number().nullable(),
});
export type TopicProgress = z.infer<typeof topicProgressSchema>;

export const feedbackSnippetSchema = z.object({
  assignmentTitle: z.string(),
  feedback: z.string(),
  reviewedAt: z.string(),
  score: z.number().nullable(),
});
export type FeedbackSnippet = z.infer<typeof feedbackSnippetSchema>;

export const activityDaySchema = z.object({
  date: z.string(),
  active: z.boolean(),
});

export const learningActivitySchema = z.object({
  type: learningEventTypeSchema,
  refType: z.string(),
  refId: z.string(),
  occurredAt: z.string(),
});
export type LearningActivity = z.infer<typeof learningActivitySchema>;

export const studentProgressSchema = z.object({
  studentId: z.string(),
  assignedCount: z.number().int(),
  completedCount: z.number().int(),
  pendingCount: z.number().int(),
  overdueCount: z.number().int(),
  completionPct: z.number().nullable(),
  averageScore: z.number().nullable(),
  topicScores: z.array(topicProgressSchema),
  weeklyActiveDays: z.number().int(),
  week: z.array(activityDaySchema),
  recentFeedback: z.array(feedbackSnippetSchema),
  activity: z.array(learningActivitySchema),
  computedAt: z.string(),
});
export type StudentProgressView = z.infer<typeof studentProgressSchema>;

export const studentProgressResponseSchema = z.object({
  data: studentProgressSchema,
});

export const supportedProgressSchema = studentProgressSchema.extend({
  supportIndicator: supportIndicatorSchema,
  supportReasons: z.array(z.string()),
  thresholds: supportThresholdsSchema,
  supportNote: z.string(),
});
export type SupportedProgress = z.infer<typeof supportedProgressSchema>;

export const supportedProgressResponseSchema = z.object({
  data: supportedProgressSchema,
});

export const mentorStudentProgressSchema = z.object({
  id: z.string(),
  name: z.string(),
  branch: branchSchema.nullable(),
  completionPct: z.number().nullable(),
  averageScore: z.number().nullable(),
  pendingCount: z.number().int(),
  overdueCount: z.number().int(),
  supportIndicator: supportIndicatorSchema,
  supportReasons: z.array(z.string()),
});

export const assessmentTrendSchema = z.object({
  week: z.string(),
  averagePct: z.number().nullable(),
  attempts: z.number().int(),
});

export const mentorAnalyticsSchema = z.object({
  assignedStudents: z.number().int(),
  completionPct: z.number().nullable(),
  pendingSubmissions: z.number().int(),
  unansweredDoubts: z.number().int(),
  needingSupport: z.number().int(),
  assessmentTrends: z.array(assessmentTrendSchema),
  students: z.array(mentorStudentProgressSchema),
  thresholds: supportThresholdsSchema,
  supportNote: z.string(),
});
export type MentorAnalytics = z.infer<typeof mentorAnalyticsSchema>;

export const mentorAnalyticsResponseSchema = z.object({
  data: mentorAnalyticsSchema,
});

export const adminAnalyticsSchema = z.object({
  totals: z.object({
    users: z.number().int(),
    students: z.number().int(),
    mentors: z.number().int(),
    admins: z.number().int(),
    activeUsers: z.number().int(),
    cohorts: z.number().int(),
    publishedResources: z.number().int(),
    publishedAssignments: z.number().int(),
    publishedAssessments: z.number().int(),
  }),
  mentorWorkload: z.array(
    z.object({
      mentorId: z.string(),
      name: z.string(),
      students: z.number().int(),
      pendingSubmissions: z.number().int(),
      needingSupport: z.number().int(),
    }),
  ),
  cohorts: z.array(
    z.object({
      cohortId: z.string(),
      name: z.string(),
      students: z.number().int(),
      completionPct: z.number().nullable(),
      averageScore: z.number().nullable(),
      needingSupport: z.number().int(),
    }),
  ),
  branches: z.array(
    z.object({
      branch: branchSchema,
      students: z.number().int(),
      completionPct: z.number().nullable(),
      averageScore: z.number().nullable(),
      needingSupport: z.number().int(),
    }),
  ),
  topics: z.array(
    z.object({
      topic: z.string(),
      students: z.number().int(),
      completionPct: z.number().nullable(),
      averageScore: z.number().nullable(),
    }),
  ),
  assessments: z.array(
    z.object({
      assessmentId: z.string(),
      title: z.string(),
      attempts: z.number().int(),
      averagePct: z.number().nullable(),
      passRate: z.number().nullable(),
    }),
  ),
  resourceCompletion: z.object({
    published: z.number().int(),
    opened: z.number().int(),
    completionPct: z.number().nullable(),
  }),
  flagged: z.array(
    z.object({
      studentId: z.string(),
      name: z.string(),
      branch: branchSchema.nullable(),
      cohortId: z.string().nullable(),
      supportIndicator: supportIndicatorSchema,
      supportReasons: z.array(z.string()),
    }),
  ),
  thresholds: supportThresholdsSchema,
  supportNote: z.string(),
});
export type AdminAnalytics = z.infer<typeof adminAnalyticsSchema>;

export const adminAnalyticsResponseSchema = z.object({
  data: adminAnalyticsSchema,
});

export const EXPORT_KINDS = ["STUDENT_PROGRESS", "MENTOR_ALLOCATION", "ASSESSMENTS", "COHORT_PERFORMANCE"] as const;
export const exportKindSchema = z.enum(EXPORT_KINDS);
export type ExportKind = z.infer<typeof exportKindSchema>;

export const EXPORT_STATUSES = ["PENDING", "READY", "FAILED"] as const;
export const exportStatusSchema = z.enum(EXPORT_STATUSES);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

export const createExportSchema = z
  .object({
    kind: exportKindSchema,
    cohortId: z.string().trim().min(1).optional(),
  })
  .strict();
export type CreateExportInput = z.infer<typeof createExportSchema>;

export const exportJobSchema = z.object({
  id: z.string(),
  kind: exportKindSchema,
  status: exportStatusSchema,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  downloadExpiresAt: z.string().nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export const exportJobResponseSchema = z.object({
  data: exportJobSchema,
});

export const socketJoinSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(80),
  })
  .strict();

export const socketSendSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(5_000),
  })
  .strict();

export const errorCodes = {
  validation: "VALIDATION_ERROR",
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  accountInactive: "ACCOUNT_INACTIVE",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  invalidState: "INVALID_STATE",
  unprocessable: "UNPROCESSABLE",
  rateLimited: "RATE_LIMITED",
  internal: "INTERNAL",
} as const;
