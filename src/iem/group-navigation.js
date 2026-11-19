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
// Display-only start of the full-range group fader: the loudest member's received
// position. The private session freezes its own anchor at each gesture.
function referencePosition(group, sources) {
  const byId = new Map((sources || []).map(source => [source.sourceId, source]));
  const values = group.members.map(id => byId.get(id)?.position).filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1);
  return values.length ? Math.max(...values) : null;
}
function master(group, profileId, aux, controls, sources) {
  return { referencePosition: referencePosition(group, sources), id: `group:${profileId}:${group.id}@${aux}`, renderKey: `group:${profileId}:${group.id}`, kind: 'group', groupId: group.id, name: group.name,
    detail: `${group.members.length} member${group.members.length === 1 ? '' : 's'} · ${controls ? 'common Δ · no group VU' : 'relative level unavailable'}`,
    levelText: 'Unavailable', stateText: controls ? 'Drag or use keys · cap at loudest member · live common Δ' : 'Group level unavailable · read-only', panText: '', browsable: false };
}
export function projectGroupNavigation(base, profile, requested) {
  const groups = profile?.groups || [], navigation = resolveGroupNavigation(groups, requested);
  if (base.selectedAux === null || base.selectedAux === undefined) return { ...base, groups: [], view: 'overview', expandedGroupId: null, showAuxMaster: false };
  const result = { ...base, groups: groups.map(group => ({ id: group.id, name: group.name })), ...navigation, showAuxMaster: !navigation.expandedGroupId };
  if (navigation.view === 'channels') return result;
  const group = groups.find(group => group.id === navigation.expandedGroupId);
  if (!group) return { ...result, sources: groups.map(group => master(group, profile.id, base.selectedAux, Boolean(base.control), base.sources)) };
  const byId = new Map(base.sources.map(source => [source.sourceId, source]));
  return { ...result, sources: [master(group, profile.id, base.selectedAux, Boolean(base.control), base.sources), ...group.members.map(id => byId.get(id) || {
    id: `${id}@${base.selectedAux}`, sourceId: id, unresolved: true,
    name: `${sourceLabel(id)} · Unresolved`, detail: 'Not observed for this AUX; retained group member',
    panText: 'Pan unavailable', stateText: 'No received send state',
  })] };
}
