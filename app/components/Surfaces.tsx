"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ClinicalState, Dispatch } from "../lib/clinical";
import { BodyMap } from "./BodyMap";

export type SurfaceApi = {
  send: (id: string) => void;
  /** id → synced FHIR resource, when Medplum mirroring is live. */
  refs: Record<string, { type: string; id: string }>;
};

/** Proof chip: this is a real FHIR resource in Medplum, not local state. */
function Fhir({ api, id }: { api: SurfaceApi; id: string }) {
  const ref = api.refs[id];
  if (!ref) return null;
  return (
    <span className="fhirChip" title={`${ref.type}/${ref.id}`}>
      {ref.type}
    </span>
  );
}

/**
 * A surface exists only once the conversation has produced the data to
 * justify it. `when` is the gate; nothing renders until it returns true.
 */
type Surface = {
  id: string;
  title: string;
  hint?: string;
  weight: number;
  when: (s: ClinicalState) => boolean;
  render: (s: ClinicalState, api: SurfaceApi) => React.ReactNode;
};

const CHART_SURFACES: Surface[] = [
  {
    id: "insights",
    title: "Clinical insights",
    hint: "what you might otherwise miss",
    weight: 0,
    when: (s) => s.insights.length > 0,
    render: (s, api) => (
      <div className="stack">
        {s.insights.map((i) => (
          <div key={i.id} className={`insight ${i.level}`}>
            <div className="top">
              <span className="tag">{i.level}</span>
              <strong>{i.title}</strong>
              <Fhir api={api} id={i.id} />
            </div>
            <p>{i.detail}</p>
            {i.basis.length > 0 && (
              <div className="basis">
                {i.basis.map((b) => (
                  <span key={b} className="chip">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "symptoms",
    title: "Symptoms",
    hint: "patient's words, clinically coded",
    weight: 1,
    when: (s) => s.symptoms.length > 0,
    render: (s, api) => (
      <div className="splitCard">
        <div className="stack">
          {s.symptoms.map((sym) => (
            <div key={sym.id} className="finding">
              <div className="term">
                {sym.term}
                {sym.severity && <span className="pill">{sym.severity}</span>}
                {sym.onset && <span className="pill">{sym.onset}</span>}
                <Fhir api={api} id={sym.id} />
              </div>
              <blockquote>&ldquo;{sym.quote}&rdquo;</blockquote>
            </div>
          ))}
        </div>
        <BodyMap symptoms={s.symptoms} />
      </div>
    ),
  },
  {
    id: "vitals",
    title: "Vitals",
    weight: 0.5,
    when: (s) => s.vitals.length > 0,
    render: (s, api) => (
      <div className="vitals">
        {s.vitals.map((v) => (
          <div key={v.id} className={`vital ${v.flag ?? ""}`}>
            <span className="k">
              {v.label} <Fhir api={api} id={v.id} />
            </span>
            <span className="v">
              {v.value}
              {v.unit && <em>{v.unit}</em>}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "allergies",
    title: "Allergies",
    weight: 3,
    when: (s) => s.allergies.length > 0,
    render: (s, api) => (
      <div className="stack">
        {s.allergies.map((a) => (
          <div key={a.id} className="finding">
            <div className="term">
              {a.substance} <Fhir api={api} id={a.id} />
            </div>
            {a.reaction && <p className="sub">{a.reaction}</p>}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "medications",
    title: "Medications",
    weight: 4,
    when: (s) => s.medications.length > 0,
    render: (s, api) => (
      <div className="stack">
        {s.medications.map((m) => (
          <div key={m.id} className="finding">
            <div className="term">
              {m.name}
              {m.dose && <span className="pill">{m.dose}</span>}
              <Fhir api={api} id={m.id} />
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

/** Widgets that are compact enough to sit two-up as squares. */
const SMALL = new Set(["vitals", "allergies", "medications"]);

export function ChartSurfaces({
  state,
  api,
}: {
  state: ClinicalState;
  api: SurfaceApi;
}) {
  const active = CHART_SURFACES.filter((s) => s.when(state)).sort(
    (a, b) => a.weight - b.weight,
  );

  // Packing: big widgets span the row; small ones pair up into squares.
  // A lone small widget — or the odd one out — stretches back to a rectangle.
  const smalls = active.filter((s) => SMALL.has(s.id));
  const span = (id: string, index: number): "w1" | "w2" => {
    if (!SMALL.has(id)) return "w2";
    if (smalls.length === 1) return "w2";
    const smallIndex = smalls.findIndex((s) => s.id === id);
    if (smalls.length % 2 === 1 && smallIndex === smalls.length - 1) return "w2";
    return "w1";
  };

  return (
    <AnimatePresence initial={false}>
      {active.map((surface, i) => (
        <motion.section
          key={surface.id}
          layout
          className={`card ${span(surface.id, i)}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <header>
            <h2>{surface.title}</h2>
            {surface.hint && <span className="hint">{surface.hint}</span>}
          </header>
          {surface.render(state, api)}
        </motion.section>
      ))}
    </AnimatePresence>
  );
}

/* ============ agent actions (live column) ============ */

const PIPELINE = ["composing", "queued"] as const;

const STEP_LABEL: Record<(typeof PIPELINE)[number], string> = {
  composing: "Drafting order note",
  queued: "In specialist queue",
};

export function ActionCard({ d, api }: { d: Dispatch; api: SurfaceApi }) {
  const stage = PIPELINE.indexOf(d.status as (typeof PIPELINE)[number]);
  const running = stage >= 0 && d.status !== "queued";
  const isRx = /pharmac/i.test(d.target);

  return (
    <motion.div
      layout
      className={`action ${d.status}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div className="actionTop">
        {d.directive && <span className="voice">voice</span>}
        <strong>{d.target}</strong>
        <span className={`urg ${d.urgency}`}>{d.urgency}</span>
      </div>

      <p className="ask">
        {d.label} <Fhir api={api} id={d.id} />
      </p>

      {d.status === "pending" && (
        <button className="confirm" onClick={() => api.send(d.id)}>
          Authorize
        </button>
      )}

      {stage >= 0 && (
        <div className="steps">
          {PIPELINE.map((step, i) => {
            const done = i < stage || d.status === "queued";
            const active = i === stage && running;
            return (
              <div
                key={step}
                className={`step ${done ? "done" : ""} ${active ? "active" : ""}`}
              >
                <span className="t">
                  {done ? "✓" : active ? <span className="spin" /> : "·"}
                </span>
                <span>
                  {isRx && step === "queued"
                    ? "Sent to pharmacy"
                    : isRx && step === "composing"
                      ? "Drafting prescription"
                      : STEP_LABEL[step]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {d.message && (
        <div className="msg">
          <span className="lbl">
            {isRx ? "e-prescription · demo pharmacy integration" : "Order note · sent with the referral"}
          </span>
          <pre>{d.message}</pre>
        </div>
      )}
    </motion.div>
  );
}
