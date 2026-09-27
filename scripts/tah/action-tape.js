import { getLAFlag, setLAFlag } from '../tools/flag-utils.js';
import { localize } from '../tools/string-utils.js';
import { getActivationIcon } from '../tools/misc-tools.js';
import { weaponTypeIcon, getDeployableIcon } from './item-helpers.js';
import { socketRequestWithAck } from '../socket.js';

export const TAPE_FLAG = 'actionTape';
const MAX_ENTRIES = 80;

/** Colour per action type. Quick, full, move, protocol and reaction match ACTION_DEFS in combat-bar.js. */
export const TAPE_COLORS = {
    quick:      '#ff9800',
    full:       '#e65100',
    move:       '#4caf50',
    protocol:   '#00e5e5',
    free:       '#4ed6b8',
    reaction:   '#be51ed',
    quicktech:  '#56d6d6',
    fulltech:   '#0f8f8f',
    invade:     '#7a7aff',
    overcharge: '#eb4034',
    attack:     '#dfe4ea',
    other:      '#9fb0c0'
};

const MOVE_NAMES = new Set(['boost', 'move', 'standing up', 'fall', 'teleport']);

const _rowIcons = new Map();

/**
 * Icon the HUD draws for a named action row. Filled as the HUD builds its rows, so the tape always
 * shows the same file the row does instead of a second guess at it.
 * @param {string} actionName
 * @param {string|null|undefined} icon
 */
export function noteRowIcon(actionName, icon)
{
    const key = String(actionName ?? '').toLowerCase().trim();
    if (key && icon)
        _rowIcons.set(key, icon);
}

/**
 * Action type key for the tape, from an activation string plus the action name.
 * @param {string|null|undefined} activation
 * @param {string|null|undefined} actionName
 * @returns {string} A key of TAPE_COLORS.
 */
export function tapeType(activation, actionName)
{
    const name = String(actionName ?? '').toLowerCase().trim();
    if (name.startsWith('overcharge'))
        return 'overcharge';
    if (MOVE_NAMES.has(name))
        return 'move';

    const normalized = String(activation ?? '').toLowerCase().replaceAll(/[\s-]+/g, '_');
    if (normalized.includes('invade'))
        return 'invade';
    if (normalized.includes('tech'))
        return normalized.includes('full') ? 'fulltech' : 'quicktech';
    if (normalized.includes('protocol'))
        return 'protocol';
    if (normalized.includes('reaction'))
        return 'reaction';
    if (normalized.includes('free'))
        return 'free';
    if (normalized.includes('full'))
        return 'full';
    if (normalized.includes('quick'))
        return 'quick';
    return 'other';
}

/**
 * Icon path for the tape, resolved the way the item's own HUD row resolves it.
 * @param {any} item
 * @param {{name?: string, activation?: string, tech_attack?: boolean}|null} action
 * @param {any} [deployable]
 * @returns {string|null} Icon path, or null when nothing fits.
 */
export function tapeIcon(item, action, deployable = null)
{
    const row = _rowIcons.get(String(action?.name ?? '').toLowerCase().trim());
    if (row)
        return row;

    if (deployable)
        return getDeployableIcon(deployable);

    const type = String(item?.type ?? '');
    const isWeapon = type.includes('weapon')
        || (type === 'npc_feature' && String(item?.system?.type ?? '').toLowerCase() === 'weapon');
    if (isWeapon)
        return weaponTypeIcon(item);

    return getActivationIcon(action ?? {}) ?? item?.img ?? null;
}

/**
 * The combatant for a token in the running combat.
 * @param {any} token
 * @returns {any|null}
 */
function combatantFor(token)
{
    const tokenId = token?.document?.id ?? token?.id ?? null;
    if (!tokenId || !game.combat?.active)
        return null;
    return game.combat.combatants.find(entry => entry.tokenId === tokenId) ?? null;
}

/**
 * Every action the token has taken this combat, oldest first.
 * @param {any} token
 * @returns {Array<any>}
 */
export function getTape(token)
{
    return getLAFlag(combatantFor(token), TAPE_FLAG, []) ?? [];
}

/**
 * Rounds that carry at least one entry, ascending.
 * @param {any} token
 * @returns {number[]}
 */
export function tapeRounds(token)
{
    return [...new Set(getTape(token).map(entry => entry.round))].sort((left, right) => left - right);
}

/**
 * Combatant flags are GM-owned, so players hand the write to the executor GM.
 * @param {any} combatant
 * @param {Array<any>} entries
 * @returns {Promise<any>}
 */
async function writeTape(combatant, entries)
{
    if (game.user.isGM)
        return setLAFlag(combatant, TAPE_FLAG, entries);
    return socketRequestWithAck('combatAction', {
        method: 'writeActionTape',
        combatId: game.combat.id,
        combatantId: combatant.id,
        entries
    });
}

/**
 * Append one action to the token's tape. No-op out of combat.
 * @param {any} token
 * @param {{name: string, activation?: string, item?: any, deployable?: any, icon?: string|null, type?: string}} action
 * @returns {Promise<void>}
 */
export async function recordAction(token, action)
{
    const combatant = combatantFor(token);
    if (!combatant || !action?.name)
        return;
    const entries = [...getLAFlag(combatant, TAPE_FLAG, [])];
    entries.push({
        id: foundry.utils.randomID(),
        name: action.name,
        type: action.type ?? tapeType(action.activation, action.name),
        icon: action.icon
            ?? tapeIcon(action.item ?? null, { name: action.name, activation: action.activation }, action.deployable ?? null),
        activation: action.activation ?? '',
        round: game.combat.round ?? 1,
        at: Date.now()
    });
    await writeTape(combatant, entries.slice(-MAX_ENTRIES));
}

const _viewRound = new Map();

/**
 * Round the tape is currently showing for a token. Follows the live round until the user pages away,
 * and snaps back as soon as the combat moves on.
 * @param {string} tokenId
 * @param {number} current
 * @returns {number}
 */
function viewRoundFor(tokenId, current)
{
    const stored = _viewRound.get(tokenId);
    if (!stored || stored.current !== current)
    {
        _viewRound.set(tokenId, { current, view: current });
        return current;
    }
    return stored.view;
}

/**
 * Glyph markup for a tape entry. Icon paths become tinted masks, font classes stay font classes.
 * @param {any} entry
 * @returns {string}
 */
function tapeGlyph(entry)
{
    const icon = entry?.icon;
    if (!icon)
        return '';
    if (String(icon).endsWith('.svg') || /\.(png|webp|jpe?g)$/i.test(String(icon)))
        return `<span class="la-tape-ico" style="mask-image:url('${icon}');-webkit-mask-image:url('${icon}');"></span>`;
    return `<i class="${icon} la-tape-ico-font"></i>`;
}

/**
 * The tape element for a token, or null when there is nothing to show.
 * @param {any} token
 * @returns {JQuery|null}
 */
export function buildActionTape(token)
{
    if (!token || !game.combat?.active || !combatantFor(token))
        return null;

    const current = game.combat.round ?? 1;
    const tokenId = token.document?.id ?? token.id;
    const view = viewRoundFor(tokenId, current);
    const entries = getTape(token).filter(entry => entry.round === view);

    const bar = $(`<div id="la-action-tape" class="la-action-tape${view === current ? '' : ' la-tape-past'}"></div>`);
    const back = $(`<button type="button" class="la-tape-nav" aria-label="${localize('LA.tape.previousTurn')}">◀</button>`);
    const forward = $(`<button type="button" class="la-tape-nav" aria-label="${localize('LA.tape.nextTurn')}">▶</button>`);
    back.prop('disabled', view <= 1);
    forward.prop('disabled', view >= current);

    const page = (delta) =>
    {
        const next = Math.min(current, Math.max(1, view + delta));
        _viewRound.set(tokenId, { current, view: next });
        Hooks.callAll('forceUpdateTokenActionHud');
    };
    back.on('click', (event) =>
    {
        event.stopPropagation(); page(-1);
    });
    forward.on('click', (event) =>
    {
        event.stopPropagation(); page(1);
    });

    bar.append(back);
    bar.append($(`<span class="la-tape-round">R${view}</span>`));

    const strip = $(`<div class="la-tape-strip"></div>`);
    if (!entries.length)
        strip.append($(`<span class="la-tape-empty">${localize('LA.tape.noActions')}</span>`));
    for (const entry of entries)
    {
        const ink = TAPE_COLORS[entry.type] ?? TAPE_COLORS.other;
        const chip = $(`<button type="button" class="la-tape-chip" data-entry-id="${entry.id}"`
            + ` style="--la-tape-ink:${ink};"`
            + ` data-tooltip="${foundry.utils.escapeHTML(entry.name)}" data-tooltip-direction="UP">`
            + tapeGlyph(entry) + `</button>`);
        chip.on('contextmenu', async (event) =>
        {
            event.preventDefault();
            event.stopPropagation();
            await removeTapeEntry(token, entry.id);
            Hooks.callAll('forceUpdateTokenActionHud');
        });
        strip.append(chip);
    }
    bar.append(strip);
    bar.append(forward);

    setTimeout(() =>
    {
        const node = strip[0];
        if (node)
            node.scrollLeft = node.scrollWidth;
        const combatBar = document.getElementById('la-combat-bar');
        if (combatBar?.offsetWidth && bar[0])
            bar[0].style.width = `${combatBar.offsetWidth}px`;
    }, 0);

    return bar;
}

/**
 * Drop one entry from the token's tape.
 * @param {any} token
 * @param {string} id
 * @returns {Promise<any|null>} The removed entry, or null when it was already gone.
 */
export async function removeTapeEntry(token, id)
{
    const combatant = combatantFor(token);
    if (!combatant)
        return null;
    const entries = [...getLAFlag(combatant, TAPE_FLAG, [])];
    const at = entries.findIndex(entry => entry.id === id);
    if (at < 0)
        return null;
    const [removed] = entries.splice(at, 1);
    await writeTape(combatant, entries);
    return removed;
}
