// Seed Dr. Lee's practitioner, Schedule, and free Slots for the next 3 days.
// Idempotent — safe to re-run.
import { MedplumClient, ClientStorage, MemoryStorage } from "@medplum/core";

const SYS = "https://codoc.demo/id";

const m = new MedplumClient({
  baseUrl: process.env.MEDPLUM_BASE_URL,
  storage: new ClientStorage(new MemoryStorage()),
});
await m.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);

const practitioner = await m.upsertResource(
  {
    resourceType: "Practitioner",
    identifier: [{ system: SYS, value: "dr-lee" }],
    name: [{ given: ["Orthopedics"], family: "Specialist" }],
    qualification: [{ code: { text: "Orthopedics" } }],
  },
  `identifier=${SYS}|dr-lee`,
);
console.log("Practitioner:", practitioner.id);

const schedule = await m.upsertResource(
  {
    resourceType: "Schedule",
    identifier: [{ system: SYS, value: "schedule-dr-lee" }],
    active: true,
    actor: [{ reference: `Practitioner/${practitioner.id}`, display: "Orthopedics" }],
    comment: "Orthopedics clinic",
  },
  `identifier=${SYS}|schedule-dr-lee`,
);
console.log("Schedule:", schedule.id);

// Slots: next 3 weekdays-ish, 9:00–12:00, 30 min each
let created = 0;
for (let day = 1; day <= 3; day++) {
  for (let half = 0; half < 6; half++) {
    const start = new Date();
    start.setDate(start.getDate() + day);
    start.setHours(9 + Math.floor(half / 2), (half % 2) * 30, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const key = `slot-lee-${start.toISOString().slice(0, 16)}`;
    await m.upsertResource(
      {
        resourceType: "Slot",
        identifier: [{ system: SYS, value: key }],
        schedule: { reference: `Schedule/${schedule.id}` },
        status: "free",
        start: start.toISOString(),
        end: end.toISOString(),
      },
      `identifier=${SYS}|${key}`,
    );
    created++;
  }
}
console.log("Slots upserted:", created);
