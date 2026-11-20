# DHRUVA — Implementation Roadmap

The phase plan from the implementation document, kept intact in structure and milestones,
with the design decisions in this `docs/` folder applied. Three things move earlier, and
every phase gains a permission test gate. The completion-report and git-checkpoint rules from
the document are unchanged and are restated in section 3 so this roadmap stands on its own.

## 1. What changed from the original plan

| Change | Reason |
| --- | --- |
| Phase 1 also builds the shared package, the event bus, the audit log, Agenda, the email service, and the logging and Sentry baseline | Audit and events have to exist before the first user is created, not in Phase 11 |
| Phase 2 also builds the policy engine and invite-based onboarding | Authorization and passwords underpin every later phase |
| Phase 11 shrinks to the moderation UI, announcements, and the audit viewer | The audit plumbing already exists and has been recording since Phase 1 |
| Every phase adds permission tests | The document requires continuous permission testing; this makes it concrete |
| Both acceptance scenarios become Playwright tests in CI | They are the definition of done, so they should run automatically |

Nothing is removed from the original scope. Work only moves to the phase where it has to
exist for later phases to be correct.

## 2. Phases

Dependencies and objectives are as in the implementation document unless noted. Model
implementation order from Part 4 of that document still applies within each phase.

### Phase 0 — Requirements and design (this document set)

Done when the documents in `docs/` are reviewed and accepted. No code.

### Phase 1 — Project setup and application shell

Everything in the original Phase 1, plus:

- The npm-workspaces monorepo and `packages/shared` with the enums and the first schemas.
- Environment validation that fails startup on bad configuration.
- The in-process event bus, the `AuditLog` model, and the audit subscriber.
- Agenda wired in-process, with the health and readiness endpoints.
- The email service abstraction, logging with request ids, and Sentry on client and server.
- Central error handling producing the standard error envelope.

Milestone M1: a running skeleton that already audits, logs, and can send email.

### Phase 2 — Authentication and role-based access

Everything in the original Phase 2, plus:

- The `policies/` module with `can(user, action, subject)` and the `authorize` middleware.
- Invite-based account activation: `PasswordToken`, the accept-invite flow, and no path that
  sets a password directly.
- Session hardening: rotation on login, revocation on password change, CSRF double-submit.
- Login and reset rate limits.

Milestone M2: all three roles can log in, and the policy engine is the only authorization path.

### Phase 3 — User management and mentor allocation

As in the original, with these specifics: CSV import uses the preview-then-commit flow inside
a transaction; the partial unique index enforces one active mentor per student; reassignment
is transactional and emits `mentor.reassigned`; capability flags are editable by Admin and
audited. The security verification from the original — a mentor cannot read an unassigned
student — is implemented here as a policy and a test.

Milestone M3.

### Phase 4 — Resource library

As in the original, plus resource `version`, presigned uploads with server-side confirmation,
and `ResourceAccessService` as the single visibility check used by the list, the detail
endpoint, and download URLs.

Milestone M4.

### Phase 5 — Learning paths and assignments

As in the original, with `AssignmentRecipient` created at publish inside a transaction,
`assignment.reconcile_recipients` adding students who join later, and overdue computed rather
than stored. The reserved `language` and `testCases` fields are added to coding resources and
assignments now, so they cost nothing later.

Milestone M5.

### Phase 6 — Submissions and evaluation

As in the original, with `SubmissionRevision` for history, the idempotency key, the resource
version snapshotted onto each revision, and the `CodeRunner` port in place with only
`ManualReviewRunner` behind it. Code execution stays disabled.

Milestone M6.

### Phase 7 — Assessments

As in the original, plus the server-owned timer, answer autosave, the question snapshot on
the attempt, the unique index that enforces the attempt limit, the expiry job, and serializers
that strip answer keys. The "never expose correct answers" rule from the original becomes a
tested serializer guarantee.

Milestone M7.

### Phase 8 — Doubts and discussions

As in the original, plus the text index for search and sanitized markdown on write.

Milestone M8.

### Phase 9 — Messaging and notifications

As in the original. Messages are persisted before they are pushed. Student-to-student
messaging and group chat are gated by platform settings and default to off. Break-glass
access with a required reason, an audit entry, and a second-admin notification is built here
because this is where private messages begin.

Milestone M9.

### Phase 10 — Progress and analytics

As in the original, with `LearningEvent` as the activity stream, `StudentProgress` as a
rebuildable projection, the nightly rebuild job, and support indicators driven by
configurable thresholds that carry no enforcement power. Exports run as jobs.

Milestone M10.

### Phase 11 — Announcements, moderation, and the audit viewer

Reduced. The audit log, the events, and break-glass already exist. This phase adds the
moderation queue and its actions (dismiss, hide, warn, suspend), announcements with
scheduled publishing and expiry, and the admin screens for reading the audit log and the
activity history.

Milestone M11.

### Phase 12 — Security, testing, and deployment

As in the original. The security checklist in `reliability-and-security.md` section 12 is the
test list. Production configuration, the pilot, and the launch follow `deployment.md`.

Milestone M12.

## 3. Rules for every phase

Carried from the implementation document.

**One phase at a time.** A phase is started only after the previous one has no open critical
defects.

**Inspect before modifying.** At the start of a phase, review the existing structure, models,
APIs, components, tests, and these documents, and reuse what is there.

**The implementation cycle.** Requirements, architecture review, database design, backend,
backend tests, frontend, integration tests, acceptance tests, then the git commit. UI-only
work skips the backend steps.

**The completion report.** Each phase ends with: features implemented, files created, files
modified, database changes, APIs added or changed, tests run, results, known limitations,
manual test instructions, and the recommended commit message.

**The git checkpoint.** One commit per completed phase, `phase-X: description`. Never begin
the next phase with a critical bug open.

**The permission gate.** Each phase adds Supertest cases for its new endpoints to the
permission matrix, covering every role and the object-level conditions. The phase is not
complete while those tests fail.

## 4. Test strategy

| Layer | Tool | What it covers | When it runs |
| --- | --- | --- | --- |
| Unit | Vitest | Policy functions, state machines, serializers, progress calculations | Every commit |
| API | Supertest + ephemeral MongoDB | Endpoints, validation, the permission matrix, transactions, idempotency | Every commit |
| Frontend | Vitest + Testing Library | Components, forms, role guards | Every commit |
| End to end | Playwright | Both acceptance scenarios and the critical path per role | Every commit, in CI |

### 4.1 The permission matrix

One table drives the tests: rows are endpoints, columns are the roles plus the object
conditions (owner, assigned mentor, unassigned mentor, inactive user, anonymous). Each cell
is the expected status code. The suite iterates the table and asserts the status, and for
denials it also asserts that an audit entry was written. Adding an endpoint means adding a
row in the same pull request. This is how "test permissions continuously" is enforced rather
than hoped for.

### 4.2 The acceptance tests

Both scenarios from Part 7 of the implementation document are Playwright tests:

1. **A student completes a learning activity.** Admin creates a student and a mentor, assigns
   them, publishes a resource and an assignment, the student submits, the mentor gives
   feedback, the student asks a doubt, the mentor answers, and both the student dashboard and
   the admin progress view show the result. It also checks the activity history.
2. **Unauthorized access.** Two mentors, two students, cross-assigned. One mentor requests the
   other's student's private pages and API records, the backend denies every one, and the
   audit log contains the denials.

These two tests are the release gate. The platform is not deployable to production while
either fails.

### 4.3 What is deliberately not automated

The monthly restore drill, mentor training, and the retention review are operational and stay
in the runbooks. Everything about whether the software behaves correctly is in the suite above.

## 5. Milestones

| Milestone | Phase | Expected result |
| --- | --- | --- |
| M1 | 1 | Skeleton with audit, jobs, email, and observability in place |
| M2 | 2 | Secure authentication, policy engine, invite onboarding |
| M3 | 3 | User management and mentor allocation, with the one-active-mentor guarantee |
| M4 | 4 | Resource library with versioned, scope-checked visibility |
| M5 | 5 | Daily plans and assignment fan-out |
| M6 | 6 | Submissions, revision history, and mentor evaluation |
| M7 | 7 | Assessments with server-owned timing and protected answer keys |
| M8 | 8 | Doubts and the global forum |
| M9 | 9 | Realtime messaging, notifications, and break-glass |
| M10 | 10 | Progress dashboards and support indicators |
| M11 | 11 | Moderation, announcements, and the audit viewer |
| M12 | 12 | Production deployment after a clean pilot |

## 6. Definition of done for the platform

All twelve milestones are complete, the permission matrix is green, both acceptance tests
pass in CI, the security checklist is done, a restore drill has been run, and the pilot
feedback has been addressed. That is the bar the implementation document sets, and this
roadmap keeps it.
