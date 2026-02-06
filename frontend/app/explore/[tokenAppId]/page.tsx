'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { keccak_256 } from '@noble/hashes/sha3';
import { SvgCandleChart } from './SvgCandleChart';

type TokenRecord = {
  tokenAppId: string;
  name: string;
  symbol: string;
  imageDataUrl?: string;
  createdAt?: number;
};

type PricePoint = { time: number; value: number };
type Candle = { time: number; open: number; high: number; low: number; close: number };
type LinePoint = { time: number; value: number };

const DEFAULT_GRAPHQL_ENDPOINT = 'http://127.0.0.1:8080';
const DEFAULT_CHAIN_ID = '761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced';
const DEFAULT_MATCHING_ENGINE_APP_ID = 'd3f86c75ffb1f389531b93def776a4de877e4b23ea58b348746f4fce910a31be';
const DEFAULT_WLIN_APP_ID = '6a570896ff23d7a1db44398bae8b2ad12101af56cd244a7d694ed94ead048731';
const LS_OWNER = 'linad_owner';
const LS_WALLET = 'linad_wallet_address';
const TEXT_ENCODER = new TextEncoder();
const AMOUNT_DECIMALS = 18n;
const TRADE_TYPE = 'TradeRequest';
const APPROVE_TYPE = 'ApproveRequest';

function parseGraphqlAmountToAttos(value: unknown): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  // GraphQL can serialize `Amount` as string/number, or an object (depending on scalar impl).
  if (typeof value === 'object') {
    const maybe = value as Record<string, unknown>;
    if (typeof maybe.attos === 'string' || typeof maybe.attos === 'number') {
      try {
        return BigInt(String(maybe.attos).trim());
      } catch {
        return null;
      }
    }
    if (typeof maybe.tokens === 'string' || typeof maybe.tokens === 'number') {
      value = String(maybe.tokens);
    } else if (typeof maybe.value === 'string' || typeof maybe.value === 'number') {
      value = String(maybe.value);
    } else {
      try {
        value = JSON.stringify(value);
      } catch {
        value = String(value);
      }
    }
  }

  const raw = String(value).trim().replace(/_/g, '');
  if (!raw) {
    return null;
  }
  if (raw.startsWith('-')) {
    return null;
  }
  const normalized = raw.endsWith('.') ? raw.slice(0, -1) : raw;

  // Heuristic: if it's an integer with many digits, it's probably already attos.
  if (!normalized.includes('.')) {
    const digitsOnly = normalized.replace(/^\+/, '');
    if (/^\d+$/.test(digitsOnly) && digitsOnly.length > 18) {
      try {
        return BigInt(digitsOnly);
      } catch {
        return null;
      }
    }
  }

  const [intPartRaw, fracRaw = ''] = normalized.replace(/^\+/, '').split('.');
  const intPart = intPartRaw || '0';
  const frac = fracRaw.padEnd(18, '0').slice(0, 18);
  const digits = `${intPart}${frac}`.replace(/^0+/, '') || '0';
  try {
    return BigInt(digits);
  } catch {
    return null;
  }
}

function attosToAmountString(attos: bigint, decimals = 18) {
  const negative = attos < 0n;
  const value = negative ? -attos : attos;
  const base = 10n ** BigInt(decimals);
  const i = value / base;
  const f = value % base;
  const frac = f.toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = frac ? `${i.toString()}.${frac}` : `${i.toString()}`;
  return negative ? `-${body}` : body;
}

function formatAppId(appId: string) {
  const trimmed = appId.trim();
  if (trimmed.length <= 14) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
}

function concatBytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string) {
  const normalized = hex.replace(/^0x/i, '');
  if (normalized.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function encodeUleb128(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Invalid ULEB128 value');
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);
  return new Uint8Array(bytes);
}

function encodeVariantIndex(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error('Invalid variant index');
  }
  return new Uint8Array([index]);
}

function encodeU128LE(value: bigint) {
  const bytes = new Uint8Array(16);
  let cursor = value;
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number(cursor & 0xffn);
    cursor >>= 8n;
  }
  return bytes;
}

function encodeString(value: string) {
  const bytes = TEXT_ENCODER.encode(value);
  return concatBytes(encodeUleb128(bytes.length), bytes);
}

function parseAmountToU128(input: string) {
  const raw = input.trim().replace(/_/g, '');
  if (!raw) {
    return 0n;
  }
  if (raw.startsWith('-')) {
    throw new Error('Amount cannot be negative');
  }
  const [integerPartRaw, fractionalRaw = ''] = raw.replace(/^\+/, '').split('.');
  const integerPart = integerPartRaw || '0';
  if (fractionalRaw.length > Number(AMOUNT_DECIMALS)) {
    throw new Error('Too many decimal places for Amount');
  }
  const fractionalPart = fractionalRaw.padEnd(Number(AMOUNT_DECIMALS), '0');
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+/, '') || '0';
  return BigInt(digits);
}

function encodeAmount(input: string) {
  return encodeU128LE(parseAmountToU128(input));
}

function encodeAccountOwner(owner: string) {
  const normalized = owner.trim().toLowerCase().replace(/^0x/, '');
  if (normalized.length === 40) {
    // AccountOwner::Address20
    return concatBytes(encodeVariantIndex(2), hexToBytes(normalized));
  }
  if (normalized.length === 64) {
    // AccountOwner::Address32
    return concatBytes(encodeVariantIndex(1), hexToBytes(normalized));
  }
  throw new Error('Owner must be 20-byte or 32-byte hex');
}

function encodeTradeRequest(payload: { owner: string; symbol: string; side: 'BUY' | 'SELL'; amount: string; minOut: string }) {
  // Side enum (BCS variant index): Buy=0, Sell=1
  const sideIndex = payload.side === 'BUY' ? 0 : 1;
  return concatBytes(
    encodeAccountOwner(payload.owner),
    encodeString(payload.symbol),
    encodeVariantIndex(sideIndex),
    encodeAmount(payload.amount),
    encodeAmount(payload.minOut)
  );
}

function encodeApproveRequest(payload: { owner: string; spender: string; allowance: string }) {
  return concatBytes(encodeAccountOwner(payload.owner), encodeAccountOwner(payload.spender), encodeAmount(payload.allowance));
}

function encodeEvmAccountSignature(signatureHex: string, address: string) {
  const sigBytes = hexToBytes(signatureHex);
  if (sigBytes.length !== 65) {
    throw new Error('EVM signature must be 65 bytes');
  }
  const v = sigBytes[64];
  if (v === 0 || v === 1) {
    sigBytes[64] = v + 27;
  }
  const addressBytes = hexToBytes(address.trim().toLowerCase().replace(/^0x/, ''));
  if (addressBytes.length !== 20) {
    throw new Error('EVM address must be 20 bytes');
  }
  // AccountSignature::EvmSecp256k1
  return concatBytes(encodeVariantIndex(2), sigBytes, addressBytes);
}

async function fetchToken(tokenAppId: string): Promise<TokenRecord | null> {
  const response = await fetch('/api/tokens', { method: 'GET' });
  const json = await response.json();
  const store = (json?.data ?? {}) as Record<string, TokenRecord>;
  return store[tokenAppId] ?? null;
}

async function fetchSeries(tokenAppId: string): Promise<PricePoint[]> {
  const response = await fetch(`/api/prices?tokenAppId=${encodeURIComponent(tokenAppId)}`, { method: 'GET' });
  const json = await response.json();
  return (json?.data ?? []) as PricePoint[];
}

async function appendPoint(tokenAppId: string, point: PricePoint) {
  const response = await fetch('/api/prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenAppId, time: point.time, value: point.value }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(json?.error) && json.error.length)) {
    throw new Error(JSON.stringify(json, null, 2));
  }
}

async function fetchSpotPrice(symbol: string): Promise<{ price: number; debug: any } | null> {
  const endpoint = DEFAULT_GRAPHQL_ENDPOINT.replace(/\/$/, '');
  const url = `${endpoint}/chains/${DEFAULT_CHAIN_ID}/applications/${DEFAULT_MATCHING_ENGINE_APP_ID}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query Spot($symbol: String!) {
        poolConfig(symbol: $symbol) {
          totalCurveSupply
          vX
          vY
        }
        wlinReserve(symbol: $symbol)
        tokenReserve(symbol: $symbol)
      }`,
      variables: { symbol },
    }),
  });
  const json = await response.json();

  const wlinReserveRaw = json?.data?.wlinReserve;
  const tokenReserveRaw = json?.data?.tokenReserve;
  const totalCurveSupplyRaw = json?.data?.poolConfig?.totalCurveSupply;
  const vXRaw = json?.data?.poolConfig?.vX;
  const vYRaw = json?.data?.poolConfig?.vY;

  const x = parseGraphqlAmountToAttos(wlinReserveRaw);
  const y = parseGraphqlAmountToAttos(tokenReserveRaw);
  const totalCurveSupply = parseGraphqlAmountToAttos(totalCurveSupplyRaw);
  const vX = parseGraphqlAmountToAttos(vXRaw) ?? 0n;
  const vY = parseGraphqlAmountToAttos(vYRaw) ?? 0n;
  if (x === null || y === null) {
    return null;
  }

  const ONE = 10n ** 18n;
  const xEff = x + vX;
  const yEff = y + vY;

  // Mirror `matching_engine::current_price` exactly in attos:
  // price_attos = (x+v_x) * ONE / (y+v_y)
  const priceAttosOnChain = yEff > 0n ? (xEff * ONE) / yEff : 0n;
  const priceOnChain = Number(priceAttosOnChain) / Number(ONE);

  // Frontend fallback: if the on-chain token reserve is clearly corrupted (we hit u128 overflow in k),
  // we can derive the *intended* reserve from wlinReserve + fixed genesis config:
  // k0 = (vX) * (totalCurveSupply + vY)
  // yEff' = k0 / (x + vX)
  // price' = (x+vX) / yEff'
  let price = priceOnChain;
  let priceAttos = priceAttosOnChain;
  let derived = null as any;
  if (
    !Number.isFinite(priceOnChain) ||
    priceOnChain <= 0 ||
    priceOnChain >= 1000 ||
    // Heuristic: a pool with totalCurveSupply 800M should never report tokenReserve near 0 at this stage.
    (totalCurveSupply !== null && y < (totalCurveSupply / 1000n))
  ) {
    if (totalCurveSupply !== null && xEff > 0n) {
      const k0 = vX * (totalCurveSupply + vY);
      const yEffDerived = k0 / xEff;
      const priceAttosDerived = yEffDerived > 0n ? (xEff * ONE) / yEffDerived : 0n;
      const priceDerived = Number(priceAttosDerived) / Number(ONE);
      derived = {
        k0: k0.toString(),
        yEffDerived: yEffDerived.toString(),
        priceAttosDerived: priceAttosDerived.toString(),
        priceDerived,
      };
      if (Number.isFinite(priceDerived) && priceDerived > 0 && priceDerived < 1000) {
        price = priceDerived;
        priceAttos = priceAttosDerived;
      }
    }
  }

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  return {
    price,
    debug: {
      symbol,
      raw: {
        wlinReserve: wlinReserveRaw,
        tokenReserve: tokenReserveRaw,
        totalCurveSupply: totalCurveSupplyRaw,
        vX: vXRaw,
        vY: vYRaw,
      },
      attos: {
        x: x.toString(),
        y: y.toString(),
        totalCurveSupply: totalCurveSupply?.toString() ?? null,
        vX: vX.toString(),
        vY: vY.toString(),
        xEff: xEff.toString(),
        yEff: yEff.toString(),
        priceAttosOnChain: priceAttosOnChain.toString(),
        priceOnChain,
        priceAttos: priceAttos.toString(),
        price,
      },
      derived,
    },
  };
}

export default function TokenDetailsPage() {
  const params = useParams() as { tokenAppId?: string };
  const tokenAppId = String(params?.tokenAppId ?? '').trim();

  const [token, setToken] = useState<TokenRecord | null>(null);
  const [loadingToken, setLoadingToken] = useState(true);
  const [series, setSeries] = useState<PricePoint[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [error, setError] = useState<string>('');
  const samplingRef = useRef(false);
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [owner, setOwner] = useState<string>('');

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const chartDataRef = useRef<Candle[]>([]);
  const chartInitializedRef = useRef(false);
  const [useSvgFallback, setUseSvgFallback] = useState(false);

  const chartData = useMemo(() => {
    // Build 1-minute candles from the sampled spot prices.
    const timeframeSec = 60;
    const points = (series ?? [])
      .map((p) => {
        const t = Number(p.time);
        // Our API should store `time` as ms since epoch, but tolerate seconds to avoid
        // accidentally creating 15-second "candles" due to unit mismatch.
        const timeSec = t > 20_000_000_000 ? Math.floor(t / 1000) : Math.floor(t);
        return { timeSec, value: Number(p.value) };
      })
      .filter((p) => Number.isFinite(p.timeSec) && Number.isFinite(p.value))
      // Defensive: keep the chart usable even if an earlier buggy build persisted nonsense.
      // Server-side POST already guards new points; this is only for old data.
      .filter((p) => p.value > 0 && p.value < 1000)
      .sort((a, b) => a.timeSec - b.timeSec);

    const byBucket = new Map<number, Candle>();
    for (const p of points) {
      const bucket = Math.floor(p.timeSec / timeframeSec) * timeframeSec;
      const existing = byBucket.get(bucket);
      if (!existing) {
        byBucket.set(bucket, {
          time: bucket,
          open: p.value,
          high: p.value,
          low: p.value,
          close: p.value,
        });
        continue;
      }
      existing.high = Math.max(existing.high, p.value);
      existing.low = Math.min(existing.low, p.value);
      existing.close = p.value;
    }

    const candles = Array.from(byBucket.values()).sort((a, b) => a.time - b.time);

    // If the series is perfectly flat, Lightweight Charts can end up with an overly-tight scale.
    // Add an epsilon to highs/lows so at least a wick is visible.
    for (const c of candles) {
      if (c.high === c.low) {
        // Must be >= minMove (1e-8) or the wick can disappear visually.
        const eps = Math.max(1e-8, c.close === 0 ? 1e-8 : Math.abs(c.close) * 1e-2);
        c.high = c.high + eps;
        c.low = c.low - eps;
      }
    }

    return candles;
  }, [series]);

  const keptPointCount = useMemo(() => {
    return (series ?? []).filter((p) => Number.isFinite(Number(p?.value)) && Number(p.value) > 0 && Number(p.value) < 1000).length;
  }, [series]);

  const lineData = useMemo((): LinePoint[] => {
    if (!chartData.length) return [];
    // A line series needs >=2 points to draw. If we only have one candle (early demo usage),
    // create a tiny horizontal segment so the chart isn't "empty".
    if (chartData.length === 1) {
      const t = chartData[0].time;
      const v = chartData[0].close;
      return [
        { time: t - 60, value: v },
        { time: t, value: v },
      ];
    }
    return chartData.map((c) => ({ time: c.time, value: c.close }));
  }, [chartData]);

  const latestPrice = useMemo(() => {
    if (!chartData.length) return null;
    return chartData[chartData.length - 1].close;
  }, [chartData]);

  const latestDelta = useMemo(() => {
    if (chartData.length < 2) return null;
    return chartData[chartData.length - 1].close - chartData[chartData.length - 2].close;
  }, [chartData]);

  // Keep the ref hot during render so the async chart init always sees the latest candles.
  chartDataRef.current = chartData;

  // If Lightweight Charts is not reliably visible in the runtime environment, fall back to SVG
  // once we have enough data to draw a meaningful chart.
  useEffect(() => {
    if (chartData.length > 1) {
      setUseSvgFallback(true);
    }
  }, [chartData.length]);

  useEffect(() => {
    function syncWallet() {
      try {
        setWalletAddress(window.localStorage.getItem(LS_WALLET) ?? '');
        setOwner(window.localStorage.getItem(LS_OWNER) ?? '');
      } catch {
        // ignore
      }
    }
    syncWallet();
    window.addEventListener('storage', syncWallet);
    window.addEventListener('linad_owner_changed', syncWallet as EventListener);
    return () => {
      window.removeEventListener('storage', syncWallet);
      window.removeEventListener('linad_owner_changed', syncWallet as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!tokenAppId) {
      setLoadingToken(false);
      setError('Missing tokenAppId');
      return;
    }

    let cancelled = false;
    setLoadingToken(true);
    setError('');
    void (async () => {
      try {
        const record = await fetchToken(tokenAppId);
        if (cancelled) return;
        setToken(record);
        if (!record) {
          setError('Token not found');
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ? String(e.message) : 'Failed to load token');
      } finally {
        if (!cancelled) setLoadingToken(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tokenAppId]);

  useEffect(() => {
    if (!tokenAppId) return;
    let cancelled = false;
    setLoadingSeries(true);
    void (async () => {
      try {
        const data = await fetchSeries(tokenAppId);
        if (cancelled) return;
        setSeries(data);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ? String(e.message) : 'Failed to load price series');
      } finally {
        if (!cancelled) setLoadingSeries(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenAppId]);

  useEffect(() => {
    // The chart container isn't mounted while we're in the "Loading token..." branch,
    // so we must wait until token is loaded before initializing the chart.
    if (chartInitializedRef.current) return;
    if (loadingToken) return;
    if (!chartContainerRef.current) return;

    let cancelled = false;
    let handleResize: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const mod = await import('lightweight-charts');
      if (cancelled || !chartContainerRef.current) return;

      const createChart = (mod as any).createChart as any;
      const ColorType = (mod as any).ColorType as any;

      const chart = createChart(chartContainerRef.current, {
        // Width can be 0 during first layout; we resize immediately after mount via ResizeObserver/rAF.
        width: Math.max(1, chartContainerRef.current.clientWidth),
        height: 320,
        layout: {
          background: { type: ColorType.Solid, color: '#020617' },
          textColor: '#cbd5e1',
        },
        grid: {
          vertLines: { color: 'rgba(148, 163, 184, 0.28)' },
          horzLines: { color: 'rgba(148, 163, 184, 0.28)' },
        },
        rightPriceScale: {
          borderColor: 'rgba(148, 163, 184, 0.18)',
          scaleMargins: { top: 0.2, bottom: 0.2 },
        },
        timeScale: {
          borderColor: 'rgba(148, 163, 184, 0.18)',
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: { mode: 1 },
      });

      const candles = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderUpColor: '#86efac',
        borderDownColor: '#fca5a5',
        wickUpColor: '#86efac',
        wickDownColor: '#fca5a5',
        priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
        lastValueVisible: true,
        priceLineVisible: true,
      });

      const line = chart.addLineSeries({
        color: '#fbbf24',
        lineWidth: 3,
        priceLineVisible: true,
        lastValueVisible: true,
      });

      chartRef.current = chart;
      // Keep candle series in `seriesRef` for updates; line series is updated alongside.
      seriesRef.current = { candles, line };
      chartInitializedRef.current = true;
      const initialCandles = chartDataRef.current;
      const initialLine =
        initialCandles.length === 1
          ? [
              { time: initialCandles[0].time - 60, value: initialCandles[0].close },
              { time: initialCandles[0].time, value: initialCandles[0].close },
            ]
          : initialCandles.map((c) => ({ time: c.time, value: c.close }));
      candles.setData(initialCandles);
      line.setData(initialLine);
      if (chartDataRef.current.length) {
        const last = chartDataRef.current[chartDataRef.current.length - 1];
        candles.setMarkers([
          { time: last.time, position: 'aboveBar', color: '#22c55e', shape: 'circle', text: '' },
        ]);
      }
      // `fitContent()` can effectively create a zero-width visible range when we only have 1 candle.
      // Force a window for the single-candle case; otherwise fit to all data.
      if (initialCandles.length <= 1 && initialLine.length >= 2) {
        chart.timeScale().setVisibleRange({
          from: initialLine[0].time,
          to: initialLine[initialLine.length - 1].time + 60,
        });
      } else {
        chart.timeScale().fitContent();
      }

      // Resize continuously as the container lays out / changes.
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (!chartContainerRef.current) return;
          chart.applyOptions({ width: Math.max(1, chartContainerRef.current.clientWidth) });
        });
        resizeObserver.observe(chartContainerRef.current);
      }

      // Also do a one-shot resize on next frame (helps when first layout returns width=0).
      requestAnimationFrame(() => {
        try {
          if (!chartContainerRef.current) return;
          chart.applyOptions({ width: Math.max(1, chartContainerRef.current.clientWidth) });
          // Don't override the single-candle visible range we set above.
          if (chartDataRef.current.length > 1) {
            chart.timeScale().fitContent();
          }
        } catch {
          // ignore
        }
      });

      // If chart init wins the race vs data loading, schedule one more setData on the next tick.
      setTimeout(() => {
        try {
          candles.setData(chartDataRef.current);
          const nextCandles = chartDataRef.current;
          const nextLine =
            nextCandles.length === 1
              ? [
                  { time: nextCandles[0].time - 60, value: nextCandles[0].close },
                  { time: nextCandles[0].time, value: nextCandles[0].close },
                ]
              : nextCandles.map((c) => ({ time: c.time, value: c.close }));
          line.setData(nextLine);
          if (chartDataRef.current.length) {
            const last = chartDataRef.current[chartDataRef.current.length - 1];
            candles.setMarkers([
              { time: last.time, position: 'aboveBar', color: '#22c55e', shape: 'circle', text: '' },
            ]);
          }
          if (nextCandles.length <= 1 && nextLine.length >= 2) {
            chart.timeScale().setVisibleRange({
              from: nextLine[0].time,
              to: nextLine[nextLine.length - 1].time + 60,
            });
          } else {
            chart.timeScale().fitContent();
          }
        } catch {
          // ignore
        }
      }, 0);

      handleResize = () => {
        if (!chartContainerRef.current) return;
        chart.applyOptions({ width: Math.max(1, chartContainerRef.current.clientWidth) });
      };
      window.addEventListener('resize', handleResize);
    })();

    return () => {
      cancelled = true;
      if (handleResize) {
        window.removeEventListener('resize', handleResize);
      }
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch {
          // ignore
        }
      }
      if (chartRef.current) {
        chartRef.current.remove();
      }
      chartRef.current = null;
      seriesRef.current = null;
      chartInitializedRef.current = false;
    };
  }, [loadingToken]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const holder = seriesRef.current as { candles: any; line: any } | any;
    const candles = holder?.candles ?? seriesRef.current;
    const line = holder?.line ?? null;

    candles.setData(chartData);
    if (line) {
      line.setData(lineData);
    }
    if (chartData.length) {
      const last = chartData[chartData.length - 1];
      candles.setMarkers([
        { time: last.time, position: 'aboveBar', color: '#22c55e', shape: 'circle', text: '' },
      ]);
    }
    if (chartRef.current) {
      // Same issue as during init: for a single candle/flat data, fitContent can yield a range that's too tight.
      if (chartData.length <= 1 && lineData.length >= 2) {
        chartRef.current.timeScale().setVisibleRange({
          from: lineData[0].time,
          to: lineData[lineData.length - 1].time + 60,
        });
      } else {
        chartRef.current.timeScale().fitContent();
      }
    }
  }, [chartData, lineData]);

  async function refreshSeries() {
    if (!tokenAppId) return;
    setLoadingSeries(true);
    try {
      const data = await fetchSeries(tokenAppId);
      setSeries(data);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to refresh series');
    } finally {
      setLoadingSeries(false);
    }
  }

  async function resetSeries() {
    if (!tokenAppId) return;
    setLoadingSeries(true);
    setError('');
    try {
      await fetch(`/api/prices?tokenAppId=${encodeURIComponent(tokenAppId)}`, { method: 'DELETE' });
      setSeries([]);
      await sampleNow(); // seed with a fresh point so the chart isn't blank
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to reset series');
    } finally {
      setLoadingSeries(false);
    }
  }

  async function sampleNow() {
    if (!tokenAppId || !token?.symbol) return;
    if (samplingRef.current) return;
    samplingRef.current = true;
    setSampling(true);
    setError('');
    try {
      const result = await fetchSpotPrice(token.symbol);
      if (result === null) {
        setError('Could not compute spot price (missing reserves?)');
        return;
      }
      const price = result.price;
      // Keep the API guard in sync with a local check so we can show better diagnostics.
      if (price <= 0 || price >= 1000) {
        setError(JSON.stringify({ error: ['Computed price out of expected range'], price, debug: result.debug }, null, 2));
        return;
      }
      const point = { time: Date.now(), value: price };
      await appendPoint(tokenAppId, point);
      await refreshSeries();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to sample price');
    } finally {
      setSampling(false);
      samplingRef.current = false;
    }
  }

  // Seed a first point quickly so the chart isn't empty on first visit.
  useEffect(() => {
    if (!tokenAppId || !token?.symbol) return;
    if (series.length) return;
    void sampleNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAppId, token?.symbol]);

  async function signTradeWithMetaMask(params: { symbol: string; side: 'BUY' | 'SELL'; amount: string; minOut: string }) {
    const connected = walletAddress.trim();
    if (!connected) {
      throw new Error('Connect MetaMask first.');
    }
    const currentOwner = owner.trim();
    if (!currentOwner) {
      throw new Error('Missing owner. Connect wallet.');
    }
    if (currentOwner.toLowerCase() !== connected.toLowerCase()) {
      throw new Error('Owner must match connected MetaMask address.');
    }

    const payloadBytes = encodeTradeRequest({
      owner: connected,
      symbol: params.symbol,
      side: params.side,
      amount: params.amount,
      minOut: params.minOut,
    });

    const domain = TEXT_ENCODER.encode(`${TRADE_TYPE}::`);
    const hash = keccak_256(concatBytes(domain, payloadBytes));
    const messageHex = `0x${bytesToHex(hash)}`;

    const ethereum = (window as Window & { ethereum?: any }).ethereum;
    if (!ethereum) {
      throw new Error('MetaMask not detected.');
    }

    const rawSignature: string = await ethereum.request({
      method: 'personal_sign',
      params: [messageHex, connected],
    });
    return bytesToHex(encodeEvmAccountSignature(rawSignature, connected));
  }

  async function signApproveWithMetaMask(params: { spender: string; allowance: string }) {
    const connected = walletAddress.trim();
    if (!connected) {
      throw new Error('Connect MetaMask first.');
    }
    const currentOwner = owner.trim();
    if (!currentOwner) {
      throw new Error('Missing owner. Connect wallet.');
    }
    if (currentOwner.toLowerCase() !== connected.toLowerCase()) {
      throw new Error('Owner must match connected MetaMask address.');
    }

    const payloadBytes = encodeApproveRequest({
      owner: connected,
      spender: params.spender,
      allowance: params.allowance,
    });

    const domain = TEXT_ENCODER.encode(`${APPROVE_TYPE}::`);
    const hash = keccak_256(concatBytes(domain, payloadBytes));
    const messageHex = `0x${bytesToHex(hash)}`;

    const ethereum = (window as Window & { ethereum?: any }).ethereum;
    if (!ethereum) {
      throw new Error('MetaMask not detected.');
    }

    const rawSignature: string = await ethereum.request({
      method: 'personal_sign',
      params: [messageHex, connected],
    });
    return bytesToHex(encodeEvmAccountSignature(rawSignature, connected));
  }

  async function approveIfNeeded(params: { appId: string; allowance: string }) {
    const spender = `0x${DEFAULT_MATCHING_ENGINE_APP_ID}`;
    const signatureHex = await signApproveWithMetaMask({ spender, allowance: params.allowance });

    const endpoint = DEFAULT_GRAPHQL_ENDPOINT.replace(/\/$/, '');
    const url = `${endpoint}/chains/${DEFAULT_CHAIN_ID}/applications/${params.appId}`;
    const mutationBody = {
      query: `mutation Approve($owner: String!, $spender: String!, $allowance: String!, $sig: String!) {
        approve(request: { payload: { owner: $owner, spender: $spender, allowance: $allowance }, signatureHex: $sig })
      }`,
      variables: {
        owner: walletAddress,
        spender,
        allowance: params.allowance,
        sig: signatureHex,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mutationBody),
    });
    const json = await response.json();
    if (!response.ok || json?.errors?.length || (Array.isArray(json?.error) && json.error.length)) {
      throw new Error(JSON.stringify(json, null, 2));
    }
    return json;
  }

  async function submitTrade(params: { side: 'BUY' | 'SELL'; amount: string; minOut: string }) {
    if (!token?.symbol) {
      throw new Error('Missing token symbol.');
    }

    // Matching engine pulls funds via fungible_token::transfer_from, so user must approve first.
    // BUY uses wLin allowance; SELL uses token allowance.
    const allowance = '1000';
    if (params.side === 'BUY') {
      await approveIfNeeded({ appId: DEFAULT_WLIN_APP_ID, allowance });
    } else {
      await approveIfNeeded({ appId: tokenAppId, allowance });
    }

    const signatureHex = await signTradeWithMetaMask({
      symbol: token.symbol,
      side: params.side,
      amount: params.amount,
      minOut: params.minOut,
    });

    const endpoint = DEFAULT_GRAPHQL_ENDPOINT.replace(/\/$/, '');
    const url = `${endpoint}/chains/${DEFAULT_CHAIN_ID}/applications/${DEFAULT_MATCHING_ENGINE_APP_ID}`;
    const mutation = params.side === 'BUY' ? 'buy' : 'sell';
    const mutationBody = {
      query: `mutation Trade($owner: String!, $symbol: String!, $side: Side!, $amount: String!, $minOut: String!, $sig: String!) {
        ${mutation}(trade: { payload: { owner: $owner, symbol: $symbol, side: $side, amount: $amount, minOut: $minOut }, signatureHex: $sig })
      }`,
      variables: {
        owner: walletAddress,
        symbol: token.symbol,
        side: params.side,
        amount: params.amount,
        minOut: params.minOut,
        sig: signatureHex,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mutationBody),
    });
    const json = await response.json();
    if (!response.ok || json?.errors?.length || (Array.isArray(json?.error) && json.error.length)) {
      throw new Error(JSON.stringify(json, null, 2));
    }
    return json;
  }

  // Poll while the token page is open so you get a time series without wiring buy/sell UI.
  useEffect(() => {
    if (!tokenAppId || !token?.symbol) return;
    const id = window.setInterval(() => {
      void sampleNow();
    }, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenAppId, token?.symbol]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {loadingToken ? (
        <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-6 text-sm text-slate-300">
          Loading token...
        </div>
      ) : token ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="h-14 w-14 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
                    {token.imageDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={token.imageDataUrl} alt={`${token.name} image`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Img
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold leading-tight text-slate-100">{token.name}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                        {token.symbol}
                      </span>
                      <span className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                        {formatAppId(token.tokenAppId)}
                      </span>
                    </div>
                    <div className="mt-3 break-all font-mono text-xs text-slate-300">{token.tokenAppId}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <a
                    href="/explore"
                    className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-brand/70 hover:text-brand"
                  >
                    Back
                  </a>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Price</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-100">
                    {latestPrice !== null ? latestPrice.toFixed(12) : '-'}
                    <span className="ml-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">wLin</span>
                  </div>
                  {latestDelta !== null ? (
                    <div className="mt-2 text-[11px] text-slate-400">
                      Δ {latestDelta >= 0 ? '+' : ''}
                      {latestDelta.toExponential(2)}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void refreshSeries()}
                    className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-brand/70 hover:text-brand"
                    disabled={loadingSeries}
                  >
                    {loadingSeries ? 'Loading...' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetSeries()}
                    className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-red-500/70 hover:text-red-200"
                    disabled={loadingSeries || sampling}
                    title="Clear saved points for this token"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseSvgFallback((v) => !v)}
                    className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500/70 hover:text-slate-100"
                    disabled={!chartData.length}
                    title="Toggle SVG fallback chart"
                  >
                    {useSvgFallback ? 'TV' : 'SVG'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void sampleNow()}
                    className="rounded-xl bg-brand px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-brand-dark"
                    disabled={sampling}
                  >
                    {sampling ? 'Sampling...' : 'Sample Now'}
                  </button>
                </div>
              </div>

              {error ? (
                <div className="mt-6 rounded-2xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              <div className="mt-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-3">
                <div className="relative h-[420px] w-full">
                  <div ref={chartContainerRef} className="absolute inset-0" style={useSvgFallback ? { opacity: 0 } : undefined} />
                  {useSvgFallback ? <SvgCandleChart candles={chartData} /> : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <div>Auto-samples spot price every 15s while this page is open, and aggregates into 1-minute candles.</div>
                <div className="font-mono">
                  points={series.length} kept={keptPointCount} candles={chartData.length}
                </div>
              </div>
            </div>
          </div>

          <aside className="lg:col-span-1">
            <TradePanel
              symbol={token.symbol}
              walletAddress={walletAddress}
              onTrade={async (side, amount, minOut) => {
                const json = await submitTrade({ side, amount, minOut });
                // After a trade, sample immediately and refresh series so the chart moves.
                try {
                  await sampleNow();
                } catch {
                  // ignore
                }
                return json;
              }}
            />
          </aside>
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-6 text-sm text-slate-300">
          Token not found.
        </div>
      )}
    </main>
  );
}

function TradePanel(props: {
  symbol: string;
  walletAddress: string;
  onTrade: (side: 'BUY' | 'SELL', amount: string, minOut: string) => Promise<any>;
}) {
  // Slippage protection (matches `scripts/cli.sh quote` using ~1% buffer).
  const SLIPPAGE_BPS = 100n; // 1%
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [amount, setAmount] = useState('10');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [quote, setQuote] = useState<{ expectedOut: string; minOut: string } | null>(null);

  async function fetchQuote(params: { side: 'BUY' | 'SELL'; amount: string }) {
    const endpoint = DEFAULT_GRAPHQL_ENDPOINT.replace(/\/$/, '');
    const url = `${endpoint}/chains/${DEFAULT_CHAIN_ID}/applications/${DEFAULT_MATCHING_ENGINE_APP_ID}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query Quote($symbol: String!) {
          poolConfig(symbol: $symbol) { feeBps vX vY }
          wlinReserve(symbol: $symbol)
          tokenReserve(symbol: $symbol)
        }`,
        variables: { symbol: props.symbol },
      }),
    });
    const json = await response.json();
    if (!response.ok || json?.errors?.length) {
      throw new Error(JSON.stringify(json, null, 2));
    }

    const feeBps = BigInt(Number(json?.data?.poolConfig?.feeBps ?? 0));
    const vX = parseGraphqlAmountToAttos(json?.data?.poolConfig?.vX) ?? 0n;
    const vY = parseGraphqlAmountToAttos(json?.data?.poolConfig?.vY) ?? 0n;
    const x = parseGraphqlAmountToAttos(json?.data?.wlinReserve) ?? 0n;
    const y = parseGraphqlAmountToAttos(json?.data?.tokenReserve) ?? 0n;

    const xEff = x + vX;
    const yEff = y + vY;
    if (xEff <= 0n || yEff <= 0n) {
      throw new Error('Pool reserves are not initialized for quoting.');
    }

    const amountInAttos = parseAmountToU128(params.amount); // user input tokens -> attos
    if (amountInAttos === null) {
      throw new Error('Invalid amount.');
    }

    // IMPORTANT: The on-chain contract uses u128 saturating arithmetic. If the pool math has
    // overflowed (the k-invariant saturates), a "correct" BigInt quote will NOT match what the
    // contract enforces, and minOut will fail. Mirror the contract exactly here.
    const MAX_U128 = (1n << 128n) - 1n;
    const satAdd = (a: bigint, b: bigint) => {
      const s = a + b;
      return s > MAX_U128 ? MAX_U128 : s;
    };
    const satSub = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
    const satMul = (a: bigint, b: bigint) => {
      if (a === 0n || b === 0n) return 0n;
      if (a > MAX_U128 / b) return MAX_U128;
      return a * b;
    };
    const satDiv = (a: bigint, b: bigint) => (b === 0n ? 0n : a / b);

    let expectedOutAttos = 0n;
    if (params.side === 'BUY') {
      // contract.rs (buy):
      // fee = dx * fee_bps / 10_000
      // k = (base+v_x) * (token+v_y)
      // new_token = k / (base+v_x+dx_after_fee) - v_y
      // y_out = token - new_token
      const dx = amountInAttos;
      const fee = satDiv(satMul(dx, feeBps), 10_000n);
      const dxAfterFee = satSub(dx, fee);
      const k = satMul(satAdd(x, vX), satAdd(y, vY));
      const denom = satAdd(satAdd(x, vX), dxAfterFee);
      const newToken = satSub(satDiv(k, denom), vY);
      expectedOutAttos = satSub(y, newToken);
    } else {
      // contract.rs (sell):
      // k = (base+v_x) * (token+v_y)
      // new_base = k / (token+v_y+dy) - v_x
      // x_out = base - new_base
      // fee = x_out * fee_bps / 10_000
      // x_out_after_fee = x_out - fee
      const dy = amountInAttos;
      const k = satMul(satAdd(x, vX), satAdd(y, vY));
      const denom = satAdd(satAdd(y, vY), dy);
      const newBase = satSub(satDiv(k, denom), vX);
      const xOut = satSub(x, newBase);
      const fee = satDiv(satMul(xOut, feeBps), 10_000n);
      expectedOutAttos = satSub(xOut, fee);
    }

    if (expectedOutAttos <= 0n) {
      throw new Error('Quote output is zero; check pool state.');
    }

    const minOutAttos = satDiv(satMul(expectedOutAttos, 10_000n - SLIPPAGE_BPS), 10_000n);
    return {
      expectedOut: attosToAmountString(expectedOutAttos, 18),
      minOut: attosToAmountString(minOutAttos, 18),
    };
  }

  async function submit() {
    setSubmitting(true);
    setError('');
    setResult('');
    try {
      if (!props.walletAddress.trim()) {
        throw new Error('Connect wallet first.');
      }
      const q = await fetchQuote({ side, amount: amount.trim() });
      setQuote({ expectedOut: q.expectedOut, minOut: q.minOut });
      const json = await props.onTrade(side, amount.trim(), q.minOut);
      setResult(JSON.stringify(json, null, 2));
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Trade failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-800/80 bg-slate-950/40 p-6">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Trade</div>
        <span className="rounded-lg border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200">
          {props.symbol}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setSide('BUY')}
          className={[
            'rounded-2xl border px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] transition',
            side === 'BUY'
              ? 'border-emerald-500/60 bg-emerald-950/30 text-emerald-200'
              : 'border-slate-800 bg-slate-950/40 text-slate-200 hover:border-emerald-500/40',
          ].join(' ')}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          className={[
            'rounded-2xl border px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] transition',
            side === 'SELL'
              ? 'border-rose-500/60 bg-rose-950/30 text-rose-200'
              : 'border-slate-800 bg-slate-950/40 text-slate-200 hover:border-rose-500/40',
          ].join(' ')}
        >
          Sell
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <label className="block">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Amount In</div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10"
            className="w-full rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand/70"
          />
        </label>

        {quote ? (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-3 text-[11px] text-slate-300">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Expected out</span>
              <span className="font-mono">{quote.expectedOut}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-400">Min out (1% slippage)</span>
              <span className="font-mono">{quote.minOut}</span>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="w-full rounded-2xl bg-brand px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {submitting ? 'Submitting...' : side === 'BUY' ? 'Buy Now' : 'Sell Now'}
        </button>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">{error}</div>
      ) : null}
      {result ? (
        <pre className="mt-5 overflow-auto rounded-2xl border border-slate-800/80 bg-slate-950/70 p-4 text-xs text-slate-100">
          {result}
        </pre>
      ) : null}
    </div>
  );
}
