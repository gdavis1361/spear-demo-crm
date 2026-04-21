// API client — thin boundary over fetch. Every mutating call takes an
// idempotency key. Every response is a Result<T>. Every error has a code,
// a requestId, and a docsUrl.
//
// In this demo, `fetch` targets `MOCK_API` which the mock server (see
// `./mock-server.ts`) intercepts. Swap that for a real base URL in prod.

import { ok, err, type Result } from './types';
import type { ErrorCode, ApiError } from './errors';
import { docsUrlFor } from './errors';
import { newIdempotencyKey, newRequestId, type RequestId } from '../lib/ids';

export const MOCK_API = 'https://api.spear.example/v1';

export interface RequestOptions {
  /** Idempotency key. Generated if absent on mutations. */
  idempotencyKey?: string;
  /** Abort signal. Caller-provided for component-scoped cancellation. */
  signal?: AbortSignal;
  /** Max retries (network + 5xx only, never 4xx). Default 2 with exponential backoff. */
  maxRetries?: number;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const MUTATING = new Set<Method>(['POST', 'PATCH', 'DELETE']);

async function request<T>(
  method: Method,
  path: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<Result<T>> {
  const url = `${MOCK_API}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (MUTATING.has(method)) {
    headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();
  }
  const maxRetries = opts.maxRetries ?? 2;

  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: opts.signal,
      });
      const reqId = (res.headers.get('X-Request-Id') ?? newRequestId()) as RequestId;

      if (res.ok) {
        const data = (await res.json()) as T;
        return ok(data, reqId);
      }

      const body400 = await res.json().catch(() => ({}));
      const apiError: ApiError = {
        code: (body400.code as ErrorCode) ?? mapHttpToCode(res.status),
        message: body400.message ?? res.statusText ?? 'Request failed',
        requestId: reqId,
        docsUrl: docsUrlFor(body400.code ?? mapHttpToCode(res.status)),
        param: body400.param,
      };

      // Don't retry 4xx.
      if (res.status >= 400 && res.status < 500) return err(apiError, reqId);

      // 5xx retry with backoff.
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        attempt++;
        continue;
      }
      return err(apiError, reqId);
    } catch (cause) {
      const reqId = newRequestId();
      const apiError: ApiError = {
        code: isAbort(cause) ? 'timeout' : 'network_error',
        message: isAbort(cause) ? 'Request aborted' : 'Network error',
        requestId: reqId,
        docsUrl: docsUrlFor(isAbort(cause) ? 'timeout' : 'network_error'),
        cause,
      };
      if (!isAbort(cause) && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        attempt++;
        continue;
      }
      return err(apiError, reqId);
    }
  }
}

function mapHttpToCode(status: number): ErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'resource_not_found';
  if (status === 409) return 'idempotency_conflict';
  if (status === 422) return 'invalid_request';
  if (status === 429) return 'rate_limited';
  return 'internal_error';
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms, 1s + jitter
  const base = 250 * 2 ** attempt;
  return base + Math.floor(Math.random() * 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export const api = {
  get:    <T>(path: string,                       opts?: RequestOptions) => request<T>('GET',    path, undefined, opts),
  post:   <T>(path: string, body: unknown,        opts?: RequestOptions) => request<T>('POST',   path, body,      opts),
  patch:  <T>(path: string, body: unknown,        opts?: RequestOptions) => request<T>('PATCH',  path, body,      opts),
  delete: <T>(path: string,                       opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};
