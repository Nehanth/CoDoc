# 🩺 CoDoc

**Eyes on the patient, not the keyboard — the visit documents itself.**

CoDoc is an ambient clinical copilot. It listens to the doctor–patient conversation, understands it in real time, and turns it into a real, standards-compliant medical record — with zero typing.

Built at the **YC × Medplum Agentic Healthcare Hackathon** (Aug 2026) on **Medplum**, **Deepgram**, and **Claude**.

## What it does

- **Listens** — Deepgram Nova-3 streaming with speaker diarization and medical keyterm boosting
- **Understands** — Claude infers who the clinician is, extracts symptoms (with the patient's verbatim words), vitals, allergies, meds, and intake details (DOB, phone, address, pharmacy)
- **Registers patients by voice** — say your name: returning patients get their full history pulled up; new patients get a chart created on the spot
- **Catches what humans miss** — cross-checks the live conversation against the stored record (e.g. flags an amoxicillin order against a documented penicillin allergy)
- **Acts on command** — *"CoDoc, refer her to orthopedics"* → drafts the order note and queues a real FHIR `ServiceRequest` + `Task` for the specialist; prescriptions become `MedicationRequest`s
- **Closes the visit** — one click signs a SOAP note into the chart as a `DocumentReference`
- **Three-sided product** — PCP runs visits, the specialist works a referral queue (accept → patient appears in their panel), and the patient sees their own record, conversations, and referral status in plain language

Everything is written to Medplum as conformant FHIR (11+ resource types), live, as the conversation happens.

## Stack

| Layer | Tech |
|---|---|
| Speech → text | Deepgram Nova-3 (streaming WebSocket, `diarize=true`) |
| Understanding | Claude Haiku 4.5 (Messages API, forced tool call) |
| Record of truth | Medplum (hosted FHIR R4) |
| App | Next.js 16 / React 19, framer-motion, react-body-highlighter |
| Login accounts | SQLite via `node:sqlite` (demo auth) |

## Run it

**Prereqs:** Node 22.5+ (uses built-in `node:sqlite`), npm, and a microphone.

```bash
git clone https://github.com/Nehanth/CoDoc.git
cd CoDoc
npm install
```

Create `.env.local` in the project root:

```bash
# Deepgram — https://console.deepgram.com (free credits)
DEEPGRAM_API_KEY=your_deepgram_key

# Anthropic — https://console.anthropic.com
ANTHROPIC_API_KEY=your_anthropic_key

# Medplum — https://app.medplum.com → Project → Clients → create client
MEDPLUM_BASE_URL=https://api.medplum.com/
MEDPLUM_CLIENT_ID=your_medplum_client_id
MEDPLUM_CLIENT_SECRET=your_medplum_client_secret
```

Then:

```bash
npm run dev
```

Open **http://localhost:3000** (must be `localhost` or HTTPS — the mic requires a secure context).

## Sign in

| Username | Password | Role |
|---|---|---|
| `pcp` | `pcp` | Primary care — runs live visits, sends referrals & prescriptions |
| `specialist` | `specialist` | Specialist — referral queue; accepting a referral adds the patient to their panel |
| *any patient's name* (e.g. `Emily Carter`) | anything on first login | Patient — their own record, conversations, and referral status |

Patient accounts self-register on first login for any patient that exists in your Medplum project; the password you type first becomes theirs.

## Demo script (2 people, ~2 minutes)

1. Sign in as `pcp`, hit **Start session**
2. *Clinician:* "Hi, can I get your name and date of birth?" — *Patient:* "I'm Emily Carter, March 14th, 1998…" (phone, address, pharmacy, penicillin allergy, meds)
3. *Patient:* "I've had pain in my right knee for two months, since I started training for a 10K" → watch the chart bloom: symptoms with quotes, body map, vitals as spoken
4. *Clinician:* "I'll start you on amoxicillin for that sinus thing" → 🚨 **contraindication card** (penicillin allergy)
5. *Clinician:* **"CoDoc, refer her to orthopedics"** → agent drafts the note, order lands in the queue
6. **End visit · sign note** → SOAP note signs itself
7. Log out → `specialist` → accept the referral (patient's phone is right there) → Emily appears in their Patients panel
8. Log out → `Emily Carter` → she sees her record, the whole conversation, and "Accepted — expect a call to schedule"

Check `app.medplum.com` afterwards — every resource is real FHIR.

## Notes

- Login is demo-grade (plaintext SQLite, localStorage session) — hackathon scope, not production auth
- Pharmacy integration is a labeled dummy; referral *receiving* is intentionally out of scope (any FHIR-native system can work the Task queue)
- `codoc.db` (accounts) is created on first run and gitignored
