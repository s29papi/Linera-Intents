'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

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

const LS_OWNER = 'linad_owner';
const LS_WALLET = 'linad_wallet_address';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8080';
const DEFAULT_CHAIN_ID = '761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced';
const DEFAULT_WLIN_APP_ID = '6a570896ff23d7a1db44398bae8b2ad12101af56cd244a7d694ed94ead048731';

export default function TopBar() {
  const pathname = usePathname() || '/';
  const onFaucetPage = pathname === '/faucet' || pathname.startsWith('/faucet/');
  const onExplorePage = pathname === '/explore' || pathname.startsWith('/explore/');
  const navHref = onFaucetPage ? '/' : '/faucet';
  const navLabel = onFaucetPage ? 'Launchpad' : 'wLin Faucet';

  const [walletAddress, setWalletAddress] = useState<string>('');
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);

  const [owner, setOwner] = useState<string>('');
  const [wlinBalance, setWlinBalance] = useState<string>('');
  const [wlinBalanceLoading, setWlinBalanceLoading] = useState(false);

  useEffect(() => {
    try {
      const savedOwner = window.localStorage.getItem(LS_OWNER) ?? '';
      const savedWallet = window.localStorage.getItem(LS_WALLET) ?? '';
      setOwner(savedOwner);
      setWalletAddress(savedWallet);
    } catch {
      // ignore
    }
  }, []);

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

  async function loadWlinBalance(options?: { signal?: AbortSignal }) {
    const trimmedOwner = owner.trim();
    if (!trimmedOwner) {
      setWlinBalance('');
      return;
    }

    setWlinBalanceLoading(true);
    try {
      const endpoint = DEFAULT_ENDPOINT.replace(/\/$/, '');
      const url = `${endpoint}/chains/${DEFAULT_CHAIN_ID}/applications/${DEFAULT_WLIN_APP_ID}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query Balance($owner: String!) {
            balance(owner: $owner)
          }`,
          variables: { owner: trimmedOwner }
        }),
        signal: options?.signal
      });
      const json = await response.json();
      if (json?.errors?.length || (Array.isArray(json?.error) && json.error.length)) {
        setWlinBalance('');
        return;
      }
      setWlinBalance(String(json?.data?.balance ?? ''));
    } catch (error) {
      if (options?.signal?.aborted) {
        return;
      }
      setWlinBalance('');
    } finally {
      setWlinBalanceLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadWlinBalance({ signal: controller.signal });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  useEffect(() => {
    function onOwnerChanged() {
      try {
        setOwner(window.localStorage.getItem(LS_OWNER) ?? '');
        setWalletAddress(window.localStorage.getItem(LS_WALLET) ?? '');
      } catch {
        // ignore
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== LS_OWNER && event.key !== LS_WALLET) {
        return;
      }
      onOwnerChanged();
    }

    function onRefresh() {
      void loadWlinBalance();
    }

    window.addEventListener('storage', onStorage);
    window.addEventListener('linad_owner_changed', onOwnerChanged as EventListener);
    window.addEventListener('linad_refresh_balance', onRefresh as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('linad_owner_changed', onOwnerChanged as EventListener);
      window.removeEventListener('linad_refresh_balance', onRefresh as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  async function connectWallet() {
    if (typeof window === 'undefined' || !('ethereum' in window)) {
      return;
    }
    const ethereum = (window as Window & { ethereum?: any }).ethereum;
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    const address = Array.isArray(accounts) ? accounts[0] : '';
    if (!address) {
      return;
    }

    setWalletAddress(address);
    setOwner(address);
    try {
      window.localStorage.setItem(LS_WALLET, address);
      window.localStorage.setItem(LS_OWNER, address);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event('linad_owner_changed'));
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
    try {
      window.localStorage.removeItem(LS_WALLET);
      window.localStorage.removeItem(LS_OWNER);
    } catch {
      // ignore
    }
    setOwner('');
    window.dispatchEvent(new Event('linad_owner_changed'));
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800/70 bg-slate-950/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <a
            href="/explore"
            className={[
              'rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition',
              onExplorePage
                ? 'border-brand/70 bg-slate-950/70 text-brand'
                : 'border-slate-700/80 bg-slate-950/70 text-slate-200 hover:border-brand/70 hover:text-brand',
            ].join(' ')}
          >
            Explore
          </a>

          <a
            href={navHref}
            className="rounded-xl border border-slate-700/80 bg-slate-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-brand/70 hover:text-brand"
          >
            {navLabel}
          </a>
        </div>

        <div className="flex items-center justify-end gap-3">
          <div className="inline-flex items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">wLin</span>
            <span className="text-xs font-semibold text-slate-100">
              {wlinBalanceLoading ? '...' : wlinBalance || '-'}
            </span>
            <button
              type="button"
              onClick={() => void loadWlinBalance()}
              className="rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-brand/70 hover:text-brand"
              disabled={wlinBalanceLoading}
            >
              Refresh
            </button>
          </div>

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
      </div>
    </header>
  );
}
