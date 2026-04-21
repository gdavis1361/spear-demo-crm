// DevPalette — scenario switcher, opened with Cmd+Shift+S (Ctrl+Shift+S on
// non-mac). Lists every registered seed scenario + an "Exit scenario"
// option and navigates on selection.
//
// Shortcut choice: Cmd+K is the business CommandPalette; `?` conflicts with
// text-input help gestures; `S` for "scenario" reads cleanly and neither
// Chrome nor the OS grabs Cmd+Shift+S.
//
// Bundle: the seeds registry (Zod + faker + every builder) is pulled in
// lazily on first open. Initial render imports only this component + its
// styles, so the cost to the base bundle is ~1 KB.
//
// Scope: always available. This is a demo CRM; scenario switching is part
// of the shipped product. For a prod app this would gate on
// `import.meta.env.DEV`.

import React from 'react';
import { useDialog } from '../lib/use-dialog';

interface ScenarioInfo {
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
}

const SEED_CHARSET = /^[a-z0-9][a-z0-9-]*$/;

function currentSeedName(): string | null {
  if (typeof location === 'undefined') return null;
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw.length === 0) return null;
  if (!SEED_CHARSET.test(raw)) return null;
  return raw;
}

export function DevPalette(): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [scenarios, setScenarios] = React.useState<readonly ScenarioInfo[] | null>(null);
  const [selIdx, setSelIdx] = React.useState(0);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const current = currentSeedName();

  const handleClose = React.useCallback(() => setOpen(false), []);
  // useDialog handles Escape + focus trap + focus return. Our manual
  // keydown listener below only binds the *toggle* (Cmd+Shift+S).
  const { containerRef } = useDialog({ open, onClose: handleClose });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setOpen((o) => !o);
        setSelIdx(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lazy-load the registry on first open. Subsequent opens reuse state.
  React.useEffect(() => {
    if (!open || scenarios !== null || loadError !== null) return;
    let cancelled = false;
    void import('../seeds')
      .then((m) => {
        if (cancelled) return;
        const list = m.registry.describeAll().map((d) => ({
          name: d.name,
          description: d.description,
          tags: d.tags,
        }));
        setScenarios(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scenarios, loadError]);

  React.useEffect(() => {
    if (!open || listRef.current === null) return;
    const first = listRef.current.querySelector<HTMLElement>('[data-devp-item]');
    first?.focus();
  }, [open, scenarios]);

  // Full list = [Exit] + scenarios. Index 0 is always "Exit scenario".
  const items = React.useMemo(() => {
    const s = scenarios ?? [];
    return [
      { kind: 'exit' as const, label: 'Exit scenario (real DB)', href: '/' },
      ...s.map((sc) => ({
        kind: 'scenario' as const,
        label: sc.name,
        description: sc.description,
        tags: sc.tags,
        href: `/?seed=${sc.name}`,
        isCurrent: current === sc.name,
      })),
    ];
  }, [scenarios, current]);

  const navigate = (href: string): void => {
    window.location.href = href;
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[selIdx];
      if (it) navigate(it.href);
    }
  };

  if (!open) return null;

  return (
    <div
      className="devp-overlay"
      onClick={() => setOpen(false)}
      role="presentation"
      data-testid="dev-palette-overlay"
    >
      <div
        ref={containerRef}
        className="devp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="devp-title"
        // Fallback focus target for useDialog when the scenario list is
        // still loading (no focusable descendants yet). Once scenarios
        // arrive, the list effect below moves focus to the first option.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="devp-head">
          <h2 id="devp-title" className="devp-title">
            Scenario switcher
          </h2>
          <kbd className="devp-esc">esc</kbd>
        </div>
        {loadError !== null && (
          <div className="devp-error" role="alert">
            Failed to load scenarios: {loadError}
          </div>
        )}
        {scenarios === null && loadError === null && (
          <div className="devp-loading" role="status" aria-live="polite">
            Loading scenarios…
          </div>
        )}
        <ul ref={listRef} className="devp-list" role="listbox" aria-label="Scenarios">
          {items.map((it, i) => {
            const selected = i === selIdx;
            const isCurrent = it.kind === 'scenario' && it.isCurrent;
            return (
              <li key={it.label} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-devp-item
                  data-current={isCurrent ? 'true' : undefined}
                  className={`devp-item${selected ? ' on' : ''}${isCurrent ? ' current' : ''}`}
                  onMouseEnter={() => setSelIdx(i)}
                  onFocus={() => setSelIdx(i)}
                  onClick={() => navigate(it.href)}
                >
                  <span className="devp-item__name">
                    {it.label}
                    {isCurrent && (
                      <span className="devp-badge" aria-label="current scenario">
                        CURRENT
                      </span>
                    )}
                  </span>
                  {it.kind === 'scenario' && (
                    <span className="devp-item__desc">{it.description}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="devp-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> activate
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
