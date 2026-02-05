'use client';

import { useEffect, useRef, useState } from 'react';

function formatWalletLabel(address: string) {
  const trimmed = address.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

const defaultForm = {
  amount: '1000',
  owner: '',
  chainId: '761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced',
  faucetAppId: '5531238ece651244a3dfab368d5f9ae7c0fe5641c2fc70384e75ef3a427fd1f1',
  endpoint: 'http://127.0.0.1:8080'
};

export default function FaucetPage() {
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>('');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!walletMenuRef.current) {
        return;
      }
      if (!walletMenuRef.current.contains(event.target as Node)) {
        setWalletMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function updateField<K extends keyof typeof defaultForm>(key: K, value: (typeof defaultForm)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function connectWallet() {
    try {
      if (typeof window === 'undefined' || !('ethereum' in window)) {
        setResult('MetaMask not detected.');
        return;
      }
      const ethereum = (window as Window & { ethereum?: any }).ethereum;
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const address = Array.isArray(accounts) ? accounts[0] : '';
      if (!address) {
        setResult('No account available.');
        return;
      }
      setWalletAddress(address);
      updateField('owner', address);
      setResult('');
    } catch (error) {
      setResult(String(error));
    }
  }

  function handleWalletButtonClick() {
    if (!walletAddress) {
      void connectWallet();
      return;
    }
    setWalletMenuOpen((open) => !open);
  }

  function disconnectWallet() {
    setWalletAddress('');
    setWalletMenuOpen(false);
    updateField('owner', defaultForm.owner);
  }

  async function submitMint(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult('');

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
      setResult(JSON.stringify(json, null, 2));
    } catch (error) {
      setResult(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen px-6 py-16">
      <div className="absolute right-6 top-6 z-10 flex items-center gap-3">
        <a
          href="/"
          className="rounded-xl border border-slate-700/80 bg-slate-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-brand/70 hover:text-brand"
        >
          Launchpad
        </a>
        <div ref={walletMenuRef} className="relative">
          <button
            type="button"
            onClick={handleWalletButtonClick}
            className="rounded-xl bg-brand px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-brand-dark"
          >
            {walletAddress ? formatWalletLabel(walletAddress) : 'Connect Wallet'}
          </button>
          {walletAddress && walletMenuOpen ? (
            <div className="absolute right-0 mt-2 w-40 rounded-xl border border-slate-800/80 bg-slate-950/95 p-2 shadow-xl">
              <button
                type="button"
                onClick={disconnectWallet}
                className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-slate-900/60"
              >
                Disconnect
              </button>
            </div>
          ) : null}
        </div>
      </div>

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
              onChange={(event) => updateField('owner', event.target.value)}
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
          <div className="mt-8 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Result</p>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-200">{result}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}
