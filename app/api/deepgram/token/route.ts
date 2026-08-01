import { DeepgramClient } from "@deepgram/sdk";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Mints a short-lived Deepgram token for the browser so the raw API key
 * never leaves the server. Returns the WebSocket subprotocol pair the
 * client should use: ["bearer", <jwt>] or ["token", <api key>].
 */
export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY is not set" },
      { status: 500 },
    );
  }

  try {
    const client = new DeepgramClient({ apiKey });
    const grant = await client.auth.v1.tokens.grant({ ttl_seconds: 3600 });
    const token = (grant as { access_token?: string }).access_token;
    if (!token) throw new Error("grant returned no access_token");
    return NextResponse.json({ scheme: "bearer", token });
  } catch (err) {
    // Ephemeral grant unavailable (permissions/plan). Fall back to the raw
    // key so a local demo still runs — never do this on a public deploy.
    console.warn(
      "[deepgram] token grant failed, falling back to raw key:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ scheme: "token", token: apiKey });
  }
}
