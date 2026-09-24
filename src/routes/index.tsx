import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getRequestStatus } from "@/lib/resq.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ResQ AI — Request Emergency Help" },
      {
        name: "description",
        content:
          "ResQ AI emergency response: submit a help request with your location, severity and medical needs, then track its status by reference code.",
      },
      { property: "og:title", content: "ResQ AI — Request Emergency Help" },
      {
        property: "og:description",
        content: "Submit an emergency help request and track its response status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicPage,
});

const TYPES = [
  "Flood - trapped",
  "Flood - medical",
  "Flood - evacuation",
  "Flood - supplies",
  "Fire",
  "Structural collapse",
  "Other",
];
const SEVERITIES = ["critical", "high", "moderate", "low"];

type StatusRow = {
  ref_code: string;
  emergency_type: string;
  severity: string;
  people_count: number;
  zone: string | null;
  status: string;
  created_at: string;
};

function PublicPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const refCode = `RQ-${Math.floor(10000 + Math.random() * 89999)}`;
    const { error: insertError } = await supabase.from("emergency_requests").insert({
      ref_code: refCode,
      emergency_type: String(form.get("emergency_type")),
      severity: String(form.get("severity")),
      people_count: Number(form.get("people_count") || 1),
      medical_notes: String(form.get("medical_notes") || "") || null,
      location_text: String(form.get("location_text")),
      zone: String(form.get("zone") || "") || null,
      contact: String(form.get("contact") || "") || null,
    });
    setSubmitting(false);
    if (insertError) {
      setError("We could not send your request. Please try again.");
      return;
    }
    setTicket(refCode);
  }

  async function onLookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLookupMsg(null);
    const row = (await getRequestStatus({ data: { refCode: lookup } })) as StatusRow | null;
    setStatus(row);
    if (!row) setLookupMsg("No request found with that reference code.");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-sm bg-critical text-sm font-bold text-critical-foreground">
              RQ
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight">ResQ AI</p>
              <p className="text-xs opacity-70">Emergency Response Coordination</p>
            </div>
          </div>
          <Link
            to="/auth"
            className="rounded-sm border border-navy-foreground/30 px-3 py-1.5 text-xs font-semibold tracking-wide uppercase hover:bg-navy-muted"
          >
            Officer login
          </Link>
        </div>
      </header>

      <section className="border-b border-border bg-panel">
        <div className="mx-auto max-w-5xl px-5 py-10">
          <p className="label-cap">Active operation</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            Regional flood response — request help
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            If you or people near you need rescue, medical aid, evacuation or supplies, submit the
            form below. You will receive a reference code to track the response.
          </p>
          <p className="mt-3 text-sm font-semibold text-critical">
            Life-threatening emergency? Call your local emergency number first.
          </p>
        </div>
      </section>

      <main className="mx-auto grid max-w-5xl gap-6 px-5 py-8 md:grid-cols-[1.4fr_1fr]">
        <div className="panel p-6">
          <h2 className="text-lg font-semibold">Request help</h2>
          {ticket ? (
            <div className="mt-4 rounded-md border border-success/40 bg-success/10 p-5">
              <p className="label-cap">Request submitted</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-foreground">{ticket}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Save this reference code. Use it below to check your response status. A coordinator
                has been notified.
              </p>
              <button
                onClick={() => setTicket(null)}
                className="mt-4 rounded-sm border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                Submit another request
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-4 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Emergency type">
                  <select name="emergency_type" required className={inputCls}>
                    {TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Severity">
                  <select name="severity" required className={inputCls} defaultValue="high">
                    {SEVERITIES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field label="People affected">
                  <input name="people_count" type="number" min={1} defaultValue={1} className={inputCls} />
                </Field>
                <Field label="Zone (if known)">
                  <input name="zone" placeholder="Zone A - Riverside" className={inputCls} />
                </Field>
              </div>
              <Field label="Location / address">
                <input name="location_text" required placeholder="Street, landmark, floor" className={inputCls} />
              </Field>
              <Field label="Medical or vulnerability information (optional)">
                <textarea
                  name="medical_notes"
                  rows={3}
                  placeholder="Injuries, medication, infants, elderly, disability, oxygen…"
                  className={inputCls}
                />
              </Field>
              <Field label="Contact number (optional)">
                <input name="contact" className={inputCls} />
              </Field>
              {error && <p className="text-sm font-medium text-critical">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="rounded-sm bg-critical px-5 py-3 text-sm font-bold tracking-wide text-critical-foreground uppercase disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Request help"}
              </button>
            </form>
          )}
        </div>

        <div className="panel h-fit p-6">
          <h2 className="text-lg font-semibold">Check request status</h2>
          <form onSubmit={onLookup} className="mt-4 flex gap-2">
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="RQ-48211"
              className={inputCls}
            />
            <button className="rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Check
            </button>
          </form>
          {lookupMsg && <p className="mt-3 text-sm text-muted-foreground">{lookupMsg}</p>}
          {status && (
            <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-sm">
              <Row k="Reference" v={status.ref_code} />
              <Row k="Type" v={status.emergency_type} />
              <Row k="Severity" v={status.severity} />
              <Row k="People" v={String(status.people_count)} />
              <Row k="Zone" v={status.zone ?? "Unassigned"} />
              <Row k="Status" v={status.status} />
            </dl>
          )}
        </div>
      </main>
    </div>
  );
}

const inputCls =
  "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="label-cap">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
