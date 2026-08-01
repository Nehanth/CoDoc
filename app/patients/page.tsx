"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { logout, useUser } from "../lib/user";

type Row = {
  id: string;
  name: string;
  birthDate?: string;
  gender?: string;
  lastUpdated?: string;
};

export default function Patients() {
  const user = useUser(["pcp", "specialist"]);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const scope = user.role === "specialist" ? "?scope=accepted" : "";
    fetch(`/api/patients${scope}`)
      .then((r) => r.json())
      .then((d) => setRows(d.patients))
      .catch(() => setRows([]));
  }, [user]);

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
        </div>
        <div className="controls">
          <span className="userChip">
            signed in as <b>{user?.name}</b>
          </span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="pageBody">
        <h1 className="pageTitle">Patients</h1>
        {rows === null ? (
          <p className="empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty">
            {user.role === "specialist"
              ? "No patients yet — accept a referral to see their chart."
              : "No patients yet — run a visit."}
          </p>
        ) : (
          <div className="plist">
            {rows.map((p) => (
              <Link key={p.id} href={`/patients/${p.id}`} className="prow">
                <span className="avatar">
                  {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </span>
                <span className="pname">{p.name}</span>
                <span className="pmeta">
                  {[p.gender, p.birthDate && `DOB ${p.birthDate}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="pmeta right">
                  {p.lastUpdated ? `updated ${p.lastUpdated.slice(0, 10)}` : ""}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
