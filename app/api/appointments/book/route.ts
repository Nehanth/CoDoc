import { NextResponse } from "next/server";
import { bookAppointment, medplumEnabled } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!medplumEnabled()) return NextResponse.json({ error: "Medplum off" }, { status: 500 });
  const { taskId, slotId } = (await request.json()) as { taskId?: string; slotId?: string };
  if (!taskId || !slotId) return NextResponse.json({ error: "taskId and slotId required" }, { status: 400 });
  try {
    return NextResponse.json(await bookAppointment(taskId, slotId));
  } catch (err) {
    console.error("[book] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "booking failed" },
      { status: 502 },
    );
  }
}
