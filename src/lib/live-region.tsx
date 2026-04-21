// App-wide `aria-live` announcer.
//
// One singleton `<LiveRegion />` mounted at the app root. Components call
// `announce("Moved Alvarez to Qualify")` and the message lands in the
// polite region; screen readers pick it up without any focus shift or
// DOM thrash.
//
// WCAG 4.1.3 (Status Messages). Deliberately separate from `role="alert"`
// — alerts interrupt the user's current speech, polite waits for a pause.
// We expose a single `polite` surface here because every current caller
// is status-class ("move succeeded", "dismissed signal"). An `announce`
// overload for assertive can be added later if we ever have a true
// "operation blocked" announcement.

import React from 'react';

type Announcer = (message: string) => void;

const noopAnnouncer: Announcer = () => undefined;
const AnnouncerContext = React.createContext<Announcer>(noopAnnouncer);

export function useAnnounce(): Announcer {
  return React.useContext(AnnouncerContext);
}

/**
 * Render once near the top of the app. Owns the visually-hidden live
 * region and exposes `useAnnounce()` to descendants.
 *
 * Implementation detail: we keep *two* text nodes and alternate between
 * them each call. Some screen readers de-duplicate consecutive identical
 * strings in a live region; rotating nodes sidesteps that for repeat
 * announcements ("Moved Alvarez to Qualify" twice in a row still reads
 * twice).
 */
export function LiveRegionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [primary, setPrimary] = React.useState('');
  const [secondary, setSecondary] = React.useState('');
  const flipRef = React.useRef(false);

  const announce = React.useCallback<Announcer>((message) => {
    if (!message) return;
    if (flipRef.current) {
      setSecondary('');
      setPrimary(message);
    } else {
      setPrimary('');
      setSecondary(message);
    }
    flipRef.current = !flipRef.current;
  }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {primary}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {secondary}
      </div>
    </AnnouncerContext.Provider>
  );
}
