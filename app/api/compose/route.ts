import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The agent drafts the actual page message sent to the consulting service —
 * SBAR-style, from the live transcript. This is the "harness acting" step the
 * doctor sees streaming into the dispatch card.
 */
export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const { target, label, urgency, transcript } = (await request.json()) as {
    target: string;
    label: string;
    urgency: string;
    transcript: string;
  };

  try {
    const isRx = /pharmac/i.test(target);
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: isRx
        ? "You draft e-prescription orders a pharmacy will read. 2-3 short lines: " +
          "drug, strength, sig (directions), quantity if stated. Plain text. " +
          "HARD RULE: only facts stated in the transcript — never invent strength, " +
          "quantity, or directions that were not spoken; omit what is unknown."
        : "You draft clinical pages on behalf of an ER physician. Write the exact " +
        "message the receiving service will read on their pager: SBAR-compressed, " +
        "2-4 short lines, no greeting, no sign-off. Lead with urgency and the ask. " +
        "HARD RULE: use ONLY facts stated in the transcript. Never invent age, " +
        "sex, room/bay numbers, or vitals that were not spoken. If a detail is " +
        "unknown, omit it.",
      messages: [
        {
          role: "user",
          content: `Page ${target} (${urgency.toUpperCase()}): ${label}\n\nLive transcript of the visit:\n${transcript}\n\nDraft the page message now. Before writing each fact, verify it appears verbatim in the transcript above — the transcript states no age, no sex, and no room number unless you can quote the exact words. Omit anything you cannot quote.`,
        },
      ],
    });

    const text = msg.content.find((b) => b.type === "text");
    const raw =
      text?.type === "text" ? text.text : `${urgency.toUpperCase()}: ${label}`;
    // Pagers render plain text — strip markdown emphasis and collapse blanks.
    const message = raw
      .replace(/\*\*|__|`/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
    return NextResponse.json({ message });
  } catch (err) {
    console.error("[compose] failed:", err);
    // The demo must not stall on a network blip — fall back to a template.
    return NextResponse.json({
      message: `${urgency.toUpperCase()} — ${label}. See live chart for context.`,
    });
  }
}
