# Settings backup and recovery

F02-S03 provides local files for moving settings between devices or restoring them. It does not upload files, create an account or back up the mixer's current state.

## Export

1. Save rig if you want current name/address editor changes included. Uncommitted text is not a rig definition.
2. Expand **Settings backup & recovery**, then choose **Export settings**.
3. Keep the downloaded `mixmate-settings-v1.json` file somewhere you can access later. The app reports that a download was requested; browser download handling can differ.

The file contains validated version-1 local profile IDs/names/addresses, ordered group definitions/source IDs, navigation and display preferences. It includes accepted temporary memory settings when device storage is unavailable or has a conflict. The export message makes this explicit. It excludes received mixer channel names, levels, meters, EQ, linking state, armed controls, gestures, queued commands and credentials. Rig/group names and private addresses can still be personal information; share the file deliberately. No file is sent anywhere automatically.

## Import

1. Choose a local JSON file through **Import settings backup**. It must be nonempty and at most 8 MiB. Both the declared file size and the actual UTF-8 text size are bounded before parsing.
2. Review the preview: it shows how many current rigs will be removed, incoming rig/group counts, rig names/addresses, selected rig and preferences.
3. Choose **Replace local settings**, or **Cancel** to leave everything unchanged.

Previewing/cancelling does not disconnect or mutate definitions. Confirmation synchronously disconnects MixMate, clears received state and disarms, then applies the imported profile/target and preferences. It never connects automatically or changes mixer parameters. User-entered text in preview/picker is rendered as text, never HTML.

Unknown fields, malformed JSON, unsupported versions, invalid addresses/identities/preferences and invalid references are rejected without mutation. Original member/profile ordering is preserved. A null selected profile remains an unbound temporary target, including after preferences or reload. Import is whole-document replacement, not a merge.

A fresh edit, profile selection, preference change, Connect action or newer file choice invalidates an old pending read/preview. A late save result reports persistence status only; it cannot retarget a newer draft or socket. The repository's atomic baseline guard also prevents another window's newer durable settings from being overwritten. In that case the imported definitions remain usable/exportable in temporary memory, with explicit conflict and unsaved messages. No automatic retry, reload or merge occurs.

## Reset

**Reset local settings** opens a preview explaining that all local rig/group definitions will be removed and display preferences returned to defaults. Confirm **Reset local settings** or Cancel. Confirmation disconnects/disarms before applying the empty document. The default address stays available as an unsaved target; create a rig explicitly when needed. A durably stored empty reset/import stays empty after reopening and does not silently recreate `My rig` or revive an old address.

Reset only replaces MixMate's settings record. It does not clear origin storage, delete databases, unregister workers, delete app caches, remove offline version history or touch other apps' keys. The obsolete `mixmate-address` key is removed only after durable settings commit. Record-presence metadata prevents that key being remigrated even if its removal fails. First-use migration/default-profile creation is restricted to an absent settings record, after IndexedDB lookup; an intentional empty record is different.

Unavailable, corrupt, unsupported/newer or conflicted storage is **not forcibly erased**. Reset/import can apply temporary defaults/definitions and export them, but the unknown/newer durable record remains untouched. The preview and result label this limitation. A destructive unknown-version database reset is deliberately parked; it must never be implemented as an uncancellable background `deleteDatabase` request or a silent origin-wide reset. Use the matching newer app version or a later explicitly scoped recovery path if durable recovery of such a record is needed. Closing this app can discard temporary changes; export before closing.

## Storage protection

The app reads `navigator.storage.persisted()` where available. It calls `persist()` only after **Request storage protection**. A denial, unavailable API or error leaves the app usable and advises a backup. A grant protects against automatic removal according to browser policy, not deliberate user clearing or all forms of storage failure. This browser permission is origin-scoped, not a private guarantee for one Pages subpath; it does not establish complete offline readiness. Keep verifying the separate offline asset status.

Physical Chrome/Safari retention, file handling and installed-app behavior remain part of F08-S01 device qualification. Browser/installed storage sharing is not assumed. [Storage Standard](https://storage.spec.whatwg.org/), [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).
