import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOfficerLogin } from "@/lib/resq.functions";

function getSupabaseProjectWarning(): string | null {
  const url = import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"];
  const key =
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["SUPABASE_ANON_KEY"] ||
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (!url || !key) {
    return "Supabase project is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your environment.";
  }

  if (!key.startsWith("sb_publishable_")) {
    return "Supabase is configured with the wrong key type. Use the live project's anon/publishable key from the Supabase dashboard, not the service-role secret.";
  }

  return null;
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Officer Login — ResQ AI" },
      { name: "description", content: "Secure sign-in for ResQ AI response officers and coordinators." },
      { property: "og:title", content: "Officer Login — ResQ AI" },
      { property: "og:description", content: "Secure sign-in for ResQ AI response officers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const projectWarning = getSupabaseProjectWarning();
    if (projectWarning) {
      setError(projectWarning);
      setBusy(false);
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const account = await resolveOfficerLogin({ data: { email: normalizedEmail } });

      if (!account || !account.email || !['officer', 'coordinator'].includes(account.role)) {
        setError("Incorrect email or password.");
        setBusy(false);
        return;
      }

      const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
        email: account.email,
        password,
      });

      if (signInError || !authData.user) {
        const message = signInError?.message?.toLowerCase().includes("api key")
          ? "Supabase project configuration is invalid. Update the anon key in your environment to match the live project."
          : "Incorrect email or password.";
        setError(message);
        setBusy(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError || !profile || !['officer', 'coordinator'].includes(profile.role)) {
        await supabase.auth.signOut();
        setError("Incorrect email or password.");
        setBusy(false);
        return;
      }

      setBusy(false);
      void navigate({ to: "/command" });
    } catch (error) {
      const message = error instanceof Error && /api key|invalid api/i.test(error.message)
        ? "Supabase project configuration is invalid. Update the anon key in your environment to match the live project."
        : "Incorrect email or password.";
      setBusy(false);
      setError(message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 block text-center text-xs tracking-widest text-navy-foreground/60 uppercase">
          ← ResQ AI public site
        </Link>
        <div className="panel p-7">
          <p className="label-cap">Restricted access</p>
          <h1 className="mt-1 text-xl font-semibold">Officer / Coordinator sign-in</h1>
          <form onSubmit={onSubmit} className="mt-5 grid gap-4">
            <label className="grid gap-1.5">
              <span className="label-cap">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-sm border border-input px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="label-cap">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-sm border border-input px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              />
            </label>
            {error && <p className="text-sm font-medium text-critical">{error}</p>}
            <button
              disabled={busy}
              className="rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
            Use your registered officer or coordinator email and password.
          </p>
        </div>
      </div>
    </div>
  );
}
