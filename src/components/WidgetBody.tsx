"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Row } from "@/lib/chart-data";
import { sanitizeHtml } from "@/lib/format";
import type { WidgetSpec } from "@/lib/widgets";
import { BarChartW, DataTable, KpiRow, LineChartW, SegmentedBar } from "./Charts";

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>
      {text}
    </ReactMarkdown>
  );
}

export function InsightBody({ rows, spec }: { rows: Row[]; spec: WidgetSpec }) {
  const row = rows[0] ?? {};
  const headline = (row.headline as string | undefined) ?? undefined;
  const body = (row.body as string | undefined) ?? spec.content ?? "";
  const isHtml = /<\w+[^>]*>/.test(body);
  return (
    <div className="insight">
      {headline && <div className="insight__headline">{headline}</div>}
      {isHtml ? <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }} /> : <Markdown text={body} />}
    </div>
  );
}

export function WidgetBody({ spec, rows, tableView }: { spec: WidgetSpec; rows: Row[]; tableView?: boolean }) {
  if (spec.type === "text") return <div className="textw"><Markdown text={spec.content ?? ""} /></div>;
  if (spec.type === "section") return null;
  if (spec.type === "insight") return <InsightBody rows={rows} spec={spec} />;
  if (tableView || spec.type === "table") return <DataTable rows={rows} fmt={spec.type === "table" ? undefined : spec.format} />;
  switch (spec.type) {
    case "kpi":
      return <KpiRow rows={rows} spec={spec} />;
    case "bar":
      return <BarChartW rows={rows} spec={spec} />;
    case "stacked_bar":
      return <BarChartW rows={rows} spec={spec} stacked />;
    case "line":
      return <LineChartW rows={rows} spec={spec} />;
    case "segmented":
      return <SegmentedBar rows={rows} spec={spec} />;
    default:
      return <DataTable rows={rows} />;
  }
}
