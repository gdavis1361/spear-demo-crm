import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// TB5 + TB10 — lock down the CSP + reporting directives in vercel.json.
//
// CSP drift is the classic Trail-of-Bits audit finding: a tight policy
// gets a `'unsafe-inline'` added "just this once" for a third-party
// widget, nobody notices, every future audit repeats the finding. This
// test fails fast on known-dangerous looseners. It also asserts the
// presence of the ingest-domain allowances that make Sentry reach the
// network when a DSN is configured — that coupling is implicit in the
// codebase and landing a stricter CSP without updating Sentry tunneling
// would silently kill error reporting.

const vercelJson = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

function getHeaderValue(name: string): string {
  for (const rule of vercelJson.headers ?? []) {
    if (rule.source !== '/(.*)') continue;
    const hit = rule.headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
    if (hit) return hit.value;
  }
  throw new Error(`header "${name}" missing from vercel.json /(.*) rule`);
}

describe('Content-Security-Policy (TB5 + TB10)', () => {
  const csp = getHeaderValue('Content-Security-Policy');

  it('refuses inline scripts (no unsafe-inline on script-src)', () => {
    // script-src is the crown jewel. Even one `'unsafe-inline'` here
    // unlocks every reflected-XSS primitive. Keep it out forever.
    const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('blocks framing from any origin', () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('keeps base-uri tight so a planted <base> tag cannot redirect relative URLs', () => {
    expect(csp).toContain("base-uri 'self'");
  });

  it('allows connect-src to Sentry ingest hosts (TB5)', () => {
    // Sentry's browser SDK POSTs directly to the DSN ingest. Without
    // this allowance, configuring VITE_SENTRY_DSN silently yields zero
    // error reports — the CSP eats every submission.
    expect(csp).toMatch(/connect-src\s+[^;]*'self'/);
    expect(csp).toMatch(/connect-src\s+[^;]*\*\.ingest\.sentry\.io/);
  });

  it('has report-uri + report-to pointing at /api/csp-report (TB10)', () => {
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp-endpoint');
  });
});

describe('Report-To header (TB10)', () => {
  it('declares the csp-endpoint group', () => {
    const value = getHeaderValue('Report-To');
    const parsed = JSON.parse(value) as {
      group: string;
      endpoints: Array<{ url: string }>;
    };
    expect(parsed.group).toBe('csp-endpoint');
    expect(parsed.endpoints[0].url).toBe('/api/csp-report');
  });
});

describe('transport + frame headers (locked)', () => {
  it('HSTS preload with includeSubDomains', () => {
    const v = getHeaderValue('Strict-Transport-Security');
    expect(v).toContain('max-age=');
    expect(v).toContain('includeSubDomains');
    expect(v).toContain('preload');
  });

  it('X-Frame-Options DENY (belt for older browsers that ignore frame-ancestors)', () => {
    expect(getHeaderValue('X-Frame-Options')).toBe('DENY');
  });

  it('X-Content-Type-Options nosniff', () => {
    expect(getHeaderValue('X-Content-Type-Options')).toBe('nosniff');
  });

  it('strict referrer policy', () => {
    expect(getHeaderValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});
