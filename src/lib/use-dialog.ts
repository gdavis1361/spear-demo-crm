// Dialog primitive — focus trap + focus return + Escape.
//
// The three things every `aria-modal` dialog in this app needs, packaged
// once so CommandPalette, DevPalette, HonestDraft, Tweaks, and PeekPanel
// don't each grow their own slightly-different implementation.
//
// Contract (WAI-ARIA APG · "Dialog (Modal)"):
//   - When `open` becomes true:
//       • remember the element that currently has focus
//       • move focus into the dialog container (first focusable, or the
//         element pointed to by `initialFocus` if provided)
//   - While open:
//       • Tab cycles forward within the dialog's focusable set
//       • Shift+Tab cycles backward
//       • Escape calls `onClose` (unless `trapEscape: false`)
//       • focus can't escape the container via keyboard
//   - When `open` becomes false:
//       • focus returns to the remembered element
//
// Deliberate non-goals (out of scope for this hook):
//   - Rendering the aria-modal/aria-labelledby wiring — that stays on the
//     consuming component where the labelling heading/title lives.
//   - Click-outside-to-close — consumers already handle that via overlay
//     onClick; not every dialog wants it.

import React from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

/**
 * Return the focusable descendants of `el` in DOM order, matching the
 * browser's actual Tab sequence. Exported for direct unit testing of
 * the filter rules (visibility, tabindex=-1 exclusion) — the focus
 * trap's correctness depends on this matching native Tab behavior.
 */
export function focusableWithin(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((n) => {
    // Element must be visible to be a real tab stop. `offsetParent === null`
    // catches `display:none` ancestors; the extra check handles `position:fixed`
    // elements which have `offsetParent === null` but are still visible.
    if (n.offsetParent === null && getComputedStyle(n).position !== 'fixed') return false;
    // Match the browser's actual Tab order: tabindex=-1 is programmatically
    // focusable but not in the Tab sequence. A focus trap must mirror that
    // sequence, otherwise pressing Tab on the last "real" tabstop falls
    // through to the browser's default handling and escapes the dialog.
    // This bites hardest in listbox/roving-tabindex patterns (DevPalette's
    // scenario list: only the selected option has tabindex=0, the rest are
    // tabindex=-1).
    if (n.tabIndex < 0) return false;
    return true;
  });
}

export interface UseDialogOptions {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Where to land focus when the dialog opens. If unset, the first focusable
   * descendant of the container is used; if the container has none, the
   * container itself (so the reader announces the dialog's label).
   */
  readonly initialFocus?: React.RefObject<HTMLElement>;
  /**
   * Set to `false` when the consumer handles Escape itself (e.g. the palette
   * already toggles on Cmd+K and treats Esc as a no-op when closed).
   * Default: `true`.
   */
  readonly trapEscape?: boolean;
}

export interface UseDialogResult {
  readonly containerRef: React.RefObject<HTMLDivElement>;
}

export function useDialog(opts: UseDialogOptions): UseDialogResult {
  const { open, onClose, initialFocus, trapEscape = true } = opts;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  // Snapshot the outside-focus element the moment the dialog opens so we can
  // restore it on close. Runs as a layout effect so we capture the state
  // before React's commit moves focus anywhere.
  React.useLayoutEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  // Move focus into the dialog on open. Run after paint so refs are wired;
  // `queueMicrotask` avoids fighting a parent component that also wants to
  // set initial focus in the same commit.
  React.useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    queueMicrotask(() => {
      const target = initialFocus?.current ?? focusableWithin(container)[0] ?? container;
      target.focus();
    });
  }, [open, initialFocus]);

  // Focus trap + Escape. Window-level listener so we catch events wherever
  // focus currently is (including the document body if the dialog has no
  // focusable descendants yet).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      const container = containerRef.current;
      if (!container) return;

      if (e.key === 'Escape' && trapEscape) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusables = focusableWithin(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // If focus is currently outside the container, pull it back in.
      if (active === null || !container.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      // If focus is on the container itself (not one of the real focusable
      // descendants — this is the fallback state the initial-focus effect
      // uses while async content hydrates, e.g. DevPalette before scenarios
      // load), Tab should enter the content. Without this branch, Tab falls
      // through to the browser's default and escapes the dialog because
      // the container has tabIndex=-1 but is not in the focusable list.
      if (active === container) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, trapEscape]);

  // Restore focus on close. Kept separate from the open-effect so that a
  // dialog that unmounts cleanly (rather than toggling `open`) still
  // restores, via the effect's cleanup path on the last open===true run.
  React.useEffect(() => {
    if (open) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && typeof target.focus === 'function') {
      // Guard against the origin being detached from the DOM (e.g. the
      // triggering button was in a now-closed peek). `isConnected` is the
      // cheap check; `.focus()` on a detached node silently no-ops anyway
      // but this keeps the stack clean for devtools.
      if (target.isConnected) target.focus();
    }
  }, [open]);

  return { containerRef };
}
