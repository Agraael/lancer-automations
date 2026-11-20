import { MODULE_ID } from "../tools/constants.js";
import { escapeHtml } from "../tools/string-utils.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { getItemDeployables } from "./extra-deployables.js";
import { resolveDeployable } from "./deployable-lookup.js";
import { laDetailPopup, laRenderDeployables } from "./detail-renderers.js";

const ACT_ICON = {
    Quick: 'cci cci-activation-quick',
    Full: 'cci cci-activation-full',
    Invade: 'cci cci-tech-quick',
    'Quick Tech': 'cci cci-tech-quick',
    'Full Tech': 'cci cci-tech-full',
    Reaction: 'cci cci-reaction',
    Protocol: 'cci cci-protocol',
    Free: 'cci cci-free-action'
};

const ACT_STYLE = {
    Quick: 'lancer-quick',
    Full: 'lancer-full',
    Invade: 'lancer-tech',
    'Quick Tech': 'lancer-tech',
    'Full Tech': 'lancer-tech',
    Reaction: 'lancer-reaction',
    Protocol: 'lancer-protocol',
    Free: 'lancer-free'
};

const ALT_COLOR = {
    Full: 'la-bckg-action--full',
    Quick: 'la-bckg-action--quick',
    Reaction: 'la-bckg-npc--reaction',
    Protocol: 'la-bckg-action--protocol',
    Free: 'la-bckg-action--free',
    'Full Tech': 'la-bckg-action--tech',
    'Quick Tech': 'la-bckg-action--tech',
    Invade: 'la-bckg-action--tech',
    Passive: 'la-bckg-repcap'
};

const ALT_LABEL = {
    Full: 'FULL ACTION',
    Quick: 'QUICK ACTION',
    Reaction: 'REACTION',
    Protocol: 'PROTOCOL',
    Free: 'FREE ACTION',
    'Full Tech': 'FULL TECH',
    'Quick Tech': 'QUICK TECH',
    Invade: 'INVADE'
};

const SHEET_ITEM_TYPE = { npc: 'npc_feature', mech: 'mech_weapon' };

const NATIVE_TARGET = {
    npc_feature: { card: '.card', body: ':scope > .lancer-body' },
    mech_weapon: { card: '.mech_weapon', body: ':scope > .lancer-body > .flexcol' }
};

function deployableChips(system, live, deployed)
{
    return [
        { label: 'ACTIVATE', activation: system.activation, key: 'activate', active: live },
        { label: 'DEACTIVATE', activation: system.deactivation, key: null, active: false },
        { label: 'RECALL', activation: system.recall, key: 'recall', active: live && deployed },
        { label: 'REDEPLOY', activation: system.redeploy, key: null, active: false }
    ].filter(chip => !!chip.activation);
}

function nativeChip(activation, label, active, attrs = '')
{
    const slug = `activation-${String(activation).trim().replace(/[:\\/\-\s]+/g, '-').toLowerCase()}`;
    const style = ACT_STYLE[activation] ?? 'lancer-secondary';
    const text = `${label ? `${label} - ` : 'USE '}${String(activation).toUpperCase()}`;

    if (active)
        return `<a class="lancer-button activation-chip ${slug} ${style}" ${attrs}><i class="${ACT_ICON[activation] ?? 'cci cci-free-action'} i--3"></i> ${text}</a>`;
    return `<div class="activation-chip ${slug} lancer-chip ${style}">${text}</div>`;
}

function nativeBlock(entry, index, live)
{
    const system = entry.deployable.system;

    const chips = deployableChips(system, live, entry.deployed)
        .map(chip => nativeChip(chip.activation, chip.label, chip.active, `data-la-dep="${chip.key}"`));

    const actions = (system.actions ?? []).map((action, actionIndex) =>
    {
        const icon = ACT_ICON[action.activation] ? `<i class="${ACT_ICON[action.activation]} i--4"></i>` : '';
        const chip = nativeChip(action.activation, null, live && entry.deployed, `data-la-dep="action" data-index="${actionIndex}"`);
        return `<div class="action-wrapper"><div class="title-wrapper flexrow">${icon}<span class="action-title">${escapeHtml(String(action.name ?? '').toUpperCase())}</span></div>`
            + `<div class="action-detail"><hr class="hsep"><div class="action-flow-container">${chip}<span class="vsep"></span></div>${action.detail ?? ''}</div></div>`;
    }).join('');

    return `<div class="deployable-wrapper ref set vertical" data-la-entry="${index}">`
        + `<img class="deployable-thumbnail" src="${escapeHtml(entry.deployable.img)}" data-la-dep="open" style="cursor: pointer;">`
        + `<div style="grid-area: title" class="title-wrapper"><span class="deployable-title" data-la-dep="open" style="cursor: pointer;">${escapeHtml(String(entry.deployable.name ?? '').toUpperCase())}</span><hr class="hsep"></div>`
        + `<div class="deployable-activations"><div class="flexcol"><div class="flexrow">${chips.join('</div><div class="flexrow">')}</div></div></div>`
        + `<div style="grid-area: desc"><div class="deployable-detail">${system.detail ?? ''}</div></div>`
        + (actions ? `<div style="grid-area: action"><hr class="hsep">${actions}</div>` : '')
        + '</div>';
}

function terminalText(text, extension, classes)
{
    return `<div class="la-terminaltext -whitespacenowrap -textoverflowellipsis -textalignleft ${classes}">`
        + '<span class="la-cmdline -bold -fadein">&gt;//:</span>'
        + `<span>${escapeHtml(text)}</span>`
        + (extension ? `<span class="la-extension -fontface-stylized -lower -fadein">${extension}</span>` : '')
        + '<span class="la-cursor -fontface-stylized -fadein"></span></div>';
}

function altFlowButton(chip)
{
    const attrs = chip.active ? `data-la-dep="${chip.key}"` : '';
    return `<button type="button" class="-upper la-flow clipped-bot -widthfull -overflowhidden -lineheight3 ${ALT_COLOR[chip.activation] ?? ''}" aria-label="${chip.label}" ${attrs}>`
        + terminalText(chip.label, '.exe', '-padding1-r -padding0-tb -height5 -letterspacing0 la-text-header la-prmy-header')
        + '</button>';
}

function altAction(action, actionIndex, active)
{
    const attrs = active ? `data-la-dep="action" data-index="${actionIndex}"` : '';
    return `<div class="la-effectbox -largeheader la-collapsegroup la-flexcol -widthfull la-bckg-card la-brdr-repcap -bordersround-ltb -bordersround">`
        + `<div class="la-actionheader la-summary la-flexrow la-text-header clipped -aligncenter ${ALT_COLOR[action.activation] ?? ''} la-text-header la-prmy-header -padding0-l">`
        + `<div class="-flexthird -justifystart"><button type="button" class="-positionrelative -positionabsolute -left0 -top0 -padding0-l la-scdy-header -glow-scdy-hover" style="z-index: 1;" ${attrs}>`
        + `<i class="-fontsize7 ${(ACT_ICON[action.activation] ?? 'cci cci-free-action').replace('cci ', '')}"></i> <i class="fal fa-dice-d20 -positionabsolute -left0 -fontsize7 -padding0-l la-prmy-secondary -pulse-prmy" style="z-index: -1;"></i></button></div>`
        + `<div class="-flexthird -justifycenter">${terminalText(action.name ?? '', null, '-fontface-stylized')}</div>`
        + '<div class="la-flexrow -flexthird -justifyend -height5"></div></div>'
        + '<div class="la-collapsegroup__wrapper -widthfull"><div class="-fontsizemedium"><div class="la-divider-h la-bckg-primary -margin0-tb -margin2-b"></div>'
        + `<div class="la-effectbox -widthfull -fontsizemediumer -bordersround"><span class="la-effectbox__span clipped-bot la-bckg-primary la-text-header -fontface-stylized -fontsizesmall">${ALT_LABEL[action.activation] ?? escapeHtml(String(action.activation ?? '').toUpperCase())}</span> <span>${action.detail ?? ''}</span></div>`
        + '</div></div></div>';
}

function altBlock(entry, index, live)
{
    const system = entry.deployable.system;
    const buttons = deployableChips(system, live, entry.deployed).map(altFlowButton).join('');
    const actions = (system.actions ?? []).map((action, actionIndex) => altAction(action, actionIndex, live && entry.deployed)).join('');
    return `<div class="la-effectbox la-bckg-card la-brdr-repcap -widthfull -bordersround-ltb ref set" data-la-entry="${index}">`
        + `<span class="la-effectbox__span clipped-bot la-bckg-primary la-text-header -fontsizesmall -upper" data-la-dep="open" style="cursor: pointer;">${escapeHtml(entry.deployable.name ?? '')}</span> `
        + '<div class="la-generated -widthfull -gap1 la-flexcol"><div class="-fontsizemedium -widthfull">'
        + `<div class="la-effectbox-buttons la-flexrow -justifybetween"><div class="la-flexcol -alignstart">${buttons}</div> `
        + `<img class="-height15 la-prmy-secondary la-scdy-primary -glow-prmy -glow-scdy-hover" src="${escapeHtml(entry.deployable.img)}" data-la-dep="open" style="cursor: pointer;"></div>`
        + `<hr> ${system.detail ?? ''}</div> ${actions}</div></div>`;
}

function showPreview(entry, anchor)
{
    document.querySelector('.la-npc-deployable-popup')?.remove();
    const popup = laDetailPopup('la-npc-deployable-popup', entry.deployable.name ?? '', entry.deployable.system?.type ?? '', laRenderDeployables([entry.deployable]), 'system')[0];
    document.body.appendChild(popup);
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(rect.right + 8, window.innerWidth - popup.offsetWidth - 8);
    const top = Math.min(rect.top, window.innerHeight - popup.offsetHeight - 8);
    popup.style.left = `${Math.max(8, left)}px`;
    popup.style.top = `${Math.max(8, top)}px`;
    popup.querySelector('.la-detail-close')?.addEventListener('click', () => popup.remove());
}

async function onDeployableClick(kind, actionIndex, entry, item, actor, anchor)
{
    const api = game.modules.get(MODULE_ID)?.api;

    if (kind === 'open')
    {
        if (entry.deployed)
            entry.deployable.sheet?.render(true);
        else
            showPreview(entry, anchor);
        return;
    }

    if (kind === 'activate')
        return api?.deployDeployable(actor, entry.lid, item, true);
    if (kind === 'recall')
        return api?.recallDeployable(actor.getActiveTokens?.()?.[0] ?? null);

    if (kind === 'action')
    {
        const action = entry.deployable.system?.actions?.[actionIndex];
        if (action)
            return api?.executeSimpleActivation(entry.deployable, { title: action.name, action, detail: action.detail ?? '' });
    }
}

function wireBlock(container, entries, item, actor)
{
    container.addEventListener('click', event =>
    {
        const target = /** @type {HTMLElement} */ (event.target)?.closest?.('[data-la-dep]');
        const block = target?.closest('[data-la-entry]');

        if (!target || !block)
            return;
        event.preventDefault();
        event.stopPropagation();
        const entry = entries[Number(/** @type {HTMLElement} */ (block).dataset.laEntry)];
        if (entry)
            onDeployableClick(/** @type {HTMLElement} */ (target).dataset.laDep, Number(/** @type {HTMLElement} */ (target).dataset.index), entry, item, actor, target);
    });
}

function injectNative(root, item, entries, live)
{
    const target = NATIVE_TARGET[item.type];
    const card = root.querySelector(`${target.card}[data-uuid="${item.uuid}"]`);
    const body = card?.querySelector(target.body);

    if (!body)
        return null;
    card.querySelector(':scope .la-npc-deployables')?.remove();
    const container = htmlToElement(`<div class="la-npc-deployables">${entries.map((entry, index) => nativeBlock(entry, index, live)).join('')}</div>`);
    const tags = body.querySelector(':scope > .compact-tag-row');
    body.insertBefore(container, tags ?? null);
    return container;
}

function injectAlt(root, item, entries, live)
{
    const row = root.querySelector(`.la-collapsegroup.${item.type}[data-uuid="${item.uuid}"]`);
    const generated = row?.querySelector(':scope > .la-collapsegroup__wrapper > .la-collapsecontent > .la-generated');

    if (!generated)
        return null;
    generated.querySelector(':scope > .la-npc-deployables')?.remove();
    const container = htmlToElement(`<div class="la-npc-deployables la-flexcol -widthfull -gap1">${entries.map((entry, index) => altBlock(entry, index, live)).join('')}</div>`);
    const tags = generated.querySelector(':scope > details.weapon_mod, :scope > .la-flexrow.-wrapwrap');
    generated.insertBefore(container, tags ?? null);
    return container;
}

export async function injectNpcDeployables(app, html)
{
    const actor = app?.actor;
    const itemType = SHEET_ITEM_TYPE[actor?.type];
    if (!itemType)
        return;

    const root = app.element?.[0] ?? (html instanceof HTMLElement ? html : html?.[0]);
    if (!root)
        return;

    const isAlt = root.classList.contains('la-common');
    const live = !!actor.isOwner;

    for (const item of actor.items)
    {
        if (item.type !== itemType)
            continue;

        const keys = getItemDeployables(item, actor);
        if (!keys.length)
            continue;

        const entries = [];

        for (const lid of keys)
        {
            const { deployable, source } = await resolveDeployable(lid, actor, item);
            if (deployable)
                entries.push({ lid, deployable, deployed: source === 'actor' });
        }

        if (!entries.length || !root.isConnected)
            continue;

        const container = isAlt ? injectAlt(root, item, entries, live) : injectNative(root, item, entries, live);
        if (container)
            wireBlock(container, entries, item, actor);
    }
}
