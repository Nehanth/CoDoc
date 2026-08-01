import { NextResponse } from "next/server";
import { loadHistory, medplumEnabled } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (!name || !medplumEnabled()) {
    return NextResponse.json({ history: null });
  }

  try {
    return NextResponse.json({ history: await loadHistory(name) });
  } catch (err) {
    console.error("[history] lookup failed:", err);
    return NextResponse.json({ history: null });
  }
}
