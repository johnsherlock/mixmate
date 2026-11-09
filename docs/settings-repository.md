# Local settings repository: version 1

Story: [F02-S01](stories/F02-S01.md). Date: 2026-11-09. F02-S02 wires this repository into the connection test through `src/rig-settings.js`, with visible status and validated legacy address migration. The old `mixmate-address` key is no longer written. No automatic mixer connection or new mixer message is introduced.

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

The example is a schema illustration, not a seeded rig or evidence that those sources/mixes exist. Defaults have no profiles, a null selection, automatic orientation and meters enabled. Navigation defaults belong to each newly created profile; null mix/group IDs mean no selection.

IDs are stable local strings (1–64 ASCII letters/digits/underscore/hyphen, starting with a letter/digit); a changed address does not change rig identity. Profile and group names are user-entered text (trimmed, 1–80 characters, no control characters), not copied live channel names. Consumers render them using `textContent`. An address must be canonical private IPv4. Duplicate profiles/groups/members and dangling selected profile/group IDs are rejected.

Source references use namespace IDs `i`, `l`, `p`, `f` plus an index; AUX selection uses `a` plus an index. Stored references permit up to three decimal digits without leading zeros. These bounds prevent unbounded/arbitrary keys; they do **not** assert mixer capabilities, validate protocol paths or authorize writes. Future source discovery must keep unavailable references unresolved. Preserve group/member order exactly. Limits: 32 profiles, 64 groups/profile, 128 members/group. Orientation is `auto`, `portrait` or `landscape`; view is `groups`, `channels` or `eq`.

Only these fields are accepted. Received names, channel levels, meter data, EQ values, link state, connection status, armed controls, gestures and queued writes are excluded. Unknown fields, non-plain objects, accessor properties, sparse/custom arrays and invalid values are rejected. Known unsupported version envelopes are recognized before version-1 field validation. Validation builds a new canonical object and all public read/subscription boundaries return independent clones.

## API and persistence status

Create one shared `SettingsRepository` per app document. `initialize()` opens/reads once and never connects to a mixer. `snapshot()` returns independent `{ settings, status, hasStoredSettings }`. `subscribe(listener)` immediately reports a snapshot and returns an unsubscribe function. Observer errors cannot turn a committed save into a failure.

- `update(draft => { ... })` serializes synchronous edits so each updater sees the latest accepted result of earlier calls. Use this for UI edits; do not compose concurrent changes from stale snapshots. Async updater callbacks reject without accepting their draft.
- `replace(document)` validates/copies immediately and serializes an intentional whole-document replacement, for the explicit previewed import/reset UI. Caller mutations cannot race the save. Invalid input throws `SettingsValidationError` (or its `SettingsVersionError` subtype); an invalid update rejects its returned promise and leaves prior settings untouched.
- Mutation promises resolve after transaction completion, not request success. Storage failures resolve with the accepted memory settings and an explicit unsaved status. Consumers must inspect/render status rather than treating promise resolution as proof of persistence.
- `close()` releases the database/subscribers after queued work; further edits reject. No saved state includes a live socket or arming.

Status fields are `mode` (`persistent` / `memory`), `state` (`loading` / `ready` / `saving` / `saved` / `unsaved`) and a fixed `reason` (`null`, `unavailable`, `timeout`, `quota`, `corrupt-data`, `unsupported-version`, `conflict`). `ready` means storage opened/read successfully, not that defaults were written. `saved` is emitted only after a successful transaction commit. `settingsStatusText(status)` provides inert user-visible text for S02, including temporary-data and full-storage warnings. Memory changes emit fresh snapshots and never report saved. A conflict preserves the local attempted draft in memory for later export/recovery, leaves the newer durable document untouched and does not automatically reload, merge or connect.

Open and transaction phases each have a 3-second deadline. Missing/denied/blocked/timed-out storage, quota/transaction errors and unexpected version changes degrade to memory-only use. No background retry or automatic overwrite follows an error. A later app launch may reopen storage; temporary edits cannot be assumed to have survived. Unsupported or corrupt persisted data is left untouched for later recovery/export UX. There is no automatic deletion/reset.

Queued updates serialize within one shared app-document instance. Independent tabs/instances receive optimistic conflict protection: a readwrite transaction reads/validates the latest document, compares it with the last durable canonical baseline, and only then writes. Both ordinary edits and explicit replacements/imports use this guard. A stale instance falls back to observable memory/unsaved conflict state, without overwriting the other tab or automatically retrying. This prevents silent lost updates without promising collaborative merging, BroadcastChannel synchronization or cloud storage. User-confirmed conflict recovery belongs to S03.

## Migration and import boundary

No earlier MixMate settings-repository schema existed. The version-1 database creation and validated version-1 record read are the current migration path. No fictitious legacy v0 shape is accepted. Older/unknown/newer data versions and newer database versions are preserved in memory fallback; do not downgrade/delete them. The old localStorage address belongs to S02's explicit migration, independently of this schema.

Future schema changes must add an explicit tested migration and bump the document version (and database version if the store structure changes), retaining ordering/identities and forbidden-state exclusions. `validateSettings` is the shared canonical validation boundary for future decoded JSON imports. F02-S03 adds file size limits, preview/confirmation, local export/reset and explicit persistent-storage requests; see [backup guide](settings-backup.md).

## Validation and limitations

`fake-indexeddb` 6.2.8 is pinned as a development-only dependency, following the [author's test API documentation](https://github.com/dumbmatter/fakeIndexedDB). It implements IDB requests, upgrades and transactions in memory for Node tests; it is not shipped as a browser polyfill or fetched at runtime. Tests exercise committed reopen, initial upgrade, rejection/preservation of unknown versions, transaction abort after request success, quota failure, ordering, defensive copies, corruption, in-flight connection invalidation and stale-instance conflicts (including concurrent first saves). This does not certify physical browser storage retention or mobile compatibility; those release checks remain open in F08-S01.

## F02-S02 UI and target contract

One repository per document backs the connection test's local rig picker/editor and orientation/showMeters preferences. First use creates one `My rig` profile from a validated legacy address or `192.168.0.60`. New rig starts a local editor draft; Save validates/commits it with a crypto-random stable ID, empty groups and no selected AUX/group. Duplicate IP addresses remain legal, separate identities. Names are inert text, trimmed to 1–80 characters; the UI caps profiles at 32. Delete requires confirmation and removes only that local rig and its definitions.

Profile selection, New rig, selected-profile deletion and address input synchronously disconnect/clear/disarm before any asynchronous persistence. Renaming a profile without changing its target does not interrupt the socket. Connect is always an independent explicit action and uses the displayed address. Save never starts or retries a connection. An unsaved address remains usable temporarily and is labelled as a draft; Save before changing profiles to retain edits.

The editor's runtime/draft selection is separate from persisted default selection. Preference updates cannot rebind a New rig or temporary-address draft. If the user types or connects before IndexedDB finishes, loaded settings do not replace the current address or infer rig identity from matching IPs, including duplicate-IP profiles. The target stays unbound until an explicit profile selection or Save. Late save completion only updates persistence status; it cannot overwrite a newer address/name draft or retarget a socket.

Status subscriptions render `settingsStatusText` and never automatically reload definitions from another window. Atomic repository conflicts leave newer durable records untouched and the attempted definitions usable in temporary memory. Storage errors retain the validated legacy source. The old `mixmate-address` key is removed only after a persistent `saved` event (transaction commit), and is never written again; this prevents a successful migration followed by reset from reviving the legacy address. F02-S03 also uses durable record-presence metadata: an intentional empty record is not first use. The legacy source is resolved only after storage lookup, and is not remigrated after reset/import even if key removal fails. No default `My rig` is silently re-created from a deliberate empty record.

Orientation and showMeters are saved configuration for F03's IEM consumer. This connection test neither forces orientation nor invents meters. Navigation fields are initialized but not presented as live AUX availability. No received names/state, armed controls or gesture values enter the repository.


S02 validation: 65 local/fake tests pass and production build emits eight precached assets (`fff7703f6e9d13b9`). Targeted production browser QA used isolated Chromium at 390×844 with real IndexedDB, loopback-only requests and a strict fake WebSocket: new profile creation, preferences before Save, identity preservation/reload and armed-profile-switch disconnect all passed. The layout had no horizontal overflow or JavaScript errors. Service workers were deliberately blocked for that UI run; this does not establish mobile retention, offline readiness or real mixer compatibility.


Programmatic target assignment clears previous custom validation errors, matching the existing input-event path. Native Chromium testing reproduced invalid-address Connect → valid saved-rig still blocking submission before the fix; saved-rig and New rig recovery now clear `customError`, pass form validity and permit explicit fake-socket connection. No automatic connection or write is introduced.

## F02-S03 replacement and recovery integration

`hasStoredSettings` is repository metadata, not part of the exported schema. It records an observed existing IDB record (even if validation fails) or a successful commit. A new empty document, a deliberately stored empty document and an unreadable version are not treated as the same first-use condition. Database schema version remains 1; no settings fields or unknown legacy shapes are added.

`mountRigSettings` exposes a defensive accepted-definition snapshot, monotonic user-action revision and synchronous `replaceSettings` method. Replacement validates, disconnects/disarms, applies target/profile/preferences and returns a completion promise; late results cannot replace fresh input. Runtime selection stays separate from persisted definitions, including null imported selection and New rig drafts. `mountSettingsRecovery` adds bounded file reads, inert preview, explicit confirm/cancel, local download and optional StorageManager protection.

Normal import/reset uses the existing atomic baseline guard. If storage is unavailable/corrupt/newer/conflicted, local definitions remain exportable memory state and unknown durable records stay untouched. Forced destructive recovery is parked. No `deleteDatabase`, cache deletion, origin clear, worker unregister or mixer operation exists in this flow.

S03 validation: 77 tests pass; production build emits eight assets, worker `f06247a2bdfa6b31`. Targeted isolated Chromium QA used real service worker/IndexedDB and actual JSON download/file import with strictly fake mixer traffic. All assets verified, exact ordered settings roundtripped, markup stayed literal, browser-network-offline reload preserved settings/readiness, and confirmed armed-session reset preserved cache keys/offline marker/sibling storage while remaining empty after another offline reload. This is desktop emulation, not physical Android/iOS qualification or proof of long-term retention.
