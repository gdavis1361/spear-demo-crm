// Unit coverage for `use-dialog.ts`. The hook is also exercised end-to-end
// by tests/a11y-interactions.spec.ts (which runs against a real browser),
// but those don't count toward Vitest's line coverage. These tests focus
// on the parts that are easy to get wrong in isolation:
//   1. `focusableWithin`'s filter rules (visibility, tabindex=-1 exclusion)
//   2. The hook's effect sequencing around the `open` flag.
//
// We drive the hook via a minimal React render loop (no React Testing
// Library installed). This is enough to make the effects fire and for
// us to observe focus + DOM state.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { focusableWithin, useDialog } from './use-dialog';

describe('focusableWithin', () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    root.remove();
  });

  it('returns buttons + inputs in DOM order', () => {
    root.innerHTML = `
      <button id="a">A</button>
      <input id="b" />
      <a href="#" id="c">C</a>
    `;
    const got = focusableWithin(root).map((n) => n.id);
    expect(got).toEqual(['a', 'b', 'c']);
  });

  it('excludes elements with tabindex=-1 even if natively focusable', () => {
    // This is the bite that let DevPalette leak Tab: roving-tabindex
    // rolls options to tabindex=-1, but they're still <button>s. A trap
    // that includes them as "focusables" would cycle focus to an element
    // the browser won't visit on Tab, effectively escaping the dialog.
    root.innerHTML = `
      <button id="in" tabindex="0">in</button>
      <button id="out" tabindex="-1">out</button>
      <input id="also-out" tabindex="-1" />
    `;
    const got = focusableWithin(root).map((n) => n.id);
    expect(got).toEqual(['in']);
  });

  it('excludes disabled inputs and hidden inputs', () => {
    root.innerHTML = `
      <button id="ok">ok</button>
      <button id="disabled" disabled>disabled</button>
      <input id="hidden" type="hidden" />
      <input id="also-disabled" disabled />
    `;
    const got = focusableWithin(root).map((n) => n.id);
    expect(got).toEqual(['ok']);
  });
});

describe('useDialog', () => {
  let container: HTMLDivElement;
  let reactRoot: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    reactRoot = createRoot(container);
  });
  afterEach(() => {
    act(() => {
      reactRoot.unmount();
    });
    container.remove();
  });

  interface HarnessProps {
    readonly open: boolean;
    readonly onClose: () => void;
  }

  function Harness({ open, onClose }: HarnessProps): React.ReactElement {
    const { containerRef } = useDialog({ open, onClose });
    return React.createElement(
      'div',
      { ref: containerRef, 'data-testid': 'dialog' },
      React.createElement('button', { 'data-testid': 'first' }, 'first'),
      React.createElement('button', { 'data-testid': 'second' }, 'second'),
      React.createElement('button', { 'data-testid': 'last' }, 'last')
    );
  }

  it('does not focus into the dialog while closed', () => {
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    act(() => {
      reactRoot.render(React.createElement(Harness, { open: false, onClose: () => undefined }));
    });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('Escape inside an open dialog calls onClose', () => {
    let closed = false;
    act(() => {
      reactRoot.render(
        React.createElement(Harness, {
          open: true,
          onClose: () => {
            closed = true;
          },
        })
      );
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(true);
  });

  it('Escape while closed is a no-op (listener is detached)', () => {
    let closed = false;
    act(() => {
      reactRoot.render(
        React.createElement(Harness, {
          open: false,
          onClose: () => {
            closed = true;
          },
        })
      );
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(false);
  });

  it('remembers the activeElement on open and restores it on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    act(() => {
      reactRoot.render(React.createElement(Harness, { open: true, onClose: () => undefined }));
    });
    // useDialog's microtask-focus runs async; flush it.
    return Promise.resolve().then(() => {
      // While open, focus is inside the dialog.
      const dialog = container.querySelector('[data-testid="dialog"]') as HTMLElement;
      expect(dialog.contains(document.activeElement)).toBe(true);
      act(() => {
        reactRoot.render(React.createElement(Harness, { open: false, onClose: () => undefined }));
      });
      // On close, focus returns to the remembered trigger.
      expect(document.activeElement).toBe(trigger);
      trigger.remove();
    });
  });

  it('does not throw when restoring focus to a now-detached element', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    act(() => {
      reactRoot.render(React.createElement(Harness, { open: true, onClose: () => undefined }));
    });
    // Detach the trigger while the dialog is open — simulates the real-world
    // case where opening the dialog unmounts its originating Peek.
    trigger.remove();
    expect(() => {
      act(() => {
        reactRoot.render(React.createElement(Harness, { open: false, onClose: () => undefined }));
      });
    }).not.toThrow();
  });
});
