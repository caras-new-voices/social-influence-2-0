import { NextResponse } from "next/server";
import { z } from "zod";
import { recordUsage } from "@/lib/usage";
import { VOICE_MODEL } from "@/lib/voice";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  dashboardId: z.string().nullable().optional(),
  label: z.string().max(200).optional(),
  input: z.number().min(0).max(5_000_000),
  output: z.number().min(0).max(5_000_000),
  responses: z.number().int().min(0).optional(),
  durationMs: z.number().min(0).optional(),
});

/** A voice session runs in the browser; it reports the tokens its responses used when it ends. */
export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const b = parsed.data;
  if (b.input + b.output === 0) return NextResponse.json({ usage: null });
  const usage = await recordUsage({ kind: "voice", dashboardId: b.dashboardId ?? null, label: b.label, provider: "openai", model: VOICE_MODEL, input: b.input, output: b.output, rounds: b.responses ?? 1, durationMs: b.durationMs });
  return NextResponse.json({ usage });
}
