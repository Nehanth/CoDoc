"use client";

import { useEffect, useState } from "react";
import { logout, useUser } from "../lib/user";
import type { ClinicalState } from "../lib/clinical";

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
  notes: { date?: string; text: string }[];
  visits: {
    date?: string;
    doctor?: string;
    transcript: { role: string; text: string }[];
    state: ClinicalState;
  }[];
  tasks: { description: string; status: string; when?: string }[];
};

/** Task status → plain language for the patient. */
const TASK_PLAIN: Record<string, string> = {
  draft: "Being prepared",
  requested: "Sent — the specialist's office will contact you",
  received: "Received by the specialist",
  accepted: "Accepted — expect a call to schedule",
  "in-progress": "In progress",
  completed: "Completed",
};

export default function Me() {
  const user = useUser(["patient"]);
  const [p, setP] = useState<Detail | null | undefined>(undefined);

  useEffect(() => {
    if (!user?.patientName) return;
    (async () => {
      try {
        const list = await fetch("/api/patients").then((r) => r.json());
        const mine = list.patients.find(
          (x: { name: string }) =>
            x.name.toLowerCase() === user.patientName!.toLowerCase(),
        );
        if (!mine) return setP(null);
        const d = await fetch(`/api/patients/${mine.id}`).then((r) => r.json());
        setP(d.patient);
      } catch {
        setP(null);
      }
    })();
  }, [user]);

  if (!user) return null;

  return (
    <main className="room">
      <header className="topbar">
        <div className="mark">
          <svg className="stethLogo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" /><path d="M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4" /><circle cx="20" cy="10" r="2" /></svg>
          <strong>CoDoc</strong>
          <span className="who-now">
            <b>My health record</b>
          </span>
        </div>
        <div className="controls">
          <span className="userChip">
            signed in as <b>{user.name}</b>
          </span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="pageBody">
        {p === undefined ? (
          <p className="empty">Loading your record…</p>
        ) : p === null ? (
          <p className="empty">We couldn&apos;t find your record.</p>
        ) : (
          <>
            <div className="card detailHead">
              <div className="who-card">
                <span className="avatar">
                  {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </span>
                <div>
                  <strong>{p.name}</strong>
                  <p>
                    {[p.birthDate && `DOB ${p.birthDate}`, p.phone, p.pharmacy]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              <div className="rows">
                {p.conditions.length > 0 && (
                  <div className="row">
                    <span className="k">Conditions</span>
                    <span className="v">{p.conditions.map((c) => c.text).join(" · ")}</span>
                  </div>
                )}
                {p.medications.length > 0 && (
                  <div className="row">
                    <span className="k">My meds</span>
                    <span className="v">{p.medications.join(" · ")}</span>
                  </div>
                )}
                {p.allergies.length > 0 && (
                  <div className="row alert">
                    <span className="k">Allergies</span>
                    <span className="v">⚠ {p.allergies.map((a) => a.substance).join(" · ")}</span>
                  </div>
                )}
              </div>
            </div>

            {p.tasks.length > 0 && (
              <section className="card detailHead">
                <header>
                  <h2>My referrals & orders</h2>
                  <span className="hint">what happens next</span>
                </header>
                <div className="stack">
                  {p.tasks.map((t, i) => (
                    <div key={i} className="refRow">
                      <span
                        className={`refDot ${
                          t.status === "requested" ? "sent" : t.status === "accepted" || t.status === "completed" ? "ok" : "wait"
                        }`}
                      />
                      <div className="refMain">
                        <strong>{t.description}</strong>
                        <p>{TASK_PLAIN[t.status] ?? t.status}</p>
                      </div>
                      {t.when && <span className="pill">{t.when}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {p.visits.length > 0 && (
              <section className="card detailHead">
                <header>
                  <h2>My conversations</h2>
                  <span className="hint">every visit, with every doctor</span>
                </header>
                <div className="stack">
                  {p.visits.map((v, i) => (
                    <MyVisit key={i} v={v} />
                  ))}
                </div>
              </section>
            )}

            {p.notes.filter((n) => n.text).length > 0 && (
              <section className="card detailHead">
                <header>
                  <h2>Visit summaries</h2>
                  <span className="hint">signed by your care team</span>
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
          </>
        )}
      </div>
    </main>
  );
}

function MyVisit({
  v,
}: {
  v: {
    date?: string;
    doctor?: string;
    transcript: { role: string; text: string }[];
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="visit">
      <div className="visitHead">
        <strong>{v.doctor ?? "Clinic visit"}</strong>
        {v.date && <span className="pill">{v.date}</span>}
        <span className="pill">{v.transcript.length} turns</span>
        <button className="expand" onClick={() => setOpen((o) => !o)}>
          {open ? "Collapse" : "View conversation"}
        </button>
      </div>
      {open && (
        <div className="visitTranscript" style={{ marginTop: 12, maxHeight: 360 }}>
          {v.transcript.map((l, i) => (
            <div key={i} className={`line role${l.role === "clinician" ? 0 : 1}`}>
              <span className="who">{l.role === "clinician" ? (v.doctor ?? "clinician") : "me"}</span>
              <p>{l.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
