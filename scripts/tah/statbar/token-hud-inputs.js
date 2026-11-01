import { hasMechStats, hasReaction } from '../../utils/lancer-token.js';
import { escapeAttr as _escAttr } from '../../tools/misc-tools.js';
import { FLAG_EXTRAS } from './config.js';
import { showsPilotStress } from './rules.js';
import { _resolveExtraBarValues } from './extras.js';
import { BAR_DEFS, hex } from './model.js';
import { getModuleSetting } from '../../tools/settings-utils.js';
import { getLAFlag, setLAFlag } from '../../tools/flag-utils.js';
import { localize } from '../../tools/string-utils.js';

function resourceCell({ name, value, color, title })
{
    const border = hex(color);
    return `<input type="text" name="${name}" value="${value}" title="${title}" class="la-hud-resource" style="width: 40%; height: 30px; font-size: 20px; margin: 2px; min-width: 40px; padding-inline: 1px; text-align: center; border: 1px solid ${border};" />`;
}

export function injectLancerHud(hud, html, actor)
{
    const sys = actor.system;
    const $html = $(html);

    const findDef = id => BAR_DEFS.find(def => def.id === id);
    const COLORS = {
        hp: findDef('hp')?.color ?? 0x66cc66,
        heat: findDef('heat')?.color ?? 0xff7733,
        structure: findDef('structure')?.color ?? 0xffaa33,
        stress: findDef('stress')?.color ?? 0xcc4488,
        overshield: 0x3366ff,
        burn: findDef('burn')?.color ?? 0xff5522,
        infection: findDef('infection')?.color ?? 0x1a8844,
        reaction: 0x9944cc,
    };

    const cell = (name, value, color, title) => resourceCell({ name, value, color, title });

    // 100px wide, 2 inputs per row.
    const containerStyle = 'display: flex; flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: center; width: 100px; height: fit-content;';

    const isPilot = actor.type === 'pilot';
    const pilotStressOn = isPilot && showsPilotStress(hud?.object?.document ?? null);

    // Top: Overshield, [Infection], Burn. Infection cell hidden when integration is disabled or pilot.
    let infectionOn = false;
    infectionOn = !!getModuleSetting('enableInfectionDamageIntegration');
    const topInner =
        cell('system.overshield.value', sys?.overshield?.value ?? 0, COLORS.overshield, 'Overshield') +
        (infectionOn && !isPilot ? cell('system.infection', sys?.infection ?? 0, COLORS.infection, 'Infection') : '') +
        cell('system.burn',              sys?.burn ?? 0,              COLORS.burn,       'Burn');
    const topAttribute = `<div class="attribute la-hud-top" style="${containerStyle} position: absolute; top: 44px; left: 50%; transform: translate(-50%, -100%);">${topInner}</div>`;

    // Bottom: Structure, HP, Stress, Heat (pilots/deployables skip struct/stress; pilots also skip heat).
    const mechStats = hasMechStats(actor);
    const bottomInner =
        (mechStats ? cell('system.structure.value', sys?.structure?.value ?? 0, COLORS.structure, `Structure (max ${sys?.structure?.max ?? 0})`) : '') +
        cell('system.hp.value',        sys?.hp?.value ?? 0,        COLORS.hp,        `HP (max ${sys?.hp?.max ?? 0})`) +
        (mechStats ? cell('system.stress.value',    sys?.stress?.value ?? 0,    COLORS.stress,    `Stress (max ${sys?.stress?.max ?? 0})`) : '') +
        (pilotStressOn ? cell('system.bond_state.stress.value', sys?.bond_state?.stress?.value ?? 0, 0xd9b800, `Stress (max ${sys?.bond_state?.stress?.max ?? 8})`) : '') +
        (isPilot ? '' : cell('system.heat.value',      sys?.heat?.value ?? 0,      COLORS.heat,      `Heat (max ${sys?.heat?.max ?? 0})`));
    const bottomAttribute = `<div class="attribute la-hud-bottom" style="${containerStyle} position: absolute; top: calc(100% - 44px); left: 50%; transform: translateX(-50%);">${bottomInner}</div>`;

    const middleCol = $html.find('.col.middle');
    // Drop vanilla bar1/bar2 fields, we replace them.
    middleCol.find('div.attribute').remove();
    middleCol.append(topAttribute);
    middleCol.append(bottomAttribute);

    // Left: Reaction box. Skipped for deployables.
    if (hasReaction(actor))
    {
        const reactionVal = sys?.action_tracker?.reaction === true ? 1 : 0;
        const reactionInput = resourceCell({
            name: 'system.action_tracker.reaction',
            value: reactionVal,
            color: COLORS.reaction,
            title: localize('LA.tokenStatBar.reactionHint'),
        });
        const reactionBox = `<div class="attribute la-hud-reaction" style="position: absolute; right: 100%; top: 50%; transform: translateY(-50%); width: 50px; display: flex; justify-content: center;">${reactionInput}</div>`;
        $html.find('.col.left').prepend(reactionBox);
    }

    // Writes to actor.system.* instead of token doc.
    const focusOutHandler = async (ev) =>
    {
        ev.preventDefault();
        const input = ev.currentTarget;
        const name = input.name;
        const raw = input.value.trim();
        let value;
        if (name === 'system.action_tracker.reaction')
            value = Number(raw) > 0;
        else
        {
            const num = Number(raw);
            if (!Number.isFinite(num))
                return;
            // Delta input: "+2" / "-3".
            if (raw.startsWith('+') || raw.startsWith('-'))
            {
                const cur = foundry.utils.getProperty(actor, name) ?? 0;
                value = cur + num;
            }
            else
                value = num;
        }
        await actor.update({ [name]: value });
        hud.clear();
    };

    $html.find('input.la-hud-resource')
        .on('click', (ev) =>
        {
            /** @type {HTMLInputElement} */ (ev.currentTarget).select();
        })
        .on('keydown', (ev) =>
        {
            if (ev.code === 'Enter' || ev.code === 'NumpadEnter')
                ev.currentTarget.blur();
        })
        .on('focusout', focusOutHandler);

    // Extras column, mirrored from the reaction box on the left.
    const tokenDoc = hud.object?.document;
    const extras = getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [];
    const visibleExtras = extras.filter(/** @type {any} */ extra => _resolveExtraBarValues(actor, extra).ownerOk);
    if (visibleExtras.length)
    {
        const extraInputs = visibleExtras.map(/** @type {any} */ extra =>
        {
            const { value, max } = _resolveExtraBarValues(actor, extra);
            const primary = extra.color?.stops?.[0] ?? '#888888';
            const readOnly = extra.valueSource?.kind !== 'manual';
            const title = (extra.label || 'Extra') + ` (${value}/${max})` + (readOnly ? ' - read-only (path-bound)' : '');
            return `<input type="text" class="la-hud-extra-input" data-entry-id="${_escAttr(extra.id)}" value="${value}" title="${_escAttr(title)}" ${readOnly ? 'readonly' : ''} style="width:40px;height:30px;font-size:20px;margin:2px;padding-inline:1px;text-align:center;border:1px solid ${_escAttr(primary)};${readOnly ? 'opacity:0.55;' : ''}">`;
        }).join('');
        const extraBlock = `<div class="attribute la-hud-extras" style="position:absolute;left:100%;top:50%;transform:translateY(-50%);width:50px;display:flex;flex-direction:column;justify-content:center;align-items:center;">${extraInputs}</div>`;
        const rightCol = $html.find('.col.right');
        if (rightCol.length)
            rightCol.prepend(extraBlock);
        else
            middleCol.append(extraBlock);

        const extrasFocusOut = async (ev) =>
        {
            ev.preventDefault();
            const input = ev.currentTarget;
            const entryId = input.dataset.entryId;
            const raw = (input.value ?? '').trim();
            const num = Number(raw);
            if (!Number.isFinite(num))
                return;
            const extras = foundry.utils.deepClone(getLAFlag(tokenDoc,FLAG_EXTRAS) ?? []);
            const entry = extras.find(/** @type {any} */ item => item.id === entryId);
            if (!entry || entry.valueSource?.kind !== 'manual')
                return;
            let next = num;
            if (raw.startsWith('+') || raw.startsWith('-'))
                next = (Number(entry.valueSource.value) || 0) + num;
            entry.valueSource.value = next;
            await setLAFlag(tokenDoc,FLAG_EXTRAS, extras);
            hud.clear();
        };

        $html.find('input.la-hud-extra-input')
            .on('click', (ev) =>
            {
                const el = /** @type {HTMLInputElement} */ (ev.currentTarget);
                if (!el.readOnly)
                    el.select();
            })
            .on('keydown', (ev) =>
            {
                if (ev.code === 'Enter' || ev.code === 'NumpadEnter')
                    ev.currentTarget.blur();
            })
            .on('focusout', extrasFocusOut);
    }
}
