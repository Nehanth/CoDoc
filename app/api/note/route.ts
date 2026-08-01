import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { medplumEnabled, writeNote } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** End of visit: Claude drafts the SOAP note, Medplum stores it. */
export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const { transcript, patientName, doctor } = (await request.json()) as {
    transcript: string;
    patientName?: string;
    doctor?: string;
  };
  if (!transcript?.trim()) {
    return NextResponse.json({ error: "empty transcript" }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      system:
        "You write concise SOAP visit notes for physicians. Plain text, four " +
        "sections labelled Subjective / Objective / Assessment / Plan. Use only " +
        "facts from the transcript — never invent exam findings, vitals, or " +
        "history that were not spoken. Keep it tight; this is a working note.",
      messages: [
        { role: "user", content: `Visit transcript:\n\n${transcript}\n\nWrite the SOAP note.` },
      ],
    });

    const block = msg.content.find((b) => b.type === "text");
    const note =
      block?.type === "text"
        ? block.text.replace(/\*\*|__|`/g, "").trim()
        : "";

    let ref = null;
    if (medplumEnabled() && note) {
      try {
        ref = await writeNote(note, patientName, doctor);
      } catch (err) {
        console.error("[note] medplum write failed:", err);
      }
    }

    return NextResponse.json({ note, ref });
  } catch (err) {
    console.error("[note] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "note failed" },
      { status: 502 },
    );
  }
}
