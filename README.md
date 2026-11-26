# Dhruva-E-Learn

DHRUVA is a learning and mentorship platform for first-year engineering students. Phase 2 adds invite-based sign-in. There is no public registration: an administrator invites each person, and the invite link sets the password.

## Run locally

MongoDB needs to be available at the URI in `.env`.

```powershell
Copy-Item .env.example .env
npm install
npm test
npm run dev
```

Set `SESSION_SECRET` and `CSRF_SECRET` in `.env` before starting the API. `BOOTSTRAP_ADMIN_EMAIL` creates the first administrator when that email does not exist yet. Invite mail is sent through Gmail when `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS`, and `EMAIL_FROM` are set. That can deliver to any address. Without those, the invite link is shown to the administrator. The person opens that link and creates a password.

The client runs at http://localhost:5173 and the API at http://localhost:4000. Health checks are `GET /api/v1/health` and `GET /api/v1/ready`.

Administrators, and mentors with the Resources permission, can draft and publish learning resources. A student sees a published resource when it is global, aimed at their cohort, aimed at their current mentor, aimed at them, or attached to an assignment they received. Attachments upload directly to S3 or Cloudinary. Set `STORAGE_DRIVER` before attaching files. Resources can still be written when storage is not configured.

Administrators publish a learning path for a cohort. Day 1 is the cohort start date. Administrators can assign work to a cohort, to selected branches in a cohort, to a mentor's students, or to named students. A mentor can assign work only to their own students. Publishing creates one recipient per student at that moment. Students who join a targeted cohort later are added by the `assignment.reconcile_recipients` job, which runs every 15 minutes. Overdue is calculated from the due date when the work is read. It is not stored.

## Documentation

- [Requirements](docs/requirements.md)
- [Roles and responsibilities](docs/roles-and-responsibilities.md)
- [Architecture](docs/architecture.md)
- [Permissions](docs/permissions.md)
- [Database design](docs/database-design.md)
- [API documentation](docs/api-documentation.md)
- [Workflows](docs/workflows.md)
- [Reliability and security](docs/reliability-and-security.md)
- [Deployment](docs/deployment.md)
- [Implementation roadmap](docs/implementation-roadmap.md)
