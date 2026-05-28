import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";

function interpolateQuantile(sortedValues, ratio) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
}

export function getTrendMonitorScale(values) {
  const finiteValues = Array.isArray(values)
    ? values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
    : [];

  if (finiteValues.length === 0) {
    return {
      rawMax: 0,
      effectiveMax: 1,
      clippedValues: Array.isArray(values) ? values.map(() => 0) : [],
    };
  }

  const rawMax = finiteValues.at(-1) ?? 0;
  let effectiveMax = rawMax;

  if (finiteValues.length >= 4) {
    const q1 = interpolateQuantile(finiteValues, 0.25);
    const q3 = interpolateQuantile(finiteValues, 0.75);
    const iqr = Math.max(q3 - q1, 0);
    const upperWhisker = q3 + iqr * 1.5;
    const hasOutlier = rawMax > upperWhisker;

    if (hasOutlier) {
      effectiveMax = Math.max(upperWhisker, q3, 1);
    }
  }

  return {
    rawMax,
    effectiveMax: Math.max(effectiveMax, 1),
    clippedValues: Array.isArray(values)
      ? values.map((value) => {
          if (!Number.isFinite(value) || value <= 0) return 0;
          return Math.min(value, Math.max(effectiveMax, 1));
        })
      : [],
  };
}

const STACK_COLORS = [
  "#f472b6", // 浅粉 (如儿子)
  "#38bdf8", // 天蓝 (如 OpenAI)
  "#34d399", // 绿色
  "#fbbf24", // 金黄
  "#a78bfa", // 浅紫
  "#fb7185", // 玫瑰红
  "#2dd4bf", // 青色
  "#f97316", // 橙色
  "#6366f1", // 靛蓝
  "#ec4899", // 洋红
  "#14b8a6", // 薄荷绿
  "#f59e0b", // 琥珀黄
];

const TOKEN_COLORS = {
  "Input": "#38bdf8",
  "Cached Input": "#14b8a6",
  "Output": "#a78bfa",
  "Reasoning Output": "#fb7185",
};

const MODEL_PROVIDER_COLORS = {
  codex: "#3b82f6",
  gpt: "#10b981",
  openai: "#10b981",
  
  claude: "#d97757",
  anthropic: "#d97757",
  
  gemini: "#2196f3",
  google: "#2196f3",
  
  kimi: "#a78bfa",
  moonshot: "#a78bfa",

  opencode: "#f59e0b",
  deepseek: "#f59e0b",
  
  droid: "#ef4444",
  
  kilo: "#facc15",
};

function getModelColor(modelName) {
  const normalized = modelName.toLowerCase();
  for (const [key, color] of Object.entries(MODEL_PROVIDER_COLORS)) {
    if (normalized.includes(key)) {
      return color;
    }
  }

  let hash = 0;
  for (let i = 0; i < modelName.length; i++) {
    hash = modelName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % STACK_COLORS.length;
  return STACK_COLORS[index];
}

function getBarSegments(row) {
  if (!row) return [];
  const segments = [];

  // 1. 如果有 models，且 models 相加大于 0，则按模型拆分
  if (row.models && typeof row.models === "object") {
    for (const [modelName, val] of Object.entries(row.models)) {
      const numVal = Number(val);
      if (Number.isFinite(numVal) && numVal > 0) {
        segments.push({
          type: "model",
          name: modelName,
          value: numVal,
        });
      }
    }
  }

  // 2. 如果没有 models，或者 models 分量之和为 0，我们尝试按 Token 类型拆分
  if (segments.length === 0) {
    const tokenTypes = [
      { name: "Input", key: "input_tokens" },
      { name: "Cached Input", key: "cached_input_tokens" },
      { name: "Output", key: "output_tokens" },
      { name: "Reasoning Output", key: "reasoning_output_tokens" },
    ];
    for (const type of tokenTypes) {
      const val = Number(row[type.key]);
      if (Number.isFinite(val) && val > 0) {
        segments.push({
          type: "token_type",
          name: type.name,
          value: val,
        });
      }
    }
  }

  // 按用量降序排列，以使得较大的段沉入底部渲染，小分量在上。
  return segments.sort((a, b) => b.value - a.value);
}

function TrendBar({
  value,
  displayValue,
  scale,
  index,
  row,
  totalBars,
  onMouseEnter,
  onMouseLeave,
}) {
  const shouldReduceMotion = useReducedMotion();
  const heightPercent = scale.effectiveMax > 0 ? (displayValue / scale.effectiveMax) * 100 : 0;
  const barHeight = `${Math.max(heightPercent, 2)}%`;
  const isMissing = row?.missing;
  const isFuture = row?.future;
  const borderRadius = "0px";

  const segments = getBarSegments(row);
  const totalSegmentsValue = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <motion.div
      className="group relative flex-1 self-stretch"
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.3,
        delay: shouldReduceMotion ? 0 : 0.4 + index * 0.008,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{ originY: 1 }}
      onMouseEnter={(e) => onMouseEnter(e, row, value, segments)}
      onMouseLeave={onMouseLeave}
    >
      {/* 纵向整列 Hover 引导条 */}
      <div className="absolute inset-x-0 top-0 bottom-0 bg-oai-gray-100/70 dark:bg-white/[0.08] opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none" />

      <div
        className="absolute inset-x-0 bottom-0 flex flex-col-reverse justify-start overflow-hidden cursor-pointer transition-all duration-200"
        style={{
          height: barHeight,
          minHeight: value > 0 ? "4px" : "2px",
          borderRadius: `${borderRadius} ${borderRadius} 0 0`,
        }}
      >
        {isMissing || isFuture || value <= 0 || totalSegmentsValue <= 0 ? (
          /* 单色/未同步兜底 */
          <div
            data-trend-bar="true"
            className="h-full w-full group-hover:brightness-110"
            style={{
              opacity: isMissing || isFuture ? 0.2 : 1,
              background: value > 0 ? "#10b981" : "var(--oai-gray-100)",
            }}
          />
        ) : (
          /* 堆叠拼接，自底向上绘制 */
          segments.map((seg, sIdx) => {
            const segColor =
              seg.type === "token_type" ? TOKEN_COLORS[seg.name] : getModelColor(seg.name);
            const segHeight = `${(seg.value / totalSegmentsValue) * 100}%`;
            return (
              <div
                key={sIdx}
                data-trend-bar={sIdx === 0 ? "true" : undefined}
                className="w-full group-hover:brightness-110 transition-all"
                style={{
                  height: segHeight,
                  background: segColor,
                }}
              />
            );
          })
        )}
      </div>
    </motion.div>
  );
}

export function TrendMonitor({
  rows,
  from,
  to,
  period,
  timeZoneLabel,
  showTimeZoneLabel = true,
  className = "",
  // When `true`, the trend renders bare: no outer card chrome (rounded
  // border + bg + padding), no inner heading. Use this when the host
  // already provides a section wrapper (e.g. the leaderboard profile
  // modal). Default keeps the standalone dashboard appearance.
  embedded = false,
}) {
  const series = Array.isArray(rows) && rows.length ? rows : [];

  const seriesValues = series.map((row) => {
    if (row?.missing || row?.future) return 0;
    const raw = row?.billable_total_tokens ?? row?.total_tokens ?? row?.value;
    if (raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  });
  const scale = getTrendMonitorScale(seriesValues);

  const [hoveredBar, setHoveredBar] = React.useState(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0, shiftX: 0 });
  const containerRef = React.useRef(null);
  const hideTimeoutRef = React.useRef(null);

  const handleBarMouseEnter = (e, row, value, segments) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    const timeLabel = row?.day || row?.hour || row?.month || "";
    setHoveredBar({
      row,
      value,
      segments,
      timeLabel,
    });

    // 优先寻找真实柱状图定位，以防外层 hover 容器导致 top 坐标上移
    // 注意：data-trend-bar="true" 绑定在子级 segment 上，它的 parentElement 才是整根柱子的实体容器包装 div
    const barEl = e.currentTarget.querySelector('[data-trend-bar="true"]');
    const rect = barEl && barEl.parentElement
      ? barEl.parentElement.getBoundingClientRect()
      : e.currentTarget.getBoundingClientRect();
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const x = rect.left - containerRect.left + rect.width / 2;
    const y = rect.top - containerRect.top;

    // 自适应横向防溢出
    const halfWidth = 140;
    let shiftX = 0;
    if (x < halfWidth) {
      shiftX = halfWidth - x;
    } else if (x > containerRect.width - halfWidth) {
      shiftX = (containerRect.width - halfWidth) - x;
    }

    setTooltipPos({ x, y, shiftX });
  };

  const handleBarMouseLeave = () => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredBar(null);
    }, 150);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative",
        !embedded &&
          "rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5",
        className,
      )}
    >
      {!embedded && (
        <div className="mb-3">
          <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
            {copy("trend.monitor.label")}
          </h3>
          {showTimeZoneLabel && timeZoneLabel && (
            <p className="text-xs text-oai-gray-400 dark:text-oai-gray-400 mt-0.5">{timeZoneLabel}</p>
          )}
        </div>
      )}
      <div className="space-y-3">
        <div className="relative">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                className="w-full border-t border-oai-gray-100 dark:border-oai-gray-800"
                style={{ top: `${100 - pct}%` }}
              />
            ))}
          </div>
          <div className="h-40 flex items-end gap-0.5 relative z-0">
            {seriesValues.length > 0 ? (
              seriesValues.map((value, index) => (
                <TrendBar
                  key={index}
                  value={value}
                  displayValue={scale.clippedValues[index] ?? 0}
                  scale={scale}
                  index={index}
                  row={series[index]}
                  totalBars={seriesValues.length}
                  onMouseEnter={handleBarMouseEnter}
                  onMouseLeave={handleBarMouseLeave}
                />
              ))
            ) : (
              <div className="flex-1 h-full flex items-center justify-center">
                <p className="text-sm text-oai-gray-400 dark:text-oai-gray-400">No data yet</p>
              </div>
            )}
          </div>
        </div>

        {from && to && (
          <div className="flex justify-between text-xs text-oai-gray-500 dark:text-oai-gray-300 font-medium pt-2 border-t border-oai-gray-100 dark:border-oai-gray-800">
            <span>{from === to ? `${from} 00:00` : from}</span>
            <span>{from === to ? `${to} 24:00` : to}</span>
          </div>
        )}
      </div>

      {/* 2D 精致 Hover Tooltip */}
      {hoveredBar && (
        <div
          className="absolute z-[9999] w-0 h-0 transition-all duration-100 ease-out pointer-events-none"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
          }}
        >
          {/* Tooltip 玻璃外框（底边固定在柱子上方） */}
          <div
            className="absolute left-0 bottom-[10px] backdrop-blur-md bg-white/95 dark:bg-oai-gray-900/95 border border-oai-gray-200/50 dark:border-oai-gray-800/50 shadow-xl rounded-xl p-3.5 max-w-[280px] min-w-[220px] flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-100"
            style={{
              transform: `translateX(calc(-50% + ${tooltipPos.shiftX}px))`,
            }}
          >
            {/* 顶栏 */}
            <div className="flex items-center justify-between border-b border-oai-gray-100 dark:border-oai-gray-800/80 pb-1.5">
              <span className="text-[11px] font-semibold text-oai-gray-500 dark:text-oai-gray-400">
                {hoveredBar.timeLabel}
              </span>
            </div>

            {/* 内容 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-oai-gray-900 dark:text-white leading-none">
                  {hoveredBar.value.toLocaleString()}
                </span>
                <span className="text-[10px] text-oai-gray-400 uppercase tracking-wider font-semibold">
                  Tokens
                </span>
              </div>

              {hoveredBar.segments && hoveredBar.segments.length > 0 ? (
                <div className="mt-1.5 border-t border-oai-gray-100 dark:border-oai-gray-800/60 pt-2 flex flex-col gap-1.5">
                  <div className="text-[10px] font-semibold text-oai-gray-400 dark:text-oai-gray-500 uppercase tracking-wider">
                    {hoveredBar.segments[0].type === "model" ? "Model Breakdown" : "Token Breakdown"}
                  </div>
                  <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto pr-1.5 oai-scrollbar">
                    {hoveredBar.segments.map(({ name, value: val, type }) => {
                      const total = hoveredBar.value || 1;
                      const pct = Math.round((val / total) * 100);
                      const color =
                        type === "token_type" ? TOKEN_COLORS[name] : getModelColor(name);
                      return (
                        <div key={name} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[11px] gap-3">
                            <span
                              className="font-medium text-oai-gray-750 dark:text-oai-gray-200 truncate max-w-[130px]"
                              title={name}
                            >
                              {name}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-oai-gray-900 dark:text-oai-gray-100 font-semibold">
                                {val.toLocaleString()}
                              </span>
                              <span className="text-[9px] text-oai-gray-450 dark:text-oai-gray-500 min-w-[28px] text-right font-medium">
                                {pct}%
                              </span>
                            </div>
                          </div>
                          <div className="w-full h-1 bg-oai-gray-100 dark:bg-oai-gray-800/85 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: color,
                                boxShadow: `0 0 4px ${color}55`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* 倒三角小尾巴 */}
          <div
            className="absolute bottom-[6px] left-0 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-white dark:bg-oai-gray-900 border-r border-b border-oai-gray-200/50 dark:border-oai-gray-800/50 shadow-sm"
            style={{ marginBottom: "1px" }}
          />
        </div>
      )}
    </div>
  );
}
