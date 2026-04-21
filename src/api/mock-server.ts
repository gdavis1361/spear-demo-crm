// In-process mock API — intercepts fetch() calls to MOCK_API and routes them
// to handlers. Replaces MSW for this demo; real app would swap for MSW or
// delete this file entirely when hitting a real backend.
//
// Handlers: fake latency, idempotency-key caching, occasional 5xx to
// exercise the retry path, structured errors.

import { MOCK_API } from './client';
import { newRequestId } from '../lib/ids';
import type { ErrorCode } from './errors';

type Handler = (args: { url: URL; body: unknown; method: string; headers: Headers }) => Promise<HandlerResult>;
type HandlerResult = {
  status: number;
  body: unknown;
};

const handlers: { method: string; pattern: RegExp; handler: Handler }[] = [];

function route(method: string, pattern: RegExp, handler: Handler) {
  handlers.push({ method, pattern, handler });
}

// ─── Idempotency cache ─────────────────────────────────────────────────────
// Keyed by Idempotency-Key; stores the first response for 24h. Subsequent
// requests with the same key get the cached body verbatim.
const idempotencyCache = new Map<string, HandlerResult>();

// ─── Handlers ──────────────────────────────────────────────────────────────

interface AdvanceDealBody { stage: string }
route('PATCH', /^\/deals\/[a-z_0-9-]+$/i, async ({ body }) => {
  const b = body as AdvanceDealBody;
  if (!b.stage) return errorBody('invalid_request', 'Missing `stage`', 'stage');
  return { status: 200, body: { ok: true, stage: b.stage } };
});

interface DismissSignalBody { reason?: string }
route('POST', /^\/signals\/[a-z_0-9-]+\/dismiss$/i, async ({ body }) => {
  const _b = body as DismissSignalBody;
  // 10% flaky to exercise retries
  if (Math.random() < 0.1) return { status: 503, body: { code: 'internal_error', message: 'flaky dependency' } };
  return { status: 200, body: { ok: true, dismissedAt: new Date().toISOString() } };
});

route('POST', /^\/signals\/[a-z_0-9-]+\/action$/i, async () => {
  return { status: 200, body: { ok: true, actionedAt: new Date().toISOString() } };
});

interface SendBafoBody { text: string }
route('POST', /^\/quotes\/[a-z_0-9-]+\/send$/i, async ({ body }) => {
  const b = body as SendBafoBody;
  if (!b.text || b.text.length < 30) {
    return errorBody('invalid_request', 'Honest note too short', 'text');
  }
  return { status: 200, body: { ok: true, sentAt: new Date().toISOString() } };
});

// ─── Install ───────────────────────────────────────────────────────────────

let installed = false;

export function installMockApi(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url;
    if (!urlStr.startsWith(MOCK_API)) return nativeFetch(input as RequestInfo, init);

    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? {});
    const idempotencyKey = headers.get('Idempotency-Key') ?? null;
    const url = new URL(urlStr);
    const path = url.pathname.replace(/^\/v1/, '');

    await sleep(latencyMs());

    // Idempotency cache: mutating requests with a known key return cached.
    if (idempotencyKey && method !== 'GET') {
      const cached = idempotencyCache.get(`${method}:${path}:${idempotencyKey}`);
      if (cached) return buildResponse(cached);
    }

    let body: unknown;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }

    const match = handlers.find((h) => h.method === method && h.pattern.test(path));
    if (!match) {
      return buildResponse(errorBody('resource_not_found', `No handler for ${method} ${path}`));
    }

    const result = await match.handler({
      url,
      body,
      method,
      headers,
    });

    if (idempotencyKey && method !== 'GET' && result.status < 500) {
      idempotencyCache.set(`${method}:${path}:${idempotencyKey}`, result);
    }

    return buildResponse(result);
  };
}

function buildResponse({ status, body }: HandlerResult): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': newRequestId(),
    },
  });
}

function errorBody(code: ErrorCode, message: string, param?: string): HandlerResult {
  const status =
    code === 'invalid_request' ? 422 :
    code === 'resource_not_found' ? 404 :
    code === 'rate_limited' ? 429 :
    code === 'unauthenticated' ? 401 :
    code === 'permission_denied' ? 403 :
    code === 'idempotency_conflict' ? 409 : 500;
  return { status, body: { code, message, param } };
}

function latencyMs(): number {
  // Realistic dev latency: 80-300ms, biased toward 120.
  return 80 + Math.floor(Math.random() * 220);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
