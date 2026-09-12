import { getModuleSetting } from '../tools/settings-utils.js';
import { effectStack, usageBadgeColor } from './flagged-effects.js';

// Stack counters off the canvas: token HUD click rebinds and combat tracker numbers.

export function initStatusCounter()
{
    Hooks.on('renderTokenHUD', _onRenderTokenHud);
    Hooks.on('renderCombatTracker', _onRenderCombatTracker);
}

function _rootElement(htmlOrEl)
{
    return htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl?.[0];
}

function _onRenderTokenHud(hud, htmlOrEl)
{
    if (!getModuleSetting('statusHudStackClicks'))
        return;
    const palette = _rootElement(htmlOrEl)?.querySelector('.status-effects');
    if (!palette)
        return;
    // capture phase, so the HUD's own toggle never sees a click on an active status
    palette.addEventListener('click', event => _onEffectClick(hud, event), true);
    palette.addEventListener('contextmenu', event => _onEffectClick(hud, event), true);
}

function _onEffectClick(hud, event)
{
    const statusId = event.target?.closest?.('.effect-control')?.dataset.statusId;
    const actor = hud.object?.actor;
    if (!statusId || !actor || event.shiftKey)
        return;
    const effect = actor.effects.find(candidate => candidate.statuses?.has(statusId) && !candidate.disabled);
    if (!effect)
        return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    _stepStack(effect, event.type === 'click' ? 1 : -1);
}

async function _stepStack(effect, delta)
{
    const next = effectStack(effect) + delta;
    if (next <= 0)
        return effect.delete();
    return effect.update({ 'flags.statuscounter.value': next, 'flags.statuscounter.visible': next > 1 });
}

function _onRenderCombatTracker(_app, htmlOrEl)
{
    const root = _rootElement(htmlOrEl);
    if (!root)
        return;
    const color = usageBadgeColor();
    for (const row of root.querySelectorAll('li.combatant'))
    {
        const actor = game.combat?.combatants.get(row.dataset.combatantId)?.actor;
        if (!actor)
            continue;
        // the tracker draws temporaryEffects in order, one icon each, so repeats of an img map to repeats of an effect
        const seen = new Map();
        for (const icon of row.querySelectorAll('img.token-effect'))
        {
            const src = icon.getAttribute('src');
            const skip = seen.get(src) ?? 0;
            seen.set(src, skip + 1);
            const effect = _nthEffectByImg(actor, src, skip);
            const count = effect ? effectStack(effect) : 0;
            if (count <= 1)
                continue;
            const wrap = document.createElement('span');
            wrap.className = 'la-effect-counter-wrap';
            icon.replaceWith(wrap);
            wrap.append(icon);
            const badge = document.createElement('span');
            badge.className = 'la-effect-counter';
            badge.style.color = color;
            badge.textContent = String(count);
            wrap.append(badge);
        }
    }
}

function _nthEffectByImg(actor, img, index)
{
    for (const effect of actor.temporaryEffects ?? [])
    {
        if (effect.img !== img)
            continue;
        if (index <= 0)
            return effect;
        index--;
    }
    return null;
}
