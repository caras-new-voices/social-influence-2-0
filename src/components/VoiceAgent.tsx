"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Row } from "@/lib/chart-data";
import type { WidgetSpec } from "@/lib/widgets";

type Status = "connecting" | "listening" | "speaking" | "thinking" | "error" | "ended";
interface Line {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/**
 * Two-way voice conversation about one dashboard element, over WebRTC with the Realtime API.
 * The server mints a short-lived client secret; audio and events flow directly between the
 * browser and the model. The model's run_sql tool calls are executed through our data API.
 */
export function VoiceAgent({ widget, rows, onClose }: { widget: WidgetSpec; rows: Row[]; onClose: () => void }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const upsert = useCallback((id: string, role: Line["role"], text: string, final: boolean) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      if (i >= 0) {
        const next = [...ls];
        next[i] = { ...next[i], text, final };
        return next;
      }
      return [...ls, { id, role, text, final }];
    });
  }, []);

  const end = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
    setStatus("ended");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const partial = new Map<string, string>();

    async function runSql(sql: string): Promise<string> {
      const r = await fetch("/api/widgets/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql }) });
      const j = (await r.json()) as { rows?: Row[]; error?: string };
      if (!r.ok) return JSON.stringify({ error: j.error ?? "query failed" });
      const out = (j.rows ?? []).slice(0, 200);
      return JSON.stringify({ rowCount: j.rows?.length ?? 0, rows: out }).slice(0, 12000);
    }

    async function start() {
      try {
        const sessionRes = await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ widget, rows }) });
        const session = (await sessionRes.json()) as { clientSecret?: string; model?: string; error?: string };
        if (!sessionRes.ok || !session.clientSecret) throw new Error(session.error ?? "Could not start the voice session");
        if (cancelled) return;

        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          mic.getTracks().forEach((t) => t.stop());
          return;
        }
        micRef.current = mic;
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.ontrack = (e) => {
          if (audioRef.current) audioRef.current.srcObject = e.streams[0];
        };
        mic.getTracks().forEach((t) => pc.addTrack(t, mic));
        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        const send = (ev: Record<string, unknown>) => {
          if (dc.readyState === "open") dc.send(JSON.stringify(ev));
        };

        dc.onopen = () => {
          setStatus("thinking");
          // Kick off the opening explanation without waiting for the person to speak.
          send({ type: "response.create" });
        };
        dc.onmessage = async (msg) => {
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(msg.data as string) as Record<string, unknown>;
          } catch {
            return;
          }
          const type = ev.type as string;
          if (type === "input_audio_buffer.speech_started") setStatus("listening");
          else if (type === "response.created") setStatus("thinking");
          else if (type === "response.output_audio.delta") setStatus("speaking");
          else if (type === "response.done") setStatus("listening");
          else if (type === "response.output_audio_transcript.delta") {
            const id = String(ev.item_id);
            const t = (partial.get(id) ?? "") + String(ev.delta ?? "");
            partial.set(id, t);
            upsert(id, "assistant", t, false);
          } else if (type === "response.output_audio_transcript.done") {
            const id = String(ev.item_id);
            upsert(id, "assistant", String(ev.transcript ?? partial.get(id) ?? ""), true);
            partial.delete(id);
          } else if (type === "conversation.item.input_audio_transcription.completed") {
            upsert(String(ev.item_id), "user", String(ev.transcript ?? "").trim() || "(unclear)", true);
          } else if (type === "response.function_call_arguments.done" && ev.name === "run_sql") {
            let sql = "";
            try {
              sql = (JSON.parse(String(ev.arguments ?? "{}")) as { sql?: string }).sql ?? "";
            } catch {
              /* ignore */
            }
            const output = sql ? await runSql(sql) : JSON.stringify({ error: "no sql provided" });
            send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output } });
            send({ type: "response.create" });
          } else if (type === "error") {
            const e = ev.error as { message?: string } | undefined;
            setError(e?.message ?? "Voice session error");
            setStatus("error");
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(`${REALTIME_CALLS_URL}?model=${encodeURIComponent(session.model ?? "gpt-realtime")}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
          body: offer.sdp,
        });
        if (!sdpRes.ok) throw new Error(`Could not connect the audio session (${sdpRes.status})`);
        const answer = await sdpRes.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (e) {
        if (cancelled) return;
        const msg = (e as Error).name === "NotAllowedError" ? "Microphone access was blocked. Allow the microphone and try again." : (e as Error).message;
        setError(msg);
        setStatus("error");
      }
    }
    void start();
    return () => {
      cancelled = true;
      end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const toggleMute = () => {
    const next = !muted;
    micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  };

  const statusLabel: Record<Status, string> = {
    connecting: "Connecting…",
    listening: muted ? "Muted" : "Listening",
    speaking: "Speaking",
    thinking: "Thinking…",
    error: "Error",
    ended: "Ended",
  };

  return (
    <div className="voice" role="dialog" aria-label={`Voice conversation about ${widget.title}`}>
      <audio ref={audioRef} autoPlay />
      <div className="voice__head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/ai-voice.svg" alt="" width={22} height={22} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="voice__title truncate">{widget.title}</div>
          <div className={`voice__status voice__status--${status}`}>
            <span className="voice__dot" /> {statusLabel[status]}
          </div>
        </div>
        <button className="im-btn im-btn-ghost im-btn-sm" onClick={toggleMute} disabled={status === "error" || status === "ended"}>{muted ? "Unmute" : "Mute"}</button>
        <button className="im-btn im-btn-secondary im-btn-sm" onClick={() => { end(); onClose(); }}>End</button>
      </div>
      <div className="voice__lines" ref={scrollRef}>
        {error ? (
          <div className="chat__error">{error}</div>
        ) : lines.length === 0 ? (
          <div className="im-text-description">{status === "connecting" ? "Setting up the microphone and the voice connection…" : "The analyst will start by explaining this element. Ask anything when it pauses."}</div>
        ) : (
          lines.map((l) => (
            <div key={l.id} className={`voice__line voice__line--${l.role} ${l.final ? "" : "is-partial"}`}>
              <span className="voice__who">{l.role === "user" ? "You" : "Analyst"}</span>
              <span>{l.text}</span>
            </div>
          ))
        )}
      </div>
      <div className="voice__foot im-text-description">Two-way voice: speak when the analyst pauses, or interrupt it. Transcript stays here for the session.</div>
    </div>
  );
}
