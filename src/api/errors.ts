// Error codes — stable, machine-readable, documented. Customers (and
// support) quote these when reporting issues. The human `message` can
// change; the `code` must not.

export type ErrorCode =
  // Transport
  | 'network_error'
  | 'timeout'
  | 'rate_limited'
  // Authn/authz
  | 'unauthenticated'
  | 'permission_denied'
  // Validation
  | 'invalid_request'
  | 'invalid_money'
  | 'invalid_id_prefix'
  | 'invalid_idempotency_key'
  // Conflict / state
  | 'resource_not_found'
  | 'idempotency_conflict'
  | 'optimistic_lock_failure'
  | 'stage_transition_invalid'
  | 'signal_already_dismissed'
  // Server
  | 'internal_error';

export interface ApiError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly docsUrl?: string;
  readonly param?: string;
  readonly cause?: unknown;
}

export class ApiErrorException extends Error {
  constructor(readonly details: ApiError) {
    super(`${details.code}: ${details.message} (${details.requestId})`);
    this.name = 'ApiErrorException';
  }
}

const DOCS_BASE = 'https://docs.spear.example/api/errors';
export function docsUrlFor(code: ErrorCode): string {
  return `${DOCS_BASE}#${code}`;
}
