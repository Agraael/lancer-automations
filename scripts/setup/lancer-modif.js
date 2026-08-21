// Lancer system patches applied at init/ready, without editing the system bundle.

// Schema extension: add `disabled` field to item data models

/**
 * Inject `disabled` BooleanField into item schemas. Must be called during `init`.
 * Without this, `item.update({'system.disabled': true})` is silently ignored.
 */
export function injectDisabledSchemaField()
{
    const BooleanField = foundry.data.fields.BooleanField;
    const modelKeys = ['mech_weapon', 'mech_system', 'npc_feature', 'weapon_mod'];
    let injected = 0;
    for (const key of modelKeys)
    {
        const model = CONFIG.Item.dataModels?.[key];
        if (!model?.schema)
            continue;

        if (!model.schema.fields.disabled)
        {
            try
            {
                model.schema.fields.disabled = new BooleanField({ initial: false });
                injected++;
            }
            catch (e)
            {
                console.warn(`lancer-automations | Could not inject disabled field into ${key}:`, e);
            }
        }
    }
    if (injected)
        console.log(`lancer-automations | Injected disabled field into ${injected} item schema(s)`);
}

// Helpers

/** Item types that support the disabled state. */
const DISABLEABLE_TYPES = new Set(['mech_weapon', 'mech_system', 'npc_feature', 'weapon_mod']);

/** @returns {boolean} */
function isDisableable(item)
{
    return item?.documentName === 'Item' && DISABLEABLE_TYPES.has(item.type);
}

/** @returns {boolean} */
function isItemDisabled(item)
{
    return !!item?.system?.disabled;
}

/** @returns {Promise<Item>} */
async function setItemDisabled(item, disabled)
{
    return item.update({ 'system.disabled': disabled });
}

// 1. Flow step: block disabled items

async function checkItemDisabled(state)
{
    if (!state.item)
        return true;
    if (!isDisableable(state.item))
        return true;

    if (isItemDisabled(state.item))
    {
        const isSystem =
            state.item.type === 'mech_system' ||
            (state.item.type === 'npc_feature' && state.item.system?.type !== 'Weapon');
        const label = isSystem ? 'System' : 'Weapon';
        ui.notifications.warn(`${label} ${state.item.name} is disabled!`);
        return false;
    }
    return true;
}

// 2. Flow registration

export function registerDisabledFlowSteps(flowSteps, flows)
{
    flowSteps.set('lancer-automations:checkItemDisabled', checkItemDisabled);

    // insertStepAfter double-inserts when the anchor is missing, so list only flows that really have checkItemDestroyed
    const targets = [
        'WeaponAttackFlow',
        'BasicAttackFlow',
        'TechAttackFlow',
        'ActivationFlow',
        'SystemFlow',
        'CoreActiveFlow',
    ];
    for (const name of targets)
        flows.get(name)?.insertStepAfter('checkItemDestroyed', 'lancer-automations:checkItemDisabled');

    // Repair: clear disabled flags + recharge spent recharge features after the full-repair executes
    flowSteps.set('lancer-automations:clearDisabledOnRepair', clearDisabledOnRepair);
    flows.get('FullRepairFlow')?.insertStepAfter('executeFullRepair', 'lancer-automations:clearDisabledOnRepair');
}

async function clearDisabledOnRepair(state)
{
    if (!state.actor)
        return true;
    const updates = [];
    for (const item of state.actor.items)
    {
        const update = { _id: item.id };
        if (isDisableable(item) && isItemDisabled(item))
            update['system.disabled'] = false;
        if (item.system?.charged === false && item.system.tags?.some(tag => tag.lid === 'tg_recharge'))
            update['system.charged'] = true;
        if (Object.keys(update).length > 1)
            updates.push(update);
    }
    if (updates.length)
        await state.actor.updateEmbeddedDocuments('Item', updates);
    return true;
}

// Permanent statuses survive Full Repair; marker: flags['lancer-automations'].duration.label === 'permanent'.

export function registerPermanentStatusFlowSteps(flowSteps, flows)
{
    flowSteps.set('lancer-automations:snapshotPermanentEffects', snapshotPermanentEffects);
    flowSteps.set('lancer-automations:restorePermanentEffects', restorePermanentEffects);
    const repair = flows.get('FullRepairFlow');
    repair?.insertStepBefore('executeFullRepair', 'lancer-automations:snapshotPermanentEffects');
    repair?.insertStepAfter('executeFullRepair', 'lancer-automations:restorePermanentEffects');
}

async function snapshotPermanentEffects(state)
{
    if (!state.actor || !state.data)
        return true;
    const perm = state.actor.effects
        .filter(e => e.getFlag('lancer-automations', 'duration')?.label === 'permanent')
        .map(effect =>
        {
            const effectData = effect.toObject();
            delete effectData._id;
            return effectData;
        });
    state.data._permEffects = perm;
    return true;
}

async function restorePermanentEffects(state)
{
    const perm = state.data?._permEffects;
    if (!state.actor || !perm?.length)
        return true;
    await state.actor.createEmbeddedDocuments('ActiveEffect', perm);
    return true;
}

// 3. Context menu: inject into Lancer's tippy menus

/** Resolve item from a context-menu target (UUID on closest `.set[data-uuid]`). */
function _resolveItem(el)
{
    const domEl = el instanceof $ ? el[0] : el;
    const setEl = domEl?.closest?.('.set[data-uuid]') ?? domEl?.closest?.('[data-uuid]');
    const uuid = setEl?.dataset?.uuid;
    if (!uuid)
        return null;
    try
    {
        return fromUuidSync(uuid);
    }
    catch
    {
        return null;
    }
}

/** Extend tippy context menus with "Mark Disabled / Not Disabled" for disableable items. */
function _injectDisabledContextMenu(jHtml)
{
    jHtml.find('.lancer-context-menu').each(function ()
    {
        const tippyInstance = this._tippy;
        if (!tippyInstance)
            return;

        const item = _resolveItem(this);
        if (!item || !isDisableable(item))
            return;

        // Wrap onShow to inject our entry each time the menu opens
        const origOnShow = tippyInstance.props.onShow;
        tippyInstance.props.onShow = (instance) =>
        {
            if (origOnShow)
                origOnShow(instance);

            // Wait a tick for tippy to populate content
            setTimeout(() =>
            {
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
                entry.addEventListener('click', () =>
                {
                    setItemDisabled(item, !disabled);
                    instance.hide();
                });
                // Insert after Edit entry
                const firstEntry = content.querySelector('.lancer-context-item');
                if (firstEntry?.nextSibling)
                    content.insertBefore(entry, firstEntry.nextSibling);
                else
                    content.appendChild(entry);
            }, 0);
        };
    });
}

// 4. Sheet visual updates + context-menu injection (renderActorSheet hook)

export function onRenderActorSheet(app, html, _data)
{
    const jHtml = html instanceof $ ? html : $(html);
    const actor = app.actor ?? app.document;
    if (!actor)
        return;

    // Dim disabled items (base sheet)
    jHtml.find('.set[data-uuid]').each(function ()
    {
        const uuid = this.dataset.uuid;
        if (!uuid)
            return;
        let item;
        try
        {
            item = fromUuidSync(uuid);
        }
        catch
        {
            return;
        }
        if (!isDisableable(item) || !isItemDisabled(item))
            return;

        const $header = $(this).find('.lancer-header').first();
        $header.addClass('la-disabled');

        // Swap icon to power-off (skip if already showing destroyed icon)
        const $icon = $header.find('> i, > .lancer-hit-icon > i').first();
        if ($icon.length && !$icon.hasClass('mdi-cog'))
            $icon.attr('class', 'mdi mdi-power-off');
    });

    // Disabled items (alt sheet): show "DISABLED" in the subtitle like "DESTROYED"
    jHtml.find('[data-uuid][data-accept-types]').each(function ()
    {
        const uuid = this.dataset.uuid;
        if (!uuid)
            return;
        let item;
        try
        {
            item = fromUuidSync(uuid);
        }
        catch
        {
            return;
        }
        if (!isDisableable(item) || !isItemDisabled(item))
            return;
        // Don't override if already destroyed
        if (item.system?.destroyed)
            return;

        // Same as destroyed but orange "DISABLED" subtitle
        const $name = $(this).find('.la-top__span').first();
        $name.removeClass('la-text-header').addClass('la-text-repcap -strikethrough');

        const $icon = $(this).find('.la-summary button i').first();
        $icon.addClass('la-text-repcap');

        const $subtitle = $(this).find('.la-summary .la-terminaltext span').first();
        if ($subtitle.length)
            $subtitle.text('DISABLED');

        const $subtitleContainer = $(this).find('.la-summary .la-terminaltext').first();
        $subtitleContainer.removeClass('la-text-header la-prmy-header').addClass('la-text-warning');

        $(this).find('.la-range, .la-damage').addClass('la-text-repcap');
    });

    _injectDisabledContextMenu(jHtml);
    _injectAmmoDisplay(jHtml, actor);
    _injectAmmoDisplayAltSheet(jHtml, actor);
    _injectPilotStressBar(jHtml, actor);
}

// Stress bar/stat under HP on the pilot sheet, cloned from the HP element so the style matches exactly.
function _injectPilotStressBar(jHtml, actor)
{
    if (actor.type !== 'pilot')
        return;
    const stress = actor.system?.bond_state?.stress;
    if (!(stress?.max > 0))
        return;
    try
    {
        if (!game.settings.get('lancer-automations', 'statBarDefaultPilotStress'))
            return;
    }
    catch
    {
        return;
    }
    if (jHtml.find('.la-pilot-stress-bar, .la-pilot-stress-stat').length)
        return;

    // Newer alt sheets ship their own bond stress bar; injecting a second same-named input breaks the form.
    const $altStress = jHtml.find('input[name="system.bond_state.stress.value"]').first();
    if ($altStress.length)
    {
        $altStress.closest('.la-statusbar').find('.la-bar-h-current.la-bckg-bar-heat').each(function ()
        {
            this.style.setProperty('background', '#d9b800', 'important');
        });
        return;
    }

    const stressValue = stress.value ?? 0;
    const max = stress.max ?? 8;
    const pct = Math.max(0, Math.min(100, (stressValue / max) * 100));
    const $hpInput = jHtml.find('input[name="system.hp.value"]').first();

    // Alt sheet: clone the HP StatusBar and replay its focus/blur editing (Svelte reactivity doesn't clone).
    const $hpBar = $hpInput.closest('.la-statusbar');
    if ($hpBar.length)
    {
        const $bar = $hpBar.clone().addClass('la-pilot-stress-bar');
        $bar.find('.la-bar-h-current.-secondary, .la-bar-h-current.-tertiary').remove();
        const $fill = $bar.find('.la-bar-h-current').first();
        $fill.attr('class', ($fill.attr('class') || '').replace(/\bla-bckg-\S+/g, '').trim());
        const restStyle = `--la-percent:${pct}%; background:#d9b800 !important;`;
        $fill.attr('style', restStyle);
        const $lbl = $bar.find('.la-damage__span').first();
        if ($lbl.length)
            $lbl.text('STRESS');
        const $input = $bar.find('input').first();
        const $span = $bar.find('.la-bar-h-progress__span');
        $input.attr('name', 'system.bond_state.stress.value').val(stressValue);
        $span.text(`${stressValue}/${max}`);
        $input.on('focus', function ()
        {
            this.select();
            $input.removeClass('la-text-transparent').addClass('la-text-text');
            $span.addClass('-visibilityhidden');
            $fill.attr('style', `--la-percent:${pct}%`).addClass('-pulse-bckg-prmy -fast');
        });
        $input.on('blur', function ()
        {
            $input.removeClass('la-text-text').addClass('la-text-transparent');
            $span.removeClass('-visibilityhidden');
            $fill.removeClass('-pulse-bckg-prmy -fast').attr('style', restStyle);
        });
        $input.on('change', async function ()
        {
            const raw = String(this.value).trim();
            const next = /^[+-]/.test(raw) ? stressValue + Number(raw) : Number(raw);
            if (Number.isFinite(next))
                await actor.update({ 'system.bond_state.stress.value': Math.max(0, Math.min(max, Math.round(next))) });
        });
        $hpBar.after($bar);
        return;
    }

    // Base sheet: clone the HP compact-stat (native form submit handles the edit).
    const $hpStat = $hpInput.closest('.compact-stat');
    if (!$hpStat.length)
        return;
    const $stat = $hpStat.clone().addClass('la-pilot-stress-stat');
    $stat.find('i').first().attr('class', 'mdi mdi-brain i--4 i--dark');
    $stat.find('input[name="system.hp.value"]').attr('name', 'system.bond_state.stress.value').val(stressValue);
    $stat.find('.lancer-stat.minor').last().text(max);
    $hpStat.after($stat);
}

// 4b. Ammo display on actor sheet

/** Inject clickable ammo list into mech_system collapsible bodies on actor sheets. */
function _injectAmmoDisplay(jHtml, actor)
{
    jHtml.find('.lancer-system.set').each(function ()
    {
        const uuid = this.dataset?.uuid;
        if (!uuid)
            return;
        let item;
        try
        {
            item = fromUuidSync(uuid);
        }
        catch
        {
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

        const firstAction = item.system?.actions?.[0];
        const activation = firstAction?.activation || 'Free';
        const iconClass = _ammoActivationIcon(activation);

        let entries = '';
        for (let i = 0; i < ammoArr.length; i++)
        {
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
        $ammo.find('.la-ammo-use').on('click', function (ev)
        {
            ev.stopPropagation();
            const ammoIndex = parseInt(this.dataset.ammoIndex);
            const itemUuid = this.dataset.itemUuid;
            TriggerUseAmmoFlow(itemUuid, ammoIndex);
        });

        // Insert before the tags row
        const $tags = $collapse.children('.flexrow').last();
        if ($tags.length)
            $tags.before($ammo);
        else
            $collapse.append($ammo);
    });
}

/** Inject ammo display into lancer-alternative-sheets. */
function _injectAmmoDisplayAltSheet(jHtml, actor)
{
    if (!jHtml.find('[data-accept-types="mech_system"]').length)
        return;

    jHtml.find('[data-uuid][data-accept-types="mech_system"]').each(function ()
    {
        const uuid = this.dataset?.uuid;
        if (!uuid)
            return;
        let item;
        try
        {
            item = fromUuidSync(uuid);
        }
        catch
        {
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
        for (let i = 0; i < ammoArr.length; i++)
        {
            const ammo = ammoArr[i];
            if (!ammo.name)
                continue;
            const cost = ammo.cost ?? 1;
            const typeSizeTags = _buildTypeSizeTags(ammo.allowed_types, ammo.allowed_sizes);

            entries += `
                <div class="la-flexcol -widthfull -alignstart" style="gap:2px;${i > 0 ? ' padding-top:4px; border-top:1px solid rgba(255,255,255,0.08);' : ''}">
                    <div class="la-flexrow -widthfull -aligncenter -justifystart" style="gap:6px; flex-wrap:wrap;">
                        <button type="button"
                            class="la-ammo-use activation-free ${colorClass} clipped-bot-alt -padding1-r -padding0-tb -letterspacing0 la-text-header la-prmy-header"
                            data-ammo-index="${i}" data-item-uuid="${uuid}"
                            title="Use ${ammo.name} (deducts ${cost} charge${cost > 1 ? 's' : ''})">
                            <span class="la-cmdline -fadein">&gt;://</span>${ammo.name}
                        </button>
                        <span class="lancer-tag compact-tag">Cost: ${cost}</span>${typeSizeTags ? `<span style="color:#555; margin:0 3px;">|</span><span style="font-size:0.75em; opacity:0.6;">${typeSizeTags}</span>` : ''}
                    </div>
                    ${ammo.description ? `<div class="-fontsizesmall" style="text-align:left;">${ammo.description}</div>` : ''}
                </div>`;
        }

        const $ammo = $(`
            <div class="la-ammo-display la-effectbox la-bckg-card la-brdr-repcap -widthfull -fontsizemedium-bordersround-ltb">
                <span class="la-effectbox__span clipped-bot la-bckg-primary la-text-header -fontsizesmall">AMMO</span>
                <div class="la-flexcol -widthfull" style="padding:4px 8px;">
                    ${entries}
                </div>
            </div>`);

        $ammo.find('.la-ammo-use').on('click', function (ev)
        {
            ev.stopPropagation();
            const ammoIndex = parseInt(this.dataset.ammoIndex);
            const itemUuid = this.dataset.itemUuid;
            TriggerUseAmmoFlow(itemUuid, ammoIndex);
        });

        // Insert before tags row
        const $tagsRow = $content.find('.la-flexrow.-wrapwrap').last();
        if ($tagsRow.length)
            $tagsRow.before($ammo);
        else
            $content.append($ammo);
    });
}

/** Trigger UseAmmoFlow via the custom flow dispatch pattern. */
export function TriggerUseAmmoFlow(itemUuid, ammoIndex)
{
    const flowDef = game.lancer?.flows?.get('UseAmmoFlow');
    if (!flowDef)
    {
        ui.notifications?.error('UseAmmoFlow not registered. Is the flow registration enabled?');
        return;
    }

    const item = fromUuidSync(itemUuid);
    if (!item?.actor)
    {
        ui.notifications?.error('Could not resolve item or actor for ammo flow.');
        return;
    }

    // Build GenericFlow from step-based definition
    const StatRollFlow = game.lancer?.flows?.get('StatRollFlow');
    const FlowBase = typeof StatRollFlow === 'function' ? Object.getPrototypeOf(StatRollFlow) : null;
    if (!FlowBase)
    {
        ui.notifications?.error('Could not resolve Flow base class.');
        return;
    }

    const GenericFlow = class extends FlowBase
    {
        constructor(uuid, data)
        {
            super(uuid, data || {});
        }
    };
    GenericFlow.steps = flowDef.steps;

    new GenericFlow(item.actor.uuid, { itemUuid, ammoIndex }).begin();
}

// UseAmmoFlow: standalone flow for using ammo from a mech_system.
async function initUseAmmoData(state)
{
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

async function checkAmmoItemDestroyed(state)
{
    if (state.item?.system?.destroyed)
    {
        ui.notifications.warn(`System ${state.item.name} is destroyed!`);
        return false;
    }
    return true;
}

async function checkAmmoItemDisabled(state)
{
    if (state.item?.system?.disabled)
    {
        ui.notifications.warn(`System ${state.item.name} is disabled!`);
        return false;
    }
    return true;
}

async function checkAmmoItemLimited(state)
{
    if (!state.item?.isLimited?.())
        return true;
    const uses = state.item.system.uses;
    const cost = state.data.ammoCost ?? 1;
    if ((uses?.value ?? 0) < cost)
    {
        ui.notifications.warn(`${state.item.name} does not have enough charges! (need ${cost}, have ${uses?.value ?? 0})`);
        return false;
    }
    return true;
}

async function deductAmmoCost(state)
{
    if (!state.item?.isLimited?.())
        return true;
    const cost = state.data.ammoCost ?? 1;
    const current = state.item.system.uses?.value ?? 0;
    await state.item.update({ 'system.uses': Math.max(current - cost, 0) });
    return true;
}

/** Map activation type to CCI icon class. */
function _ammoActivationIcon(activation)
{
    switch ((activation || '').toLowerCase())
    {
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
function _buildTypeSizeTags(allowedTypes, allowedSizes)
{
    const tags = [];
    const _collect = (checklist) =>
    {
        if (!checklist)
            return;
        const enabled = Object.entries(checklist).filter(([, isChecked]) => isChecked).map(([k]) => k);
        const total = Object.keys(checklist).length;
        if (enabled.length === 0 || enabled.length === total)
            return;
        for (const name of enabled)
            tags.push(`<span class="lancer-tag compact-tag">${name}</span>`);
    };
    _collect(allowedSizes);
    _collect(allowedTypes);
    return tags.join(' ');
}

async function printAmmoCard(state)
{
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

export function registerUseAmmoFlow(flowSteps, flows)
{
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

// 5. CSS injection

export function injectDisabledCSS()
{
    if (document.getElementById('la-item-disabled-css'))
        return;
    const style = document.createElement('style');
    style.id = 'la-item-disabled-css';
    style.textContent = `
        .lancer-header.la-disabled {
            opacity: 0.5;
            filter: grayscale(0.4);
        }
        .lancer-header.la-disabled:hover {
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

// Patch stat-roll-card to support embedButtons; runtime override of the system's partial.
export async function patchStatRollCardTemplate()
{
    const path = 'systems/lancer/templates/chat/stat-roll-card.hbs';
    try
    {
        let src = await fetch(path).then(r => r.text());
        if (src.includes('embedButtons'))
            return; // already patched
        src = src.replace(
            '{{/if}}\n</div>',
            '{{/if}}\n  {{#if embedButtons}}\n    {{#each embedButtons}}\n      {{{this}}}\n    {{/each}}\n  {{/if}}\n</div>'
        );
        const compiled = Handlebars.compile(src);
        Handlebars.registerPartial(path, compiled);
    }
    catch (e)
    {
        console.error('lancer-automations | Failed to patch stat-roll-card template:', e);
    }
}

// Ammo editor injected into mech_system item sheets via renderItemSheet.
// gen-control data attrs are handled by Lancer's sheet listeners.
function _buildAmmoEditorHTML(item)
{
    const ammoArr = item.system?.ammo ?? [];
    const path = 'system.ammo';

    let ammoDetail = '';
    for (let i = 0; i < ammoArr.length; i++)
    {
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

/** renderItemSheet hook: inject ammo editor into mech_system sheets. */
export function onRenderItemSheet(app, html, _data)
{
    const item = app.item ?? app.document;
    if (!item || item.type !== 'mech_system')
        return;

    const jHtml = html instanceof $ ? html : $(html);

    // Inject after INTEGRATED ITEMS section
    const $sections = jHtml.find('.item-edit-arrayed');
    const $integrated = $sections.filter(function ()
    {
        return $(this).find('.lancer-header').text().trim() === 'INTEGRATED ITEMS';
    });

    if (jHtml.find('.la-ammo-editor').length)
        return;

    const ammoHtml = _buildAmmoEditorHTML(item);
    if ($integrated.length)
        $integrated.after(ammoHtml);
    else
    {
        // Fallback: append at end of arrayed-edits container
        const $container = $sections.last().parent();
        if ($container.length)
            $container.append(ammoHtml);
    }
}

/**
 * Per RAW, cover only applies to ranged attacks and melee throws.
 * The system always sets cover regardless of attack type; this zeroes it for non-throw melee.
 */
async function stripCoverForMelee(state)
{
    if (!state.data?.acc_diff?.targets)
        return true;

    const isMelee = state.data.attack_type === 'Melee';
    const isThrow = state.la_extraData?.is_throw === true;

    // Propagate is_throw for other modules/macros
    if (isThrow)
        state.data.is_throw = true;

    if (isMelee && !isThrow)
    {
        for (const t of state.data.acc_diff.targets)
            t.cover = 0;
    }
    return true;
}

export function registerMeleeCoverFix(flowSteps, flows)
{
    flowSteps.set('lancer-automations:stripCoverForMelee', stripCoverForMelee);

    // Before showAttackHUD so the HUD displays correct cover
    flows.get('WeaponAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:stripCoverForMelee');
    flows.get('BasicAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:stripCoverForMelee');
}

// Add action_tracker fields to token resource bar options; call during ready.
export function registerExtraTrackableAttributes()
{
    const trackableAttributes = CONFIG.Actor.trackableAttributes;
    if (!trackableAttributes)
        return;

    const _push = (attrs, key, ...vals) =>
    {
        if (!attrs?.[key])
            return;
        for (const attr of vals)
        {
            if (!attrs[key].includes(attr))
                attrs[key].push(attr);
        }
    };

    _push(trackableAttributes.mech, 'value', 'action_tracker.move', 'action_tracker.reaction', 'infection');
    _push(trackableAttributes.npc, 'value', 'action_tracker.reaction', 'action_tracker.move', 'infection');
    _push(trackableAttributes.pilot, 'value', 'action_tracker.move');
}

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

export function initCustomFlowDispatch()
{
    document.body.addEventListener('click', (ev) =>
    {
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
        if (!actorId)
        {
            ui.notifications?.error(`No actor ID found on ${flowType} prompt button.`);
            return;
        }

        const actor = CONFIG.Actor.documentClass.fromUuidSync?.(actorId)
            ?? fromUuidSync(actorId);
        if (!actor)
        {
            ui.notifications?.error(`Invalid actor ID on ${flowType} prompt button.`);
            return;
        }

        if (typeof customFlow === 'function')
            new customFlow(actor.uuid).begin();
        else if (customFlow.steps)
        {
            const Flow = game.lancer?.flows?.get('StatRollFlow')?.__proto__;
            if (!Flow)
            {
                ui.notifications?.error(`Cannot resolve Flow base class for ${flowType}.`);
                return;
            }
            const GenericFlow = class extends Flow
            {
                constructor(uuid, data)
                {
                    super(uuid, data || {});
                }
            };
            GenericFlow.steps = customFlow.steps;

            let initialData = {};
            if (button.dataset.checkType)
                initialData.path = `system.${button.dataset.checkType}`;
            // Forward all data-* attributes
            for (const [key, value] of Object.entries(button.dataset))
            {
                if (key !== 'flowType' && key !== 'actorId' && key !== 'checkType')
                    initialData[key] = value;
            }

            new GenericFlow(actor.uuid, initialData).begin();
        }
        else
            ui.notifications?.error(`Invalid flow structure for ${flowType}.`);
    }, { capture: true });
}

/**
 * Call via API: game.modules.get('lancer-automations').api.repairLCPData()
 */
export async function repairLCPData()
{
    if (!game.user.isGM)
    {
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

    try
    {
        const entryText = await (await fetch('/systems/lancer/lancer.mjs')).text();
        // v3 moved getOfficialData out of lancer.mjs into lancer-actor-<hash>.mjs.
        const actorMatch = entryText.match(/from\s+["']\.\/(lancer-actor-[^"']+\.mjs)["']/);
        if (!actorMatch)
            throw new Error('Could not find lancer-actor bundle in lancer.mjs');
        const actorText = await (await fetch(`/systems/lancer/${actorMatch[1]}`)).text();
        // minifier renames the export each build; pull the current alias from the export block
        const aliasMatch = actorText.match(/getOfficialData as (\w+)/);
        if (!aliasMatch)
            throw new Error(`Could not locate getOfficialData export in ${actorMatch[1]}`);
        const bundle = await import(`/systems/lancer/${actorMatch[1]}`);
        const getOfficialData = bundle[aliasMatch[1]];
        if (typeof getOfficialData !== 'function')
            throw new Error(`Resolved getOfficialData alias "${aliasMatch[1]}" is not callable`);

        ui.notifications.info('Reading LCP source data...');
        const allData = await getOfficialData(null);

        const rawAmmoByLid = new Map();
        const rawWeaponByLid = new Map();
        const rawActionsByLid = new Map();
        const _actionBuckets = ['systems', 'weapons', 'frames', 'mods', 'pilot_gear', 'core_bonuses', 'talents', 'npc_features'];
        for (const data of allData)
        {
            for (const sys of data?.cp?.data?.systems ?? [])
            {
                if (sys.ammo?.length && sys.id)
                    rawAmmoByLid.set(sys.id, sys.ammo);
            }
            for (const weapon of data?.cp?.data?.weapons ?? [])
            {
                if (weapon.id)
                    rawWeaponByLid.set(weapon.id, weapon);
            }
            for (const bucket of _actionBuckets)
            {
                for (const entry of data?.cp?.data?.[bucket] ?? [])
                {
                    if (entry?.id && entry.actions?.length)
                        rawActionsByLid.set(entry.id, entry.actions);
                }
            }
        }

        let fixed = 0;

        // swallow locked-compendium toasts; one persistent warn summarises at the end
        const _origError = ui.notifications.error.bind(ui.notifications);
        const _lockedRe = /locked compendium/i;
        ui.notifications.error = (msg, opts) =>
        {
            const s = typeof msg === 'string' ? msg : String(msg ?? '');
            if (_lockedRe.test(s))
            {
                console.warn('lancer-automations | suppressed:', s);
                return null;
            }
            return _origError(msg, opts);
        };

        const lockedPacks = [];
        try
        {
            const lancerPacks = ['world.mech-items', 'world.pilot-items', 'world.npc-items'];
            for (const packId of lancerPacks)
            {
                let pack = game.packs.get(packId);
                if (!pack)
                    continue;
                const wasLocked = pack.locked;
                if (wasLocked)
                {
                    await pack.configure({ locked: false });
                    pack = game.packs.get(packId) ?? pack;
                }
                if (pack.locked)
                {
                    lockedPacks.push(packId);
                    continue;
                }
                let packFailed = false;
                for (const doc of await pack.getDocuments())
                {
                    if (packFailed)
                        break;
                    try
                    {
                        if (await _fixItem(doc, rawAmmoByLid, rawWeaponByLid, rawActionsByLid))
                            fixed++;
                    }
                    catch (e)
                    {
                        const msg = String(e?.message ?? e);
                        if (_lockedRe.test(msg))
                        {
                            packFailed = true;
                            lockedPacks.push(packId);
                            console.warn(`lancer-automations | ${packId} rejected updates, aborting pack`);
                        }
                        else
                            console.warn(`lancer-automations | _fixItem failed for ${doc.name} (${packId})`, e);
                    }
                }
                if (wasLocked)
                    await (game.packs.get(packId) ?? pack).configure({ locked: true });
            }
        }
        finally
        {
            ui.notifications.error = _origError;
        }
        if (lockedPacks.length)
        {
            ui.notifications.warn(
                `Could not write to ${lockedPacks.join(', ')}. Open the Compendium tab, right-click each pack, ` +
                `pick "Toggle Edit Lock", and re-run.`,
                { permanent: true }
            );
        }

        // Fix actor-owned items
        for (const actor of game.actors)
        {
            for (const item of actor.items)
            {
                if (await _fixItem(item, rawAmmoByLid, rawWeaponByLid))
                    fixed++;
            }
        }

        // Fix world items
        for (const item of game.items)
        {
            if (await _fixItem(item, rawAmmoByLid, rawWeaponByLid))
                fixed++;
        }

        ui.notifications.info(`Applied fixes to ${fixed} item(s).${fixed > 0 ? ' Reload recommended.' : ''}`, { permanent: fixed > 0 });
    }
    catch (e)
    {
        console.error('lancer-automations | repairLCPData failed:', e);
        ui.notifications.error(`Repair failed: ${e.message}. Check console.`);
    }
}

/** Case-insensitive checklist builder (mirrors the bundle fix). */
function _makeTypeChecklist(types, validKeys)
{
    const lowerTypes = types.map(type => type.toLowerCase());
    const override = types.length === 0;
    const result = {};
    for (const key of validKeys)
        result[key] = override || lowerTypes.includes(key.toLowerCase());
    return result;
}

const _WEAPON_TYPES = ['CQB', 'Cannon', 'Launcher', 'Melee', 'Nexus', 'Rifle'];
const _WEAPON_SIZES = ['Auxiliary', 'Main', 'Heavy', 'Superheavy'];

/** Fix a single item from raw LCP source. Returns true if changed. */
async function _fixItem(item, rawAmmoByLid, rawWeaponByLid, rawActionsByLid)
{
    const lid = item.system?.lid;
    if (!lid)
        return false;

    const updates = {};
    let changed = false;

    // Action name fixes
    const rawActions = rawActionsByLid?.get(lid);
    if (Array.isArray(item.system?.actions) && item.system.actions.length)
    {
        let actionsChanged = false;
        const fixedActions = item.system.actions.map((action, i) =>
        {
            const cur = (action?.name ?? '').trim();
            if (cur && cur.toLowerCase() !== 'action')
                return action;
            const raw = rawActions?.[i]?.name?.trim?.();
            const newName = (raw && raw.toLowerCase() !== 'action')
                ? raw
                : (item.system.actions.length > 1 ? `${item.name} ${i + 1}` : item.name);
            if (newName === cur)
                return action;
            actionsChanged = true;
            return { ...action, name: newName };
        });
        if (actionsChanged)
        {
            updates['system.actions'] = fixedActions;
            changed = true;
        }
    }

    // Ammo fixes
    const rawAmmo = rawAmmoByLid.get(lid);
    if (rawAmmo && item.system?.ammo?.length)
    {
        const fixedAmmo = item.system.ammo.map((ammoEntry, i) =>
        {
            const raw = rawAmmo[i];
            if (!raw)
                return ammoEntry;
            const fix = { ...ammoEntry };

            if (!fix.description && raw.detail)
            {
                fix.description = raw.detail;
                changed = true;
            }
            if (raw.allowed_types && Array.isArray(raw.allowed_types))
            {
                const correct = _makeTypeChecklist(raw.allowed_types, _WEAPON_TYPES);
                if (JSON.stringify(fix.allowed_types) !== JSON.stringify(correct))
                {
                    fix.allowed_types = correct;
                    changed = true;
                }
            }
            if (raw.allowed_sizes && Array.isArray(raw.allowed_sizes))
            {
                const correct = _makeTypeChecklist(raw.allowed_sizes, _WEAPON_SIZES);
                if (JSON.stringify(fix.allowed_sizes) !== JSON.stringify(correct))
                {
                    fix.allowed_sizes = correct;
                    changed = true;
                }
            }
            return fix;
        });
        if (changed)
            updates['system.ammo'] = fixedAmmo;
    }

    // Weapon profile text merging
    const rawWeapon = rawWeaponByLid.get(lid);
    if (rawWeapon && item.system?.profiles?.length && rawWeapon.profiles?.length > 1)
    {
        const wpnEffect = rawWeapon.effect || '';
        const wpnOnAttack = rawWeapon.on_attack || '';
        const wpnOnCrit = rawWeapon.on_crit || '';
        const wpnOnHit = rawWeapon.on_hit || '';

        if (wpnEffect || wpnOnAttack || wpnOnCrit || wpnOnHit)
        {
            const fixedProfiles = item.system.profiles.map((prof, i) =>
            {
                const rawProf = rawWeapon.profiles[i];
                if (!rawProf)
                    return prof;
                const fix = { ...prof };
                const name = rawProf.name ?? `${rawWeapon.name} :: ${i + 1}`;
                let profChanged = false;

                for (const field of ['effect', 'on_attack', 'on_crit', 'on_hit'])
                {
                    const wpnText = rawWeapon[field] || '';
                    const profText = rawProf[field] || '';
                    if (!wpnText)
                        continue;
                    if (!profText)
                    {
                        if (fix[field] !== wpnText)
                        {
                            fix[field] = wpnText; profChanged = true;
                        }
                    }
                    else if (wpnText !== profText)
                    {
                        const merged = wpnText + '<br><br>' + name + ':: ' + profText;
                        if (fix[field] !== merged)
                        {
                            fix[field] = merged; profChanged = true;
                        }
                    }
                }
                if (profChanged)
                    changed = true;
                return fix;
            });
            if (changed)
                updates['system.profiles'] = fixedProfiles;
        }
    }

    if (changed)
    {
        try
        {
            await item.update(updates);
        }
        catch (e)
        {
            console.warn(`lancer-automations | Could not fix ${item.name}:`, e);
            return false;
        }
    }
    return changed;
}

// Fix: initTechAttackData overwrites custom title with "TECH ATTACK"

export function wrapInitTechAttackData(flowSteps)
{
    const orig = flowSteps.get('initTechAttackData');
    if (!orig)
        return;
    flowSteps.set('initTechAttackData', async function(state, options)
    {
        const savedTitle = state.data?.title;
        const result = await orig(state, options);
        if (savedTitle && state.data?.title === "TECH ATTACK")
        {
            state.data.title = savedTitle;
            try
            {
                state.data.acc_diff.title = savedTitle;
            }
            catch
            { /* */ }
        }
        return result;
    });
}

/** Preserve caller title/action/effect through initAttackData so downstream hooks see the real action identity, not "BASIC ATTACK". */
export function wrapInitAttackData(flowSteps)
{
    const orig = flowSteps.get('initAttackData');
    if (!orig)
        return;
    flowSteps.set('initAttackData', async function(state, options)
    {
        const savedTitle = state.data?.title;
        const savedAction = state.data?.action;
        const savedEffect = state.data?.effect;
        const result = await orig(state, options);
        if (!state.data)
            return result;
        if (savedTitle && state.data.title === "BASIC ATTACK")
        {
            state.data.title = savedTitle;
            try
            {
                state.data.acc_diff.title = savedTitle;
            }
            catch
            { /* */ }
        }
        if (savedAction && !state.data.action)
            state.data.action = savedAction;
        if (savedEffect && !state.data.effect)
            state.data.effect = savedEffect;
        return result;
    });
}

/** Let non-Weapon npc features drive a damage flow; the system's setDamageTags only accepts weapon types. */
export function wrapSetDamageTags(flowSteps)
{
    const orig = flowSteps.get('setDamageTags');
    if (!orig)
        return;
    flowSteps.set('setDamageTags', async function (state, options)
    {
        const item = state.item;
        if (item?.is_npc_feature?.() && item.system.type !== 'Weapon')
        {
            state.data.tags = item.system.tags ?? [];
            state.data.ap = !!state.data.tags.find(tag => tag.is_ap);
            state.data.overkill = !!state.data.tags.find(tag => tag.is_overkill);
            const reliableTag = state.data.tags.find(tag => tag.is_reliable);
            if (reliableTag)
            {
                state.data.reliable = true;
                state.data.reliable_val = Number.parseInt(reliableTag.tierVal((state.actor?.is_npc?.() && state.actor.system.tier) || 1) || "0");
            }
            return true;
        }
        return orig(state, options);
    });
}

// the system flags every non-weapon item attack as tech+smart; forceNonTech in la_extraData opts out
async function forceNonTechAttack(state)
{
    if (!state.la_extraData?.forceNonTech)
        return true;
    const accDiff = state.data?.acc_diff;
    if (!accDiff)
        return true;
    const weapon = accDiff.weapon;
    if (weapon)
    {
        weapon.tech = false;
        weapon.smart = false;
    }
    // the HUD derives its tech look from lancerItem's type, not weapon.tech
    accDiff.lancerItem = undefined;
    if (!accDiff.lancerActor)
        accDiff.lancerActor = state.actor;
    return true;
}

export function registerNonTechAttackStep(flowSteps, flows)
{
    flowSteps.set('lancer-automations:forceNonTechAttack', forceNonTechAttack);
    flows.get('BasicAttackFlow')?.insertStepAfter('initAttackData', 'lancer-automations:forceNonTechAttack');
}

export const ItemDisabledAPI = {
    isItemDisabled,
    setItemDisabled,
    isDisableable,
};

function getDesiredWallHeight(actor)
{
    const size = Number(actor.system?.size ?? actor.prototypeToken?.width ?? 1) || 1;
    let vsEnabled = false;
    try
    {
        vsEnabled = !!game.settings.get('lancer-automations', 'autoTokenHeightVehicleSquad');
    }
    catch
    { /* ignore */ }
    if (vsEnabled)
    {
        const items = Array.from(actor.items ?? []);
        if (items.some(item => item.system?.lid === 'npcc_squad'))
            return 0.5;
        if (items.some(item => /vehicle/i.test(item.system?.lid ?? '')))
        {
            if (size <= 1)
                return 0.5;
            return Math.min(size - 1, 4) + 0.1;
        }
    }
    return size + 0.1;
}

const _HEIGHT_TARGET_TYPES = new Set(['mech', 'npc', 'pilot', 'deployable']);

// On placement: auto-set wall-height tokenHeight, unless the prototype carries a manual non-zero value.
Hooks.on('preCreateToken', (tokenDoc, _data, _options, userId) =>
{
    if (userId !== game.userId)
        return;
    if (!game.modules.get('wall-height')?.active)
        return;
    if (!game.settings.get('lancer-automations', 'autoTokenHeight'))
        return;
    const actor = tokenDoc.actor;
    if (!actor || !_HEIGHT_TARGET_TYPES.has(actor.type))
        return;
    if (Number(tokenDoc.flags?.['wall-height']?.tokenHeight ?? 0) !== 0)
        return;
    tokenDoc.updateSource({ flags: { 'wall-height': { tokenHeight: getDesiredWallHeight(actor) } } });
});

export async function syncAllTokenHeights()
{
    if (!game.user.isGM)
    {
        ui.notifications.error('Only the GM can sync token heights.');
        return;
    }
    if (!game.modules.get('wall-height')?.active)
        ui.notifications.warn('Wall Height is not active — values written but unused by the canvas.');
    const confirmed = await Dialog.confirm({
        title: 'Lancer Automations — Sync Token Heights',
        content: `<p>Set <b>wall-height.tokenHeight</b> on every world actor (prototype) and every placed token across all scenes.</p><p>Continue?</p>`,
        defaultYes: true
    });
    if (!confirmed)
        return;

    let protoUpdated = 0;
    let protoSkipped = 0;
    const protoUpdates = [];
    for (const actor of game.actors)
    {
        if (!_HEIGHT_TARGET_TYPES.has(actor.type))
        {
            protoSkipped++;
            continue;
        }
        const desired = getDesiredWallHeight(actor);
        if (actor.prototypeToken?.flags?.['wall-height']?.tokenHeight === desired)
        {
            protoSkipped++;
            continue;
        }
        protoUpdates.push({
            _id: actor.id,
            prototypeToken: { flags: { 'wall-height': { tokenHeight: desired } } }
        });
        protoUpdated++;
    }
    if (protoUpdates.length)
    {
        try
        {
            await Actor.updateDocuments(protoUpdates);
        }
        catch (e)
        {
            console.error('lancer-automations | syncAllTokenHeights (prototype) failed', e);
            ui.notifications.error('Prototype sync failed; see console.');
            return;
        }
    }

    let sceneUpdated = 0;
    let sceneSkipped = 0;
    for (const scene of game.scenes)
    {
        /** @type {any[]} */
        const tokenUpdates = [];
        for (const tokenDoc of scene.tokens)
        {
            const actor = /** @type {any} */ (tokenDoc).actor;
            if (!actor || !_HEIGHT_TARGET_TYPES.has(actor.type))
            {
                sceneSkipped++;
                continue;
            }
            const desired = getDesiredWallHeight(actor);
            if (/** @type {any} */ (tokenDoc).flags?.['wall-height']?.tokenHeight === desired)
            {
                sceneSkipped++;
                continue;
            }
            tokenUpdates.push({
                _id: tokenDoc.id,
                flags: { 'wall-height': { tokenHeight: desired } }
            });
            sceneUpdated++;
        }
        if (tokenUpdates.length)
        {
            try
            {
                await scene.updateEmbeddedDocuments('Token', tokenUpdates);
            }
            catch (e)
            {
                console.error(`lancer-automations | syncAllTokenHeights (scene "${scene.name}") failed`, e);
            }
        }
    }

    ui.notifications.info(`Prototypes: ${protoUpdated} updated, ${protoSkipped} skipped. Scene tokens: ${sceneUpdated} updated, ${sceneSkipped} skipped.`);
}

export async function syncAllActorImgs()
{
    if (!game.user.isGM)
    {
        ui.notifications.error('Only the GM can sync actor portraits.');
        return;
    }

    const confirmed = await Dialog.confirm({
        title: 'Lancer Automations — Sync Actors to Prototype Token',
        content: `<p>For every world actor, set <b>actor.img</b> and <b>actor.name</b> to the prototype token image and name.</p><p>Continue?</p>`,
        defaultYes: true
    });
    if (!confirmed)
        return;

    let imgUpdated = 0;
    let nameUpdated = 0;
    let skipped = 0;
    const updates = [];
    for (const actor of game.actors)
    {
        const tokenImg = actor.prototypeToken?.texture?.src;
        const tokenName = actor.prototypeToken?.name;
        /** @type {any} */
        const update = { _id: actor.id };
        if (tokenImg && actor.img !== tokenImg)
        {
            update.img = tokenImg;
            imgUpdated++;
        }
        if (tokenName && actor.name !== tokenName)
        {
            update.name = tokenName;
            nameUpdated++;
        }
        if (Object.keys(update).length > 1)
            updates.push(update);
        else
            skipped++;
    }
    if (updates.length)
    {
        try
        {
            await Actor.updateDocuments(updates);
        }
        catch (e)
        {
            console.error('lancer-automations | syncAllActorImgs failed', e);
            ui.notifications.error('Sync failed; see console.');
            return;
        }
    }
    ui.notifications.info(`Synced ${imgUpdated} portrait${imgUpdated === 1 ? '' : 's'} and ${nameUpdated} name${nameUpdated === 1 ? '' : 's'}, skipped ${skipped}.`);
}
