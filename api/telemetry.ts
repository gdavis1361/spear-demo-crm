// TB4 — `/api/telemetry` Vercel serverless function.
//
// The client flushes wide-event batches to this endpoint via
// `fetch('/api/telemetry', ...)` + `navigator.sendBeacon`. Pre-TB4,
// the request URL was `/telemetry`, which the Vercel SPA rewrite
// `{ source: '/(.*)', destination: '/index.html' }` sent to the
// static index.html — POSTs returned 200 HTML and the client's
// `res.ok` check thought success, so every telemetry envelope was
// black-holed.
//
// This handler does the minimum useful thing: accept POSTs, parse
// the shape, log to stdout (Vercel's observability captures stdout
// and forwards to any configured drain), return 204.
//
// Shape expectation (client: src/app/telemetry.ts#flush):
//   { events: [{ name, props, ts, sessionId, release, ... }] }
//
// We validate soft — reject obviously malformed bodies with 400,
// log anything that parses (even if fields are missing) so an
// incident investigator can see "some" data rather than "none."
// A strict schema would require importing Zod here, pulling tens of
// KB into every cold start; the client is already the strict side
// of the contract (redactProps + SAFE_STRING_KEYS enforced client-
// side, see TB2).

// Vercel's Node runtime passes IncomingMessage/ServerResponse-shaped
// objects (with a parsed `body` field). We avoid the @vercel/node
// types dep by shaping the surface we need inline — any Vercel runtime
// update that broadens these stays backward-compatible.
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

interface TelemetryBody {
  readonly events: readonly unknown[];
}

export default function handler(req: VercelRequestShape, res: VercelResponseShape): void {
  // Browser sendBeacon uses POST; fetch keepalive does too.
  if (req.method !== 'POST') {
    res.status(405).setHeader('Allow', 'POST').send('POST only');
    return;
  }

  // Vercel parses JSON bodies when Content-Type is application/json;
  // sendBeacon uses application/json too (see telemetry.ts: `new
  // Blob([payload], { type: 'application/json' })`). Fall back to
  // string parsing for clients that bypass the JSON middleware.
  let body: TelemetryBody | null = null;
  if (typeof req.body === 'object' && req.body !== null) {
    body = req.body as TelemetryBody;
  } else if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body) as TelemetryBody;
    } catch {
      body = null;
    }
  }
  if (!body || !Array.isArray(body.events)) {
    res.status(400).send('invalid body');
    return;
  }

  // Log compact — Vercel caps log size per invocation. `eventCount`
  // + names is enough for dashboards; full props are in the
  // request body stored upstream.
  const names = body.events
    .map((e) => (typeof e === 'object' && e && 'name' in e ? String(e.name) : '?'))
    .slice(0, 20);
  console.log(
    JSON.stringify({
      kind: 'telemetry.batch',
      eventCount: body.events.length,
      sampleNames: names,
    })
  );

  // 204 No Content — the client doesn't need anything back, and
  // sendBeacon drops the response anyway.
  res.status(204).end();
}
