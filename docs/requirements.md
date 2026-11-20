# DHRUVA — Requirements

Status: approved design baseline (replaces Phase 0 of the implementation document).
Scope: one college deployment, about 1,000 students and 50 mentors in a single program.
Stack (fixed by the implementation document): React + TypeScript + Vite, Tailwind CSS,
shadcn/ui, Node.js + Express + TypeScript, MongoDB (Mongoose), Socket.IO, Cloudinary or
AWS S3, Zod, deployed on Vercel + Node hosting + MongoDB Atlas.

## 1. Vision

DHRUVA is a centralized learning and mentorship platform for first-year engineering
students. It gives every student a structured daily learning plan, learning resources,
practice assignments, coding practice, assessments, a doubt forum, and a single assigned
mentor, and it gives admins one place to run the program.

Supported branches (stored as the `Branch` enum, never free text):

- Computer Science and Engineering (CSE)
- Information Science and Engineering (ISE)
- CSE Allied branches (CSE_ALLIED)
- Electronics and Communication Engineering (ECE)
- Electrical and Electronics Engineering (EEE)
- Electronics and Instrumentation Engineering (EIE)
- Mechanical Engineering (ME)
- Chemical Engineering (CHE)
- Aerospace Engineering (AE)
- Other (OTHER)

## 2. Goals

1. One integrated workflow, not disconnected features:
   Admin → mentor allocation → resource publishing → learning assignment → student
   activity → submission → mentor evaluation → progress tracking → admin analytics.
2. Every student has exactly one active mentor at a time, with full reassignment history.
3. Students see only what they are permitted to see; mentors see only their assigned
   students. This is enforced on the server, on direct URLs, on file links, and on sockets.
4. Progress numbers are derived from real activity records, never entered by hand.
5. Every administrative and security action is auditable from the first user created.

## 3. Functional requirements

### 3.1 Accounts and access

- FR-1. Three roles: STUDENT, MENTOR, ADMIN. No self-registration; Admin creates every account.
- FR-2. Admin creates users one at a time or by CSV (columns: Name, Email, Branch, Cohort, Role)
  with file validation, row validation, duplicate detection, a preview, an explicit confirmation,
  and an import result report.
- FR-3. Creating a user sends an invite email with a one-time set-password link. Admin never
  sets or sees a password. "Reset password" re-issues an invite, it does not reveal a password.
- FR-4. Login, logout, session restoration, change password, forgot password, reset password.
- FR-5. Inactive (deactivated) accounts cannot log in, and deactivation revokes all sessions.
- FR-6. A student belongs to exactly one branch and one cohort. Cohort is a managed record,
  not a free-text string.

### 3.2 Mentor allocation

- FR-7. Admin assigns students to mentors (individually or in bulk), views each mentor's
  workload, and reassigns students. Every assignment and reassignment is kept as history.
- FR-8. A student has at most one ACTIVE mentor assignment. The database enforces this.
- FR-9. A mentor can never read an unassigned student's private records. Denied attempts
  are written to the audit log.

### 3.3 Learning resources

- FR-10. Resource types: Article, Video, PDF, Documentation, Coding exercise, Quiz, Project,
  External link. Fields include title, description, content, external link, attachments, topic,
  tags, difficulty, estimated duration.
- FR-11. Admin, and mentors whose account has the capability flag, can create, edit, attach
  files to, publish, and archive resources.
- FR-12. Every resource has exactly one visibility scope:
  - GLOBAL — all active students.
  - COHORT — students in selected cohorts.
  - MENTOR_GROUP — students currently assigned to selected mentors.
  - INDIVIDUAL — explicitly selected students.
- FR-13. The same visibility rules apply to list pages, detail pages, direct URLs, download
  links, and anything delivered over sockets. Visibility is evaluated in one service.
- FR-14. Resource content is separate from assignment completion. Reading a resource is not
  the same thing as completing an assignment.
- FR-15. Editing a published resource increments its version. Submissions and attempts keep a
  snapshot of the version they were made against, so history is never rewritten.

### 3.4 Learning paths and assignments

- FR-16. A learning path is an ordered program (modules → weeks → days) of resources and
  activities, targeted at a cohort, with a duration and a publish status.
- FR-17. An assignment is a task definition (title, description, optional resource, due date,
  priority, submission type, target). It is distinct from the resource it points at.
- FR-18. Assignment targets: an entire cohort, selected branches, selected mentor groups, or
  individual students.
- FR-19. Publishing an assignment creates one recipient record per targeted student. Students
  who join a targeted cohort afterwards are added by a scheduled reconciliation job.
- FR-20. A recipient moves through: NOT_STARTED → IN_PROGRESS → SUBMITTED → UNDER_REVIEW →
  COMPLETED, with UNDER_REVIEW → REVISION_REQUESTED → SUBMITTED. "Overdue" is computed
  (`dueDate` has passed and the state is not SUBMITTED, UNDER_REVIEW, or COMPLETED), never stored.
- FR-21. The student dashboard shows today's activities, resources, practice tasks, tests,
  deadlines, and completion state.

### 3.5 Submissions and evaluation

- FR-22. Submission types: text, file upload, GitHub repository URL, external code editor link.
- FR-23. Each revision is stored separately, so the full submission history is preserved.
- FR-24. A mentor (or Admin) reviews a submission of an assigned student: approve, request
  revision, give written feedback, assign a score, and optionally score against a rubric.
- FR-25. Students are notified when a submission is reviewed, feedback is added, a revision is
  requested, or a deadline is approaching.
- FR-26. Repeating a submit (double click, retry) must not create a duplicate revision.
  Submission endpoints accept an idempotency key.

### 3.6 Assessments

- FR-27. Question bank with MCQ, multiple select, true/false, short answer, and coding questions.
- FR-28. An assessment has title, description, questions, duration, total marks, passing marks,
  attempt limit, availability window, and a creator.
- FR-29. Admin (and mentors with the capability flag) build, configure, and publish assessments.
- FR-30. The server owns the timer: an attempt records `startedAt` and `expiresAt`, and answers
  are auto-saved. The client timer is only a display.
- FR-31. Objective questions are graded automatically. Short answers and coding questions go to
  manual grading. Correct answers are never sent to the client before the configured release time.
- FR-32. The attempt limit is enforced by the database, not only by the interface.
- FR-33. Analytics: total attempts, average marks, individual scores, topic-wise and
  question-wise performance.

### 3.7 Doubts and discussions

- FR-34. Every resource has a doubt thread. Students can ask, attach code snippets, reply, and
  ask follow-ups.
- FR-35. Threads support posts, comments, replies, reactions, accepted answers, and helpful marks.
- FR-36. A global forum with categories: Programming Fundamentals, Mathematics, DSA, Engineering
  Branch Discussions, General Doubts, Announcements.
- FR-37. Search by keyword and topic; filter by category, unanswered, and resolved.
- FR-38. Mentors can answer, mark resolved, highlight an explanation, and escalate.
- FR-39. Any user can report content. Admin reviews reports.

### 3.8 Messaging and notifications

- FR-40. Conversations: student-to-mentor (always, for the assigned pair), student-to-student
  (only when the platform setting allows it), and group study chats (only when enabled).
- FR-41. Messages persist in MongoDB. Socket.IO delivers them in real time and carries read
  receipts and typing indicators. Socket connections are authenticated and membership-checked.
- FR-42. Notifications for: new assignment, upcoming deadline, mentor feedback, doubt reply,
  new message, new announcement, mentor reassignment. Delivered in-app, over the socket, and
  by email where the user has opted in.
- FR-43. Admin access to a private conversation is an exceptional, reason-required, audited
  action (see the break-glass policy in `reliability-and-security.md`).

### 3.9 Progress and analytics

- FR-44. Student dashboard: assigned, completed, pending, and overdue counts; test scores;
  topic-wise performance; recent feedback; weekly consistency.
- FR-45. Mentor dashboard: assigned students, completion rates, pending submissions,
  unanswered doubts, students needing support, assessment trends.
- FR-46. Admin dashboard: totals, active users, mentor allocation and workload, cohort and
  branch performance, topic and assessment statistics, resource completion, students flagged
  for support.
- FR-47. Support indicators — ON_TRACK, NEEDS_ATTENTION, MENTOR_INTERVENTION — are computed
  from configurable thresholds. They are labelled as support indicators, never as judgments,
  and they never block a student or change a grade automatically.
- FR-48. Assignment completion and assessment performance are separate metrics. Completion =
  completed assignments / total assigned assignments.
- FR-49. Admin can export student progress, mentor allocation, assessment, and cohort
  performance reports. Exports run as background jobs.

### 3.10 Announcements, moderation, audit

- FR-50. Announcements target everyone, specific cohorts, branches, or mentor groups, and can
  be scheduled and given an expiry.
- FR-51. Moderation actions on a report: dismiss, hide content, warn the user, suspend the account.
- FR-52. An append-only audit log records: user creation and deactivation, mentor assignment
  and reassignment, resource publication, assignment creation, moderation actions, and any
  access to sensitive data. This exists from Phase 1, not Phase 11.
- FR-53. Student learning activity is recorded separately as learning events, which feed
  analytics. Audit and activity are never stored in the same collection.

### 3.11 Coding practice (pluggable)

- FR-54. Coding questions and coding assignments reserve `language` and `testCases` fields now.
- FR-55. Code execution goes through a `CodeRunner` interface. The default implementation only
  routes the submission to mentor review. An automatic judging adapter can be added later
  without a schema change, and it ships disabled.

## 4. Non-functional requirements

- NFR-1. Scale: 1,000 students and 50 mentors, with peaks during scheduled assessments.
  One Node process is sufficient; the design leaves seams to split work out later.
- NFR-2. Authorization is enforced on the server for every request, including direct object
  URLs and socket events. Frontend route guards are convenience only.
- NFR-3. All API input is validated with Zod. Validation rules live in a shared package used
  by both client and server, so the two cannot drift apart.
- NFR-4. Sessions use HTTP-only, Secure, SameSite=Lax cookies. Passwords are hashed. Login and
  password reset are rate limited.
- NFR-5. File uploads go directly to object storage through presigned URLs. The server checks
  type, size, and MIME type, and confirms the object exists before linking it.
- NFR-6. Multi-record changes (reassignment, CSV import commit, assignment publish fan-out)
  run inside a MongoDB transaction.
- NFR-7. The API exposes a liveness and a readiness endpoint, structured logs with request IDs,
  and error reporting. The process shuts down gracefully.
- NFR-8. The database has continuous backups with point-in-time restore, and a restore is
  rehearsed monthly.
- NFR-9. Personal data handling follows India's Digital Personal Data Protection Act, 2023:
  a stated purpose, data minimization, soft delete, a retention schedule, and a way for an
  authorized admin to export a user's data. Details are in `reliability-and-security.md`.
- NFR-10. Automated tests are written with each feature: API tests (Supertest), a
  role-by-endpoint permission matrix, frontend tests (Vitest), and end-to-end tests
  (Playwright) covering both final acceptance scenarios.

## 5. Constraints

- C-1. The technology stack in section 1 is fixed. No additional infrastructure (no Redis) is
  introduced at this scale; background jobs run on MongoDB.
- C-2. One deployment serves one college. Multi-tenancy is out of scope.
- C-3. There is no public registration and no payment flow.
- C-4. Automatic code judging is designed for but not built. Nothing in the first release
  executes student-submitted code.

## 6. Acceptance

The platform is not complete until both scenarios in Part 7 of the implementation document
pass as automated end-to-end tests:

1. A student completes a learning activity, from admin setup through mentor feedback, a
   follow-up doubt, an updated progress dashboard, and an admin-visible activity history.
2. Unauthorized access: a mentor assigned to a different student is denied by the backend,
   and the attempt is recorded in the audit log.

## 7. Traceability

| Requirement area | Design document |
| --- | --- |
| Roles, capabilities, ownership | `roles-and-responsibilities.md` |
| Structure, modules, events | `architecture.md` |
| Who can do what | `permissions.md` |
| Collections, indexes, states | `database-design.md` |
| Endpoints and events | `api-documentation.md` |
| User journeys | `workflows.md` |
| Security, privacy, reliability | `reliability-and-security.md` |
| Environments, operations | `deployment.md` |
| Build order and test gates | `implementation-roadmap.md` |
