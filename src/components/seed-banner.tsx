// SeedBanner — always-visible status bar when the app is running
// against a `?seed=<name>` scenario instead of the user's real DB.
//
// Two controls:
//   - Exit  → navigates to `/`, back to the user's real DB.
//   - Reset → arms a sessionStorage marker and reloads. On boot,
//             `consumePendingReset()` deletes the seed's IDB before any
//             connection opens, so the scenario replays from scratch.
//
// Deliberate UX choices:
//   - Persistent, non-dismissible. Cost of a user forgetting they're in
//     scenario mode is higher than the cost of a small permanent strip.
//   - Yellow/amber background so it reads as "notice" without being an
//     error. Pulls from the existing amber accent palette.
//   - No modal confirmation on Reset. Scenario data is fully regenerable;
//     confirmation adds friction without value.
//   - role="status" announces to screen readers on first render; aria-label
//     names the current scenario.

import React from 'react';
import { requestSeedReset } from '../seeds/activation';

const SEED_CHARSET = /^[a-z0-9][a-z0-9-]*$/;

function currentSeedName(): string | null {
  if (typeof location === 'undefined') return null;
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null || raw.length === 0) return null;
  if (!SEED_CHARSET.test(raw)) return null;
  return raw;
}

export function SeedBanner(): React.ReactElement | null {
  const seed = currentSeedName();
  if (seed === null) return null;

  const handleExit = (): void => {
    window.location.href = '/';
  };

  const handleReset = (): void => {
    requestSeedReset(seed);
    window.location.reload();
  };

  return (
    <div
      role="status"
      aria-label={`Scenario mode active: ${seed}`}
      className="seed-banner"
      data-seed={seed}
    >
      <span className="seed-banner__label">SCENARIO</span>
      <strong className="seed-banner__name">{seed}</strong>
      <span className="seed-banner__sep" aria-hidden="true">
        ·
      </span>
      <button type="button" className="seed-banner__btn" onClick={handleReset}>
        Reset
      </button>
      <button type="button" className="seed-banner__btn" onClick={handleExit}>
        Exit
      </button>
    </div>
  );
}
