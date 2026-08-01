/**
 * The clinical state assembled from the conversation. Every surface in the UI
 * is a pure function of this object — a section exists on screen only when the
 * conversation has produced the data that justifies it.
 */

/** Regions on the anatomical figure that light up as the patient speaks. */
export type BodySite =
  | "head"
  | "neck"
  | "chest"
  | "abdomen"
  | "pelvis"
  | "back"
  | "left_shoulder"
  | "right_shoulder"
  | "shoulder"
  | "left_arm"
  | "right_arm"
  | "arm"
  | "left_leg"
  | "right_leg"
  | "leg";

export type Symptom = {
  id: string;
  /** Clinical term, e.g. "exertional dyspnea". */
  term: string;
  /** The patient's own words, verbatim, so the clinician can check the mapping. */
  quote: string;
  onset?: string;
  severity?: string;
  /** Where on the body, when the symptom is localizable. */
  bodySite?: BodySite;
};

export type Vital = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  flag?: "high" | "low" | "normal";
};

export type Allergy = { id: string; substance: string; reaction?: string };
export type Medication = { id: string; name: string; dose?: string };

export type Insight = {
  id: string;
  level: "info" | "warn" | "critical";
  title: string;
  detail: string;
  /** Which findings drove this — shown so the doctor can audit the reasoning. */
  basis: string[];
};

export type DispatchStatus =
  | "pending" // implicit intent — waits for the doctor's tap
  | "composing" // agent is drafting the order note
  | "queued"; // order + note are in the specialist's FHIR work queue

export type Dispatch = {
  id: string;
  /** Who is being contacted, e.g. "Radiology". */
  target: string;
  label: string;
  urgency: "routine" | "urgent" | "stat";
  status: DispatchStatus;
  /** True when the doctor addressed the copilot directly ("CoDoc, ...") —
   *  the spoken command is the confirmation, so the agent executes itself. */
  directive?: boolean;
  /** The order note the agent drafted — travels with the referral. */
  message?: string;
  sentAt?: number;
};

export type Identity = {
  name: string;
  dob?: string;
  phone?: string;
  address?: string;
  pharmacy?: string;
};

export type ClinicalState = {
  /** Set once the patient states who they are; intake details accrete onto it. */
  identity: Identity | null;
  symptoms: Symptom[];
  vitals: Vital[];
  allergies: Allergy[];
  medications: Medication[];
  insights: Insight[];
  dispatches: Dispatch[];
};

export const EMPTY_STATE: ClinicalState = {
  identity: null,
  symptoms: [],
  vitals: [],
  allergies: [],
  medications: [],
  insights: [],
  dispatches: [],
};

/**
 * Stable ids derived from content, not position. Re-extraction returns the
 * whole state each time; content-derived ids keep React from remounting (and
 * re-animating) cards that were already on screen.
 */
export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function isEmpty(state: ClinicalState): boolean {
  return (
    state.identity === null &&
    state.symptoms.length === 0 &&
    state.vitals.length === 0 &&
    state.allergies.length === 0 &&
    state.medications.length === 0 &&
    state.insights.length === 0 &&
    state.dispatches.length === 0
  );
}

/**
 * Merge a freshly extracted state over the current one. Dispatches are special:
 * their status lives on the client (pending → sent → acked), so an existing
 * dispatch keeps its lifecycle rather than being reset by re-extraction.
 */
export function mergeState(
  prev: ClinicalState,
  next: ClinicalState,
): ClinicalState {
  const byId = new Map(prev.dispatches.map((d) => [d.id, d]));

  return {
    identity: next.identity
      ? { ...prev.identity, ...next.identity }
      : prev.identity,
    symptoms: next.symptoms,
    vitals: next.vitals,
    allergies: next.allergies,
    medications: next.medications,
    insights: next.insights,
    dispatches: next.dispatches.map((d) => byId.get(d.id) ?? d),
  };
}
