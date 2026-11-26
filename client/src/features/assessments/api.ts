import {
  API_PREFIX,
  CSRF_HEADER,
  assessmentListResponseSchema,
  assessmentSummarySchema,
  attemptDetailSchema,
  questionListResponseSchema,
  questionSchema,
  type AssessmentSummary,
  type AttemptDetail,
  type CreateAssessmentInput,
  type CreateQuestionInput,
  type GradeAttemptInput,
  type Question,
  type SaveAnswersInput,
} from "@dhruva/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | null {
  const row = document.cookie.split("; ").find((part) => part.startsWith("dhruva.csrf="));
  if (!row) {
    return null;
  }
  return decodeURIComponent(row.slice("dhruva.csrf=".length));
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  const method = (init.method ?? "GET").toUpperCase();
  const token = csrfToken();
  if (method !== "GET" && method !== "HEAD" && token) {
    headers.set(CSRF_HEADER, token);
  }
  const response = await fetch(`${API_PREFIX}${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: { message?: unknown } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : "Request failed.";
    throw new ApiError(message, response.status);
  }
  return response;
}

export async function listQuestions(): Promise<Question[]> {
  const response = await request("/questions");
  return questionListResponseSchema.parse(await response.json()).data;
}

export async function createQuestion(input: CreateQuestionInput): Promise<Question> {
  const response = await request("/questions", { method: "POST", body: JSON.stringify(input) });
  return questionSchema.parse((await response.json()).data);
}

export async function listAssessments(): Promise<AssessmentSummary[]> {
  const response = await request("/assessments");
  return assessmentListResponseSchema.parse(await response.json()).data;
}

export async function createAssessment(input: CreateAssessmentInput): Promise<AssessmentSummary> {
  const response = await request("/assessments", { method: "POST", body: JSON.stringify(input) });
  return assessmentSummarySchema.parse((await response.json()).data);
}

export async function publishAssessment(id: string, version: number): Promise<AssessmentSummary> {
  const response = await request(`/assessments/${id}/publish`, {
    method: "POST",
    headers: { "if-match": `"${version}"` },
  });
  return assessmentSummarySchema.parse((await response.json()).data);
}

export async function startAttempt(assessmentId: string): Promise<AttemptDetail> {
  const response = await request(`/assessments/${assessmentId}/attempts`, { method: "POST" });
  return attemptDetailSchema.parse((await response.json()).data);
}

export async function getAttempt(id: string): Promise<AttemptDetail> {
  const response = await request(`/attempts/${id}`);
  return attemptDetailSchema.parse((await response.json()).data);
}

export async function saveAnswers(id: string, answers: SaveAnswersInput["answers"]): Promise<AttemptDetail> {
  const response = await request(`/attempts/${id}/answers`, { method: "PATCH", body: JSON.stringify({ answers }) });
  return attemptDetailSchema.parse((await response.json()).data);
}

export async function submitAttempt(id: string): Promise<AttemptDetail> {
  const response = await request(`/attempts/${id}/submit`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  return attemptDetailSchema.parse((await response.json()).data);
}

export async function gradeAttempt(id: string, marks: GradeAttemptInput["marks"]): Promise<AttemptDetail> {
  const response = await request(`/attempts/${id}/grade`, { method: "POST", body: JSON.stringify({ marks }) });
  return attemptDetailSchema.parse((await response.json()).data);
}
