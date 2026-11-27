import type { Notification } from "@dhruva/shared";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/auth-context";
import {
  getNotificationPreferences,
  listNotifications,
  markNotificationRead,
  updateNotificationPreferences,
} from "./api";

function destination(item: Notification, role: string | undefined): string | null {
  if (item.payload.conversationId) {
    return role === "ADMIN" ? `/admin/messages?conversation=${item.payload.conversationId}` : `/messages?conversation=${item.payload.conversationId}`;
  }
  if (item.payload.postId) {
    return `/forum/${item.payload.postId}`;
  }
  if (item.payload.announcementId) {
    return "/announcements";
  }
  if (item.type === "DISCUSSION_REPORTED" && role === "ADMIN") {
    return "/admin/reports";
  }
  if (item.type === "ASSIGNMENT_PUBLISHED" || item.type === "DEADLINE_UPCOMING" || item.type === "MENTOR_FEEDBACK") {
    if (role === "STUDENT") return "/student/assignments";
    if (role === "MENTOR") return "/mentor/assignments";
  }
  return null;
}

export function NotificationTray() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [email, setEmail] = useState<boolean | null>(null);

  async function reload() {
    try {
      const page = await listNotifications();
      setItems(page.data);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    void reload();
    void getNotificationPreferences()
      .then((preferences) => setEmail(preferences.email))
      .catch(() => setEmail(null));
    if (import.meta.env.VITEST) {
      return;
    }
    let connection: { disconnect(): void } | undefined;
    let cancelled = false;
    void import("socket.io-client").then(({ io }) => {
      if (cancelled) {
        return;
      }
      const socket = io({ withCredentials: true, path: "/socket.io" });
      socket.emit("notification.subscribe");
      socket.on("notification.new", () => {
        void reload();
      });
      connection = socket;
    });
    return () => {
      cancelled = true;
      connection?.disconnect();
    };
  }, []);

  const unread = items?.filter((item) => !item.readAt).length ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span aria-hidden="true" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        {items === null || items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">No notifications yet</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    void markNotificationRead(item.id).then(reload);
                    const target = destination(item, user?.role);
                    if (target) {
                      navigate(target);
                    }
                  }}
                >
                  <span className={item.readAt ? "text-muted-foreground" : "font-medium"}>{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {email === null ? null : (
          <label className="mt-2 flex items-center gap-2 border-t px-2 pt-2 text-sm">
            <input
              type="checkbox"
              checked={email}
              onChange={(event) => {
                const next = event.target.checked;
                setEmail(next);
                void updateNotificationPreferences(next).catch(() => setEmail(!next));
              }}
            />
            Email me notifications
          </label>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
