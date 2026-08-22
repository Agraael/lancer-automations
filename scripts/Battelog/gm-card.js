/* global Dialog, ui, game */

import { playTerminalIntro } from './intro-terminal.js';
import { openBattleLogRecap } from './recap.js';

const _escape = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Open the GM card for a battle. */
export function openBattleLogGMCard(battle)
{
    const players = battle?.players ?? [];
    const mission = battle?.mission ?? {};
    let awardsDisabled = false;
    try
    {
        awardsDisabled = !!game.settings.get('lancer-automations', 'tah.disableAwards');
    }
    catch
    { /* not ready */ }
    const state = {
        outcome: mission.outcome ?? 'VICTORY',
        mvpId: null,
        extraLines: [],
    };

    const outcomeCard = (val, label, icon, tone) => `
        <div class="lancer-scaling-card battelog-${tone} ${state.outcome === val ? 'selected' : ''}" data-outcome="${val}">
            <i class="fas ${icon} lancer-scaling-card-icon"></i>
            <div class="lancer-scaling-card-name">${label}</div>
        </div>`;

    const mvpCard = player => `
        <div class="lancer-list-item ${player.id === state.mvpId ? 'selected' : ''}" data-mvp="${player.id}">
            <div style="flex:1;font-weight:600;text-align:center;">
                <i class="fas fa-star battelog-mvp-star"></i>${_escape(player.callsign)}
                ${awardsDisabled ? '' : `<span style="font-weight:400;opacity:0.55;font-size:0.82em;margin-left:6px;">${player.awardPoints ?? 0} PTS</span>`}
            </div>
        </div>`;

    const content = `
        <div class="lancer-dialog-header">
            <div class="lancer-dialog-title">COMBAT CONCLUDED</div>
            <div class="lancer-dialog-subtitle">${_escape(mission.squadStatus ?? '')} · ${_escape(mission.rounds ?? 0)} rounds</div>
        </div>

        <div class="lancer-section-title">Record Outcome</div>
        <div class="lancer-scaling-cards battelog-outcome">
            ${outcomeCard('VICTORY', 'SUCCESS', 'fa-trophy', 'win')}
            ${outcomeCard('PARTIAL', 'PARTIAL', 'fa-scale-balanced', 'partial')}
            ${outcomeCard('DEFEAT', 'FAILURE', 'fa-skull', 'lose')}
        </div>

        <div class="lancer-section-title" style="margin-top:14px;">
            <i class="fas fa-star" style="color:#ffaa00;margin-right:5px;"></i> Award MVP
            <span style="font-weight:400;opacity:0.55;font-size:0.85em;margin-left:6px;">${awardsDisabled ? 'Awards disabled · manual MVP only' : 'manual pick, auto-selected if left blank'}</span>
        </div>
        <div class="lancer-list battelog-mvp">
            ${players.map(mvpCard).join('')}
        </div>

        <div class="lancer-section-title" style="margin-top:14px;">
            <i class="fas fa-clipboard-list" style="color:#7bd3ff;margin-right:5px;"></i> Custom Analysis
        </div>
        <div class="battelog-extra-list"></div>
        <button type="button" class="battelog-extra-add">
            <i class="fas fa-plus"></i> Add analysis line
        </button>

        <div class="battelog-actions">
            <button type="button" class="battelog-btn-secondary" data-action="dismiss">Dismiss</button>
            <button type="button" class="battelog-btn-primary" data-action="broadcast">
                <i class="fas fa-satellite-dish"></i> Broadcast Recap
            </button>
        </div>

        <p class="battelog-footer-note">Visible to all connected pilots.</p>
    `;

    const dlg = new Dialog({
        title: 'Battle Log · GM',
        content,
        buttons: {
            // Hidden via CSS; real buttons live in the card body. Dialog requires at least one entry.
            _hidden: { label: '',
                callback: () =>
                {} },
        },
        default: '_hidden',
        render: (html) =>
        {
            const $root = html instanceof $ ? html : $(html);

            const $list = $root.find('.battelog-extra-list');
            const renderExtraRows = () =>
            {
                $list.empty();
                state.extraLines.forEach((row, idx) =>
                {
                    const $rowEl = $(`
                        <div class="battelog-extra-row" data-idx="${idx}">
                            <input type="text" class="battelog-extra-label" placeholder="test" value="${_escape(row.label)}" />
                            <span class="battelog-extra-sep">:</span>
                            <input type="text" class="battelog-extra-result" placeholder="result" value="${_escape(row.result)}" />
                            <button type="button" class="battelog-extra-remove" title="Remove"><i class="fas fa-times"></i></button>
                        </div>
                    `);
                    $list.append($rowEl);
                });
                // Foundry Dialogs pin height at render; nudge the popup to reflow.
                dlg.setPosition({ height: 'auto' });
            };
            renderExtraRows();

            $root.on('click', '.battelog-extra-add', () =>
            {
                state.extraLines.push({ label: '', result: '' });
                renderExtraRows();
            });
            $root.on('click', '.battelog-extra-remove', function ()
            {
                const idx = Number($(this).closest('.battelog-extra-row').data('idx'));
                state.extraLines.splice(idx, 1);
                renderExtraRows();
            });
            // `input` (not re-render) so the field keeps focus on every keystroke.
            $root.on('input', '.battelog-extra-label', function ()
            {
                const idx = Number($(this).closest('.battelog-extra-row').data('idx'));
                if (state.extraLines[idx])
                    state.extraLines[idx].label = String($(this).val() ?? '');
            });
            $root.on('input', '.battelog-extra-result', function ()
            {
                const idx = Number($(this).closest('.battelog-extra-row').data('idx'));
                if (state.extraLines[idx])
                    state.extraLines[idx].result = String($(this).val() ?? '');
            });

            $root.on('click', '[data-outcome]', function ()
            {
                state.outcome = String($(this).data('outcome'));
                $root.find('[data-outcome]').removeClass('selected');
                $(this).addClass('selected');
            });
            $root.on('click', '[data-mvp]', function ()
            {
                const clicked = String($(this).data('mvp'));
                if (state.mvpId === clicked)
                {
                    state.mvpId = null;
                    $(this).removeClass('selected');
                }
                else
                {
                    state.mvpId = clicked;
                    $root.find('[data-mvp]').removeClass('selected');
                    $(this).addClass('selected');
                }
            });
            $root.on('click', '[data-action="dismiss"]', () => dlg.close());
            $root.on('click', '[data-action="broadcast"]', async () =>
            {
                const mvp = players.find(player => player.id === state.mvpId);
                const extraLines = state.extraLines
                    .map(line => ({ label: line.label.trim(), result: line.result.trim() }))
                    .filter(line => line.label || line.result);
                console.log('lancer-automations | Battle Log broadcast', { outcome: state.outcome, mvp, extraLines, battle });
                dlg.close();
                // Foundry sockets don't echo to sender; GM plays locally after emitting.
                const finalMvpId = state.mvpId ?? battle.mvpId ?? null;
                game.socket.emit('module.lancer-automations', {
                    action: 'battleLogPlayIntro',
                    payload: { outcome: state.outcome, battle, mvpId: finalMvpId, extraLines },
                });
                await playTerminalIntro({ outcome: state.outcome, battle, mvpId: finalMvpId, extraLines });
                openBattleLogRecap(battle, { outcome: state.outcome, mvpId: finalMvpId });
            });
        },
    }, {
        classes: ['lancer-dialog-base', 'lancer-no-title', 'battelog-dialog'],
        width: 560,
    });
    dlg.render(true);
    return dlg;
}
