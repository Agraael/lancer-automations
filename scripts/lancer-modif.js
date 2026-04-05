/**
 * Lancer System Modifications
 *
 * Features that patch or extend the Lancer system without editing its bundle.
 *
 * === Item Disabled System ===
 * Allows marking mech weapons, mech systems, NPC features, and weapon mods as
 * "disabled".  Disabled items cannot be activated through flows and display a
 * visual indicator (power-off icon + dimmed header) on actor sheets.
 * Storage: `system.disabled` (boolean) directly on the item document.
 *
 * === Extra Trackable Attributes ===
 * Adds action_tracker.move / action_tracker.reaction to token resource bar
 * options for mechs, NPCs, and pilots.
 */

// ---------------------------------------------------------------------------
// Schema extension — add `disabled` field to item data models
// ---------------------------------------------------------------------------

/**
 * Inject `disabled` BooleanField into item schemas. Must be called during `init`.
 * Without this, `item.update({'system.disabled': true})` is silently ignored.
 */
export function injectDisabledSchemaField() {
    const BooleanField = foundry.data.fields.BooleanField;
    const modelKeys = ['mech_weapon', 'mech_system', 'npc_feature', 'weapon_mod'];
    let injected = 0;
    for (const key of modelKeys) {
        const model = CONFIG.Item.dataModels?.[key];
        if (!model?.schema)
            continue;

        if (!model.schema.fields.disabled) {
            try {
                model.schema.fields.disabled = new BooleanField({ initial: false });
                injected++;
            } catch (e) {
                console.warn(`lancer-automations | Could not inject disabled field into ${key}:`, e);
            }
        }
    }
    if (injected)
        console.log(`lancer-automations | Injected disabled field into ${injected} item schema(s)`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Item types that support the disabled state. */
const DISABLEABLE_TYPES = new Set(['mech_weapon', 'mech_system', 'npc_feature', 'weapon_mod']);

function isDisableable(item) {
    return item?.documentName === 'Item' && DISABLEABLE_TYPES.has(item.type);
}

function isItemDisabled(item) {
    return !!item?.system?.disabled;
}

async function setItemDisabled(item, disabled) {
    return item.update({ 'system.disabled': disabled });
}

// ---------------------------------------------------------------------------
// 1. Flow step – block disabled items
// ---------------------------------------------------------------------------

async function checkItemDisabled(state) {
    if (!state.item)
        return true;
    if (!isDisableable(state.item))
        return true;

    if (isItemDisabled(state.item)) {
        const isSystem =
            state.item.type === 'mech_system' ||
            (state.item.type === 'npc_feature' && state.item.system?.type !== 'Weapon');
        const label = isSystem ? 'System' : 'Weapon';
        ui.notifications.warn(`${label} ${state.item.name} is disabled!`);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// 2. Flow registration
// ---------------------------------------------------------------------------

export function registerDisabledFlowSteps(flowSteps, flows) {
    flowSteps.set('lancer-automations:checkItemDisabled', checkItemDisabled);

    // Insert right after checkItemDestroyed in every flow that has it
    const targets = [
        'WeaponAttackFlow',
        'BasicAttackFlow',
        'TechAttackFlow',
        'ActivationFlow',
        'SystemFlow',
        'CoreActiveFlow',
    ];
    for (const name of targets) {
        flows.get(name)?.insertStepAfter('checkItemDestroyed', 'lancer-automations:checkItemDisabled');
    }

    // Repair: clear disabled flags after the full-repair executes
    flowSteps.set('lancer-automations:clearDisabledOnRepair', clearDisabledOnRepair);
    flows.get('FullRepairFlow')?.insertStepAfter('executeFullRepair', 'lancer-automations:clearDisabledOnRepair');
}

async function clearDisabledOnRepair(state) {
    if (!state.actor)
        return true;
    const updates = [];
    for (const item of state.actor.items) {
        if (isDisableable(item) && isItemDisabled(item)) {
            updates.push({ _id: item.id, 'system.disabled': false });
        }
    }
    if (updates.length) {
        await state.actor.updateEmbeddedDocuments('Item', updates);
    }
    return true;
}

// ---------------------------------------------------------------------------
// 3. Context menu — inject into Lancer's tippy menus
// ---------------------------------------------------------------------------

/** Resolve item from a context-menu target (UUID on closest `.set[data-uuid]`). */
function _resolveItem(el) {
    const domEl = el instanceof $ ? el[0] : el;
    const setEl = domEl?.closest?.('.set[data-uuid]') ?? domEl?.closest?.('[data-uuid]');
    const uuid = setEl?.dataset?.uuid;
    if (!uuid)
        return null;
    try {
        return fromUuidSync(uuid);
    } catch {
        return null;
    }
}

/** Extend tippy context menus with "Mark Disabled / Not Disabled" for disableable items. */
function _injectDisabledContextMenu(jHtml) {
    jHtml.find('.lancer-context-menu').each(function () {
        const tippyInstance = this._tippy;
        if (!tippyInstance)
            return;

        const item = _resolveItem(this);
        if (!item || !isDisableable(item))
            return;

        // Wrap onShow to inject our entry each time the menu opens
        const origOnShow = tippyInstance.props.onShow;
        tippyInstance.props.onShow = (instance) => {
            if (origOnShow)
                origOnShow(instance);

            // Wait a tick for tippy to populate content
            setTimeout(() => {
                const content = instance.popper?.querySelector?.('.lancer-context-menu');
                if (!content)
                    return;

                // Remove stale injection from previous render
                content.querySelectorAll('.la-disabled-entry').forEach(el => el.remove());

                const disabled = isItemDisabled(item);
                const label = disabled ? 'Mark Not Disabled' : 'Mark Disabled';
                const icon = disabled ? '<i class="mdi mdi-power"></i>' : '<i class="mdi mdi-power-off"></i>';

                const entry = document.createElement('div');
                entry.className = 'lancer-context-item la-disabled-entry';
                entry.innerHTML = `${icon}${label}`;
                entry.addEventListener('click', () => {
                    setItemDisabled(item, !disabled);
                    instance.hide();
                });
                // Insert after Edit entry
                const firstEntry = content.querySelector('.lancer-context-item');
                if (firstEntry?.nextSibling) {
                    content.insertBefore(entry, firstEntry.nextSibling);
                } else {
                    content.appendChild(entry);
                }
            }, 0);
        };
    });
}

// ---------------------------------------------------------------------------
// 4. Sheet visual updates + context-menu injection (renderActorSheet hook)
// ---------------------------------------------------------------------------

export function onRenderActorSheet(app, html, _data) {
    const jHtml = html instanceof $ ? html : $(html);
    const actor = app.actor ?? app.document;
    if (!actor)
        return;

    // Dim disabled items (base sheet)
    jHtml.find('.set[data-uuid]').each(function () {
        const uuid = this.dataset.uuid;
        if (!uuid)
            return;
        let item;
        try {
            item = fromUuidSync(uuid);
        } catch {
            return;
        }
        if (!isDisableable(item) || !isItemDisabled(item))
            return;

        const $header = $(this).find('.lancer-header').first();
        $header.addClass('disabled');

        // Swap icon to power-off (skip if already showing destroyed icon)
        const $icon = $header.find('> i, > .lancer-hit-icon > i').first();
        if ($icon.length && !$icon.hasClass('mdi-cog')) {
            $icon.attr('class', 'mdi mdi-power-off');
        }
    });

    // Dim disabled items (alt sheet)
    jHtml.find('[data-uuid][data-accept-types]').each(function () {
        const uuid = this.dataset.uuid;
        if (!uuid)
            return;
        let item;
        try {
            item = fromUuidSync(uuid);
        } catch {
            return;
        }
        if (!isDisableable(item) || !isItemDisabled(item))
            return;

        // Apply alt sheet disabled styling
        const $name = $(this).find('.la-top__span').first();
        $name.addClass('la-text-warning -strikethrough');
    });

    _injectDisabledContextMenu(jHtml);
    _injectAmmoDisplay(jHtml, actor);
    _injectAmmoDisplayAltSheet(jHtml, actor);
}

// ---------------------------------------------------------------------------
// 4b. Ammo display on actor sheet
// ---------------------------------------------------------------------------

/** Inject clickable ammo list into mech_system collapsible bodies on actor sheets. */
function _injectAmmoDisplay(jHtml, actor) {
    jHtml.find('.lancer-system.set').each(function () {
        const uuid = this.dataset?.uuid;
        if (!uuid)
            return;
        let item;
        try {
            item = fromUuidSync(uuid);
        } catch {
            return;
        }
        if (item?.type !== 'mech_system')
            return;

        const ammoArr = item.system?.ammo;
        if (!ammoArr?.length)
            return;

        if ($(this).find('.la-ammo-display').length)
            return;

        const $collapse = $(this).find('.collapse').first();
        if (!$collapse.length)
            return;

        // Action icon from parent item's first action
        const firstAction = item.system?.actions?.[0];
        const activation = firstAction?.activation || 'Free';
        const iconClass = _ammoActivationIcon(activation);

        let entries = '';
        for (let i = 0; i < ammoArr.length; i++) {
            const ammo = ammoArr[i];
            if (!ammo.name)
                continue;
            const cost = ammo.cost ?? 1;
            const typeSizeTags = _buildTypeSizeTags(ammo.allowed_types, ammo.allowed_sizes);

            entries += `
                <div class="la-ammo-entry" data-ammo-index="${i}" data-item-uuid="${uuid}"
                     style="display:flex; gap:6px; padding:5px 0;${i > 0 ? ' border-top:1px solid rgba(255,255,255,0.12);' : ''}">
                    <a class="la-ammo-use lancer-button" style="cursor:pointer; flex-shrink:0; align-self:flex-start;"
                       data-ammo-index="${i}" data-item-uuid="${uuid}"
                       title="Use ${ammo.name} (deducts ${cost} charge${cost > 1 ? 's' : ''})">
                        <i class="${iconClass} i--sm"></i><span>${ammo.name}</span>
                    </a>
                    <div style="flex:1; min-width:0;">
                        <span class="lancer-tag compact-tag">Cost: ${cost}</span>${typeSizeTags ? `<span style="color:#555; margin:0 3px;">|</span><span style="font-size:0.75em; opacity:0.6;">${typeSizeTags}</span>` : ''}
                        ${ammo.description ? `<div style="margin-top:2px; font-size:0.9em;">${ammo.description}</div>` : ''}
                    </div>
                </div>`;
        }

        const ammoHtml = `
            <div class="la-ammo-display effect-box">
                <span class="effect-title clipped-bot">AMMO</span>
                <div class="effect-text" style="padding: 0.3em 0.5em 0.5em 0.5em;">
                    ${entries}
                </div>
            </div>`;

        const $ammo = $(ammoHtml);

        // USE button -> UseAmmoFlow
        $ammo.find('.la-ammo-use').on('click', function (ev) {
            ev.stopPropagation();
            const ammoIndex = parseInt(this.dataset.ammoIndex);
            const itemUuid = this.dataset.itemUuid;
            TriggerUseAmmoFlow(itemUuid, ammoIndex);
        });

        // Insert before the tags row
        const $tags = $collapse.children('.flexrow').last();
        if ($tags.length) {
            $tags.before($ammo);
        } else {
            $collapse.append($ammo);
        }
    });
}

/** Inject ammo display into lancer-alternative-sheets. */
function _injectAmmoDisplayAltSheet(jHtml, actor) {
    if (!jHtml.find('[data-accept-types="mech_system"]').length)
        return;

    jHtml.find('[data-uuid][data-accept-types="mech_system"]').each(function () {
        const uuid = this.dataset?.uuid;
        if (!uuid)
            return;
        let item;
        try {
            item = fromUuidSync(uuid);
        } catch {
            return;
        }
        if (item?.type !== 'mech_system')
            return;

        const ammoArr = item.system?.ammo;
        if (!ammoArr?.length)
            return;

        if ($(this).find('.la-ammo-display').length)
            return;

        const $content = $(this).find('.la-collapsecontent').first();
        if (!$content.length)
            return;

        // Activation color from parent item's first action
        const firstAction = item.system?.actions?.[0];
        const activation = firstAction?.activation || 'Free';
        const colorClass = {
            'Full': 'la-bckg-action--full',
            'Quick': 'la-bckg-action--quick',
            'Reaction': 'la-bckg-npc--reaction',
            'Protocol': 'la-bckg-action--protocol',
            'Free': 'la-bckg-action--free',
            'Full Tech': 'la-bckg-action--tech',
            'Quick Tech': 'la-bckg-action--tech',
            'Invade': 'la-bckg-action--tech',
        }[activation] || 'la-bckg-action--free';

        let entries = '';
        for (let i = 0; i < ammoArr.length; i++) {
            const ammo = ammoArr[i];
            if (!ammo.name)
                continue;
            const cost = ammo.cost ?? 1;
            const typeSizeTags = _buildTypeSizeTags(ammo.allowed_types, ammo.allowed_sizes);

            entries += `
                <div class="la-combine-v -widthfull -alignstart" style="gap:2px;${i > 0 ? ' padding-top:4px; border-top:1px solid rgba(255,255,255,0.08);' : ''}">
                    <div class="la-combine-h -widthfull -aligncenter -justifystart" style="gap:6px; flex-wrap:wrap;">
                        <button type="button"
                            class="la-ammo-use activation-free ${colorClass} clipped-bot-alt -padding1-r -padding0-tb -height3 -letterspacing0 la-text-header la-prmy-header"
                            data-ammo-index="${i}" data-item-uuid="${uuid}"
                            title="Use ${ammo.name} (deducts ${cost} charge${cost > 1 ? 's' : ''})">
                            <span class="la-cmdline -fadein">&gt;://</span>${ammo.name}
                        </button>
                        <span class="lancer-tag compact-tag">Cost: ${cost}</span>${typeSizeTags ? `<span style="color:#555; margin:0 3px;">|</span><span style="font-size:0.75em; opacity:0.6;">${typeSizeTags}</span>` : ''}
                    </div>
                    ${ammo.description ? `<div class="-fontsize-1" style="text-align:left;">${ammo.description}</div>` : ''}
                </div>`;
        }

        const $ammo = $(`
            <div class="la-ammo-display la-effectbox la-bckg-card la-brdr-repcap -widthfull -fontsize1 -bordersround-ltb">
                <span class="la-effectbox__span clipped-bot la-bckg-primary la-text-header -fontsize0">AMMO</span>
                <div class="la-combine-v -widthfull" style="padding:4px 8px;">
                    ${entries}
                </div>
            </div>`);

        $ammo.find('.la-ammo-use').on('click', function (ev) {
            ev.stopPropagation();
            const ammoIndex = parseInt(this.dataset.ammoIndex);
            const itemUuid = this.dataset.itemUuid;
            TriggerUseAmmoFlow(itemUuid, ammoIndex);
        });

        // Insert before tags row
        const $tagsRow = $content.find('.la-combine-h.-wrapwrap').last();
        if ($tagsRow.length) {
            $tagsRow.before($ammo);
        } else {
            $content.append($ammo);
        }
    });
}

/** Trigger UseAmmoFlow via the custom flow dispatch pattern. */
export function TriggerUseAmmoFlow(itemUuid, ammoIndex) {
    const flowDef = game.lancer?.flows?.get('UseAmmoFlow');
    if (!flowDef) {
        ui.notifications?.error('UseAmmoFlow not registered. Is the flow registration enabled?');
        return;
    }

    const item = fromUuidSync(itemUuid);
    if (!item?.actor) {
        ui.notifications?.error('Could not resolve item or actor for ammo flow.');
        return;
    }

    // Build GenericFlow from step-based definition
    const StatRollFlow = game.lancer?.flows?.get('StatRollFlow');
    const FlowBase = typeof StatRollFlow === 'function' ? Object.getPrototypeOf(StatRollFlow) : null;
    if (!FlowBase) {
        ui.notifications?.error('Could not resolve Flow base class.');
        return;
    }

    const GenericFlow = class extends FlowBase {
        constructor(uuid, data) {
            super(uuid, data || {});
        }
    };
    GenericFlow.steps = flowDef.steps;

    new GenericFlow(item.actor.uuid, { itemUuid, ammoIndex }).begin();
}

// ===========================================================================
// UseAmmoFlow — standalone flow for using ammo from a mech_system
// ===========================================================================

async function initUseAmmoData(state) {
    if (!state.data?.itemUuid || state.data.ammoIndex == null)
        throw new TypeError('UseAmmoFlow requires itemUuid and ammoIndex in state.data');

    const item = fromUuidSync(state.data.itemUuid);
    if (!item)
        throw new TypeError(`Item not found: ${state.data.itemUuid}`);

    state.item = item;
    state.actor = item.actor;

    const ammo = item.system?.ammo?.[state.data.ammoIndex];
    if (!ammo)
        throw new TypeError(`Ammo index ${state.data.ammoIndex} not found on ${item.name}`);

    state.data.type = 'ammo';
    state.data.title = `${item.name} — ${ammo.name}`;
    state.data.ammoName = ammo.name;
    state.data.ammoCost = ammo.cost ?? 1;
    state.data.ammoDescription = ammo.description || '';
    state.data.ammoAllowedTypes = ammo.allowed_types;
    state.data.ammoAllowedSizes = ammo.allowed_sizes;
    state.data.ammoRestrictedTypes = ammo.restricted_types;
    state.data.ammoRestrictedSizes = ammo.restricted_sizes;
    return true;
}

async function checkAmmoItemDestroyed(state) {
    if (state.item?.system?.destroyed) {
        ui.notifications.warn(`System ${state.item.name} is destroyed!`);
        return false;
    }
    return true;
}

async function checkAmmoItemDisabled(state) {
    if (state.item?.system?.disabled) {
        ui.notifications.warn(`System ${state.item.name} is disabled!`);
        return false;
    }
    return true;
}

async function checkAmmoItemLimited(state) {
    if (!state.item?.isLimited?.())
        return true;
    const uses = state.item.system.uses;
    const cost = state.data.ammoCost ?? 1;
    if ((uses?.value ?? 0) < cost) {
        ui.notifications.warn(`${state.item.name} does not have enough charges! (need ${cost}, have ${uses?.value ?? 0})`);
        return false;
    }
    return true;
}

async function deductAmmoCost(state) {
    if (!state.item?.isLimited?.())
        return true;
    const cost = state.data.ammoCost ?? 1;
    const current = state.item.system.uses?.value ?? 0;
    await state.item.update({ 'system.uses': Math.max(current - cost, 0) });
    return true;
}

/** Map activation type to CCI icon class. */
function _ammoActivationIcon(activation) {
    switch ((activation || '').toLowerCase()) {
    case 'quick':      return 'cci cci-activation-quick';
    case 'full':       return 'cci cci-activation-full';
    case 'quick tech': case 'invade': return 'cci cci-tech-quick';
    case 'full tech':  return 'cci cci-tech-full';
    case 'reaction':   return 'cci cci-reaction';
    case 'protocol':   return 'cci cci-protocol';
    default:           return 'cci cci-free-action';
    }
}

/** Build type/size restriction tags. All false or all true = no restriction (hidden). */
function _buildTypeSizeTags(allowedTypes, allowedSizes) {
    const tags = [];
    const _collect = (checklist, label) => {
        if (!checklist)
            return;
        const enabled = Object.entries(checklist).filter(([, v]) => v).map(([k]) => k);
        const total = Object.keys(checklist).length;
        if (enabled.length === 0 || enabled.length === total)
            return;
        for (const name of enabled) {
            tags.push(`<span class="lancer-tag compact-tag">${name}</span>`);
        }
    };
    _collect(allowedSizes, 'Size');
    _collect(allowedTypes, 'Type');
    return tags.join(' ');
}

async function printAmmoCard(state) {
    const typeSizeTags = _buildTypeSizeTags(
        state.data.ammoAllowedTypes, state.data.ammoAllowedSizes
    );
    const cost = state.data.ammoCost ?? 1;

    const content = `
        <div class="card clipped-bot" style="margin:0">
            <div class="lancer-header lancer-primary" style="padding:4px 8px;">
                <i class="cci cci-ammo i--m"></i>
                ${state.data.title}
            </div>
            <div style="padding:4px 8px; font-size:0.9em;">
                <b>Cost:</b> ${cost}
            </div>
            ${state.data.ammoDescription ? `<div class="effect-text" style="padding:4px 8px;">${state.data.ammoDescription}</div>` : ''}
            ${typeSizeTags ? `<div style="padding:4px 8px; display:flex; gap:4px; flex-wrap:wrap;">${typeSizeTags}</div>` : ''}
        </div>`;

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: state.actor }),
        content
    });
    return true;
}

export function registerUseAmmoFlow(flowSteps, flows) {
    flowSteps.set('lancer-automations:initUseAmmoData', initUseAmmoData);
    flowSteps.set('lancer-automations:checkAmmoItemDestroyed', checkAmmoItemDestroyed);
    flowSteps.set('lancer-automations:checkAmmoItemDisabled', checkAmmoItemDisabled);
    flowSteps.set('lancer-automations:checkAmmoItemLimited', checkAmmoItemLimited);
    flowSteps.set('lancer-automations:deductAmmoCost', deductAmmoCost);
    flowSteps.set('lancer-automations:printAmmoCard', printAmmoCard);

    flows.set('UseAmmoFlow', {
        name: 'Use Ammo',
        steps: [
            'lancer-automations:initUseAmmoData',
            'lancer-automations:checkAmmoItemDestroyed',
            'lancer-automations:checkAmmoItemDisabled',
            'lancer-automations:checkAmmoItemLimited',
            'lancer-automations:deductAmmoCost',
            'lancer-automations:printAmmoCard'
        ]
    });
}

// ---------------------------------------------------------------------------
// 5. CSS injection
// ---------------------------------------------------------------------------

export function injectDisabledCSS() {
    if (document.getElementById('la-item-disabled-css'))
        return;
    const style = document.createElement('style');
    style.id = 'la-item-disabled-css';
    style.textContent = `
        .lancer-header.disabled {
            opacity: 0.5;
            filter: grayscale(0.4);
        }
        .lancer-header.disabled:hover {
            opacity: 0.7;
        }
        .la-disabled-context-menu {
            z-index: 10000;
            background: var(--lancer-bg-popup, #1e1e2e);
            border: 1px solid var(--lancer-border, #555);
            border-radius: 4px;
            padding: 2px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.6);
            min-width: 150px;
        }
    `;
    document.head.appendChild(style);
}

// ===========================================================================
// Template Patching (runtime, no file edits needed)
// ===========================================================================

/**
 * Patch stat-roll-card template to support embedButtons.
 * Recompiles and registers as a Handlebars partial, overriding the system's version.
 */
export async function patchStatRollCardTemplate() {
    const path = 'systems/lancer/templates/chat/stat-roll-card.hbs';
    try {
        let src = await fetch(path).then(r => r.text());
        if (src.includes('embedButtons'))
            return; // already patched
        src = src.replace(
            '{{/if}}\n</div>',
            '{{/if}}\n  {{#if embedButtons}}\n    {{#each embedButtons}}\n      {{{this}}}\n    {{/each}}\n  {{/if}}\n</div>'
        );
        const compiled = Handlebars.compile(src);
        Handlebars.registerPartial(path, compiled);
    } catch (e) {
        console.error('lancer-automations | Failed to patch stat-roll-card template:', e);
    }
}

// ===========================================================================
// Ammo Editor (injected into mech_system item sheets via renderItemSheet)
// ===========================================================================

/** Build ammo editor HTML. gen-control data attrs handled by Lancer's sheet listeners. */
function _buildAmmoEditorHTML(item) {
    const ammoArr = item.system?.ammo ?? [];
    const path = 'system.ammo';

    let ammoDetail = '';
    for (let i = 0; i < ammoArr.length; i++) {
        const ammo = ammoArr[i];
        ammoDetail += `
        <div class="card clipped" style="margin: 5px; padding: 10px; background: rgba(0,0,0,0.2);">
          <div class="flexrow" style="align-items: center; margin-bottom: 5px;">
            <input class="lancer-header" style="flex: 1; background: transparent; border: none; font-weight: bold;"
                   type="text" name="${path}.${i}.name" value="${ammo.name || ''}"
                   placeholder="Ammo Name" />
            ${ammo.cost != null ? `<span style="margin-left: 10px;">Cost: ${ammo.cost}</span>` : ''}
            <a class="gen-control fas fa-trash" data-action="splice" data-path="${path}.${i}"
               style="margin-left: 10px;"></a>
          </div>
          <textarea name="${path}.${i}.description"
                    style="width: 100%; min-height: 60px; background: rgba(0,0,0,0.3); color: white; border: 1px solid #555; padding: 5px;"
                    placeholder="Description">${ammo.description || ''}</textarea>
        </div>`;
    }

    const defaultValue = JSON.stringify({
        name: '',
        description: '',
        cost: 1,
        allowed_types:  { CQB: false, Cannon: false, Launcher: false, Melee: false, Nexus: false, Rifle: false },
        allowed_sizes:  { Auxiliary: false, Heavy: false, Main: true, Superheavy: false },
        restricted_types: { Rifle: true, Cannon: true, Launcher: true, CQB: true, Nexus: true, Melee: true },
        restricted_sizes: { Auxiliary: true, Main: true, Heavy: true, Superheavy: true }
    });

    return `
    <div class="card clipped item-edit-arrayed la-ammo-editor">
      <span class="lancer-header lancer-primary submajor clipped-top">
        AMMO
        <a class="gen-control fas fa-plus" data-action="append" data-path="${path}"
           data-action-value='${defaultValue}'></a>
      </span>
      ${ammoDetail}
    </div>`;
}

/** renderItemSheet hook — inject ammo editor into mech_system sheets. */
export function onRenderItemSheet(app, html, _data) {
    const item = app.item ?? app.document;
    if (!item || item.type !== 'mech_system')
        return;

    const jHtml = html instanceof $ ? html : $(html);

    // Inject after INTEGRATED ITEMS section
    const $sections = jHtml.find('.item-edit-arrayed');
    const $integrated = $sections.filter(function () {
        return $(this).find('.lancer-header').text().trim() === 'INTEGRATED ITEMS';
    });

    if (jHtml.find('.la-ammo-editor').length)
        return;

    const ammoHtml = _buildAmmoEditorHTML(item);
    if ($integrated.length) {
        $integrated.after(ammoHtml);
    } else {
        // Fallback: append at end of arrayed-edits container
        const $container = $sections.last().parent();
        if ($container.length)
            $container.append(ammoHtml);
    }
}

// ===========================================================================
// Melee Cover Fix (strip cover from melee non-throw attacks)
// ===========================================================================

/**
 * Per RAW, cover only applies to ranged attacks and melee throws.
 * The system always sets cover regardless of attack type -- this zeroes it for non-throw melee.
 */
async function stripCoverForMelee(state) {
    if (!state.data?.acc_diff?.targets)
        return true;

    const isMelee = state.data.attack_type === 'Melee';
    const isThrow = state.la_extraData?.is_throw === true;

    // Propagate is_throw for other modules/macros
    if (isThrow)
        state.data.is_throw = true;

    if (isMelee && !isThrow) {
        for (const t of state.data.acc_diff.targets) {
            t.cover = 0;
        }
    }
    return true;
}

export function registerMeleeCoverFix(flowSteps, flows) {
    flowSteps.set('lancer-automations:stripCoverForMelee', stripCoverForMelee);

    // Before showAttackHUD so the HUD displays correct cover
    flows.get('WeaponAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:stripCoverForMelee');
    flows.get('BasicAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:stripCoverForMelee');
}

// ===========================================================================
// Extra Trackable Attributes
// ===========================================================================

/** Add action_tracker fields to token resource bar options. Call during `ready`. */
export function registerExtraTrackableAttributes() {
    const ta = CONFIG.Actor.trackableAttributes;
    if (!ta)
        return;

    const _push = (obj, arr, ...vals) => {
        if (!obj?.[arr])
            return;
        for (const v of vals) {
            if (!obj[arr].includes(v))
                obj[arr].push(v);
        }
    };

    _push(ta.mech, 'value', 'action_tracker.move', 'action_tracker.reaction', 'infection');
    _push(ta.npc, 'value', 'action_tracker.reaction', 'action_tracker.move', 'infection');
    _push(ta.pilot, 'value', 'action_tracker.move');
}

// ===========================================================================
// Custom Flow Dispatch (intercepts .flow-button clicks for module-registered flows)
// ===========================================================================

/**
 * Intercepts .flow-button clicks for module-registered flows that the system
 * doesn't know about (it only handles hardcoded types). Uses capture phase
 * to fire before the system's handler.
 */

const SYSTEM_FLOW_TYPES = new Set([
    'StatRollFlow', 'WeaponAttackFlow', 'TechAttackFlow', 'BasicAttackFlow',
    'ActivationFlow', 'CoreActiveFlow', 'SystemFlow', 'TalentFlow',
    'BondPowerFlow', 'DamageRollFlow', 'OverchargeFlow', 'StabilizeFlow',
    'FullRepairFlow', 'OverheatFlow', 'StructureFlow', 'CascadeFlow',
    'SecondaryStructureFlow', 'BasicFlowType', 'dismembermentDamage',
    'secondary_structure', 'cascade',
    // Add other system-native flow types here as needed
]);

export function initCustomFlowDispatch() {
    document.getElementById('chat-log')?.addEventListener('click', (ev) => {
        const button = ev.target?.closest?.('.flow-button[data-flow-type]');
        if (!button)
            return;

        const flowType = button.dataset.flowType;
        if (!flowType)
            return;

        if (SYSTEM_FLOW_TYPES.has(flowType))
            return;

        const customFlow = game.lancer?.flows?.get(flowType);
        if (!customFlow)
            return; // not ours, let system show its error

        // Stop the system from seeing this click
        ev.stopPropagation();
        ev.preventDefault();

        const actorId = button.dataset.actorId;
        if (!actorId) {
            ui.notifications?.error(`No actor ID found on ${flowType} prompt button.`);
            return;
        }

        const actor = CONFIG.Actor.documentClass.fromUuidSync?.(actorId)
            ?? fromUuidSync(actorId);
        if (!actor) {
            ui.notifications?.error(`Invalid actor ID on ${flowType} prompt button.`);
            return;
        }

        if (typeof customFlow === 'function') {
            new customFlow(actor.uuid).begin();
        } else if (customFlow.steps) {
            // Step-based object -- create a generic Flow dynamically
            const Flow = game.lancer?.flows?.get('StatRollFlow')?.__proto__;
            if (!Flow) {
                ui.notifications?.error(`Cannot resolve Flow base class for ${flowType}.`);
                return;
            }
            const GenericFlow = class extends Flow {
                constructor(uuid, data) {
                    super(uuid, data || {});
                }
            };
            GenericFlow.steps = customFlow.steps;

            let initialData = {};
            if (button.dataset.checkType) {
                initialData.path = `system.${button.dataset.checkType}`;
            }
            // Forward all data-* attributes
            for (const [key, val] of Object.entries(button.dataset)) {
                if (key !== 'flowType' && key !== 'actorId' && key !== 'checkType') {
                    initialData[key] = val;
                }
            }

            new GenericFlow(actor.uuid, initialData).begin();
        } else {
            ui.notifications?.error(`Invalid flow structure for ${flowType}.`);
        }
    }, { capture: true });
}

// ===========================================================================
// LCP Data Repair
// ===========================================================================

/**
 * Call via API: game.modules.get('lancer-automations').api.repairLCPData()
 */
export async function repairLCPData() {
    if (!game.user.isGM) {
        ui.notifications.error('Only the GM can run LCP data repair.');
        return;
    }

    const confirmed = await Dialog.confirm({
        title: 'Lancer Automations — Apply System Fixes',
        content: `<p>This will fix known data issues on all compendium and actor-owned items.</p><p>Continue?</p>`,
        defaultYes: true
    });
    if (!confirmed)
        return;

    try {
        // Get raw LCP source data
        const entryResp = await fetch('/systems/lancer/lancer.mjs');
        const entryText = await entryResp.text();
        const match = entryText.match(/import\s+["']\.\/([^"']+)["']/);
        if (!match)
            throw new Error('Could not find system bundle filename');
        const bundle = await import(`/systems/lancer/${match[1]}`);
        const getOfficialData = bundle.e;
        if (!getOfficialData)
            throw new Error('Could not resolve getOfficialData');

        ui.notifications.info('Reading LCP source data...');
        const allData = await getOfficialData(null);

        // Build maps of raw LCP data by LID
        const rawAmmoByLid = new Map();
        const rawWeaponByLid = new Map();
        for (const data of allData) {
            for (const sys of data?.cp?.data?.systems ?? []) {
                if (sys.ammo?.length && sys.id)
                    rawAmmoByLid.set(sys.id, sys.ammo);
            }
            for (const wpn of data?.cp?.data?.weapons ?? []) {
                if (wpn.id)
                    rawWeaponByLid.set(wpn.id, wpn);
            }
        }

        let fixed = 0;

        // Fix compendium items (Lancer uses world-scope packs: world.mech-items, world.npc-items, etc.)
        const lancerPacks = ['world.mech-items', 'world.pilot-items', 'world.npc-items'];
        for (const pack of lancerPacks.map(id => game.packs.get(id)).filter(Boolean)) {
            const wasLocked = pack.locked;
            if (wasLocked)
                await pack.configure({ locked: false });
            for (const doc of await pack.getDocuments()) {
                if (await _fixItem(doc, rawAmmoByLid, rawWeaponByLid))
                    fixed++;
            }
            if (wasLocked)
                await pack.configure({ locked: true });
        }

        // Fix actor-owned items
        for (const actor of game.actors) {
            for (const item of actor.items) {
                if (await _fixItem(item, rawAmmoByLid, rawWeaponByLid))
                    fixed++;
            }
        }

        // Fix world items
        for (const item of game.items) {
            if (await _fixItem(item, rawAmmoByLid, rawWeaponByLid))
                fixed++;
        }

        ui.notifications.info(`Applied fixes to ${fixed} item(s).${fixed > 0 ? ' Reload recommended.' : ''}`, { permanent: fixed > 0 });
    } catch (e) {
        console.error('lancer-automations | repairLCPData failed:', e);
        ui.notifications.error(`Repair failed: ${e.message}. Check console.`);
    }
}

/** Case-insensitive checklist builder (mirrors the bundle fix). */
function _makeTypeChecklist(types, validKeys) {
    const lc = types.map(t => t.toLowerCase());
    const override = types.length === 0;
    const result = {};
    for (const key of validKeys) {
        result[key] = override || lc.includes(key.toLowerCase());
    }
    return result;
}

const _WEAPON_TYPES = ['CQB', 'Cannon', 'Launcher', 'Melee', 'Nexus', 'Rifle'];
const _WEAPON_SIZES = ['Auxiliary', 'Main', 'Heavy', 'Superheavy'];

/** Fix a single item from raw LCP source. Returns true if changed. */
async function _fixItem(item, rawAmmoByLid, rawWeaponByLid) {
    const lid = item.system?.lid;
    if (!lid)
        return false;

    const updates = {};
    let changed = false;

    // --- Ammo fixes ---
    const rawAmmo = rawAmmoByLid.get(lid);
    if (rawAmmo && item.system?.ammo?.length) {
        const fixedAmmo = item.system.ammo.map((a, i) => {
            const raw = rawAmmo[i];
            if (!raw)
                return a;
            const fix = { ...a };

            if (!fix.description && raw.detail) {
                fix.description = raw.detail;
                changed = true;
            }
            if (raw.allowed_types && Array.isArray(raw.allowed_types)) {
                const correct = _makeTypeChecklist(raw.allowed_types, _WEAPON_TYPES);
                if (JSON.stringify(fix.allowed_types) !== JSON.stringify(correct)) {
                    fix.allowed_types = correct;
                    changed = true;
                }
            }
            if (raw.allowed_sizes && Array.isArray(raw.allowed_sizes)) {
                const correct = _makeTypeChecklist(raw.allowed_sizes, _WEAPON_SIZES);
                if (JSON.stringify(fix.allowed_sizes) !== JSON.stringify(correct)) {
                    fix.allowed_sizes = correct;
                    changed = true;
                }
            }
            return fix;
        });
        if (changed)
            updates['system.ammo'] = fixedAmmo;
    }

    // --- Weapon profile text merging ---
    const rawWeapon = rawWeaponByLid.get(lid);
    if (rawWeapon && item.system?.profiles?.length && rawWeapon.profiles?.length > 1) {
        const wpnEffect = rawWeapon.effect || '';
        const wpnOnAttack = rawWeapon.on_attack || '';
        const wpnOnCrit = rawWeapon.on_crit || '';
        const wpnOnHit = rawWeapon.on_hit || '';

        if (wpnEffect || wpnOnAttack || wpnOnCrit || wpnOnHit) {
            const fixedProfiles = item.system.profiles.map((prof, i) => {
                const rawProf = rawWeapon.profiles[i];
                if (!rawProf)
                    return prof;
                const fix = { ...prof };
                const name = rawProf.name ?? `${rawWeapon.name} :: ${i + 1}`;
                let profChanged = false;

                for (const field of ['effect', 'on_attack', 'on_crit', 'on_hit']) {
                    const wpnText = rawWeapon[field] || '';
                    const profText = rawProf[field] || '';
                    if (!wpnText)
                        continue;
                    if (!profText) {
                        if (fix[field] !== wpnText) {
                            fix[field] = wpnText; profChanged = true;
                        }
                    } else if (wpnText !== profText) {
                        const merged = wpnText + '<br><br>' + name + ':: ' + profText;
                        if (fix[field] !== merged) {
                            fix[field] = merged; profChanged = true;
                        }
                    }
                }
                if (profChanged)
                    changed = true;
                return fix;
            });
            if (changed && !updates['system.ammo'])
                updates['system.profiles'] = fixedProfiles;
            else if (changed)
                updates['system.profiles'] = fixedProfiles;
        }
    }

    if (changed) {
        try {
            await item.update(updates);
        } catch (e) {
            console.warn(`lancer-automations | Could not fix ${item.name}:`, e);
            return false;
        }
    }
    return changed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ItemDisabledAPI = {
    isItemDisabled,
    setItemDisabled,
    isDisableable,
};
