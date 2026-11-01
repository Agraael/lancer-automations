export const STATUS_GROUP_ORDER = ['favorites', 'conditions', 'statuses', 'effects', 'cover', 'resistances', 'movement', 'combat', 'mechState', 'npc', 'other'];
const FIXED_STATUS_GROUPS = {
    conditions: ['immobilized', 'impaired', 'jammed', 'lockon', 'shredded', 'slow', 'stunned', 'dazed'],
    statuses: ['dangerzone', 'downandout', 'engaged', 'exposed', 'hidden', 'invisible', 'intangible', 'prone', 'shutdown', 'overheated', 'hiddeninvis'],
    cover: ['cover_hard', 'cover_soft'],
    resistances: ['resistance_burn', 'resistance_energy', 'resistance_explosive', 'resistance_heat', 'resistance_kinetic', 'resistance_all'],
    movement: ['flying', 'hover', 'climber', 'falling', 'surefoot', 'terrain_immunity', 'immovable', 'disengage'],
    combat: ['aided', 'bolster', 'brace', 'bulwark', 'guardian', 'grappled', 'grappling', 'overshield', 'phasing', 'throttled', 'blinded', 'blind', 'datalinked'],
    mechState: ['burn', 'infection', 'cascading', 'core_power_active', 'reactor_meltdown', 'destroyed'],
    npc: ['npc_tier_1', 'npc_tier_2', 'npc_tier_3', 'tiercust', 'mia', 'commander', 'elite', 'exotic', 'grunt', 'mercenary', 'pirate', 'rpv', 'ship', 'spacer', 'ultra', 'vehicle', 'veteran'],
};
const FIXED_GROUP_BY_ID = new Map(Object.entries(FIXED_STATUS_GROUPS).flatMap(([groupKey, ids]) => ids.map(id => [id, groupKey])));
export const NPC_TIER_IDS = new Set(['npc_tier_1', 'npc_tier_2', 'npc_tier_3', 'tiercust']);

let _statusItemTypes = new Map();

Hooks.on('lancer.statusesReady', async () =>
{
    const types = new Map();
    const pack = game.packs?.get('world.status-items');
    const index = pack ? await pack.getIndex({ fields: ['system.lid', 'system.type'] }) : [];
    for (const entry of /** @type {any} */ (index))
    {
        if (entry.system?.lid && entry.system?.type)
            types.set(entry.system.lid, entry.system.type);
    }
    for (const item of /** @type {any} */ (game.items ?? []))
    {
        if (item.type === 'status' && item.system?.lid && item.system?.type)
            types.set(item.system.lid, item.system.type);
    }
    _statusItemTypes = types;
});

export function statusGroupKey(statusId)
{
    const itemType = _statusItemTypes.get(statusId);
    if (itemType === 'condition')
        return 'conditions';
    if (itemType === 'status')
        return 'statuses';
    return FIXED_GROUP_BY_ID.get(statusId) ?? (itemType === 'effect' ? 'effects' : 'other');
}
