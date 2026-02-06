'use client';

import { useEffect, useMemo, useState } from 'react';

type TokenRecord = {
  tokenAppId: string;
  name: string;
  symbol: string;
  imageDataUrl?: string;
  createdAt?: number;
};

function formatAppId(appId: string) {
  const trimmed = appId.trim();
  if (trimmed.length <= 14) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
}

export default function ExplorePage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [tokens, setTokens] = useState<Record<string, TokenRecord>>({});

  async function loadTokens() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/tokens', { method: 'GET' });
      const json = await response.json();
      setTokens((json?.data ?? {}) as Record<string, TokenRecord>);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTokens();
  }, []);

  const tokenList = useMemo(() => {
    const list = Object.values(tokens || {});
    list.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    return list;
  }, [tokens]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Explore</h1>
        </div>
        <button
          type="button"
          onClick={() => void loadTokens()}
          className="rounded-xl border border-slate-700/80 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-brand/70 hover:text-brand"
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {tokenList.map((token) => (
          <a
            key={token.tokenAppId}
            href={`/explore/${token.tokenAppId}`}
            className="block overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-950/40 shadow-[0_0_0_1px_rgba(15,23,42,0.6)] transition hover:border-brand/60 hover:bg-slate-950/55"
          >
            <div className="relative h-40 w-full bg-slate-900/60">
              {token.imageDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={token.imageDataUrl}
                  alt={`${token.name} image`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  No image
                </div>
              )}
            </div>

            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold leading-tight text-slate-100">{token.name}</div>
                  <div className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {token.symbol}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs font-semibold text-slate-200">
                  {formatAppId(token.tokenAppId)}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Token App Id</div>
                <div className="mt-1 break-all font-mono text-xs text-slate-100">{token.tokenAppId}</div>
              </div>
            </div>
          </a>
        ))}

        {!loading && tokenList.length === 0 ? (
          <div className="col-span-full rounded-3xl border border-slate-800/80 bg-slate-950/40 p-8 text-sm text-slate-300">
            No tokens saved yet. Create one on the Launchpad, then come back here.
          </div>
        ) : null}
      </div>
    </main>
  );
}
