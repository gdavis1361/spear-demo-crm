// Projects — workspace-level scoping. Every object can be tagged with one
// or more `projects`; a viewer's MarkingContext lists the projects they
// belong to; the projection layer drops rows that don't intersect.
//
// Spear pods (DOD-SE, DOD-NW, Corp-EN, Corp-WS, Indiv) are projects.

export type ProjectId = string & { readonly __brand: 'ProjectId' };

export const SPEAR_PROJECTS = {
  'DOD-SE':  'pod_dod_se'  as ProjectId,
  'DOD-NW':  'pod_dod_nw'  as ProjectId,
  'Corp-EN': 'pod_corp_en' as ProjectId,
  'Corp-WS': 'pod_corp_ws' as ProjectId,
  'Indiv':   'pod_indiv'   as ProjectId,
} as const;

export const ALL_PROJECT_IDS: readonly ProjectId[] =
  Object.values(SPEAR_PROJECTS) as readonly ProjectId[];

export function project(id: string): ProjectId {
  return id as ProjectId;
}

export interface Projected {
  readonly projects: readonly ProjectId[];
}

/**
 * True iff the viewer's project membership intersects the row's. Rows
 * with no project tag are visible to everyone (treated as "shared").
 */
export function intersects(rowProjects: readonly ProjectId[], viewerProjects: readonly string[]): boolean {
  if (rowProjects.length === 0) return true;
  return rowProjects.some((p) => viewerProjects.includes(p));
}

/** Convenience: filter a list of rows by project intersection. */
export function filterByProjects<T extends Projected>(
  rows: readonly T[],
  viewerProjects: readonly string[]
): readonly T[] {
  return rows.filter((r) => intersects(r.projects, viewerProjects));
}
