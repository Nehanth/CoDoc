"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChartSurfaces } from "../../components/Surfaces";
import type { ClinicalState } from "../../lib/clinical";
import { logout, useUser } from "../../lib/user";

type Detail = {
  id: string;
  name: string;
  birthDate?: string;
  gender?: string;
  phone?: string;
  address?: string;
  pharmacy?: string;
  conditions: { text: string; onset?: string }[];
  medications: string[];
  allergies: { substance: string; note?: string }[];
  observations: { text: string; value?: string; when?: string; quote?: string }[];
  appointments: { start: string; description?: string; practitioner?: string }[];
  notes: { date?: string; text: string }[];
  visits: {
    date?: string;
    doctor?: string;
    transcript: { role: string; text: string }[];
    state: ClinicalState;
  }[];
  reports: { title: string; conclusion?: string; when?: string }[];
  tasks: { description: string; status: string; when?: string }[];
};

/** Task.status → what a human needs to know. */
const TASK_VIEW: Record<string, { label: string; tone: "wait" | "sent" | "ok" }> = {
  draft: { label: "Not sent — awaiting authorization", tone: "wait" },
  requested: { label: "Sent · in specialist queue", tone: "sent" },
  received: { label: "Received by specialist", tone: "sent" },
  accepted: { label: "Accepted by specialist", tone: "ok" },
  "in-progress": { label: "In progress", tone: "ok" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "wait" },
};

function Visit({
  v,
}: {
  v: { date?: string; transcript: { role: string; text: string }[]; state: ClinicalState };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="visit">
      <div className="visitHead">
        <strong>Visit</strong>
        {v.date && <span className="pill">{v.date}</span>}
        <span className="pill">{v.transcript.length} turns</span>
        <button className="expand" onClick={() => setOpen((o) => !o)}>
          {open ? "Collapse" : "Replay visit"}
        </button>
      </div>
      {open && (
        <div className="visitBody">
          <div className="visitTranscript">
            {v.transcript.map((l, i) => (
              <div key={i} className={`line role${l.role === "clinician" ? 0 : 1}`}>
                <span className="who">{l.role}</span>
                <p>{l.text}</p>
              </div>
            ))}
          </div>
          <div className="visitChart">
            <ChartSurfaces state={v.state} api={{ send: () => {}, refs: {} }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function PatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = useUser(["pcp", "specialist"]);
  const { id } = use(params);
  const [p, setP] = useState<Detail | null | undefined>(undefined);

  useEffect(() => {
    fetch(`/api/patients/${id}`)
      .then((r) => r.json())
      .then((d) => setP(d.patient))
      .catch(() => setP(null));
  }, [id]);

  if (!user) return null;

  return (
    <main className="room">
      <header className="topbar">
        <div className="mark">
          <svg className="stethLogo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" /><path d="M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4" /><circle cx="20" cy="10" r="2" /></svg>
          <strong>CoDoc</strong>
          <nav className="navlinks">
            <Link href="/">Live</Link>
            <Link href="/referrals">Referrals</Link>
            <Link className="on" href="/patients">Patients</Link>
          </nav>
          {p && (
            <span className="who-now">
              <b>{p.name}</b>
            </span>
          )}
        </div>
        <div className="controls">
          <span className="userChip">
            signed in as <b>{user?.name}</b>
          </span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="pageBody">
        {p === undefined ? (
          <p className="empty">Loading…</p>
        ) : p === null ? (
          <p className="empty">Patient not found.</p>
        ) : (
          <>
            {/* ---- identity ---- */}
            <div className="card detailHead">
              <div className="who-card">
                <span className="avatar">
                  {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </span>
                <div>
                  <strong>{p.name}</strong>
                  <p>
                    {[p.gender, p.birthDate && `DOB ${p.birthDate}`, p.phone]
                      .filter(Boolean)
                      .join(" · ") || "Demographics not on file"}
                  </p>
                </div>
              </div>
              <div className="rows">
                {p.conditions.length > 0 && (
                  <div className="row">
                    <span className="k">History</span>
                    <span className="v">
                      {p.conditions
                        .map((c) => c.text + (c.onset ? ` (since ${c.onset})` : ""))
                        .join(" · ")}
                    </span>
                  </div>
                )}
                {p.medications.length > 0 && (
                  <div className="row">
                    <span className="k">Meds</span>
                    <span className="v">{p.medications.join(" · ")}</span>
                  </div>
                )}
                {p.allergies.length > 0 && (
                  <div className="row alert">
                    <span className="k">Allergies</span>
                    <span className="v">
                      ⚠ {p.allergies.map((a) => a.substance).join(" · ")}
                    </span>
                  </div>
                )}
                {p.address && (
                  <div className="row">
                    <span className="k">Address</span>
                    <span className="v">{p.address}</span>
                  </div>
                )}
                {p.pharmacy && (
                  <div className="row">
                    <span className="k">Pharmacy</span>
                    <span className="v">{p.pharmacy}</span>
                  </div>
                )}
              </div>
            </div>

            {p.appointments.length > 0 && (
              <section className="card detailHead">
                <header>
                  <h2>Appointments</h2>
                </header>
                <div className="stack">
                  {p.appointments.map((a, i) => (
                    <div key={i} className="refRow">
                      <span className="refDot ok" />
                      <div className="refMain">
                        <strong>
                          {new Date(a.start).toLocaleString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </strong>
                        <p>{[a.practitioner, a.description].filter(Boolean).join(" · ")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ---- referrals & orders: the actions we took ---- */}
            {p.tasks.length > 0 && (
              <section className="card detailHead">
                <header>
                  <h2>Referrals & orders</h2>
                  <span className="hint">created by voice during visits</span>
                </header>
                <div className="stack">
                  {p.tasks.map((t, i) => {
                    const view = TASK_VIEW[t.status] ?? {
                      label: t.status,
                      tone: "wait" as const,
                    };
                    return (
                      <div key={i} className="refRow">
                        <span className={`refDot ${view.tone}`} />
                        <div className="refMain">
                          <strong>{t.description}</strong>
                          <p>{view.label}</p>
                        </div>
                        {t.when && <span className="pill">{t.when}</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ---- results (only real ones) ---- */}
            {p.reports.length > 0 && (
              <section className="card detailHead">
                <header>
                  <h2>Results</h2>
                  <span className="hint">DiagnosticReport</span>
                </header>
                <div className="stack">
                  {p.reports.map((r, i) => (
                    <div key={i} className="finding">
                      <div className="term">
                        {r.title}
                        {r.when && <span className="pill">{r.when}</span>}
                      </div>
                      {r.conclusion && <p className="sub">{r.conclusion}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ---- past visits, full replay ---- */}
            {(() => {
              // Chat history is private to the clinician who had it: a doctor
              // replays only their own visits (unattributed = legacy, shown).
              const mine = p.visits.filter(
                (v) => !v.doctor || v.doctor === user?.name,
              );
              return mine.length > 0 ? (
                <section className="card detailHead">
                  <header>
                    <h2>Your visits with this patient</h2>
                    <span className="hint">full replay — transcript & chart</span>
                  </header>
                  <div className="stack">
                    {mine.map((v, i) => (
                      <Visit key={i} v={v} />
                    ))}
                  </div>
                </section>
              ) : null;
            })()}

            {/* ---- notes & observations ---- */}
            <div className="detailGrid">
              {p.notes.filter((n) => n.text).length > 0 && (
                <section className="card">
                  <header>
                    <h2>Visit notes</h2>
                    <span className="hint">signed</span>
                  </header>
                  <div className="stack">
                    {p.notes
                      .filter((n) => n.text)
                      .map((n, i) => (
                        <div key={i} className="finding">
                          {n.date && <span className="pill">{n.date}</span>}
                          <pre className="note" style={{ marginTop: 8 }}>{n.text}</pre>
                        </div>
                      ))}
                  </div>
                </section>
              )}

              {p.observations.length > 0 && (
                <section className="card">
                  <header>
                    <h2>Observations</h2>
                    <span className="hint">most recent first</span>
                  </header>
                  <div className="stack">
                    {p.observations.slice(0, 10).map((o, i) => (
                      <div key={i} className="obsRow">
                        <span className="obsTerm">{o.text}</span>
                        {o.value && <span className="pill">{o.value}</span>}
                        {o.when && <span className="obsWhen">{o.when}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
