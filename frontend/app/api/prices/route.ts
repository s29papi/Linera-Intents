import { promises as fs } from 'fs';
import path from 'path';

type PricePoint = {
  time: number; // unix ms
  value: number;
};

function storePath() {
  const envPath = process.env.LINAD_PRICE_STORE_PATH;
  if (envPath && envPath.trim()) {
    return envPath;
  }
  return path.resolve(process.cwd(), '..', 'prices.series.json');
}

async function readStore(): Promise<Record<string, PricePoint[]>> {
  try {
    const content = await fs.readFile(storePath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, PricePoint[]>;
    }
  } catch {
    // ignore (missing/invalid file)
  }
  return {};
}

async function writeStore(next: Record<string, PricePoint[]>) {
  const filePath = storePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenAppId = (url.searchParams.get('tokenAppId') ?? '').trim();
  const store = await readStore();
  const points = tokenAppId ? store[tokenAppId] ?? [] : [];
  return Response.json({ data: points });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as any;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: ['Invalid JSON body'] }, { status: 400 });
  }
  const tokenAppId = String(body.tokenAppId ?? '').trim();
  const time = Number(body.time ?? Date.now());
  const value = Number(body.value);

  if (!tokenAppId) {
    return Response.json({ error: ['tokenAppId is required'] }, { status: 400 });
  }
  if (!Number.isFinite(value)) {
    return Response.json({ error: ['value must be a finite number'] }, { status: 400 });
  }
  // Guardrail: a demo bonding-curve spot price should not be anywhere near this.
  if (value <= 0 || value >= 1000) {
    return Response.json({ error: ['value out of expected range'] }, { status: 400 });
  }

  const store = await readStore();
  const next = store[tokenAppId] ?? [];
  next.push({ time, value });
  next.sort((a, b) => a.time - b.time);

  // Keep it small-ish for a demo (still plenty for charts).
  const maxPoints = 2000;
  store[tokenAppId] = next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
  await writeStore(store);

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const tokenAppId = (url.searchParams.get('tokenAppId') ?? '').trim();
  if (!tokenAppId) {
    return Response.json({ error: ['tokenAppId is required'] }, { status: 400 });
  }
  const store = await readStore();
  delete store[tokenAppId];
  await writeStore(store);
  return Response.json({ ok: true });
}
