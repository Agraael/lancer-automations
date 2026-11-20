import { deployableOwnerActor, deployableOwnerToken, registerOwnActions, registerOwnMove } from './deployable-owner.js';
import { getExtraDeployableOpts } from './extra-deployables.js';
import { itemHasDeployable } from './deployable-lookup.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { escapeHtml, localize } from '../tools/string-utils.js';

function sourceItemSync(doc, lid)
{
    const stamped = getLAFlag(doc, 'sourceItemUuid');
    const item = stamped ? fromUuidSync(stamped) : null;
    if (item)
        return item;
    return deployableOwnerActor(doc)?.items?.find(candidate => itemHasDeployable(candidate, lid)) ?? null;
}

export function deployableSettings(tokenOrDoc)
{
    const doc = tokenOrDoc?.document ?? tokenOrDoc;
    const actor = doc?.actor;
    const lid = actor?.type === 'deployable' ? actor.system?.lid : null;
    if (!lid)
        return {};

    const uuidKey = doc.baseActor?.uuid ?? actor.uuid;

    for (const host of [sourceItemSync(doc, lid), deployableOwnerActor(doc)])
    {
        const opts = host ? (getExtraDeployableOpts(host, lid) ?? getExtraDeployableOpts(host, uuidKey)) : null;
        if (opts)
            return opts;
    }

    return {};
}

export function ownsActions(tokenOrDoc)
{
    return !!deployableSettings(tokenOrDoc).ownActions;
}

export function ownMoveCap(token)
{
    const settings = deployableSettings(token);
    if (!settings.ownMove)
        return null;

    const own = Number(settings.speed) || Number(token?.actor?.system?.speed) || 0;
    return own > 0 ? own : (Number(deployableOwnerToken(token)?.actor?.system?.speed) || 0);
}

export function ownEconomyControls(opts = {}, dataAttrs = '', indent = 38)
{
    const label = 'display:inline-flex;align-items:center;gap:4px;';
    const check = (key, text, hint) => `<label style="${label}" title="${escapeHtml(hint)}"><input type="checkbox" data-opt="${key}" ${opts[key] ? 'checked' : ''} style="margin:0;">${escapeHtml(text)}</label>`;

    return `
        <div class="la-own-economy" ${dataAttrs} style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:0 8px 5px ${indent}px;font-size:0.78em;color:var(--la-ink-dim);">
            ${check('ownMove', localize('LA.ownEconomy.ownMove'), localize('LA.ownEconomy.ownMoveHint'))}
            <label style="${label}" title="${escapeHtml(localize('LA.ownEconomy.speedHint'))}">${escapeHtml(localize('LA.ownEconomy.speed'))}<input type="number" data-opt="speed" value="${opts.speed ?? ''}" placeholder="${escapeHtml(localize('LA.ownEconomy.auto'))}" min="1" max="99" ${opts.ownMove ? '' : 'disabled'} style="width:48px;height:20px;font-size:0.9em;"></label>
            ${check('ownActions', localize('LA.ownEconomy.ownActions'), localize('LA.ownEconomy.ownActionsHint'))}
        </div>`;
}

export function bindOwnEconomy($root, onChange)
{
    $root.find('.la-own-economy [data-opt]').on('change', function ()
    {
        const row = this.closest('.la-own-economy');
        const key = this.dataset.opt;
        if (!row || !key)
            return;

        if (key === 'speed')
        {
            const raw = String(this.value ?? '').trim();
            onChange?.({ speed: raw === '' ? null : Number(raw) }, row);
            return;
        }

        if (key === 'ownMove')
        {
            const speed = row.querySelector('[data-opt="speed"]');
            if (speed)
                speed.disabled = !this.checked;
        }

        onChange?.({ [key]: this.checked || null }, row);
    });
}

export function readOwnEconomy(row)
{
    const field = key => row?.querySelector(`[data-opt="${key}"]`);
    const speed = String(field('speed')?.value ?? '').trim();
    return {
        ownMove: field('ownMove')?.checked || null,
        speed: speed === '' ? null : Number(speed),
        ownActions: field('ownActions')?.checked || null,
    };
}

registerOwnActions(ownsActions);
registerOwnMove(ownMoveCap);
