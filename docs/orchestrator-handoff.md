# Orchestrator handoff — 2026-11-16

Read [AGENTS](../AGENTS.md), [backlog](backlog.md), assigned story/feature and relevant contracts first. Baseline for this replan is main `28bb2875ba62fae7f98da279ed79f06461f1318d` (PR #34). Recheck Git status, current HEAD and GitHub before action. Preserve the unrelated untracked `docs/iem-integration-handoff.md`; it is an early historical baseline, not current authority, and is excluded from this delivery.

## Current delivery and next work

The user requested stories, reprioritization and a status summary. This turn is planning/documentation delivery only; stop after its reviewed delivery and summary without automatically starting implementation or hardware work. Nine features now contain 37 stories; all seven new stories are planned/unstarted.

The next intended sequence is **F09-S01 → S02 → S03 → S04 → F04-S03 → S04 → F02-S04 → F06-S04 → F07-S01–S04 → F08-S01 → S02**. F09 establishes native evidence/adapter decision, reviewed state model, integration for existing controls, then targeted firmware validation and explicit EQ readiness. UX follow-ups separately cover logical stereo mixes, compact detail and saved-rig/persistence feedback. Numeric feature order is not priority. See the [dependency table](backlog.md).

If F09-S04 cannot satisfy applicable readiness, keep the exact blocking rows open. Do not silently continue downstream through a generic ADR-0002 exception: independent work needs its own recorded reviewed dependency exception. F08-S01 physical release qualification is never waived.

## Verified state and evidence

F06-S01/S02 pan and F06-S03 pure GEQ are merged; S04 is unstarted. PR #29 merged at `af4f230`; pure GEQ is still **unwired**. Root verified PRs [#31](https://github.com/johnsherlock/mixmate/pull/31), [#32](https://github.com/johnsherlock/mixmate/pull/32), [#33](https://github.com/johnsherlock/mixmate/pull/33) and [#34](https://github.com/johnsherlock/mixmate/pull/34) merged on 2026-11-16 with affirmative review of final changes and passing CI; merge hashes are in the backlog. Earlier pending/stop notes in immutable evidence reports are historical. F08-S03 is a merged evidence checkpoint, not fully validated or a completed remediation.

[Offline findings](f08-s03-offline-investigation.md), [passive validation](f08-s03-passive-validation.md), [controlled master trial](f08-s03-controlled-level-validation.md) and [native trial](f08-s03-native-transport-evidence.md) separate source/fake evidence from observed hardware. Firmware `3.0.7865-ui24` native one-pair master move got no own target path for 38.883s while a read-only peer got both about 11ms after dispatch with shorter decimals. Native source is local-first with no established correlated ACK callback. Endpoint/session and causal explanations remain unproven; this does not verify source sends, groups, pan, EQ or other firmware. Last observed `a.0/a.1` were `0.3961953345` each, left applied. Instrumentation/own diagnostic sessions were cleaned up; user's native app was left connected. No snapshot save/recall/delete occurred.

Live IEM owns its WebSocket/session. Community `soundcraft-ui-connection` 7.1.0 supplies imported display conversions, derived math/reference evidence; its connection/control facade is not instantiated by the live app. No automatic native/library transplant is planned. Served native code has global UI/reconnect/startup side effects; S01 evaluates exact roles and provenance with private ignored source archives, no runtime bundling/execution by default.

## Current authority and release gates

Current contracts remain authoritative until a deliberate reviewed integration: AUX master/send levels, relative groups and qualified normalized mono-source pan only through private owners/typed guards/opaque gestures. Fresh own per-path receipt within 2.5 seconds is still the confirmation rule. Send return and intent are not received state or correlated ACK. No observer-socket authority, retry, rollback or replay is implied. Preserve explicit connect/arm, cancellation/disarm, current generation, actual stereo sides and unequal-linked read-only behavior. Read-only factories remain connection-only.

GEQ serializers/curves/leases remain pure/unwired; no shelf/filter/bypass/AFS/preset writer, no verified DSP-centre claim. Snapshots/recording remain unwired. ADR-0002 already authorizes named feature classes, not unverified exact commands or current hardware actuation. Recent diagnostic SAVE prohibition remains applicable to those sessions; F07 future scope is not erased. Record existing applicable bounded user authorization and request only missing/new scope for future live checks. This replan grants no hardware permission.

Settings/groups remain device/origin-local stable-profile definitions, never live-state backups; manual same-IP connection cannot bind a profile. Preserve unresolved IDs, commit semantics and temporary/conflict feedback. Keep local runtime assets and `/mixmate/` offline scope; do not hand-edit dist or force active-session reloads. Preserve keyed controls, accepted touch gestures, portrait three columns and compact landscape travel.

F08-S01 remains open across supported Android/iOS installation, current-entry/asset offline proof, local-network policy, sleep/recovery, both rigs and all implemented controls. One tablet connection, desktop emulation, source or fake tests cannot certify these. Pixel install/Open and unknown tablet save feedback remain unresolved; iOS is not run. F09-S04 is targeted corroboration only.

## Sequential workflow

Use one fresh-context Sol/medium story agent at a time with concise repository brief, current baseline, scope, contracts, acceptance, validation and stop conditions; no further delegation or sidebar chats. One `codex/` branch/PR per story; do not start the next implementation while review is outstanding. Run `npm ci`, `npm test`, `npm run build` (CI Node24; local Node26.13.1 must be disclosed), request `@codex review`, resolve findings and obtain affirmative review covering final changes plus passing required checks. Confirm GitHub merge before recording merged status. Keep story/feature/backlog and [follow-ups](user-follow-up.md) current. Existing evidence baseline is 256 passing tests, app0.5.0, 18 assets, worker `f5c4f38ebcaec5d2`; rerun required checks for delivery and report actual results.
