import { HudPanel } from './hud-panel.js';
import { escapeHtml } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';

export class BondPanel extends HudPanel
{
    open(anchorRow)
    {
        this._resetPanel(anchorRow);
        const actor = /** @type {any} */ (this._actor);
        const bond = actor?.system?.bond ?? actor?.items?.find((/** @type {any} */ item) => item.type === 'bond') ?? null;
        if (!actor || !bond)
            return;

        const state = actor.system.bond_state ?? {};
        const swallow = (/** @type {any} */ jq) => jq.on('mousedown click focus', (/** @type {any} */ ev) => ev.stopPropagation());

        const panel = $(htmlToElement(`<div class="la-hud-panel la-hud-bond-panel"></div>`));
        panel.append(htmlToElement(`<div class="la-hud-col-label">Bond · ${escapeHtml(bond.name)}</div>`));

        const body = $(htmlToElement(`<div class="la-hud-bond-body"></div>`));

        // Questions
        body.append(htmlToElement(`<div class="la-hud-panel-section-header">QUESTIONS</div>`));
        (bond.system?.questions ?? []).forEach((/** @type {any} */ entry, /** @type {number} */ questionIdx) =>
        {
            const wrap = $(htmlToElement(`<div class="la-bond-field"></div>`));
            const questionLabel = document.createElement('div');
            questionLabel.className = 'la-bond-field__label';
            questionLabel.textContent = entry.question ?? '';
            wrap.append(questionLabel);
            const select = $(htmlToElement(`<select class="la-bond-select"></select>`));
            const current = state.answers?.[questionIdx] ?? '';
            for (const option of (entry.options ?? []))
                select.append(new Option(option, option, option === current, option === current));
            swallow(select);
            select.on('change', async () =>
            {
                await actor.update({ [`system.bond_state.answers.${questionIdx}`]: String(select.val()) });
            });
            wrap.append(select);
            body.append(wrap);
        });

        // XP checklist
        body.append(htmlToElement(`<div class="la-hud-panel-section-header">XP CHECKLIST</div>`));
        const checkRow = (/** @type {string} */ label, /** @type {boolean} */ checked, /** @type {(on: boolean) => Promise<any>} */ write) =>
        {
            const row = $(htmlToElement(`<label class="la-bond-check"></label>`));
            const box = $(htmlToElement(`<input type="checkbox"${checked ? ' checked' : ''}>`));
            swallow(box);
            box.on('change', async () => write(box.is(':checked')));
            const labelText = document.createElement('span');
            labelText.textContent = label;
            row.append(box, labelText);
            row.on('mouseenter', () => this._cancelCollapse());
            return row;
        };
        (bond.system?.major_ideals ?? []).forEach((/** @type {string} */ ideal, /** @type {number} */ idealIdx) =>
        {
            body.append(checkRow(ideal, state.xp_checklist?.major_ideals?.[idealIdx] === true,
                async (on) => actor.update({ [`system.bond_state.xp_checklist.major_ideals.${idealIdx}`]: on })));
        });

        // Minor ideal: the checkbox scores it, the select records which one it was
        const minorWrap = $(htmlToElement(`<div class="la-bond-minor"></div>`));
        const minorBox = $(htmlToElement(`<input type="checkbox"${state.xp_checklist?.minor_ideal === true ? ' checked' : ''}>`));
        swallow(minorBox);
        minorBox.on('change', async () => actor.update({ 'system.bond_state.xp_checklist.minor_ideal': minorBox.is(':checked') }));
        const minorSelect = $(htmlToElement(`<select class="la-bond-select"></select>`));
        const minorCurrent = state.minor_ideal ?? '';
        for (const ideal of (bond.system?.minor_ideals ?? []))
            minorSelect.append(new Option(ideal, ideal, ideal === minorCurrent, ideal === minorCurrent));
        swallow(minorSelect);
        minorSelect.on('change', async () => actor.update({ 'system.bond_state.minor_ideal': String(minorSelect.val()) }));
        minorWrap.append(minorBox, minorSelect);
        minorWrap.on('mouseenter', () => this._cancelCollapse());
        body.append(minorWrap);

        body.append(checkRow('Boon XP from another PC.', state.xp_checklist?.veteran_power === true,
            async (on) => actor.update({ 'system.bond_state.xp_checklist.veteran_power': on })));

        // Actions
        const buttons = $(htmlToElement(`<div class="la-bond-buttons"></div>`));
        const tallyBtn = $(htmlToElement(`<button type="button" class="la-bond-btn"><i class="mdi mdi-arrow-up-bold-hexagon-outline"></i> Tally XP</button>`));
        swallow(tallyBtn);
        tallyBtn.on('click', async () =>
        {
            await actor.tallyBondXP?.();
            this.refresh();
        });
        const refreshBtn = $(htmlToElement(`<button type="button" class="la-bond-btn"><i class="mdi mdi-refresh"></i> Refresh Powers</button>`));
        swallow(refreshBtn);
        refreshBtn.on('click', async () =>
        {
            await bond.refreshPowers?.();
        });
        buttons.append(tallyBtn, refreshBtn);
        body.append(buttons);

        panel.append(body);

        this._mount(panel, anchorRow, { clampSize: true });
    }
}
