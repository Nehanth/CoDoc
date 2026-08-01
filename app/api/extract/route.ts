import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { EMPTY_STATE, slug, type ClinicalState } from "@/app/lib/clinical";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `You are a clinical scribe listening to a live doctor-patient visit.

You receive the transcript so far. Turns are labelled SPEAKER_0 / SPEAKER_1
(machine diarization — anonymous voices), or DOCTOR / PATIENT when roles are
already confirmed.
Call record_findings exactly once with the COMPLETE current picture — not just
what is new. You will be called repeatedly as the visit unfolds; each call
replaces the previous one, so always restate everything still true.

Rules:
- doctor_speaker: when turns are labelled SPEAKER_N, decide which speaker is
  the clinician from content: the clinician asks questions, examines, states
  vitals, orders tests, addresses CoDoc. The patient describes their own
  symptoms. Emit 0 or 1. If only one speaker exists or you cannot tell, omit it.
- identity: capture the patient's name when stated (by the patient, or when a
  clinician addresses them by name). During intake, also capture DOB, phone,
  address, and pharmacy into identity.
- If a PRIOR RECORD block is provided, use it: flag interactions between new
  complaints and known conditions/medications/allergies, and surface risks the
  history creates even when the patient doesn't mention it today. Cite history
  items in insight basis as "history: <item>".
- medications: use the canonical drug name once ("multivitamin", not also
  "daily multivitamin") — put frequency in dose.
- symptoms: translate the patient's lay words into clinical terms, and always
  carry the patient's verbatim words in "quote" so the clinician can check you.
- Only record what was actually said. Never infer a vital sign that was not spoken.
- insights: surface what the clinician might miss — dangerous symptom
  constellations, interactions, or a red flag the patient buried mid-story.
  Use "critical" only for genuinely time-sensitive risk. Cite the findings that
  drove it in "basis". Return an empty array when nothing warrants attention.
- dispatches: only when the doctor explicitly asks to contact, page, refer to,
  or order from another service (radiology, cardiology, lab, pharmacy).
  Use a short canonical target name ("Orthopedics", "Radiology") and keep the
  label SHORT and STABLE — once you have emitted a dispatch, repeat it
  identically on every later call; never re-phrase it.
  Prescriptions are dispatches too: when the doctor prescribes or sends a
  medication to a pharmacy, emit target "Pharmacy" with label "<drug> <sig>".
- dispatches[].directive: set true ONLY when the doctor addresses the copilot
  by name — "CoDoc", "co-doc", "co doc" — e.g. "CoDoc, page radiology for a
  stat chest X-ray". A direct command is pre-authorized: the agent executes it
  immediately without a confirmation tap. Anything merely implied in
  conversation stays directive=false.
- Be conservative. An empty array is a valid and often correct answer.`;

const TOOL: Anthropic.Tool = {
  name: "record_findings",
  description: "Record the complete clinical picture from the visit so far.",
  input_schema: {
    type: "object",
    properties: {
      doctor_speaker: {
        type: "integer",
        enum: [0, 1],
        description:
          "Which diarized speaker is the clinician, inferred from content",
      },
      identity: {
        type: "object",
        properties: {
          name: { type: "string" },
          dob: { type: "string", description: "Date of birth as YYYY-MM-DD" },
          phone: { type: "string" },
          address: { type: "string" },
          pharmacy: { type: "string" },
        },
        description:
          "The patient's stated identity and intake details. Set name only when spoken ('I'm Emily Carter'). Capture DOB (normalize to YYYY-MM-DD), phone, home address, and preferred pharmacy when they come up during intake. Never guess.",
      },
      symptoms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "Clinical term" },
            quote: { type: "string", description: "Patient's verbatim words" },
            onset: { type: "string" },
            severity: { type: "string" },
            body_site: {
              type: "string",
              enum: [
                "head",
                "neck",
                "chest",
                "abdomen",
                "pelvis",
                "back",
                "left_shoulder",
                "right_shoulder",
                "shoulder",
                "left_arm",
                "right_arm",
                "arm",
                "left_leg",
                "right_leg",
                "leg",
              ],
              description:
                "Anatomical region, only for localizable symptoms (pain, swelling, rash). Use the unsided value when the patient didn't specify a side. Omit for systemic symptoms like fatigue or diaphoresis.",
            },
          },
          required: ["term", "quote"],
        },
      },
      vitals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            unit: { type: "string" },
            flag: { type: "string", enum: ["high", "low", "normal"] },
          },
          required: ["label", "value"],
        },
      },
      allergies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            substance: { type: "string" },
            reaction: { type: "string" },
          },
          required: ["substance"],
        },
      },
      medications: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, dose: { type: "string" } },
          required: ["name"],
        },
      },
      insights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["info", "warn", "critical"] },
            title: { type: "string" },
            detail: { type: "string" },
            basis: { type: "array", items: { type: "string" } },
          },
          required: ["level", "title", "detail", "basis"],
        },
      },
      dispatches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            target: { type: "string", description: "Service being contacted" },
            label: { type: "string", description: "What is being asked for" },
            urgency: { type: "string", enum: ["routine", "urgent", "stat"] },
            directive: {
              type: "boolean",
              description:
                "True only when the doctor addressed the copilot by name (CoDoc)",
            },
          },
          required: ["target", "label", "urgency"],
        },
      },
    },
    required: [
      "symptoms",
      "vitals",
      "allergies",
      "medications",
      "insights",
      "dispatches",
    ],
  },
};

type RawFindings = {
  doctor_speaker?: number;
  identity?: {
    name?: string;
    dob?: string;
    phone?: string;
    address?: string;
    pharmacy?: string;
  };
  symptoms: {
    term: string;
    quote: string;
    onset?: string;
    severity?: string;
    body_site?: string;
  }[];
  vitals: { label: string; value: string; unit?: string; flag?: string }[];
  allergies: { substance: string; reaction?: string }[];
  medications: { name: string; dose?: string }[];
  insights: { level: string; title: string; detail: string; basis: string[] }[];
  dispatches: {
    target: string;
    label: string;
    urgency: string;
    directive?: boolean;
  }[];
};

/** Attach content-derived ids so the UI can tell new cards from existing ones. */
function withIds(raw: RawFindings): ClinicalState {
  return {
    identity: raw.identity?.name
      ? {
          name: raw.identity.name,
          dob: raw.identity.dob,
          phone: raw.identity.phone,
          address: raw.identity.address,
          pharmacy: raw.identity.pharmacy,
        }
      : null,
    symptoms: raw.symptoms.map(({ body_site, ...s }) => ({
      ...s,
      id: slug(s.term),
      bodySite: body_site as ClinicalState["symptoms"][number]["bodySite"],
    })),
    vitals: raw.vitals.map((v) => ({
      ...v,
      id: slug(v.label),
      flag: v.flag as ClinicalState["vitals"][number]["flag"],
    })),
    allergies: raw.allergies.map((a) => ({ ...a, id: slug(a.substance) })),
    medications: raw.medications.map((m) => ({ ...m, id: slug(m.name) })),
    insights: raw.insights.map((i) => ({
      ...i,
      id: slug(i.title),
      level: i.level as ClinicalState["insights"][number]["level"],
    })),
    dispatches: raw.dispatches.map((d) => ({
      ...d,
      id: slug(d.target),
      urgency: d.urgency as ClinicalState["dispatches"][number]["urgency"],
      status: "pending" as const,
      directive: d.directive ?? false,
    })),
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const { transcript, history } = (await request.json()) as {
    transcript?: string;
    history?: string;
  };
  if (!transcript?.trim()) {
    return NextResponse.json({ state: EMPTY_STATE, latencyMs: 0 });
  }

  const started = Date.now();

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_findings" },
      messages: [
        {
          role: "user",
          content: history
            ? `PRIOR RECORD (from Medplum, established before this visit):\n${history}\n\nTranscript so far:\n\n${transcript}`
            : `Transcript so far:\n\n${transcript}`,
        },
      ],
    });

    const call = message.content.find((block) => block.type === "tool_use");
    if (call?.type !== "tool_use") {
      return NextResponse.json({ state: EMPTY_STATE, latencyMs: Date.now() - started });
    }

    const raw = call.input as RawFindings;
    return NextResponse.json({
      state: withIds(raw),
      doctorSpeaker: raw.doctor_speaker ?? null,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    console.error("[extract] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "extraction failed" },
      { status: 502 },
    );
  }
}
