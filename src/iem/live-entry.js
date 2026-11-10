import { mountShell } from './shell.js';
import { mountReadOnlyView } from './live-view.js';
import { createAuxLevelSession } from './aux-level-session.js';
import { createLiveConnectionUI, mountLiveController } from './live-controller.js';
import { mountGroupEditor } from './group-editor.js';
import { createGroupEditorUI } from './group-editor-ui.js';
import { SettingsRepository } from '../settings.js';
import { prepareEntryOffline } from './entry-offline.js';
const root = mountShell(document.getElementById('iem-root'), 'live');
const session = createAuxLevelSession(), repository = new SettingsRepository();
let controller;
const view = mountReadOnlyView(root, { onSelectAux: index => controller.selectAux(index), onOverview: () => controller.overview(), onToggleGroup: id => controller.toggleGroup(id), onAllChannels: () => controller.allChannels(),
  onSelectLevel: target => controller.selectLevel(target), onToggleLevel: () => controller.toggleLevel(),
  onBeginLevel: () => session.beginLevelGesture(), onCommitLevel: (token, value) => session.commitLevelGesture(token, value), onCancelLevel: () => session.cancelLevelGesture() });
const connectionUI = createLiveConnectionUI(root, { levels: true });
controller = mountLiveController({ session, repository, view, ui: connectionUI });
mountGroupEditor({ repository, controller, ui: createGroupEditorUI(root, connectionUI), setEnabled: value => view.groupEditing(value),
  confirmClear: () => window.confirm('Clear all source selections from this group draft? Save group to apply the change.') });
prepareEntryOffline(root.querySelector('.mm-offline-state'));

root.addEventListener('click', event => { if (event.target.closest('[data-action="edit-groups"], .mm-connect-toggle, .mm-brand, .mm-desk')) controller.clearLevelContext(); }, true);
