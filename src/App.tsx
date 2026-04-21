import React from 'react';
import { Topbar, Rail, Tweaks } from './components/shell';
import { Peek, CommandBar, CommandPalette, FocusProvider } from './components/nouns';
import { SeedBanner } from './components/seed-banner';
import { DevPalette } from './components/dev-palette';
import { LiveRegionProvider } from './lib/live-region';
import { AppProvider } from './app/context';
import { readJson, readString, writeJson, writeString } from './app/state';
import { track } from './app/telemetry';
import { setRole as setAmbientRole, setScreen as setAmbientScreen } from './app/ambient';
import { setTag } from './app/observability';
import type { Screen, Role, Tweaks as TweaksState } from './lib/types';

const TWEAK_DEFAULTS: TweaksState = {
  ground: 'graphite',
  pipeLayout: 'kanban',
  density: 'comfortable',
  todaySort: 'stage',
};

const SCREEN_LABEL: Record<Screen, string> = {
  today: '01 Today',
  pipeline: '02 Pipeline',
  pond: '03 Pond health',
  signals: '04 Signals',
  account: '05 Account 360',
  quote: '06 Quote builder',
  workflows: '07 Workflows',
};

const VALID_SCREENS: ReadonlySet<Screen> = new Set([
  'today',
  'pipeline',
  'pond',
  'signals',
  'account',
  'quote',
  'workflows',
]);
const VALID_ROLES: ReadonlySet<Role> = new Set(['rep', 'ae', 'mgr']);

function parseTweaks(raw: unknown): TweaksState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<TweaksState>;
  return { ...TWEAK_DEFAULTS, ...r };
}

// Route-level code-splitting: each screen is a separate chunk.
const Today = React.lazy(() => import('./screens/today-pond').then((m) => ({ default: m.Today })));
const Pond = React.lazy(() => import('./screens/today-pond').then((m) => ({ default: m.Pond })));
const Pipeline = React.lazy(() =>
  import('./screens/pipeline').then((m) => ({ default: m.Pipeline }))
);
const Signals = React.lazy(() => import('./screens/signals').then((m) => ({ default: m.Signals })));
const Account = React.lazy(() =>
  import('./screens/account-quote-workflows').then((m) => ({ default: m.Account }))
);
const Quote = React.lazy(() =>
  import('./screens/account-quote-workflows').then((m) => ({ default: m.Quote }))
);
const Workflows = React.lazy(() =>
  import('./screens/account-quote-workflows').then((m) => ({ default: m.Workflows }))
);
const ManagerToday = React.lazy(() =>
  import('./components/extras').then((m) => ({ default: m.ManagerToday }))
);
const ManagerPond = React.lazy(() =>
  import('./components/extras').then((m) => ({ default: m.ManagerPond }))
);

function ScreenSkeleton() {
  return (
    <div className="screen-skeleton" aria-busy="true" aria-live="polite">
      Loading…
    </div>
  );
}

export function App() {
  const [screen, setScreenRaw] = React.useState<Screen>(() => {
    const v = readString('screen');
    return v && VALID_SCREENS.has(v as Screen) ? (v as Screen) : 'today';
  });
  const [role, setRoleRaw] = React.useState<Role>(() => {
    const v = readString('role');
    return v && VALID_ROLES.has(v as Role) ? (v as Role) : 'rep';
  });
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const [t, setT] = React.useState<TweaksState>(
    () => readJson('tweaks', parseTweaks) ?? TWEAK_DEFAULTS
  );

  const setScreen = React.useCallback((next: Screen, method: 'click' | 'keyboard' = 'click') => {
    setScreenRaw((prev) => {
      if (prev !== next) track({ name: 'rail.navigate', props: { from: prev, to: next, method } });
      return next;
    });
  }, []);

  const setRole = React.useCallback((next: Role) => setRoleRaw(next), []);

  const setTweak = React.useCallback((patch: Partial<TweaksState>) => {
    setT((prev) => {
      const next = { ...prev, ...patch };
      writeJson('tweaks', next);
      return next;
    });
  }, []);

  React.useEffect(() => {
    writeString('screen', screen);
    // Mirror screen into the ambient module so non-React telemetry
    // callers (schedules, observability, workflow-runner) can read it
    // via `baseContext()` without needing hook access.
    setAmbientScreen(screen);
    setTag('screen', screen);
  }, [screen]);
  React.useEffect(() => {
    writeString('role', role);
    setAmbientRole(role);
    setTag('role', role);
  }, [role]);
  React.useEffect(() => {
    document.documentElement.setAttribute('data-ground', t.ground);
  }, [t.ground]);

  React.useEffect(() => {
    track({ name: 'app.mounted', props: { ground: t.ground, density: t.density } });
    // only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: g + key shortcuts for screen navigation
  React.useEffect(() => {
    let g = false;
    let gt: ReturnType<typeof setTimeout>;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches?.('input, textarea, select')) return;
      if (e.key === 'g') {
        g = true;
        clearTimeout(gt);
        gt = setTimeout(() => {
          g = false;
        }, 800);
        return;
      }
      if (g) {
        const map: Record<string, Screen> = {
          t: 'today',
          p: 'pipeline',
          h: 'pond',
          s: 'signals',
          a: 'account',
          q: 'quote',
          w: 'workflows',
        };
        const next = map[e.key];
        if (next) {
          setScreen(next, 'keyboard');
          g = false;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setScreen]);

  return (
    <AppProvider screen={screen} setScreen={setScreenRaw} role={role} setRole={setRole}>
      <LiveRegionProvider>
        <FocusProvider>
          <a href="#main" className="skip-link">
            Skip to main content
          </a>
          <SeedBanner />
          <DevPalette />
          <div
            className="app with-cmdbar"
            data-density={t.density}
            data-screen-label={SCREEN_LABEL[screen]}
          >
            <Topbar screen={screen} role={role} setRole={setRole} ground={t.ground} />
            <Rail
              screen={screen}
              setScreen={setScreenRaw}
              onOpenTweaks={() => setTweaksOpen(true)}
            />
            {/*
            `tabIndex={0}` satisfies two WCAG criteria at once:
              - 2.4.1: skip-link hash-activation lands focus here (works
                without tabindex on Chrome/Firefox but not on WebKit).
              - 2.1.1: `.main` has `overflow: auto`; axe's
                `scrollable-region-focusable` rule requires any
                scrollable region to be keyboard-focusable so users on
                screens with no interactive content (e.g. Pond) can
                still scroll with PgDn/arrows.
            Putting it on `<main>` directly keeps one tab stop for the
            content region; an inner wrapper was tried but broke the
            grid height cascade (visual regression) without gaining
            anything semantic.
          */}
            {/*
            <main> needs an explicit tabindex to satisfy WCAG 2.1.1
            (scrollable-region-focusable) and 2.4.1 (skip-link target).
            jsx-a11y's blanket ban on tabindex-on-landmarks is the wrong
            default for scrollable main elements; see crm.css for the
            focus-visible handling.
          */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <main className="main" id="main" tabIndex={0}>
              <React.Suspense fallback={<ScreenSkeleton />}>
                {screen === 'today' &&
                  (role === 'mgr' ? <ManagerToday /> : <Today sort={t.todaySort} />)}
                {screen === 'pipeline' && <Pipeline layout={t.pipeLayout} />}
                {screen === 'pond' && (role === 'mgr' ? <ManagerPond /> : <Pond />)}
                {screen === 'signals' && <Signals />}
                {screen === 'account' && <Account />}
                {screen === 'quote' && <Quote />}
                {screen === 'workflows' && <Workflows />}
              </React.Suspense>
            </main>
            <Peek />
            <CommandBar role={role} />
            <CommandPalette role={role} />
            <Tweaks
              open={tweaksOpen}
              state={t}
              set={setTweak}
              onClose={() => setTweaksOpen(false)}
            />
          </div>
        </FocusProvider>
      </LiveRegionProvider>
    </AppProvider>
  );
}
