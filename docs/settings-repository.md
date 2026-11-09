# Local settings repository: version 1

Story: [F02-S01](stories/F02-S01.md). Date: 2026-11-09. This is a backend foundation; F02-S02 will connect rig/preferences UI and visible persistence status. The current connection-test address continues using its existing `mixmate-address` localStorage key until that migration. No automatic mixer connection or new mixer message is introduced.

## Storage contract

`src/settings.js` uses IndexedDB database `mixmate-settings`, database version 1, object store `settings`, key `current`. The entire canonical settings document is committed in one readwrite transaction, atomically comparing the latest durable document with this instance's last durable baseline before writing. A stale instance cannot overwrite a different committed document. Initial schema upgrade creates this store; initialization with no record returns empty definitions without saving mock rigs/groups.

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "user-generated-local-id",
      "name": "User's rig name",
      "address": "192.168.0.60",
      "groups": [
        { "id": "group-local-id", "name": "User's group name", "members": ["i.5", "i.3", "f.0"] }
      ],
      "navigation": { "mixId": "a.0", "view": "groups", "expandedGroupId": "group-local-id" }
    }
  ],
  "selectedProfileId": "user-generated-local-id",
  "preferences": { "orientation": "auto", "showMeters": true }
}
```

The example is a schema illustration, not a seeded rig or evidence that those sources/mixes exist. Defaults have no profiles, a null selection, automatic orientation and meters enabled. Navigation defaults belong to a newly user-created profile in S02; null mix/group IDs mean no selection.

IDs are stable local strings (1–64 ASCII letters/digits/underscore/hyphen, starting with a letter/digit); a changed address does not change rig identity. Profile and group names are user-entered text (trimmed, 1–80 characters, no control characters), not copied live channel names. Consumers render them using `textContent`. An address must be canonical private IPv4. Duplicate profiles/groups/members and dangling selected profile/group IDs are rejected.

Source references use namespace IDs `i`, `l`, `p`, `f` plus an index; AUX selection uses `a` plus an index. Stored references permit up to three decimal digits without leading zeros. These bounds prevent unbounded/arbitrary keys; they do **not** assert mixer capabilities, validate protocol paths or authorize writes. Future source discovery must keep unavailable references unresolved. Preserve group/member order exactly. Limits: 32 profiles, 64 groups/profile, 128 members/group. Orientation is `auto`, `portrait` or `landscape`; view is `groups`, `channels` or `eq`.

Only these fields are accepted. Received names, channel levels, meter data, EQ values, link state, connection status, armed controls, gestures and queued writes are excluded. Unknown fields, non-plain objects, accessor properties, sparse/custom arrays and invalid values are rejected. Known unsupported version envelopes are recognized before version-1 field validation. Validation builds a new canonical object and all public read/subscription boundaries return independent clones.

## API and persistence status

Create one shared `SettingsRepository` per app document. `initialize()` opens/reads once and never connects to a mixer. `snapshot()` returns independent `{ settings, status }`. `subscribe(listener)` immediately reports a snapshot and returns an unsubscribe function. Observer errors cannot turn a committed save into a failure.

- `update(draft => { ... })` serializes synchronous edits so each updater sees the latest accepted result of earlier calls. Use this for UI edits; do not compose concurrent changes from stale snapshots. Async updater callbacks reject without accepting their draft.
- `replace(document)` validates/copies immediately and serializes an intentional whole-document replacement, for the later import UI. Caller mutations cannot race the save. Invalid input throws `SettingsValidationError` (or its `SettingsVersionError` subtype); an invalid update rejects its returned promise and leaves prior settings untouched.
- Mutation promises resolve after transaction completion, not request success. Storage failures resolve with the accepted memory settings and an explicit unsaved status. Consumers must inspect/render status rather than treating promise resolution as proof of persistence.
- `close()` releases the database/subscribers after queued work; further edits reject. No saved state includes a live socket or arming.

Status fields are `mode` (`persistent` / `memory`), `state` (`loading` / `ready` / `saving` / `saved` / `unsaved`) and a fixed `reason` (`null`, `unavailable`, `timeout`, `quota`, `corrupt-data`, `unsupported-version`, `conflict`). `ready` means storage opened/read successfully, not that defaults were written. `saved` is emitted only after a successful transaction commit. `settingsStatusText(status)` provides inert user-visible text for S02, including temporary-data and full-storage warnings. Memory changes emit fresh snapshots and never report saved. A conflict preserves the local attempted draft in memory for later export/recovery, leaves the newer durable document untouched and does not automatically reload, merge or connect.

Open and transaction phases each have a 3-second deadline. Missing/denied/blocked/timed-out storage, quota/transaction errors and unexpected version changes degrade to memory-only use. No background retry or automatic overwrite follows an error. A later app launch may reopen storage; temporary edits cannot be assumed to have survived. Unsupported or corrupt persisted data is left untouched for later recovery/export UX. There is no automatic deletion/reset.

Queued updates serialize within one shared app-document instance. Independent tabs/instances receive optimistic conflict protection: a readwrite transaction reads/validates the latest document, compares it with the last durable canonical baseline, and only then writes. Both ordinary edits and explicit replacements/imports use this guard. A stale instance falls back to observable memory/unsaved conflict state, without overwriting the other tab or automatically retrying. This prevents silent lost updates without promising collaborative merging, BroadcastChannel synchronization or cloud storage. User-confirmed conflict recovery belongs to S03.

## Migration and import boundary

No earlier MixMate settings-repository schema existed. The version-1 database creation and validated version-1 record read are the current migration path. No fictitious legacy v0 shape is accepted. Older/unknown/newer data versions and newer database versions are preserved in memory fallback; do not downgrade/delete them. The old localStorage address belongs to S02's explicit migration, independently of this schema.

Future schema changes must add an explicit tested migration and bump the document version (and database version if the store structure changes), retaining ordering/identities and forbidden-state exclusions. `validateSettings` is the shared canonical validation boundary for future decoded JSON imports. File size parsing limits, preview, import confirmation, backup/reset and persistent-storage requests are F02-S03 scope.

## Validation and limitations

`fake-indexeddb` 6.2.8 is pinned as a development-only dependency, following the [author's test API documentation](https://github.com/dumbmatter/fakeIndexedDB). It implements IDB requests, upgrades and transactions in memory for Node tests; it is not shipped as a browser polyfill or fetched at runtime. Tests exercise committed reopen, initial upgrade, rejection/preservation of unknown versions, transaction abort after request success, quota failure, ordering, defensive copies, corruption, in-flight connection invalidation and stale-instance conflicts (including concurrent first saves). This does not certify physical browser storage retention or mobile compatibility; those release checks remain open in F08-S01.
