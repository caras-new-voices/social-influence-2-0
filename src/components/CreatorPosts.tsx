"use client";
import type { Row } from "@/lib/chart-data";
import { DataTable } from "./Charts";

/** Client wrapper so the creator page can reuse the sortable table. */
export function CreatorPosts({ posts }: { posts: Row[] }) {
  const rows = posts.map((p) => ({
    date: typeof p.published_at === "string" ? p.published_at : new Date(p.published_at as string).toISOString(),
    brand: p.brand,
    platform: p.platform,
    type: p.post_type,
    caption: p.text,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    views: p.views,
    engagement: p.engagement,
    sentiment: p.sentiment,
    paid: p.is_paid ? "yes" : "no",
    emv: p.emv,
    url: p.url,
  }));
  return <DataTable rows={rows} />;
}
