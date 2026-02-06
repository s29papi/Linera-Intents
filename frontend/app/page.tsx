'use client';

import { useEffect, useState } from 'react';
import { keccak_256 } from '@noble/hashes/sha3';

const TEXT_ENCODER = new TextEncoder();
const AMOUNT_DECIMALS = 18n;
const CREATE_TOKEN_TYPE = 'CreateTokenRequest';
const LS_OWNER = 'linad_owner';
const LS_WALLET = 'linad_wallet_address';

const DEFAULT_CHAIN_ID = '761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced';
const DEFAULT_TOKEN_FACTORY_APP_ID = 'ff081619d9553ae6919dd0ed2268cd1ad988140275701136fe54805d31027990';
const DEFAULT_GRAPHQL_ENDPOINT = 'http://127.0.0.1:8080';
const DEFAULT_DECIMALS = 9;
const DEFAULT_SUPPLY = '800000000';

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

function encodeU32LE(value: number) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, true);
  return new Uint8Array(buffer);
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
  // BCS uses ULEB128 length prefixes for sequences/strings.
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
  // Keep `v` in Ethereum's 27/28 form (this is what Linera's alloy signature parser supports).
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

const defaultForm = {
  tokenName: '',
  tokenSymbol: '',
  description: '',
  owner: '0x49c2f87001ec3e39ea5a4dbd115e404c4d4a4641e83c9a60dc3d9e77778f72c1',
  signature: ''
};

export default function Home() {
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>('');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [tokenImageFile, setTokenImageFile] = useState<File | null>(null);
  const [tokenImagePreviewUrl, setTokenImagePreviewUrl] = useState<string>('');
  const [tokenImageError, setTokenImageError] = useState<string>('');

  async function readImageAsDataUrl(file: File) {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read image.'));
      reader.readAsDataURL(file);
    });
  }

  async function fetchTokenAppIdForSymbol(symbol: string) {
    const trimmed = symbol.trim();
    if (!trimmed) {
      return '';
    }
    const endpoint = DEFAULT_GRAPHQL_ENDPOINT.replace(/\/$/, '');
    const url = `${endpoint}/chains/${DEFAULT_CHAIN_ID}/applications/${DEFAULT_TOKEN_FACTORY_APP_ID}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query TokenAppId($symbol: String!) {
          tokenAppId(symbol: $symbol)
        }`,
        variables: { symbol: trimmed }
      })
    });
    const json = await response.json();
    if (json?.errors?.length || (Array.isArray(json?.error) && json.error.length)) {
      return '';
    }
    return String(json?.data?.tokenAppId ?? '');
  }

  async function waitForTokenAppId(symbol: string) {
    // The createToken mutation schedules an operation; the registry may not be readable immediately.
    const maxAttempts = 12;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const tokenAppId = await fetchTokenAppIdForSymbol(symbol);
      if (tokenAppId) {
        return tokenAppId;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 + attempt * 150));
    }
    return '';
  }

  async function persistCreatedToken(params: { tokenAppId: string; name: string; symbol: string; imageDataUrl?: string }) {
    try {
      await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenAppId: params.tokenAppId,
          name: params.name,
          symbol: params.symbol,
          imageDataUrl: params.imageDataUrl ?? '',
          createdAt: Date.now()
        })
      });
    } catch {
      // ignore (still stored in localStorage)
    }
  }

  useEffect(() => {
    function syncWalletFromStorage() {
      try {
        const storedWallet = window.localStorage.getItem(LS_WALLET) ?? '';
        const storedOwner = window.localStorage.getItem(LS_OWNER) ?? '';
        setWalletAddress(storedWallet);
        if (storedOwner && storedOwner !== defaultForm.owner) {
          setForm((prev) => ({ ...prev, owner: storedOwner }));
        }
      } catch {
        // ignore
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== LS_OWNER && event.key !== LS_WALLET) {
        return;
      }
      syncWalletFromStorage();
    }

    syncWalletFromStorage();
    window.addEventListener('storage', onStorage);
    window.addEventListener('linad_owner_changed', syncWalletFromStorage as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('linad_owner_changed', syncWalletFromStorage as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (tokenImagePreviewUrl) {
        URL.revokeObjectURL(tokenImagePreviewUrl);
      }
    };
  }, [tokenImagePreviewUrl]);

  async function signWithMetaMask(requestOwner: string) {
    const trimmedOwner = requestOwner.trim();
    if (!trimmedOwner) {
      throw new Error('Missing owner.');
    }
    if (!walletAddress) {
      throw new Error('Connect MetaMask first.');
    }
    const owner = walletAddress;
    // Ensure we sign what we'll send to the chain.
    if (trimmedOwner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Owner must match connected MetaMask address.');
    }
    const payloadBytes = encodeCreateTokenRequest({
      owner,
      name: form.tokenName.trim(),
      symbol: form.tokenSymbol.trim(),
      decimals: DEFAULT_DECIMALS,
      supply: DEFAULT_SUPPLY
    });
    // Linera hashes/signs as: keccak256("{TypeName}::" || bcs(payload)).
    // Then MetaMask `personal_sign` applies EIP-191 over that 32-byte hash.
    const domain = TEXT_ENCODER.encode(`${CREATE_TOKEN_TYPE}::`);
    const hash = keccak_256(concatBytes(domain, payloadBytes));
    const messageHex = `0x${bytesToHex(hash)}`;

    const ethereum = (window as Window & { ethereum?: any }).ethereum;
    const rawSignature: string = await ethereum.request({
      method: 'personal_sign',
      params: [messageHex, owner]
    });
    // Debug helper: lets you copy/paste the raw signature and inspect `v` (last byte).
    // NOTE: Remove before production.
    try {
      const sigNo0x = String(rawSignature || '').replace(/^0x/i, '');
      const vHex = sigNo0x.length >= 2 ? sigNo0x.slice(-2) : '';
      // eslint-disable-next-line no-console
      console.log('[createToken] personal_sign', { owner, messageHex, vHex, rawSignature });
      (window as any).__linad_last_personal_sign = { owner, messageHex, vHex, rawSignature };
    } catch {
      // ignore
    }
    const signatureHex = bytesToHex(encodeEvmAccountSignature(rawSignature, owner));
    updateField('signature', signatureHex);
    return signatureHex;
  }

  async function submitToken(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setResult('');

    try {
      const requestOwner = (walletAddress || form.owner).trim();
      if (!requestOwner) {
        throw new Error('Owner is required. Connect MetaMask first.');
      }
      const signature = form.signature.trim() || (walletAddress ? await signWithMetaMask(requestOwner) : '');
      if (!signature) {
        throw new Error('Signature is required. Connect MetaMask to sign the request.');
      }
      const mutationBody = {
        query: `mutation CreateToken($owner: String!, $name: String!, $symbol: String!, $decimals: Int!, $supply: String!, $sig: String!) {
          createToken(request: { payload: { owner: $owner, metadata: { name: $name, symbol: $symbol, decimals: $decimals }, initialSupply: $supply }, signatureHex: $sig })
        }`,
        variables: {
          owner: requestOwner,
          name: form.tokenName.trim(),
          symbol: form.tokenSymbol.trim(),
          decimals: DEFAULT_DECIMALS,
          supply: DEFAULT_SUPPLY,
          sig: signature
        }
      };
      const endpoint = DEFAULT_GRAPHQL_ENDPOINT.replace(/\/$/, '');
      const url = `${endpoint}/chains/${DEFAULT_CHAIN_ID}/applications/${DEFAULT_TOKEN_FACTORY_APP_ID}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mutationBody)
      });
      const json = await response.json();

      let tokenAppId = '';
      try {
        const hasGraphQlErrors = Boolean(json?.errors?.length || (Array.isArray(json?.error) && json.error.length));
        // Some Linera service responses return `data` as a scalar (e.g. certificate hash). Treat "no errors" as success.
        const createOk = response.ok && !hasGraphQlErrors;
        if (createOk) {
          tokenAppId = await waitForTokenAppId(form.tokenSymbol);
        }
      } catch {
        tokenAppId = '';
      }

      let imageDataUrl = '';
      try {
        if (tokenAppId && tokenImageFile) {
          const dataUrl = await readImageAsDataUrl(tokenImageFile);
          imageDataUrl = dataUrl;
        }
      } catch {
        imageDataUrl = '';
      }

      if (tokenAppId) {
        const record = {
          tokenAppId,
          name: form.tokenName.trim(),
          symbol: form.tokenSymbol.trim(),
          imageDataUrl
        };
        void persistCreatedToken(record);
      }

      const resultPayload = tokenAppId ? { ...json, tokenAppId } : json;
      setResult(JSON.stringify(resultPayload, null, 2));

      // Clear user inputs after success, but keep the result visible.
      if (response.ok && !(json?.errors?.length || (Array.isArray(json?.error) && json.error.length))) {
        if (tokenImagePreviewUrl) {
          URL.revokeObjectURL(tokenImagePreviewUrl);
        }
        setTokenImageFile(null);
        setTokenImagePreviewUrl('');
        setTokenImageError('');
        setForm((prev) => ({
          ...prev,
          tokenName: '',
          tokenSymbol: '',
          description: '',
          signature: ''
        }));
      }
    } catch (error) {
      setResult(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  function updateField<K extends keyof typeof defaultForm>(key: K, value: (typeof defaultForm)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <main className="relative min-h-screen px-6 py-16">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-800/70 bg-slate-950/90 p-10 shadow-glow">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Linad.fun</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[0.18em] text-brand">LAUNCH YOUR TOKEN</h1>
          <p className="mt-3 text-sm text-slate-400">Create a token on Linera's Linad Chain</p>
        </div>

        <form onSubmit={submitToken} className="mt-10 grid gap-6">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <label className="relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-slate-700/70 px-4 py-8 text-center text-xs text-slate-400">
              {tokenImagePreviewUrl ? (
                <img
                  src={tokenImagePreviewUrl}
                  alt="Token preview"
                  className="absolute inset-0 h-full w-full object-cover opacity-70"
                />
              ) : null}
              <span className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/70 text-brand">
                +
              </span>
              <span className="relative">
                {tokenImageFile ? `Selected: ${tokenImageFile.name}` : 'PNG · JPEG · WEBP · GIF'}
              </span>
              <span className="relative text-[11px] text-slate-500">
                {tokenImageError ? tokenImageError : 'Max size 5MB'}
              </span>
              <input
                type="file"
                accept="image/*"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setTokenImageError('');
                  if (!file) {
                    setTokenImageFile(null);
                    if (tokenImagePreviewUrl) {
                      URL.revokeObjectURL(tokenImagePreviewUrl);
                    }
                    setTokenImagePreviewUrl('');
                    return;
                  }
                  if (file.size > 5 * 1024 * 1024) {
                    setTokenImageError('File too large (max 5MB).');
                    event.target.value = '';
                    return;
                  }
                  if (!file.type.startsWith('image/')) {
                    setTokenImageError('Unsupported file type.');
                    event.target.value = '';
                    return;
                  }
                  if (tokenImagePreviewUrl) {
                    URL.revokeObjectURL(tokenImagePreviewUrl);
                  }
                  setTokenImageFile(file);
                  setTokenImagePreviewUrl(URL.createObjectURL(file));
                }}
              />
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

          <div className="mt-4 flex flex-col items-center gap-3">
            <p className="text-xs text-slate-500">Free deployment</p>
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
