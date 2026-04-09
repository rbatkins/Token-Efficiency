import React from "react";
import { Check } from "lucide-react";
import { copy } from "../lib/copy";

/* ---------- SVG widget illustrations ----------
 * Hand-drawn previews of each macOS widget. Pure SVG so they stay crisp,
 * theme-aware, and don't require shipping PNGs.
 *
 * Hardcoded strings ("TODAY", "12.4M", "claude-opus-4-6", etc.) intentionally
 * bypass copy.csv — they mirror the literal Swift string constants in
 * TokenTrackerWidget/Widgets/*.swift, which ship English-only in the native app.
 */

/**
 * PreviewShell — renders a widget tile at the real macOS systemMedium size.
 *
 * systemMedium is ~2.12:1 (WidgetKit units ~338×158pt). We scale down to
 * 264×124px so the tile sits comfortably in the card grid. Fixed px (not %)
 * keeps proportions honest on wide screens.
 */
const WIDGET_W = 264;
const WIDGET_H = 124;
const ROUNDED_FONT = "ui-rounded, -apple-system, system-ui";

// Model accent palette — hex values mirror WidgetTheme.modelDot in
// TokenTrackerWidget/Views/WidgetTheme.swift
const MODEL_COLORS = ["#5A8CF2", "#9973E6", "#4DB8A6", "#E68C59"];

// Source accent palette — mirrors WidgetTheme.sourceColor (SwiftUI system
// colors, approximated in hex to match rendered appearance)
const SOURCE_COLORS = {
  claude: "#C77DFF", // SwiftUI .purple
  codex: "#34C759",  // SwiftUI .green
  cursor: "#FFCC00", // SwiftUI .yellow
  gemini: "#0A84FF", // SwiftUI .blue
};

// Limit bar fill — mirrors WidgetTheme.limitBarColor
function limitBarFill(fraction) {
  if (fraction >= 0.9) return "#E64D4D"; // red
  if (fraction >= 0.7) return "#D9A633"; // amber
  return "#33B866";                      // green
}

function PreviewShell({ children }) {
  // Tile is `oai-gray-800` in dark mode — lighter than the card's
  // `oai-gray-900` so it reads as "raised" against the darker wash.
  // `rounded-[22px]` is an intentional deviation from the design system's
  // token radii: it mimics the real macOS widget continuous-corner radius
  // so the preview reads as an Apple widget rather than a generic card.
  return (
    <div className="flex w-full items-center justify-center rounded-lg bg-oai-gray-100 dark:bg-oai-gray-950/60 py-6">
      <div
        className="overflow-hidden rounded-[22px] bg-white dark:bg-oai-gray-800 shadow-oai dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_4px_16px_rgba(0,0,0,0.5)]"
        style={{ width: WIDGET_W, height: WIDGET_H }}
      >
        {children}
      </div>
    </div>
  );
}

function SummaryWidgetPreview() {
  // Medium layout: two hero columns (TODAY / 7 DAYS) + full-width glowing
  // sparkline across the bottom. Matches SummaryWidget MediumView.
  const sparklinePath = "M14,104 C26,98 34,100 44,96 S58,88 68,92 80,100 90,94 102,80 112,82 126,92 136,88 150,74 162,76 178,88 188,86 204,72 216,74 236,84 250,80";
  return (
    <PreviewShell>
      <svg viewBox="0 0 264 124" className="h-full w-full" aria-hidden="true">
        <defs>
          <filter id="sparkGlow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* TODAY column */}
        <text x="14" y="20" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="8" fontWeight="700" letterSpacing="0.6">TODAY</text>
        <text x="14" y="46" className="fill-oai-black dark:fill-white" fontSize="22" fontWeight="700" fontFamily={ROUNDED_FONT}>203.2M</text>
        <text x="14" y="60" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="8" fontWeight="500" fontFamily={ROUNDED_FONT}>
          $129.56 ±0%
        </text>

        {/* 7 DAYS column */}
        <text x="134" y="20" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="8" fontWeight="700" letterSpacing="0.6">7 DAYS</text>
        <text x="134" y="46" className="fill-oai-black dark:fill-white" fontSize="22" fontWeight="700" fontFamily={ROUNDED_FONT}>880.9M</text>
        <text x="134" y="60" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="8" fontWeight="500" fontFamily={ROUNDED_FONT}>$673.61</text>

        {/* Glowing sparkline — soft blur layer under a crisp stroke */}
        <path d={sparklinePath} fill="none" stroke="#0A84FF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" filter="url(#sparkGlow)" />
        <path d={sparklinePath} fill="none" stroke="#5AC8FF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </PreviewShell>
  );
}

// Deterministic heatmap cells — 26 weeks × 7 days, matching the Swift
// HeatmapWidget.weeks value for systemMedium. Computed once at module load.
//
// Intensity uses a sin-based hash (GLSL classic) because a straight
// `(w*7+d)*9301+49297 mod 100` produces near-uniform high values and makes
// every cell look the same brightness. This produces a well-distributed
// 0..99 scramble while staying deterministic.
const HEATMAP_CELLS = (() => {
  const weeks = 26;
  const days = 7;
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const n = Math.sin((w + 1) * 12.9898 + (d + 1) * 78.233 + 17) * 43758.5453;
      const v = Math.floor(Math.abs(n - Math.floor(n)) * 100);
      cells.push({ w, d, v });
    }
  }
  return cells;
})();

// Mirrors WidgetTheme.heatmapLevels — gray base + four steps of accent blue.
// Empty-cell grays snap to oai-gray-200 / oai-gray-800 (design system tokens);
// the blue is the macOS system accent, kept as a literal because the real
// WidgetKit widget renders it in SwiftUI's Color.accentColor.
function heatmapFill(v, dark) {
  if (v < 18) return dark ? "#262626" /* oai-gray-800 */ : "#e5e5e5" /* oai-gray-200 */;
  if (v < 38) return "rgba(10, 132, 255, 0.28)";
  if (v < 58) return "rgba(10, 132, 255, 0.50)";
  if (v < 80) return "rgba(10, 132, 255, 0.75)";
  return "#0A84FF";
}

function HeatmapWidgetPreview() {
  // Layout math for a 264×124 tile:
  //   cellW 7.5, cellH 8, gap 1.2, 26 cols × 7 rows
  //   grid width  = 26*7.5 + 25*1.2 = 225   → left margin (264-225)/2 = 19.5
  //   grid height = 7*8   + 6*1.2  = 63.2
  //   top 18 → grid ends at 81.2 → ~17px gap → footer baseline 108 → ~16px
  //   bottom. Gives the grid visible breathing room on all four sides
  //   instead of hugging the top edge.
  const cellW = 7.5;
  const cellH = 8;
  const gap = 1.2;
  const gridX = 19.5;
  const gridY = 21;
  return (
    <PreviewShell>
      <svg viewBox="0 0 264 124" className="h-full w-full" aria-hidden="true">
        {/* Dark-mode grid */}
        <g transform={`translate(${gridX}, ${gridY})`} className="hidden dark:inline">
          {HEATMAP_CELLS.map((c) => (
            <rect
              key={`d-${c.w}-${c.d}`}
              x={c.w * (cellW + gap)}
              y={c.d * (cellH + gap)}
              width={cellW}
              height={cellH}
              rx="1.3"
              fill={heatmapFill(c.v, true)}
            />
          ))}
        </g>
        {/* Light-mode grid */}
        <g transform={`translate(${gridX}, ${gridY})`} className="dark:hidden">
          {HEATMAP_CELLS.map((c) => (
            <rect
              key={`l-${c.w}-${c.d}`}
              x={c.w * (cellW + gap)}
              y={c.d * (cellH + gap)}
              width={cellW}
              height={cellH}
              rx="1.3"
              fill={heatmapFill(c.v, false)}
            />
          ))}
        </g>
        {/* Footer caption — aligned with the grid's left edge */}
        <text x={gridX} y="108" className="fill-oai-black dark:fill-white" fontSize="10" fontWeight="700" fontFamily={ROUNDED_FONT}>
          10.3B
        </text>
        <text x={gridX + 30} y="108" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="9" fontWeight="500">
          tokens · 202 active days
        </text>
      </svg>
    </PreviewShell>
  );
}

function TopModelsWidgetPreview() {
  // Four rows, each: [dot] [name] ... [value] [%] / thin colored bar below.
  // Mirrors ModelBar in TopModelsWidget.swift. Note the bar color equals
  // the dot color (not a neutral track).
  const models = [
    { name: "claude-opus-4-6",        value: "586.4M", pct: 59 },
    { name: "claude-sonnet-4-5-20250929", value: "218.7M", pct: 22 },
    { name: "gpt-5.4",                value: "80.6M",  pct: 8 },
    { name: "composer-2-fast",        value: "52.1M",  pct: 5 },
  ];
  const rowGap = 22;
  // Vertically centered: content spans ~78px (4 rows × 22 + dot + bar),
  // tile is 124px, so first baseline sits at 28 to balance the stack.
  const rowStart = 28;
  const barY0 = 4;
  const trackX = 14;
  const trackW = 236;
  return (
    <PreviewShell>
      <svg viewBox="0 0 264 124" className="h-full w-full" aria-hidden="true">
        {models.map((m, i) => {
          const y = rowStart + i * rowGap;
          const color = MODEL_COLORS[i % MODEL_COLORS.length];
          return (
            <g key={m.name}>
              {/* dot */}
              <circle cx="18" cy={y - 3} r="2.5" fill={color} />
              {/* name */}
              <text x="26" y={y} className="fill-oai-black dark:fill-white" fontSize="9" fontWeight="500">
                {m.name}
              </text>
              {/* value */}
              <text x="218" y={y} textAnchor="end" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="9" fontWeight="600" fontFamily={ROUNDED_FONT}>
                {m.value}
              </text>
              {/* percent */}
              <text x="250" y={y} textAnchor="end" className="fill-oai-gray-500 dark:fill-oai-gray-500" fontSize="8" fontWeight="600" fontFamily={ROUNDED_FONT}>
                {m.pct}%
              </text>
              {/* track */}
              <rect x={trackX} y={y + barY0} width={trackW} height="2.8" rx="1.4" className="fill-oai-gray-200 dark:fill-oai-gray-700" />
              {/* filled bar in dot color */}
              <rect x={trackX} y={y + barY0} width={Math.max(trackW * (m.pct / 100), 4)} height="2.8" rx="1.4" fill={color} />
            </g>
          );
        })}
      </svg>
    </PreviewShell>
  );
}

function UsageLimitsWidgetPreview() {
  // Four rows mirroring LimitRow in UsageLimitsWidget.swift. The bullet
  // color follows the source (purple for claude, green for codex, yellow
  // for cursor); the bar fill follows limitBarColor(fraction) — all four
  // rows below are <70% so their bars render green.
  const rows = [
    { label: "Claude · 7d",     source: "claude", reset: "in 1d",     pct: 61 },
    { label: "Claude · 5h",     source: "claude", reset: "in 4h 28m", pct: 4 },
    { label: "Cursor",          source: "cursor", reset: "in 25d",    pct: 51 },
    { label: "Codex · weekly",  source: "codex",  reset: "in 1d",     pct: 32 },
  ];
  const rowGap = 22;
  // Vertically centered — see TopModelsWidgetPreview for the math.
  const rowStart = 28;
  const trackX = 14;
  const trackW = 236;
  return (
    <PreviewShell>
      <svg viewBox="0 0 264 124" className="h-full w-full" aria-hidden="true">
        {rows.map((r, i) => {
          const y = rowStart + i * rowGap;
          const dot = SOURCE_COLORS[r.source];
          const fill = limitBarFill(r.pct / 100);
          return (
            <g key={r.label}>
              <circle cx="18" cy={y - 3} r="2.5" fill={dot} />
              <text x="26" y={y} className="fill-oai-black dark:fill-white" fontSize="9" fontWeight="500">
                {r.label}
              </text>
              <text x="218" y={y} textAnchor="end" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="8" fontWeight="500" fontFamily={ROUNDED_FONT}>
                {r.reset}
              </text>
              <text x="250" y={y} textAnchor="end" className="fill-oai-black dark:fill-white" fontSize="9" fontWeight="700" fontFamily={ROUNDED_FONT}>
                {r.pct}%
              </text>
              <rect x={trackX} y={y + 4} width={trackW} height="2.8" rx="1.4" className="fill-oai-gray-200 dark:fill-oai-gray-700" />
              <rect x={trackX} y={y + 4} width={Math.max(trackW * (r.pct / 100), 4)} height="2.8" rx="1.4" fill={fill} />
            </g>
          );
        })}
      </svg>
    </PreviewShell>
  );
}

/* ---------- Widget catalog data ---------- */

function getWidgets() {
  return [
    {
      id: "summary",
      Preview: SummaryWidgetPreview,
      name: copy("widgets.summary.name"),
      description: copy("widgets.summary.description"),
      sizes: copy("widgets.summary.sizes"),
    },
    {
      id: "heatmap",
      Preview: HeatmapWidgetPreview,
      name: copy("widgets.heatmap.name"),
      description: copy("widgets.heatmap.description"),
      sizes: copy("widgets.heatmap.sizes"),
    },
    {
      id: "topModels",
      Preview: TopModelsWidgetPreview,
      name: copy("widgets.topModels.name"),
      description: copy("widgets.topModels.description"),
      sizes: copy("widgets.topModels.sizes"),
    },
    {
      id: "limits",
      Preview: UsageLimitsWidgetPreview,
      name: copy("widgets.limits.name"),
      description: copy("widgets.limits.description"),
      sizes: copy("widgets.limits.sizes"),
    },
  ];
}

/* ---------- Shared UI bits ---------- */

function SectionHeading({ children }) {
  return (
    <h2 className="mb-5 text-xs font-semibold uppercase tracking-wider text-oai-gray-500 dark:text-oai-gray-400">
      {children}
    </h2>
  );
}

function StepItem({ index, title, description }) {
  return (
    <li className="flex gap-4">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-oai-gray-300 dark:border-oai-gray-700 text-[11px] font-semibold text-oai-gray-700 dark:text-oai-gray-300 tabular-nums">
        {index}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-oai-black dark:text-white">{title}</div>
        <div className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400 leading-relaxed">{description}</div>
      </div>
    </li>
  );
}

function TipItem({ children }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-oai-gray-400 dark:text-oai-gray-500" aria-hidden="true" />
      <span className="text-sm text-oai-gray-600 dark:text-oai-gray-400 leading-relaxed">{children}</span>
    </li>
  );
}

/* ---------- Page ---------- */

export function WidgetsPage() {
  const widgets = getWidgets();

  return (
    <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Header */}
          <header className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-oai-black dark:text-white mb-3">
              {copy("widgets.page.title")}
            </h1>
            <p className="text-oai-gray-500 dark:text-oai-gray-400 text-sm sm:text-base max-w-2xl">
              {copy("widgets.page.subtitle")}
            </p>
          </header>

          {/* Widget catalog — the only section that needs card surfaces, because
              each widget is a distinct browsable item */}
          <section className="mb-14">
            <SectionHeading>{copy("widgets.section.catalog")}</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              {widgets.map(({ id, Preview, name, description, sizes }) => (
                <article
                  key={id}
                  // Matches the shared <Card> component's surface classes so
                  // widget tiles sit alongside other cards on /limits and
                  // /settings with the same border, radius, and bg treatment.
                  className="rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-4 sm:p-5 transition-colors duration-200"
                >
                  <Preview />
                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-[15px] font-semibold text-oai-black dark:text-white">{name}</h3>
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-oai-gray-500 dark:text-oai-gray-500 tabular-nums">
                        {sizes}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-oai-gray-500 dark:text-oai-gray-400 leading-relaxed">
                      {description}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* Activation — bare list, no container card */}
          <section className="mb-14">
            <SectionHeading>{copy("widgets.section.activate")}</SectionHeading>
            <ol className="flex flex-col gap-5 max-w-2xl">
              <StepItem
                index={1}
                title={copy("widgets.activate.step1.title")}
                description={copy("widgets.activate.step1.desc")}
              />
              <StepItem
                index={2}
                title={copy("widgets.activate.step2.title")}
                description={copy("widgets.activate.step2.desc")}
              />
              <StepItem
                index={3}
                title={copy("widgets.activate.step3.title")}
                description={
                  <>
                    <span className="rounded bg-oai-gray-100 dark:bg-oai-gray-800 px-1.5 py-0.5 font-mono text-[12px] text-oai-gray-700 dark:text-oai-gray-300">
                      TokenTracker
                    </span>{" "}
                    {copy("widgets.activate.step3.desc")}
                  </>
                }
              />
              <StepItem
                index={4}
                title={copy("widgets.activate.step4.title")}
                description={copy("widgets.activate.step4.desc")}
              />
            </ol>
          </section>

          {/* Tips — bare list, no container card */}
          <section>
            <SectionHeading>{copy("widgets.section.tips")}</SectionHeading>
            <ul className="flex flex-col gap-3 max-w-2xl">
              <TipItem>{copy("widgets.tips.refresh")}</TipItem>
              <TipItem>{copy("widgets.tips.stack")}</TipItem>
              <TipItem>{copy("widgets.tips.sizes")}</TipItem>
              <TipItem>{copy("widgets.tips.menubar")}</TipItem>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
