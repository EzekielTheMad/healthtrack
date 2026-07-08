@AGENTS.md

# Dev commands

- `npm run dev` — dev server at http://localhost:3000 (state lands in `./data`; override with `DATA_DIR`)
- `npm test` — vitest suite
- `npm run lint` — eslint
- `npm run build` — production build (standalone output)

# Test conventions

- Default vitest environment is `jsdom`. Tests that touch the SQLite database (or any Node-only API) must start with the pragma comment `// @vitest-environment node`.
- Repository/authz tests run against a temp-file SQLite database — see existing `*.test.ts` files for the pattern.
- Use conventional commit messages (`feat:`, `fix:`, `chore:`, ...).
