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
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

const httpUrlSchema = z
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
