# DHRUVA — Roles and Responsibilities

This document defines the three user roles, the capability flags that qualify the mentor
role, and the operational ownership of the running platform. The exact allow/deny rules are
in `permissions.md`; this document says who is accountable for what.

## 1. User roles

There are exactly three roles, stored on the user record: `STUDENT`, `MENTOR`, `ADMIN`.
A person has one role. Changing a role is an audited admin action. There is no
self-registration; Admin provisions every account.

### 1.1 Student

A student consumes the program. A student can:

- Sign in, maintain their own profile, and change their own password.
- See their dashboard: today's plan, deadlines, progress, scores, feedback, and milestones.
- Open resources that are global or that target their cohort, their mentor's group, or them
  personally, plus resources attached to assignments they are a recipient of.
- Work through assignments and submit text, files, a repository URL, or an editor link.
- Take published assessments within the attempt limit and the availability window.
- Raise doubts on a resource, post and reply in the global forum, and react to posts.
- Message their assigned mentor, and message other students or join group chats only when
  the platform setting for that feature is turned on.
- See only their own submissions, attempts, scores, messages, and progress.

A student cannot create users, allocate mentors, publish resources, grade anyone, see
another student's private data, or see platform-wide analytics.

### 1.2 Mentor

A mentor is responsible for the students currently assigned to them, and for nobody else.
The assigned set is defined by `MentorAssignment` records with status `ACTIVE`, and it is
checked on every request. A mentor can:

- See the list of assigned students with branch, progress, pending work, and support flags.
- Open an assigned student's progress, submissions, attempts, and doubts.
- Assign an existing resource or create an assignment for one assigned student or for all of
  their assigned students.
- Review submissions from assigned students: approve, request a revision, give feedback,
  score, and apply a rubric.
- Answer doubts, mark a doubt resolved, highlight an explanation, and escalate a problem
  that needs admin attention.
- Message assigned students.
- Submit periodic progress reports to Admin.
- Flag a student as needing support. This is a recommendation to Admin, not a penalty.

A mentor cannot see an unassigned student's private records, cannot allocate mentors,
cannot manage accounts, and cannot export platform reports. Creating new resources and
assessments is not part of the base role; it requires capability flags (section 2).

### 1.3 Admin

Admin runs the program and is the highest authority. An admin can:

- Create, edit, deactivate, and reactivate student and mentor accounts, one at a time or by
  CSV import, using the invite flow so that no password is ever visible to Admin.
- Assign and reassign mentors, and see each mentor's workload.
- Create, edit, publish, archive, and target learning resources at any scope.
- Build learning paths and schedules, create and publish assignments to any target, and
  create, configure, and publish assessments.
- Grade submissions and manually grade assessment answers, for any student.
- Publish announcements to everyone or to a cohort, branch, or mentor group, including
  scheduled and expiring announcements.
- Review reports and moderate: dismiss, hide content, warn a user, or suspend an account.
- Read all analytics, export reports, and manage platform settings (feature flags).
- Read the audit log.

Admin does not get silent access to private data. Reading a private conversation, or
exporting a user's personal data, goes through the break-glass procedure: a written reason,
a confirmation, and an audit entry. See `reliability-and-security.md`.

## 2. Mentor capability flags

The implementation document says mentors may create assessments only "if authorized" but
never defines what authorized means. DHRUVA defines it as three boolean flags on the mentor
account, all defaulting to false and all set by Admin:

| Flag | Grants |
| --- | --- |
| `canCreateResources` | Create, edit, and archive resources. Publishing to GLOBAL or COHORT scope still requires Admin; a mentor can publish to their own mentor group and to individual assigned students. |
| `canCreateAssessments` | Build assessments and add questions to the question bank. Publishing an assessment to a cohort or globally still requires Admin. |
| `canGradeAssessments` | Manually grade short-answer and coding questions for attempts by their assigned students. |

Rules:

- Flags grant nothing outside the mentor's assigned students. A mentor with all three flags
  still cannot see or grade an unassigned student.
- Flags are edited only by Admin, and every change is audited with the old and new values.
- Flags are checked in the policy layer, in the same place as role checks, so they cannot be
  bypassed by calling the API directly.
- A mentor whose account is deactivated loses the effect of all flags immediately, because
  deactivation revokes sessions and the policy check rejects inactive users.

## 3. Responsibility matrix

| Activity | Student | Mentor | Admin |
| --- | --- | --- | --- |
| Provision and deactivate accounts | — | — | Owns |
| Set mentor capability flags | — | — | Owns |
| Allocate and reassign mentors | — | — | Owns |
| Publish resources to a cohort or globally | — | — | Owns |
| Create resources for own students | — | If `canCreateResources` | Owns |
| Assign work to a student | Completes it | Owns, for assigned students | Owns, for anyone |
| Submit work and sit assessments | Owns | — | — |
| Review submissions and give feedback | Receives | Owns, for assigned students | Can override |
| Grade assessments manually | — | If `canGradeAssessments`, assigned students | Owns |
| Answer doubts | Asks | Owns, for assigned students' resources | Can intervene |
| Moderate reported content | Reports | Escalates | Owns |
| Announcements | Reads | Reads | Owns |
| Progress reports to Admin | — | Writes, on schedule | Reads and acts |
| Platform settings and feature flags | — | — | Owns |
| Audit log review | — | — | Owns |
| Personal data export | May request | — | Owns, via break-glass |

"Owns" means accountable for the outcome, not merely permitted. The permission rules that
implement this table are in `permissions.md`.

## 4. Operational responsibilities

These are responsibilities of the people running the deployment, not of the software roles.
Each one has a named owner in the deployment record and a runbook in `deployment.md`.

| Responsibility | Accountable owner | Cadence | Runbook |
| --- | --- | --- | --- |
| Backups and monthly restore drill | Platform operator | Continuous backups, restore rehearsed monthly | `deployment.md` §6.1 |
| Incident response | Platform operator, with a named deputy | On alert, reviewed after every incident | `deployment.md` §6.2 |
| Mentor onboarding and training | Program coordinator | Before each cohort starts, and when a mentor is added | `deployment.md` §6.3 |
| CSV import of a new cohort | Program coordinator | At cohort start and at each admission batch | `deployment.md` §6.4 |
| Data-retention review | Platform operator | Quarterly, against the retention schedule | `deployment.md` §6.5 |
| Support-indicator threshold review | Program coordinator | Once per cohort, before the program starts | `deployment.md` §6.6 |
| Dependency and security updates | Platform operator | Monthly, plus immediately for critical advisories | `deployment.md` §6.7 |

The platform operator and the program coordinator are named people recorded in the
deployment configuration. They will usually also hold Admin accounts, but the
accountability sits with the person, not with the role, so it survives staff changes.

## 5. Rules that apply to every role

1. A user sees and changes only their own account settings, credentials, and notifications.
2. Deactivation is immediate: sessions are revoked and every policy check rejects the user.
3. No role can hard-delete a record that another record depends on. Removal is archival or
   soft deletion, so history and audit trails survive.
4. No role can edit an audit log entry. Corrections are new entries.
5. Anything that grants one user visibility of another user's private data is either implied
   by an active mentor assignment or is an audited break-glass action. There is no third way.
