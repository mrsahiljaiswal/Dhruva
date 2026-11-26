import { zodResolver } from "@hookform/resolvers/zod";
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from "@dhruva/shared";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/states/error-state";
import { Spinner } from "@/components/states/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { homeFor } from "@/features/auth/home";
import { useAuth } from "@/features/auth/auth-context";

function AuthScreen({ title, children }: { title: string; children: ReactNode }) {
  const { ready, unreachable } = useAuth();
  if (!ready) {
    return (
      <main className="p-6">
        <Spinner />
      </main>
    );
  }
  if (unreachable) {
    return (
      <main className="p-6">
        <ErrorState title="API unreachable" description="The server is not responding. Start it, then refresh this page." />
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      {children}
      {error ? <span className="text-destructive">{error}</span> : null}
    </label>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  if (user) {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  return (
    <AuthScreen title="Sign in">
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async (values) => {
          setMessage(null);
          try {
            await login(values.email, values.password);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "Sign in failed.");
          }
        })}
      >
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" {...form.register("email")} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register("password")} />
        </Field>
        {message ? <p role="alert">{message}</p> : null}
        <Button type="submit" className="w-full">
          Sign in
        </Button>
        <p className="text-sm">
          <Link to="/forgot-password">Forgot password</Link>
        </p>
      </form>
    </AuthScreen>
  );
}

export function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [done, setDone] = useState(false);
  const form = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  return (
    <AuthScreen title="Forgot password">
      {done ? (
        <p>If that account can sign in, a reset link is on its way.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            await forgotPassword(values.email);
            setDone(true);
          })}
        >
          <Field label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" {...form.register("email")} />
          </Field>
          <Button type="submit">Send reset link</Button>
        </form>
      )}
    </AuthScreen>
  );
}

export function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  const token = params.get("token") ?? "";
  const form = useForm({ resolver: zodResolver(resetPasswordSchema), defaultValues: { token, password: "" } });

  return (
    <AuthScreen title="Choose a new password">
      {done ? (
        <p>
          Password updated. <Link to="/login">Sign in</Link>
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            await resetPassword(values.token, values.password);
            setDone(true);
          })}
        >
          <Field label="New password" error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Button type="submit">Update password</Button>
        </form>
      )}
    </AuthScreen>
  );
}

export function AcceptInvitePage() {
  const { user, acceptInvite } = useAuth();
  const [params] = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const token = params.get("token") ?? "";
  const form = useForm({ resolver: zodResolver(acceptInviteSchema), defaultValues: { token, password: "" } });

  if (user) {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  return (
    <AuthScreen title="Create your password">
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async (values) => {
          setMessage(null);
          try {
            await acceptInvite(values.token, values.password);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "This link is invalid or has expired.");
          }
        })}
      >
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        {message ? <p role="alert">{message}</p> : null}
        <Button type="submit">Create password</Button>
      </form>
    </AuthScreen>
  );
}

export function ChangePasswordPage() {
  const { changePassword } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Change password</h1>
      {done ? (
        <p>Password updated.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setMessage(null);
            try {
              await changePassword(values.currentPassword, values.newPassword);
              setDone(true);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Could not change the password.");
            }
          })}
        >
          <Field label="Current password" error={form.formState.errors.currentPassword?.message}>
            <Input type="password" autoComplete="current-password" {...form.register("currentPassword")} />
          </Field>
          <Field label="New password" error={form.formState.errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" {...form.register("newPassword")} />
          </Field>
          {message ? <p role="alert">{message}</p> : null}
          <Button type="submit">Save password</Button>
        </form>
      )}
    </section>
  );
}
