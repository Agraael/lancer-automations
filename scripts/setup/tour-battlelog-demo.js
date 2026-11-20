import { mockCombatTelemetry } from '../Battelog/combat-telemetry-mock.js';
import { deriveDisplayBattle } from '../Battelog/combat-telemetry-derive.js';
import { openBattleLogGMCard } from '../Battelog/gm-card.js';
import { openBattleLogRecap } from '../Battelog/recap.js';
import { wait } from './tour-samples.js';

const RENDER_WAIT_MS = 2500;
const POLL_MS = 50;
const TAB_SETTLE_MS = 350;
const LAYOUT_WAIT_MS = 1500;
const LAYOUT_POLL_MS = 100;

let battle = null;
let shown = null;
let generation = 0;

function sampleBattle()
{
    battle ??= deriveDisplayBattle(mockCombatTelemetry());
    return battle;
}

async function rendered(dialog)
{
    for (let waited = 0; waited < RENDER_WAIT_MS && !dialog.rendered; waited += POLL_MS)
        await wait(POLL_MS);
    return dialog.rendered;
}

async function settled(dialog)
{
    let last = null;

    for (let waited = 0; waited < LAYOUT_WAIT_MS; waited += LAYOUT_POLL_MS)
    {
        const box = dialog.element?.[0]?.getBoundingClientRect();
        if (!box)
            return;

        const key = `${box.left}|${box.top}|${box.width}|${box.height}`;
        if (key === last)
            return;

        last = key;
        await wait(LAYOUT_POLL_MS);
    }
}

function rehome(entry)
{
    const { dialog, home } = entry;
    if (home && (dialog.position.left !== home.left || dialog.position.top !== home.top))
        dialog.setPosition({ left: home.left, top: home.top });

    for (const box of dialog.element?.[0]?.querySelectorAll('.window-content, .dialog-content, form') ?? [])
        box.scrollTop = 0;
}

function closeShown()
{
    shown?.dialog?.close();
    shown = null;
}

function openDialog(kind)
{
    const data = sampleBattle();
    if (kind === 'gm')
        return openBattleLogGMCard(data);
    return openBattleLogRecap(data, { outcome: data.mission?.outcome ?? 'VICTORY', mvpId: data.mvpId ?? null });
}

export async function showBattleLogDemo(kind, tab = null)
{
    const current = ++generation;
    if (shown?.home && !shown.dialog.rendered)
        shown = null;

    if (shown?.kind !== kind)
    {
        closeShown();
        const dialog = openDialog(kind);
        const entry = { kind, dialog, home: null };
        shown = entry;
        await rendered(dialog);
        await settled(dialog);

        if (current !== generation)
        {
            if (shown !== entry)
                dialog.close();
            return;
        }

        entry.home = { left: dialog.position.left, top: dialog.position.top };
    }

    if (!shown)
        return;

    rehome(shown);
    const root = shown.dialog.element?.[0];
    const button = tab ? root?.querySelector(`.battelog-recap-tab[data-tab="${tab}"]`) : null;
    if (button && !button.classList.contains('on'))
    {
        button.click();
        await wait(TAB_SETTLE_MS);
    }

    if (current === generation && shown)
        await settled(shown.dialog);
}

export function hideBattleLogDemos()
{
    generation++;
    closeShown();
    battle = null;
}
