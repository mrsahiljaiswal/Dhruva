import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { EventBus } from "../../events/bus.js";
import type { OutboundMail } from "../../platform/mail.js";
import { createMemoryUserRepository } from "../users/repository.js";
import { deliverNotification } from "./dispatch.js";
import { createMemoryPreferenceRepository } from "./preferences.js";
import { createMemoryNotificationRepository } from "./repository.js";
import { registerNotificationSubscriber } from "./subscriber.js";
import { noopDelivery } from "../../realtime/delivery.js";

const logger = pino({ level: "silent" });

describe("notification subscriber", () => {
  it("subscribes to assignment, feedback, discussion, reassignment, and announcement events", async () => {
    const users = createMemoryUserRepository();
    const student = await users.create({
      name: "Ada",
      email: "ada@example.com",
      passwordHash: null,
      role: "STUDENT",
      branch: "CSE",
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const mentor = await users.create({
      name: "Grace",
      email: "grace@example.com",
      passwordHash: null,
      role: "MENTOR",
      branch: null,
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const previous = await users.create({
      name: "Alan",
      email: "alan@example.com",
      passwordHash: null,
      role: "MENTOR",
      branch: null,
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const admin = await users.create({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: null,
      role: "ADMIN",
      branch: null,
      cohortId: null,
      status: "ACTIVE",
      capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
      invitedAt: null,
      activatedAt: new Date(),
    });
    const notifications = createMemoryNotificationRepository();
    const preferences = createMemoryPreferenceRepository();
    const emails: OutboundMail[] = [];
    const bus = new EventBus(logger);
    registerNotificationSubscriber(bus, {
      users,
      notifications,
      preferences,
      mailer: { async send(message) { emails.push(message); } },
      delivery: noopDelivery,
      logger,
    });

    await bus.emit({
      action: "assignment.published",
      subjectType: "Assignment",
      subjectId: "assignment-1",
      after: { studentIds: [student.id] },
    });
    await bus.emit({
      action: "submission.reviewed",
      actorId: mentor.id,
      subjectType: "SubmissionRevision",
      subjectId: "revision-1",
      after: { studentId: student.id, recipientId: "recipient-1" },
    });
    await bus.emit({
      action: "doubt.asked",
      actorId: student.id,
      subjectType: "DiscussionPost",
      subjectId: "post-1",
      after: { mentorId: mentor.id, resourceId: "resource-1" },
    });
    await bus.emit({
      action: "doubt.replied",
      actorId: mentor.id,
      subjectType: "Comment",
      subjectId: "comment-1",
      after: { authorId: student.id, mentorId: mentor.id, postId: "post-1" },
    });
    await bus.emit({
      action: "discussion.reported",
      actorId: student.id,
      subjectType: "Report",
      subjectId: "report-1",
      after: { targetType: "POST", targetId: "post-1", reason: "spam" },
    });
    await bus.emit({
      action: "mentor.reassigned",
      subjectType: "User",
      subjectId: student.id,
      before: { mentorId: previous.id },
      after: { mentorId: mentor.id },
    });
    await bus.emit({
      action: "announcement.published",
      subjectType: "Announcement",
      subjectId: "announcement-1",
      after: { userIds: [student.id], title: "Lab closed Friday" },
    });

    const ada = await notifications.listForUser(student.id, 20);
    expect(ada.rows.map((row) => row.type).sort()).toEqual(
      ["ANNOUNCEMENT", "ASSIGNMENT_PUBLISHED", "DOUBT_REPLY", "MENTOR_FEEDBACK", "MENTOR_REASSIGNED"].sort(),
    );
    expect(ada.rows.find((row) => row.type === "ANNOUNCEMENT")?.text).toBe("Lab closed Friday");
    const grace = await notifications.listForUser(mentor.id, 20);
    expect(grace.rows.map((row) => row.type).sort()).toEqual(["DOUBT_ASKED", "MENTOR_REASSIGNED"].sort());
    const alan = await notifications.listForUser(previous.id, 20);
    expect(alan.rows.map((row) => row.type)).toEqual(["MENTOR_REASSIGNED"]);
    const adminInbox = await notifications.listForUser(admin.id, 20);
    expect(adminInbox.rows).toEqual([expect.objectContaining({ type: "DISCUSSION_REPORTED", text: "A report was filed." })]);
    expect(JSON.stringify(adminInbox.rows)).not.toContain("spam");
    expect(emails).toHaveLength(0);

    await preferences.set(student.id, true);
    await deliverNotification(
      { users, notifications, preferences, mailer: { async send(message) { emails.push(message); } }, delivery: noopDelivery, logger },
      {
        userId: student.id,
        type: "MESSAGE",
        text: "You have a new message.",
        payload: { conversationId: "conversation-1" },
        dedupeKey: null,
        createdAt: new Date(),
      },
    );
    expect(emails[0]?.text).toContain("You have a new message.");
    expect(emails[0]?.text).not.toContain("secret phrase");
  });
});
