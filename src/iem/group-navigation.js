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
function master(group, profileId, aux, controls) {
  return { id: `group:${profileId}:${group.id}@${aux}`, kind: 'group', groupId: group.id, name: group.name,
    detail: `${group.members.length} member${group.members.length === 1 ? '' : 's'} · ${controls ? 'relative Δ · no group VU' : 'relative level unavailable'}`,
    levelText: 'Unavailable', stateText: controls ? 'Select level, then enable · Δ 0 per gesture' : 'Group level unavailable · read-only', panText: '', browsable: false };
}
export function projectGroupNavigation(base, profile, requested) {
  const groups = profile?.groups || [], navigation = resolveGroupNavigation(groups, requested);
  if (base.selectedAux === null || base.selectedAux === undefined) return { ...base, groups: [], view: 'overview', expandedGroupId: null, showAuxMaster: false };
  const result = { ...base, groups: groups.map(group => ({ id: group.id, name: group.name })), ...navigation, showAuxMaster: !navigation.expandedGroupId };
  if (navigation.view === 'channels') return result;
  const group = groups.find(group => group.id === navigation.expandedGroupId);
  if (!group) return { ...result, sources: groups.map(group => master(group, profile.id, base.selectedAux, Boolean(base.control))) };
  const byId = new Map(base.sources.map(source => [source.sourceId, source]));
  return { ...result, sources: [master(group, profile.id, base.selectedAux, Boolean(base.control)), ...group.members.map(id => byId.get(id) || {
    id: `${id}@${base.selectedAux}`, sourceId: id, unresolved: true,
    name: `${sourceLabel(id)} · Unresolved`, detail: 'Not observed for this AUX; retained group member',
    panText: 'Pan unavailable', stateText: 'No received send state',
  })] };
}
