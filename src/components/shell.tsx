import React from 'react';
import {
  Target,
  LayoutGrid,
  Activity,
  Radio,
  Building2,
  FileText,
  Waypoints,
  LifeBuoy,
  Settings,
  Search,
} from 'lucide-react';
import type { Screen, Role, Tweaks as TweaksState } from '../lib/types';
import { useOutboxHealth } from '../app/use-outbox-health';

// Spear CRM — shell: topbar, rail, tweaks panel

const TITLES: Record<Screen, [string, string]> = {
  today: ['Sales', 'Today'],
  pipeline: ['Sales', 'Pipeline'],
  pond: ['Sales', 'Pond health'],
  signals: ['Intel', 'Signals'],
  account: ['Accounts', 'MELS Corporate Mobility'],
  quote: ['Sales', 'New quote · LD-40218'],
  workflows: ['Automation', 'Workflows'],
};

const ROLE_ORDER: Role[] = ['rep', 'ae', 'mgr'];
const ROLE_LABEL: Record<Role, string> = {
  rep: 'Inside rep · PCS',
  ae: 'AE · Corporate',
  mgr: 'Manager',
};

export interface TopbarProps {
  screen: Screen;
  role: Role;
  setRole: (r: Role) => void;
  ground: 'graphite' | 'paper';
}

export function Topbar({ screen, role, setRole, ground }: TopbarProps) {
  const logo =
    ground === 'paper' ? '/assets/logo-spear-mark-light.svg' : '/assets/logo-spear-mark-dark.svg';
  const [a, b] = TITLES[screen];
  const cycleRole = () => setRole(ROLE_ORDER[(ROLE_ORDER.indexOf(role) + 1) % ROLE_ORDER.length]);
  return (
    <header className="topbar">
      <div className="brand">
        <img src={logo} alt="Spear" width={28} height={28} />
      </div>
      <div className="crumb">
        <span>{a}</span>
        <span className="sep">/</span>
        <strong>{b}</strong>
        <span className="sep">·</span>
        <button type="button" className="role-chip" title="Switch role" onClick={cycleRole}>
          {ROLE_LABEL[role]}
        </button>
      </div>
      <div className="search">
        <Search className="ic-sm" aria-hidden="true" />
        <span>Find a lead, account, base, or move · try "Campbell", "MV-30418", or "Alvarez"</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="topbar-right">
        <OutboxStatusBadge />
        <span>
          {role === 'rep' ? '18 in queue' : role === 'ae' ? '6 accounts' : '94 deals · 6 reps'}
        </span>
        <span className="who">
          <span className="who-ini">MH</span> M. Hall
        </span>
      </div>
    </header>
  );
}

// VX8: live outbox-health readout in the topbar. Replaces a hardcoded
// "Queue fresh · last sync 0:14s" placeholder with a real indicator
// driven by the durable mutation queue. The `aria-live="polite"`
// region lets screen readers hear "3 changes waiting to sync" without
// stealing focus. Color shifts from olive (idle) to amber (syncing)
// to accent (degraded) for a glance-level signal.
function OutboxStatusBadge(): React.ReactElement {
  const health = useOutboxHealth();
  let label: string;
  let dotClass: string;
  if (health.status === 'idle') {
    label = 'Queue fresh';
    dotClass = 'dot';
  } else if (health.status === 'syncing') {
    const ageSecs = Math.max(1, Math.round(health.oldestPendingAgeMs / 1000));
    label = `Syncing · ${health.pending} waiting · ${ageSecs}s`;
    dotClass = 'dot dot-syncing';
  } else {
    const ageSecs = Math.max(1, Math.round(health.oldestPendingAgeMs / 1000));
    const bits: string[] = [];
    if (health.pending > 0) bits.push(`${health.pending} stuck · ${ageSecs}s`);
    if (health.permanent > 0) bits.push(`${health.permanent} failed`);
    label = `Sync degraded · ${bits.join(' · ')}`;
    dotClass = 'dot dot-degraded';
  }
  return (
    <span data-testid="outbox-status" role="status" aria-live="polite" aria-atomic="true">
      <span className={dotClass}>●</span> {label}
    </span>
  );
}

type RailItem = {
  k: Screen;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  lbl: string;
};

const RAIL_ITEMS: RailItem[] = [
  { k: 'today', Icon: Target, lbl: 'Today' },
  { k: 'pipeline', Icon: LayoutGrid, lbl: 'Pipeline' },
  { k: 'pond', Icon: Activity, lbl: 'Pond health' },
  { k: 'signals', Icon: Radio, lbl: 'Signals' },
  { k: 'account', Icon: Building2, lbl: 'Accounts' },
  { k: 'quote', Icon: FileText, lbl: 'Quotes' },
  { k: 'workflows', Icon: Waypoints, lbl: 'Workflows' },
];

export interface RailProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  onOpenTweaks?: () => void;
}

export function Rail({ screen, setScreen, onOpenTweaks }: RailProps) {
  return (
    <nav className="rail" aria-label="Primary">
      {RAIL_ITEMS.map(({ k, Icon, lbl }) => (
        <button
          key={k}
          type="button"
          data-label={lbl}
          aria-label={lbl}
          aria-current={screen === k ? 'page' : undefined}
          className={screen === k ? 'active' : ''}
          onClick={() => setScreen(k)}
        >
          <Icon className="ic" aria-hidden="true" />
        </button>
      ))}
      <div className="spacer" />
      <button type="button" data-label="Help" aria-label="Help">
        <LifeBuoy className="ic" aria-hidden="true" />
      </button>
      <button type="button" data-label="Settings" aria-label="Settings" onClick={onOpenTweaks}>
        <Settings className="ic" aria-hidden="true" />
      </button>
    </nav>
  );
}

export interface TweaksProps {
  open: boolean;
  state: TweaksState;
  set: (patch: Partial<TweaksState>) => void;
  onClose: () => void;
}

export function Tweaks({ open, state, set, onClose }: TweaksProps) {
  if (!open) return null;
  return (
    <div className="tweaks" role="dialog" aria-label="Design tweaks">
      <div className="tweaks-head">
        <span>Tweaks</span>
        <span className="c-muted">design options</span>
        <button type="button" className="tweaks-close" onClick={onClose} aria-label="Close tweaks">
          ×
        </button>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <div className="lbl">Ground</div>
          <div className="seg two">
            <button
              type="button"
              className={state.ground === 'graphite' ? 'on' : ''}
              onClick={() => set({ ground: 'graphite' })}
            >
              Graphite
            </button>
            <button
              type="button"
              className={state.ground === 'paper' ? 'on' : ''}
              onClick={() => set({ ground: 'paper' })}
            >
              Paper
            </button>
          </div>
        </div>
        <div className="tweak-row">
          <div className="lbl">Pipeline layout</div>
          <div className="seg">
            <button
              type="button"
              className={state.pipeLayout === 'kanban' ? 'on' : ''}
              onClick={() => set({ pipeLayout: 'kanban' })}
            >
              Kanban
            </button>
            <button
              type="button"
              className={state.pipeLayout === 'timeline' ? 'on' : ''}
              onClick={() => set({ pipeLayout: 'timeline' })}
            >
              Timeline
            </button>
            <button
              type="button"
              className={state.pipeLayout === 'table' ? 'on' : ''}
              onClick={() => set({ pipeLayout: 'table' })}
            >
              Table
            </button>
          </div>
        </div>
        <div className="tweak-row">
          <div className="lbl">Density</div>
          <div className="seg two">
            <button
              type="button"
              className={state.density === 'comfortable' ? 'on' : ''}
              onClick={() => set({ density: 'comfortable' })}
            >
              Comfortable
            </button>
            <button
              type="button"
              className={state.density === 'compact' ? 'on' : ''}
              onClick={() => set({ density: 'compact' })}
            >
              Compact
            </button>
          </div>
        </div>
        <div className="tweak-row">
          <div className="lbl">Today sort</div>
          <div className="seg two">
            <button
              type="button"
              className={state.todaySort === 'priority' ? 'on' : ''}
              onClick={() => set({ todaySort: 'priority' })}
            >
              By priority
            </button>
            <button
              type="button"
              className={state.todaySort === 'stage' ? 'on' : ''}
              onClick={() => set({ todaySort: 'stage' })}
            >
              By stage
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
