import { Menu } from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { SidebarNav } from "@/components/sidebar-nav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/auth-context";
import { NotificationTray } from "@/features/notifications/tray";

function roleLabel(role: string | undefined) {
  if (role === "ADMIN") return "Administrator";
  if (role === "MENTOR") return "Mentor";
  if (role === "STUDENT") return "Student";
  return "";
}

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-muted/40">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r bg-card md:flex">
        <div className="px-6 py-5">
          <p className="text-lg font-semibold tracking-tight">Dhruva</p>
          <p className="mt-1 text-xs text-muted-foreground">{roleLabel(user?.role)}</p>
        </div>
        <SidebarNav />
      </aside>
      <div className="md:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-card/90 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <span className="font-semibold md:hidden">Dhruva</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationTray />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Open profile menu">
                  {user?.name}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/account/password">Change password</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void logout().then(() => navigate("/login"));
                  }}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Navigation</DialogTitle>
          </DialogHeader>
          <SidebarNav onNavigate={() => setNavOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
