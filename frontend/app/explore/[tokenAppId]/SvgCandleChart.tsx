'use client';

type Candle = { time: number; open: number; high: number; low: number; close: number };

export function SvgCandleChart(props: { candles: Candle[] }) {
  const candles = props.candles ?? [];
  const width = 1000;
  const height = 420;
  // Extra room on the right/bottom for axis labels.
  const padL = 18;
  const padR = 78;
  const padT = 18;
  const padB = 36;

  if (!candles.length) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none" />
    );
  }

  const quantile = (sorted: number[], p: number) => {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
    return sorted[idx]!;
  };

  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  // Robust Y-scaling: ignore extreme outliers so one bad point doesn't flatten the whole chart.
  const sortedLows = [...lows].sort((a, b) => a - b);
  const sortedHighs = [...highs].sort((a, b) => a - b);
  const minY = quantile(sortedLows, 0.01);
  const maxY = quantile(sortedHighs, 0.99);
  const span = Math.max(1e-12, maxY - minY);
  const pad = span * 0.12;
  const yMin = minY - pad;
  const yMax = maxY + pad;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xForIndex = (i: number) =>
    padL + (candles.length === 1 ? plotW / 2 : (i * plotW) / (candles.length - 1));
  const yForValue = (v: number) => padT + ((yMax - v) * plotH) / (yMax - yMin);

  const candleStep = candles.length === 1 ? plotW : plotW / (candles.length - 1);
  // Keep candles readable when there are many of them.
  // Aim for "TradingView-ish" chunkiness without turning into a solid block when many candles exist.
  // Leave some spacing between candles: keep body width below the step.
  const bodyW = Math.max(14, Math.min(44, candleStep * 0.75));

  const linePath = candles
    .map((c, i) => {
      const x = xForIndex(i);
      const y = yForValue(c.close);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const fmtPrice = (v: number) => {
    if (!Number.isFinite(v)) return '';
    if (Math.abs(v) >= 1) return v.toFixed(4);
    if (Math.abs(v) >= 0.01) return v.toFixed(6);
    return v.toFixed(8);
  };

  const fmtTime = (tSec: number) => {
    try {
      return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(tSec * 1000));
    } catch {
      return String(tSec);
    }
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <rect x="0" y="0" width={width} height={height} fill="#020617" />

      {Array.from({ length: 6 }).map((_, i) => {
        const y = padT + (i * plotH) / 5;
        return (
          <line
            key={`h-${i}`}
            x1={padL}
            x2={width - padR}
            y1={y}
            y2={y}
            stroke="rgba(148,163,184,0.22)"
            strokeWidth="1"
          />
        );
      })}
      {Array.from({ length: 8 }).map((_, i) => {
        const x = padL + (i * plotW) / 7;
        return (
          <line
            key={`v-${i}`}
            y1={padT}
            y2={height - padB}
            x1={x}
            x2={x}
            stroke="rgba(148,163,184,0.18)"
            strokeWidth="1"
          />
        );
      })}

      {/* Y-axis labels (right) */}
      {Array.from({ length: 5 }).map((_, i) => {
        const frac = i / 4;
        const v = yMax - frac * (yMax - yMin);
        const y = padT + frac * plotH;
        return (
          <text
            key={`yl-${i}`}
            x={width - padR + 10}
            y={y + 4}
            fill="rgba(148,163,184,0.85)"
            fontSize="12"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
          >
            {fmtPrice(v)}
          </text>
        );
      })}

      {/* X-axis labels (bottom) */}
      {(() => {
        const n = candles.length;
        if (n <= 1) return null;
        const tickCount = 4;
        const ticks = Array.from({ length: tickCount }, (_, i) => Math.round((i * (n - 1)) / (tickCount - 1)));
        return ticks.map((idx, i) => {
          const c = candles[idx];
          const x = xForIndex(idx);
          return (
            <text
              key={`xl-${i}`}
              x={x}
              y={height - 10}
              textAnchor={i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'}
              fill="rgba(148,163,184,0.75)"
              fontSize="12"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
            >
              {fmtTime(c.time)}
            </text>
          );
        });
      })()}

      {/* Border for the plot area */}
      <rect
        x={padL}
        y={padT}
        width={plotW}
        height={plotH}
        fill="none"
        stroke="rgba(148,163,184,0.22)"
        strokeWidth="1"
      />

      {candles.map((c, i) => {
        const x = xForIndex(i);
        const yOpen = yForValue(c.open);
        const yClose = yForValue(c.close);
        const yHigh = yForValue(c.high);
        const yLow = yForValue(c.low);

        const up = c.close >= c.open;
        // TradingView-ish defaults (Lightweight Charts docs examples)
        const wickColor = up ? '#26a69a' : '#ef5350';
        const bodyColor = up ? '#26a69a' : '#ef5350';
        const top = Math.min(yOpen, yClose);
        const bottom = Math.max(yOpen, yClose);
        // Ensure even near-flat candles have a visible body.
        const bodyH = Math.max(10, bottom - top);

        return (
          <g key={c.time}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={wickColor} strokeWidth="3.2" opacity="0.95" />
            <rect
              x={x - bodyW / 2}
              y={top}
              width={bodyW}
              height={bodyH}
              fill={bodyColor}
              opacity="0.92"
              rx="2.5"
              stroke="rgba(2,6,23,0.6)"
              strokeWidth="1"
            />
          </g>
        );
      })}

      <path d={linePath} fill="none" stroke="#fbbf24" strokeWidth="2.2" opacity="0.9" />
    </svg>
  );
}
