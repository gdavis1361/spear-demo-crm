// Feature flags — a thin interface shaped like LaunchDarkly / Statsig.
//
// In this demo, flags are evaluated against a static config + URL
// overrides (`?ff_foo=1`) for QA. The API deliberately mirrors what a real
// SDK would expose so switching providers is a one-file change.

export type FlagName =
  | 'pipeline.keyboard_move_menu'
  | 'signals.bulk_dismiss'
  | 'tweaks.density_compact';

const DEFAULTS: Record<FlagName, boolean> = {
  'pipeline.keyboard_move_menu': true,
  'signals.bulk_dismiss': false,
  'tweaks.density_compact': true,
};

function readUrlOverrides(): Partial<Record<FlagName, boolean>> {
  if (typeof window === 'undefined') return {};
  const out: Partial<Record<FlagName, boolean>> = {};
  const params = new URL(window.location.href).searchParams;
  for (const name of Object.keys(DEFAULTS) as FlagName[]) {
    const key = `ff_${name.replace(/\./g, '_')}`;
    const raw = params.get(key);
    if (raw === '1' || raw === 'true') out[name] = true;
    if (raw === '0' || raw === 'false') out[name] = false;
  }
  return out;
}

const overrides = readUrlOverrides();

export function isEnabled(flag: FlagName): boolean {
  return overrides[flag] ?? DEFAULTS[flag];
}
