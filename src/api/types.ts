import type { ApiError } from './errors';
import type { RequestId } from '../lib/ids';

// Every API response is a discriminated Result. Callers switch on `ok`
// instead of throwing — consistent with Stripe's client conventions.

export interface Ok<T> {
  readonly ok: true;
  readonly data: T;
  readonly requestId: RequestId;
}

export interface Err {
  readonly ok: false;
  readonly error: ApiError;
  readonly requestId: RequestId;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T, requestId: RequestId): Ok<T> {
  return { ok: true, data, requestId };
}

export function err(error: ApiError, requestId: RequestId): Err {
  return { ok: false, error, requestId };
}
