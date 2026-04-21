// Time — instants, zones, and human-readable rendering.
//
// Storage is always UTC-anchored (ISO 8601 string). Rendering is always
// explicit-zone. No implicit locale/zone fallback — the caller picks.

export type IanaZone =
  | 'America/New_York'    // ET
  | 'America/Chicago'     // CT
  | 'America/Denver'      // MT
  | 'America/Los_Angeles' // PT
  | 'America/Anchorage'   // AKT
  | 'Asia/Tokyo'          // JST (Yokota)
  | 'Europe/Berlin'       // CET (Ramstein)
  | 'UTC';

export interface Instant {
  /** ISO 8601, always in UTC (`...Z`). */
  readonly iso: string;
}

export interface ZonedDateTime {
  readonly instant: Instant;
  readonly zone: IanaZone;
}

export function instant(iso: string): Instant {
  // Normalize to UTC iso
  return { iso: new Date(iso).toISOString() };
}

export function zoned(iso: string, zone: IanaZone): ZonedDateTime {
  return { instant: instant(iso), zone };
}

// Mockable "now" — overrideable in tests to prevent time-based flakes.
let nowProvider: () => Instant = () => ({ iso: new Date().toISOString() });

export function now(): Instant {
  return nowProvider();
}

export function _setNowForTests(provider: () => Instant): void {
  nowProvider = provider;
}

export function _resetNowForTests(): void {
  nowProvider = () => ({ iso: new Date().toISOString() });
}

const TIMEZONE_SHORT: Record<IanaZone, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'America/Anchorage': 'AKT',
  'Asia/Tokyo': 'JST',
  'Europe/Berlin': 'CET',
  'UTC': 'UTC',
};

export function formatZoned(
  z: ZonedDateTime,
  opts: { showDate?: boolean; showTime?: boolean; showZone?: boolean } = {}
): string {
  const { showDate = true, showTime = true, showZone = true } = opts;
  const d = new Date(z.instant.iso);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: z.zone,
    weekday: showDate ? 'short' : undefined,
    month: showDate ? 'short' : undefined,
    day: showDate ? 'numeric' : undefined,
    hour: showTime ? '2-digit' : undefined,
    minute: showTime ? '2-digit' : undefined,
    hour12: false,
  });
  const parts = fmt.format(d);
  return showZone ? `${parts} ${TIMEZONE_SHORT[z.zone]}` : parts;
}

export function formatInstantDate(i: Instant, zone: IanaZone, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone, month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(i.iso));
}

const MS = { sec: 1000, min: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

export function relativeTime(i: Instant, nowI: Instant = now()): string {
  const diffMs = new Date(nowI.iso).getTime() - new Date(i.iso).getTime();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  if (abs < MS.min) return rtf.format(-Math.round(diffMs / MS.sec), 'second');
  if (abs < MS.hour) return rtf.format(-Math.round(diffMs / MS.min), 'minute');
  if (abs < MS.day) return rtf.format(-Math.round(diffMs / MS.hour), 'hour');
  return rtf.format(-Math.round(diffMs / MS.day), 'day');
}

// "0:04" style age — minutes:seconds for under-hour, HhMm over that.
export function ageShort(i: Instant, nowI: Instant = now()): string {
  const diffMs = Math.max(0, new Date(nowI.iso).getTime() - new Date(i.iso).getTime());
  if (diffMs < MS.hour) {
    const mins = Math.floor(diffMs / MS.min);
    const secs = Math.floor((diffMs % MS.min) / MS.sec);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }
  if (diffMs < MS.day) {
    const hours = Math.floor(diffMs / MS.hour);
    return `${hours}h`;
  }
  const days = Math.floor(diffMs / MS.day);
  return `${days}d`;
}
