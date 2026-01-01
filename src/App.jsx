import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

/**
 * CRYPTO BASKET INDEX (fixed quantities)
 *
 * Business logic:
 *   IndexValue(t) = Σ ( amount_i * price_i(t) )
 *
 * This represents the real-time market value of a fixed basket (a virtual portfolio),
 * not percentage weights.
 *
 * Edit these 3 things:
 * 1) INDEX_NAME
 * 2) BASKET (coin IDs + amounts)
 * 3) fetchPrices(): replace CoinGecko with your “certain website” if needed
 */

const INDEX_NAME = "Индекс Роберта";

// Fixed quantities in the basket (NOT weights). These do NOT need to sum to anything.
// CoinGecko uses “coin IDs” like: bitcoin, ethereum, solana, etc.
const BASKET = [
  { id: "bitcoin", amount: 0.0001 },
  { id: "ethereum", amount: 0.003 },
  { id: "solana", amount: 0.1 },
  { id: "monero", amount: 0.03 },
  { id: "meteora", amount: 50 },
  { id: "dogecoin", amount: 50 },
  { id: "cardano", amount: 20 },
  { id: "cosmos", amount: 4 },
  { id: "floki", amount: 150000 },
  { id: "jupiter-perpetuals-liquidity-provider-token", amount: 3 },
  { id: "digibyte", amount: 1000 },
  { id: "avalanche-2", amount: 1 },
];

const VS = "usd";

// 15 minutes
const REFRESH_MS = 15 * 60 * 1000;

// Optional: set in your env as VITE_COINGECKO_KEY=...
// CoinGecko docs mention `x-cg-demo-api-key` for some uses.
const COINGECKO_KEY = import.meta?.env?.VITE_COINGECKO_KEY;
console.log(COINGECKO_KEY, "COINGECKO_KEY");
console.log( "COINGECKO_KEY");

console.log(import.meta?.env, "import.meta?.env");

function nowIsoMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

function clampSeries(series, maxPoints) {
  if (series.length <= maxPoints) return series;
  return series.slice(series.length - maxPoints);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Fetch current prices.
 *
 * Default implementation uses CoinGecko “simple price”:
 *   GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd
 *
 * If your "certain website" has a different JSON shape, adapt this function
 * to return an object like: { [coinId]: priceNumber }
 */
async function fetchPrices(coinIds, vsCurrency) {
  const ids = coinIds.join(",");
  const url = `robertindexserver-production.up.railway.app/api/prices?ids=${
    ids
  }&vs_currencies=${encodeURIComponent(vsCurrency)}`;

  console.log(url)

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Price fetch failed (${res.status}). ${text}`);
  }
  const json = await res.json();

  // CoinGecko returns: { bitcoin: { usd: 12345 }, ethereum: { usd: 2345 } }
  console.log(json)
  console.log(json?.prices)
  const out = {};
  for (const id of coinIds) {
    const price = json?.prices[id];
    console.log(typeof price, "type")
    if (typeof price !== "number") {
      throw new Error(`Missing price for ${id} in response.`);
    }
    out[id] = price;
  }
  return out;
}

function computeBasketValue(pricesById, basket) {
  let total = 0;
  for (const { id, amount } of basket) {
    const p = pricesById[id];
    if (typeof p !== "number") throw new Error(`No price for ${id}`);
    total += p * (Number(amount) || 0);
  }
  return total;
}

const STORAGE_KEY = "crypto_basket_timeseries_v2";

function loadSeries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.ts === "number" && typeof p.value === "number")
      .slice(-500);
  } catch {
    return [];
  }
}

function saveSeries(series) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(series.slice(-500)));
  } catch {
    // ignore
  }
}

export default function App() {
  const coinIds = useMemo(() => BASKET.map((w) => w.id), []);

  const [series, setSeries] = useState(() => loadSeries());
  const [lastPrices, setLastPrices] = useState(null);
  const [status, setStatus] = useState({
    state: "idle", // idle | loading | ok | error
    message: "",
    updatedAt: null,
  });

  const timerRef = useRef(null);

  async function refreshOnce() {
    setStatus((s) => ({ ...s, state: "loading", message: "Updating…" }));
    try {
      const prices = await fetchPrices(coinIds, VS);
      const value = computeBasketValue(prices, BASKET);

      const t = nowIsoMinute().getTime();
      setLastPrices(prices);

      setSeries((prev) => {
        // Merge by timestamp (avoid duplicates when refreshing close together)
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.ts === t) {
          last.value = value;
        } else {
          next.push({ ts: t, value });
        }
        const trimmed = clampSeries(next, 500);
        saveSeries(trimmed);
        return trimmed;
      });

      setStatus({ state: "ok", message: "Up to date", updatedAt: Date.now() });
    } catch (e) {
      setStatus({
        state: "error",
        message: e?.message || "Failed to update",
        updatedAt: Date.now(),
      });
    }
  }

  useEffect(() => {
    // Initial fetch
    refreshOnce();

    // Refresh every 15 minutes.
    timerRef.current = setInterval(refreshOnce, REFRESH_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartData = useMemo(
    () =>
      series.map((p) => ({
        time: formatTime(p.ts),
        value: p.value,
        ts: p.ts,
      })),
    [series]
  );

  const latest = series.length ? series[series.length - 1].value : null;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Full-width container (no max-width) */}
      <div className="mx-auto max-w-7xl w-full px-4 py-8">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{INDEX_NAME}</h1>
            <p className="text-sm text-neutral-400 py-4">
            Tryin' to start a piggy bank for you so you could go to college.
            </p>

          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={refreshOnce}
              className="rounded-2xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 shadow hover:opacity-90 active:opacity-80"
            >
              Refresh now
            </button>
          </div>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-neutral-900/60 p-4 shadow">
            <div className="text-xs text-neutral-400">Basket value ({VS.toUpperCase()})</div>
            <div className="mt-1 text-2xl font-semibold">
              {latest == null ? "—" : latest.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="rounded-2xl bg-neutral-900/60 p-4 shadow sm:col-span-2">
            <div className="text-xs text-neutral-400">Status</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
                  (status.state === "ok"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : status.state === "loading"
                    ? "bg-amber-500/15 text-amber-300"
                    : status.state === "error"
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-neutral-500/15 text-neutral-300")
                }
              >
                {status.state}
              </span>
              <span className="text-sm text-neutral-200">{status.message}</span>
              {status.updatedAt && (
                <span className="text-xs text-neutral-500">
                  {new Date(status.updatedAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl bg-neutral-900/60 p-4 shadow w-full">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Цена индекса, USD </div>
            <div className="text-xs text-neutral-400">Points stored locally (last 500)</div>
          </div>

          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="time" tick={{ fontSize: 12 }} minTickGap={24} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={70}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                />
                <Tooltip
                  formatter={(v) => [Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }), VS.toUpperCase()]}
                  labelFormatter={(label, payload) => {
                    const ts = payload?.[0]?.payload?.ts;
                    return ts ? new Date(ts).toLocaleString() : label;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="mt-6 rounded-2xl bg-neutral-900/60 p-4 text-sm text-neutral-200 shadow w-full">
          <div className="font-medium">Что в мешочке</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {BASKET.map((asset) => {
              const price = lastPrices?.[asset.id];
              const value = typeof price === "number" ? price * asset.amount : null;
              return (
                <div key={asset.id} className="rounded-xl bg-neutral-950/40 p-3">
                  <div className="text-xs text-neutral-400">{asset.id}</div>
                  <div className="mt-1 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold">
                        {price != null
                          ? price.toLocaleString(undefined, { maximumFractionDigits: 10 })
                          : "—"}
                      </div>
                      <div className="text-xs text-neutral-500">price ({VS.toUpperCase()})</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{asset.amount}</div>
                      <div className="text-xs text-neutral-500">amount</div>
                      <div className="mt-1 text-xs text-neutral-300">
                        {value == null
                          ? "—"
                          : value.toLocaleString(undefined, { maximumFractionDigits: 10 })}{" "}
                        {VS.toUpperCase()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
