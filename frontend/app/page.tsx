'use client';

import { useEffect, useRef, useState } from 'react';
import { keccak_256 } from '@noble/hashes/sha3';

const TEXT_ENCODER = new TextEncoder();
const AMOUNT_DECIMALS = 18n;
const CREATE_TOKEN_TYPE = 'CreateTokenRequest';

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

function encodeU32LE(value: number) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, true);
  return new Uint8Array(buffer);
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
  return concatBytes(encodeU32LE(bytes.length), bytes);
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
    return concatBytes(encodeU32LE(2), hexToBytes(normalized));
  }
  if (normalized.length === 64) {
    return concatBytes(encodeU32LE(1), hexToBytes(normalized));
  }
  throw new Error('Owner must be 20-byte or 32-byte hex');
}

function encodeTokenMetadata(name: string, symbol: string, decimals: number) {
  return concatBytes(encodeString(name), encodeString(symbol), new Uint8Array([decimals]));
}

function encodeCreateTokenRequest(payload: {
  owner: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
}) {
  return concatBytes(
    encodeAccountOwner(payload.owner),
    encodeTokenMetadata(payload.name, payload.symbol, payload.decimals),
    encodeAmount(payload.supply)
  );
}

function encodeEvmAccountSignature(signatureHex: string, address: string) {
  const sigBytes = hexToBytes(signatureHex);
  if (sigBytes.length !== 65) {
    throw new Error('EVM signature must be 65 bytes');
  }
  const addressBytes = hexToBytes(address.trim().toLowerCase().replace(/^0x/, ''));
  if (addressBytes.length !== 20) {
    throw new Error('EVM address must be 20 bytes');
  }
  return concatBytes(encodeU32LE(2), sigBytes, addressBytes);
}

const defaultForm = {
  tokenName: '',
  tokenSymbol: '',
  description: '',
  owner: '0x49c2f87001ec3e39ea5a4dbd115e404c4d4a4641e83c9a60dc3d9e77778f72c1',
  signature: '',
  decimals: 9,
  supply: '800000000',
  chainId: '761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced',
  tokenFactory: 'ff081619d9553ae6919dd0ed2268cd1ad988140275701136fe54805d31027990',
  endpoint: 'http://127.0.0.1:8080'
};

export default function Home() {
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>('');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [walletStatus, setWalletStatus] = useState<string>('');
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

  async function connectWallet() {
    setWalletStatus('');
    try {
      if (typeof window === 'undefined' || !('ethereum' in window)) {
        setWalletStatus('MetaMask not detected.');
        return;
      }
      const ethereum = (window as Window & { ethereum?: any }).ethereum;
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const address = Array.isArray(accounts) ? accounts[0] : '';
      if (!address) {
        setWalletStatus('No account available.');
        return;
      }
      setWalletAddress(address);
      updateField('owner', address);
      setWalletStatus(`Connected: ${address}`);
    } catch (error) {
      setWalletStatus(String(error));
    }
  }

  async function signWithMetaMask() {
    if (!walletAddress) {
      throw new Error('Connect MetaMask first.');
    }
    const owner = walletAddress;
    if (form.owner.trim().toLowerCase() !== owner.toLowerCase()) {
      updateField('owner', owner);
    }
    const payloadBytes = encodeCreateTokenRequest({
      owner,
      name: form.tokenName.trim(),
      symbol: form.tokenSymbol.trim(),
      decimals: Number(form.decimals || 0),
      supply: String(form.supply).trim()
    });
    const domain = TEXT_ENCODER.encode(`${CREATE_TOKEN_TYPE}::`);
    const hash = keccak_256(concatBytes(domain, payloadBytes));
    const messageHex = `0x${bytesToHex(hash)}`;

    const ethereum = (window as Window & { ethereum?: any }).ethereum;
    const rawSignature: string = await ethereum.request({
      method: 'personal_sign',
      params: [messageHex, owner]
    });
    const signatureHex = bytesToHex(encodeEvmAccountSignature(rawSignature, owner));
    updateField('signature', signatureHex);
    return signatureHex;
  }

  async function submitToken(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult('');

    try {
      const signature = form.signature.trim() || (walletAddress ? await signWithMetaMask() : '');
      if (!signature) {
        throw new Error('Signature is required. Connect MetaMask or paste a signature hex.');
      }
      const mutationBody = {
        query: `mutation CreateToken($owner: String!, $name: String!, $symbol: String!, $decimals: Int!, $supply: String!, $sig: String!) {
          createToken(request: { payload: { owner: $owner, metadata: { name: $name, symbol: $symbol, decimals: $decimals }, initialSupply: $supply }, signatureHex: $sig })
        }`,
        variables: {
          owner: form.owner.trim(),
          name: form.tokenName.trim(),
          symbol: form.tokenSymbol.trim(),
          decimals: Number(form.decimals || 0),
          supply: String(form.supply).trim(),
          sig: signature
        }
      };
      const endpoint = form.endpoint.replace(/\/$/, '');
      const url = `${endpoint}/chains/${form.chainId}/applications/${form.tokenFactory}`;
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

  function updateField<K extends keyof typeof defaultForm>(key: K, value: (typeof defaultForm)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
    setWalletStatus('');
    setWalletMenuOpen(false);
    updateField('owner', defaultForm.owner);
    updateField('signature', '');
  }

  return (
    <main className="relative min-h-screen px-6 py-16">
      <div className="absolute right-6 top-6 z-10 flex items-center gap-3">
        <a
          href="/faucet"
          className="rounded-xl border border-slate-700/80 bg-slate-950/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-brand/70 hover:text-brand"
        >
          wLin Faucet
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
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-800/70 bg-slate-950/90 p-10 shadow-glow">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Linad.fun</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[0.18em] text-brand">LAUNCH YOUR TOKEN</h1>
          <p className="mt-3 text-sm text-slate-400">Create a token on Linera's Linad Chain</p>
        </div>

        <form onSubmit={submitToken} className="mt-10 grid gap-6">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700/70 px-4 py-8 text-center text-xs text-slate-400">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-brand">+</span>
              PNG · JPEG · WEBP · GIF
              <span className="text-[11px] text-slate-500">Max size 5MB</span>
              <input type="file" className="hidden" />
            </label>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Token Name</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  value={form.tokenName}
                  onChange={(event) => updateField('tokenName', event.target.value)}
                  placeholder="Enter a token name..."
                  required
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Ticker Symbol</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  value={form.tokenSymbol}
                  onChange={(event) => updateField('tokenSymbol', event.target.value)}
                  placeholder="Enter a token symbol..."
                  required
                />
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Description</label>
            <textarea
              className="min-h-[120px] rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              placeholder="Tell the world a statement about the token..."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Website</label>
              <input className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm" placeholder="https://" />
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Twitter</label>
              <input className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm" placeholder="https://x.com/" />
            </div>
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Telegram</label>
              <input className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm" placeholder="https://t.me/" />
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Tag</label>
              <select className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                <option>Meme</option>
                <option>Utility</option>
                <option>DeFi</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-200">Advanced</p>
                <p className="text-xs text-slate-400">Required fields for createToken mutation.</p>
              </div>
              <span className="text-xs text-brand">cli.sh parity</span>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="grid gap-3 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Wallet</label>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={signWithMetaMask}
                    className="rounded-xl border border-brand/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand transition hover:bg-brand/10"
                  >
                    Sign Payload
                  </button>
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Owner</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  value={form.owner}
                  onChange={(event) => updateField('owner', event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Signature Hex</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  value={form.signature}
                  onChange={(event) => updateField('signature', event.target.value)}
                />
                <p className="text-[11px] text-slate-500">
                  Leave empty to sign with MetaMask (EVM address owner).
                </p>
              </div>
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Decimals</label>
                <input
                  type="number"
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
                  value={form.decimals}
                  onChange={(event) => updateField('decimals', Number(event.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Initial Supply</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
                  value={form.supply}
                  onChange={(event) => updateField('supply', event.target.value)}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Chain ID</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
                  value={form.chainId}
                  onChange={(event) => updateField('chainId', event.target.value)}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Token Factory App ID</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
                  value={form.tokenFactory}
                  onChange={(event) => updateField('tokenFactory', event.target.value)}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">GraphQL Endpoint</label>
                <input
                  className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm"
                  value={form.endpoint}
                  onChange={(event) => updateField('endpoint', event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col items-center gap-3">
            <p className="text-xs text-slate-500">Cost to deploy: 0.01 BNB</p>
            <button
              type="submit"
              className="w-full rounded-2xl bg-brand px-6 py-4 text-sm font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-brand-dark"
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Create Token'}
            </button>
          </div>
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
