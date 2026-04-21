// Phone + email primitives. Lightweight — we don't ship libphonenumber's
// 500kb metadata for a demo. Real app would swap in `libphonenumber-js` here
// without touching callers.

export interface PhoneNumber {
  /** E.164: "+13345551234" */
  readonly e164: string;
  /** ISO 3166-1 alpha-2 */
  readonly country: string;
}

export function parsePhone(raw: string, defaultCountry = 'US'): PhoneNumber {
  // Normalize: strip everything but digits and leading +
  const stripped = raw.replace(/[^\d+]/g, '');
  const e164 = stripped.startsWith('+')
    ? stripped
    : `+1${stripped}`; // naive: assumes US if no country code
  return { e164, country: defaultCountry };
}

export function formatPhone(p: PhoneNumber): string {
  // US-only pretty formatting; intl numbers render e164.
  if (p.country === 'US' && p.e164.length === 12 && p.e164.startsWith('+1')) {
    const d = p.e164.slice(2);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return p.e164;
}

export interface EmailAddress {
  readonly value: string;
  readonly domain: string;
}

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

export function parseEmail(raw: string): EmailAddress {
  const m = EMAIL_RE.exec(raw.trim());
  if (!m) throw new Error(`[email] malformed: ${raw}`);
  return { value: raw.trim(), domain: m[1].toLowerCase() };
}

export function maybeEmail(raw: string): EmailAddress | null {
  try { return parseEmail(raw); } catch { return null; }
}
