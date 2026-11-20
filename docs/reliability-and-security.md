# DHRUVA — Reliability and Security

The controls that keep the platform safe and recoverable. This document is the reference for
the security testing in Phase 12 and for the operational runbooks in `deployment.md`.

Sizing assumption throughout: one college, about 1,000 students and 50 mentors, one Node
process per environment.

## 1. Sessions and authentication

- Passwords are hashed with bcrypt (cost factor 12) and the hash is never included in any
  query by default.
- Sessions use `express-session` with the connect-mongo store in MongoDB. The cookie is
  `HttpOnly`, `Secure`, and `SameSite=Lax`, with a 7-day idle expiry and a 30-day absolute
  expiry.
- The session id is regenerated on login, so a session fixed before login cannot be reused.
- Changing a password destroys every session for that user. Deactivating a user does the same,
  immediately, so a suspended account cannot keep using an existing cookie.
- Account status is checked on every authenticated request, not only at login. A deactivated
  user receives `403 ACCOUNT_INACTIVE`.
- Invite and reset tokens are single use, stored only as hashes, and expire (7 days for an
  invite, 1 hour for a reset).

### 1.1 CSRF

Cookie-authenticated requests need CSRF protection. DHRUVA uses the double-submit cookie
pattern: the server sets a non-HttpOnly CSRF cookie, the client echoes it in a header on
every state-changing request, and the server rejects the request when the two differ.
`GET`, `HEAD`, and `OPTIONS` are not checked. Socket connections are covered separately by
the handshake authentication and the `SameSite` cookie.

### 1.2 Rate limiting

Limits are per IP and per account where an account is known, and a breach returns
`429 RATE_LIMITED` with a `Retry-After` header.

| Route group | Limit | Why |
| --- | --- | --- |
| Login | 10 per 15 min per IP and per email | Credential stuffing |
| Forgot / reset password | 5 per hour per IP | Account enumeration and email flooding |
| Accept invite | 10 per hour per IP | Token guessing |
| Submissions | 30 per hour per student | Accidental or scripted flooding |
| Messages | 60 per 5 min per user | Spam |
| Reports | 20 per hour per user | Report abuse |
| Everything else | 300 per min per IP | Baseline protection |

The limits are configuration, not code constants, so they can be tightened without a release.

## 2. Request hardening

- `helmet` sets the standard security headers, with a content security policy restricting
  script sources to the application's own origin.
- CORS allows only the configured frontend origin. There is no wildcard and credentials are
  allowed only for that origin.
- Every input is validated by a Zod schema from `packages/shared` before it reaches a
  controller. Invalid input is a 400 and is never coerced into a query.
- Markdown from users is rendered from a sanitized subset. Raw HTML is stripped on write.
  Code snippets are stored and displayed as text, never rendered as markup.
- Errors returned to clients use the fixed envelope from `api-documentation.md`. Stack
  traces, query details, and internal ids beyond the subject's own id are never included.
- MongoDB operators cannot be injected through query parameters, because filters are built
  from validated, typed fields rather than from raw request objects.

## 3. Uploads

The server never proxies file bytes.

1. The client asks for an upload slot, naming the file name, MIME type, and size.
2. The server checks the type against the allowlist and the size against the limit, then
   returns a presigned URL that expires in 10 minutes and accepts only that content type and
   a maximum size.
3. The client uploads straight to S3 or Cloudinary.
4. The client links the storage key to a resource, submission, or message. The server first
   confirms the object exists and that its stored size and type match what was declared.
   Only then is the key saved.

Allowlist: PDF, PNG, JPEG, WEBP, and plain-text source files. Executables, archives, and SVG
are rejected. Maximum size is 10 MB for submissions and 20 MB for resource attachments.
Downloads are served through short-lived signed URLs minted only after the authorization
check for that object passes.

Avatars are the exception to the size rule at 2 MB, and are the only images rendered inline.

## 4. Authorization recap

The full rules are in `permissions.md`. The reliability-relevant points:

- Authorization is evaluated on the server for every request and every socket event. The
  frontend guard is not trusted.
- The assigned-mentor relationship is read from current data per request, so a reassignment
  takes effect immediately.
- Denied access to a protected object is audited through `security.access_denied`.
- Responses do not disclose the existence of records the caller could not see.

## 5. Assessment and submission integrity

- The attempt timer is server-owned. `expiresAt` is set at start and checked on every
  autosave and on submission. The client clock is irrelevant.
- Answer keys never leave the server before the assessment's release time, and the serializer
  test locks this in.
- The attempt limit is enforced by a unique index, so concurrency cannot sneak an extra attempt.
- Submissions and finalizations require an idempotency key, so retries cannot duplicate them.
- Past work is bound to a version snapshot, so editing a resource or question later cannot
  change what a student submitted against or alter a graded paper.
- Student code is not executed. The code-execution setting ships disabled, and while it is
  disabled no code path runs submitted code. Enabling it later requires the sandboxed runner
  described in `architecture.md`, which isolates execution from the API process.

## 6. Observability

- Logs are structured JSON through pino. Every request gets an id, returned in the
  `X-Request-Id` header and stored on every log line and audit entry for that request. Log
  lines include the user id and route, and never include passwords, tokens, or message bodies.
- Sentry captures unhandled errors on both the server and the client, with the request id as
  the correlation tag. Personally identifying fields are stripped before an event is sent.
- `/health` reports liveness and `/ready` checks the database, so the platform can distinguish
  a dead process from a process that cannot serve.
- Shutdown handles `SIGTERM`: the process stops accepting connections, waits for in-flight
  requests up to 20 seconds, flushes jobs and logs, and exits.
- An external uptime check hits `/ready` every minute and alerts the platform operator after
  two consecutive failures.
- Agenda job failures are logged and reported to Sentry, and jobs are safe to retry because
  each one is idempotent.

## 7. Backups and recovery

- MongoDB Atlas continuous backups with point-in-time restore, retained for 7 days, plus a
  daily snapshot retained for 30 days.
- Object storage has versioning enabled, so an overwritten or deleted upload is recoverable
  within the retention window.
- A restore drill is run monthly: the platform operator restores the latest backup into a
  scratch instance, runs the smoke tests against it, and records the time taken and the
  outcome. A drill that was not done is treated as a failed control.
- Recovery targets: a point-in-time restore within 1 hour of data loss (RPO of 1 hour is
  comfortably inside continuous backup), and service restored within 4 hours (RPO and RTO
  stated so the incident runbook has a bar to clear).

## 8. Privacy and the DPDP Act 2023

DHRUVA handles personal data of students and mentors — names, email addresses, academic
activity, and private messages. The deployment is the data fiduciary for its college. The
following translates the Act's obligations into concrete behaviour.

### 8.1 Purpose and minimization

- Data is collected only to run the learning and mentorship program. Each field in the schema
  serves that purpose; nothing is collected speculatively.
- Analytics are computed from learning activity. The audit log is a separate collection used
  for security and accountability, and it is not mined for student analytics.

### 8.2 Consent and notice

- Accounts are created by the college for an academic program, and the purpose is stated in
  the invite email and on first login: providing the course, mentorship, assessment, and the
  safety of the platform.
- Student-to-student messaging and group chat are off by default and are turned on by the
  college as a deliberate decision, recorded in platform settings and audited.

### 8.3 Rights

- Access and correction: a user can see and correct their own profile. Academic records
  (submissions, grades) are corrected by Admin, with the change audited.
- Export: an authorized admin can produce a user's data export through the break-glass path,
  which is audited. This covers a student's request for their own data.
- Erasure: honoured by deactivation followed by the retention schedule, except for records the
  college must keep for academic integrity (grades, submission history), which are retained
  for the period below and then deleted.

### 8.4 Retention

| Data | Kept for | Then |
| --- | --- | --- |
| Accounts and academic records (grades, submissions, attempts) | Duration of enrollment plus 2 years | Deleted by the retention job |
| Private messages | 1 year from sending | Deleted |
| Learning events | 2 years | Deleted |
| Audit log | 3 years | Deleted |
| Backups | As in section 7 | Expire automatically |
| Invite and reset tokens | Until expiry | Purged hourly |

Deactivation is immediate and reversible. Deletion is what the retention job does after the
period ends, and it removes the data from the primary database; backups age out on their own
schedule. The job records how many records it deleted so the quarterly review can check it ran.

### 8.5 Soft delete

User-facing deletion (hiding content, closing an account) sets `deletedAt` and excludes the
record from queries. The data stays available for moderation review and audit until the
retention job removes it. Nothing a user does triggers an immediate hard delete of content
that has been reported or that another record depends on.

## 9. Break-glass access

Some data is private even from Admin: the content of direct messages, and a full personal
data export.

- The only way to read it is the break-glass endpoint, which requires a written reason and
  refuses the request without one.
- Every use writes a `security.break_glass` audit entry with the actor, the subject, the
  reason, and the request id.
- A second admin is notified automatically each time it happens, so the access cannot be
  silent.
- Uses are reviewed in the quarterly data-retention review, and any use without a clear
  moderation or data-subject purpose is raised as an incident.

## 10. Fairness of analytics

Support indicators exist to help mentors notice students who may be struggling. They are
computed from configurable thresholds, displayed with the reason, and labelled as support
indicators.

- No indicator blocks access to resources, assignments, or assessments.
- No indicator changes a score, a grade, or an attempt limit.
- Thresholds are set by Admin and reviewed by the program coordinator once per cohort.
- The underlying numbers are visible, so a mentor can see why a student was flagged and can
  disagree with it.

## 11. Dependencies and patching

- Dependencies are pinned with a lockfile and installed with `npm ci` in CI.
- GitHub Dependabot opens update pull requests. Critical advisories are patched within 7 days,
  others in the monthly maintenance window.
- Secrets live in the host's environment, never in the repository, and are validated at
  startup so a missing secret stops the process rather than degrading silently.

## 12. Security test checklist

Mapped to Phase 12 of the roadmap. Each item is an automated test unless marked manual.

- Authentication: wrong password, inactive account, session rotation on login, session revoked
  on password change and on deactivation.
- Authorization: the permission matrix in `permissions.md`, including the unauthorized-access
  acceptance scenario and its audit entry.
- Object-level access: direct URL to another student's submission, attempt, and messages.
- Upload validation: disallowed type, oversized file, mismatched declared type, linking a key
  that was never uploaded.
- Rate limits: login lockout and the password reset cap.
- Session and CSRF: state-changing request without the CSRF header is rejected.
- Input sanitization: HTML in markdown is stripped; query objects cannot carry operators.
- Socket authorization: joining a conversation the user is not part of is rejected and audited.
- Assessment integrity: answer keys absent from student payloads, attempt limit under
  concurrent starts, expiry finalizes an abandoned attempt.
- Privacy: break-glass without a reason is rejected, and with a reason it is audited and
  notifies a second admin.
