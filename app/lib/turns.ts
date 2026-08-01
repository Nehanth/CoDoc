/** A contiguous run of speech from one diarized speaker. */
export type Turn = {
  id: string;
  speaker: number;
  text: string;
  start: number;
  end: number;
};

/** Shape of a word inside a Deepgram `Results` message. */
export type DeepgramWord = {
  word: string;
  punctuated_word?: string;
  speaker?: number;
  start: number;
  end: number;
};

/**
 * Deepgram returns a flat word list per result; a single result can span a
 * speaker change. Split it into per-speaker segments before display.
 */
export function segmentBySpeaker(words: DeepgramWord[]): Omit<Turn, "id">[] {
  const segments: Omit<Turn, "id">[] = [];

  for (const w of words) {
    const speaker = w.speaker ?? 0;
    const text = w.punctuated_word ?? w.word;
    const last = segments[segments.length - 1];

    if (last && last.speaker === speaker) {
      last.text += ` ${text}`;
      last.end = w.end;
    } else {
      segments.push({ speaker, text, start: w.start, end: w.end });
    }
  }

  return segments;
}

/** A pause longer than this starts a new turn even for the same speaker. */
const MERGE_GAP_S = 1.5;

/**
 * Append finalized segments to the transcript. Merge into the previous turn
 * only when the same speaker continues without a real pause — otherwise each
 * utterance gets its own bubble (so a mislabeled one can be reassigned).
 */
export function appendTurns(
  turns: Turn[],
  segments: Omit<Turn, "id">[],
): Turn[] {
  const next = turns.slice();

  for (const seg of segments) {
    const last = next[next.length - 1];
    if (
      last &&
      last.speaker === seg.speaker &&
      seg.start - last.end < MERGE_GAP_S
    ) {
      next[next.length - 1] = {
        ...last,
        text: `${last.text} ${seg.text}`,
        end: seg.end,
      };
    } else {
      next.push({ ...seg, id: `${seg.speaker}-${seg.start}-${next.length}` });
    }
  }

  return next;
}
