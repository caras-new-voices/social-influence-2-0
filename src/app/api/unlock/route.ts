import { NextResponse } from "next/server";
import { GATE_COOKIE, gateValue, sitePasscode } from "@/lib/gate";

export const dynamic = "force-dynamic";

/** Checks the passcode and remembers this browser for 30 days. */
export async function POST(req: Request) {
  const passcode = sitePasscode();
  const form = await req.formData().catch(() => null);
  const given = String(form?.get("passcode") ?? "");
  const next = String(form?.get("next") ?? "/");
  // Only a path on this site: never send the visitor somewhere else.
  const to = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/", req.url);
  if (!passcode) return NextResponse.redirect(to, 303);
  if (given !== passcode) {
    // A short pause, so guessing by machine is slow.
    await new Promise((r) => setTimeout(r, 800));
    const back = new URL("/unlock", req.url);
    back.searchParams.set("next", to.pathname + to.search);
    back.searchParams.set("wrong", "1");
    return NextResponse.redirect(back, 303);
  }
  const res = NextResponse.redirect(to, 303);
  res.cookies.set(GATE_COOKIE, await gateValue(passcode), { httpOnly: true, sameSite: "lax", secure: new URL(req.url).protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
