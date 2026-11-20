# Local settings repository: version 3

## F02-S05: version 3, snapshot-named rigs and known addresses — 2026-11-20

Source: user decisions of 2026-11-20 in the orchestrator conversation ([F02-S05](stories/F02-S05.md)). This section supersedes conflicting text below, which is historical.

```json
{
  "version": 3,
  "profiles": [
    { "id": "local-id", "name": "IMGL FIBBERS", "groups": [{ "id": "group-id", "name": "Band", "members": ["i.5", "i.3"] }],
      "navigation": { "mixId": "a.0", "view": "groups", "expandedGroupId": "group-id" } }
  ],
  "selectedProfileId": "local-id",
  "knownAddresses": ["192.168.0.60", "10.0.0.2"],
  "preferences": { "orientation": "auto", "showMeters": true }
}
```

- **Rig identity is the desk's current snapshot name.** A profile's `name` is the received `var.currentSnapshot` string, trimmed (`snapshotRigName`): 1–80 characters, no control characters, stored already trimmed; names are unique and compared exactly (case-sensitive). An invalid received name means no rig, never a truncated or altered one. Profiles have no address. `selectedProfileId` is the last-used rig, which Edit Groups uses offline.
- **Rigs are created automatically** by the live app (empty groups, default navigation) the first time a snapshot name is received. **Cap 128** (`RIG_LIMIT`). On overflow the live app removes the first stored rig that has no groups and is not the last-used rig; if every rig has groups nothing is removed and the new snapshot has no rig, with the reason shown. Groups are never dropped silently.
- **`knownAddresses`**: up to 8 (`KNOWN_ADDRESS_LIMIT`) unique canonical private IPv4 addresses, most recently successful first (`promoteKnownAddress`). The live app adds or promotes an address only after received Ui24 AUX readiness (session phase `live`), never on socket-open, and skips the write when it is already first. Addresses are suggestions and automatic-connection candidates, not rig identity. The connection test reads them as suggestions and seeds them once from the legacy `mixmate-address` key on first use; it never records addresses.
- **`localDefinitions` is removed**; definition owners are only `{ kind: 'profile', id }`.
- Unchanged: one atomic baseline-guarded transaction per save, strict whitelist validation of plain data, group/member limits (64 groups, 128 members), source/mix ID forms, preferences, and the rule that received values, arming, baselines, gestures and pending operations are never persisted.

**Migration.** `validateSettings` accepts v1, v2 and v3 and always returns canonical v3. A v1/v2 record is first validated strictly against its own format (a malformed legacy record stays `corrupt-data`, untouched); then its profiles, groups and `localDefinitions` are **discarded** (user decision) and its profile addresses seed `knownAddresses` (the previously selected profile's address first, then profile order, deduplicated, capped at 8). Preferences are kept. Reading never writes: the legacy record stays on disk until the next accepted save, which in the live app happens at the first successful connection (address promotion and rig creation). Database version stays 1. Version 4+ is `unsupported-version`, untouched and memory-only.

**Rollback consequences.** Once a v3 document is committed, the v2 record is gone: the old rigs and groups cannot be recovered by this build or any other. An already-open older tab, the old connection test or a reverted deployment reads v3 as `unsupported-version`, keeps running with temporary empty settings and its stale-baseline guard refuses to overwrite, so the v3 record is not lost, but its snapshot rigs, groups and known addresses appear missing there. Reverting this story therefore requires shipping a v3 reader first; reverting it would not restore pre-v3 groups.


Story: [F02-S01](stories/F02-S01.md). Date: 2026-11-09. F02-S02 wires this repository into the connection test through `src/rig-settings.js`, with visible status and validated legacy address migration. The old `mixmate-address` key is no longer written. No automatic mixer connection or new mixer message is introduced.

> **F09-S08 (user decision 2026-11-20): settings export/import removed.** The **Export settings** buttons in the live connection dialog and Edit Groups dialog, and the Export/Import backup controls in Settings / test (`connection-test.html`), are removed: they were not in the design and exported little. `parseSettingsBackup`, `settingsBackupText`, `exportSettingsBackup` and the file-import preview are deleted. **Reset local settings** and storage protection remain in Settings / test, and `replace(document)` remains for that reset. The repository schema, `validateSettings` and the version-1 → version-2 read migration are unchanged (covered by `tests/settings.test.js`). Temporary (memory-only) definitions now say they will be lost when the page closes. Text below that mentions export, import or backups is historical.

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
  "localDefinitions": {
    "id": "device-local-set-id",
    "groups": [{ "id": "local-group-id", "name": "User's group name", "members": ["i.1", "i.0"] }],
    "navigation": { "mixId": null, "view": "groups", "expandedGroupId": null }
  },
  "preferences": { "orientation": "auto", "showMeters": true }
}
```

`"version": 2` is the current document (F04-S05). `localDefinitions` is either `null` or one device-local definition set — `{ id, groups, navigation }`, validated with exactly the same group/navigation rules and limits as a profile — used by the live app when no saved rig is bound. It has no address and no rig identity; its ID is created lazily by the first saved group and stays stable until import/reset replaces the document. The live app always stores its navigation `mixId` as `null`. Profile-owned groups are unchanged; nothing moves between the device-local set and a profile implicitly.

The example is a schema illustration, not a seeded rig or evidence that those sources/mixes exist. Defaults have no profiles, a null selection, automatic orientation and meters enabled. Navigation defaults belong to each newly created profile; null mix/group IDs mean no selection.

IDs are stable local strings (1–64 ASCII letters/digits/underscore/hyphen, starting with a letter/digit); a changed address does not change rig identity. Profile and group names are user-entered text (trimmed, 1–80 characters, no control characters), not copied live channel names. Consumers render them using `textContent`. An address must be canonical private IPv4. Duplicate profiles/groups/members and dangling selected profile/group IDs are rejected.

Source references use namespace IDs `i`, `l`, `p`, `f` plus an index; AUX selection uses `a` plus an index. Stored references permit up to three decimal digits without leading zeros. These bounds prevent unbounded/arbitrary keys; they do **not** assert mixer capabilities, validate protocol paths or authorize writes. Future source discovery must keep unavailable references unresolved. Preserve group/member order exactly. Limits: 32 profiles, 64 groups/profile, 128 members/group. Orientation is `auto`, `portrait` or `landscape`; view is `groups`, `channels` or `eq`.

Only these fields are accepted. Received names, channel levels, meter data, EQ values, link state, connection status, armed controls, gestures and queued writes are excluded. Unknown fields, non-plain objects, accessor properties, sparse/custom arrays and invalid values are rejected. Known unsupported version envelopes are recognized before field validation; a version-1 envelope is validated against the version-1 field list (so it cannot carry `localDefinitions`) and then migrated. Validation builds a new canonical object and all public read/subscription boundaries return independent clones.

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

F04-S05 (2026-11-18): `validateSettings` accepts version 1 and version 2 and always returns canonical version 2. Version-1 → version-2 migration is pure — it adds `localDefinitions: null` and changes nothing else — and happens on every read/import. Reading never writes: a stored v1 record stays v1 until the next accepted user edit/import commits a v2 document through the usual atomic baseline guard (the guard compares migrated canonical forms). IndexedDB database version remains 1 because the store layout is unchanged. Unknown/newer versions (for example 3) remain `unsupported-version`, untouched and memory-only. **Rollback/old tabs:** once any accepted edit (including a navigation change) commits v2, an already-open older build, the older connection-test page or a reverted deployment reads it as `unsupported-version`: it keeps running with temporary settings and its stale-baseline guard refuses to overwrite, so no data is lost, but saved rigs/groups appear missing there until the newer build is loaded. Reverting this change therefore requires shipping a v2 → v1 reader first. Definition owners are addressed by `validateDefinitionOwner` / `definitionOwner(settings, { kind: 'profile' | 'local', id })`; an owner is an address into canonical settings, never a group payload or transport capability.

Historical S01 note:

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

## F02-S04 live setup

The live IEM connection dialog now exposes **Saved local rig**, **Local rig name**, **New rig** and **Save rig**. Unbound **Edit Groups** opens this same dialog instead of remaining disabled. Close the dialog after selecting/saving, then Edit Groups works offline for that explicit stable identity; received source IDs not currently available remain unresolved and retain their order. A manual address edit always detaches rig identity, even at the same IP; saving that unbound draft creates a separate local rig. New rig deliberately creates a separate identity, including at a duplicate IP. Selecting an existing profile and saving its name retains its groups/navigation. Full address editing, import/recovery and preferences remain available in Settings / test; export the current live definitions here before navigating away if they are temporary.

New rig, profile selection and valid Save synchronously clear control context and disconnect before any asynchronous save; none connects automatically. Saves use a guarded canonical updater, retain unrelated concurrent fields, and report durable success only from committed persistent `saved` status. Until save completion the new identity is unbound. An obsolete queued save is rejected before applying; a commit already in progress may finish for its original identity, but its late result cannot bind/retarget newer input or a connection. Save is disabled while pending; other explicit target actions remain available to cancel its UI intent.

Storage status remains visible in both the connection setup and group editor. Unavailable, aborted or conflicting saves keep accepted definitions temporary and exportable, with no silent overwrite/retry/clear. The UI explains that definitions belong to this browser, device and site address; moving between origins/ports or devices does not share storage. **Export settings** in the live connection setup and group editor downloads the current live repository, including accepted temporary definitions, through the shared bounded canonical serializer. Uncommitted editor drafts are excluded. Export reports a download request, never guaranteed file retention, and catches download failures without losing definitions. Settings / test is a separate document/repository: export temporary live definitions here before leaving, then use its import/recovery tools deliberately. The unknown physical tablet save error has no exact device/build/error evidence yet and is not claimed fixed by this UI work.

When Save owns keyboard focus, setup moves it to the visible rig-name input before disabling Save; late completion never moves focus. Escape remains within the shared dialog owner while storage is pending.

F04-S05 supersedes the unbound Edit Groups detour above: Edit Groups now opens directly and, with no saved rig bound, edits the device-local `localDefinitions` set. See [groups](iem-groups.md#f04-s05-device-local-owner-all-mixes-catalog-and-deletion--2026-11-18).
