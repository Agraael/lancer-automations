import { ANY_TURN_ORIGIN } from "./duration-builders.js";
import { getLAFlag, setLAFlag } from "../tools/flag-utils.js";
import { openItemBrowserDialog, attachEditorResizeObserver } from "../tools/misc-tools.js";
import { installLancerHints } from "../setup/codemirror-hints.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { cancelButton } from "../tools/dialog-utils.js";

export function updateCodeFieldBadge(html, fieldId)
{
    const value = String(html.find(`#${fieldId}-value`).val() || '').trim();
    const $badge = html.find(`#${fieldId}-badge`);
    if (!$badge.length)
        return;
    if (value)
    {
        $badge.addClass('has-value');
        $badge.find('.code-field-state').text('Set');
        const preview = value.replace(/\s+/g, ' ').trim().slice(0, 300);
        $badge.attr('title', preview);
    }
    else
    {
        $badge.removeClass('has-value');
        $badge.find('.code-field-state').text('Empty');
        $badge.attr('title', 'Click to set');
    }
}

// Token-related field IDs that should NOT be saved/restored in a preset.
const PRESET_SKIP_IDS = {
    std: ['std-target', 'std-origin', 'std-trigger-origin'],
    cust: ['cust-target', 'cust-saved', 'cust-origin', 'cust-trigger-origin'],
    bonus: ['bonus-target', 'bonus-durOrigin', 'bonus-trigger-origin', 'bonus-applyTo']
};

export function presetCategoryFor(prefix)
{
    return prefix === 'std' ? 'standard' : prefix === 'cust' ? 'custom' : 'bonus';
}

export function getStoredPresets()
{
    const raw = getLAFlag(game.user,'effectManagerPresets') || {};
    return { standard: raw.standard || [], custom: raw.custom || [], bonus: raw.bonus || [] };
}

export async function setStoredPresets(presets)
{
    await setLAFlag(game.user,'effectManagerPresets', presets);
}

export function gatherPresetData(html, prefix)
{
    const $tab = html.find(`#tab-${presetCategoryFor(prefix)}`);
    const skip = new Set(PRESET_SKIP_IDS[prefix] || []);
    const presetFields = {};
    $tab.find('input, select, textarea').each(function ()
    {
        const id = this.id;
        if (!id || (skip.has(id) && $(this).val() !== ANY_TURN_ORIGIN))
            return;
        const $el = $(this);
        const type = ($el.attr('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio')
            presetFields[id] = $el.is(':checked');
        else
            presetFields[id] = $el.val();
    });
    // Multi-select checkboxes (la-multi-select-panel): they may have been moved to body.
    $tab.find('.la-multi-select-panel').each(function ()
    {
        const panelId = this.id;
        if (!panelId)
            return;
        const checked = Array.from(document.querySelectorAll(`#${panelId} input[type=checkbox]:checked`), box => /** @type {HTMLInputElement} */ (box).value);
        presetFields[`__panel__${panelId}`] = checked;
    });
    if (prefix === 'bonus')
    {
        const dmg = [];
        $tab.find('#bonus-damage-list .bonus-damage-entry').each(function ()
        {
            const $entry = $(this);
            const idx = $entry.data('index');
            dmg.push({
                val: $entry.find(`#bonus-dmgVal-${idx}`).val(),
                type: $entry.find(`#bonus-dmgType-${idx}`).val(),
                from: $entry.find(`#bonus-dmgFrom-${idx}`).val(),
            });
        });
        presetFields.__damageEntries = dmg;
        presetFields.__immunityEffects = $tab.find('.bonus-immunity-effect-option.selected').map((_, el) => $(el).data('effect')).get();
        presetFields.__immunityDamage = $tab.find('.bonus-immunity-damage-option.selected').map((_, el) => $(el).data('type')).get();
    }
    return presetFields;
}

export function applyPresetData(html, prefix, data)
{
    if (prefix === 'bonus' && data['bonus-type'] === 'immunity' && ['resistance', 'vulnerability'].includes(data['bonus-immunity-subtype']))
        data = { ...data, 'bonus-type': data['bonus-immunity-subtype'], 'bonus-immunity-subtype': 'effect' };
    const $tab = html.find(`#tab-${presetCategoryFor(prefix)}`);
    const skip = new Set(PRESET_SKIP_IDS[prefix] || []);
    for (const [id, value] of Object.entries(data))
    {
        if (id.startsWith('__'))
            continue;
        if (skip.has(id) && value !== ANY_TURN_ORIGIN)
            continue;
        const $el = $tab.find(`#${id}`);
        if (!$el.length)
            continue;
        const type = ($el.attr('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio')
            $el.prop('checked', !!value);
        else
            $el.val(value);
        if (id.endsWith('-duration'))
            $el.trigger('change');
    }
    // Restore multi-select panel checkboxes (find by panel id, even if moved to body).
    for (const [key, val] of Object.entries(data))
    {
        if (!key.startsWith('__panel__'))
            continue;
        const panelId = key.slice('__panel__'.length);
        document.querySelectorAll(`#${panelId} input[type=checkbox]`).forEach(box =>
        {
            /** @type {HTMLInputElement} */ (box).checked = val.includes(/** @type {HTMLInputElement} */ (box).value);
        });
        // Trigger change so any dependent UI updates.
        $(document.querySelector(`#${panelId} input[type=checkbox]`)).trigger('change');
    }
    if (prefix === 'bonus' && Array.isArray(data.__damageEntries))
    {
        const $list = $tab.find('#bonus-damage-list');
        $list.empty();
        data.__damageEntries.forEach((entry, idx) =>
        {
            $list.append(`
                <div class="bonus-damage-entry form-group" data-index="${idx}">
                    <select id="bonus-dmgFrom-${idx}" class="bonus-damage-from" style="flex:1; display:none;"></select>
                    <span class="bonus-damage-arrow" style="display:none; padding:0 4px;">→</span>
                    <input type="text" id="bonus-dmgVal-${idx}" value="${entry.val ?? '1d6'}" placeholder="1d6" class="bonus-damage-val" style="flex:1;">
                    <select id="bonus-dmgType-${idx}" style="flex:1;"></select>
                    <button type="button" class="bonus-remove-dmg te-delete-btn" data-index="${idx}" style="flex:0 0 22px;"><i class="fas fa-times"></i></button>
                </div>
            `);
            // copy dmg type options from first entry (dmgTypeOptionsHtml not directly accessible here)
            const $firstTypeSelect = $tab.find('select[id^="bonus-dmgType-"]').first();
            const optionsHtml = $firstTypeSelect.html();
            if (optionsHtml)
            {
                $tab.find(`#bonus-dmgType-${idx}`).html(optionsHtml).val(entry.type);
                $tab.find(`#bonus-dmgFrom-${idx}`).html(`<option value="all">All Types</option>${optionsHtml}`).val(entry.from ?? 'all');
            }
        });
    }
    // Immunity selections.
    if (prefix === 'bonus' && Array.isArray(data.__immunityEffects))
    {
        $tab.find('.bonus-immunity-effect-option').each(function ()
        {
            $(this).toggleClass('selected', data.__immunityEffects.includes($(this).data('effect')));
        });
    }
    if (prefix === 'bonus' && Array.isArray(data.__immunityDamage))
    {
        $tab.find('.bonus-immunity-damage-option').each(function ()
        {
            $(this).toggleClass('selected', data.__immunityDamage.includes($(this).data('type')));
        });
    }
    // Bonus-type-specific section visibility.
    $tab.find('#bonus-type').trigger('change');
    // Refresh damage bonus row markup for current mode after entries were rebuilt.
    $tab.find('#bonus-damageMode').trigger('change');
    // Sync icon previews if present.
    const $icon = $tab.find('#cust-icon, #bonus-icon');
    if ($icon.length)
    {
        $icon.each(function ()
        {
            const path = String($(this).val() || '');
            const $img = $tab.find(`#${this.id}-preview`);
            if ($img.length)
            {
                $img.attr('src', path);
                $img[0].style.opacity = '1';
            }
        });
    }
    // Code-field badges.
    $tab.find('.code-field-badge').each(function ()
    {
        updateCodeFieldBadge(html, $(this).data('target'));
    });
    $tab.find('.la-multi-select').each(function ()
    {
        const trigger = $(this).find('.la-multi-select-trigger');
        const panelId = $(this).find('.la-multi-select-panel').attr('id');
        if (!panelId)
            return;
        const checked = $(document.querySelectorAll(`#${panelId} input:checked`));
        if (checked.length === 0)
            trigger.text('— Select —');
        else
            trigger.text(checked.map((_, el) => $(el).closest('label').text().trim()).get().join(', '));
    });
}

/**
 * Opens a CodeMirror editor dialog bound to a hidden input + preview pair.
 * Mirrors reaction-manager's expanded editor (Alt-Enter completion via installLancerHints).
 */
export function openCodeFieldDialog(html, fieldId, title, defaultCode = '')
{
    const $value = html.find(`#${fieldId}-value`);
    const stored = String($value.val() || '');
    const initial = stored || defaultCode;
    let editor;
    let resizeObserver;

    new Dialog({
        title: localizeFormat('LA.effectManager.editTitle', { title }),
        content: `<div class="lcm-host"></div>
            <style>
                .lcm-dialog .window-content { padding:0 !important; overflow:hidden !important; background:#272822; }
                .lcm-dialog .dialog-buttons { height:40px !important; min-height:40px !important; max-height:40px !important; background:#333 !important; border-top:1px solid #111 !important; padding:0 !important; margin:0 !important; display:flex !important; }
                .lcm-dialog button.dialog-button { background:#444 !important; color:#fff !important; border:none !important; border-right:1px solid #222 !important; width:100% !important; height:100% !important; margin:0 !important; display:flex !important; align-items:center !important; justify-content:center !important; font-size:1em !important; border-radius:0 !important; box-shadow:none !important; }
                .lcm-dialog button.dialog-button:last-child { border-right:none !important; }
                .lcm-dialog button.dialog-button:hover { background:#555 !important; }
            </style>`,
        buttons: {
            save: {
                label: localize("LA.common.save"),
                icon: '<i class="fas fa-save" style="margin-right:8px;"></i>',
                callback: () =>
                {
                    const code = editor.getValue();
                    $value.val(code);
                    updateCodeFieldBadge(html, fieldId);
                }
            },
            cancel: {
                label: localize("LA.common.cancel"),
                icon: '<i class="fas fa-times" style="margin-right:8px;"></i>'
            }
        },
        default: "save",
        render: (dlgHtml) =>
        {
            const host = dlgHtml.find('.lcm-host')[0];
            editor = CodeMirror(host, {
                value: initial,
                mode: 'javascript',
                theme: 'monokai',
                lineNumbers: true,
                matchBrackets: true,
                styleActiveLine: true,
                indentUnit: 4,
                smartIndent: true,
                lineWrapping: false,
                scrollbarStyle: "native"
            });
            installLancerHints(editor, 'evaluate');
            const windowEl = dlgHtml.closest('.window-app')[0];
            resizeObserver = attachEditorResizeObserver(editor, windowEl);
        },
        close: () =>
        {
            resizeObserver?.disconnect();
        }
    }, {
        width: 700,
        height: 500,
        resizable: true,
        classes: ["dialog", "lcm-dialog", "lancer-dialog-base", "lancer-no-title"]
    }).render(true);
}

/**
 * Open item browser and populate targetInput with the selected LID.
 * @param {JQuery} targetInput
 * @returns {Promise<string|null>}
 */
export async function openItemBrowser(targetInput)
{
    const result = await openItemBrowserDialog();
    if (result && targetInput)
        targetInput.val(result.lid);
    return result?.lid ?? null;
}

/**
 * Open a status picker dialog and populate targetInput with the selected status ID.
 * Shows all CONFIG.statusEffects plus custom statuses from temporary-custom-statuses if present.
 * @param {JQuery} targetInput
 */
export function openStatusPicker(targetInput)
{
    const statuses = [...(CONFIG.statusEffects || [])];

    const customApi = game.modules.get('temporary-custom-statuses')?.api;
    if (customApi && typeof customApi.getStatuses === 'function')
    {
        const customStatuses = customApi.getStatuses() || [];
        for (const customStatus of customStatuses)
        {
            if (!statuses.some(existing => existing.id === customStatus.id))
                statuses.push(customStatus);
        }
    }

    const currentVal = targetInput ? /** @type {string} */ (targetInput.val()) || '' : '';
    const alreadySelected = new Set(currentVal.split(',').map(id => id.trim()).filter(Boolean));

    const gridHtml = statuses.map(status =>
    {
        const icon = status.img || status.icon || '';
        const id = status.id || status.name || '';
        let label = status.name || id;
        if (typeof status.name === 'string' && status.name.startsWith('lancer'))
            label = localize(status.name);
        const isSelected = alreadySelected.has(id);
        return `<div class="lancer-status-entry${isSelected ? ' selected' : ''}" data-id="${id}" title="${label}"
            style="display:inline-flex;flex-direction:column;align-items:center;width:56px;margin:3px;cursor:pointer;padding:4px;border-radius:4px;border:2px solid ${isSelected ? 'var(--primary-color)' : 'transparent'};">
            <div style="width:40px;height:40px;background:#1a1a1a;border-radius:4px;display:flex;align-items:center;justify-content:center;">
                <img src="${icon}" width="32" height="32" style="object-fit:contain;">
            </div>
            <span style="font-size:0.6em;text-align:center;word-break:break-all;margin-top:2px;max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>
        </div>`;
    }).join('');

    const dialog = new Dialog({
        title: localize('LA.dialogTitle.pickStatus'),
        content: `
            <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                <h1 class="lancer-dialog-title">PICK STATUS</h1>
                <p class="lancer-dialog-subtitle">Click to toggle. Multiple can be selected.</p>
            </div>
            <div style="max-height:300px;overflow-y:auto;padding:4px;">
                <div style="display:flex;flex-wrap:wrap;">${gridHtml}</div>
            </div>
        `,
        buttons: {
            confirm: {
                label: `<i class="fas fa-check"></i> ${localize('LA.common.confirm')}`,
                callback: (html) =>
                {
                    const selected = html.find('.lancer-status-entry.selected').map(function ()
                    {
                        return $(this).data('id');
                    }).get();
                    if (targetInput)
                        targetInput.val(selected.join(', '));
                }
            },
            cancel: cancelButton()
        },
        render: (html) =>
        {
            html.find('.lancer-status-entry').on('click', function ()
            {
                $(this).toggleClass('selected');
                $(this).css('border-color', $(this).hasClass('selected') ? 'var(--primary-color)' : 'transparent');
            });
        },
        default: "confirm"
    }, { width: 420, classes: ["lancer-dialog-base", "lancer-no-title"] });
    dialog.render(true);
}

/**
 * Hoisted la-multi-select initializer (button-trigger + checkbox panel).
 * @param {JQuery} html
 * @param {string} containerId
 */
export function initLaMultiSelect(html, containerId)
{
    const container = html.find(`#${containerId}`);
    const trigger = container.find('.la-multi-select-trigger');
    const panel = container.find('.la-multi-select-panel');
    const updateTriggerLabel = () =>
    {
        const checked = panel.find('input:checked');
        if (checked.length === 0)
            trigger.text('— Select —');
        else
            trigger.text(checked.map((_, el) => $(el).closest('label').text().trim()).get().join(', '));
    };
    const panelHome = panel.parent();
    const positionPanel = () =>
    {
        const rect = trigger[0].getBoundingClientRect();
        const panelStyle = panel[0].style;
        panelStyle.setProperty('position', 'fixed', 'important');
        panelStyle.setProperty('top', `${rect.bottom + 2}px`, 'important');
        panelStyle.setProperty('left', `${rect.left}px`, 'important');
        panelStyle.setProperty('right', 'auto', 'important');
        panelStyle.setProperty('bottom', 'auto', 'important');
        panelStyle.setProperty('width', `${rect.width}px`, 'important');
        panelStyle.setProperty('min-width', '0', 'important');
        panelStyle.setProperty('max-width', `${rect.width}px`, 'important');
    };
    const closePanel = () =>
    {
        panel.removeClass('open');
        panel[0].style.cssText = '';
        if (panel.parent().is('body'))
            panelHome.append(panel);
    };
    trigger.on('click', (ev) =>
    {
        ev.stopPropagation();
        const wasOpen = panel.hasClass('open');
        document.querySelectorAll('.la-multi-select-panel.open').forEach(openPanel => openPanel.classList.remove('open'));
        if (!wasOpen)
        {
            panel.appendTo(document.body);
            positionPanel();
            panel.addClass('open');
        }
        else
            closePanel();
    });
    panel.on('click', (ev) => ev.stopPropagation());
    panel.find('input[type=checkbox]').on('change', updateTriggerLabel);
    $(document).on('click.la-multiselect', closePanel);
    updateTriggerLabel();
}

const CONSUMPTION_FILTER_MAP = {
    onAttack: ['cfilter-itemLid', 'cfilter-itemId', 'cfilter-role'],
    onHit: ['cfilter-itemLid', 'cfilter-itemId', 'cfilter-role'],
    onMiss: ['cfilter-itemLid', 'cfilter-itemId', 'cfilter-role'],
    onPreDamage: ['cfilter-itemLid', 'cfilter-itemId', 'cfilter-role'],
    onDamage: ['cfilter-itemLid', 'cfilter-itemId', 'cfilter-role'],
    onTechAttack: ['cfilter-itemLid', 'cfilter-itemId', 'cfilter-role'],
    onTechHit: ['cfilter-itemLid', 'cfilter-itemId', 'cfilter-role'],
    onMove: [],
    onPreMove: [],
    onInitActivation: ['cfilter-actionName'],
    onActivation: ['cfilter-actionName'],
    onInitEndActivation: ['cfilter-actionName'],
    onEndActivation: ['cfilter-actionName'],
    onPostActivation: ['cfilter-actionName'],
    onPostEndActivation: ['cfilter-actionName'],
    onDeploy: ['cfilter-itemLid', 'cfilter-itemId'],
    onCheck: ['cfilter-check', 'cfilter-role'],
    onPreStatusApplied: ['cfilter-statusId'],
    onPreStatusRemoved: ['cfilter-statusId'],
    onStatusApplied: ['cfilter-statusId'],
    onStatusRemoved: ['cfilter-statusId']
};

/**
 * Setup trigger field toggle + item browser buttons for a given prefix
 */
export function setupTriggerUI(html, prefix)
{
    initLaMultiSelect(html, `${prefix}-trigger`);

    const updateTriggerFilterFields = () =>
    {
        const triggers = Array.from(document.querySelectorAll(`#${prefix}-trigger-panel input:checked`), box => /** @type {HTMLInputElement} */ (box).value);
        const $fields = html.find(`#${prefix}-trigger-fields`);
        $fields.find('.form-group[class*="cfilter-"]').hide();
        if (triggers.length > 0)
        {
            $fields.show();
            const classes = new Set(triggers.flatMap(trigger => CONSUMPTION_FILTER_MAP[trigger] ?? []));
            classes.forEach(cls => $fields.find(`.${cls}`).show());
        }
        else
            $fields.hide();
        html.closest('.dialog').css('height', 'auto');
    };
    $(document).on('change.la-em-trigger', `#${prefix}-trigger-panel input[type=checkbox]`, updateTriggerFilterFields);

    html.find(`#${prefix}-trigger-fields .find-lid-btn`).on('click', function (e)
    {
        e.preventDefault();
        const targetId = $(this).data('target');
        openItemBrowser(html.find(`#${targetId}`));
    });

    html.find(`#${prefix}-trigger-fields .item-picker-btn`).on('click', async function (e)
    {
        e.preventDefault();
        const targetId = $(this).data('target');
        const tokenSourceId = $(this).data('token-source');

        let targetToken = null;
        if (tokenSourceId)
        {
            const tokenId = html.find(`#${tokenSourceId}`).val();
            targetToken = canvas.tokens.get(tokenId);
        }
        if (!targetToken)
            targetToken = canvas.tokens.controlled[0];

        if (!targetToken?.actor)
        {
            ui.notifications.warn(localize('LA.notify.pleaseSelectATargetTokenFirst'));
            return;
        }

        const items = targetToken.actor.items.filter(item => !['skill', 'talent', 'core_bonus', 'integrated'].includes(item.type));
        if (items.length === 0)
        {
            ui.notifications.warn(localizeFormat('LA.notify.noValidItems', { name: targetToken.name }));
            return;
        }

        items.sort((a, b) =>
        {
            if (a.type !== b.type)
                return a.type.localeCompare(b.type);
            return a.name.localeCompare(b.name);
        });

        const buildItemHtml = (item) =>
        {
            const icon = item.img || "systems/lancer/assets/icons/white/generic_item.svg";
            const displayType = item.system?.type ? `${item.type.toUpperCase()} - ${item.system.type.toUpperCase()}` : item.type.toUpperCase();
            return `<div class="lancer-item-card actor-item-entry" data-id="${item.id}" style="margin-bottom:6px;padding:10px;cursor:pointer;display:flex;gap:10px;">
                <div style="width:32px;height:32px;background:url('${icon}') no-repeat center/contain;flex-shrink:0;"></div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:bold;">${item.name}</div>
                    <div style="font-size:0.85em;opacity:0.8;">[${displayType}]</div>
                </div>
            </div>`;
        };

        const pickerDialog = new Dialog({
            title: localizeFormat('LA.effectManager.selectItemOn', { name: targetToken.name }),
            content: `
                <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                    <h1 class="lancer-dialog-title">Select Item on ${targetToken.name.toUpperCase()}</h1>
                    <p class="lancer-dialog-subtitle">Choose which item to filter consumption by.</p>
                </div>
                <div style="height:350px;overflow-y:auto;padding:4px;border:1px solid var(--la-edge);background:var(--la-plate);border-radius:4px;">
                    ${items.map(buildItemHtml).join('')}
                </div>
            `,
            buttons: {
                cancel: cancelButton()
            },
            render: (htmlContent) =>
            {
                htmlContent.find('.actor-item-entry').on('click', (ev) =>
                {
                    const id = $(ev.currentTarget).data('id');
                    html.find(`#${targetId}`).val(id).change();
                    pickerDialog.close();
                });
            },
            default: "cancel"
        }, { width: 500, classes: ["lancer-dialog-base", "lancer-no-title"] });
        pickerDialog.render(true);
    });

    html.find(`#${prefix}-trigger-fields .status-picker-btn`).on('click', function (e)
    {
        e.preventDefault();
        const targetId = $(this).data('target');
        openStatusPicker(html.find(`#${targetId}`));
    });
}

/** Collect trigger/consumption config from form fields. */
export function getTriggerConfig(html, prefix)
{
    const triggers = html.find(`#${prefix}-trigger input:checked`)
        .map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
    if (triggers.length === 0)
        return null;

    const consumption = {
        trigger: triggers.length === 1 ? triggers[0] : triggers
    };
    const origin = html.find(`#${prefix}-trigger-origin`).val();
    if (origin)
        consumption.originId = origin;

    const itemLid = html.find(`#${prefix}-filter-itemLid`).val()?.trim();
    if (itemLid)
        consumption.itemLid = itemLid;
    const itemId = html.find(`#${prefix}-filter-itemId`).val()?.trim();
    if (itemId)
        consumption.itemId = itemId;
    const actionName = html.find(`#${prefix}-filter-actionName`).val()?.trim();
    if (actionName)
        consumption.actionName = actionName;
    const checkType = html.find(`#${prefix}-filter-checkType`).val()?.trim();
    if (checkType)
        consumption.checkType = checkType;
    const statusId = html.find(`#${prefix}-filter-statusId`).val()?.trim();
    if (statusId)
        consumption.statusId = statusId;
    consumption.role = String(html.find(`#${prefix}-filter-role`).val() || '') || 'source';
    const evaluateSrc = String(html.find(`#${prefix}-evaluate-value`).val() || '').trim();
    if (evaluateSrc)
        consumption.evaluate = evaluateSrc;
    return consumption;
}
