import { sourceLabel } from './live-provider.js';

// Local definitions describe order, never mixer availability or aggregate levels.
export function resolveGroupNavigation(groups, requested) {
  const fallback = groups.length ? 'groups' : 'channels';
  const view = ['groups', 'channels'].includes(requested?.view) ? requested.view : fallback;
  const group = view === 'groups' ? groups.find(group => group.id === requested?.expandedGroupId) : null;
  const notice = requested?.view === 'eq' ? 'Saved EQ view is unavailable; showing a read-only view.'
    : view === 'groups' && requested?.expandedGroupId && !group ? 'Saved group is unavailable; showing group masters.' : '';
  return { view, expandedGroupId: group?.id || null, notice };
}
// Display-only start of the full-range group fader: the loudest member's
// currently displayed position (F09-S08). That is the received position, or this
// owner's requested value while its own member gesture/live steps are active (so
// the cap tracks a member drag instead of flickering). Position 0 (-inf) counts.
// null only when no member has any finite position. Presentation only: the
// private session freezes its own anchor at each group gesture.
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function displayedMemberPosition(source, control) {
  const selected = control?.selected;
  if (selected?.kind === 'send' && (control.gestureActive || control.pending) && unit(control.requestedValue) && selected.auxIndex === source?.auxIndex &&
      (selected.sourceId === source.sourceId || source.levelPeerIds?.includes(selected.sourceId))) return control.requestedValue;
  return unit(source?.position) ? source.position : null;
}
export function groupReferencePosition(group, sources, control) {
  const byId = new Map((sources || []).map(source => [source.sourceId, source]));
  const values = group.members.map(id => byId.has(id) ? displayedMemberPosition(byId.get(id), control) : null).filter(unit);
  return values.length ? Math.max(...values) : null;
}
function groupSources(group, sources, aux) {
  const byId = new Map(sources.map(source => [source.sourceId, source]));
  return group.members.map(id => byId.get(id) || {
    id: `${id}@${aux}`, sourceId: id, unresolved: true,
    name: `${sourceLabel(id)} · Unresolved`, detail: 'Not observed for this AUX; retained group member',
    panText: 'Pan unavailable', stateText: 'No received send state',
  });
}
function master(group, profileId, aux, control, sources) {
  const controls = Boolean(control);
  return { referencePosition: groupReferencePosition(group, sources, control), id: `group:${profileId}:${group.id}@${aux}`, renderKey: `group:${profileId}:${group.id}`, kind: 'group', groupId: group.id, name: group.name,
    detail: `${group.members.length} member${group.members.length === 1 ? '' : 's'} · ${controls ? 'common Δ · no group VU' : 'relative level unavailable'}`,
    levelText: 'Unavailable', stateText: controls ? 'Drag or use keys · cap at loudest member · live common Δ' : 'Group level unavailable · read-only', panText: '', browsable: false };
}
export function projectGroupNavigation(base, profile, requested) {
  const groups = profile?.groups || [], navigation = resolveGroupNavigation(groups, requested);
  if (base.selectedAux === null || base.selectedAux === undefined) return { ...base, groups: [], view: 'overview', expandedGroupId: null, showAuxMaster: false };
  const result = { ...base, groups: groups.map(group => ({ id: group.id, name: group.name })), ...navigation, showAuxMaster: !navigation.expandedGroupId };
  if (navigation.view === 'channels') return result;
  const group = groups.find(group => group.id === navigation.expandedGroupId);
  const channels = group ? groupSources(group, base.sources, base.selectedAux) : [];
  const sources = group ? [group] : groups;
  return {
    ...result,
    sources: [...sources.map(item => master(item, profile.id, base.selectedAux, base.control, base.sources)), ...channels],
    nudgePreview: {
      profileId: profile?.id,
      groups: groups.map(item => ({ id: item.id, name: item.name, position: groupReferencePosition(item, base.sources) })),
      expanded: group ? { id: group.id, name: group.name, channels } : null,
    },
  };
}
