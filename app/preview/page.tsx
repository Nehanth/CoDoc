"use client";
// Styling QA only.
import { ActionCard, ChartSurfaces } from "../components/Surfaces";
import type { ClinicalState } from "../lib/clinical";

const S: ClinicalState = {
  identity: { name: "Robert Chen" },
  symptoms: [
    { id: "a", term: "Shoulder pain", quote: "my shoulder's been aching for a few days", bodySite: "left_shoulder" },
    { id: "b", term: "Diaphoresis", quote: "really sweaty, kind of clammy" },
    { id: "c", term: "Dyspnea on exertion", quote: "winded going up the stairs", onset: "new" },
  ],
  vitals: [
    { id: "d", label: "Blood pressure", value: "148/92", flag: "high" },
    { id: "e", label: "Heart rate", value: "104", unit: "bpm", flag: "high" },
  ],
  allergies: [{ id: "f", substance: "Penicillin", reaction: "hives" }],
  medications: [{ id: "g", name: "Lisinopril", dose: "10 mg daily" }],
  insights: [
    { id: "h", level: "critical", title: "Amoxicillin contraindicated", detail: "Patient has a documented penicillin allergy; amoxicillin is penicillin-class.", basis: ["history: penicillin allergy", "amoxicillin prescribed"] },
    { id: "i", level: "warn", title: "Acute coronary syndrome concern", detail: "Shoulder pain with diaphoresis and new exertional dyspnea in a diabetic patient.", basis: ["diaphoresis", "history: type 2 diabetes", "age 58"] },
  ],
  dispatches: [
    { id: "j", target: "Radiology", label: "Portable chest X-ray", urgency: "stat", status: "queued", directive: true, message: "STAT portable CXR. BP 148/92, HR 104. Concern for ACS.", sentAt: 1000 },
    { id: "k", target: "Cardiology", label: "Consultation", urgency: "urgent", status: "pending", directive: false },
  ],
};

const api = { send: () => {}, refs: { a: { type: "Observation", id: "x" }, h: { type: "DetectedIssue", id: "y" }, j: { type: "Task", id: "z" } } };

export default function Preview() {
  return (
    <main className="room">
      <header className="topbar">
        <div className="mark">
          <span className="dots on"><i /><i /><i /><i /><i /></span>
          <strong>CoDoc</strong>
          <span className="who-now"><b>Robert Chen</b> · 58</span>
          <span className="fhir">Medplum · 14</span>
        </div>
        <div className="controls">
          <button>Swap roles</button>
          <button className="sign">End visit · sign note</button>
          <button className="stop">Stop</button>
        </div>
      </header>
      <div className="stage">
        <aside className="convo">
          <div className="colHead"><h2>Conversation</h2><span className="dots on"><i /><i /><i /><i /><i /></span></div>
          <div className="transcript">
            <div className="line role0"><span className="who">Doctor</span><p>Hi, come on in — what brings you in today?</p></div>
            <div className="line role1"><span className="who">Patient</span><p>I&apos;m Robert Chen. My shoulder&apos;s been aching a few days.</p></div>
            <div className="line role1"><span className="who">Patient</span><p>Honestly I&apos;ve also been really sweaty, and I get winded going up the stairs now.</p></div>
            <div className="line role0"><span className="who">Doctor</span><p>Your blood pressure is 148 over 92 and heart rate 104.</p></div>
            <div className="line role0"><span className="who">Doctor</span><p>I&apos;ll start you on amoxicillin for that sinus thing.</p></div>
            <div className="line role0"><span className="who">Doctor</span><p>CoDoc, send a stat page to radiology for a portable chest X-ray.</p></div>
          </div>
        </aside>
        <div className="chart">
          <section className="card">
            <header><h2>Record on file</h2><span className="hint">matched from Medplum</span></header>
            <div className="who-card">
              <span className="avatar">RC</span>
              <div><strong>Robert Chen</strong><p>58 years · male · DOB 1968-03-04</p></div>
            </div>
            <div className="rows">
              <div className="row"><span className="k">History</span><span className="v">Hypertension · Type 2 diabetes · Hyperlipidemia</span></div>
              <div className="row"><span className="k">Meds</span><span className="v">Lisinopril 10 mg daily · Metformin 500 mg</span></div>
              <div className="row alert"><span className="k">Allergies</span><span className="v">⚠ Penicillin</span></div>
            </div>
          </section>
          <ChartSurfaces state={S} api={api} />
        </div>
        <aside className="actions">
          <div className="colHead"><h2>Actions</h2><span className="meta">2</span></div>
          <div className="colBody">{S.dispatches.map((d) => <ActionCard key={d.id} d={d} api={api} />)}</div>
        </aside>
      </div>
    </main>
  );
}
