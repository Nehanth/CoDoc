"use client";

import Model, { type IExerciseData, type Muscle } from "react-body-highlighter";
import type { BodySite, Symptom } from "../lib/clinical";

/** BodySite → anatomical muscle groups on the model. */
const SITE_MUSCLES: Record<BodySite, { muscles: Muscle[]; view: "front" | "back" }> = {
  head: { muscles: ["head"], view: "front" },
  neck: { muscles: ["neck"], view: "front" },
  chest: { muscles: ["chest"], view: "front" },
  abdomen: { muscles: ["abs", "obliques"], view: "front" },
  pelvis: { muscles: ["adductor"], view: "front" },
  back: { muscles: ["trapezius", "upper-back", "lower-back"], view: "back" },
  left_shoulder: { muscles: ["front-deltoids"], view: "front" },
  right_shoulder: { muscles: ["front-deltoids"], view: "front" },
  shoulder: { muscles: ["front-deltoids"], view: "front" },
  left_arm: { muscles: ["biceps", "forearm"], view: "front" },
  right_arm: { muscles: ["biceps", "forearm"], view: "front" },
  arm: { muscles: ["biceps", "forearm"], view: "front" },
  left_leg: { muscles: ["quadriceps", "knees", "calves"], view: "front" },
  right_leg: { muscles: ["quadriceps", "knees", "calves"], view: "front" },
  leg: { muscles: ["quadriceps", "knees", "calves"], view: "front" },
};

/** Blue intensity — deeper when several findings hit one region. */
const HIGHLIGHT = ["#93c5fd", "#3b82f6", "#1d4ed8"];

export function BodyMap({ symptoms }: { symptoms: Symptom[] }) {
  const localized = symptoms.filter(
    (s): s is Symptom & { bodySite: BodySite } => Boolean(s.bodySite),
  );

  const front: IExerciseData[] = [];
  const back: IExerciseData[] = [];
  for (const s of localized) {
    const site = SITE_MUSCLES[s.bodySite];
    if (!site) continue;
    (site.view === "back" ? back : front).push({
      name: s.term,
      muscles: site.muscles,
    });
  }

  const sites = [...new Set(localized.map((s) => s.bodySite.replace(/_/g, " ")))];

  return (
    <div className="bodymap">
      <div className="figures">
        <div className="figure">
          <Model
            data={front}
            type="anterior"
            bodyColor="#eef2f7"
            highlightedColors={HIGHLIGHT}
          />
        </div>
        {back.length > 0 && (
          <div className="figure">
            <Model
              data={back}
              type="posterior"
              bodyColor="#eef2f7"
              highlightedColors={HIGHLIGHT}
            />
          </div>
        )}
      </div>

      {sites.length > 0 ? (
        <div className="bmSites">
          {sites.map((s) => (
            <span key={s} className="bmSite">
              {s}
            </span>
          ))}
        </div>
      ) : (
        <p className="bmNone">No localized findings</p>
      )}
    </div>
  );
}
