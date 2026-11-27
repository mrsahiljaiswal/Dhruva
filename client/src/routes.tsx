import type { Role } from "@dhruva/shared";
import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { homeFor } from "@/features/auth/home";
import { useAuth } from "@/features/auth/auth-context";
import { AcceptInvitePage, ChangePasswordPage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from "@/features/auth/pages";
import { AssessmentsPage } from "@/features/assessments/assessments-page";
import { AttemptPage } from "@/features/assessments/attempt-page";
import { AssignmentsPage } from "@/features/learning/assignments-page";
import { PathsPage } from "@/features/learning/paths-page";
import { StudentWorkPage } from "@/features/learning/student-work-page";
import { SubmissionPage } from "@/features/learning/submission-page";
import { ForumPage } from "@/features/discussions/forum-page";
import { ThreadPage } from "@/features/discussions/thread-page";
import { BreakGlassPage } from "@/features/messaging/break-glass-page";
import { MessagesPage } from "@/features/messaging/messages-page";
import { AnnouncementsPage } from "@/features/moderation/announcements-page";
import { AuditPage } from "@/features/moderation/audit-page";
import { ReportsPage } from "@/features/moderation/reports-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { ResourceDetailPage } from "@/features/resources/detail-page";
import { ResourceEditorPage } from "@/features/resources/editor-page";
import { ResourceLibraryPage } from "@/features/resources/library-page";
import { AppLayout } from "@/layouts/app-layout";
import { AdminDashboard } from "@/pages/admin-dashboard";
import { MentorDashboard } from "@/pages/mentor-dashboard";
import { StudentDashboard } from "@/pages/student-dashboard";

function RequireAuth() {
  const { user, ready, unreachable } = useAuth();
  if (!ready) {
    return (
      <main className="p-6">
        <Spinner />
      </main>
    );
  }
  if (unreachable || !user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || user.role !== role) {
    return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
  }
  return children;
}

function MessagesGate() {
  const { user } = useAuth();
  if (user?.role === "ADMIN") {
    return <Navigate to="/admin/messages" replace />;
  }
  return <MessagesPage />;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={homeFor(user.role)} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="account/password" element={<ChangePasswordPage />} />
          <Route path="messages" element={<MessagesGate />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="forum" element={<ForumPage />} />
          <Route path="forum/:postId" element={<ThreadPage />} />
          <Route path="student/dashboard" element={<RequireRole role="STUDENT"><StudentDashboard /></RequireRole>} />
          <Route path="student/resources" element={<RequireRole role="STUDENT"><ResourceLibraryPage /></RequireRole>} />
          <Route path="student/resources/:id" element={<RequireRole role="STUDENT"><ResourceDetailPage /></RequireRole>} />
          <Route path="student/assessments" element={<RequireRole role="STUDENT"><AssessmentsPage /></RequireRole>} />
          <Route path="student/attempts/:attemptId" element={<RequireRole role="STUDENT"><AttemptPage /></RequireRole>} />
          <Route path="student/assignments" element={<RequireRole role="STUDENT"><StudentWorkPage own /></RequireRole>} />
          <Route path="student/assignments/:recipientId" element={<RequireRole role="STUDENT"><SubmissionPage audience="student" /></RequireRole>} />
          <Route path="mentor/dashboard" element={<RequireRole role="MENTOR"><MentorDashboard /></RequireRole>} />
          <Route path="mentor/assessments" element={<RequireRole role="MENTOR"><AssessmentsPage /></RequireRole>} />
          <Route path="mentor/attempts/:attemptId" element={<RequireRole role="MENTOR"><AttemptPage /></RequireRole>} />
          <Route path="mentor/assignments" element={<RequireRole role="MENTOR"><AssignmentsPage /></RequireRole>} />
          <Route path="mentor/students/:studentId/assignments" element={<RequireRole role="MENTOR"><StudentWorkPage /></RequireRole>} />
          <Route path="mentor/students/:studentId/assignments/:recipientId" element={<RequireRole role="MENTOR"><SubmissionPage audience="mentor" /></RequireRole>} />
          <Route path="mentor/resources" element={<RequireRole role="MENTOR"><ResourceLibraryPage /></RequireRole>} />
          <Route path="mentor/resources/new" element={<RequireRole role="MENTOR"><ResourceEditorPage /></RequireRole>} />
          <Route path="mentor/resources/:id" element={<RequireRole role="MENTOR"><ResourceDetailPage /></RequireRole>} />
          <Route path="mentor/resources/:id/edit" element={<RequireRole role="MENTOR"><ResourceEditorPage /></RequireRole>} />
          <Route path="admin/messages" element={<RequireRole role="ADMIN"><BreakGlassPage /></RequireRole>} />
          <Route path="admin/settings" element={<RequireRole role="ADMIN"><SettingsPage /></RequireRole>} />
          <Route path="admin/reports" element={<RequireRole role="ADMIN"><ReportsPage /></RequireRole>} />
          <Route path="admin/audit" element={<RequireRole role="ADMIN"><AuditPage /></RequireRole>} />
          <Route path="admin/dashboard" element={<RequireRole role="ADMIN"><AdminDashboard /></RequireRole>} />
          <Route path="admin/learning-paths" element={<RequireRole role="ADMIN"><PathsPage /></RequireRole>} />
          <Route path="admin/assessments" element={<RequireRole role="ADMIN"><AssessmentsPage /></RequireRole>} />
          <Route path="admin/attempts/:attemptId" element={<RequireRole role="ADMIN"><AttemptPage /></RequireRole>} />
          <Route path="admin/assignments" element={<RequireRole role="ADMIN"><AssignmentsPage /></RequireRole>} />
          <Route path="admin/students/:studentId/assignments" element={<RequireRole role="ADMIN"><StudentWorkPage /></RequireRole>} />
          <Route path="admin/students/:studentId/assignments/:recipientId" element={<RequireRole role="ADMIN"><SubmissionPage audience="admin" /></RequireRole>} />
          <Route path="admin/resources" element={<RequireRole role="ADMIN"><ResourceLibraryPage /></RequireRole>} />
          <Route path="admin/resources/new" element={<RequireRole role="ADMIN"><ResourceEditorPage /></RequireRole>} />
          <Route path="admin/resources/:id" element={<RequireRole role="ADMIN"><ResourceDetailPage /></RequireRole>} />
          <Route path="admin/resources/:id/edit" element={<RequireRole role="ADMIN"><ResourceEditorPage /></RequireRole>} />
          <Route path="*" element={<ErrorState title="Page not found" description="That page does not exist." />} />
        </Route>
      </Route>
    </Routes>
  );
}
