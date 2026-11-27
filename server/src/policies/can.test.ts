import { describe, expect, it } from "vitest";
import { can, canViewStudent, type AuthUser } from "./can.js";
import { isSessionExpired, ABSOLUTE_SESSION_MS } from "./authenticate.js";

const admin: AuthUser = {
  id: "admin-1",
  role: "ADMIN",
  status: "ACTIVE",
  capabilities: { canCreateResources: false, canCreateAssessments: false, canGradeAssessments: false },
};

const student: AuthUser = { ...admin, id: "student-1", role: "STUDENT" };

describe("can", () => {
  it("lets an admin create users", () => {
    expect(can(admin, "users.create")).toBe(true);
  });

  it("refuses user creation for a student and records no extra privilege", () => {
    expect(can(student, "users.create")).toBe(false);
  });

  it("lets a person update only their own profile", () => {
    expect(can(student, "profile.update", { type: "profile", userId: student.id })).toBe(true);
    expect(can(student, "profile.update", { type: "profile", userId: admin.id })).toBe(false);
  });

  it("lets an admin or a mentor with the resources flag create a resource", () => {
    expect(can(admin, "resources.create")).toBe(true);
    expect(can(admin, "resources.upload")).toBe(true);
    expect(
      can(
        { ...admin, id: "mentor-1", role: "MENTOR", capabilities: { ...admin.capabilities, canCreateResources: true } },
        "resources.create",
      ),
    ).toBe(true);
    expect(can({ ...admin, id: "mentor-2", role: "MENTOR" }, "resources.create")).toBe(false);
    expect(can(student, "resources.upload")).toBe(false);
  });

  it("lets an admin manage a learning path and a student open their own plan", () => {
    const mentor: AuthUser = { ...admin, id: "mentor-1", role: "MENTOR" };
    expect(can(admin, "paths.manage")).toBe(true);
    expect(can(admin, "paths.view")).toBe(true);
    expect(can(mentor, "paths.view")).toBe(true);
    expect(can(mentor, "assignments.create")).toBe(true);
    expect(can(mentor, "paths.manage")).toBe(false);
    expect(can(student, "paths.view")).toBe(false);
    expect(can(student, "assignments.create")).toBe(false);
    expect(can(student, "plan.view")).toBe(true);
    expect(can(mentor, "plan.view")).toBe(false);
  });

  it("lets an admin or a mentor with the assessment flag write questions, and only an admin publish", () => {
    const mentor: AuthUser = { ...admin, id: "mentor-1", role: "MENTOR" };
    const author: AuthUser = {
      ...mentor,
      capabilities: { ...mentor.capabilities, canCreateAssessments: true },
    };
    expect(can(admin, "assessments.create")).toBe(true);
    expect(can(admin, "assessments.publish")).toBe(true);
    expect(can(author, "assessments.create")).toBe(true);
    expect(can(author, "assessments.publish")).toBe(false);
    expect(can(mentor, "assessments.create")).toBe(false);
    expect(can(student, "assessments.create")).toBe(false);
    expect(can(student, "assessments.publish")).toBe(false);
  });

  it("keeps progress and exports inside the role that owns them", () => {
    const mentor: AuthUser = { ...admin, id: "mentor-1", role: "MENTOR" };
    expect(can(student, "progress.own")).toBe(true);
    expect(can(mentor, "progress.own")).toBe(false);
    expect(can(mentor, "analytics.mentor")).toBe(true);
    expect(can(student, "analytics.mentor")).toBe(false);
    expect(can(admin, "analytics.admin")).toBe(true);
    expect(can(mentor, "analytics.admin")).toBe(false);
    expect(can(admin, "exports.manage")).toBe(true);
    expect(can(mentor, "exports.manage")).toBe(false);
    expect(can(student, "exports.manage")).toBe(false);
  });

  it("lets only an admin change platform settings", () => {
    const mentor: AuthUser = { ...admin, id: "mentor-1", role: "MENTOR" };
    expect(can(admin, "settings.view")).toBe(true);
    expect(can(admin, "settings.update")).toBe(true);
    expect(can(mentor, "settings.update")).toBe(false);
    expect(can(student, "settings.view")).toBe(false);
  });

  it("refuses a deactivated admin", () => {
    expect(can({ ...admin, status: "DEACTIVATED" }, "users.create")).toBe(false);
  });

  it("lets an assigned mentor see a student and hides that student from another mentor", () => {
    expect(canViewStudent(admin, "student-1", null)).toBe(true);
    expect(canViewStudent({ ...admin, id: "mentor-1", role: "MENTOR" }, "student-1", "mentor-1")).toBe(true);
    expect(canViewStudent({ ...admin, id: "mentor-2", role: "MENTOR" }, "student-1", "mentor-1")).toBe(false);
    expect(canViewStudent({ ...admin, id: "mentor-2", role: "MENTOR" }, "student-1", null)).toBe(false);
  });
});

describe("isSessionExpired", () => {
  it("expires a session after 30 days", () => {
    const issuedAt = 1_000;
    expect(isSessionExpired(issuedAt, issuedAt + ABSOLUTE_SESSION_MS)).toBe(false);
    expect(isSessionExpired(issuedAt, issuedAt + ABSOLUTE_SESSION_MS + 1)).toBe(true);
  });
});
