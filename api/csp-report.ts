// TB10 — `/api/csp-report` Vercel serverless function.
//
// Browsers POST CSP violations here in two formats depending on
// which directive routed them:
//
//   - `report-uri` directive (legacy, widely supported) → Content-Type
//     `application/csp-report`, body `{ "csp-report": { ... } }`.
//   - `report-to` directive (modern, required by newer browsers) →
//     Content-Type `application/reports+json`, body is an array of
//     reports with `body` / `type` / `url` / `user_agent` fields.
//
// The handler logs whichever shape arrives (Vercel captures stdout →
// any configured drain), returns 204. No business logic beyond "don't
// 404 the report" — the value is the log line itself, which alerts
// an operator that the CSP is being exercised / drift has landed.
//
// Soft validation: we don't reject on shape. A CSP report is a
// diagnostic, not a trusted input; the log-and-move-on posture means
// an unusual-but-parseable report still produces a signal. Reject
// anything with an empty/missing body as 400 so probe tools get a
// meaningful response.

// Inline Vercel runtime shape — see api/telemetry.ts for rationale.
interface VercelRequestShape {
  readonly method?: string;
  readonly body?: unknown;
}
interface VercelResponseShape {
  status(code: number): VercelResponseShape;
  setHeader(name: string, value: string): VercelResponseShape;
  send(body: string): void;
  end(): void;
}

interface ReportUriBody {
  readonly 'csp-report'?: Record<string, unknown>;
}

interface ReportToEntry {
  readonly type?: string;
  readonly url?: string;
  readonly body?: Record<string, unknown>;
  readonly user_agent?: string;
}

export default function handler(req: VercelRequestShape, res: VercelResponseShape): void {
  if (req.method !== 'POST') {
    res.status(405).setHeader('Allow', 'POST').send('POST only');
    return;
  }

  const raw = req.body;
  let parsed: unknown = raw;
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    res.status(400).send('invalid body');
    return;
  }

  // report-uri shape: { "csp-report": { ... } }
  // report-to shape: [{ type: 'csp-violation', body: { ... } }, ...]
  if (Array.isArray(parsed)) {
    const entries = parsed as readonly ReportToEntry[];
    for (const entry of entries.slice(0, 10)) {
      console.log(
        JSON.stringify({
          kind: 'csp.report',
          source: 'report-to',
          type: entry.type ?? '?',
          url: entry.url ?? '?',
          body: entry.body ?? {},
        })
      );
    }
  } else {
    const body = (parsed as ReportUriBody)['csp-report'];
    console.log(
      JSON.stringify({
        kind: 'csp.report',
        source: 'report-uri',
        body: body ?? parsed,
      })
    );
  }

  res.status(204).end();
}
