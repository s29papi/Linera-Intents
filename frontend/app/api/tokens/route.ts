import { promises as fs } from 'fs';
import path from 'path';

type TokenRecord = {
  tokenAppId: string;
  name: string;
  symbol: string;
  imageDataUrl?: string;
  createdAt?: number;
};

function storePath() {
  // In Docker, Next runs from `/build/frontend`, and `/build` is a bind-mount to the host repo.
  // Store at repo root so it survives container restarts.
  const envPath = process.env.LINAD_TOKEN_STORE_PATH;
  if (envPath && envPath.trim()) {
    return envPath;
  }
  return path.resolve(process.cwd(), '..', 'tokens.gallery.json');
}

async function readStore(): Promise<Record<string, TokenRecord>> {
  try {
    const content = await fs.readFile(storePath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, TokenRecord>;
    }
  } catch {
    // ignore (missing/invalid file)
  }
  return {};
}

async function writeStore(next: Record<string, TokenRecord>) {
  const filePath = storePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

export async function GET() {
  const data = await readStore();
  return Response.json({ data });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as TokenRecord | null;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: ['Invalid JSON body'] }, { status: 400 });
  }
  const tokenAppId = String((body as any).tokenAppId ?? '').trim();
  const name = String((body as any).name ?? '').trim();
  const symbol = String((body as any).symbol ?? '').trim();
  const imageDataUrl = String((body as any).imageDataUrl ?? '').trim();

  if (!tokenAppId) {
    return Response.json({ error: ['tokenAppId is required'] }, { status: 400 });
  }
  if (!name || !symbol) {
    return Response.json({ error: ['name and symbol are required'] }, { status: 400 });
  }

  const store = await readStore();
  store[tokenAppId] = {
    tokenAppId,
    name,
    symbol,
    imageDataUrl,
    createdAt: Number((body as any).createdAt ?? Date.now()),
  };
  await writeStore(store);

  return Response.json({ ok: true });
}

