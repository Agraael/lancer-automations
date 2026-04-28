const BASE = 'modules/lancer-automations/icons/stats';

const ICON_FILES = {
    HP:           'hp.svg',
    Armor:        'armor.svg',
    Speed:        'speed.svg',
    'Heat Cap':   'heat.svg',
    Heat:         'heat.svg',
    Evasion:      'evasion.svg',
    'E-Def':      'edef.svg',
    Save:         'save.svg',
    Sensors:      'sensors.svg',
    Size:         'size.svg',
    Activations:  'activations.svg',
    Structure:    'structure.svg',
    Stress:       'stress.svg',
    Hull:         'hull.svg',
    Agi:          'agi.svg',
    Sys:          'sys.svg',
    Eng:          'eng.svg',
};

//rank.svg  or npc_tier.svg
/** @param {number|string|undefined} tier */
function _tierFile(tier) {
    const n = Number(tier);
    if (!Number.isFinite(n))
        return '';
    if (n <= 1)
        return 'npc_tier_1.svg';
    if (n === 2)
        return 'npc_tier_2.svg';
    return 'npc_tier_3.svg';
}

/** @param {number|string|undefined} tier */
export function getTierIcon(tier) {
    const file = _tierFile(tier);
    if (!file)
        return '';
    return `<img class="la-stat-icon" src="${BASE}/${file}" alt="">`;
}

/** @param {string} label */
export function getStatIcon(label) {
    const file = ICON_FILES[label];
    if (!file)
        return '';
    return `<img class="la-stat-icon" src="${BASE}/${file}" alt="">`;
}
