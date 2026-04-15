/**
 * InsForge Edge: account-wide usage broken down by source + model (cross-device, by user_id).
 * Mirrors local-api.js `tokentracker-usage-model-breakdown` response schema.
 */
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwtUserId(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadRaw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadRaw + "=".repeat((4 - (payloadRaw.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const sub = (payload.sub ?? payload.user_id) as string | undefined;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

const MODEL_PRICING: Record<string, { input: number; output: number; cache_read: number; cache_write?: number }> = {
  "claude-opus-4-6": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  "claude-opus-4-5-20250414": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-sonnet-4-5-20250514": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  "claude-3-5-haiku-20241022": { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  "gpt-5": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5-fast": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5-high": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5-high-fast": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5-codex": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5-codex-high-fast": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5.1-codex": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5.1-codex-mini": { input: 0.25, output: 2, cache_read: 0.025 },
  "gpt-5.1-codex-max": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5.1-codex-max-high-fast": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5.1-codex-max-xhigh-fast": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5.1-codex-high": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5.1-codex-max-high": { input: 1.25, output: 10, cache_read: 0.125 },
  "gpt-5.2": { input: 1.75, output: 14, cache_read: 0.175 },
  "gpt-5.2-high": { input: 1.75, output: 14, cache_read: 0.175 },
  "gpt-5.2-high-fast": { input: 1.75, output: 14, cache_read: 0.175 },
  "gpt-5.2-codex": { input: 1.75, output: 14, cache_read: 0.175 },
  "gpt-5.2-codex-high": { input: 1.75, output: 14, cache_read: 0.175 },
  "gpt-5.3-codex": { input: 1.75, output: 14, cache_read: 0.175 },
  "gpt-5.3-codex-high": { input: 1.75, output: 14, cache_read: 0.175 },
  "gpt-5.4": { input: 2.5, output: 15, cache_read: 0.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cache_read: 0.075 },
  "gpt-5.4-medium": { input: 1.5, output: 10, cache_read: 0.15 },
  "o3": { input: 2, output: 8, cache_read: 0.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cache_read: 0.125 },
  "gemini-2.5-pro-preview-06-05": { input: 1.25, output: 10, cache_read: 0.125 },
  "gemini-2.5-pro-preview-05-06": { input: 1.25, output: 10, cache_read: 0.125 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cache_read: 0.03 },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cache_read: 0.05 },
  "gemini-3-pro-preview": { input: 2, output: 12, cache_read: 0.2 },
  "gemini-3.1-pro-preview": { input: 2, output: 12, cache_read: 0.2 },
  "composer-1": { input: 1.25, output: 10, cache_read: 0.125 },
  "composer-1.5": { input: 3.5, output: 17.5, cache_read: 0.35 },
  "composer-2": { input: 0.5, output: 2.5, cache_read: 0.2 },
  "composer-2-fast": { input: 1.5, output: 7.5, cache_read: 0.15 },
  "kimi-for-coding": { input: 0.6, output: 2, cache_read: 0.15 },
  "kimi-k2.5": { input: 0.6, output: 2, cache_read: 0.15 },
  "kimi-k2.5-free": { input: 0, output: 0, cache_read: 0 },
  "glm-4.7-free": { input: 0, output: 0, cache_read: 0 },
  "nemotron-3-super-free": { input: 0, output: 0, cache_read: 0 },
  "mimo-v2-pro-free": { input: 0, output: 0, cache_read: 0 },
  "minimax-m2.1-free": { input: 0, output: 0, cache_read: 0 },
  "MiniMax-M2.1": { input: 0.5, output: 3, cache_read: 0.05 },
};
const ZERO_PRICING = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

function getModelPricing(model: string) {
  if (!model) return ZERO_PRICING;
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return MODEL_PRICING["claude-opus-4-6"];
  if (lower.includes("haiku")) return MODEL_PRICING["claude-haiku-4-5-20251001"];
  if (lower.includes("sonnet")) return MODEL_PRICING["claude-sonnet-4-6"];
  if (lower.includes("gpt-5.4")) return MODEL_PRICING["gpt-5.4"];
  if (lower.includes("gpt-5.3")) return MODEL_PRICING["gpt-5.3-codex"];
  if (lower.includes("gpt-5.2")) return MODEL_PRICING["gpt-5.2"];
  if (lower.includes("gpt-5.1")) return MODEL_PRICING["gpt-5.1-codex"];
  if (lower.includes("gpt-5")) return MODEL_PRICING["gpt-5"];
  if (lower.includes("gemini-3")) return MODEL_PRICING["gemini-3-flash-preview"];
  if (lower.includes("gemini-2.5")) return MODEL_PRICING["gemini-2.5-pro"];
  if (lower.includes("kimi")) return MODEL_PRICING["kimi-k2.5"];
  if (lower.includes("composer")) return MODEL_PRICING["composer-1"];
  if (lower === "auto") return MODEL_PRICING["composer-1"];
  return ZERO_PRICING;
}

interface HourlyRow {
  hour_start: string;
  source: string;
  model: string;
  total_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  reasoning_output_tokens: number | null;
}

interface Totals {
  total_tokens: number;
  billable_total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_output_tokens: number;
  total_cost_usd: string;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const userId = decodeJwtUserId(req.headers.get("Authorization"));
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!from || !to) return json({ error: "Missing from/to" }, 400);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  const dbToken = serviceRoleKey || anonKey;

  const client = createClient({
    baseUrl,
    edgeFunctionToken: dbToken,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });

  const rangeStart = `${from}T00:00:00Z`;
  const nextDay = new Date(`${to}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const rangeEnd = nextDay.toISOString();

  const rows: HourlyRow[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await client.database
      .from("tokentracker_hourly")
      .select(
        "hour_start, source, model, total_tokens, input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens, reasoning_output_tokens",
      )
      .eq("user_id", userId)
      .gte("hour_start", rangeStart)
      .lt("hour_start", rangeEnd)
      .order("hour_start", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) return json({ error: error.message }, 500);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as HourlyRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Filter on inclusive [from, to] by day
  const filtered = rows.filter((r) => {
    if (!r.hour_start) return false;
    const d = String(r.hour_start).slice(0, 10);
    return d >= from && d <= to;
  });

  interface ModelAgg {
    model: string;
    model_id: string;
    totals: Totals;
  }
  interface SourceAgg {
    source: string;
    totals: Totals;
    models: Map<string, ModelAgg>;
  }

  const newTotals = (): Totals => ({
    total_tokens: 0,
    billable_total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_cost_usd: "0",
  });

  const bySource = new Map<string, SourceAgg>();
  for (const row of filtered) {
    const src = row.source || "unknown";
    const mdl = row.model || "unknown";
    let sa = bySource.get(src);
    if (!sa) {
      sa = { source: src, totals: newTotals(), models: new Map() };
      bySource.set(src, sa);
    }
    const tt = Number(row.total_tokens) || 0;
    sa.totals.total_tokens += tt;
    sa.totals.billable_total_tokens += tt;
    sa.totals.input_tokens += Number(row.input_tokens) || 0;
    sa.totals.output_tokens += Number(row.output_tokens) || 0;
    sa.totals.cached_input_tokens += Number(row.cached_input_tokens) || 0;
    sa.totals.cache_creation_input_tokens += Number(row.cache_creation_input_tokens) || 0;
    sa.totals.reasoning_output_tokens += Number(row.reasoning_output_tokens) || 0;

    let ma = sa.models.get(mdl);
    if (!ma) {
      ma = { model: mdl, model_id: mdl, totals: newTotals() };
      sa.models.set(mdl, ma);
    }
    ma.totals.total_tokens += tt;
    ma.totals.billable_total_tokens += tt;
    ma.totals.input_tokens += Number(row.input_tokens) || 0;
    ma.totals.output_tokens += Number(row.output_tokens) || 0;
    ma.totals.cached_input_tokens += Number(row.cached_input_tokens) || 0;
    ma.totals.cache_creation_input_tokens += Number(row.cache_creation_input_tokens) || 0;
    ma.totals.reasoning_output_tokens += Number(row.reasoning_output_tokens) || 0;
  }

  const sources = Array.from(bySource.values()).map((s) => {
    const models = Array.from(s.models.values())
      .map((m) => {
        const p = getModelPricing(m.model);
        const cost =
          ((m.totals.input_tokens || 0) * (p.input || 0) +
            (m.totals.output_tokens || 0) * (p.output || 0) +
            (m.totals.cached_input_tokens || 0) * (p.cache_read || 0) +
            (m.totals.cache_creation_input_tokens || 0) * ((p.cache_write ?? 0)) +
            (m.totals.reasoning_output_tokens || 0) * (p.output || 0)) /
          1_000_000;
        return {
          model: m.model,
          model_id: m.model_id,
          totals: { ...m.totals, total_cost_usd: cost.toFixed(6) },
        };
      })
      .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
    const sourceCost = models.reduce((sum, m) => sum + Number(m.totals.total_cost_usd), 0);
    return {
      source: s.source,
      totals: { ...s.totals, total_cost_usd: sourceCost.toFixed(6) },
      models,
    };
  });

  return json({
    from,
    to,
    days: 0,
    sources,
    pricing: {
      model: "per-model",
      pricing_mode: "per_token_type",
      source: "litellm",
      effective_from: new Date().toISOString().slice(0, 10),
    },
  });
}
