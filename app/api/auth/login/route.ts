import { NextResponse } from "next/server";
import { findAccount, registerPatient, usernameTaken } from "@/app/lib/db.server";
import { loadHistory, medplumEnabled } from "@/app/lib/medplum.server";

export const dynamic = "force-dynamic";

/**
 * SQL-backed demo login. Doctors: seeded rows (pcp/pcp, specialist/specialist).
 * Patients: any patient that exists in Medplum can log in with their name —
 * first login registers their account row.
 */
export async function POST(request: Request) {
  const { username, password } = (await request.json()) as {
    username?: string;
    password?: string;
  };
  if (!username?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const uname = username.trim();
  const existing = findAccount(uname, password);
  if (existing) {
    return NextResponse.json({
      user: {
        id: existing.id,
        role: existing.role,
        name: existing.display_name,
        patientName: existing.patient_name ?? undefined,
      },
    });
  }

  if (usernameTaken(uname)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  // New username: valid only if it names a real Medplum patient.
  if (medplumEnabled()) {
    const match = await loadHistory(uname).catch(() => null);
    if (match) {
      const account = registerPatient(uname, password, match.name);
      return NextResponse.json({
        user: {
          id: account.id,
          role: "patient",
          name: match.name,
          patientName: match.name,
        },
      });
    }
  }

  return NextResponse.json(
    { error: "No account — patients sign in with their name as registered" },
    { status: 401 },
  );
}
