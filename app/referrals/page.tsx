"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { logout, useUser } from "../lib/user";

type Slot = { id: string; start: string; end: string };

type Row = {
  taskId: string;
  description: string;
  status: string;
  priority?: string;
  when?: string;
  note?: string;
  patient: { id?: string; name: string; phone?: string; birthDate?: string };
};

/** The same Task reads differently depending on which side you're on. */
const SPECIALIST_LABEL: Record<string, string> = {
  requested: "New referral — awaiting your review",
  received: "Received",
  accepted: "Accepted — book the patient in",
  "in-progress": "Appointment scheduled",
  completed: "Completed",
};

const PCP_LABEL: Record<string, string> = {
  requested: "Sent — awaiting the specialist",
  received: "Received by the specialist",
  accepted: "Accepted by the specialist",
  "in-progress": "Appointment scheduled",
  completed: "Completed",
};

function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Referrals() {
  const user = useUser(["specialist", "pcp"]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [booked, setBooked] = useState<Record<string, string>>({});

  const load = () =>
    fetch("/api/referrals")
      .then((r) => r.json())
      .then((d) => setRows(d.referrals))
      .catch(() => setRows([]));

  useEffect(() => {
    load();
    fetch("/api/slots")
      .then((r) => r.json())
      .then((d) => setSlots(d.slots))
      .catch(() => {});
    const t = setInterval(load, 10000); // the queue stays live
    return () => clearInterval(t);
  }, []);

  const book = async (taskId: string, slotId: string) => {
    setBusy(taskId);
    const res = await fetch("/api/appointments/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, slotId }),
    });
    const data = await res.json();
    if (data.start) {
      setBooked((b) => ({ ...b, [taskId]: data.start }));
      setSlots((ss) => ss.filter((s) => s.id !== slotId));
      setPicking(null);
    }
    await load();
    setBusy(null);
  };

  const accept = async (taskId: string) => {
    setBusy(taskId);
    await fetch("/api/referrals/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    await load();
    setBusy(null);
  };

  if (!user) return null;

  return (
    <main className="room">
      <header className="topbar">
        <div className="mark">
          <svg className="stethLogo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" /><path d="M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4" /><circle cx="20" cy="10" r="2" /></svg>
          <strong>CoDoc</strong>
          <nav className="navlinks">
            <Link href="/">Live</Link>
            <Link className="on" href="/referrals">Referrals</Link>
            <Link href="/patients">Patients</Link>
          </nav>
        </div>
        <div className="controls">
          <span className="userChip">
            signed in as <b>{user.name}</b>
          </span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="pageBody">
        <h1 className="pageTitle">
          {user.role === "specialist" ? "Referral queue" : "Sent referrals"}
        </h1>
        {rows === null ? (
          <p className="empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty">No referrals in the queue.</p>
        ) : (
          <div className="stack">
            {rows.map((r) => (
              <div key={r.taskId} className="card refCard">
                <div className="refCardTop">
                  <span className="avatar">
                    {r.patient.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                  </span>
                  <div className="refMain">
                    <strong>
                      {r.patient.id ? (
                        <Link className="recLink" href={`/patients/${r.patient.id}`}>
                          {r.patient.name}
                        </Link>
                      ) : (
                        r.patient.name
                      )}
                    </strong>
                    <p>
                      {[
                        r.patient.birthDate && `DOB ${r.patient.birthDate}`,
                        r.patient.phone && `☎ ${r.patient.phone}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No contact details on file"}
                    </p>
                  </div>
                  {r.priority && <span className={`urg ${r.priority}`}>{r.priority}</span>}
                  {r.when && <span className="pill">{r.when}</span>}
                </div>

                <p className="ask">{r.description}</p>
                <p className="refStatus">
                  <span
                    className={`refDot ${
                      r.status === "requested" ? "sent" : r.status === "accepted" || r.status === "completed" ? "ok" : "wait"
                    }`}
                  />
                  {(user.role === "specialist" ? SPECIALIST_LABEL : PCP_LABEL)[r.status] ?? r.status}
                </p>

                {r.note && (
                  <div className="msg">
                    <span className="lbl">Referral note from the PCP</span>
                    <pre>{r.note}</pre>
                  </div>
                )}

                {booked[r.taskId] && (
                  <p className="refStatus">
                    <span className="refDot ok" />
                    Booked · {fmtSlot(booked[r.taskId])}
                  </p>
                )}

                {user.role === "specialist" && (
                  <div className="refActions">
                    {r.patient.phone && (
                      <a className="callBtn" href={`tel:${r.patient.phone}`}>
                        Call patient
                      </a>
                    )}
                    {r.status === "requested" && (
                      <button
                        className="confirm refAccept"
                        disabled={busy === r.taskId}
                        onClick={() => accept(r.taskId)}
                      >
                        {busy === r.taskId ? "Accepting…" : "Accept referral"}
                      </button>
                    )}
                    {r.status === "accepted" && picking !== r.taskId && (
                      <button
                        className="confirm refAccept"
                        onClick={() => setPicking(r.taskId)}
                      >
                        Book appointment
                      </button>
                    )}
                  </div>
                )}

                {user.role === "specialist" && picking === r.taskId && (
                  <div className="slotPick">
                    <span className="lbl">Open slots — Dr. Lee, Orthopedics</span>
                    <div className="slotGrid">
                      {slots.slice(0, 9).map((sl) => (
                        <button
                          key={sl.id}
                          className="slotBtn"
                          disabled={busy === r.taskId}
                          onClick={() => book(r.taskId, sl.id)}
                        >
                          {fmtSlot(sl.start)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
