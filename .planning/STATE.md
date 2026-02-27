# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results
**Current focus:** Phase 11 — Notification Pipeline DB Schema

## Current Position

Phase: 11 of 12 (Notification Pipeline DB Schema)
Plan: 1 of 3 in current phase
Status: In Progress
Last activity: 2026-02-26 — 11-01 complete: target_repo nullable column added to job_outcomes, drizzle migration generated, saveJobOutcome() updated

Progress: [██████████░░░░░░░░░░] 46% (phases 1-10 complete, phase 11 in progress)

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Average duration: 1.4 min
- Total execution time: 0.27 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation Fix | 2/2 | 2 min | 1 min |
| 2. Output Observability | 2/2 | 3 min | 1.5 min |
| 3. Test Harness | 1/1 | 2 min | 2 min |
| 4. Instruction Hardening | 1/1 | 1 min | 1 min |
| 5. Pipeline Hardening | 2/2 | 4 min | 2 min |
| 6. Smart Job Prompts | 1/1 | 5 min | 5 min |
| 7. Previous Job Context | 2/2 | 5 min | 2.5 min |
| 8. Polish, Test, Sync | 2/2 | 2 min | 1 min |

**Recent Trend:**
- Last 5 plans: 06-01 (5 min), 07-01 (2 min), 07-02 (3 min), 08-01 (1 min), 08-02 (1 min)
- Trend: stable

*Updated after each plan completion*
| Phase 09 P01 | 2 | 2 tasks | 6 files |
| Phase 09 P02 | 5 | 2 tasks | 4 files |
| Phase 09 P03 | 1 | 2 tasks | 2 files |
| Phase 10 P01 | 3 | 3 tasks | 2 files |
| Phase 10 P03 | 1 | 2 tasks | 1 files |
| Phase 10 P02 | 2 | 2 tasks | 1 files |
| Phase 11 P01 | 3 | 2 tasks | 5 files |
| Phase 11 P02 | 3 | 2 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting v1.2 work:

- [v1.2 roadmap]: Cross-repo notification fires from entrypoint directly — notify-pr-complete.yml cannot observe events in foreign repos
- [v1.2 roadmap]: SOUL.md/AGENT.md baked into Docker image (/defaults/) — cross-repo working tree has no ClawForge config
- [v1.2 roadmap]: gh auth setup-git for all clones — PAT never interpolated into clone URLs (Actions log exposure risk)
- [v1.2 roadmap]: Job branches always live in clawforge — on:create trigger constraint; target.json sidecar carries target metadata
- [v1.2 roadmap]: Cross-repo PRs notify at PR creation, same-repo at merge — semantic difference must surface in UX language
- [Phase 09]: REPOS.json placed in instances/{name}/config/ and COPY'd into container at ./config/REPOS.json — follows same path pattern as SOUL.md, AGENT.md
- [Phase 09]: loadAllowedRepos() reads on every call with no caching — file is <1KB and changes require container rebuild anyway
- [Phase 09]: resolveTargetRepo() returns null (not undefined) via ?? null for consistent, explicit caller behavior
- [Phase 09]: Bake SOUL.md/AGENT.md into Docker image at /defaults/ — cross-repo working trees have no ClawForge config
- [Phase 09]: Use variable-based fallback (SOUL_FILE/AGENT_FILE) to preserve backward compatibility — /job/config/ takes precedence when present
- [Phase 09]: No PAT in clone URLs: gh auth setup-git handles credential resolution; GH_TOKEN only flows via env var (EXEC-04)
- [Phase 09]: target_repo validation at tool handler layer — agent layer validates, job layer trusts; error response includes available repo names for self-correction
- [Phase 09]: target.json pre-computes repo_url as full clone URL — entrypoint can use directly without string interpolation
- [Phase 10 P01]: WORK_DIR defaults to /job; set to /workspace only when target.json detected — preserves 100% backward compat for same-repo jobs
- [Phase 10 P01]: clone-error.md committed to clawforge job branch before exit 1 — Phase 11 failure detection reads it there
- [Phase 10 P01]: Explicit cd /job before section 12 git operations — WORK_DIR may be /workspace so must restore clawforge tree for commit
- [Phase 10 P01]: CLAUDE.md and package.json read from WORK_DIR so cross-repo Claude gets target repo context, not clawforge context
- [Phase 10]: Cross-repo notification fires from push to job/* branch with pr-result.json; push is only observable clawforge event when PR created on foreign repo
- [Phase 10]: notify-pr-complete.yml route step: path=cross_repo/same_repo/skip controls which notification path executes; status=cross_repo_pr_open distinguishes from same-repo completed
- [Phase 10]: Use --body-file for multi-line PR body in gh pr create — avoids shell quoting hazards with heredoc-in-subshell contexts
- [Phase 10]: Write pr-result.json to LOG_DIR BEFORE final git add so it is captured in the clawforge job commit — notify-pr-complete.yml reads it from that commit
- [Phase 10]: Same-repo PR path wrapped in if [ -z TARGET_REPO_SLUG ] guard — v1.1 behavior fully preserved when no target.json present
- [Phase 11]: Migration generated via drizzle-kit (not hand-written) to keep journal consistent
- [Phase 11]: targetRepo stored as explicit null (not undefined) in .values() to avoid silent field drop
- [Phase 11]: Dynamic import of sendMessage mirrors existing Slack WebClient pattern

### Pending Todos

1. **Set up OpenAI key for Epic audio transcription** (infra) — [todo](./todos/pending/2026-02-24-set-up-openai-key-for-epic-audio-transcription.md)

### Blockers/Concerns

- [Phase 9]: StrategyES instance REPOS.json content needs operator confirmation before Phase 9 ships
- [Phase 9]: Fine-grained PAT scope update is an operator action — must be documented in .env.example before any cross-repo job runs
- [Phase 11]: Cross-repo merge semantics UX language needs validation ("PR open for review" vs "merged")

## Session Continuity

Last session: 2026-02-26
Stopped at: Completed 11-01-PLAN.md — target_repo column added to job_outcomes, drizzle migration generated, saveJobOutcome() updated
Resume file: None
