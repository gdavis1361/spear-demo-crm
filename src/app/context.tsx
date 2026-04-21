import React from 'react';
import type { Role, Screen, NounRef } from '../lib/types';

export interface AppContextValue {
  screen: Screen;
  setScreen: (s: Screen) => void;
  role: Role;
  setRole: (r: Role) => void;
  navigate: (n: NounRef) => void;
  openPalette: () => void;
  registerPaletteOpener: (fn: () => void) => void;
}

const noop = () => {};

const AppContext = React.createContext<AppContextValue>({
  screen: 'today',
  setScreen: noop,
  role: 'rep',
  setRole: noop,
  navigate: noop,
  openPalette: noop,
  registerPaletteOpener: noop,
});

export interface AppProviderProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  role: Role;
  setRole: (r: Role) => void;
  children: React.ReactNode;
}

export function AppProvider({ screen, setScreen, role, setRole, children }: AppProviderProps) {
  const openerRef = React.useRef<() => void>(noop);

  const navigate = React.useCallback((n: NounRef) => {
    if (n.kind === 'account') setScreen('account');
    else if (n.kind === 'deal') setScreen('quote');
  }, [setScreen]);

  const openPalette = React.useCallback(() => {
    openerRef.current();
  }, []);

  const registerPaletteOpener = React.useCallback((fn: () => void) => {
    openerRef.current = fn;
  }, []);

  const value = React.useMemo<AppContextValue>(() => ({
    screen, setScreen, role, setRole, navigate, openPalette, registerPaletteOpener,
  }), [screen, setScreen, role, setRole, navigate, openPalette, registerPaletteOpener]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  return React.useContext(AppContext);
}
