import { NextResponse } from "next/server";
import { medplumEnabled, patientDetail } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!medplumEnabled()) return NextResponse.json({ patient: null });
  try {
    const { id } = await params;
    return NextResponse.json({ patient: await patientDetail(id) });
  } catch (err) {
    console.error("[patients] detail failed:", err);
    return NextResponse.json({ patient: null });
  }
}
