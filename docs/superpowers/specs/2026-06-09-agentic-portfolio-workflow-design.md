# Agentic Portfolio Workflow — Design

**Date:** 2026-06-09
**Status:** Approved pending final review
**Scope:** Operating system for three side projects: nextdog (this repo), codetest.dev, ski-this-weekend

## 1. Context & Goals

Christopher runs three side projects on nights & weekends (~5-10 hrs/wk, bursty once stable) alongside a startup day job. Goals:

- Get all three products deployed and self-sustaining at near-zero cost
- **nextdog** (free OSS): launch first — closest to user-ready; goal is adoption
- **codetest.dev** (revenue, Stripe wired): deploy, build the playback feature, reach 1,000 customers via direct outreach + Google Ads
- **ski-this-weekend** (ad/traffic play): deploy and idle until ski season (~October)

The bottleneck is not coding — all three codebases are mature. It is operations: shipping, feedback loops, testing discipline, and distribution, run asynchronously around a day job.

**Decision:** No external framework (BMAD, Spec Kit, OpenSpec rejected — greenfield/team-oriented, overlapping the already-installed superpowers pipeline). Instead, a lightweight custom system built on native Claude Code primitives: an HQ orchestrator repo, six ritual skills, a subagent staff, GitHub Issues as the work hub, and Routines for scheduled work.

## 2. Trust Model

**Agents propose; Christopher approves.** Concretely:

- All agent output lands as a GitHub PR or issue. Never an unreviewed push to main.
- Christopher is the only merger. Vercel deploys only merged main.
- Nothing outbound (emails, posts, comments, ads) is ever sent/published by an agent — agents draft, Christopher publishes from his own accounts.
- Issues touching billing, auth, or user data are labeled `needs-human` and never auto-dispatched.
- The Linear workspace connected to Claude is his employer's — agents never touch it. GitHub Issues only.

## 3. HQ — Structure

A new git repo at `~/Documents/hq`:

```
hq/
├── CLAUDE.md                  # Orchestrator brain: portfolio table, constraints,
│                              #   dispatch rules, constitution, playbook pointers (~1 page)
├── .claude/
│   ├── settings.json          # additionalDirectories: ../nextdog, ../codetest.dev,
│   │                          #   ../ski-this-weekend
│   ├── skills/                # standup/ triage/ ship/ pm/ growth/ design-review/
│   │                          #   launch-check/
│   └── agents/                # dev-engineer, qa-engineer, architect,
│                              #   support-triager, growth-strategist
├── playbooks/                 # launch-checklist.md, design-principles.md,
│                              #   outreach-templates.md, release-checklist.md
├── memos/                     # weekly /pm decision memos (the paper trail)
└── metrics/                   # weekly digests from routines
```

HQ is the single cockpit: Christopher works from HQ sessions; in-repo sessions remain allowed (tight UI iteration loops) but are the exception.

## 4. Constitution (inherited by every agent)

1. **Self-sustaining by default.** Products must run themselves: <$20/mo per product, zero recurring human chores. Any design needing weekly human attention is wrong. Every new dependency states its monthly cost and answers "what breaks if nobody touches this for a month?"
2. **HQ orchestrates, never edits product code directly.** Coding work is dispatched to subagents running in the product repo.
3. **Every dispatch prompt begins:** "Read `<repo>/CLAUDE.md` first and follow its conventions."
4. **Worktree per work item.** Every dispatched piece of work gets its own git worktree (`<repo>-worktrees/<branch>/`). Main checkouts stay clean and runnable. PR branch ↔ worktree, 1:1.
5. **Ambiguous or strategic calls are parked as questions for Christopher**, never guessed.
6. **Day-job discretion.** Public-facing activity stays low-key; no build-in-public cadence.

## 5. Dispatch Model

Three lanes:

- **Interactive** — Christopher in an HQ session: `/standup` proposes the session plan; on approval, subagents fan out into product-repo worktrees; Agent View (`claude agents`) monitors when several run at once.
- **Background** — long jobs (refactors, suite-wide triage) detach; the HQ conversation stays free.
- **Scheduled (Routines)** — Anthropic-cloud sessions run while he's at work: nightly feedback triage, weekly PM/growth digest prep. Output lands as labeled issues, PRs, and files in `metrics/`. GitHub Actions is used only for CI (the merge gate), not for agent scheduling.

**Worktree pruning:** `/ship` closes with a sweep across all three repos — merged-branch worktrees removed immediately; worktrees idle 14+ days flagged "abandon or revive?" for Christopher's call. The nightly routine includes a worktree census in its digest.

**Session cadence:** weeknights open with `/standup`, close with `/ship`. Weekend block: feature work via the superpowers pipeline. `/pm` and `/growth` weekly (drafts prepared by routines; decisions by Christopher). Mobile/remote: PRs and Vercel preview URLs reviewable from claude.ai/code or phone during day-job downtime.

## 6. Skill Roster (rituals, in `hq/.claude/skills/`)

| Skill | Cadence | Does |
|---|---|---|
| `/standup` | Each session open | Reads issues, CI state, in-flight worktrees across repos; briefs; proposes the session's dispatches |
| `/triage` | Nightly (routine) + on demand | Iterates feedback sources → dedupe → label (`bug`/`feedback`/`growth`/`needs-human`) → severity → `agent-ok` where safe |
| `/ship` | Each session close | PR review-and-merge queue across repos; then worktree pruning sweep |
| `/pm` | Weekly | Pulls labeled issues + Stripe + analytics; RICE-lite scoring vs. the goal; one-page build/kill/defer memo to `memos/`; pre-launch mode: launch-blockers outrank everything |
| `/growth` | Weekly | Reviews routine-prepared digest; presents outreach drafts, ad copy, community post drafts for approval |
| `/design-review` | Before launches; after UI-heavy PRs | Walks key flows with Playwright screenshots; judges against installed design skills + `playbooks/design-principles.md`; files findings as issues |
| `/launch-check` | Pre-launch, per product | Audits gap-to-launch vs. `playbooks/launch-checklist.md`; files `launch-blocker` issues |

Knowledge skills already installed and leveraged (not rebuilt): superpowers (14 skills — the engineering pipeline), stripe-best-practices, frontend-design, ui-ux-pro-max, nextjs/vercel best practices, claude-md-improver, code-review, commit-commands, typescript-lsp. No bulk skill-pack installs — skill libraries are a retrieval problem; six sharp rituals beat 300 generic skills.

## 7. Agent Staff (in `hq/.claude/agents/`)

| Agent | Role |
|---|---|
| `dev-engineer` | Implements dispatched issues in a worktree; TDD; opens PRs |
| `qa-engineer` | Adversarial pass on feature PRs: reads spec, attacks preview deployment, files findings as PR comments before Christopher reviews |
| `architect` | Consulted on any decision with a cost/maintenance tail. Biases: boring technology, managed services, delete options before adding; every proposal states monthly cost and the month-of-neglect answer |
| `support-triager` | Runs `/triage` logic in the nightly routine |
| `growth-strategist` | Prospect pipeline, outreach drafts, keyword research, community post prep |

## 8. Pillar: Development

- **Substantial features** (playback first): groomed issue → superpowers chain (brainstorming → spec → writing-plans → executing-plans with TDD → code review) → PR → merge → Vercel auto-deploy.
- **Small work** (most by count): issue → dev subagent → PR with passing tests → `/ship` queue. `agent-ok` label marks safe-to-dispatch; applied by triage, vetoable at standup.
- **Branch discipline:** everything is a branch + PR, even one-liners — PRs are the approval surface; Vercel previews give phone-reviewable URLs.
- **One-time hygiene (prerequisites):**
  1. codetest.dev: real CLAUDE.md (currently a stub); Vercel deployment (not yet public)
  2. ski-this-weekend: add CI (lint/typecheck/test workflow) — currently none
  3. nextdog: add CLAUDE.md
  4. All repos: label taxonomy (`feedback`, `bug`, `growth`, `agent-ok`, `triaged`, `needs-human`, `launch-blocker`)
- Product CLAUDE.mds stay ≤~150 lines (ski-this-weekend's is the model); audited quarterly with claude-md-improver.

## 9. Pillar: Feedback

**Two modes per product:**

- **Pre-launch (all three today):** signal is self-generated — `/launch-check` gaps, `/design-review` findings, QA results. `/pm` scoring rule: launch-blockers outrank everything.
- **Post-launch:** real intake, switched on per product at launch.

**Intake sources (the list `/triage` iterates; growable without redesign):**
- GitHub issues (nextdog OSS users arrive here natively)
- In-app feedback widget on codetest.dev and ski-this-weekend: textarea → `POST /api/feedback` → GitHub issue labeled `feedback` with page/user context (~50 LOC per site, no vendor)
- support@codetest.dev (Resend exists; simple forwarding to start)
- **Later, same interface:** Intercom MCP, npm download stats, Channels (Telegram→session) once out of preview

**Loop closure:** when a feedback-originated fix ships, the issue gets a "fixed in production" comment (and the reporter an email once real users exist).

## 10. Pillar: Testing

Goal: make green CI trustworthy enough that merge review is judgment, not correctness-checking.

- CI on all three repos: lint + typecheck + tests on every PR. Red CI → PR never enters the `/ship` queue.
- TDD by default on dispatched dev work (superpowers-enforced); every bugfix PR carries a regression test.
- `qa-engineer` adversarial pass on feature PRs before Christopher sees them.
- `/design-review` covers the visual/UX axis with screenshot evidence before launches.
- **Explicitly out of scope now:** coverage targets; E2E suites beyond one critical flow per product; production smoke checks (deferred to post-launch per product — a launch-checklist line item, nothing more).

## 11. Pillar: Distribution

Standing rule: **agents draft, Christopher publishes.** No agent sends or posts anything outbound, ever.

- **nextdog (first):** community launch — README polish, demo GIF, Show HN / r/nextjs / r/webdev post drafts, FAQ of likely hostile comments with suggested replies. Christopher posts and engages as himself. Post-launch: agents *suggest* helpful replies in relevant debugging threads; never post.
- **codetest.dev:** (a) direct outreach — growth-strategist finds startups actively hiring engineers, drafts short personalized emails from `playbooks/outreach-templates.md`; weekly `/growth` session reviews ~10 drafts, Christopher sends. (b) Google Ads — agents do keyword research, ad copy, landing-page variants, spend analysis; Christopher owns the account, budget, publish button. Start tiny ($5-10/day), **only after `/launch-check` passes**.
- **ski-this-weekend:** none for now (wrong season). `/pm` revisits in October.
- **Measurement:** weekly routine-prepared digest in `metrics/` — visitors, signups, outreach replies, ad metrics, npm downloads. One table, trends only, no dashboards to babysit.

## 12. Rollout Phases

1. **Phase 1 — Build HQ** (1-2 sessions): repo, CLAUDE.md + constitution, settings, the seven skills, five agents, playbooks skeleton; repo hygiene (CLAUDE.mds, ski CI, labels); set up nightly triage + weekly digest routines.
2. **Phase 2 — nextdog launch:** `/launch-check` → fix blockers → `/design-review` → community launch via `/growth`. This is also the shakedown cruise for the whole workflow.
3. **Phase 3 — codetest.dev:** Vercel deploy → `/launch-check` → playback feature through the full superpowers pipeline → outreach + ads.
4. **Ongoing:** ski-this-weekend idles on autopilot until October; weekly `/pm` + `/growth` rhythm across the portfolio.

## 13. Success Criteria

- Every session starts with a sub-5-minute `/standup` brief and ends with an empty or consciously-deferred `/ship` queue
- A week of total neglect produces zero product breakage and a digest that catches Christopher up in one read
- nextdog: launched publicly; measurable adoption (npm downloads trend, GitHub stars/issues from strangers)
- codetest.dev: deployed, playback shipped, first paying customers; trajectory toward 1,000
- Total infra spend across the portfolio stays under ~$60/mo (excluding ad budget)
