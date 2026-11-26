import type { Visibility } from "@dhruva/shared";
import { describe, expect, it } from "vitest";
import { canViewResource, type ResourceViewer, type ResourceVisibility } from "./access.js";

const student: ResourceViewer = {
  id: "student-1",
  role: "STUDENT",
  status: "ACTIVE",
  cohortId: "cohort-1",
  activeMentorId: "mentor-1",
};

function resource(overrides: Partial<ResourceVisibility> = {}): ResourceVisibility {
  return {
    status: "PUBLISHED",
    visibility: "GLOBAL",
    targetIds: [],
    createdBy: "author-1",
    ...overrides,
  };
}

describe("canViewResource", () => {
  it("shows a student a published resource aimed at them", () => {
    expect(canViewResource(student, resource({ visibility: "GLOBAL" }))).toBe(true);
    expect(canViewResource(student, resource({ visibility: "COHORT", targetIds: ["cohort-1"] }))).toBe(true);
    expect(canViewResource(student, resource({ visibility: "MENTOR_GROUP", targetIds: ["mentor-1"] }))).toBe(true);
    expect(canViewResource(student, resource({ visibility: "INDIVIDUAL", targetIds: ["student-1"] }))).toBe(true);
  });

  it("hides a student from another cohort, mentor, or person", () => {
    expect(canViewResource(student, resource({ visibility: "COHORT", targetIds: ["cohort-2"] }))).toBe(false);
    expect(canViewResource(student, resource({ visibility: "MENTOR_GROUP", targetIds: ["mentor-2"] }))).toBe(false);
    expect(canViewResource(student, resource({ visibility: "INDIVIDUAL", targetIds: ["student-2"] }))).toBe(false);
    expect(canViewResource(student, resource({ status: "DRAFT" }))).toBe(false);
  });

  it("keeps an archived resource visible to its author and to an admin", () => {
    const archived = resource({ status: "ARCHIVED", visibility: "GLOBAL", createdBy: "mentor-9" });
    expect(canViewResource(student, archived)).toBe(false);
    expect(canViewResource({ ...student, id: "mentor-9", role: "MENTOR", cohortId: null, activeMentorId: null }, archived)).toBe(
      true,
    );
    expect(canViewResource({ ...student, id: "admin-1", role: "ADMIN" }, archived)).toBe(true);
  });

  it("lets a mentor see a published global resource and their own draft", () => {
    const mentor: ResourceViewer = { ...student, id: "mentor-1", role: "MENTOR", cohortId: null, activeMentorId: null };
    expect(canViewResource(mentor, resource())).toBe(true);
    expect(canViewResource(mentor, resource({ status: "DRAFT", createdBy: "mentor-1" }))).toBe(true);
    expect(canViewResource(mentor, resource({ status: "DRAFT", createdBy: "mentor-2" }))).toBe(false);
    expect(canViewResource(mentor, resource({ visibility: "MENTOR_GROUP" satisfies Visibility, targetIds: ["mentor-2"] }))).toBe(
      false,
    );
  });

  it("hides every resource from a deactivated account", () => {
    expect(canViewResource({ ...student, status: "DEACTIVATED" }, resource())).toBe(false);
  });

  it("opens a published resource when the caller is a recipient, and keeps an archived one closed", () => {
    const hidden = resource({ visibility: "INDIVIDUAL", targetIds: ["student-2"] });
    expect(canViewResource(student, hidden)).toBe(false);
    expect(canViewResource(student, hidden, { viaAssignment: true })).toBe(true);
    expect(canViewResource(student, resource({ status: "DRAFT" }), { viaAssignment: true })).toBe(false);
    expect(
      canViewResource(student, resource({ status: "ARCHIVED", visibility: "GLOBAL" }), { viaAssignment: true }),
    ).toBe(false);
    const mentor: ResourceViewer = { ...student, id: "mentor-9", role: "MENTOR", cohortId: null, activeMentorId: null };
    expect(canViewResource(mentor, hidden, { viaAssignment: true })).toBe(true);
  });
});
