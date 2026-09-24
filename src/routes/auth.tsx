import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureDemoCoordinator, USERNAME_DOMAIN } from "@/lib/resq.functions";

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
  const [username, setUsername] = useState("umar");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void ensureDemoCoordinator({ data: undefined }).catch(() => undefined);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`,
      password,
    });
    setBusy(false);
    if (signInError) {
      setError("Incorrect username or password.");
      return;
    }
    void navigate({ to: "/command" });
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
              <span className="label-cap">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
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
            MVP demo coordinator — username <b>umar</b>, password <b>umar1234</b>.
          </p>
        </div>
      </div>
    </div>
  );
}
