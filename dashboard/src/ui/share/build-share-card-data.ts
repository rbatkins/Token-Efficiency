import { toFiniteNumber } from "../../lib/format";

type AnyRec = Record<string, any>;

export type ShareCardPeriod = "day" | "week" | "month" | "total" | "custom";

export interface ShareCardModel {
  id: string | null;
  name: string;
  tokens: number;
  percent: string;
}

export interface ShareCardHeatmapCell {
  day: string;
  level: number;
  future: boolean;
}

export interface ShareCardData {
  handle: string;
  startDate: string | null;
  activeDays: number;
  totalTokens: number;
  totalCost: number;
  period: ShareCardPeriod;
  periodFrom: string | null;
  periodTo: string | null;
  topModels: ShareCardModel[];
  rank: number | null;
  heatmapWeeks: ShareCardHeatmapCell[][];
  heatmapTotalDays: number;
  heatmapActiveDays: number;
  capturedAt: string;
}

function coerceNumber(value: unknown): number {
  const n = toFiniteNumber(value as any);
  return Number.isFinite(n as number) ? (n as number) : 0;
}

function pickBillable(row: AnyRec | null | undefined): number {
  if (!row) return 0;
  return coerceNumber(row.billable_total_tokens ?? row.total_tokens);
}

function normalizeHeatmap(raw: any): {
  weeks: ShareCardHeatmapCell[][];
  totalDays: number;
  activeDays: number;
} {
  const source = Array.isArray(raw?.weeks) ? raw.weeks : [];
  if (!source.length) return { weeks: [], totalDays: 0, activeDays: 0 };

  let totalDays = 0;
  let activeDays = 0;
  const weeks: ShareCardHeatmapCell[][] = source.map((week: any) => {
    const cells = Array.isArray(week) ? week : [];
    return cells.slice(0, 7).map((cell: any) => {
      const future = Boolean(cell?.future);
      const level = Number.isFinite(cell?.level)
        ? Math.max(0, Math.min(4, Math.round(cell.level)))
        : 0;
      if (cell?.day && !future) {
        totalDays += 1;
        if (level > 0) activeDays += 1;
      }
      return {
        day: typeof cell?.day === "string" ? cell.day : "",
        level,
        future,
      };
    });
  });

  return { weeks, totalDays, activeDays };
}

export function buildShareCardData(params: {
  handle: string;
  startDate: string | null;
  activeDays: number;
  summary: AnyRec | null;
  topModels: ShareCardModel[] | null | undefined;
  rank: number | null;
  period: ShareCardPeriod;
  periodFrom: string | null;
  periodTo: string | null;
  heatmap?: AnyRec | null;
  capturedAt?: string;
}): ShareCardData {
  const {
    handle,
    startDate,
    activeDays,
    summary,
    topModels,
    rank,
    period,
    periodFrom,
    periodTo,
    heatmap,
    capturedAt,
  } = params;

  const totalTokens = pickBillable(summary);
  const totalCost = coerceNumber(summary?.total_cost_usd);

  const normalizedModels: ShareCardModel[] = Array.isArray(topModels)
    ? topModels.slice(0, 3).map((m) => ({
        id: m?.id ?? null,
        name: typeof m?.name === "string" && m.name ? m.name : "—",
        tokens: coerceNumber((m as AnyRec)?.tokens),
        percent:
          typeof m?.percent === "string" && m.percent ? m.percent : "0.0",
      }))
    : [];

  const hm = normalizeHeatmap(heatmap);

  return {
    handle: handle || "—",
    startDate: startDate || null,
    activeDays: Number.isFinite(activeDays) && activeDays > 0 ? Math.floor(activeDays) : 0,
    totalTokens,
    totalCost,
    period,
    periodFrom,
    periodTo,
    topModels: normalizedModels,
    rank: typeof rank === "number" && Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : null,
    heatmapWeeks: hm.weeks,
    heatmapTotalDays: hm.totalDays,
    heatmapActiveDays: hm.activeDays,
    capturedAt: capturedAt || new Date().toISOString(),
  };
}

const MONTH_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

export function formatShortDate(isoDay: string | null): string {
  if (!isoDay) return "—";
  const parts = isoDay.split("-");
  if (parts.length !== 3) return isoDay;
  const [y, m] = parts;
  const monthIdx = Number(m) - 1;
  if (monthIdx < 0 || monthIdx > 11) return isoDay;
  return `${MONTH_SHORT[monthIdx]} ${y}`;
}

export function formatIssueLabel(data: ShareCardData): string {
  if (data.period === "total") return "ALL TIME";
  if (data.period === "day" && data.periodTo) return data.periodTo.replace(/-/g, ".");
  if (data.period === "custom" && data.periodFrom && data.periodTo) {
    return `${data.periodFrom.replace(/-/g, ".")} — ${data.periodTo.replace(/-/g, ".")}`;
  }
  if (data.periodTo) {
    const d = new Date(`${data.periodTo}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
  }
  return String(data.period).toUpperCase();
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toFixed(2)}`;
}

// Social-share "verbal hook" — a single quotable line derived from the data.
// Goal: give the viewer one sentence they can understand in 0.5 seconds.
// Priority order: loyalty → streak → diversity → fallback.
export function buildShareHook(data: ShareCardData): string {
  const top = data.topModels[0];
  if (top) {
    const pct = parseFloat(top.percent);
    if (Number.isFinite(pct) && pct >= 60) {
      return `${Math.round(pct)}% loyal to ${top.name}.`;
    }
    if (data.activeDays >= 60) {
      return `${data.activeDays} days on the record.`;
    }
    if (Number.isFinite(pct) && pct >= 30) {
      return `Led by ${top.name} (${Math.round(pct)}%).`;
    }
    if (data.topModels.length > 1) {
      return `Across ${data.topModels.length} models, ${data.activeDays} days.`;
    }
    return `${data.activeDays} days with ${top.name}.`;
  }
  if (data.activeDays > 0) {
    return `${data.activeDays} days on the record.`;
  }
  return "The beginning of a new chapter.";
}

// Dynamically compute hero font size so long numbers still fit the card.
// Width-based: shrink linearly as character count exceeds `baseChars`.
export function heroFontSize(
  text: string,
  options: { baseSize: number; baseChars: number; shrinkPerChar: number; minSize: number },
): number {
  const len = (text || "").length;
  if (len <= options.baseChars) return options.baseSize;
  const shrunk = options.baseSize - (len - options.baseChars) * options.shrinkPerChar;
  return Math.max(options.minSize, shrunk);
}
