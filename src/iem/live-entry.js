import { mountShell } from './shell.js';
import { mountReadOnlyView } from './live-view.js';
import { createReadOnlySession } from './live-session.js';
import { createLiveConnectionUI, mountLiveController } from './live-controller.js';
import { mountGroupEditor } from './group-editor.js';
import { createGroupEditorUI } from './group-editor-ui.js';
import { SettingsRepository } from '../settings.js';
import { prepareEntryOffline } from './entry-offline.js';
const root = mountShell(document.getElementById('iem-root'), 'live');
const session = createReadOnlySession(), repository = new SettingsRepository();
let controller;
const view = mountReadOnlyView(root, { onSelectAux: index => controller.selectAux(index), onOverview: () => controller.overview(), onToggleGroup: id => controller.toggleGroup(id), onAllChannels: () => controller.allChannels() });
const connectionUI = createLiveConnectionUI(root);
controller = mountLiveController({ session, repository, view, ui: connectionUI });
mountGroupEditor({ repository, controller, ui: createGroupEditorUI(root, connectionUI), setEnabled: value => view.groupEditing(value),
  confirmClear: () => window.confirm('Clear all source selections from this group draft? Save group to apply the change.') });
prepareEntryOffline(root.querySelector('.mm-offline-state'));
