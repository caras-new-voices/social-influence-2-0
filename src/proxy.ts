import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateValue, openPath, sitePasscode } from "@/lib/gate";

/** Asks for the site passcode, when one is set, on everything except share links. */
export async function proxy(req: NextRequest) {
  const passcode = sitePasscode();
  if (!passcode) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (openPath(pathname)) return NextResponse.next();
  if (req.cookies.get(GATE_COOKIE)?.value === (await gateValue(passcode))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "This site is locked. Open it in a browser and enter the passcode." }, { status: 401 });
  const to = req.nextUrl.clone();
  to.pathname = "/unlock";
  to.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(to);
}

export const config = {
  // Everything except the framework's own files and static assets.
  matcher: ["/((?!_next/|favicon.ico|icons/|fonts/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)"],
};
