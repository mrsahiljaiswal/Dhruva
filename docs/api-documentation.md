# DHRUVA — API Documentation

Base URL: `/api/v1`. All endpoints speak JSON except the CSV upload, which is multipart.
Authentication is the session cookie described in `reliability-and-security.md`. Unless noted,
every endpoint requires an authenticated, active user and is authorized per `permissions.md`.

Request and response bodies are defined as Zod schemas in `packages/shared`, which is the
source of truth. This document describes the endpoints, the conventions, and the non-obvious
behaviour; field-level detail lives with the schemas so it cannot drift.

## 1. Conventions

### 1.1 Errors

Every error uses one envelope:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this student.",
    "details": [],
    "requestId": "8f3c..."
  }
}
```

`details` carries field errors for validation failures, as
`[{ "path": "email", "message": "..." }]`, and is empty otherwise.

| HTTP | code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body, query, or params fail the Zod schema |
| 401 | `UNAUTHENTICATED` | No session or an expired session |
| 403 | `FORBIDDEN` | Authenticated but not permitted. Also used when the caller must not learn whether the target exists |
| 403 | `ACCOUNT_INACTIVE` | The account is deactivated |
| 404 | `NOT_FOUND` | Missing, and the caller would have been allowed to see it |
| 409 | `CONFLICT` | Optimistic-concurrency clash, duplicate, or idempotency key reused with a different body |
| 409 | `INVALID_STATE` | A state transition the state machine does not allow |
| 422 | `UNPROCESSABLE` | Well-formed but rejected by a business rule, e.g. attempts exhausted |
| 429 | `RATE_LIMITED` | A rate limit applied. `Retry-After` is set |
| 500 | `INTERNAL` | Unexpected. The detail is logged, not returned |

### 1.2 Pagination

List endpoints accept `page` (default 1) and `limit` (default 20, max 100) and return:

```json
{ "data": [], "page": 1, "limit": 20, "total": 137 }
```

Sorting accepts `sort` as a field name from a per-endpoint allowlist, with a leading `-` for
descending. Unknown sort fields are a validation error, not a silent default.

### 1.3 Filtering

Filters are query parameters validated by the endpoint's schema: `status`, `cohortId`,
`branch`, `topic`, `difficulty`, `category`, `from`, `to`. A filter the schema does not list
is rejected, so clients cannot pass arbitrary query fragments.

### 1.4 Optimistic concurrency

Mutable resources return an `ETag` header derived from the document's version key. An update
request sends it back as `If-Match`. A mismatch returns `409 CONFLICT` and the client
refetches. This covers assignment definitions, resources, assessments, and platform settings.

### 1.5 Idempotency

`POST` endpoints that create submissions, finalize assessment attempts, or commit a CSV
import require an `Idempotency-Key` header, a client-generated UUID. The first request
executes and stores its response against the key. A retry with the same key and same body
returns the stored response with the original status. The same key with a different body
returns `409 CONFLICT`. Keys are scoped per user and kept for 24 hours.

### 1.6 Timestamps and ids

Timestamps are ISO 8601 in UTC. Ids are 24-character hex strings; anything else is a 400 at
the boundary.

## 2. Auth

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Email and password. Sets the session cookie and rotates the session id. Rate limited |
| POST | `/auth/logout` | Destroys the session |
| GET | `/auth/me` | The current user, including role and capability flags |
| POST | `/auth/change-password` | Requires the current password. Revokes other sessions |
| POST | `/auth/forgot-password` | Always returns 202, whether or not the email exists |
| POST | `/auth/reset-password` | Consumes a reset token and sets a new password |
| POST | `/auth/accept-invite` | Consumes an invite token, sets the password, activates the account |

`/auth/forgot-password` returns the same response for known and unknown emails so it cannot
be used to enumerate accounts.

## 3. Users and cohorts

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/users` | List users, filterable by role, status, branch, cohort | Admin |
| POST | `/users` | Create one user. Sends an invite. No password field is accepted | Admin |
| GET | `/users/:id` | User detail | Admin, or a mentor for an assigned student, or the user themselves |
| PATCH | `/users/:id` | Edit name, branch, cohort, capability flags | Admin |
| POST | `/users/:id/deactivate` | Deactivate and revoke sessions | Admin |
| POST | `/users/:id/reactivate` | Reactivate. Requires a new invite | Admin |
| POST | `/users/:id/reinvite` | Reissue the set-password invite | Admin |
| POST | `/users/import` | Upload a CSV. Returns a preview id and the row-level validation report | Admin |
| POST | `/users/import/:previewId/commit` | Commit a validated preview. Idempotent | Admin |
| GET | `/cohorts` | List cohorts | Any authenticated user |
| POST | `/cohorts` | Create a cohort | Admin |
| PATCH | `/cohorts/:id` | Edit or archive a cohort | Admin |

The CSV commit is transactional: all valid rows are created or none are. Rows that failed
validation in the preview are excluded, and the response lists the created count and the
skipped rows.

## 4. Mentor allocation

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/mentors/:id/students` | Active students of a mentor, with progress summaries | That mentor, or Admin |
| GET | `/mentors/:id/workload` | Counts: students, pending reviews, overdue | That mentor, or Admin |
| POST | `/mentor-assignments` | Assign students. Body: `mentorId`, `studentIds` | Admin |
| POST | `/mentor-assignments/reassign` | Move students to another mentor. Transactional | Admin |
| GET | `/students/:id/mentor-history` | Full assignment history | Admin |

## 5. Resources

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/resources` | List resources visible to the caller | Per `ResourceAccessService` |
| POST | `/resources` | Create a draft | Admin, mentor with `canCreateResources` |
| GET | `/resources/:id` | Detail | If visible |
| PATCH | `/resources/:id` | Edit. Increments `version` when published. Requires `If-Match` | Author or Admin |
| POST | `/resources/:id/publish` | Publish with a visibility scope and targets | Admin; a mentor only to their own group or own students |
| POST | `/resources/:id/archive` | Archive | Author or Admin |
| POST | `/uploads` | Body: file name, mime type, size. Returns a presigned upload URL and a storage key | Anyone who can create resources |
| POST | `/resources/:id/attachments` | Attach a previously uploaded storage key, after the server confirms the object exists | Author or Admin |

`GET /resources` applies the caller's visibility on the server, so the list and the detail
endpoint can never disagree. A student requesting an id they cannot see gets 403, not 404.

## 6. Learning paths and assignments

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/learning-paths` | List paths | Admin, and mentors |
| POST | `/learning-paths` | Create a path with its modules, weeks, and days | Admin |
| PATCH | `/learning-paths/:id` | Edit structure | Admin |
| POST | `/learning-paths/:id/publish` | Publish to its cohort | Admin |
| GET | `/me/plan` | The caller's plan for a date (default today) | Student |
| GET | `/assignments` | List assignment definitions | Admin, and mentors for their own |
| POST | `/assignments` | Create a draft | Admin, or a mentor targeting only assigned students |
| PATCH | `/assignments/:id` | Edit a draft. Requires `If-Match` | Author or Admin |
| POST | `/assignments/:id/publish` | Publish. Creates one recipient per targeted student, transactionally | Author or Admin |
| GET | `/me/assignments` | The caller's recipient records, with computed `overdue` | Student |
| GET | `/students/:id/assignments` | A student's recipients | Assigned mentor or Admin |

The recipient payload includes `overdue: true | false`, computed at read time from the due
date and the state. Clients display it and never send it back.

## 7. Submissions

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| POST | `/recipients/:id/submissions` | Submit a revision. Requires `Idempotency-Key` | The owning student, and only from a submittable state |
| GET | `/recipients/:id/submissions` | Revision history | Owner, assigned mentor, Admin |
| POST | `/submissions/:id/review` | Approve or request revision, with feedback, score, and rubric | Assigned mentor or Admin |

A submission from a state the state machine does not allow returns `409 INVALID_STATE`.
Reviewing moves the recipient to `COMPLETED` or `REVISION_REQUESTED` accordingly.

## 8. Assessments

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/questions` | Search the question bank | Admin, mentor with `canCreateAssessments` |
| POST | `/questions` | Add a question | Admin, mentor with the flag |
| PATCH | `/questions/:id` | Edit. Does not affect attempts already started | Author or Admin |
| GET | `/assessments` | List. Students see only published assessments targeted at them | Per role |
| POST | `/assessments` | Create | Admin, mentor with the flag |
| PATCH | `/assessments/:id` | Edit. Requires `If-Match`, increments `version` | Author or Admin |
| POST | `/assessments/:id/publish` | Publish to a target | Admin |
| POST | `/assessments/:id/attempts` | Start an attempt. Server sets `startedAt` and `expiresAt` and snapshots the questions | Targeted student, within window and attempt limit |
| PATCH | `/attempts/:id/answers` | Autosave answers | The sitting student, while `IN_PROGRESS` and before `expiresAt` |
| POST | `/attempts/:id/submit` | Finalize. Requires `Idempotency-Key`. Auto-grades objective questions | The sitting student |
| GET | `/attempts/:id` | Attempt with score. Answer keys included only after `answersReleaseAt` | Owner, assigned mentor, Admin |
| POST | `/attempts/:id/grade` | Record manual marks for short-answer and coding questions | Mentor with `canGradeAssessments` for that student, or Admin |

Starting an attempt beyond `attemptsAllowed`, or outside the window, returns
`422 UNPROCESSABLE`. Two concurrent starts cannot both succeed, because the attempt number
is unique per student per assessment. Autosave after `expiresAt` is rejected and the attempt
is finalized with what was already saved.

Payloads for students never contain `answerKey`, `testCases` expected outputs, or another
student's data. This is enforced in the serializer, and there is a test that fails if such a
field appears.

## 9. Discussions

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/resources/:id/posts` | Doubts on a resource | Anyone who can see the resource |
| POST | `/resources/:id/posts` | Ask a doubt | Same |
| GET | `/forum/posts` | Forum listing, filterable by category and status, with `q` for text search | Any authenticated user |
| POST | `/forum/posts` | New forum post | Any authenticated user |
| GET | `/posts/:id` | Post with comments | Per its scope |
| POST | `/posts/:id/comments` | Comment or reply | Anyone who can read it |
| POST | `/posts/:id/accept` | Mark the accepted answer | Post author, a mentor, or Admin |
| POST | `/posts/:id/resolve` | Mark resolved | Mentor or Admin |
| POST | `/posts/:id/highlight` | Highlight | Mentor or Admin |
| POST | `/reactions` | Add or remove a reaction | Any authenticated user |
| POST | `/reports` | Report a post, comment, message, or user | Any authenticated user |

`q` runs against the text index and is length-capped by validation.

## 10. Messaging and notifications

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/conversations` | The caller's conversations, most recent first | Participant |
| POST | `/conversations` | Open a conversation. Rejected if policy does not allow that pair or group chat is disabled | Per `permissions.md` |
| GET | `/conversations/:id/messages` | Messages, paginated, newest page first | Participant, or Admin via break-glass |
| POST | `/conversations/:id/messages` | Send. Persisted, then pushed | Participant |
| POST | `/conversations/:id/read` | Mark read up to a message id | Participant |
| POST | `/conversations/:id/break-glass` | Admin reads a private conversation. Body requires `reason` | Admin |
| GET | `/notifications` | The caller's notifications | Owner |
| POST | `/notifications/:id/read` | Mark read | Owner |
| POST | `/notifications/read-all` | Mark all read | Owner |

The break-glass endpoint writes a `security.break_glass` audit entry containing the reason
and notifies a second admin. It is the only path through which a non-participant receives
message content.

## 11. Announcements, moderation, settings

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/announcements` | Announcements visible to the caller and currently published | Any authenticated user |
| POST | `/announcements` | Create, optionally scheduled | Admin |
| PATCH | `/announcements/:id` | Edit or expire early | Admin |
| GET | `/reports` | Open and recent reports | Admin |
| POST | `/reports/:id/resolve` | Dismiss, hide, warn, or suspend. Body: `action`, `note` | Admin |
| GET | `/settings` | Platform settings | Admin |
| PATCH | `/settings` | Update flags and thresholds. Requires `If-Match` | Admin |

Resolving a report always writes an audit entry with the action and the note. Suspending a
user deactivates the account through the same path as `/users/:id/deactivate`.

## 12. Analytics and exports

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/me/progress` | Own progress projection | Student |
| GET | `/students/:id/progress` | A student's progress | Assigned mentor or Admin |
| GET | `/analytics/mentor` | The mentor dashboard figures | Mentor, scoped to assigned students |
| GET | `/analytics/overview` | Platform dashboard figures | Admin |
| POST | `/exports` | Request an export. Returns a job id | Admin |
| GET | `/exports/:id` | Job status and, when ready, a short-lived download URL | The requesting admin |

Dashboard numbers come from the `StudentProgress` projection plus live counts. They are
labelled as such and can be at most a day behind the nightly rebuild. Support indicators are
returned with their threshold values so the interface can show why a student was flagged.

## 13. Audit

| Method | Path | Purpose | Access |
| --- | --- | --- | --- |
| GET | `/audit` | Query by actor, action, subject, or date range | Admin |
| GET | `/audit/:subjectType/:subjectId` | History of one record | Admin |

There is intentionally no endpoint that modifies the audit log.

## 14. Health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | None | Liveness. Returns 200 while the process is up |
| GET | `/ready` | None | Readiness. Checks the database connection and returns 503 when it is down |

Neither endpoint returns dependency details beyond up or down.

## 15. Socket.IO events

Connection: same origin, authenticated by the session cookie during the handshake. An
unauthenticated or inactive user is rejected at the handshake and never joins a room.

Client → server:

| Event | Payload | Behaviour |
| --- | --- | --- |
| `conversation.join` | `conversationId` | Joins the room if the caller is a participant. Otherwise rejected and audited |
| `conversation.typing` | `conversationId` | Relayed to the room |
| `message.send` | `conversationId`, `body` | Same authorization and persistence path as the HTTP send |
| `notification.subscribe` | none | Joins the caller's own notification room |

Server → client:

| Event | When |
| --- | --- |
| `message.new` | A message was persisted in a conversation the client joined |
| `message.read` | Another participant read the conversation |
| `typing` | Another participant is typing |
| `notification.new` | The user has a new notification |
| `attempt.expiring` | The caller's attempt is within five minutes of `expiresAt` |

The server emits `message.new` only after the database write commits. A client that misses an
event sees the correct state on its next fetch, because the database, not the socket, is the
source of truth. Clients treat socket payloads as hints to refetch, not as authoritative data.
