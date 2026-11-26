import type { Branch, Role } from "@dhruva/shared";
import { BRANCHES, ROLES } from "@dhruva/shared";
import { randomUUID } from "node:crypto";
import type { CohortRepository } from "../cohorts/repository.js";
import type { UserRepository } from "./repository.js";

export type ImportRow = {
  line: number;
  name: string;
  email: string;
  role: Role | null;
  branch: Branch | null;
  cohortName: string;
  cohortId: string | null;
  errors: string[];
};

export type ImportPreview = {
  id: string;
  rows: ImportRow[];
  committed: { created: number; skipped: { line: number; email: string; reason: string }[] } | null;
};

export function createImportStore() {
  const previews = new Map<string, ImportPreview>();
  return {
    save(preview: ImportPreview) {
      previews.set(preview.id, preview);
    },
    get(id: string) {
      return previews.get(id) ?? null;
    },
  };
}

function cell(value: string | undefined): string {
  return (value ?? "").trim().replace(/^"|"$/g, "");
}

export async function parseImportCsv(
  csv: string,
  users: UserRepository,
  cohorts: CohortRepository,
): Promise<ImportPreview> {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = (lines[0] ?? "").split(",").map((part) => cell(part).toLowerCase());
  const index = {
    name: header.indexOf("name"),
    email: header.indexOf("email"),
    branch: header.indexOf("branch"),
    cohort: header.indexOf("cohort"),
    role: header.indexOf("role"),
  };
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  const cohortList = await cohorts.list();

  for (const [offset, line] of lines.slice(1).entries()) {
    const parts = line.split(",");
    const name = cell(parts[index.name]);
    const email = cell(parts[index.email]).toLowerCase();
    const branchText = index.branch >= 0 ? cell(parts[index.branch]) : "";
    const cohortName = index.cohort >= 0 ? cell(parts[index.cohort]) : "";
    const roleText = cell(parts[index.role]).toUpperCase();
    const errors: string[] = [];
    const role = ROLES.includes(roleText as Role) ? (roleText as Role) : null;
    const branch = BRANCHES.includes(branchText as Branch) ? (branchText as Branch) : null;
    if (!name) errors.push("Name is required.");
    if (!email.includes("@")) errors.push("Email is invalid.");
    if (!role) errors.push("Role must be STUDENT, MENTOR, or ADMIN.");
    if (role === "STUDENT" && !branch) errors.push("Branch is required for a student.");
    if (branchText && !branch) errors.push("Branch is not recognized.");
    const cohort = cohortList.find((item) => item.name.toLowerCase() === cohortName.toLowerCase()) ?? null;
    if (role === "STUDENT" && !cohort) errors.push("Cohort was not found.");
    if (email && seen.has(email)) errors.push("This email is repeated in the file.");
    if (email) seen.add(email);
    if (email.includes("@") && (await users.findByEmail(email))) errors.push("An account with this email already exists.");
    rows.push({
      line: offset + 2,
      name,
      email,
      role,
      branch,
      cohortName,
      cohortId: cohort?.id ?? null,
      errors,
    });
  }

  if (index.name < 0 || index.email < 0 || index.role < 0) {
    rows.unshift({
      line: 1,
      name: "",
      email: "",
      role: null,
      branch: null,
      cohortName: "",
      cohortId: null,
      errors: ["The header must include Name, Email, and Role."],
    });
  }

  return { id: randomUUID(), rows, committed: null };
}
