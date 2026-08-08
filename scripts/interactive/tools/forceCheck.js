import { _queueCard, _createInfoCard, _removeInfoCard } from "../cards.js";
import {
    pickSingleTargetToggle, isSingleTargetPickerActive, cancelSingleTargetPicker,
    isAreaPickerActive, cancelAreaPicker,
    beginTargetSession, clearSingleTargetShape, clearAreaTargetShape, createTokenMark,
    rangePulse, RANGE_PULSE_PRIORITY,
} from "../canvas.js";
import { buildTargetingUI, clearAttackShapePreview } from "../../activations/targeting-ui.js";
import { TG } from "../canvas-helpers.js";

const PICK_PULSE_OWNER = 'la-forcecheck-pick';
const SAVE_PULSE_OWNER = 'la-forcecheck-save';

function normalizeToken(ref)
{
    if (!ref)
        return null;
    if (ref.getActiveTokens)
        return ref.getActiveTokens()[0] ?? null;
    return ref.object ?? ref;
}

function deriveSaveDc(saveVsToken)
{
    return saveVsToken?.actor?.system?.save || 10;
}

/**
 * Force Check card: pick a HASE skill, targets like an attack roll, optionally a save-vs
 * actor (statroll SAVE picker), then route each target's roll to its owner.
 * @param {any} [preset]
 */
export function openForceCheckCard({ tokenA = null, skill = null, range = null, saveVs = null, targets = null, sendToOwner = true } = {})
{
    return _queueCard(() => new Promise((resolve) =>
    {
        const api = game.modules.get('lancer-automations')?.api;
        const caster = tokenA ?? canvas.tokens?.controlled?.[0] ?? null;
        const state = {
            skill: skill ? String(skill).toUpperCase() : 'HULL',
            saveVs: normalizeToken(saveVs),
            sendToOwner: sendToOwner !== false,
        };
        const pickState = { actor: caster?.actor ?? null, data: { title: 'Force Check' } };
        if (range != null && range !== '')
            pickState.__laAttackShape = { pattern: 'target', size: 1, range: Math.max(0, Number(range) || 0) };

        let saveMark = null;
        const clearSaveMark = () =>
        {
            saveMark?.destroy();
            saveMark = null;
        };
        const drawSaveMark = () =>
        {
            clearSaveMark();
            if (state.saveVs)
                saveMark = createTokenMark(state.saveVs, TG.reference);
        };

        let cardEl;
        let targetHookId = null;
        const rollerTargets = () => [...(game.user.targets ?? [])].filter(token => token.id !== state.saveVs?.id);

        const teardownCanvas = () =>
        {
            if (isSingleTargetPickerActive())
                cancelSingleTargetPicker();
            if (isAreaPickerActive())
                cancelAreaPicker();
            rangePulse.clear(PICK_PULSE_OWNER);
            rangePulse.clear(SAVE_PULSE_OWNER);
            clearSingleTargetShape();
            clearAreaTargetShape();
            clearAttackShapePreview();
            clearSaveMark();
            if (targetHookId)
            {
                Hooks.off('targetToken', targetHookId);
                targetHookId = null;
            }
            for (const target of [...(game.user.targets ?? [])])
                target.setTarget(false, { releaseOthers: false });
        };
        const cleanup = () =>
        {
            teardownCanvas();
            _removeInfoCard(cardEl);
        };

        cardEl = _createInfoCard("forceCheck", {
            title: "FORCE CHECK",
            onCancel: () =>
            {
                cleanup();
                resolve(null);
            },
        });

        const updateRun = () =>
        {
            cardEl.find('[data-action="run-forcecheck"]').prop('disabled', !(state.skill && rollerTargets().length));
        };

        const renderSaveVs = () =>
        {
            const token = state.saveVs;
            const label = cardEl.find('[data-role="savevs-label"]');
            const clearBtn = cardEl.find('[data-role="clear-savevs"]');
            if (token)
            {
                const name = token.name ?? token.document?.name ?? '?';
                label.text(`${name} (save ${deriveSaveDc(token)})`);
                clearBtn.css('display', '');
            }
            else
            {
                label.text('Pick actor (optional)');
                clearBtn.css('display', 'none');
            }
        };

        const renderTargets = () =>
        {
            const listEl = cardEl.find('[data-role="target-list"]');
            listEl.empty();
            const rollers = rollerTargets();
            if (!rollers.length)
            {
                listEl.html('<div class="la-empty-state">No targets</div>');
                updateRun();
                return;
            }
            for (const token of rollers)
            {
                const name = token.name ?? token.document?.name ?? '?';
                const src = token.document?.texture?.src ?? '';
                const row = $(`
                    <div class="la-selected-target" data-token-id="${token.id}">
                        <img src="${src}" alt="${name}">
                        <span class="la-selected-target-name">${name}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                    </div>`);
                row.find('.la-selected-target-remove').on('click', () =>
                {
                    token.setTarget?.(false, { releaseOthers: false });
                });
                listEl.append(row);
            }
            updateRun();
        };

        cardEl.find('[data-role="skill"]').val(state.skill).on('change', function ()
        {
            state.skill = /** @type {HTMLSelectElement} */ (this).value || 'HULL';
            renderSaveVs();
            updateRun();
        });

        cardEl.find('[data-role="sendowner"]').prop('checked', state.sendToOwner).on('change', function ()
        {
            state.sendToOwner = /** @type {HTMLInputElement} */ (this).checked;
        });

        const $saveBtn = cardEl.find('[data-role="pick-savevs"]');
        $saveBtn.on('click', async (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            if (isSingleTargetPickerActive())
            {
                cancelSingleTargetPicker();
                return;
            }
            if (isAreaPickerActive())
            {
                cancelAreaPicker();
                return;
            }
            $saveBtn.addClass('la-targeting-active');
            const shapeRange = Number(pickState.__laAttackShape?.range) || 0;
            if (caster && shapeRange > 0)
                rangePulse.setRange(SAVE_PULSE_OWNER, { token: caster, range: shapeRange, includeSelf: true, priority: RANGE_PULSE_PRIORITY.ATTACK_CARD });
            const beforeIds = new Set([...(game.user.targets ?? [])].map(token => token.id));
            try
            {
                const picked = await pickSingleTargetToggle(caster, { single: false, includeSelf: true });
                if (picked)
                {
                    const wanted = new Set([...beforeIds].filter(id => id !== picked.id));
                    const currentIds = new Set([...(game.user.targets ?? [])].map(token => token.id));
                    for (const id of new Set([...wanted, ...currentIds]))
                    {
                        const token = canvas.tokens.get(id);
                        if (!token)
                            continue;
                        const shouldTarget = wanted.has(id);
                        if (shouldTarget !== currentIds.has(id))
                            token.setTarget(shouldTarget, { releaseOthers: false });
                    }
                    state.saveVs = picked;
                    drawSaveMark();
                    renderSaveVs();
                    renderTargets();
                }
            }
            finally
            {
                $saveBtn.removeClass('la-targeting-active');
                rangePulse.clear(SAVE_PULSE_OWNER);
            }
        });

        cardEl.find('[data-role="clear-savevs"]').on('click', () =>
        {
            state.saveVs = null;
            clearSaveMark();
            renderSaveVs();
            renderTargets();
        });

        cardEl.find('[data-action="run-forcecheck"]').on('click', async () =>
        {
            const rollers = rollerTargets();
            if (!(state.skill && rollers.length))
                return;
            const runSkill = state.skill;
            const runSaveVs = state.saveVs;
            const runSendToOwner = state.sendToOwner;
            cleanup();
            const result = await api?.executeForceCheck?.(runSkill, rollers, { saveVs: runSaveVs, sendToOwner: runSendToOwner });
            resolve(result ?? null);
        });

        if (Array.isArray(targets))
        {
            for (const preTarget of targets)
                normalizeToken(preTarget)?.setTarget?.(true, { releaseOthers: false });
        }
        beginTargetSession();
        targetHookId = Hooks.on('targetToken', (user) =>
        {
            if (user?.id === game.userId)
                renderTargets();
        });
        buildTargetingUI(pickState, cardEl, cardEl.find('[data-role="target-row"]'), {
            weapon: null,
            aoe: [],
            hitChanceForFactory: () => null,
            autoStart: 'never',
            pulseOwner: PICK_PULSE_OWNER,
        });

        renderSaveVs();
        if (state.saveVs)
            drawSaveMark();
        renderTargets();
    }), 'Force Check');
}
