import { NextResponse } from "next/server";
import {
  acceptedPatientIds,
  listPatients,
  medplumEnabled,
} from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!medplumEnabled()) return NextResponse.json({ patients: [] });
  try {
    let patients = await listPatients();
    // Specialists only see patients whose referrals they accepted.
    if (new URL(request.url).searchParams.get("scope") === "accepted") {
      const allowed = await acceptedPatientIds();
      patients = patients.filter((p) => allowed.has(p.id));
    }
    return NextResponse.json({ patients });
  } catch (err) {
    console.error("[patients] list failed:", err);
    return NextResponse.json({ patients: [] });
  }
}
