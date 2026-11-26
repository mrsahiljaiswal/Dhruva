import type { DailyPlan, PlanItem } from "@dhruva/shared";
import type { CohortRepository } from "../cohorts/repository.js";
import type { ResourceRepository } from "../resources/repository.js";
import type { UserRecord } from "../users/repository.js";
import type { LearningPathRepository, ModuleNode } from "./paths.js";
import { dayOffset, isOverdue, utcDay } from "./state.js";
import type { RecipientRecord, WorkRecord, WorkRepository } from "./work.js";

function orderedDays(modules: ModuleNode[]) {
  return [...modules]
    .sort((left, right) => left.order - right.order)
    .flatMap((module) =>
      [...module.weeks]
        .sort((left, right) => left.weekNumber - right.weekNumber)
        .flatMap((week) => [...week.days].sort((left, right) => left.dayNumber - right.dayNumber)),
    );
}

export async function buildDailyPlan(options: {
  student: UserRecord;
  date: string;
  now: Date;
  paths: LearningPathRepository;
  work: WorkRepository;
  cohorts: CohortRepository;
  resources: ResourceRepository;
}): Promise<DailyPlan> {
  const recipients = await options.work.listRecipientsForStudent(options.student.id);
  const assignments = new Map<string, WorkRecord>();
  for (const recipient of recipients) {
    if (!assignments.has(recipient.assignmentId)) {
      const assignment = await options.work.findById(recipient.assignmentId);
      if (assignment) {
        assignments.set(assignment.id, assignment);
      }
    }
  }

  const today = utcDay(options.now);
  const deadlines = recipients.flatMap((recipient) => {
    const assignment = assignments.get(recipient.assignmentId);
    if (!assignment || assignment.status === "DRAFT") {
      return [];
    }
    const overdue = isOverdue(assignment.dueDate, recipient.state, options.now);
    const dueToday = utcDay(assignment.dueDate) === options.date;
    if (!dueToday && !(options.date === today && overdue)) {
      return [];
    }
    return [
      {
        recipientId: recipient.id,
        assignmentId: assignment.id,
        title: assignment.title,
        dueDate: assignment.dueDate.toISOString(),
        state: recipient.state,
        overdue,
        priority: assignment.priority,
      },
    ];
  });

  const plan = await pathFor(options);
  const seen = new Set(plan.items.filter((item) => item.kind === "ASSIGNMENT").map((item) => item.refId));
  const individual = individualItems(recipients, assignments, seen, options.now);
  return {
    date: options.date,
    dayNumber: plan.dayNumber,
    path: plan.path,
    items: [...plan.items, ...individual],
    deadlines,
  };
}

async function pathFor(options: {
  student: UserRecord;
  date: string;
  now: Date;
  paths: LearningPathRepository;
  work: WorkRepository;
  cohorts: CohortRepository;
  resources: ResourceRepository;
}): Promise<{ dayNumber: number | null; path: DailyPlan["path"]; items: PlanItem[] }> {
  if (!options.student.cohortId) {
    return { dayNumber: null, path: null, items: [] };
  }
  const [cohort, path] = await Promise.all([
    options.cohorts.findById(options.student.cohortId),
    options.paths.findLatestPublished(options.student.cohortId),
  ]);
  if (!cohort || !path) {
    return { dayNumber: null, path: null, items: [] };
  }
  const offset = dayOffset(cohort.startDate, options.date);
  if (offset < 0 || offset >= path.durationDays) {
    return { dayNumber: null, path: null, items: [] };
  }
  const day = orderedDays(path.modules)[offset];
  if (!day) {
    return {
      dayNumber: offset + 1,
      path: { id: path.id, title: path.title, dayTitle: `Day ${offset + 1}` },
      items: [],
    };
  }
  const items: PlanItem[] = [];
  for (const item of day.items) {
    items.push(await planItem(item, options));
  }
  return {
    dayNumber: offset + 1,
    path: { id: path.id, title: path.title, dayTitle: day.title },
    items,
  };
}

async function planItem(
  item: { kind: PlanItem["kind"]; refId: string; required: boolean },
  options: {
    student: UserRecord;
    now: Date;
    work: WorkRepository;
    resources: ResourceRepository;
  },
): Promise<PlanItem> {
  if (item.kind === "RESOURCE") {
    const resource = await options.resources.findById(item.refId);
    return {
      source: "PATH",
      kind: "RESOURCE",
      refId: item.refId,
      title: resource && resource.status === "PUBLISHED" ? resource.title : null,
      required: item.required,
      recipientId: null,
      state: null,
      overdue: false,
    };
  }
  if (item.kind === "ASSESSMENT") {
    return {
      source: "PATH",
      kind: "ASSESSMENT",
      refId: item.refId,
      title: null,
      required: item.required,
      recipientId: null,
      state: null,
      overdue: false,
    };
  }
  const assignment = await options.work.findById(item.refId);
  const recipients = await options.work.listRecipientsForStudent(options.student.id);
  const recipient = recipients.find((row) => row.assignmentId === item.refId) ?? null;
  const visible = assignment !== null && (assignment.status === "PUBLISHED" || recipient !== null);
  return {
    source: "PATH",
    kind: "ASSIGNMENT",
    refId: item.refId,
    title: visible && assignment ? assignment.title : null,
    required: item.required,
    recipientId: recipient?.id ?? null,
    state: recipient?.state ?? null,
    overdue: assignment && recipient ? isOverdue(assignment.dueDate, recipient.state, options.now) : false,
  };
}

function individualItems(
  recipients: RecipientRecord[],
  assignments: Map<string, WorkRecord>,
  seen: Set<string>,
  now: Date,
): PlanItem[] {
  const items: PlanItem[] = [];
  for (const recipient of recipients) {
    const assignment = assignments.get(recipient.assignmentId);
    if (!assignment || assignment.status !== "PUBLISHED" || assignment.targetType !== "INDIVIDUAL") {
      continue;
    }
    if (seen.has(assignment.id) || recipient.state === "COMPLETED") {
      continue;
    }
    items.push({
      source: "INDIVIDUAL",
      kind: "ASSIGNMENT",
      refId: assignment.id,
      title: assignment.title,
      required: true,
      recipientId: recipient.id,
      state: recipient.state,
      overdue: isOverdue(assignment.dueDate, recipient.state, now),
    });
  }
  return items;
}
