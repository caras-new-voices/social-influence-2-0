import { NextResponse } from "next/server";
import { getCatalogDetails } from "@/lib/catalog-details";

export const dynamic = "force-dynamic";

/** Every industry and its brands, with descriptions and volumes, for choosing a dashboard's brands. */
export async function GET() {
  try {
    return NextResponse.json({ industries: await getCatalogDetails() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
