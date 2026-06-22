# nextdog

Zero-config local dev observability for Next.js/Nuxt/SvelteKit. Free OSS, published to npm. Goal: adoption.

## Commands
- Install: `pnpm install`
- Build all: `pnpm build` (Turbo orchestrates)
- Test all: `pnpm test`
- Single package: `pnpm --filter @nextdog/core test`
- Adapter tests import core's dist/: run `pnpm build` first (or `pnpm turbo test --filter=<pkg>`)

## Structure
- `packages/core` — shared engine; `packages/next|nuxt|sveltekit|node` — framework adapters; `packages/ui` — overlay UI
- Publish order (publish.yml): ui → core → node → next → nuxt → sveltekit (deps before dependents). `@nextdog/mcp` is intentionally NOT published yet (#40). A drift guard in publish.yml fails the release if a publishable package is missing from the publish list.
- Architecture & roadmap docs: `docs/architecture.md`, `docs/roadmap.md`

## Conventions
- TypeScript strict; no new runtime dependencies without strong justification (this ships inside users' dev servers — weight matters)
- Zero-config is the product: any feature requiring a config file needs a parked question first
- Every adapter change: validate against that package's own test suite (no dedicated example apps in this repo)
- Releases: GitHub release triggers publish.yml (version bump + npm publish in dependency order) — never `npm publish` manually

## Workflow
- Branch + PR always; worktrees at `../nextdog-worktrees/<branch>/`
- Commits: plain messages, no co-author lines
