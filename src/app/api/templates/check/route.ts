import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/imports";
import { checkTemplate } from "@/lib/template-check";
import { toTemplateId } from "@/lib/templates";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs the rotation test for a template: each tracked brand as the focal brand, every element over
 * all time and each month. Read-only. ?template=starter&months=0 skips the per-month runs,
 * ?brand=<name> limits it to one focal brand.
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const brand = url.searchParams.get("brand");
  try {
    const result = await checkTemplate(toTemplateId(url.searchParams.get("template") ?? "starter"), {
      months: url.searchParams.get("months") !== "0",
      brands: brand ? [brand] : undefined,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
