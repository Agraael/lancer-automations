import { effectStack, usageBadgeColor } from './flagged-effects.js';

// Stack counts on the combat tracker rows.

export function initStatusCounter()
{
    Hooks.on('renderCombatTracker', _onRenderCombatTracker);
}

function _rootElement(htmlOrEl)
{
    return htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl?.[0];
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
