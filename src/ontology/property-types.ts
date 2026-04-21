// Property types — the typed building blocks the ontology recognizes.
//
// Foundry calls these "Base Types." Each entry tells the ontology layer
// how to render, sort, search, and compare values of that type. The UI
// looks the kind up here instead of branching on `typeof` everywhere.

import type { Money, Instant, IanaZone, EmailAddress, PhoneNumber } from '../lib/types';

export type PropertyKind =
  | 'string'
  | 'enum'
  | 'integer'
  | 'money'
  | 'instant'
  | 'zoned'
  | 'email'
  | 'phone'
  | 'document'
  | 'branded_id'
  | 'reference'        // single object reference
  | 'reference_list';  // array of references

export interface PropertyDescriptor {
  readonly kind: PropertyKind;
  /** Human label for forms + columns. */
  readonly label: string;
  /** Marking applied to this property. Defaults are conservative. */
  readonly marking: import('./marking').Marking;
  /** Whether the property is searchable in typeahead. */
  readonly searchable?: boolean;
  /** Whether the property is sortable in tables. */
  readonly sortable?: boolean;
  /** Optional enum values when `kind: 'enum'`. */
  readonly values?: readonly string[];
  /** When `kind: 'reference' | 'reference_list'`, the target object kind. */
  readonly targetObject?: string;
}

// Convenience builders — typed on the value side via TS inference.
export const stringProp   = (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'string', ...opts });
export const enumProp     = (opts: Omit<PropertyDescriptor, 'kind'> & { values: readonly string[] }): PropertyDescriptor =>
  ({ kind: 'enum', ...opts });
export const moneyProp    = (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'money', ...opts });
export const instantProp  = (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'instant', ...opts });
export const integerProp  = (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'integer', ...opts });
export const emailProp    = (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'email', ...opts });
export const phoneProp    = (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'phone', ...opts });
export const documentProp = (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'document', ...opts });
export const brandedIdProp= (opts: Omit<PropertyDescriptor, 'kind'>): PropertyDescriptor =>
  ({ kind: 'branded_id', ...opts });

// Re-export primitive value types so ontology consumers have a single
// import site for "the language the schema speaks."
export type { Money, Instant, IanaZone, EmailAddress, PhoneNumber };
