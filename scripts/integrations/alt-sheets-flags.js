// Sole coupling to lancer-alternative-sheets custom flags; change here if Annoying's api/paths move.

const ID = 'lancer-alternative-sheets';

// actor.type -> alt-sheets CustomFlagKey
const FLAG_KEYS = { mech: 'mech', pilot: 'pilot', npc: 'npc', deployable: 'deployable' };

export function isActive()
{
    return !!game.modules.get(ID)?.active;
}

// undefined before alt-sheets' own ready hook attaches its api
function flagsApi()
{
    return game.modules.get(ID)?.api?.flags;
}

export function flagKeyForActor(actor)
{
    return FLAG_KEYS[actor?.type] ?? null;
}

export function valuePath(actor, id)
{
    const key = flagKeyForActor(actor);
    return key ? `flags.${ID}.${key}.${id}.content.value` : null;
}

export function maxPath(actor, id)
{
    const key = flagKeyForActor(actor);
    return key ? `flags.${ID}.${key}.${id}.content.max` : null;
}

// Normalized flag list. Reads the flag map directly, so it works before alt-sheets' ready.
export function listFlags(actor)
{
    const key = flagKeyForActor(actor);
    if (!key || !isActive())
        return [];
    const map = actor?.getFlag?.(ID, key);
    if (!map || typeof map !== 'object')
        return [];
    const out = [];
    for (const [id, flag] of Object.entries(map))
    {
        if (!flag || typeof flag !== 'object')
            continue;
        const content = flag.content ?? {};
        out.push({
            id,
            name: flag.name ?? '',
            contentType: flag.contentType ?? 'value',
            value: Number(content.value ?? 0),
            min: Number(content.min ?? 0),
            max: Number(content.max ?? 0),
            color: flag.color ?? '#ffffff',
            icon: flag.icon ?? '',
            tooltip: flag.tooltip ?? '',
            showInSidebar: !!flag.showInSidebar,
            valuePath: `flags.${ID}.${key}.${id}.content.value`,
            maxPath: `flags.${ID}.${key}.${id}.content.max`,
        });
    }
    return out;
}

export function listFractionFlags(actor)
{
    return listFlags(actor).filter(flag => flag.contentType === 'fraction');
}

export function listValueFlags(actor)
{
    return listFlags(actor).filter(flag => flag.contentType !== 'fraction');
}

export async function createFractionFlag(actor, { name = '', value = 0, max = 1, color = '#ffffff', icon = '', tooltip = '' } = {})
{
    const key = flagKeyForActor(actor);
    const flags = flagsApi();
    if (!key || !flags)
        return null;
    // addCustomFlag returns the setFlag promise, not the id, so diff the key set.
    const before = new Set(Object.keys(flags.getCustomFlags(actor, key) ?? {}));
    await flags.addCustomFlag(actor, key);
    const after = flags.getCustomFlags(actor, key) ?? {};
    const id = Object.keys(after).find(existing => !before.has(existing));
    if (!id)
        return null;
    await flags.updateCustomFlag(actor, key, id, {
        name,
        contentType: 'fraction',
        color,
        icon,
        tooltip,
        content: { value: Number(value), min: 0, max: Number(max) },
    });
    return id;
}

// "+n"/"-n" apply as deltas. laFlagValueWrite lets the reactivity hook skip its reinject.
export async function writeFlagValue(actor, id, value)
{
    const path = valuePath(actor, id);
    if (!path)
        return null;
    const current = Number(foundry.utils.getProperty(actor, path) ?? 0);
    const input = String(value).trim();
    const next = /^[+-]/.test(input) ? current + Number(input) : Number(input);
    if (!Number.isFinite(next))
        return null;
    await actor.update({ [path]: next }, { laFlagValueWrite: true });
    return next;
}

export async function deleteFlag(actor, id)
{
    const key = flagKeyForActor(actor);
    const flags = flagsApi();
    if (!key || !flags)
        return;
    await flags.deleteCustomFlag(actor, key, id);
}

export function flagsChanged(changes)
{
    return foundry.utils.hasProperty(changes ?? {}, `flags.${ID}`);
}

// True if a structural field changed (needs a bar reinject). Value-only edits return false.
export function structuralChange(changes)
{
    const scope = foundry.utils.getProperty(changes ?? {}, `flags.${ID}`);
    if (!scope || typeof scope !== 'object')
        return false;
    for (const key of Object.values(FLAG_KEYS))
    {
        const map = scope[key];
        if (!map || typeof map !== 'object')
            continue;
        for (const [id, flag] of Object.entries(map))
        {
            if (id.startsWith('-='))
                return true; // deletion
            if (!flag || typeof flag !== 'object')
                return true; // whole-flag add/replace
            // value + max are path-bound (read live), so a content-only edit needs no reinject.
            const flagKeys = Object.keys(flag);
            const contentOnly = flagKeys.length === 1 && flagKeys[0] === 'content'
                && Object.keys(flag.content ?? {}).every(field => field === 'value' || field === 'max');
            if (!contentOnly)
                return true;
        }
    }
    return false;
}

// LA's own flag: ids of custom flags the user linked to a token bar (opt-in per flag).
const LINK_FLAG = 'customFlagBars';

export function getBarLinks(actor)
{
    return actor?.getFlag?.('lancer-automations', LINK_FLAG) ?? [];
}

export function isBarLinked(actor, id)
{
    return getBarLinks(actor).includes(id);
}

export async function setBarLink(actor, id, linked)
{
    const links = new Set(getBarLinks(actor));
    if (linked)
        links.add(id);
    else
        links.delete(id);
    await actor.update({ [`flags.lancer-automations.${LINK_FLAG}`]: [...links] });
}

export function listLinkedFractionFlags(actor)
{
    const links = new Set(getBarLinks(actor));
    return listFractionFlags(actor).filter(flag => links.has(flag.id));
}

export function barLinkChanged(changes)
{
    return foundry.utils.hasProperty(changes ?? {}, `flags.lancer-automations.${LINK_FLAG}`);
}

// Inject a "Show in Token Bar" toggle onto each fraction flag in the alt-sheet Custom tab.
// Cloned from the sidebar-toggle row so it matches the sheet's styling; renderActorSheet re-runs it.
export function injectBarToggles(app, html)
{
    if (!isActive())
        return;
    const actor = app?.actor ?? app?.document;
    if (!actor || !flagKeyForActor(actor))
        return;
    const jHtml = html instanceof $ ? html : $(html);
    jHtml.find('.la-collapsegroup__wrapper[data-la-collapse-id^="custom."]').each(function ()
    {
        const match = /^custom\.([A-Za-z0-9]+)$/.exec(this.getAttribute('data-la-collapse-id') || '');
        if (!match)
            return; // ".assist" sub-wrapper
        const select = this.querySelector('select.la-customvalue__select');
        if (!select || select.value !== 'fraction')
            return; // bars are fraction-only
        if (this.querySelector('.la-bar-link-toggle'))
            return;
        const sidebarRow = this.querySelector('input[type="checkbox"].-widthfull')?.closest('.la-effectbox');
        if (!sidebarRow)
            return;
        const id = match[1];
        const row = sidebarRow.cloneNode(true);
        row.classList.add('la-bar-link-toggle');
        const label = row.querySelector('.la-effectbox__span');
        if (label)
            label.textContent = 'Show in Token Bar';
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (!checkbox)
            return;
        checkbox.checked = isBarLinked(actor, id);
        checkbox.addEventListener('change', () => setBarLink(actor, id, checkbox.checked));
        sidebarRow.insertAdjacentElement('afterend', row);
    });
}

export { ID as ALT_SHEETS_ID, FLAG_KEYS };
