// Versioned client state — every persisted key carries a schema version.
// If the shape changes, bump the version and register a migration.
//
// Stripe's pattern: never `JSON.parse` a raw localStorage value. Always
// validate + migrate. A stale shape is the #1 cause of silent corruption
// after a deploy.

const PREFIX = 'spear';
const VERSION = 1;

export function storageKey(name: string): string {
  return `${PREFIX}:v${VERSION}:${name}`;
}

// Best-effort legacy migration: previous unversioned keys (`spear.foo`)
// are read once and copied into the versioned slot.
const LEGACY_KEYS: Record<string, string> = {
  'spear.tweaks':    storageKey('tweaks'),
  'spear.screen':    storageKey('screen'),
  'spear.role':      storageKey('role'),
  'spear.focus':     storageKey('focus'),
  'spear.todayMode': storageKey('todayMode'),
};

export function migrateLegacy(): void {
  if (typeof window === 'undefined') return;
  for (const [oldK, newK] of Object.entries(LEGACY_KEYS)) {
    const existing = localStorage.getItem(newK);
    if (existing !== null) continue;
    const legacy = localStorage.getItem(oldK);
    if (legacy !== null) {
      localStorage.setItem(newK, legacy);
      localStorage.removeItem(oldK);
    }
  }
}

export function readJson<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw === null) return null;
    return parse(JSON.parse(raw));
  } catch {
    localStorage.removeItem(storageKey(key));
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey(key), JSON.stringify(value));
}

export function readString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(storageKey(key));
}

export function writeString(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey(key), value);
}

export function removeKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(storageKey(key));
}
