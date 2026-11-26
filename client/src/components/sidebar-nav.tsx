import type { Role } from "@dhruva/shared";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { to: string; label: string; role: Role; author?: boolean }[] = [
  { to: "/student/dashboard", label: "Today", role: "STUDENT" },
  { to: "/student/assignments", label: "Assignments", role: "STUDENT" },
  { to: "/student/assessments", label: "Assessments", role: "STUDENT" },
  { to: "/student/resources", label: "Library", role: "STUDENT" },
  { to: "/messages", label: "Messages", role: "STUDENT" },
  { to: "/forum", label: "Forum", role: "STUDENT" },
  { to: "/mentor/dashboard", label: "Mentor", role: "MENTOR" },
  { to: "/mentor/assignments", label: "Assignments", role: "MENTOR" },
  { to: "/mentor/assessments", label: "Assessments", role: "MENTOR" },
  { to: "/mentor/resources", label: "Library", role: "MENTOR", author: true },
  { to: "/messages", label: "Messages", role: "MENTOR" },
  { to: "/forum", label: "Forum", role: "MENTOR" },
  { to: "/admin/dashboard", label: "Admin", role: "ADMIN" },
  { to: "/admin/learning-paths", label: "Paths", role: "ADMIN" },
  { to: "/admin/assignments", label: "Assignments", role: "ADMIN" },
  { to: "/admin/assessments", label: "Assessments", role: "ADMIN" },
  { to: "/admin/resources", label: "Library", role: "ADMIN" },
  { to: "/admin/messages", label: "Messages", role: "ADMIN" },
  { to: "/admin/settings", label: "Settings", role: "ADMIN" },
  { to: "/forum", label: "Forum", role: "ADMIN" },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const items = NAV_ITEMS.filter((item) => {
    if (item.role !== user?.role) {
      return false;
    }
    if (item.author && !user.capabilities.canCreateResources) {
      return false;
    }
    return true;
  });

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Primary">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn("rounded-md px-3 py-2 text-sm", isActive ? "bg-accent font-medium" : "hover:bg-accent")
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
