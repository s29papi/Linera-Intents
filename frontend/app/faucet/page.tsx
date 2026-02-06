'use client';

import { useEffect, useRef, useState } from 'react';

const defaultForm = {
  amount: '1000',
  owner: '',
  chainId: '761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced',
  faucetAppId: '5531238ece651244a3dfab368d5f9ae7c0fe5641c2fc70384e75ef3a427fd1f1',
  wlinAppId: '6a570896ff23d7a1db44398bae8b2ad12101af56cd244a7d694ed94ead048731',
  endpoint: 'http://127.0.0.1:8080'
};

export default function FaucetPage() {
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>('');
  const [resultOk, setResultOk] = useState<boolean | null>(null);
  const lastAutoOwnerRef = useRef<string>('');

  useEffect(() => {
    // Seed owner from persisted value (TopBar writes to localStorage).
    try {
      const savedOwner = window.localStorage.getItem('linad_owner') ?? '';
      if (savedOwner) {
        lastAutoOwnerRef.current = savedOwner;
        setForm((prev) => ({ ...prev, owner: savedOwner }));
      }
    } catch {
      // ignore
    }

    function onOwnerChanged() {
      try {
        const savedOwner = window.localStorage.getItem('linad_owner') ?? '';
        if (!savedOwner) {
          return;
        }
        setForm((prev) => {
          if (!prev.owner || prev.owner === lastAutoOwnerRef.current) {
            lastAutoOwnerRef.current = savedOwner;
            return { ...prev, owner: savedOwner };
          }
          return prev;
        });
      } catch {
        // ignore
      }
    }

    window.addEventListener('linad_owner_changed', onOwnerChanged as EventListener);
    return () => window.removeEventListener('linad_owner_changed', onOwnerChanged as EventListener);
  }, []);

  function updateField<K extends keyof typeof defaultForm>(key: K, value: (typeof defaultForm)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitMint(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult('');
    setResultOk(null);

    try {
      const amount = form.amount.trim();
      const owner = form.owner.trim();
      if (!amount) {
        throw new Error('Amount is required.');
      }
      if (!owner) {
        throw new Error('Owner is required.');
      }
      const mutationBody = {
        query: `mutation FaucetMint($amount: String!, $owner: String!) {
          faucetMint(amount: $amount, owner: $owner)
        }`,
        variables: {
          amount,
          owner
        }
      };
      const endpoint = form.endpoint.replace(/\/$/, '');
      const url = `${endpoint}/chains/${form.chainId}/applications/${form.faucetAppId}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mutationBody)
      });
      const json = await response.json();
      const hasGraphQlErrors = Array.isArray(json?.errors) && json.errors.length > 0;
      const hasLineraErrorField = Array.isArray(json?.error) && json.error.length > 0;
      setResultOk(Boolean(response.ok) && !hasGraphQlErrors && !hasLineraErrorField);
      setResult(JSON.stringify(json, null, 2));
      window.dispatchEvent(new Event('linad_refresh_balance'));
    } catch (error) {
      setResult(String(error));
      setResultOk(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen px-6 py-16">
      <section className="mx-auto mt-10 w-full max-w-3xl rounded-3xl border border-slate-800/70 bg-slate-950/90 p-10 shadow-glow">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Linad.fun</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[0.18em] text-brand">wLIN FAUCET</h1>
          <p className="mt-3 text-sm text-slate-400">
            Mint test wLin to your wallet. No signature required.
          </p>
        </div>

        <form onSubmit={submitMint} className="mt-10 grid gap-6">
          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Amount</label>
            <input
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              value={form.amount}
              onChange={(event) => updateField('amount', event.target.value)}
              placeholder="1000"
              inputMode="decimal"
              required
            />
          </div>

          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Owner</label>
            <input
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              value={form.owner}
              onChange={(event) => {
                const value = event.target.value;
                updateField('owner', value);
                try {
                  window.localStorage.setItem('linad_owner', value);
                } catch {
                  // ignore
                }
                window.dispatchEvent(new Event('linad_owner_changed'));
              }}
              placeholder="Paste wallet address (0x...)"
              required
            />
            <p className="text-[11px] text-slate-500">Enter a wallet address or connect MetaMask to auto-fill.</p>
          </div>

          <button
            type="submit"
            className="w-full rounded-2xl bg-brand px-6 py-4 text-sm font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-brand-dark"
            disabled={submitting}
          >
            {submitting ? 'Minting...' : 'Mint wLin'}
          </button>
        </form>

        {result ? (
          <div
            className={[
              'mt-8 rounded-2xl border bg-slate-950/60 p-6',
              resultOk === true ? 'border-emerald-500/60' : '',
              resultOk === false ? 'border-red-500/60' : '',
              resultOk === null ? 'border-slate-800/80' : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {resultOk === true ? (
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"
                    aria-label="Success"
                    title="Success"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : null}
                {resultOk === false ? (
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/15 text-red-300"
                    aria-label="Failed"
                    title="Failed"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M18 6L6 18M6 6l12 12"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : null}
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Result</p>
              </div>
              {resultOk === true ? (
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Success</span>
              ) : null}
              {resultOk === false ? (
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-300">Failed</span>
              ) : null}
            </div>
            <pre className="mt-4 whitespace-pre-wrap text-xs text-slate-200">{result}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}
