"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ActionCard, ChartSurfaces } from "./components/Surfaces";
import { isEmpty } from "./lib/clinical";
import { useClinical } from "./lib/useClinical";
import { useDeepgram } from "./lib/useDeepgram";
import { logout, useUser } from "./lib/user";

const ROLE_LABEL = ["Doctor", "Patient"] as const;

function Dots({ live, hero }: { live: boolean; hero?: boolean }) {
  if (hero) {
    // One large breathing dot once the session is live; quiet ring before.
    return <span className={`pulse ${live ? "on" : ""}`} />;
  }
  return (
    <span className={`dots ${live ? "on" : ""}`}>
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** Minimal stethoscope mark. */
function Steth() {
  return (
    <svg className="stethLogo" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
      <path d="M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4" />
      <circle cx="20" cy="10" r="2" />
    </svg>
  );
}

export default function Home() {
  const user = useUser(["pcp", "specialist"]);
  const {
    status,
    turns,
    interim,
    error: audioError,
    start,
    stop,
    reset: resetAudio,
  } = useDeepgram();

  const [doctorSpeaker, setDoctorSpeaker] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [roleOverrides, setRoleOverrides] = useState<Record<string, 0 | 1>>({});
  const {
    state,
    thinking,
    latencyMs,
    error: extractError,
    fhir,
    history,
    historyChecked,
    inferredDoctor,
    note,
    signNote,
    send,
    reset: resetClinical,
  } = useClinical(turns, {
    doctorSpeaker,
    roleOverrides,
    doctorName: user?.name,
  });
  // Claude reads the room: whoever examines and orders is the doctor.
  useEffect(() => {
    if (inferredDoctor !== null) setDoctorSpeaker(inferredDoctor);
  }, [inferredDoctor]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const roleOf = useMemo(
    () => (turnId: string, speaker: number) =>
      roleOverrides[turnId] ?? (speaker === doctorSpeaker ? 0 : 1),
    [doctorSpeaker, roleOverrides],
  );

  const flipRole = (turnId: string, speaker: number) =>
    setRoleOverrides((prev) => ({
      ...prev,
      [turnId]: ((roleOf(turnId, speaker) + 1) % 2) as 0 | 1,
    }));

  // Keep the conversation pinned to the newest words while the session runs.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, interim]);

  const live = status === "live";
  const started = turns.length > 0 || !isEmpty(state);
  const api = { send, refs: fhir?.refs ?? {} };

  if (!user) return null;

  return (
    <main className="room">
      <header className="topbar">
        <div className="mark">
          <Steth />
          <strong>CoDoc</strong>
          <nav className="navlinks">
            <a className="on" href="/">Live</a>
            <a href="/referrals">Referrals</a>
            <a href="/patients">Patients</a>
          </nav>
          {history ? (
            <span className="who-now">
              <b>{history.name}</b>
              {history.age ? ` · ${history.age}` : ""}
            </span>
          ) : state.identity ? (
            <span className="who-now">
              <b>{state.identity.name}</b> · new
            </span>
          ) : null}
          {fhir?.enabled && (
            <span className="fhir" title="Live FHIR resources in Medplum">
              Medplum · {fhir.total}
            </span>
          )}
          <span className="meta">
            {thinking ? "reading…" : latencyMs ? `${latencyMs}ms` : ""}
          </span>
        </div>

        <div className="controls">
          <span className="userChip">
            signed in as <b>{user.name}</b>
          </span>
          <button onClick={logout}>Log out</button>
          <button
            onClick={() => {
              resetAudio();
              resetClinical();
              setRoleOverrides({});
            }}
            disabled={turns.length === 0}
          >
            Clear
          </button>
          {live && turns.length > 0 && (
            <button
              className="sign"
              onClick={() => {
                stop();
                void signNote();
              }}
            >
              End visit · sign note
            </button>
          )}
          <button
            className={live ? "stop" : "go"}
            onClick={live ? stop : start}
            disabled={status === "connecting"}
          >
            {status === "connecting" ? "Connecting…" : live ? "Stop" : "Start session"}
          </button>
        </div>
      </header>

      {(audioError || extractError) && (
        <div className="error">{audioError ?? extractError}</div>
      )}

      {!started ? (
        <div className="idle">
          <div className="idleInner">
            <Dots live={live} hero />
            <h2>{live ? "Listening" : "Ready"}</h2>
            <p>
              {live
                ? "Talk normally. The chart writes itself."
                : "Start the session. Nothing appears on screen until the conversation calls for it."}
            </p>
          </div>
        </div>
      ) : (
        <div className="stage">
          {/* ---- left: the conversation ---- */}
          <aside className="convo">
            <div className="colHead">
              <h2>Conversation</h2>
              <Dots live={live} />
            </div>
            <div className="transcript" ref={scrollRef}>
              {turns.length === 0 && !interim && (
                <p className="empty">Waiting for the first words…</p>
              )}
              {turns.map((t) => (
                <Line
                  key={t.id}
                  role={roleOf(t.id, t.speaker)}
                  text={t.text}
                  onFlip={() => flipRole(t.id, t.speaker)}
                />
              ))}
              {interim && (
                <Line role={roleOf("", interim.speaker)} text={interim.text} pending />
              )}
            </div>
          </aside>

          {/* ---- middle: the record assembling itself ---- */}
          <div className="chart">
            <AnimatePresence initial={false}>
              <motion.section
                key="who"
                layout
                className="card w2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <header>
                  <h2>{history ? "Record on file" : state.identity ? "New chart" : "Patient"}</h2>
                  <span className="hint">
                    {history
                      ? "matched from Medplum"
                      : state.identity
                        ? "registered in Medplum"
                        : historyChecked
                          ? "unidentified"
                          : "listening for identity"}
                  </span>
                  {(history || state.identity) && (
                    <button
                      className="expand"
                      onClick={() => setDetailsOpen((v) => !v)}
                    >
                      {detailsOpen ? "Hide details" : "Details"}
                    </button>
                  )}
                </header>

                <div className="who-card">
                  <span className={`avatar ${history || state.identity ? "" : "ghost"}`}>
                    {history
                      ? history.name.split(" ").map((w) => w[0]).join("")
                      : state.identity
                        ? state.identity.name.split(" ").map((w) => w[0]).join("")
                        : "?"}
                  </span>
                  <div>
                    <strong>
                      {history?.name ?? state.identity?.name ?? "Awaiting identification"}
                    </strong>
                    <p>
                      {history
                        ? [
                            history.age && `${history.age} years`,
                            history.gender,
                            history.birthDate && `DOB ${history.birthDate}`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Demographics not on file"
                        : state.identity
                          ? "First visit · chart created from voice"
                          : "The chart loads when the patient says their name"}
                    </p>
                  </div>
                </div>

                {history &&
                  (history.conditions.length +
                    history.medications.length +
                    history.allergies.length >
                  0 ? (
                    <div className="rows">
                      {history.conditions.length > 0 && (
                        <div className="row">
                          <span className="k">History</span>
                          <span className="v">{history.conditions.join(" · ")}</span>
                        </div>
                      )}
                      {history.medications.length > 0 && (
                        <div className="row">
                          <span className="k">Meds</span>
                          <span className="v">{history.medications.join(" · ")}</span>
                        </div>
                      )}
                      {history.allergies.length > 0 && (
                        <div className="row alert">
                          <span className="k">Allergies</span>
                          <span className="v">⚠ {history.allergies.join(" · ")}</span>
                        </div>
                      )}
                      {history.lastReport && (
                        <div className="row">
                          <span className="k">Last result</span>
                          <span className="v">
                            {history.lastReport.title}
                            {history.lastReport.when ? ` (${history.lastReport.when})` : ""}
                            {history.lastReport.conclusion
                              ? ` — ${history.lastReport.conclusion}`
                              : ""}
                          </span>
                        </div>
                      )}
                      {history.lastNote && (
                        <div className="row">
                          <span className="k">Last visit</span>
                          <span className="v clamp">
                            {history.lastNote.date ? `${history.lastNote.date} · ` : ""}
                            {history.lastNote.text}
                          </span>
                        </div>
                      )}
                      {history.patientId && (
                        <div className="row">
                          <span className="k">Full record</span>
                          <span className="v">
                            <a className="recLink" href={`/patients/${history.patientId}`}>
                              Open chart →
                            </a>
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rows">
                      <div className="row">
                        <span className="k">History</span>
                        <span className="v">No prior history on file</span>
                      </div>
                    </div>
                  ))}
                {detailsOpen && (history || state.identity) && (
                  <div className="rows">
                    {[
                      ["DOB", state.identity?.dob ?? history?.birthDate],
                      ["Phone", state.identity?.phone],
                      ["Address", state.identity?.address],
                      ["Pharmacy", state.identity?.pharmacy],
                    ].filter(([, v]) => v).length === 0 ? (
                      <div className="row">
                        <span className="k">Intake</span>
                        <span className="v">No intake details captured yet</span>
                      </div>
                    ) : (
                      (
                        [
                          ["DOB", state.identity?.dob ?? history?.birthDate],
                          ["Phone", state.identity?.phone],
                          ["Address", state.identity?.address],
                          ["Pharmacy", state.identity?.pharmacy],
                        ] as [string, string | undefined][]
                      )
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <div key={k} className="row">
                            <span className="k">{k}</span>
                            <span className="v">{v}</span>
                          </div>
                        ))
                    )}
                  </div>
                )}
              </motion.section>
            </AnimatePresence>

            <ChartSurfaces state={state} api={api} />

            {note && (
              <motion.section
                layout
                className="card w2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <header>
                  <h2>Visit note</h2>
                  <span className="hint">
                    {note.signing ? "drafting…" : "signed · DocumentReference"}
                  </span>
                </header>
                {note.signing ? (
                  <div className="signing">
                    <span className="spin" /> Writing the SOAP note from the transcript…
                  </div>
                ) : (
                  <pre className="note">{note.text}</pre>
                )}
              </motion.section>
            )}
          </div>

          {/* ---- right: what the agent is doing ---- */}
          <aside className="actions">
            <div className="colHead">
              <h2>Actions</h2>
              {state.dispatches.length > 0 && (
                <span className="meta">{state.dispatches.length}</span>
              )}
            </div>
            {state.dispatches.length === 0 ? (
              <p className="colEmpty">
                Orders, pages and referrals appear here the moment they&apos;re
                spoken.
              </p>
            ) : (
              <div className="colBody">
                {state.dispatches.map((d) => (
                  <ActionCard key={d.id} d={d} api={api} />
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function Line({
  role,
  text,
  pending,
  onFlip,
}: {
  role: number;
  text: string;
  pending?: boolean;
  onFlip?: () => void;
}) {
  return (
    <div
      className={`line role${role} ${pending ? "pending" : ""} ${onFlip ? "flippable" : ""}`}
      onClick={onFlip}
      title={onFlip ? "Click to switch speaker" : undefined}
    >
      <span className="who">{ROLE_LABEL[role]}</span>
      <p>{text}</p>
    </div>
  );
}
