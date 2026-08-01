import { NextResponse } from "next/server";
import { listReferrals, medplumEnabled } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!medplumEnabled()) return NextResponse.json({ referrals: [] });
  try {
    return NextResponse.json({ referrals: await listReferrals() });
  } catch (err) {
    console.error("[referrals] list failed:", err);
    return NextResponse.json({ referrals: [] });
  }
}
