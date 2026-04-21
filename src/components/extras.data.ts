// Static fixture data for the manager-role screens.
//
// Separated from `extras.tsx` so that file exports only components.
// React Fast Refresh only treats a module as a refreshable component
// file when every export is a component; mixing data breaks the
// boundary and triggers a full reload on every edit.

export interface ManagerRep {
  rep: string;
  pod: string;
  status: 'in-focus' | 'queue' | 'at-risk';
  state: string;
  now: string;
  promise: string;
  risk: 'low' | 'high';
}

export const MANAGER_TODAY: ManagerRep[] = [
  {
    rep: 'M. Hall',
    pod: 'DOD-SE',
    status: 'in-focus',
    state: 'On focus call · 14 min',
    now: 'SSgt. Alvarez callback — started 08:42',
    promise: 'BAFO to MELS · due tomorrow 17:00 ET',
    risk: 'low',
  },
  {
    rep: 'K. Okonkwo',
    pod: 'DOD-SE',
    status: 'queue',
    state: 'Queue fresh · 12 deals',
    now: 'About to call CW3 Park re: Alaska gap',
    promise: '3 open · 0 overdue',
    risk: 'low',
  },
  {
    rep: 'S. Brennan',
    pod: 'Corp-EN',
    status: 'at-risk',
    state: 'No activity · 2h 14m',
    now: '—',
    promise: 'Brightwell follow-up · overdue 1d',
    risk: 'high',
  },
  {
    rep: 'D. Laurent',
    pod: 'DOD-NW',
    status: 'queue',
    state: 'Queue fresh · 9 deals',
    now: 'Finishing Vargas quote · OCONUS',
    promise: '2 open · 0 overdue',
    risk: 'low',
  },
  {
    rep: 'R. Hemming',
    pod: 'Indiv',
    status: 'at-risk',
    state: 'Queue stale · 48 deals',
    now: "Hasn't picked up today's queue",
    promise: '8 open · 2 overdue',
    risk: 'high',
  },
  {
    rep: 'J. Pellegrini',
    pod: 'Corp-WS',
    status: 'queue',
    state: 'Queue fresh · 6 deals',
    now: 'Intro call w/ Nordlight Capital',
    promise: '1 open · 0 overdue',
    risk: 'low',
  },
];
