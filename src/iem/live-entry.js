import { mountChannelDetail } from './channel-detail.js';
import { mountShell } from './shell.js';
import { debugFlag, mountReadOnlyView } from './live-view.js';
import { createAuxControlSession } from './aux-control-session.js';
import { createDialogOwner } from './dialog-owner.js';
import { mountPanControls } from './pan-controls.js';
import { mountEqControls } from './eq-controls.js';
import { createLiveConnectionUI, mountLiveController } from './live-controller.js';
import { mountGroupEditor } from './group-editor.js';
import { mountSnapshotControls } from './snapshot-controls.js';
import { mountRecordingControls } from './recording-controls.js';
import { createGroupEditorUI } from './group-editor-ui.js';
import { SettingsRepository } from '../settings.js';
import { prepareEntryOffline } from './entry-offline.js';
import { createInstallPrompt } from './install.js';
import { createUpdateManager, updateBusy, updatedMessage, consumeUpdateSuppress } from './updates.js';
import { buildInfo } from '../build-info.js';
const root = mountShell(document.getElementById('iem-root'), 'live');
// F07-S05: capture the browser's install offer as early as possible (it can fire
// any time after load); the strip is non-modal and sits in flow under the header.
let connectionUI, snapshotControls, recordingControls;
const storageOf = name => { try { return globalThis[name]; } catch { return undefined; } };
const installPrompt = createInstallPrompt({ container: root.querySelector('.mm-app'), before: root.querySelector('.mm-navigation'), storage: storageOf('localStorage'),
  onState: value => connectionUI?.diagnostics.install(value, () => installPrompt.reshow()) });
const repository = new SettingsRepository(), session = createAuxControlSession({ settingsRepository: repository });
let controller, panControls, eqControls, channelDetail;
const dialogOwner = createDialogOwner();
// F09-S07/S09: per-strip Details and the EQ diagnostics below the graph are development-only (index.html?debug).
const debug = debugFlag(window.location.search);
if (debug) root.dataset.debug = 'true';
const view = mountReadOnlyView(root, { debug, onMessage: text => connectionUI.message(text), onGestureStart: () => connectionUI.clearMessage(), onClearMessage: text => { if (connectionUI.diagnostics.currentMessage() === text) connectionUI.clearMessage(); }, onOpenPan: target => panControls.open(target), onOpenEq: auxIndex => eqControls.open(auxIndex), onOpenDetail: model => channelDetail.open(model), onDetailUpdate: models => channelDetail?.update(models), onSelectAux: index => controller.selectAux(index), onOverview: () => controller.overview(), onToggleGroup: id => controller.toggleGroup(id), onAllChannels: () => controller.allChannels(),
  canEditLevel: target => session.canEditLevelTarget(target), onSelectGroupLevel: id => controller.selectGroupLevel(id), onSelectLevel: target => controller.selectLevel(target), onToggleLevel: () => controller.toggleLevel(),
  onBeginLevel: () => session.beginLevelGesture(), onPreviewLevel: (token, value) => session.previewLevelGesture(token, value), onCommitLevel: (token, value) => session.commitLevelGesture(token, value), onCancelLevel: () => session.cancelLevelGesture() });
connectionUI = createLiveConnectionUI(root, { levels: true, pan: true, dialogOwner });
// F02-S05 (user decision 2026-11-20): only this live IEM entry connects
// automatically to known addresses; demo.html and connection-test.html do not.
// F07-S05: an explicit Disconnect before an automatic update reload stays in force for that one reload.
const initialSuppressed = consumeUpdateSuppress(storageOf('sessionStorage'));
controller = mountLiveController({ session, repository, view, ui: connectionUI, autoConnect: true, initialSuppressed });
mountGroupEditor({ repository, controller, ui: createGroupEditorUI(root, connectionUI), setEnabled: value => view.groupEditing(value, controller.context().unavailableReason),
  confirmClear: () => window.confirm('Clear all source selections from this group draft? Save group to apply the change.') });
channelDetail = mountChannelDetail({ root, dialogOwner, onOpen: model => { controller.clearLevelContext(); return view.detailModel(model.id); } });
panControls = mountPanControls({ root, session, controller, dialogOwner, debug });
eqControls = mountEqControls({ root, session, controller, debug });
// F07-S02: header Snapshot (recall) and Save snapshot dialogs over the session's typed snapshot API.
snapshotControls = mountSnapshotControls({ root, session, ui: connectionUI, dialogOwner });
// F07-S03: header Record button and Stop recording dialog over the session's typed recording API.
recordingControls = mountRecordingControls({ root, session, ui: connectionUI, dialogOwner });
connectionUI.diagnostics.install({ text: installPrompt.description(), canShow: false }, () => installPrompt.reshow());
// F07-S05 (user decision 2026-11-21): automatic online updates. A waiting worker is
// applied (skipWaiting + one reload) only while updateBusy() is false; otherwise it
// is applied as soon as the session ends, the gesture/operation finishes or the dialog closes.
const updates = createUpdateManager({ serviceWorker: navigator.serviceWorker, window, document, storage: storageOf('sessionStorage'),
  busy: snapshot => updateBusy({ session, dialogOwner, snapshotControls, recordingControls, snapshot, explicitConnecting: () => controller.explicitConnecting() }),
  carry: () => controller.autoSuppressed(),
  onState: value => { connectionUI.diagnostics.updates(value.text); if (value.announce) connectionUI.message(value.text); } });
// Meter emits cannot change what is busy; other emits pass their snapshot so no extra copy is taken.
session.subscribe((snapshot, kind) => { if (kind !== 'meters') updates.evaluate(snapshot); });
dialogOwner.subscribe(() => updates.evaluate());
if (initialSuppressed) connectionUI.log('Staying disconnected: you disconnected before the update.');
if (updates.consumeNotice()) connectionUI.message(updatedMessage(buildInfo()));
prepareEntryOffline(root.querySelector('.mm-offline-state'), { onPaint: () => connectionUI.refresh(), updates });

root.addEventListener('click', event => { if (event.target.closest('[data-action="edit-groups"], .mm-diagnostics-open, .mm-brand, .mm-desk')) controller.clearLevelContext(); }, true);
