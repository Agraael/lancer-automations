/* global game, canvas, PIXI, performance */

import { _queueCard, _createInfoCard, _removeInfoCard } from "../cards.js";
import { isSingleTargetPickerActive, cancelSingleTargetPicker, createChanceLabel } from "../canvas.js";
import { getOccupiedOffsets } from "../../combat/grid-helpers.js";
import { TG, paintDashedFootprint, createTokenTether } from "../canvas-helpers.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "../presence.js";
import { targetInfoAllowed, targetInfoAllowedFor, UNKNOWN_CHANCE, contestWinChance, chanceLabelsOn } from "../../activations/targeting-ui.js";

const STAT_DEFS = [
    { value: 'HULL', key: 'hull' },
    { value: 'AGI', key: 'agi' },
    { value: 'SYS', key: 'sys' },
    { value: 'ENG', key: 'eng' },
    { value: 'GRIT', key: 'grit' },
];

function contestStats(actor)
{
    if (!actor)
        return [];
    return STAT_DEFS.filter(d => actor.system?.[d.key] !== undefined);
}

// Two-token / two-stat HASE contest card. Any of tokenA/skillA/tokenB/skillB can be pre-set.
export function openHaseContestCard({ tokenA = null, skillA = null, tokenB = null, skillB = null, title = 'HASE Contest', sendToOwner = true,
    accuracy1 = 0, difficulty1 = 0, flatModifier1 = 0, accuracy2 = 0, difficulty2 = 0, flatModifier2 = 0,
    sourceItem = null, sourceAction = null, extraData = null } = {})
{
    return _queueCard(() => new Promise((resolve) =>
    {
        const api = game.modules.get('lancer-automations')?.api;
        const state = {
            a: { token: tokenA ?? null, skill: skillA ? String(skillA).toUpperCase() : null, mark: null, chance: null },
            b: { token: tokenB ?? null, skill: skillB ? String(skillB).toUpperCase() : null, mark: null, chance: null },
            sendToOwner: sendToOwner !== false,
        };

        const clearChanceLabels = () =>
        {
            for (const side of ['a', 'b'])
            {
                state[side].chance?.destroy();
                state[side].chance = null;
            }
        };
        const syncChanceLabels = () =>
        {
            clearChanceLabels();
            if (!chanceLabelsOn() || !targetInfoAllowed())
                return;
            const { a, b } = state;
            if (!(a.token?.actor && a.skill && b.token?.actor && b.skill))
                return;
            const masked = !targetInfoAllowedFor(a.token.actor) || !targetInfoAllowedFor(b.token.actor);
            a.chance = createChanceLabel(a.token, () => masked ? UNKNOWN_CHANCE : contestWinChance(a.token?.actor, a.skill, b.token?.actor, b.skill, {}));
            b.chance = createChanceLabel(b.token, () => masked ? UNKNOWN_CHANCE : contestWinChance(b.token?.actor, b.skill, a.token?.actor, a.skill, {}));
        };

        // Same gold pulsing footprint as the attack-roll smart-targeting shape (target-shapes.js).
        let markG = null;
        let markPulse = null;
        let tether = null;

        // Broadcast the two contender footprints as a gold ghost, like placed shapes. Hidden tokens excluded.
        const presenceData = () =>
        {
            const placedCells = [];
            for (const side of ['a', 'b'])
            {
                const token = state[side].token;
                if (!token || token.document?.hidden)
                    continue;
                for (const o of getOccupiedOffsets(token))
                    placedCells.push(`${o.col},${o.row}`);
            }
            return { placedCells, placedColor: TG.placed };
        };
        const stopHeartbeat = startToolHeartbeat('haseContest', () => presenceData());
        const ensureMarkContainer = () =>
        {
            if (markG || !canvas?.stage)
                return;
            markG = new PIXI.Container();
            canvas.stage.addChild(markG).eventMode = 'none';
            markPulse = () =>
            {
                if (!markG || markG.destroyed)
                {
                    canvas.app.ticker.remove(markPulse);
                    markPulse = null;
                    markG = null;
                    return;
                }
                markG.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
                for (const side of ['a', 'b'])
                {
                    const token = state[side].token;
                    const markGraphic = state[side].mark;
                    if (token && markGraphic && !markGraphic.destroyed)
                        paintMark(token, markGraphic);
                }
            };
            canvas.app.ticker.add(markPulse);
        };
        // repaint at the token's current cells each tick so the mark follows it
        const paintMark = (token, markGraphic) =>
        {
            markGraphic.clear();
            const cells = getOccupiedOffsets(token).map(offset => [offset.col, offset.row]);
            paintDashedFootprint(markGraphic, cells, TG.placed);
        };
        const drawMark = (token) =>
        {
            if (!token || !canvas?.stage)
                return null;
            ensureMarkContainer();
            const markGraphic = new PIXI.Graphics();
            paintMark(token, markGraphic);
            markG.addChild(markGraphic);
            return markGraphic;
        };
        const clearMark = (side) =>
        {
            if (state[side].mark && !state[side].mark.destroyed)
                state[side].mark.destroy();
            state[side].mark = null;
        };
        const destroyMarks = () =>
        {
            if (markPulse)
            {
                canvas.app.ticker.remove(markPulse);
                markPulse = null;
            }
            if (markG && !markG.destroyed)
                markG.destroy({ children: true });
            markG = null;
            tether?.destroy();
            tether = null;
        };
        const refreshTether = () =>
        {
            if (!state.a.token || !state.b.token)
            {
                tether?.setPairs([]);
                return;
            }
            tether ??= createTokenTether();
            tether.setPairs([[state.a.token, state.b.token]]);
        };

        let cardEl;
        const cleanup = () =>
        {
            if (isSingleTargetPickerActive())
                cancelSingleTargetPicker();
            stopHeartbeat();
            clearToolPresence('haseContest');
            clearChanceLabels();
            destroyMarks();
            _removeInfoCard(cardEl);
        };

        cardEl = _createInfoCard("haseContest", {
            title: "HASE CONTEST",
            onCancel: () =>
            {
                cleanup();
                resolve(null);
            },
        });

        const updateRun = () =>
        {
            const ready = !!(state.a.token && state.a.skill && state.b.token && state.b.skill);
            cardEl.find('[data-action="run-contest"]').prop('disabled', !ready);
        };

        const renderSide = (side) =>
        {
            const s = state[side];
            const colEl = cardEl.find(`[data-side="${side}"]`);
            const token = s.token;
            clearMark(side);
            if (token)
                s.mark = drawMark(token);
            refreshTether();
            broadcastToolPresence('haseContest', presenceData());

            const img = colEl.find('[data-role="token-img"]');
            const src = token ? (token.document?.texture?.src ?? '') : '';
            if (src)
            {
                img.attr('src', src).css('display', '');
                colEl.find('[data-role="token-placeholder"]').css('display', 'none');
            }
            else
            {
                img.css('display', 'none');
                colEl.find('[data-role="token-placeholder"]').css('display', '');
            }
            colEl.find('[data-role="token-label"]').text(token ? (token.name ?? token.document?.name ?? '?') : 'Pick token');

            const select = colEl.find('[data-role="skill"]');
            const stats = contestStats(token?.actor);
            const prev = s.skill;
            select.empty();
            if (stats.length)
            {
                for (const st of stats)
                    select.append(`<option value="${st.value}">${st.value}</option>`);
                s.skill = stats.some(st => st.value === prev) ? prev : stats[0].value;
                select.val(s.skill);
            }
            else
            {
                select.append('<option value="">—</option>');
                s.skill = null;
            }
            select.prop('disabled', !token || !stats.length);
            syncChanceLabels();
            updateRun();
        };

        for (const side of ['a', 'b'])
        {
            const colEl = cardEl.find(`[data-side="${side}"]`);
            colEl.find('[data-role="pick-token"]').on('click', async () =>
            {
                const caster = state[side].token ?? state.a.token ?? canvas.tokens?.controlled?.[0] ?? null;
                const token = await api?.pickSingleTargetToggle?.(caster, { single: false, includeSelf: true });
                if (token)
                {
                    token.setTarget?.(false, { releaseOthers: false }); // the picker targets it; we only keep the mark
                    state[side].token = token;
                    renderSide(side);
                }
            });
            colEl.find('[data-role="skill"]').on('change', function ()
            {
                state[side].skill = /** @type {HTMLSelectElement} */ (this).value || null;
                syncChanceLabels();
                updateRun();
            });
        }

        cardEl.find('[data-role="sendowner"]').prop('checked', state.sendToOwner).on('change', function ()
        {
            state.sendToOwner = /** @type {HTMLInputElement} */ (this).checked;
        });

        cardEl.find('[data-action="run-contest"]').on('click', async () =>
        {
            const { a, b } = state;
            if (!(a.token && a.skill && b.token && b.skill))
                return;
            cleanup();
            const result = await api?.executeContestedCheck?.(a.token, a.skill, b.token, b.skill,
                { title, sendToOwner: state.sendToOwner, accuracy1, difficulty1, flatModifier1, accuracy2, difficulty2, flatModifier2, sourceItem, sourceAction, extraData });
            resolve(result ?? null);
        });

        renderSide('a');
        renderSide('b');
        // Auto-start picking the first contender that isn't set yet.
        const emptySide = !state.a.token ? 'a' : (!state.b.token ? 'b' : null);
        if (emptySide)
            cardEl.find(`[data-side="${emptySide}"] [data-role="pick-token"]`).trigger('click');
    }), title);
}
