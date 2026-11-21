# Orchestrator lifecycle

These repository rules implement the user's 2026-11-16 lifecycle decision. [AGENTS](../AGENTS.md) owns engineering/safety requirements; [backlog](backlog.md) owns priority; [handoff](orchestrator-handoff.md) owns the current execution checkpoint. Keep decisions/protocol evidence in their authoritative ADRs/contracts and link them rather than copying them into this document.

## Authorized batches

Record the user's authorized story IDs, exclusions, stop boundary and any unfinished authorized scope in the handoff. Normally choose about two or three stories, adjusted for complexity and dependency boundaries; story count is guidance, not a target. After each confirmed merge, continue automatically to the next eligible story within that batch without requesting approval again. Stop for a real blocker, missing decision, changed scope or safety boundary. Authorization does not expand merely because the backlog has another story.

Use **GPT-6.1 Sol Medium** for orchestrator and story agents. *Note: the user's 2026-11-21 direction overrides this: Opus orchestrator, Sonnet story and review agents, each in a fresh-context worktree.* Delegate one story at a time with `fork_turns: "none"` where supported. Give a concise self-contained brief: story/outcome, current baseline, scope/exclusions, authoritative files, user decisions/permission bounds, checks/evidence, completion/escalation conditions. If fresh-context delegation is unavailable, disclose that limitation and use the smallest supported context; do not silently switch model/effort or create sidebar chats. The orchestrator independently evaluates acceptance/evidence without duplicating the agent's investigation or routine tests.

## Story delivery and durable state

One `codex/` branch and PR per story, sequentially. Preserve unrelated local work. Run `npm ci`, `npm test`, `npm run build`; request `@codex review`, resolve findings and obtain affirmative review covering the final changes plus passing required CI before merge. Silence and local self-review are not approval. Verify GitHub merge before recording merged status or beginning the next story.

Update story, feature and backlog in the story PR. Record significant decisions in the relevant ADR/contract and unresolved findings/dependency exceptions in [follow-ups](user-follow-up.md). Update the handoff's batch checkpoint at each story boundary, including whether continuing is appropriate. Use links/receipts, not duplicated narrative. Keep hardware evidence separate from source/fake evidence; existing permissions, typed command boundaries and F08 physical gates still apply. No session rotation changes them.

## Boundary assessment

At each story boundary consider remaining authorized scope, dependency readiness, architectural uncertainty, observed context usage/compaction and reliability. Use available UI/tool/rollout telemetry only; record source/time and distinguish per-request input, cached tokens and context capacity when actually exposed. If telemetry is unavailable, say so. Token/cache counts are not subscription-allowance measurements; starting another chat does not reset account limits.

There is no invented universal token threshold. A compaction notice, context pressure, repeated loss of constraints, contradictory status, avoidable re-reading or unreliable recall warrants re-reading authoritative state and considering early handoff. Compaction alone does not prove failure. Prefer early handoff when context is unreliable or the next story needs substantially different knowledge, even if fewer than two stories are done. Do not start another story merely to meet a count; do not abandon an active one merely to rotate.

## Safe finish or park

Prefer completing the active story's review/CI/merge. If a real blocker prevents that, stop its agent and verify it is no longer working; preserve scoped work in a commit/checkpoint where safe. Record exact branch/HEAD, files/local changes, PR/head, review findings, CI, blocker, remaining acceptance and recovery command/next action. An open PR may be explicitly parked, never left looking merged/approved. Preserve unrelated user changes and never stage them implicitly. Close/clean up owned diagnostic connections and instrumentation; disclose any remaining applied hardware values. Do not kill unrelated user sessions.

## Repository handoff and stop

Before ending, verify actual branch/HEAD and worktree, all active agents/processes owned by the run, PR/review/CI/merge state, and story/feature/backlog status. Make the handoff concise: current checkpoint/receipts, authorized batch disposition, next eligible story/dependencies, pending user decisions, exact parked work and verification limits. Significant evidence must be in authoritative repository documents; private ignored artifacts are optional supporting material, never the sole knowledge needed to resume.

Deliver the handoff through the reviewed PR process, in the final story PR when possible or a small closing documentation PR when actual post-merge facts require it. Verify it is committed and available on remote main (or clearly identify an explicitly parked branch/PR). Validate its links and that a fresh checkout can orient without chat history or private artifacts. Avoid a self-referential commit hash: name the last verified baseline and identify this handoff by its containing reviewed PR/history; report the final handoff commit after merge.

Once handed off, **stop**; do not begin another story. Do not create a desktop chat or claim responsibility transferred without explicit user authorization and a supported mechanism. Normally report that the user should open a fresh orchestrator chat and read AGENTS plus the handoff. This repository checkpoint transfers knowledge, not account usage or implicit extra scope.

Reference: OpenAI's [workflow guidance](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex) supports repository guidance and phase handoffs; the specific batch, stop and safety rules above are project/user decisions, not claims of automatic desktop-session transfer.
