import { ClientStorage, MedplumClient, MemoryStorage } from "@medplum/core";
import type {
  AllergyIntolerance,
  Communication,
  MedicationRequest,
  DetectedIssue,
  DiagnosticReport,
  DocumentReference,
  Encounter,
  MedicationStatement,
  Observation,
  Patient,
  Reference,
  Resource,
  ServiceRequest,
  Task,
} from "@medplum/fhirtypes";
import { slug, type ClinicalState, type Dispatch, type Identity } from "./clinical";

/** Identifier system marking every resource this app writes. */
const SYS = "https://codoc.demo/id";

let clientPromise: Promise<MedplumClient> | null = null;

export function medplumEnabled(): boolean {
  return Boolean(process.env.MEDPLUM_CLIENT_ID && process.env.MEDPLUM_CLIENT_SECRET);
}

function getClient(): Promise<MedplumClient> {
  clientPromise ??= (async () => {
    const medplum = new MedplumClient({
      baseUrl: process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/",
      storage: new ClientStorage(new MemoryStorage()),
    });
    await medplum.startClientLogin(
      process.env.MEDPLUM_CLIENT_ID!,
      process.env.MEDPLUM_CLIENT_SECRET!,
    );
    return medplum;
  })();
  return clientPromise;
}

type Context = { patient: Reference<Patient>; encounter: Reference<Encounter> };
const contexts = new Map<string, Promise<Context>>();

/**
 * Resolve the chart to write into. A spoken name finds the existing patient
 * or registers a new one; before anyone identifies themselves, findings go
 * to an anonymous walk-in chart.
 */
function getContext(name?: string): Promise<Context> {
  const key = name ? `patient-${slug(name)}` : "walk-in";
  let promise = contexts.get(key);
  if (promise) return promise;

  promise = (async () => {
    const medplum = await getClient();

    let patient: Patient | undefined;
    if (name) {
      // Prefer an existing chart with this name (e.g. seeded Robert Chen).
      const given = name.trim().split(/\s+/)[0];
      patient = await medplum.searchOne("Patient", `name=${encodeURIComponent(given)}`);
    }
    if (!patient) {
      const parts = (name ?? "Walk-in Patient").trim().split(/\s+/);
      patient = await medplum.upsertResource<Patient>(
        {
          resourceType: "Patient",
          identifier: [{ system: SYS, value: key }],
          name: [{ given: parts.slice(0, -1), family: parts[parts.length - 1] }],
        },
        `identifier=${SYS}|${key}`,
      );
    }

    const encounter = await medplum.upsertResource<Encounter>(
      {
        resourceType: "Encounter",
        identifier: [{ system: SYS, value: `encounter-${key}` }],
        status: "in-progress",
        class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB" },
        subject: { reference: `Patient/${patient.id}` },
      },
      `identifier=${SYS}|encounter-${key}`,
    );
    return {
      patient: { reference: `Patient/${patient.id}` },
      encounter: { reference: `Encounter/${encounter.id}` },
    };
  })();
  contexts.set(key, promise);
  return promise;
}

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

/**
 * The read direction: given a spoken name, find the patient in Medplum and
 * pull their pre-existing record — conditions, meds, allergies.
 */
export async function loadHistory(name: string): Promise<PatientHistory | null> {
  const medplum = await getClient();
  const given = name.trim().split(/\s+/)[0];
  const patient = await medplum.searchOne("Patient", `name=${encodeURIComponent(given)}`);
  if (!patient?.id) return null;

  const pid = `Patient/${patient.id}`;
  const [allConditions, allMeds, allAllergies, docs, reports] = await Promise.all([
    medplum.searchResources("Condition", `subject=${pid}&_count=20`),
    medplum.searchResources("MedicationStatement", `subject=${pid}&_count=20`),
    medplum.searchResources("AllergyIntolerance", `patient=${pid}&_count=20`),
    medplum.searchResources("DocumentReference", `subject=${pid}&_count=1&_sort=-_lastUpdated`),
    medplum.searchResources("DiagnosticReport", `subject=${pid}&_count=1&_sort=-_lastUpdated`),
  ]);

  // History = only what predates this visit; exclude today's session writes.
  const isPrior = (r: { identifier?: { system?: string }[] }) =>
    !r.identifier?.some((i) => i.system === SYS);
  const conditions = allConditions.filter(isPrior);
  const meds = allMeds.filter(isPrior);
  const allergies = allAllergies.filter(isPrior);

  const display = [
    patient.name?.[0]?.given?.join(" "),
    patient.name?.[0]?.family,
  ]
    .filter(Boolean)
    .join(" ");

  const age = patient.birthDate
    ? Math.floor((Date.now() - new Date(patient.birthDate).getTime()) / 31557600000)
    : undefined;

  const noteText = docs[0]
    ? Buffer.from(docs[0].content?.[0]?.attachment?.data ?? "", "base64").toString("utf8")
    : "";

  return {
    name: display || name,
    patientId: patient.id,
    lastNote: noteText
      ? { date: docs[0]?.date?.slice(0, 10), text: noteText }
      : undefined,
    lastReport: reports[0]
      ? {
          title: reports[0].code?.text ?? "Report",
          conclusion: reports[0].conclusion,
          when: reports[0].issued?.slice(0, 10),
        }
      : undefined,
    birthDate: patient.birthDate,
    gender: patient.gender,
    age,
    conditions: conditions.map((c) => c.code?.text ?? "").filter(Boolean),
    medications: meds.map((m) => m.medicationCodeableConcept?.text ?? "").filter(Boolean),
    allergies: allergies.map((a) => a.code?.text ?? "").filter(Boolean),
  };
}

const TASK_STATUS: Record<Dispatch["status"], Task["status"]> = {
  pending: "draft",
  composing: "requested",
  queued: "requested", // in the receiving service's queue, awaiting their side
};

export type FhirRef = { type: string; id: string };

/**
 * Idempotently mirror the extracted clinical state into Medplum. Content-derived
 * identifiers mean re-extraction updates resources instead of duplicating them.
 */
/** Skip redundant Patient updates: last-written demographics per chart. */
const demoWritten = new Map<string, string>();

async function writeDemographics(medplum: MedplumClient, ctx: Context, identity: Identity) {
  const payload = JSON.stringify([identity.dob, identity.phone, identity.address, identity.pharmacy]);
  if (payload === "[null,null,null,null]") return;
  const key = ctx.patient.reference as string;
  if (demoWritten.get(key) === payload) return;
  demoWritten.set(key, payload);

  const id = key.split("/")[1];
  const patient = await medplum.readResource("Patient", id);
  await medplum.updateResource({
    ...patient,
    ...(identity.dob ? { birthDate: identity.dob } : {}),
    ...(identity.phone
      ? { telecom: [{ system: "phone" as const, value: identity.phone }] }
      : {}),
    ...(identity.address ? { address: [{ text: identity.address }] } : {}),
    ...(identity.pharmacy
      ? {
          extension: [
            { url: "https://codoc.demo/preferred-pharmacy", valueString: identity.pharmacy },
          ],
        }
      : {}),
  });
}

export type TranscriptLine = { role: "clinician" | "patient"; text: string };

export async function syncState(
  state: ClinicalState,
  transcript?: TranscriptLine[],
  doctor?: string,
): Promise<{ refs: Record<string, FhirRef>; total: number }> {
  const medplum = await getClient();
  const ctx = await getContext(state.identity?.name);
  const refs: Record<string, FhirRef> = {};
  /** All identifiers are patient-scoped so charts never bleed into each other. */
  const pkey = state.identity ? `patient-${slug(state.identity.name)}` : "walk-in";

  if (state.identity) {
    try {
      await writeDemographics(medplum, ctx, state.identity);
    } catch (err) {
      console.error("[fhir] demographics update failed:", err);
    }
  }

  const upsert = async <T extends Resource & { id?: string }>(
    key: string,
    resource: T,
  ) => {
    const scoped = `${pkey}-${key}`;
    const saved = await medplum.upsertResource(
      { ...resource, identifier: [{ system: SYS, value: scoped }] } as T,
      `identifier=${SYS}|${scoped}`,
    );
    refs[key] = { type: saved.resourceType, id: saved.id as string };
    return saved;
  };

  const jobs: Promise<unknown>[] = [];

  for (const s of state.symptoms) {
    jobs.push(
      upsert<Observation>(s.id, {
        resourceType: "Observation",
        status: "preliminary",
        code: { text: s.term },
        note: [{ text: `Patient: "${s.quote}"` }],
        ...(s.bodySite ? { bodySite: { text: s.bodySite.replace(/_/g, " ") } } : {}),
        subject: ctx.patient,
        encounter: ctx.encounter,
      }),
    );
  }

  for (const v of state.vitals) {
    jobs.push(
      upsert<Observation>(v.id, {
        resourceType: "Observation",
        status: "final",
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "vital-signs",
              },
            ],
          },
        ],
        code: { text: v.label },
        valueString: v.unit ? `${v.value} ${v.unit}` : v.value,
        subject: ctx.patient,
        encounter: ctx.encounter,
      }),
    );
  }

  for (const a of state.allergies) {
    jobs.push(
      upsert<AllergyIntolerance>(a.id, {
        resourceType: "AllergyIntolerance",
        clinicalStatus: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              code: "active",
            },
          ],
        },
        code: { text: a.substance },
        patient: ctx.patient,
        ...(a.reaction ? { note: [{ text: a.reaction }] } : {}),
      }),
    );
  }

  for (const m of state.medications) {
    jobs.push(
      upsert<MedicationStatement>(m.id, {
        resourceType: "MedicationStatement",
        status: "active",
        medicationCodeableConcept: { text: m.dose ? `${m.name} ${m.dose}` : m.name },
        subject: ctx.patient,
      }),
    );
  }

  const severity = { critical: "high", warn: "moderate", info: "low" } as const;
  for (const i of state.insights) {
    jobs.push(
      upsert<DetectedIssue>(i.id, {
        resourceType: "DetectedIssue",
        status: "preliminary",
        severity: severity[i.level],
        code: { text: i.title },
        detail: `${i.detail} [basis: ${i.basis.join(", ")}]`,
        patient: ctx.patient,
      }),
    );
  }

  for (const d of state.dispatches) {
    // A prescription heading to a pharmacy is a MedicationRequest, not a referral.
    if (/pharmac/i.test(d.target)) {
      jobs.push(
        upsert<MedicationRequest>(`${d.id}-rx`, {
          resourceType: "MedicationRequest",
          status: d.status === "queued" ? "active" : "draft",
          intent: "order",
          medicationCodeableConcept: { text: d.label },
          subject: ctx.patient,
          encounter: ctx.encounter,
          ...(d.message ? { note: [{ text: d.message }] } : {}),
        }),
      );
      continue;
    }
    jobs.push(
      (async () => {
        const sr = await upsert<ServiceRequest>(`${d.id}-order`, {
          resourceType: "ServiceRequest",
          status: "active",
          intent: "order",
          priority: d.urgency,
          code: { text: d.label },
          subject: ctx.patient,
          encounter: ctx.encounter,
        });
        await upsert<Task>(d.id, {
          resourceType: "Task",
          status: TASK_STATUS[d.status],
          intent: "order",
          priority: d.urgency,
          description: `${d.target}: ${d.label}`,
          focus: { reference: `ServiceRequest/${sr.id}` },
          for: ctx.patient,
          encounter: ctx.encounter,
        });
        if (d.message) {
          await upsert<Communication>(`${d.id}-page`, {
            resourceType: "Communication",
            status: "completed",
            subject: ctx.patient,
            encounter: ctx.encounter,
            payload: [{ contentString: d.message }],
          });
        }
      })(),
    );
  }

  // The whole visit — transcript plus widget state — saved as a record the
  // Patients tab can replay later.
  if (transcript?.length) {
    // One visit record per doctor-patient pair — histories stay modular.
    const key = `visit-${pkey}-${slug(doctor ?? "clinic")}`;
    jobs.push(
      medplum.upsertResource(
        {
          resourceType: "DocumentReference",
          identifier: [{ system: SYS, value: key }],
          status: "current",
          type: { text: "CoDoc visit record" },
          subject: ctx.patient,
          context: { encounter: [ctx.encounter] },
          date: new Date().toISOString(),
          content: [
            {
              attachment: {
                contentType: "application/json",
                data: Buffer.from(
                  JSON.stringify({ transcript, state, doctor }),
                  "utf8",
                ).toString("base64"),
                title: "CoDoc visit record",
              },
            },
          ],
        },
        `identifier=${SYS}|${key}`,
      ),
    );
  }

  await Promise.all(jobs);
  // +2 for Patient and Encounter
  return { refs, total: Object.keys(refs).length + 2 };
}


/** Sign the visit note into the chart as a DocumentReference. */
export async function writeNote(
  noteText: string,
  patientName?: string,
  doctor?: string,
): Promise<FhirRef> {
  const medplum = await getClient();
  const ctx = await getContext(patientName);
  const key = `note-${patientName ? slug(patientName) : "walk-in"}-${slug(doctor ?? "clinic")}`;
  const doc = await medplum.upsertResource<DocumentReference>(
    {
      resourceType: "DocumentReference",
      identifier: [{ system: SYS, value: key }],
      status: "current",
      type: { text: "Visit note" },
      subject: ctx.patient,
      context: { encounter: [ctx.encounter] },
      date: new Date().toISOString(),
      content: [
        {
          attachment: {
            contentType: "text/plain",
            data: Buffer.from(noteText, "utf8").toString("base64"),
            title: "Visit note",
          },
        },
      ],
    },
    `identifier=${SYS}|${key}`,
  );
  return { type: "DocumentReference", id: doc.id as string };
}

/** The result coming back: a DiagnosticReport tied to the original order. */
export async function writeReport(
  dispatchId: string,
  label: string,
  conclusion: string,
  patientName?: string,
): Promise<FhirRef> {
  const medplum = await getClient();
  const ctx = await getContext(patientName);
  const order = await medplum.searchOne(
    "ServiceRequest",
    `identifier=${SYS}|${dispatchId}-order`,
  );
  const key = `${dispatchId}-report`;
  const report = await medplum.upsertResource<DiagnosticReport>(
    {
      resourceType: "DiagnosticReport",
      identifier: [{ system: SYS, value: key }],
      status: "final",
      code: { text: label },
      subject: ctx.patient,
      encounter: ctx.encounter,
      conclusion,
      issued: new Date().toISOString(),
      ...(order?.id
        ? { basedOn: [{ reference: `ServiceRequest/${order.id}` }] }
        : {}),
    },
    `identifier=${SYS}|${key}`,
  );
  return { type: "DiagnosticReport", id: report.id as string };
}

/* ============ patient browser (Patients tab) ============ */

export type PatientSummaryRow = {
  id: string;
  name: string;
  birthDate?: string;
  gender?: string;
  lastUpdated?: string;
};

export async function listPatients(): Promise<PatientSummaryRow[]> {
  const medplum = await getClient();
  const patients = await medplum.searchResources("Patient", "_count=50&_sort=-_lastUpdated");
  return patients.map((p) => ({
    id: p.id as string,
    name:
      [p.name?.[0]?.given?.join(" "), p.name?.[0]?.family].filter(Boolean).join(" ") ||
      "(unnamed)",
    birthDate: p.birthDate,
    gender: p.gender,
    lastUpdated: p.meta?.lastUpdated,
  }));
}

export type PatientDetail = {
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
  tasks: { id: string; description: string; status: string; when?: string }[];
};

function decodeAttachment(data?: string): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export async function patientDetail(id: string): Promise<PatientDetail | null> {
  const medplum = await getClient();
  const patient = await medplum.readResource("Patient", id).catch(() => null);
  if (!patient) return null;
  const pid = `Patient/${id}`;

  const [conditions, meds, allergies, observations, docs, reports, tasks, appointments] =
    await Promise.all([
      medplum.searchResources("Condition", `subject=${pid}&_count=30`),
      medplum.searchResources("MedicationStatement", `subject=${pid}&_count=30`),
      medplum.searchResources("AllergyIntolerance", `patient=${pid}&_count=30`),
      medplum.searchResources("Observation", `subject=${pid}&_count=40&_sort=-_lastUpdated`),
      medplum.searchResources("DocumentReference", `subject=${pid}&_count=10&_sort=-_lastUpdated`),
      medplum.searchResources("DiagnosticReport", `subject=${pid}&_count=10&_sort=-_lastUpdated`),
      medplum.searchResources("Task", `patient=${pid}&_count=20&_sort=-_lastUpdated`),
      medplum.searchResources("Appointment", `actor=${pid}&_count=20&_sort=date`),
    ]);

  const visits: PatientDetail["visits"] = [];
  const noteDocs: { date?: string; text: string }[] = [];
  for (const d of docs) {
    const att = d.content?.[0]?.attachment;
    const raw = decodeAttachment(att?.data);
    if (att?.contentType === "application/json") {
      try {
        const parsed = JSON.parse(raw);
        visits.push({
          date: d.date?.slice(0, 16).replace("T", " "),
          doctor: parsed.doctor,
          transcript: parsed.transcript ?? [],
          state: parsed.state,
        });
      } catch {
        // corrupt record — skip
      }
    } else if (raw) {
      noteDocs.push({ date: d.date?.slice(0, 16).replace("T", " "), text: raw });
    }
  }

  return {
    id,
    name:
      [patient.name?.[0]?.given?.join(" "), patient.name?.[0]?.family]
        .filter(Boolean)
        .join(" ") || "(unnamed)",
    birthDate: patient.birthDate,
    gender: patient.gender,
    appointments: appointments
      .filter((a) => a.status === "booked")
      .map((a) => ({
        start: a.start as string,
        description: a.description,
        practitioner: a.participant?.find((x) =>
          x.actor?.reference?.startsWith("Practitioner/"),
        )?.actor?.display,
      })),
    phone: patient.telecom?.find((t) => t.system === "phone")?.value,
    address: patient.address?.[0]?.text,
    pharmacy: patient.extension?.find(
      (e) => e.url === "https://codoc.demo/preferred-pharmacy",
    )?.valueString,
    visits,
    conditions: conditions.map((c) => ({
      text: c.code?.text ?? "",
      onset: c.onsetDateTime?.slice(0, 10),
    })),
    medications: meds.map((m) => m.medicationCodeableConcept?.text ?? "").filter(Boolean),
    allergies: allergies.map((a) => ({
      substance: a.code?.text ?? "",
      note: a.note?.[0]?.text,
    })),
    observations: observations.map((o) => ({
      text: o.code?.text ?? "",
      value: o.valueString ?? o.bodySite?.text,
      when: o.meta?.lastUpdated?.slice(0, 16).replace("T", " "),
      quote: o.note?.[0]?.text,
    })),
    notes: noteDocs,
    reports: reports.map((r) => ({
      title: r.code?.text ?? "Report",
      conclusion: r.conclusion,
      when: r.issued?.slice(0, 16).replace("T", " "),
    })),
    tasks: tasks.map((t) => ({
      id: t.id as string,
      description: t.description ?? "",
      status: t.status ?? "",
      when: t.meta?.lastUpdated?.slice(0, 16).replace("T", " "),
    })),
  };
}

/* ============ referral inbox (specialist side) ============ */

export type ReferralRow = {
  taskId: string;
  description: string;
  status: string;
  priority?: string;
  when?: string;
  note?: string;
  patient: { id?: string; name: string; phone?: string; birthDate?: string };
};

export async function listReferrals(): Promise<ReferralRow[]> {
  const medplum = await getClient();
  const tasks = await medplum.searchResources(
    "Task",
    "_count=30&_sort=-_lastUpdated&status=requested,received,accepted,in-progress,completed",
  );

  const rows: ReferralRow[] = [];
  for (const t of tasks) {
    const patientRef = t.for?.reference;
    let patient: ReferralRow["patient"] = { name: "(unknown patient)" };
    if (patientRef?.startsWith("Patient/")) {
      const p = await medplum
        .readResource("Patient", patientRef.split("/")[1])
        .catch(() => null);
      if (p) {
        patient = {
          id: p.id,
          name:
            [p.name?.[0]?.given?.join(" "), p.name?.[0]?.family]
              .filter(Boolean)
              .join(" ") || "(unnamed)",
          phone: p.telecom?.find((x) => x.system === "phone")?.value,
          birthDate: p.birthDate,
        };
      }
    }

    // The order note the agent drafted travels as a Communication keyed
    // off the same dispatch identifier.
    const dispatchId = t.identifier?.find((i) => i.system === SYS)?.value;
    let note: string | undefined;
    if (dispatchId) {
      const comm = await medplum
        .searchOne("Communication", `identifier=${SYS}|${dispatchId}-page`)
        .catch(() => null);
      note = comm?.payload?.[0]?.contentString;
    }

    rows.push({
      taskId: t.id as string,
      description: t.description ?? "",
      status: t.status ?? "unknown",
      priority: t.priority,
      when: t.meta?.lastUpdated?.slice(0, 16).replace("T", " "),
      note,
      patient,
    });
  }
  return rows;
}

export async function acceptReferral(taskId: string): Promise<string> {
  const medplum = await getClient();
  const task = await medplum.readResource("Task", taskId);
  const updated = await medplum.updateResource({ ...task, status: "accepted" });
  return updated.status as string;
}


/** Patient ids from referrals the specialist side has accepted (or beyond). */
export async function acceptedPatientIds(): Promise<Set<string>> {
  const medplum = await getClient();
  const tasks = await medplum.searchResources(
    "Task",
    "_count=100&status=accepted,in-progress,completed",
  );
  const ids = new Set<string>();
  for (const t of tasks) {
    const ref = t.for?.reference;
    if (ref?.startsWith("Patient/")) ids.add(ref.split("/")[1]);
  }
  return ids;
}

/* ============ scheduling (Medplum Scheduling API) ============ */

export type SlotRow = { id: string; start: string; end: string };

export async function listFreeSlots(): Promise<SlotRow[]> {
  const medplum = await getClient();
  const slots = await medplum.searchResources(
    "Slot",
    "status=free&_count=50&_sort=start",
  );
  const now = Date.now();
  return slots
    .filter((s) => s.start && new Date(s.start).getTime() > now)
    .map((s) => ({ id: s.id as string, start: s.start as string, end: s.end as string }));
}

/** Book a referral: Appointment created, Slot busied, Task moves to in-progress. */
export async function bookAppointment(
  taskId: string,
  slotId: string,
): Promise<{ start: string }> {
  const medplum = await getClient();
  const [task, slot] = await Promise.all([
    medplum.readResource("Task", taskId),
    medplum.readResource("Slot", slotId),
  ]);
  if (slot.status !== "free") throw new Error("Slot no longer available");

  const patientRef = task.for?.reference;
  const schedule = await medplum.readResource(
    "Schedule",
    (slot.schedule?.reference ?? "").split("/")[1],
  );
  const practitionerRef = schedule.actor?.[0];

  const dispatchId = task.identifier?.find((i) => i.system === SYS)?.value ?? taskId;
  await medplum.upsertResource(
    {
      resourceType: "Appointment",
      identifier: [{ system: SYS, value: `${dispatchId}-appt` }],
      status: "booked",
      slot: [{ reference: `Slot/${slotId}` }],
      start: slot.start,
      end: slot.end,
      description: task.description,
      ...(task.focus?.reference?.startsWith("ServiceRequest/")
        ? { basedOn: [{ reference: task.focus.reference }] }
        : {}),
      participant: [
        ...(patientRef
          ? [{ actor: { reference: patientRef }, status: "accepted" as const }]
          : []),
        ...(practitionerRef
          ? [{ actor: practitionerRef, status: "accepted" as const }]
          : []),
      ],
    },
    `identifier=${SYS}|${dispatchId}-appt`,
  );

  await medplum.updateResource({ ...slot, status: "busy" });
  await medplum.updateResource({ ...task, status: "in-progress" });
  return { start: slot.start as string };
}

/** Appointments for a patient — surfaced on their record and referral rows. */
export async function patientAppointments(
  patientId: string,
): Promise<{ start: string; description?: string; practitioner?: string }[]> {
  const medplum = await getClient();
  const appts = await medplum.searchResources(
    "Appointment",
    `actor=Patient/${patientId}&_count=20&_sort=date`,
  );
  return appts
    .filter((a) => a.status === "booked")
    .map((a) => ({
      start: a.start as string,
      description: a.description,
      practitioner: a.participant?.find((p) =>
        p.actor?.reference?.startsWith("Practitioner/"),
      )?.actor?.display,
    }));
}
