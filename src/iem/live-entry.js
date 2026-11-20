import { mountChannelDetail } from './channel-detail.js';
import { mountShell } from './shell.js';
import { mountReadOnlyView } from './live-view.js';
import { createAuxControlSession } from './aux-control-session.js';
import { createDialogOwner } from './dialog-owner.js';
import { mountPanControls } from './pan-controls.js';
import { mountEqControls } from './eq-controls.js';
import { createLiveConnectionUI, mountLiveController } from './live-controller.js';
import { mountGroupEditor } from './group-editor.js';
import { createGroupEditorUI } from './group-editor-ui.js';
import { SettingsRepository } from '../settings.js';
import { prepareEntryOffline } from './entry-offline.js';
const root = mountShell(document.getElementById('iem-root'), 'live');
const repository = new SettingsRepository(), session = createAuxControlSession({ settingsRepository: repository });
let controller, panControls, eqControls, channelDetail;
const dialogOwner = createDialogOwner();
// F09-S07: per-strip Details diagnostics are development-only (index.html?debug).
const debug = new URLSearchParams(window.location.search).has('debug');
if (debug) root.dataset.debug = 'true';
const view = mountReadOnlyView(root, { debug, onOpenPan: target => panControls.open(target), onOpenEq: auxIndex => eqControls.open(auxIndex), onOpenDetail: model => channelDetail.open(model), onDetailUpdate: models => channelDetail?.update(models), onSelectAux: index => controller.selectAux(index), onOverview: () => controller.overview(), onToggleGroup: id => controller.toggleGroup(id), onAllChannels: () => controller.allChannels(),
  canEditLevel: target => session.canEditLevelTarget(target), onSelectGroupLevel: id => controller.selectGroupLevel(id), onSelectLevel: target => controller.selectLevel(target), onToggleLevel: () => controller.toggleLevel(),
  onBeginLevel: () => session.beginLevelGesture(), onPreviewLevel: (token, value) => session.previewLevelGesture(token, value), onCommitLevel: (token, value) => session.commitLevelGesture(token, value), onCancelLevel: () => session.cancelLevelGesture() });
const connectionUI = createLiveConnectionUI(root, { levels: true, pan: true, dialogOwner });
controller = mountLiveController({ session, repository, view, ui: connectionUI });
mountGroupEditor({ repository, controller, ui: createGroupEditorUI(root, connectionUI), setEnabled: value => view.groupEditing(value),
  confirmClear: () => window.confirm('Clear all source selections from this group draft? Save group to apply the change.') });
channelDetail = mountChannelDetail({ root, dialogOwner, onOpen: model => { controller.clearLevelContext(); return view.detailModel(model.id); } });
panControls = mountPanControls({ root, session, controller, dialogOwner });
eqControls = mountEqControls({ root, session, controller });
prepareEntryOffline(root.querySelector('.mm-offline-state'));

root.addEventListener('click', event => { if (event.target.closest('[data-action="edit-groups"], .mm-connect-toggle, .mm-brand, .mm-desk')) controller.clearLevelContext(); }, true);
