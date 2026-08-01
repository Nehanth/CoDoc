import { NextResponse } from "next/server";
import { acceptReferral, medplumEnabled } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!medplumEnabled()) return NextResponse.json({ error: "Medplum off" }, { status: 500 });
  const { taskId } = (await request.json()) as { taskId?: string };
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  try {
    const status = await acceptReferral(taskId);
    return NextResponse.json({ status });
  } catch (err) {
    console.error("[referrals] accept failed:", err);
    return NextResponse.json({ error: "accept failed" }, { status: 502 });
  }
}
