import { getLAFlag } from '../tools/flag-utils.js';
import { localize } from '../tools/string-utils.js';
import { tfTeamsColorSides, tfGetTeams, tfGetTeam, tfGetDisposition } from '../tools/token-factions-utils.js';
import { getTokenNameView } from '../tah/tokenStatHint.js';
import { isStatBarActive, statBarAccess, getStatHubModel } from '../tah/tokenStatBar.js';
import { statusIconEntries, statusBadge } from '../bonuses/flagged-effects.js';
import { hasReaction } from '../utils/lancer-token.js';
import { deployablesOf } from '../interactive/deployable-owner.js';
import { stripDeployOwner } from '../interactive/detail-renderers.js';
import { actorActionSpent, subHasLimits, actionWithFrequency } from '../combat/per-frequency-tags.js';
import { getReinforcements, draftToken, reinforcementClock } from '../combat/reinforcements.js';
import { isWorldClockShownTo, worldClockFill } from '../tools/world-clocks.js';
import { isLeaving } from '../combat/leave-battlefield.js';

export const EVENT_FLAG = 'carouselEvent';

const TYPE_RANK = { mech: 0, pilot: 1, npc: 2, deployable: 3 };

const RELATION_RANK = { '2': 0, '1': 1, '-1': 2, '0': 3, '-2': 4 };

const UNKNOWN_RANK = 5;

const UNKNOWN_TEAM_COLOR = '#9aa0a8';

const DISPOSITION_SIDES = {
    '2': { label: 'LA.carousel.side.player', color: 'PARTY' },
    '1': { label: 'TOKEN.DISPOSITION.FRIENDLY', color: 'FRIENDLY' },
    '0': { label: 'TOKEN.DISPOSITION.NEUTRAL', color: 'NEUTRAL' },
    '-1': { label: 'TOKEN.DISPOSITION.HOSTILE', color: 'HOSTILE' },
    '-2': { label: 'TOKEN.DISPOSITION.SECRET', color: 'SECRET' },
};

function dispositionColor(key)
{
    const value = CONFIG.Canvas.dispositionColors?.[key];
    return value === undefined ? '#888888' : foundry.utils.Color.from(value).css;
}

function dispositionSide(disposition)
{
    const key = String(DISPOSITION_SIDES[String(disposition)] ? disposition : -2);
    const side = DISPOSITION_SIDES[key];
    return { key: `disposition:${key}`, name: localize(side.label), color: dispositionColor(side.color), rank: RELATION_RANK[key], order: Infinity, events: false };
}

function eventSide()
{
    return { key: 'events', name: localize('LA.carousel.lane.events'), color: '#888888', rank: Infinity, order: Infinity, events: true };
}

function unknownSide()
{
    return { key: 'unknown', name: '?', color: UNKNOWN_TEAM_COLOR, rank: UNKNOWN_RANK, order: Infinity, events: false };
}

function resolveSides(combatants)
{
    const teamsOn = tfTeamsColorSides();
    const teams = teamsOn ? tfGetTeams() : [];
    const teamOf = combatant => (teamsOn && combatant.token ? tfGetTeam(combatant.token) : null);
    const playerRef = combatants.find(combatant => combatant.token && combatant.actor?.hasPlayerOwner && !getLAFlag(combatant, EVENT_FLAG));
    const playerTeam = playerRef ? teamOf(playerRef) : null;
    const teamSides = new Map();
    const sides = new Map();

    for (const combatant of combatants)
    {
        if (getLAFlag(combatant, EVENT_FLAG))
        {
            sides.set(combatant.id, eventSide());
            continue;
        }

        const team = teams.find(entry => entry.id === teamOf(combatant));

        if (!team)
        {
            sides.set(combatant.id, dispositionSide(combatant.disposition));
            continue;
        }

        if (!teamSides.has(team.id))
        {
            let relation = team.gmDisposition;
            if (team.id === playerTeam)
                relation = 2;
            else if (playerRef)
                relation = tfGetDisposition(playerRef.token, combatant.token) ?? relation;
            teamSides.set(team.id, {
                key: `team:${team.id}`,
                name: team.name,
                color: team.color || '#888888',
                rank: RELATION_RANK[String(relation)] ?? RELATION_RANK['0'],
                order: teams.indexOf(team),
                events: false,
            });
        }

        sides.set(combatant.id, teamSides.get(team.id));
    }

    return sides;
}

function barValues(model)
{
    const values = { overshield: model.overshield, armor: model.armor };

    for (const row of model.rows)
    {
        if (row.pips)
            values[row.pips.id] = row.pips.value;
        if (row.bar)
            values[row.bar.id] = row.bar.value;
    }

    for (const line of model.extras)
    {
        for (const entry of line)
            values[`extra:${entry.id}`] = entry.value;
    }

    return values;
}

export function cardStatusEntries(actor)
{
    const defeatedId = CONFIG.specialStatusEffects.DEFEATED;
    return statusIconEntries(actor).filter(entry => !entry.effect.statuses?.has(defeatedId));
}

function statusList(actor)
{
    return cardStatusEntries(actor).map(entry => ({ img: entry.effect.img, badge: statusBadge(entry) }));
}

export const eventRound = combat => Math.max(1, combat.round ?? 0);

export function eventRoundsLeft(event, combat)
{
    const duration = Number(event?.duration) || 0;
    if (duration <= 0)
        return null;
    return Math.max(0, duration - (eventRound(combat) - (Number(event.roundCreated) || 1)));
}

function deployableKind(token)
{
    const type = String(token.actor?.system?.type ?? '');
    if (/drone/i.test(type))
        return 0;
    if (/turret/i.test(token.document.name))
        return 1;
    return /mine/i.test(type) ? 2 : 3;
}

function deployableState(token)
{
    const actor = token.actor;
    const hp = actor?.system?.hp;
    if (actor?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || (hp?.max > 0 && hp.value <= 0))
        return 'down';

    const limited = (actor?.system?.actions ?? []).map(action => actionWithFrequency(action)).filter(action => subHasLimits(action));
    return limited.length && limited.every(action => actorActionSpent(actor, action)) ? 'used' : 'ready';
}

function deployableChips(tokenDoc, combatTokenIds)
{
    if (!tokenDoc?.id || !canvas.ready)
        return [];

    const groups = new Map();
    const barsOn = isStatBarActive();

    for (const token of deployablesOf([tokenDoc.id]))
    {
        const hidden = !!token.document.hidden;
        if (combatTokenIds.has(token.document.id) || !(game.user.isGM || (hidden ? token.isOwner : token.isVisible)))
            continue;

        const name = stripDeployOwner(token.document.name);
        const state = deployableState(token);
        const key = `${name}|${state}`;
        const hp = token.actor?.system?.hp;

        if (!groups.has(key))
            groups.set(key, { name, state, kind: deployableKind(token), art: token.document.texture?.src ?? token.actor?.img ?? CONST.DEFAULT_TOKEN, hidden, tokenIds: [], hp: 0, hpMax: 0, hpShown: false });

        const group = groups.get(key);
        group.tokenIds.push(token.document.id);
        group.hidden &&= hidden;
        group.hp += Math.max(0, Number(hp?.value) || 0);
        group.hpMax += Number(hp?.max) || 0;
        group.hpShown ||= barsOn && !!statBarAccess(token);
    }

    return [...groups.values()].sort((left, right) => left.kind - right.kind || left.name.localeCompare(right.name) || left.state.localeCompare(right.state));
}

function cardData(combatant, combat, currentId, combatTokenIds)
{
    const tokenDoc = combatant.token ?? null;
    const token = tokenDoc?.object ?? null;
    const actor = combatant.actor ?? null;
    const event = getLAFlag(combatant, EVENT_FLAG);
    const defeated = !!combatant.isDefeated;
    const activations = event ? { value: 0, max: 0 } : (combatant.activations ?? { value: 0, max: 0 });
    const model = !event && token && isStatBarActive() ? getStatHubModel(token) : null;
    const access = model ? statBarAccess(token) : null;
    return {
        id: combatant.id,
        tokenId: tokenDoc?.id ?? null,
        img: combatant.img ?? combatant._thumb ?? CONST.DEFAULT_TOKEN,
        needsThumb: !!combatant._videoSrc && !combatant.img && !combatant._thumb,
        name: event || (!tokenDoc && !actor) ? { text: combatant.name ?? '', unknown: false } : getTokenNameView(tokenDoc, actor),
        type: actor?.type ?? null,
        active: combatant.id === currentId,
        defeated,
        hidden: !!combatant.hidden,
        owner: !!combatant.isOwner,
        actsValue: Number(activations.value) || 0,
        actsMax: Number(activations.max) || 0,
        actsLeft: defeated ? 0 : Number(activations.value) || 0,
        statuses: event ? [] : statusList(actor),
        bar: access ? model : null,
        values: model ? barValues(model) : null,
        flashOnly: access === 'flash',
        reaction: access && actor && hasReaction(actor) ? actor.system?.action_tracker?.reaction === true : null,
        roundsLeft: event ? eventRoundsLeft(event, combat) : null,
        event: !!event,
        leaving: !event && isLeaving(actor),
        canPing: !event && combatant.sceneId === canvas.scene?.id && game.user.hasPermission('PING_CANVAS'),
        deps: event || actor?.type === 'deployable' ? [] : deployableChips(tokenDoc, combatTokenIds),
    };
}

function incomingUnits(combat)
{
    return getReinforcements(combat)
        .filter(entry => game.user.isGM || entry.visibility !== 'secret')
        .map((entry) =>
        {
            const token = draftToken(entry);
            const actor = token.actor;
            const party = token.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY && !!actor?.hasPlayerOwner;
            return { id: entry.id, entry, token, actor, disposition: party ? 2 : token.disposition };
        });
}

function incomingCard({ entry, token, actor }, combat)
{
    const known = game.user.isGM || entry.visibility === 'full';
    const current = combat.round ?? 0;
    const byClock = !!entry.clock;
    const clock = byClock ? reinforcementClock(entry) : null;
    const clockLeft = clock ? clock.max - clock.value : 0;
    return {
        id: entry.id,
        img: entry.tokenData.texture?.src || actor?.img || CONST.DEFAULT_TOKEN,
        known,
        name: known ? getTokenNameView(token, actor) : { text: localize('LA.reinforcement.unknown'), unknown: true },
        round: entry.round,
        roundsLeft: byClock ? clockLeft : entry.round - current,
        byClock,
        clock: clock && (game.user.isGM || isWorldClockShownTo(clock, game.user)) ? { value: clock.value, max: clock.max, color: worldClockFill(clock) } : null,
        canSooner: !byClock && entry.round - 1 > current,
        visibility: entry.visibility,
        edited: game.user.isGM && !!entry.edited,
        teamHidden: game.user.isGM && !!entry.teamHidden,
    };
}

function compareIncoming(left, right)
{
    return left.round - right.round || left.name.text.localeCompare(right.name.text, undefined, { numeric: true, sensitivity: 'base' }) || left.id.localeCompare(right.id);
}

function compareLanes(left, right)
{
    return left.rank - right.rank || left.order - right.order || left.key.localeCompare(right.key);
}

function compareCards(left, right)
{
    if (left.active !== right.active)
        return left.active ? -1 : 1;
    if (left.actsLeft !== right.actsLeft)
        return right.actsLeft - left.actsLeft;

    const typeGap = (TYPE_RANK[left.type] ?? 2) - (TYPE_RANK[right.type] ?? 2);
    if (typeGap)
        return typeGap;
    return left.name.text.localeCompare(right.name.text, undefined, { numeric: true, sensitivity: 'base' }) || left.id.localeCompare(right.id);
}

export function buildCarouselView(combat)
{
    const currentId = combat.combatant?.id ?? null;
    const combatants = combat.combatants.contents.filter(combatant => combatant.visible);
    const incoming = incomingUnits(combat);
    const sides = resolveSides([...combatants, ...incoming]);
    for (const unit of incoming)
    {
        if (unit.entry.teamHidden && !game.user.isGM)
            sides.set(unit.id, unknownSide());
    }
    const lanes = new Map();
    const combatTokenIds = new Set(combat.combatants.contents.map(combatant => combatant.tokenId).filter(Boolean));

    const laneOf = (id) =>
    {
        const side = sides.get(id);
        if (!lanes.has(side.key))
            lanes.set(side.key, { ...side, cards: [], incoming: [] });
        return lanes.get(side.key);
    };

    for (const combatant of combatants)
        laneOf(combatant.id).cards.push(cardData(combatant, combat, currentId, combatTokenIds));

    for (const unit of incoming)
        laneOf(unit.id).incoming.push(incomingCard(unit, combat));

    const ordered = [...lanes.values()].sort(compareLanes);

    for (const lane of ordered)
    {
        lane.cards.sort(compareCards);
        lane.incoming.sort(compareIncoming);
        const standing = lane.cards.filter(card => !card.defeated);
        lane.actsMax = standing.reduce((sum, card) => sum + card.actsMax, 0);
        lane.actsLeft = standing.reduce((sum, card) => sum + card.actsValue, 0);
    }

    return { combatId: combat.id, started: !!combat.started, currentId, lanes: ordered };
}
