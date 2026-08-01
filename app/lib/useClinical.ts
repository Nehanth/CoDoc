"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_STATE,
  mergeState,
  type ClinicalState,
  type Dispatch,
} from "./clinical";
import type { Turn } from "./turns";

/** Don't hammer the model on every interim word. */
const MIN_INTERVAL_MS = 2500;

/** Direct address to the copilot — jumps the debounce queue. */
const WAKE = /\bco[\s-]?doc\b/i;

type Options = {
  doctorSpeaker: number;
  /** Per-turn manual corrections: turn id → 0 (doctor) | 1 (patient). */
  roleOverrides: Record<string, 0 | 1>;
  /** Logged-in clinician — visits are attributed to them. */
  doctorName?: string;
};

/**
 * The runtime harness: watches the transcript, keeps the clinical picture in
 * sync, and executes voice-directed dispatches end to end — compose the page
 * with Claude, send, track delivery and acknowledgment — surfacing each step
 * to the UI as it happens.
 */
export type PatientHistory = {
  name: string;
  patientId?: string;
  birthDate?: string;
  gender?: string;
  age?: number;
  conditions: string[];
  medications: string[];
  allergies: string[];
  lastNote?: { date?: string; text: string };
  lastReport?: { title: string; conclusion?: string; when?: string };
};

export type FhirSync = {
  enabled: boolean;
  refs: Record<string, { type: string; id: string }>;
  total: number;
};

export function useClinical(
  turns: Turn[],
  { doctorSpeaker, roleOverrides, doctorName }: Options,
) {
  const [state, setState] = useState<ClinicalState>(EMPTY_STATE);
  const [thinking, setThinking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fhir, setFhir] = useState<FhirSync | null>(null);
  const fhirInFlight = useRef(false);
  const fhirDirty = useRef(false);
  const [inferredDoctor, setInferredDoctor] = useState<number | null>(null);
  const [history, setHistory] = useState<PatientHistory | null>(null);
  const [historyChecked, setHistoryChecked] = useState(false);
  const historyRef = useRef<PatientHistory | null>(null);
  /** Which spoken name we last looked up — re-check whenever it changes. */
  const historyName = useRef<string | null>(null);

  const inFlight = useRef(false);
  const lastRunAt = useRef(0);
  const pendingTurns = useRef<Turn[]>([]);
  const lastExtracted = useRef(0);
  /** Dispatch ids whose execution pipeline is already running. */
  const executing = useRef(new Set<string>());

  pendingTurns.current = turns;
  const identityRef = useRef<string | null>(null);
  identityRef.current = state.identity?.name ?? null;

  const overridesRef = useRef(roleOverrides);
  overridesRef.current = roleOverrides;

  /** Role-labelled transcript — used once roles are known (compose, etc.). */
  const transcriptText = useCallback(
    () =>
      pendingTurns.current
        .map((t) => {
          const role =
            overridesRef.current[t.id] ??
            (t.speaker === doctorSpeaker ? 0 : 1);
          return `${role === 0 ? "DOCTOR" : "PATIENT"}: ${t.text}`;
        })
        .join("\n"),
    [doctorSpeaker],
  );

  /** Raw diarization labels — extraction infers who the clinician is. */
  const rawTranscriptText = useCallback(() => {
    const overridden = Object.keys(overridesRef.current).length > 0;
    if (overridden) return transcriptText(); // user corrections are authoritative
    return pendingTurns.current
      .map((t) => `SPEAKER_${t.speaker}: ${t.text}`)
      .join("\n");
  }, [transcriptText]);

  const setDispatch = useCallback(
    (id: string, patch: Partial<Dispatch>) => {
      setState((prev) => ({
        ...prev,
        dispatches: prev.dispatches.map((d) =>
          d.id === id ? { ...d, ...patch } : d,
        ),
      }));
    },
    [],
  );

  /**
   * Execute one dispatch: draft the page → send → delivered → acked.
   * Every stage is written into state so the UI renders the agent working.
   */
  const execute = useCallback(
    async (dispatch: Dispatch) => {
      if (executing.current.has(dispatch.id)) return;
      executing.current.add(dispatch.id);

      setDispatch(dispatch.id, { status: "composing" });

      let message = `${dispatch.urgency.toUpperCase()} — ${dispatch.label}`;
      try {
        const res = await fetch("/api/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: dispatch.target,
            label: dispatch.label,
            urgency: dispatch.urgency,
            transcript: transcriptText(),
          }),
        });
        const data = await res.json();
        if (data.message) message = data.message;
      } catch {
        // keep the template fallback — the pipeline never stalls on stage
      }

      // Our side of the loop ends here: the order and its note are real FHIR
      // (ServiceRequest + Task) sitting in the specialist's work queue. What
      // happens next belongs to the receiving side's software.
      setDispatch(dispatch.id, { status: "queued", message, sentAt: Date.now() });
    },
    [setDispatch, transcriptText],
  );

  const run = useCallback(async () => {
    const snapshot = pendingTurns.current;
    if (inFlight.current || snapshot.length === 0) return;

    inFlight.current = true;
    lastRunAt.current = Date.now();
    lastExtracted.current = snapshot.length;
    setThinking(true);

    try {
      const h = historyRef.current;
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: rawTranscriptText(),
          history: h
            ? [
                `Patient: ${h.name}${h.age ? `, ${h.age}yo` : ""}${h.gender ? ` ${h.gender}` : ""}`,
                h.conditions.length ? `Conditions: ${h.conditions.join("; ")}` : "",
                h.medications.length ? `Medications: ${h.medications.join("; ")}` : "",
                h.allergies.length ? `Allergies: ${h.allergies.join("; ")}` : "",
                h.lastReport
                  ? `Last result (${h.lastReport.when ?? "prior"}): ${h.lastReport.title} — ${h.lastReport.conclusion ?? ""}`
                  : "",
                h.lastNote
                  ? `Last visit note (${h.lastNote.date ?? "prior"}): ${h.lastNote.text.slice(0, 400)}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n")
            : undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? `extract returned ${res.status}`);

      setState((prev) => mergeState(prev, data.state as ClinicalState));
      if (typeof data.doctorSpeaker === "number") {
        setInferredDoctor(data.doctorSpeaker);
      }
      setLatencyMs(data.latencyMs ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setThinking(false);
    }
  }, [transcriptText, rawTranscriptText]);

  // A manual role correction changes the transcript — re-read it.
  useEffect(() => {
    if (Object.keys(roleOverrides).length === 0) return;
    lastExtracted.current = 0;
    const timer = setTimeout(run, 400);
    return () => clearTimeout(timer);
  }, [roleOverrides, run]);

  // Re-extract when new finalized turns arrive. A "CoDoc" address skips the
  // debounce so the command executes at conversational speed.
  useEffect(() => {
    if (turns.length === 0 || turns.length === lastExtracted.current) return;

    const latest = turns[turns.length - 1];
    const urgent = WAKE.test(latest.text);

    const elapsed = Date.now() - lastRunAt.current;
    const wait = urgent ? 0 : Math.max(0, MIN_INTERVAL_MS - elapsed);
    const timer = setTimeout(run, wait);
    return () => clearTimeout(timer);
  }, [turns, run]);

  // The moment the patient says who they are — or corrects themselves —
  // pull that record from Medplum and re-run extraction with the history.
  useEffect(() => {
    const name = state.identity?.name;
    if (!name || historyName.current === name) return;
    historyName.current = name;
    setHistoryChecked(false);
    (async () => {
      try {
        const res = await fetch(`/api/history?name=${encodeURIComponent(name)}`);
        const data = await res.json();
        // A stale response for a superseded name must not win.
        if (historyName.current !== name) return;
        historyRef.current = data.history ?? null;
        setHistory(data.history ?? null);
        if (data.history) {
          lastExtracted.current = 0; // force a re-read with history in context
          void run();
        }
      } catch {
        // lookup failed — the visit continues without history
      } finally {
        if (historyName.current === name) setHistoryChecked(true);
      }
    })();
  }, [state.identity, run]);

  // Mirror every state change into Medplum as real FHIR, debounced and
  // single-flight; a change arriving mid-sync queues exactly one follow-up.
  useEffect(() => {
    if (
      state.symptoms.length +
        state.vitals.length +
        state.allergies.length +
        state.medications.length +
        state.insights.length +
        state.dispatches.length ===
      0
    )
      return;

    const timer = setTimeout(async function sync() {
      if (fhirInFlight.current) {
        fhirDirty.current = true;
        return;
      }
      fhirInFlight.current = true;
      try {
        const lines = pendingTurns.current.map((t) => ({
          role:
            (overridesRef.current[t.id] ??
              (t.speaker === doctorSpeaker ? 0 : 1)) === 0
              ? ("clinician" as const)
              : ("patient" as const),
          text: t.text,
        }));
        const res = await fetch("/api/fhir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, transcript: lines, doctor: doctorName }),
        });
        if (res.ok) setFhir((await res.json()) as FhirSync);
      } catch {
        // FHIR mirroring must never break the live experience
      } finally {
        fhirInFlight.current = false;
        if (fhirDirty.current) {
          fhirDirty.current = false;
          void sync();
        }
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [state, doctorSpeaker, doctorName]);

  // The agent loop: any directive dispatch that is still pending gets
  // executed autonomously — the spoken command was the authorization.
  useEffect(() => {
    for (const d of state.dispatches) {
      if (d.directive && d.status === "pending" && !executing.current.has(d.id)) {
        void execute(d);
      }
    }
  }, [state.dispatches, execute]);

  /** Manual confirm for implicit (non-directive) dispatches. */
  const send = useCallback(
    (id: string) => {
      const dispatch = state.dispatches.find((d) => d.id === id);
      if (dispatch) void execute(dispatch);
    },
    [state.dispatches, execute],
  );

  const [note, setNote] = useState<{ text: string; signing: boolean } | null>(
    null,
  );

  /** End of visit: draft + sign the SOAP note into Medplum. */
  const signNote = useCallback(async () => {
    if (pendingTurns.current.length === 0) return;
    setNote({ text: "", signing: true });
    try {
      const res = await fetch("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptText(),
          patientName: identityRef.current ?? undefined,
          doctor: doctorName,
        }),
      });
      const data = await res.json();
      setNote({ text: data.note ?? "(note generation failed)", signing: false });
    } catch {
      setNote({ text: "(note generation failed)", signing: false });
    }
  }, [transcriptText, doctorName]);

  const reset = useCallback(() => {
    setState(EMPTY_STATE);
    setNote(null);
    setLatencyMs(null);
    setError(null);
    setFhir(null);
    setHistory(null);
    setHistoryChecked(false);
    historyRef.current = null;
    historyName.current = null;
    lastExtracted.current = 0;
    executing.current.clear();
  }, []);

  return {
    state,
    thinking,
    latencyMs,
    error,
    fhir,
    history,
    historyChecked,
    inferredDoctor,
    note,
    signNote,
    send,
    reset,
  };
}

