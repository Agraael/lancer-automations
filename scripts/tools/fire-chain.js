import { localize, localizeFormat } from "./string-utils.js";
import { isItemUsable, beginWeaponAttackFlow } from "./misc-tools.js";
import { takeAutoDamageDecision } from "../activations/auto-damage.js";
import { panClip } from "../interactive/hover-pan.js";
import { holdFlowLine, reactionPending } from "../activations/flow-queue.js";

const FORMS = { attack: 'form#accdiff-hud', damage: 'form#damage-hud' };
const DAMAGE_START_MS = 5000;

let live = null;
let observer = null;

const isAuxSize = weapon => String(weapon.system?.size || "").toLowerCase() === 'auxiliary';

export const bonusGoesToFirst = weapons => !weapons.some(weapon => !isAuxSize(weapon) && isItemUsable(weapon));

// Bonus damage: non-Aux is primary in X/Aux mounts; in Aux/Aux only the first weapon fired keeps bonus.
function mountBonus(weapons)
{
    const hasNonAux = !bonusGoesToFirst(weapons);
    let spent = false;

    return {
        has: weapon => (hasNonAux ? !isAuxSize(weapon) : !spent),
        spend: (weapon) =>
        {
            if (!hasNonAux && isItemUsable(weapon))
                spent = true;
        },
    };
}

export function plannedBonus(weapons)
{
    const mount = mountBonus(weapons);

    return weapons.map((weapon) =>
    {
        const has = mount.has(weapon);
        mount.spend(weapon);
        return has;
    });
}

export const orderMount =(weapons, first) => (first && weapons.includes(first) ? [first, ...weapons.filter(weapon => weapon !== first)] : weapons);

function dotClass(shot, index, current)
{
    if (index === current)
        return 'la-fire-dot la-fire-dot--now';
    return shot.state === 'done' ? 'la-fire-dot la-fire-dot--done' : 'la-fire-dot';
}

function stopChain()
{
    if (!live)
        return;

    live.stopped = true;
    /** @type {HTMLElement|null} */ (document.querySelector(`${FORMS.attack} button[data-button="cancel"]`))?.click();
}

function stripElement(chain = live, pending = reactionPending())
{
    const shot = chain.shots[chain.index];
    const following = chain.shots[chain.index + 1];
    const strip = document.createElement('div');
    strip.className = 'la-fire-strip';

    const dots = document.createElement('span');
    dots.className = 'la-fire-dots';
    chain.shots.forEach((other, index) =>
    {
        const dot = document.createElement('i');
        dot.className = dotClass(other, index, chain.index);
        dots.append(dot);
    });

    const title = document.createElement('span');
    const count = document.createElement('b');
    count.textContent = `${chain.index + 1}/${chain.shots.length}`;
    title.append(`${chain.action} `, count);
    strip.append(dots, title);

    if (!shot.hasBonus)
    {
        const noBonus = document.createElement('span');
        noBonus.className = 'la-fire-bonus';
        noBonus.textContent = localize('LA.fireChain.noBonus');
        strip.append(noBonus);
    }

    let nextText = localize('LA.fireChain.lastShot');

    if (following && pending)
        nextText = localizeFormat('LA.fireChain.thenAfterReaction', { name: following.weapon.name });
    else if (following && chain.phase === 'damage')
        nextText = localizeFormat('LA.fireChain.thenAfterDamage', { name: following.weapon.name });
    else if (following)
        nextText = localizeFormat('LA.fireChain.then', { name: following.weapon.name });

    strip.append(panClip(nextText, 'la-fire-next'));

    if (chain.phase === 'attack')
    {
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'la-fire-stop';
        stop.textContent = localize('LA.fireChain.stop');
        stop.addEventListener('click', stopChain);
        strip.append(stop);
    }

    return strip;
}

export function fireStripPreview(chain)
{
    return stripElement(chain, false);
}

function paintStrip()
{
    const form = live ? document.querySelector(FORMS[live.phase]) : null;
    const key = live ? `${live.index}:${live.phase}:${reactionPending()}` : '';

    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('div.la-fire-strip')).forEach((strip) =>
    {
        if (strip.parentElement !== form || strip.dataset.key !== key)
            strip.remove();
    });

    if (!form || form.querySelector(':scope > .la-fire-strip'))
        return;

    const strip = stripElement();
    strip.dataset.key = key;
    const banner = form.querySelector(':scope > .la-card-queue-banner');

    if (banner)
        banner.after(strip);
    else
        form.prepend(strip);
}

function startStrip(chain)
{
    live = chain;
    observer = new MutationObserver(paintStrip);
    observer.observe(document.body, { childList: true, subtree: true });
}

function endStrip(chain)
{
    if (live !== chain)
        return;

    observer?.disconnect();
    observer = null;
    live = null;
    paintStrip();
}

function damageEnds(weapon)
{
    return new Promise((resolve) =>
    {
        let begun = false;
        const matches = flow => flow?.state?.item?.uuid === weapon.uuid;
        const preId = Hooks.on('lancer.preFlow.DamageRollFlow', (flow) =>
        {
            if (matches(flow))
                begun = true;
        });
        const postId = Hooks.on('lancer.postFlow.DamageRollFlow', (flow) =>
        {
            if (matches(flow))
                finish();
        });
        const timer = setTimeout(() =>
        {
            if (!begun)
                finish();
        }, DAMAGE_START_MS);

        function finish()
        {
            Hooks.off('lancer.preFlow.DamageRollFlow', preId);
            Hooks.off('lancer.postFlow.DamageRollFlow', postId);
            clearTimeout(timer);
            resolve();
        }
    });
}

export async function fireChain({ action, groups, tapeId, preTarget = null })
{
    const shots = groups.flatMap((weapons) =>
    {
        const mount = mountBonus(weapons);
        return weapons.map(weapon => ({ weapon, mount, hasBonus: false, state: '' }));
    });
    const chain = { action, shots, index: 0, phase: 'attack', stopped: false };
    const chainId = foundry.utils.randomID();
    const weaponUuids = new Set(shots.map(shot => shot.weapon.uuid));
    const owns = state => state?.la_extraData?._laChainId === chainId || (state?.name === 'DamageRollFlow' && weaponUuids.has(state.item?.uuid));

    if (shots.length > 1)
        startStrip(chain);

    try
    {
        await holdFlowLine(owns, async () =>
        {
            for (const [index, shot] of shots.entries())
            {
                if (chain.stopped)
                    break;

                chain.index = index;
                chain.phase = 'attack';
                shot.hasBonus = shot.mount.has(shot.weapon);
                if (live === chain)
                    paintStrip();

                if (preTarget)
                    /** @type {any} */ (canvas.tokens).setTargets([preTarget.id]);

                const { completed } = await beginWeaponAttackFlow(shot.weapon, {}, { tapeAnchor: tapeId, _laChainId: chainId, ...(shot.hasBonus ? {} : { _csmNoBonusDmg: { enabled: true } }) });

                if (!completed)
                {
                    shot.state = 'cancel';
                    continue;
                }

                shot.mount.spend(shot.weapon);
                shot.state = 'done';

                if (takeAutoDamageDecision(shot.weapon.uuid) && !chain.stopped)
                {
                    chain.phase = 'damage';
                    if (live === chain)
                        paintStrip();
                    await damageEnds(shot.weapon);
                }
            }
        }, action);
    }
    finally
    {
        endStrip(chain);
    }
}
