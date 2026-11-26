export const AUDIT_ACTIONS = [
  "user.created",
  "user.deactivated",
  "user.role_changed",
  "mentor.capabilities_changed",
  "mentor.assigned",
  "mentor.reassigned",
  "resource.published",
  "resource.archived",
  "assignment.published",
  "attempt.finalized",
  "moderation.action_taken",
  "security.access_denied",
  "security.break_glass",
  "settings.updated",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const audited = new Set<string>(AUDIT_ACTIONS);

export function isAuditAction(action: string): action is AuditAction {
  return audited.has(action);
}
