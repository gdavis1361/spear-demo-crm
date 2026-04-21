import { describe, it, expect } from 'vitest';
import { intersects, filterByProjects, project, SPEAR_PROJECTS } from './projects';

describe('projects', () => {
  it('rows with no project tag are visible to everyone', () => {
    expect(intersects([], ['anything'])).toBe(true);
  });

  it('intersection requires at least one shared project', () => {
    const dse = SPEAR_PROJECTS['DOD-SE'];
    const dnw = SPEAR_PROJECTS['DOD-NW'];
    expect(intersects([dse], [dse])).toBe(true);
    expect(intersects([dse], [dnw])).toBe(false);
    expect(intersects([dse, dnw], [dnw])).toBe(true);
  });

  it('filterByProjects drops rows with no overlap', () => {
    const rows = [
      { id: 'a', projects: [SPEAR_PROJECTS['DOD-SE']] },
      { id: 'b', projects: [SPEAR_PROJECTS['DOD-NW']] },
      { id: 'c', projects: [] }, // shared
    ];
    const out = filterByProjects(rows, [SPEAR_PROJECTS['DOD-SE']]);
    expect(out.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('project() brands a string', () => {
    const p = project('pod_custom');
    expect(p).toBe('pod_custom');
  });
});
