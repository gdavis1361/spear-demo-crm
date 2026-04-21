// Conventional Commits — see https://www.conventionalcommits.org/
// Enforced via the `commit-msg` git hook (Husky) + a CI lint job.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 120],
    // Spear-specific scopes — keep this list aligned with src/ subdirectories.
    'scope-enum': [
      2,
      'always',
      [
        'ui',
        'screens',
        'lib',
        'api',
        'app',
        'domain',
        'ontology',
        'styles',
        'tests',
        'docs',
        'ci',
        'deps',
        'release',
        '*', // monorepo-wide / cross-cutting
      ],
    ],
  },
};
