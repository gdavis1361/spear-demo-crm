import { describe, it, expect, vi } from 'vitest';
import telemetryHandler from './telemetry';
import cspHandler from './csp-report';

// Minimal Vercel-shape mock. We're not testing the full Node runtime;
// just the handler contract: method gating, body parsing, response.
function mockRes() {
  const state: {
    statusCode?: number;
    headers: Record<string, string>;
    body?: string;
    ended: boolean;
  } = { headers: {}, ended: false };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return res;
    },
    send(body: string) {
      state.body = body;
      state.ended = true;
    },
    end() {
      state.ended = true;
    },
  };
  return { res, state };
}

describe('api/telemetry (TB4)', () => {
  it('rejects non-POST methods', () => {
    const { res, state } = mockRes();
    telemetryHandler({ method: 'GET' }, res);
    expect(state.statusCode).toBe(405);
    expect(state.headers.Allow).toBe('POST');
  });

  it('rejects malformed bodies with 400', () => {
    const { res, state } = mockRes();
    telemetryHandler({ method: 'POST', body: 'not json' }, res);
    expect(state.statusCode).toBe(400);
  });

  it('rejects shape that is not { events: [] }', () => {
    const { res, state } = mockRes();
    telemetryHandler({ method: 'POST', body: { events: 'not-an-array' } }, res);
    expect(state.statusCode).toBe(400);
  });

  it('accepts a valid batch and logs + returns 204', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { res, state } = mockRes();
    telemetryHandler({ method: 'POST', body: { events: [{ name: 'app.mounted' }] } }, res);
    expect(state.statusCode).toBe(204);
    expect(state.ended).toBe(true);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe('api/csp-report (TB10)', () => {
  it('rejects non-POST methods', () => {
    const { res, state } = mockRes();
    cspHandler({ method: 'GET' }, res);
    expect(state.statusCode).toBe(405);
  });

  it('logs a report-uri shaped body and returns 204', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { res, state } = mockRes();
    cspHandler(
      {
        method: 'POST',
        body: {
          'csp-report': {
            'document-uri': 'https://app.example.com/',
            'violated-directive': 'script-src',
            'blocked-uri': 'inline',
          },
        },
      },
      res
    );
    expect(state.statusCode).toBe(204);
    expect(logSpy).toHaveBeenCalled();
    const logged = JSON.parse((logSpy.mock.calls[0][0] as string) ?? '{}');
    expect(logged.kind).toBe('csp.report');
    expect(logged.source).toBe('report-uri');
    logSpy.mockRestore();
  });

  it('logs a report-to shaped array body', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { res, state } = mockRes();
    cspHandler(
      {
        method: 'POST',
        body: [
          { type: 'csp-violation', url: 'https://app.example.com/', body: { 'blocked-uri': 'x' } },
        ],
      },
      res
    );
    expect(state.statusCode).toBe(204);
    const logged = JSON.parse((logSpy.mock.calls[0][0] as string) ?? '{}');
    expect(logged.source).toBe('report-to');
    logSpy.mockRestore();
  });

  it('rejects empty body with 400', () => {
    const { res, state } = mockRes();
    cspHandler({ method: 'POST', body: null }, res);
    expect(state.statusCode).toBe(400);
  });
});
