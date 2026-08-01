import { NextResponse } from "next/server";
import { listFreeSlots, medplumEnabled } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!medplumEnabled()) return NextResponse.json({ slots: [] });
  try {
    return NextResponse.json({ slots: await listFreeSlots() });
  } catch (err) {
    console.error("[slots] failed:", err);
    return NextResponse.json({ slots: [] });
  }
}
