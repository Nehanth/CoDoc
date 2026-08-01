"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendTurns,
  segmentBySpeaker,
  type DeepgramWord,
  type Turn,
} from "./turns";

const DEEPGRAM_PARAMS = new URLSearchParams({
  model: "nova-3",
  language: "en-US",
  diarize: "true",
  interim_results: "true",
  smart_format: "true",
  punctuate: "true",
  vad_events: "true",
  utterance_end_ms: "1000",
  // Medical terms Deepgram would otherwise mangle. Keyterms are nova-3 only.
  keyterm: "dyspnea",
});

for (const term of [
  "CoDoc",
  "diaphoresis",
  "tachycardia",
  "pneumothorax",
  "d-dimer",
  "troponin",
  "auscultation",
  "saturation",
  "syncope",
  "palpitations",
  "radiating",
]) {
  DEEPGRAM_PARAMS.append("keyterm", term);
}

export type Status = "idle" | "connecting" | "live" | "error";

export function useDeepgram() {
  const [status, setStatus] = useState<Status>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState<{ speaker: number; text: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    keepAliveRef.current = null;

    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    recorderRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" }));
      socket.close();
    }
    socketRef.current = null;

    setInterim(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus("connecting");

    try {
      const res = await fetch("/api/deepgram/token");
      if (!res.ok) throw new Error(`token route returned ${res.status}`);
      const { scheme, token } = (await res.json()) as {
        scheme: string;
        token: string;
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const socket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${DEEPGRAM_PARAMS}`,
        [scheme, token],
      );
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus("live");

        const recorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
        });
        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        };
        recorder.start(250);

        keepAliveRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 8000);
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type !== "Results") return;

        const alt = msg.channel?.alternatives?.[0];
        const words: DeepgramWord[] = alt?.words ?? [];
        if (!alt?.transcript || words.length === 0) return;

        const segments = segmentBySpeaker(words);

        if (msg.is_final) {
          setTurns((prev) => appendTurns(prev, segments));
          setInterim(null);
        } else {
          const last = segments[segments.length - 1];
          setInterim({ speaker: last.speaker, text: alt.transcript });
        }
      };

      socket.onerror = () => {
        setError("WebSocket error — check the API key and network.");
        setStatus("error");
      };

      socket.onclose = (event) => {
        if (event.code !== 1000 && event.code !== 1005) {
          setError(`Connection closed (${event.code}) ${event.reason}`.trim());
          setStatus("error");
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setTurns([]);
    setInterim(null);
  }, []);

  useEffect(() => stop, [stop]);

  return { status, turns, interim, error, start, stop, reset };
}
