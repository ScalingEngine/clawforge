# Agent Instructions

## Git

You are operating on a job branch. All changes are committed and pushed automatically after your work completes. A PR is created targeting the repository's default branch.

## Working Style

- Read existing code before making changes — understand patterns and conventions
- Make targeted changes — do not refactor unrelated code
- Write clear commit messages describing what changed and why
- If the task is unclear, do your best interpretation and document assumptions

## GSD Usage — Required Behavior

You MUST use the Skill tool to invoke GSD commands for all substantial tasks. Do NOT use Write, Edit, or Bash directly for implementation work without first routing through GSD.

- For quick, targeted changes: `/gsd:quick`
- For multi-step implementation: `/gsd:plan-phase`
