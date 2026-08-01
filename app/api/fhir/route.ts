import { NextResponse } from "next/server";
import type { ClinicalState } from "@/app/lib/clinical";
import {
  medplumEnabled,
  syncState,
  type TranscriptLine,
} from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!medplumEnabled()) {
    return NextResponse.json({ enabled: false, refs: {}, total: 0 });
  }

  const { state, transcript, doctor } = (await request.json()) as {
    state: ClinicalState;
    transcript?: TranscriptLine[];
    doctor?: string;
  };

  try {
    const { refs, total } = await syncState(state, transcript, doctor);
    return NextResponse.json({ enabled: true, refs, total });
  } catch (err) {
    console.error("[fhir] sync failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 502 },
    );
  }
}
