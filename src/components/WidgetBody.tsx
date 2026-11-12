"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo } from "react";
import { kpiWithCompare, selfCompares, type Row } from "@/lib/chart-data";
import { sanitizeHtml } from "@/lib/format";
import type { WidgetSpec } from "@/lib/widgets";
import { formatWindow } from "@/lib/period";
import { BarChartW, CompareBarChart, CompareLineChart, CompareTable, DataTable, KpiRow, LineChartW, SegmentedBar, type PeriodLabels } from "./Charts";
import { usePeriod } from "./PeriodContext";

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

/** True when the element has a comparison result set to draw. */
function hasCompare(compareRows: Row[] | undefined): compareRows is Row[] {
  return Array.isArray(compareRows);
}

export function WidgetBody({ spec, rows, compareRows, tableView }: { spec: WidgetSpec; rows: Row[]; compareRows?: Row[]; tableView?: boolean }) {
  const period = usePeriod();
  const labels = useMemo<PeriodLabels>(
    () => ({ current: formatWindow(period.window), compare: period.compareWindow ? formatWindow(period.compareWindow) : "comparison" }),
    [period.window, period.compareWindow],
  );
  const starts = useMemo(() => ({ current: period.window.start, compare: period.compareWindow?.start }), [period.window.start, period.compareWindow?.start]);
  const own = selfCompares(spec.sql);
  const kpiRows = useMemo(() => (spec.type === "kpi" && !own && hasCompare(compareRows) ? kpiWithCompare(rows, compareRows) : rows), [spec.type, own, rows, compareRows]);
  if (spec.type === "text") return <div className="textw"><Markdown text={spec.content ?? ""} /></div>;
  if (spec.type === "section") return null;
  if (spec.type === "insight") return <InsightBody rows={rows} spec={spec} />;
  if (own && hasCompare(compareRows)) {
    // The query already compares with the period before; drawing the dashboard comparison on top would double it.
    return (
      <>
        <WidgetBody spec={spec} rows={rows} tableView={tableView} />
        <div className="cmp-caption">Compares with the period before on its own; the dashboard comparison is not drawn here</div>
      </>
    );
  }
  const cmp = hasCompare(compareRows) && spec.type !== "segmented" ? compareRows : undefined;
  if (tableView || spec.type === "table") {
    const fmt = spec.type === "table" ? undefined : spec.format;
    return cmp ? <CompareTable rows={rows} compareRows={cmp} fmt={fmt} labels={labels} /> : <DataTable rows={rows} fmt={fmt} />;
  }
  switch (spec.type) {
    case "kpi":
      return <KpiRow rows={kpiRows} spec={spec} compareLabel={cmp ? labels.compare : undefined} />;
    case "bar":
      return cmp ? <CompareBarChart rows={rows} compareRows={cmp} spec={spec} labels={labels} /> : <BarChartW rows={rows} spec={spec} />;
    case "stacked_bar":
      return cmp ? <CompareBarChart rows={rows} compareRows={cmp} spec={spec} labels={labels} stacked /> : <BarChartW rows={rows} spec={spec} stacked />;
    case "line":
      return cmp ? <CompareLineChart rows={rows} compareRows={cmp} spec={spec} labels={labels} starts={starts} /> : <LineChartW rows={rows} spec={spec} />;
    case "segmented":
      return (
        <>
          <SegmentedBar rows={rows} spec={spec} />
          {hasCompare(compareRows) && <div className="cmp-caption">Comparison not shown for this chart type</div>}
        </>
      );
    default:
      return <DataTable rows={rows} />;
  }
}
