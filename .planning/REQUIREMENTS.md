# Requirements: ClawForge v1.3

**Defined:** 2026-02-27
**Core Value:** Agents receive intelligently-constructed prompts with full repo context, so every job starts warm and produces high-quality results

## v1.3 Requirements

Requirements for the Instance Generator milestone. Each maps to roadmap phases.

### Intake

- [ ] **INTAKE-01**: Operator can trigger instance creation by describing intent in natural language to Archie ("create an instance for Jim", "set up a new agent", etc.)
- [ ] **INTAKE-02**: Archie collects required configuration (name/slug, purpose, allowed repos, enabled channels) across 3-4 conversational turns — groups related questions, does not ask one field per turn
- [ ] **INTAKE-03**: Archie captures optional fields (Slack user IDs, Telegram chat ID) if volunteered without requiring a dedicated question turn
- [ ] **INTAKE-04**: Archie presents a configuration summary and requires explicit operator approval before dispatching the job
- [ ] **INTAKE-05**: Operator can cancel the intake at any point; conversation resets cleanly without leaving dangling state

### Scaffold

- [ ] **SCAF-01**: Job generates all 6 instance files under `instances/{name}/`: Dockerfile, SOUL.md, AGENT.md, EVENT_HANDLER.md, REPOS.json, .env.example
- [ ] **SCAF-02**: Job updates `docker-compose.yml` with a new service block for the instance (comment-preserving via yaml package)
- [ ] **SCAF-03**: Generated SOUL.md and AGENT.md content is authored to reflect the operator's stated instance purpose — not generic boilerplate
- [ ] **SCAF-04**: Generated REPOS.json and EVENT_HANDLER.md are scoped to the gathered allowed repos and enabled channels

### Delivery

- [ ] **DELIV-01**: PR body includes an instance-specific operator setup checklist (exact GitHub secret names, Slack app scopes, PAT permissions, post-merge commands)
- [ ] **DELIV-02**: Instance scaffolding PRs are excluded from auto-merge and require manual operator review before merge
- [ ] **DELIV-03**: End-to-end validation run succeeds: multi-turn conversation → approval → job dispatch → PR with all 7 artifacts verified correct

## Future Requirements

### Instance Management

- **MGMT-01**: Operator can update an existing instance's allowed repos via conversation
- **MGMT-02**: Operator can decommission an instance via conversation (generates removal PR)
- **MGMT-03**: Archie can list currently configured instances with their status

### Automation

- **AUTO-01**: GitHub secrets auto-provisioned for new instances (requires elevated permissions model)
- **AUTO-02**: Slack app auto-created and configured for new instances (requires Slack API enhancement)
- **AUTO-03**: New instance automatically deployed after PR merge (requires infrastructure-level triggers)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automated GitHub secrets provisioning | Security blast radius — requires permissions beyond current scope |
| Automated Slack app creation | Not possible via Slack API; platform limitation |
| Automated deployment after merge | Security-sensitive; human review via PR is the right gate |
| Instance update/deletion via conversation | Requires safe model for modifying live config; define creation first |
| Instance health dashboard | Requires additional job_outcomes aggregation; future milestone |
| Multi-repo job transactions | Requires transaction model; use sequential single-repo jobs |
| Cross-repo instance file generation | All instance files belong in clawforge repo; cross-repo adds complexity without benefit |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INTAKE-01 | Phase 13 | Pending |
| INTAKE-02 | Phase 14 | Pending |
| INTAKE-03 | Phase 14 | Pending |
| INTAKE-04 | Phase 14 | Pending |
| INTAKE-05 | Phase 14 | Pending |
| SCAF-01 | Phase 15 | Pending |
| SCAF-02 | Phase 15 | Pending |
| SCAF-03 | Phase 15 | Pending |
| SCAF-04 | Phase 15 | Pending |
| DELIV-01 | Phase 16 | Pending |
| DELIV-02 | Phase 16 | Pending |
| DELIV-03 | Phase 17 | Pending |

**Coverage:**
- v1.3 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 — traceability populated after roadmap creation (Phases 13-17)*
