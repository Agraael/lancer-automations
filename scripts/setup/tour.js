/* global Tour, game, ui, Dialog, Hooks, FormApplication, $, fetch */

import { maybeRunSettingsOnboarding } from './settings-onboarding.js';
import { getWeapons } from '../interactive/deployables.js';

const SETTING_TOUR_DONE = 'tourCompleted';
const SETTING_MOVEMENT_WARNING_SHOWN = 'movementWarningShown';
const NS = 'lancer-automations';
const ROOT = '#lancer-automations-config';
const RM_ROOT = '#reaction-manager-config';
const TAH_ROOT = '#la-hud';
const EM_ROOT = '.lancer-effect-manager';

function _emTabClick(tab)
{
    return async () =>
    {
        const tabEl = document.querySelector(`${EM_ROOT} .te-tab[data-tab="${tab}"]`);
        if (tabEl instanceof HTMLElement)
            tabEl.click();
        for (let i = 0; i < 20; i++)
        {
            if (document.querySelector(`${EM_ROOT} #tab-${tab}.active`))
                return;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
}

const EFFECT_MANAGER_STEPS = [
    {
        id: 'em-intro',
        title: 'Effect Manager',
        content: "Coding and automation can feel rough, and mid-game you need stuff fast. Here's a UI on top of the Lancer Automations systems, no code.",
        selector: `${EM_ROOT} .lancer-dialog-header`,
    },
    {
        id: 'em-std',
        title: 'Standard',
        content: "The standard effect page. Pick a status, a duration, optionally an auto-consume trigger.",
        selector: `${EM_ROOT} #tab-standard`,
        action: _emTabClick('standard'),
    },
    {
        id: 'em-std-pick',
        title: 'Standard - Effect',
        content: "Pick a status and a stack count. Target is up top.",
        selector: `${EM_ROOT} #std-effect-grid`,
    },
    {
        id: 'em-std-duration',
        title: 'Standard - Duration',
        content: "How long it sticks: end/start of turn, indefinite, etc.",
        selector: `${EM_ROOT} #std-duration`,
    },
    {
        id: 'em-std-trigger',
        title: 'Standard - Consume on',
        content: "Optional auto-consume trigger (on hit, on damage, on turn end...). Picking some triggers reveals extra filters: item LID, action name, status, check type.",
        selector: `${EM_ROOT} #std-trigger`,
    },
    {
        id: 'em-presets',
        title: 'Presets',
        content: "Save a filled-in effect as a preset and reload it later - handy for ones you apply often.",
        selector: `${EM_ROOT} .preset-bar`,
    },
    {
        id: 'em-custom',
        title: 'Custom',
        content: "Registering every possible status from NPC stuff is tedious and noisy on the status list. This tab lets you create temporary statuses on the fly. With my <b>temporary-custom-statuses</b> module some can be saved and reused.",
        selector: `${EM_ROOT} #tab-custom`,
        action: _emTabClick('custom'),
    },
    {
        id: 'em-custom-build',
        title: 'Custom - Build',
        content: "Name, icon, duration, note. Same shape as Standard but for ad-hoc statuses.",
        selector: `${EM_ROOT} #cust-name`,
    },
    {
        id: 'em-custom-saved',
        title: 'Custom - Saved',
        content: "Statuses saved through temporary-custom-statuses show up here for reuse, and on a separate Statuses tab in TAH.",
        selector: `${EM_ROOT} #cust-saved`,
    },
    {
        id: 'em-bonus',
        title: 'Bonus',
        content: "The advanced stuff, and one of the core features of the Lancer Automations engine. Many many things go through here: accuracy, damage on next attack, immunities, rerolls, target modifiers. They inject into the regular Lancer system cards seamlessly. Read <code>doc/API_EFFECTS.md</code> for the full menu.",
        selector: `${EM_ROOT} #tab-bonus`,
        action: _emTabClick('bonus'),
    },
    {
        id: 'em-bonus-type',
        title: 'Bonus - Type',
        content: "The bonus type. Each one reveals its own fields below.",
        selector: `${EM_ROOT} #bonus-type`,
    },
    {
        id: 'em-bonus-trigger',
        title: 'Bonus - Consume',
        content: "Same trigger picker as Standard. Combined with Uses, this is how you build things like <i>3 stacks of +1d6 damage on next attack, consumed on damage roll</i>.",
        selector: `${EM_ROOT} #bonus-trigger`,
    },
    {
        id: 'em-bonus-add',
        title: 'Bonus - Add',
        content: "Adds the bonus to the target.",
        selector: `${EM_ROOT} #bonus-add`,
    },
    {
        id: 'em-manage',
        title: 'Manage',
        content: "Everything currently on a token, including passive bonuses you can't see otherwise (Veterancy adding a passive on a HASE check, etc.).",
        selector: `${EM_ROOT} #tab-manage`,
        action: _emTabClick('manage'),
    },
];

const AD_EXTRA_STEPS = [
    {
        id: 'sheet-btn',
        title: 'On a Sheet',
        content: "Add extras and effects to any actor or item right from its sheet. The <b>L.A</b> button in its header is the entry point; the number shows how much is already attached.",
        selector: '.la-sheet-menu',
        action: async () =>
        {
            const actor = /** @type {any} */ (_emDemoActor);
            if (actor && !actor.sheet?.rendered)
                actor.sheet?.render(true);
            for (let attempt = 0; attempt < 40; attempt++)
            {
                if (document.querySelector('.la-sheet-menu'))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
    },
    {
        id: 'menu',
        title: 'L.A Menu',
        content: "The L.A button opens this menu. <b>Add Effect</b> opens the Effect Manager for this sheet, <b>Add Extra</b> attaches actions/deployables/bars, and <b>Extra Config</b> (items only) tunes auto-consume and deployable range/count.",
        selector: 'button[data-button="extras"]',
        action: async () =>
        {
            if (!document.querySelector('button[data-button="extras"]'))
            {
                const btn = document.querySelector('.la-sheet-menu');
                if (btn instanceof HTMLElement)
                    btn.click();
            }
            for (let attempt = 0; attempt < 40; attempt++)
            {
                if (document.querySelector('button[data-button="extras"]'))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
    },
    {
        id: 'extra-open',
        title: 'Add Extra',
        content: "Add Extra opens this: tie extra actions, deployables, and resource bars onto the actor or item.",
        selector: '.la-extras-body',
        action: async () =>
        {
            if (!document.querySelector('.la-extras-body'))
            {
                const extrasBtn = document.querySelector('button[data-button="extras"]');
                if (extrasBtn instanceof HTMLElement)
                    extrasBtn.click();
                else if (_emDemoActor)
                {
                    const { openExtrasDialog } = await import('../interactive/extras-dialog.js');
                    openExtrasDialog(/** @type {any} */ (_emDemoActor));
                }
            }
            for (let attempt = 0; attempt < 40; attempt++)
            {
                if (document.querySelector('.la-extras-body'))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
    },
    {
        id: 'extra-actions',
        title: 'Extra Actions',
        content: "Custom actions bolted onto the actor or item - name, activation, icon, optional resource limits. They show up in the TAH.",
        selector: '.la-extras-act-new',
    },
    {
        id: 'extra-deploy',
        title: 'Extra Deployables',
        content: "Attach deployables by actor or LID, or drag one in - this is how an NPC feature gets its deployable in the TAH. The T1/T2/T3 pills gate an entry to that NPC tier; none lit = every tier.",
        selector: '.la-extras-dep-new',
    },
    {
        id: 'extra-bars',
        title: 'Extra Bars',
        content: "Quick-add a manual token stat bar to track anything you like.",
        selector: '.la-extras-bar-new',
    },
    {
        id: 'extra-drawer',
        title: 'Editor',
        content: "Actions can also be an attack or damage roll.",
        selector: '.la-extras-drawer',
        action: async () =>
        {
            const isOpen = () =>
            {
                const drawer = document.querySelector('.la-extras-drawer');
                return drawer instanceof HTMLElement && Number.parseFloat(globalThis.getComputedStyle(drawer).opacity) > 0.5;
            };
            if (!isOpen())
            {
                const newBtn = document.querySelector('.la-extras-act-new');
                if (newBtn instanceof HTMLElement)
                    newBtn.click();
            }
            for (let attempt = 0; attempt < 40; attempt++)
            {
                if (isOpen())
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
    },
];

const CONFIG_STEPS = [
    {
        id: 'shortcut',
        title: 'Where to find this',
        content: "Re-open this any time from the <b>Lancer Automations</b> button in the Game Settings sidebar, under the LANCER section.",
        selector: '#lancer-automations-overview',
        action: () =>
        {
            /** @type {any} */ (ui).sidebar?.activateTab?.('settings');
        },
    },
    {
        id: 'welcome',
        title: 'Configuration',
        content: "Pretty simple, here's the configuration menu where all the Lancer Automations options live. Note: some settings are <b>client-side</b> (per user) and not shared world-wide (Token Action HUD, custom stat bars, vision debug overlays, etc.). Each player must enable them on their own client.",
        selector: `${ROOT} .lancer-dialog-header`,
    },
    {
        id: 'tabs',
        title: 'Tabs',
        content: "Each tab groups related stuff. Click around.",
        selector: `${ROOT} .sheet-tabs`,
    },
    {
        id: 'activations',
        tab: 'activations',
        title: 'Activations',
        content: "How activation popups feel during play: who sees them, whether the reaction is auto-spent, and a couple of niche toggles.",
        selector: `${ROOT} .tab[data-tab="activations"]`,
    },
    {
        id: 'combat',
        tab: 'combat',
        title: 'Combat & Movement',
        content: "All the combat-flavor toggles: knockback, throw, movement-cap, boost detection, alt structure/stress rules, infection damage. The big stuff.",
        selector: `${ROOT} .tab[data-tab="combat"]`,
    },
    {
        id: 'wrecks',
        tab: 'wrecks',
        title: 'Wrecks',
        content: "What happens when something dies. Spawn a wreck token, play the explosion, optionally drop terrain. Per-category if you want monstrosity wrecks to look different from mech wrecks.",
        selector: `${ROOT} .tab[data-tab="wrecks"]`,
    },
    {
        id: 'tokens',
        tab: 'tokens',
        title: 'Tokens & Display',
        content: "Half-size tokens, auto wall-height for tokens, my own token stat bars (a Bar Brawl alternative). Mostly QoL display tweaks.",
        selector: `${ROOT} .tab[data-tab="tokens"]`,
    },
    {
        id: 'iso',
        tab: 'iso',
        title: 'Isometric',
        content: "Fixes for isometric modules (Isometric Perspective, Grape Juice). Only shows when one is active.",
        selector: `${ROOT} .tab[data-tab="iso"]`,
        condition: () => !!game.modules.get('isometric-perspective')?.active || !!game.modules.get('grape_juice-isometrics')?.active,
    },
    {
        id: 'tah',
        tab: 'tah',
        title: 'Token Action HUD',
        content: "Here you can enable the TAH, my own Token Action HUD. It offers a bunch of tools, with UI and sound, and a few options to tune it. Still work in progress but fairly usable.",
        selector: `${ROOT} .tab[data-tab="tah"]`,
    },
    {
        id: 'sounds',
        tab: 'sounds',
        title: 'Sounds',
        content: "All the sound feedback options, including the UI sounds for the TAH.",
        selector: `${ROOT} .tab[data-tab="sounds"]`,
    },
    {
        id: 'statuses',
        tab: 'statuses',
        title: 'Statuses & FX',
        content: "The FX section: status visual effects (glows, shaders) plus the extra statuses I added. A bit like Lancer QoL, so pick one or the other if both are on.",
        selector: `${ROOT} .tab[data-tab="statuses"]`,
    },
    {
        id: 'debug',
        tab: 'debug',
        title: 'Debug',
        content: "Flip these on if something feels off and you want to see what the module is doing under the hood.",
        selector: `${ROOT} .tab[data-tab="debug"]`,
    },
    {
        id: 'tools',
        tab: 'tools',
        title: 'Tools & Extras',
        content: "My optional content packs (personal stuff), the News & Releases history, and one-shot maintenance buttons: LCP repair, reset, export, import.",
        selector: `${ROOT} .tab[data-tab="tools"]`,
    },
    {
        id: 'vision',
        tab: 'experimental',
        title: 'Vision',
        content: "Vision-from-edge for big tokens, the Lancer Sensors and Battlefield Awareness detection modes (auto-add, combat-only, range source), basic-sight overrides, and drag-vision behavior all live here.",
        selector: `${ROOT} .tab[data-tab="experimental"]`,
    },
    {
        id: 'tutorials',
        tab: 'tutorials',
        title: 'Tutorials & Help',
        content: "Re-run the <b>Setup Wizard</b>, or launch any tour: Token Action HUD, ruler &amp; movement, advanced measure, effect manager, automation. They can run long - start one now or come back whenever.",
        selector: `${ROOT} .tab[data-tab="tutorials"]`,
    },
    {
        id: 'save',
        title: 'Save',
        content: "One Save commits every tab at once. Some changes need a reload, you'll be prompted on close.",
        selector: `${ROOT} footer`,
    },
];

const ACTIVATION_MANAGER_STEPS = [
    {
        id: 'shortcut',
        title: 'Where to find this',
        content: "Re-open this any time from the <b>Activation Manager</b> button in the Game Settings sidebar, under the LANCER section.",
        selector: '#lancer-automations-manager',
        action: () =>
        {
            /** @type {any} */ (ui).sidebar?.activateTab?.('settings');
        },
    },
    {
        id: 'welcome',
        title: 'Activation Manager',
        content: "Where you build automations. Item-bound (per LID) or general, code-driven, fired on triggers like onMove, onHit, onActivation, and so on.",
        selector: `${RM_ROOT} .lancer-dialog-header`,
    },
    {
        id: 'tabs',
        title: 'Tabs',
        content: "Custom is your own stuff. Defaults are the activations bundled with the module. Startup is JS that runs once on Foundry ready.",
        selector: `${RM_ROOT} .sheet-tabs`,
    },
    {
        id: 'custom',
        tab: 'custom',
        title: 'Custom',
        content: "Your activations, grouped into folders. Each row binds to one or more triggers and runs your code.",
        selector: `${RM_ROOT} .tab[data-tab="custom"]`,
    },
    {
        id: 'add',
        tab: 'custom',
        title: 'Add',
        content: "Create a new one. You'll pick item-bound (LID) or general, the triggers, and the code blocks that run on evaluate / activate / init.",
        selector: `${RM_ROOT} .tab[data-tab="custom"] .add-reaction`,
    },
    {
        id: 'editor',
        title: 'Editor',
        content: "Add opens this editor. Triggers, filters, and code all live here; Save commits, closing discards.",
        selector: '#reaction-editor',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-binding',
        title: 'Item-bound or General',
        content: "Bind it to an item (by LID) or make it <b>general</b> - checked on every token.",
        selector: '#reaction-editor input[name="isGeneral"]',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-lid',
        title: 'Item LID',
        content: "For item-bound activations, the item's Lancer ID. The finder button beside it searches your items and compendiums, so you don't type it by hand.",
        selector: '#reaction-editor input[name="lid"]',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-triggers',
        title: 'Triggers',
        content: "Tick the triggers that fire it: onMove, onHit, onActivation, onStructure, and many more.",
        selector: '#reaction-editor .trigger-groups-container',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-options',
        title: 'Filters',
        content: "Narrow when it fires: react to self or others, disposition, in or out of combat, auto-activate.",
        selector: '#reaction-editor .options-grid',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-code',
        title: 'Code Blocks',
        content: "Your logic: <b>evaluate</b> (should it fire?), <b>activation</b> (what happens), plus onInit and onMessage.",
        selector: '#reaction-editor .CodeMirror',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-autocomplete',
        title: 'Autocomplete',
        content: "The editor suggests API names as you type. Press <b>Alt-Enter</b> to open the list, then arrow through to see what each does.",
        selector: '#reaction-editor .CodeMirror',
        action: _ensureReactionEditorOpen,
        cleanup: _closeReactionEditor,
    },
    {
        id: 'folder',
        tab: 'custom',
        title: 'Folders',
        content: "Make folders to keep things tidy. Drag rows in to file them.",
        selector: `${RM_ROOT} .tab[data-tab="custom"] .create-folder-btn`,
    },
    {
        id: 'search',
        tab: 'custom',
        title: 'Search & Filter',
        content: "Filter by name, LID, or trigger type. Handy when the list gets long.",
        selector: `${RM_ROOT} .tab[data-tab="custom"] .filter-bar`,
    },
    {
        id: 'defaults',
        tab: 'defaults',
        title: 'Defaults',
        content: "The activations bundled with the module: Overwatch, Brace, Flight, Fall, plus a bunch of NPC-feature automations. Toggle them on or off.",
        selector: `${RM_ROOT} .tab[data-tab="defaults"]`,
    },
    {
        id: 'startup',
        tab: 'startup',
        title: 'Startup',
        content: "JS that runs once on Foundry ready. Good for helper functions you want your activations to reuse.",
        selector: `${RM_ROOT} .tab[data-tab="startup"]`,
    },
];

function _tahDrillStep(id, title, content, drillPath, finalPrefix)
{
    const cls = `la-hud-tour-${id}`;
    return {
        id,
        title,
        content,
        selector: `${TAH_ROOT} .${cls}`,
        action: async () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .${cls}`).forEach((el) => el.classList.remove(cls));
            const findRow = (prefix) => Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`))
                .find((row) => row.textContent?.trim().toLowerCase().startsWith(prefix));
            const openRow = async (prefix) =>
            {
                for (let i = 0; i < 40; i++)
                {
                    const row = findRow(prefix);
                    if (row)
                    {
                        $(row).trigger('mouseenter');
                        $(row).trigger('click');
                        return row;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                return null;
            };
            for (const pathStep of drillPath)
                await openRow(pathStep);
            for (let i = 0; i < 40; i++)
            {
                const target = findRow(finalPrefix);
                if (target)
                {
                    target.classList.add(cls); break;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
        cleanup: () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .${cls}`).forEach((el) => el.classList.remove(cls));
            const colLabels = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-col-label`));
            for (let i = 1; i < colLabels.length; i++)
            {
                const col = colLabels[i].parentElement;
                if (col instanceof HTMLElement)
                    col.style.display = 'none';
            }
        },
    };
}

function _tahCategoryStep(label, content, alternatives = [])
{
    const cls = `la-hud-tour-cat-${label.toLowerCase().replace(/\s+/g, '')}`;
    const candidates = [label, ...alternatives].map((labelText) => labelText.toLowerCase());
    return {
        id: `cat-${label.toLowerCase().replace(/\s+/g, '-')}`,
        title: label,
        content,
        selector: `${TAH_ROOT} .${cls}`,
        action: async () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .${cls}`).forEach((el) => el.classList.remove(cls));
            const findTarget = () => Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`)).find((row) =>
            {
                const text = row.textContent?.trim().toLowerCase() ?? '';
                return candidates.some((candidate) => text.startsWith(candidate));
            });
            let target = null;
            for (let attempt = 0; attempt < 40; attempt++)
            {
                target = findTarget();
                if (target)
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (target)
            {
                target.classList.add(cls);
                $(target).trigger('mouseenter');
                $(target).trigger('click');
            }
        },
        cleanup: () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .${cls}`).forEach((el) => el.classList.remove(cls));
            const colLabels = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-col-label`));
            for (let idx = 1; idx < colLabels.length; idx++)
            {
                const col = colLabels[idx].parentElement;
                if (col instanceof HTMLElement)
                    col.style.display = 'none';
            }
        },
    };
}

const TAH_STEPS = [
    {
        id: 'intro',
        title: 'Token Action HUD',
        content: "The Lancer Automations Token Action HUD - your token's action menu.",
        selector: TAH_ROOT,
    },
    {
        id: 'token-name',
        title: 'Token Name',
        content: 'Click the name to open the actor sheet.',
        selector: `${TAH_ROOT} .la-hud-token-name`,
    },
    {
        id: 'move-hud',
        title: 'Move the HUD',
        content: 'Unlock with the lock icon, then drag the HUD anywhere. The reset icon restores its position.',
        selector: `${TAH_ROOT} .la-hud-lock`,
    },
    {
        id: 'combat-toggle',
        title: 'Combat Toggle',
        content: 'Click the swords icon to add or remove the token from the combat tracker without leaving the HUD.',
        selector: `${TAH_ROOT} .la-combat-toggle`,
    },
    {
        id: 'stats',
        title: 'Stats Bar',
        content: 'Live vitals: HP, heat, structure and stress pips, overshield, burn.',
        selector: '#la-hud-stats',
    },
    {
        id: 'stats-detail',
        title: 'More Stats',
        content: 'Click to expand armor, evasion, e-defense, tech attack, save, sensors, and core.',
        selector: `#la-hud-stats .la-stats-toggle`,
    },
    {
        id: 'movement',
        title: 'Movement Cap',
        content: 'The right number is the max move this turn (speed); the left is what the token has used so far. Boost (or anything granting extra move) extends the cap.',
        selector: '#la-combat-bar',
    },
    {
        id: 'action-economy',
        title: 'Action Tracker',
        content: 'Quick / Full / Reaction / Protocol / Move pips. Click to spend, right-click to restore; on your turn the spent slot becomes End Turn. It mirrors Lancer\'s own action tracker, so you can disable that one in the Lancer system settings.',
        selector: '#la-combat-bar',
    },
    {
        id: 'move-history',
        title: 'Movement History',
        content: 'Revert the last move, or clear this token\'s recorded history.',
        selector: '#la-combat-bar span[title="Revert Last Move"]',
    },
    {
        id: 'keyboard-nav',
        title: 'Keyboard Navigation',
        content: 'Drive the HUD by keyboard: <b>Shift+WASD</b> moves, <b>Shift+E</b> left-clicks, <b>Shift+Q</b> right-clicks, <b>Shift+F</b> searches.',
        selector: `${TAH_ROOT} .la-hud-col-label`,
    },
    {
        id: 'categories',
        title: 'Categories',
        content: 'The Menu column lists categories (Actions, Weapons, Systems, Frame, Talents, Utility, Statuses). Hovering or clicking a row cascades extra columns out to the right.',
        selector: `${TAH_ROOT} .la-hud-col-label`,
    },
    {
        id: 'item-row',
        title: 'Item Rows',
        content: "Any row that is not a sub-category is an item. Left-click usually activates it; right-click (or Shift+Q) opens a detail popup with its full text.",
        selector: `${TAH_ROOT} .la-hud-tour-item`,
        action: async () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-item`).forEach((el) => el.classList.remove('la-hud-tour-item'));
            // TAH wires click or mouseenter per the click-to-open setting; trigger both so bound handlers fire.
            const c1Rows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            if (c1Rows[0])
            {
                $(c1Rows[0]).trigger('mouseenter');
                $(c1Rows[0]).trigger('click');
            }
            for (let i = 0; i < 40; i++)
            {
                const allRows = document.querySelectorAll(`${TAH_ROOT} .la-hud-row`);
                if (allRows.length > c1Rows.length)
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            const allRows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            const firstChild = allRows[c1Rows.length];
            firstChild?.classList.add('la-hud-tour-item');
        },
        cleanup: () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-item`).forEach((el) => el.classList.remove('la-hud-tour-item'));
            // Close any cascading columns (c2/c3/c4) opened by the action.
            const colLabels = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-col-label`));
            for (let i = 1; i < colLabels.length; i++)
            {
                const col = colLabels[i].parentElement;
                if (col instanceof HTMLElement)
                    col.style.display = 'none';
            }
        },
    },
    {
        id: 'auto-tick',
        title: 'Automation Hint',
        content: "A coloured triangle on a row's left edge marks it <b>automated</b> - using it runs its built-in effects.",
        selector: `${TAH_ROOT} .la-hud-auto-tick`,
        action: async () =>
        {
            const findRow = (prefix) => Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`))
                .find((row) => row.textContent?.trim().toLowerCase().startsWith(prefix));
            const openRow = async (prefix) =>
            {
                for (let attempt = 0; attempt < 40; attempt++)
                {
                    const row = findRow(prefix);
                    if (row)
                    {
                        $(row).trigger('mouseenter'); $(row).trigger('click'); return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            };
            await openRow('actions');
            await openRow('basic');
            for (let attempt = 0; attempt < 40; attempt++)
            {
                if (document.querySelector(`${TAH_ROOT} .la-hud-auto-tick`))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
        cleanup: () =>
        {
            const colLabels = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-col-label`));
            for (let idx = 1; idx < colLabels.length; idx++)
            {
                const col = colLabels[idx].parentElement;
                if (col instanceof HTMLElement)
                    col.style.display = 'none';
            }
        },
    },
    {
        id: 'detailing',
        title: 'Right-click Details',
        content: "Right-click any item (or <b>Shift+Q</b>) to open a detail popup: full text, tags, and any Disable / Destroy toggles.",
        selector: '.la-hud-popup',
        action: async () =>
        {
            const findRow = (prefix) => Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`))
                .find((row) => row.textContent?.trim().toLowerCase().startsWith(prefix));
            for (let attempt = 0; attempt < 40; attempt++)
            {
                const cat = findRow('weapons') ?? findRow('systems');
                if (cat)
                {
                    $(cat).trigger('mouseenter'); $(cat).trigger('click'); break;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            for (let attempt = 0; attempt < 40; attempt++)
            {
                const leaf = document.querySelector(`${TAH_ROOT} .la-hud-row[title="Right click for details"]`);
                if (leaf)
                {
                    $(leaf).trigger('contextmenu'); break;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            for (let attempt = 0; attempt < 40; attempt++)
            {
                if (document.querySelector('.la-hud-popup'))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
        cleanup: () =>
        {
            document.querySelectorAll('.la-hud-popup').forEach((el) => el.remove());
            const colLabels = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-col-label`));
            for (let idx = 1; idx < colLabels.length; idx++)
            {
                const col = colLabels[idx].parentElement;
                if (col instanceof HTMLElement)
                    col.style.display = 'none';
            }
        },
    },
    {
        id: 'search',
        title: 'Search',
        content: 'Click the magnifier or press <b>Shift+F</b> to live-filter every action.',
        selector: `${TAH_ROOT} .la-hud-search-toggle`,
    },
    {
        id: 'favorites',
        title: 'Favorites',
        content: 'Ctrl+Right-click any action to mark as favorite. Hover the star tab to open the list.',
        selector: `${TAH_ROOT} .la-hud-fav-icon`,
    },
    _tahCategoryStep('Actions', "Your actions, grouped by activation: Basic, Attacks, Quick, Full, Reactions and more."),
    _tahDrillStep('actions-basic', 'Basic', "The common actions, split into Quick and Full sections.", ['actions'], 'basic'),
    _tahDrillStep('actions-attacks', 'Attacks', "Skirmish, Barrage, Fight.", ['actions'], 'attacks'),
    _tahDrillStep('actions-reaction', 'Reactions', "Overwatch, Brace, and your other reactions.", ['actions'], 'reaction'),
    _tahCategoryStep('Weapons', "Equipped weapons, by mount."),
    _tahCategoryStep('Tech', "Tech attacks and tech systems."),
    _tahDrillStep('scan', 'Scan', "A successful scan feeds the target's data into the Glossary.", ['tech', 'basic'], 'scan'),
    _tahCategoryStep('Deployables', "Drones, mines, and other deployables from your systems and weapons; place them on the map."),
    _tahCategoryStep('Resources', "Ammo, limited uses, and other trackable resources."),
    _tahCategoryStep('Systems', "Your installed mech systems: their actions, passives, and limited uses."),
    _tahCategoryStep('Frame', "Your frame: its traits, core system, and Core Power activation.", ['Class', 'Pilot']),
    _tahCategoryStep('Talents', "Your pilot talents, rank by rank, with any actions they grant."),
    _tahCategoryStep('Attributes', "HULL / AGI / SYS / ENG checks and saves, plus your pilot skill triggers.", ['Skills']),
    {
        id: 'utility',
        title: 'Utility',
        content: "Sub-categories of tools: Gameplay actions, Movement helpers, Measures (the Advanced Measure tool), Log, Glossary, and a Misc grab-bag.",
        selector: `${TAH_ROOT} .la-hud-tour-utility`,
        action: () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-utility`).forEach((el) => el.classList.remove('la-hud-tour-utility'));
            const rows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            const utilityRow = rows.find((r) => r.textContent?.trim().toLowerCase().startsWith('utility'));
            utilityRow?.classList.add('la-hud-tour-utility');
        },
        cleanup: () =>
        {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-utility`).forEach((el) => el.classList.remove('la-hud-tour-utility'));
        },
    },
    _tahDrillStep('measures', 'Measures', "Toggle the Advanced Measure tool, plus other range and measure helpers.", ['utility'], 'measures'),
    _tahDrillStep('utility-misc', 'Misc', "A grab-bag of TAH tools: Vote, Downtime, Reserve, Rest, Add Extra, and more.", ['utility'], 'misc'),
    _tahDrillStep('add-extra', 'Add Extra', "Attach custom actions or extra deployables to the actor.", ['utility', 'misc'], 'add extra'),
    _tahDrillStep('glossary', 'Glossary', "Scanned actors, gated by read permission.", ['utility'], 'glossary'),
    _tahCategoryStep('Statuses', "Status effects on the token. Click applies or stacks, right-click removes, Ctrl+click marks a favorite."),
    _tahCategoryStep('Macros', "Pinned macros for quick access. Per-user."),
    {
        id: 'outro',
        title: 'And more',
        content: 'There is a lot more under the hood, but the tour would get long. Drop by Discord if you have questions.',
        selector: TAH_ROOT,
    },
];

const ADV_TAH_STEPS = [
    {
        id: 'adv-intro',
        title: 'Advanced TAH Tools',
        content: "A pass through the tools tucked into the HUD, past just firing weapons.",
        selector: TAH_ROOT,
    },
    _tahDrillStep('adv-attacks', 'Skirmish & Barrage', "You can attack straight from a weapon, but Skirmish and Barrage live here as real actions so the gameplay action is captured: an automation watching for a skirmish reacts to it, and the secondary weapon gets its no-bonus-damage rule.", ['actions', 'attacks'], 'skirmish'),
    _tahDrillStep('adv-basic-tools', 'Basic Attack, Damage, Basic Tech', "Support tools for rolls your setup doesn't cover. Basic Attack and Damage sit under Attacks, Basic Tech under Tech. Reach for them to roll something by hand.", ['actions', 'attacks'], 'basic attack'),
    _tahDrillStep('adv-boost', 'Boost', "Boost feeds the movement cap: with that feature on, using it auto-emulates the extra move, and anything reacting to a boost fires through here. The auto-boost offer also spots when you need one and prompts you.", ['actions', 'basic'], 'boost'),
    _tahDrillStep('adv-deploy', 'Deploy', "Places a deployable. The range ring is only the default suggestion, nothing stops you dropping it outside. Change a deployable's range or count with Add Extra / Extra Config on the item.", ['deployables'], 'deploy item'),
    _tahDrillStep('adv-contest', 'Contest', "Runs a contested check between two tokens. Also available as an automation tool.", ['attributes', 'skills'], 'contest'),
    _tahDrillStep('adv-force-check', 'Force Check', "Sends a HASE check to picked tokens, rolled by their owners; with a save target it becomes a save against it.", ['attributes', 'skills'], 'force check'),
    _tahDrillStep('adv-scan', 'Generate Scan', "Builds a scan of a token by hand when you need one. A token's settings can also force it to read as scanned with no scan document.", ['utility', 'gameplay'], 'generate scan'),
    _tahDrillStep('adv-link', 'Link to Token', "Ties two tokens together. Hover one and its linked token lights up with it.", ['utility', 'gameplay'], 'link to token'),
    _tahDrillStep('adv-reinforcement', 'Reinforcement', "Sets up entrances. Drop tokens with Alt so they start hidden, select them, run Reinforcement, and pick the turn each one appears. It can preview an optional token to swap in.", ['utility', 'gameplay'], 'reinforcement'),
    _tahDrillStep('adv-downtime', 'Downtime', "Runs the between-mission downtime actions.", ['utility', 'misc'], 'downtime'),
    _tahDrillStep('adv-reserve', 'Reserve', "Grabs a downtime reserve for the pilot.", ['utility', 'misc'], 'reserve'),
    _tahDrillStep('adv-vote', 'Vote', "Sends a quick poll to the table and tallies the answers.", ['utility', 'misc'], 'vote'),
    {
        id: 'adv-outro',
        title: 'And more',
        content: "That's the toolbox. Dig through Utility for the rest.",
        selector: TAH_ROOT,
    },
];

const RULER_STEPS = [
    {
        id: 'intro',
        title: 'Lancer Ruler',
        content: "Drag a token to measure. The ruler follows Lancer rules: speed cap, terrain cost, climb, flight ceiling.",
        selector: 'body',
        allowCanvas: true,
    },
    {
        id: 'wheel',
        title: 'Movement Wheel',
        content: "Press <b>M</b> on a selected token to open this wheel and set its <b>base</b> movement type - walk, fly, drift, each with its own cost rules.",
        selector: '.lancer-movement-wheel',
        action: async () =>
        {
            if (!canvas.tokens.controlled[0])
                canvas.tokens.placeables.find((token) => token.actor && !token.document.hidden)?.control({ releaseOthers: true });
            const { toggleMovementWheel } = await import('../movement/movement-wheel.js');
            if (!document.querySelector('.lancer-movement-wheel'))
                toggleMovementWheel();
            for (let attempt = 0; attempt < 20; attempt++)
            {
                if (document.querySelector('.lancer-movement-wheel'))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        },
        cleanup: async () =>
        {
            if (document.querySelector('.lancer-movement-wheel'))
            {
                const { toggleMovementWheel } = await import('../movement/movement-wheel.js');
                toggleMovementWheel();
            }
        },
    },
    {
        id: 'm-drag',
        title: 'Cycle While Dragging',
        content: "During a drag, press <b>M</b> to cycle the type for that drag only - the token's base type stays put.",
        selector: 'body',
        allowCanvas: true,
    },
    {
        id: 'free-debug',
        title: 'Free & Debug',
        content: "Hold <b>V</b> for free movement (no cost, ignores terrain). Hold <b>B</b> for debug movement (skips automation hooks). <b>Ctrl+drag</b> from empty space gives the vanilla ruler.",
        selector: 'body',
        allowCanvas: true,
    },
    {
        id: 'force',
        title: 'Force Movement',
        content: "<b>Force</b> is unintentional movement (knockback, drag): it doesn't trigger move automations like Overwatch.",
        selector: 'body',
        allowCanvas: true,
    },
];

const AM_ROOT = '#la-measure-toolbar';

const ADV_MEASURE_STEPS = [
    {
        id: 'intro',
        title: 'Advanced Measure',
        content: "A measuring toolset reusing LA's targeting visuals - toggle it with <b>Shift+R</b>. Everything lives on this floating toolbar.",
        selector: AM_ROOT,
    },
    {
        id: 'help',
        title: 'Shortcuts',
        content: "Hover here for the full cheat-sheet. Quick ones: <b>Ctrl+wheel</b> rotate, <b>Shift+wheel</b> size, <b>Q/E</b> elevation, <b>W/S</b> tilt a line, <b>Z</b> reset.",
        selector: `${AM_ROOT} .la-mt-help`,
    },
    {
        id: 'shapes',
        title: 'Shapes',
        content: "Pick a shape - Blast, Burst, Cone, Line - or a single Target mark. Options make it 3D (elevation), auto-follow terrain, and propagate cell to cell.",
        selector: `${AM_ROOT} .la-mt-icon-btn`,
    },
    {
        id: 'range',
        title: 'Range Pulse',
        content: "Pulse a range around the shape: a manual radius, threat, sensor, max reach, or a weapon's range. <b>T</b> cycles sources, re-clicking the active one turns it off. A movement-reach toggle is here too.",
        selector: `${AM_ROOT} .la-mt-dd`,
    },
    {
        id: 'pins',
        title: 'Pinned Rings',
        content: "<b>Right-click</b> a range source (or a weapon in its list) to pin it: a steady ring that stays while the tool is open, on as many tokens as you want. Pinned entries show a ★; the TAH range toggles pin the same way.",
        selector: `${AM_ROOT} .la-mt-dd`,
    },
    {
        id: 'marker',
        title: 'Markers & Ruler',
        content: "<b>Shift+click</b> in free mode marks a token (shows its range and reach) or the ground (manual-range only). Hold <b>Ctrl</b> for the vanilla Measure Distance ruler.",
        selector: AM_ROOT,
    },
];

let _tahPrevControlled = [];
let _tahDemoToken = null;
let _tahDemoAddedToCombat = false;
let _tahCreatedCombat = false;
let _tahPrevTurnIdx = null;

function _waitForTokenDialog()
{
    return new Promise((resolve) =>
    {
        new Dialog({
            title: 'Lancer Automations',
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">PLACE A TOKEN</div>
                    <div class="lancer-dialog-subtitle">The TAH tour needs a mech token.</div>
                </div>
                <p style="padding: 4px 6px;">Drop a player mech onto the scene and select it, then click Continue. Talents, Frame and mounts are mech-only, so an NPC won't do, and an unequipped mech leaves the weapon steps with nothing to point at.</p>
            `,
            buttons: {
                continue: {
                    icon: '<i class="fas fa-check"></i>',
                    label: 'Continue',
                    callback: () => resolve(true),
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: 'Cancel Tour',
                    callback: () => resolve(false),
                },
            },
            default: 'continue',
            close: () => resolve(false),
        }, { classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
    });
}

function _findUsableToken()
{
    // Mech only: the tour walks mech-specific categories (Weapons by mount, Frame, Talents) an NPC lacks.
    const isMech = (token) => token.actor?.type === 'mech';
    const isEquipped = (token) => isMech(token) && !!getWeapons(token).length;
    const visible = canvas.tokens.placeables.filter((token) => !token.document.hidden);
    const controlled = canvas.tokens.controlled[0];
    if (controlled && isEquipped(controlled))
        return controlled;
    return visible.find(isEquipped)
        ?? (controlled && isMech(controlled) ? controlled : null)
        ?? visible.find(isMech)
        ?? null;
}

// Spin up a demo combat so the combat bar (action economy, movement cap) renders.
async function _setupDemoCombat(target)
{
    const hadStartedCombat = !!game.combat?.started;
    const prevTurnIdx = game.combat?.turn ?? null;
    if (!game.combat)
    {
        const combat = await Combat.create({ scene: canvas.scene.id, active: true });
        if (combat)
            _tahCreatedCombat = true;
    }
    if (!target.inCombat)
    {
        await target.document.toggleCombatant?.(true);
        _tahDemoAddedToCombat = true;
    }
    if (game.combat && !game.combat.started)
    {
        try
        {
            await game.combat.startCombat();
        }
        catch
        {
            void 0;
        }
    }
    // Token must be the CURRENT combatant; otherwise the bar shows the active turn's.
    if (game.combat?.started)
    {
        const combatant = game.combat.combatants.find(entry => entry.tokenId === target.id);
        const idx = combatant ? game.combat.turns.findIndex(entry => entry.id === combatant.id) : -1;
        if (combatant && idx >= 0 && game.combat.combatant?.id !== combatant.id)
        {
            if (hadStartedCombat)
                _tahPrevTurnIdx = prevTurnIdx;
            try
            {
                await game.combat.update({ turn: idx });
            }
            catch
            {
                void 0;
            }
        }
    }
    for (let attempt = 0; attempt < 40; attempt++)
    {
        if (document.querySelector('#la-combat-bar'))
            break;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

async function _ensureTAHOpen({ withCombat = true } = {})
{
    const controlledMech = canvas.tokens.controlled.find((token) => token.actor?.type === 'mech');
    if (controlledMech && document.querySelector('#la-hud-stats'))
        return true;

    // tahEnabled is client-scope, defaults off. Offer to turn it on for the tour.
    if (!game.settings.get(NS, 'tahEnabled'))
    {
        const enable = await new Promise((resolve) =>
        {
            new Dialog({
                title: 'Token Action HUD',
                content: '<p style="padding:6px 8px;">Token Action HUD is off. Enable it for the tour?</p>',
                buttons: {
                    yes: { icon: '<i class="fas fa-check"></i>', label: 'Enable', callback: () => resolve(true) },
                    no:  { icon: '<i class="fas fa-times"></i>', label: 'Skip',   callback: () => resolve(false) },
                },
                default: 'yes',
                close: () => resolve(false),
            }, { classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
        });
        if (!enable)
            return false;
        await game.settings.set(NS, 'tahEnabled', true);
    }

    _tahPrevControlled = canvas.tokens.controlled.slice();

    let target = _findUsableToken();
    while (!target)
    {
        const proceed = await _waitForTokenDialog();
        if (!proceed)
        {
            _tahPrevControlled = [];
            return false;
        }
        target = _findUsableToken();
    }

    target.control({ releaseOthers: true });
    _tahDemoToken = target;

    if (withCombat)
        await _setupDemoCombat(target);

    for (let attempt = 0; attempt < 40; attempt++)
    {
        if (document.querySelector('#la-hud-stats'))
            break;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return true;
}

async function _restoreAfterTAH()
{
    // Restore the previously-active turn before touching combatants so combat tracker UI stays sane.
    try
    {
        if (_tahPrevTurnIdx !== null && game.combat)
            await game.combat.update({ turn: _tahPrevTurnIdx });
    }
    catch
    { /* ignore */ }
    try
    {
        if (_tahDemoToken && _tahDemoAddedToCombat)
            await /** @type {any} */ (_tahDemoToken.document).toggleCombatant?.(false);
    }
    catch
    { /* ignore */ }
    try
    {
        if (_tahCreatedCombat && game.combat)
            await game.combat.delete();
    }
    catch
    { /* ignore */ }
    try
    {
        _tahDemoToken?.release();
    }
    catch
    { /* ignore */ }
    for (const token of _tahPrevControlled)
    {
        try
        {
            token.control({ releaseOthers: false });
        }
        catch
        { /* ignore */ }
    }
    _tahPrevControlled = [];
    _tahDemoToken = null;
    _tahDemoAddedToCombat = false;
    _tahCreatedCombat = false;
    _tahPrevTurnIdx = null;
}

let _tahTour;
let _advTahTour;

export async function startTahTour()
{
    return startTour('tah-tour');
}

class _RootTour extends Tour
{
    constructor(config, root)
    {
        super(config);
        this._root = root;
        this._onCompleteHook = null;
    }
    async _preStep()
    {
        await super._preStep();
        const step = /** @type {any} */ (this.currentStep);
        if (step?.tab)
        {
            const tab = document.querySelector(`${this._root} nav.sheet-tabs a[data-tab="${step.tab}"]`);
            if (tab instanceof HTMLElement)
                tab.click();
        }
        if (typeof step?.action === 'function')
        {
            try
            {
                await step.action();
            }
            catch (e)
            {
                console.warn('lancer-automations | tour step action failed', e);
            }
        }
        // A selector resolving to nothing makes Foundry throw; degrade to a centered popover instead.
        if (step?.selector && step.selector !== 'body' && !document.querySelector(step.selector))
        {
            this._blankedSelector = step.selector;
            this._blankedStep = step;
            step.selector = null;
        }
    }
    _restoreBlanked()
    {
        if (this._blankedStep)
        {
            this._blankedStep.selector = this._blankedSelector;
            this._blankedStep = null;
            this._blankedSelector = null;
        }
    }
    async _postStep()
    {
        this._restoreBlanked();
        const step = /** @type {any} */ (this.currentStep);
        if (typeof step?.cleanup === 'function')
        {
            try
            {
                await step.cleanup();
            }
            catch (e)
            {
                console.warn('lancer-automations | tour step cleanup failed', e);
            }
        }
        await super._postStep();
    }
    async _renderStep()
    {
        await super._renderStep();
        const step = /** @type {any} */ (this.currentStep);
        if (step?.allowCanvas)
        {
            const self = /** @type {any} */ (this);
            if (self.overlayElement)
                self.overlayElement.style.pointerEvents = 'none';
            if (self.fadeElement)
                self.fadeElement.style.pointerEvents = 'none';
        }
    }
    /** @param {() => Promise<void> | void} fn */
    onComplete(fn)
    {
        this._onCompleteHook = fn;
    }
    async complete()
    {
        this._restoreBlanked();
        const fn = this._onCompleteHook;
        this._onCompleteHook = null;
        await super.complete();
        if (fn)
            await fn();
    }
    async exit()
    {
        this._restoreBlanked();
        this._onCompleteHook = null;
        await super.exit();
    }
}

let _configTour;
let _activationTour;
let _effectManagerTour;
let _rulerTour;
let _advMeasureTour;
let _addExtraTour;

function _ensureWindowOpen(windowId, importPath, className)
{
    const open = Object.values(/** @type {any} */ (ui.windows)).find((win) => /** @type {any} */ (win).id === windowId);
    if (open)
        return Promise.resolve();
    return import(importPath).then((module) =>
    {
        new module[className]().render(true);
        return new Promise((resolve) => setTimeout(resolve, 200));
    });
}

function _ensureConfigOpen()
{
    return _ensureWindowOpen('lancer-automations-config', './settingsMenus.js', 'LancerAutomationsConfig');
}

function _ensureActivationManagerOpen()
{
    return _ensureWindowOpen('reaction-manager-config', '../activations/reaction-manager.js', 'ReactionConfig');
}

async function _ensureEffectManagerOpen()
{
    if (document.querySelector(EM_ROOT))
        return true;
    const { executeEffectManager } = await import('../bonuses/effectManager.js');
    executeEffectManager();
    for (let i = 0; i < 40; i++)
    {
        if (document.querySelector(EM_ROOT))
            return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !!document.querySelector(EM_ROOT);
}

function _closeEffectManager()
{
    const el = document.querySelector(EM_ROOT);
    if (!el)
        return;
    const dlg = Object.values(/** @type {any} */ (ui.windows)).find((w) => /** @type {any} */ (w).element?.[0] === el || /** @type {any} */ (w).element?.[0]?.contains(el));
    try
    {
        /** @type {any} */ (dlg)?.close?.();
    }
    catch
    { /* ignore */ }
}

let _emDemoActor = null;

function _closeExtrasDialog()
{
    const closeContaining = (selector) =>
    {
        const el = document.querySelector(selector);
        if (!el)
            return;
        const dlg = Object.values(/** @type {any} */ (ui.windows)).find((win) => /** @type {any} */ (win).element?.[0]?.contains(el));
        try
        {
            /** @type {any} */ (dlg)?.close?.();
        }
        catch
        { /* ignore */ }
    };
    closeContaining('.la-extras-body');
    closeContaining('button[data-button="extras"]');
    try
    {
        if (/** @type {any} */ (_emDemoActor)?.sheet?.rendered)
            /** @type {any} */ (_emDemoActor).sheet.close();
    }
    catch
    { /* ignore */ }
    _emDemoActor = null;
}

async function _ensureAddExtraStart()
{
    const mech = canvas.tokens.controlled.find((token) => token.actor?.type === 'mech')?.actor
        ?? canvas.tokens.placeables.find((token) => token.actor?.type === 'mech' && !token.document.hidden)?.actor;
    if (!mech)
    {
        ui.notifications.warn('The Add Extra tour needs a mech on the scene.');
        return false;
    }
    _emDemoActor = mech;
    return true;
}

async function _ensureAdvMeasureOpen()
{
    if (document.querySelector(AM_ROOT))
        return true;
    const { toggleAdvancedMeasure } = await import('../interactive/tools/advancedMeasure.js');
    toggleAdvancedMeasure();
    for (let attempt = 0; attempt < 40; attempt++)
    {
        if (document.querySelector(AM_ROOT))
            return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !!document.querySelector(AM_ROOT);
}

async function _closeAdvMeasure()
{
    if (!document.querySelector(AM_ROOT))
        return;
    const { closeAdvancedMeasure } = await import('../interactive/tools/advancedMeasure.js');
    closeAdvancedMeasure();
}

async function _ensureReactionEditorOpen()
{
    if (document.querySelector('#reaction-editor'))
        return true;
    const btn = document.querySelector(`${RM_ROOT} .tab[data-tab="custom"] .add-reaction`);
    if (btn instanceof HTMLElement)
        btn.click();
    for (let attempt = 0; attempt < 40; attempt++)
    {
        if (document.querySelector('#reaction-editor'))
            return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !!document.querySelector('#reaction-editor');
}

async function _closeReactionEditor()
{
    const app = Object.values(/** @type {any} */ (ui.windows)).find((win) => /** @type {any} */ (win).id === 'reaction-editor');
    if (app)
        await /** @type {any} */ (app).close({ submit: false });
}

// gated: ensure returning falsy aborts the start and skips the tour-done flag
const TOURS = [
    {
        id: 'config-tour',
        title: 'Lancer Automations: Configuration',
        description: 'Guided walkthrough of every tab in the Lancer Automations configuration window.',
        root: ROOT,
        steps: () => CONFIG_STEPS.filter(step => !(/** @type {any} */ (step).condition) || /** @type {any} */ (step).condition()),
        ensure: _ensureConfigOpen,
        gated: false,
        assign: (tour) => { _configTour = tour; },
        get: () => _configTour,
    },
    {
        id: 'activation-manager-tour',
        title: 'Lancer Automations: Activation Manager',
        description: 'Walks through the Activation Manager dialog (custom activations, defaults, startup scripts).',
        root: RM_ROOT,
        steps: () => ACTIVATION_MANAGER_STEPS,
        ensure: _ensureActivationManagerOpen,
        gated: false,
        assign: (tour) => { _activationTour = tour; },
        get: () => _activationTour,
    },
    {
        id: 'tah-tour',
        title: 'Lancer Automations: Token Action HUD',
        description: 'Walks through the Token Action HUD on a controlled token.',
        root: TAH_ROOT,
        steps: () => TAH_STEPS,
        ensure: _ensureTAHOpen,
        gated: true,
        cleanup: _restoreAfterTAH,
        assign: (tour) => { _tahTour = tour; },
        get: () => _tahTour,
    },
    {
        id: 'tah-advanced-tour',
        title: 'Lancer Automations: TAH Advanced Tools',
        description: 'The gameplay tools inside the Token Action HUD: skirmish/barrage, boost, deploy, contest, scan, link, reinforcement, downtime, reserve, vote.',
        root: TAH_ROOT,
        steps: () => ADV_TAH_STEPS,
        ensure: () => _ensureTAHOpen({ withCombat: false }),
        gated: true,
        cleanup: _restoreAfterTAH,
        assign: (tour) => { _advTahTour = tour; },
        get: () => _advTahTour,
    },
    {
        id: 'effect-manager-tour',
        title: 'Lancer Automations: Effect Manager',
        description: 'Walks through the Effect Manager dialog (standard, custom, bonus, manage).',
        root: EM_ROOT,
        steps: () => EFFECT_MANAGER_STEPS,
        ensure: _ensureEffectManagerOpen,
        gated: true,
        cleanup: _closeEffectManager,
        assign: (tour) => { _effectManagerTour = tour; },
        get: () => _effectManagerTour,
    },
    {
        id: 'ruler-tour',
        title: 'Lancer Automations: Lancer Ruler',
        description: 'The movement wheel, movement types, and the free/debug keys.',
        root: 'body',
        steps: () => RULER_STEPS,
        assign: (tour) => { _rulerTour = tour; },
        get: () => _rulerTour,
    },
    {
        id: 'advanced-measure-tour',
        title: 'Lancer Automations: Advanced Measure',
        description: 'The Advanced Measure tool: shapes, ranges, markers, and shortcuts.',
        root: AM_ROOT,
        steps: () => ADV_MEASURE_STEPS,
        ensure: _ensureAdvMeasureOpen,
        gated: true,
        cleanup: _closeAdvMeasure,
        assign: (tour) => { _advMeasureTour = tour; },
        get: () => _advMeasureTour,
    },
    {
        id: 'add-extra-tour',
        title: 'Lancer Automations: Add Extra',
        description: 'Add Extra, Add Effect and Extra Config from an actor or item sheet.',
        root: 'body',
        steps: () => AD_EXTRA_STEPS,
        ensure: _ensureAddExtraStart,
        gated: true,
        cleanup: _closeExtrasDialog,
        assign: (tour) => { _addExtraTour = tour; },
        get: () => _addExtraTour,
    },
];

async function startTour(id)
{
    const entry = TOURS.find((candidate) => candidate.id === id);
    const tour = entry?.get();
    if (tour && (await tour.start()) === false)
        return;
    try
    {
        await game.settings.set(NS, SETTING_TOUR_DONE, true);
    }
    catch
    { /* not ready */ }
}

export async function startConfigTour()
{
    return startTour('config-tour');
}

export async function startActivationManagerTour()
{
    return startTour('activation-manager-tour');
}

export async function startEffectManagerTour()
{
    return startTour('effect-manager-tour');
}

export async function startRulerTour()
{
    return startTour('ruler-tour');
}

export async function startAdvMeasureTour()
{
    return startTour('advanced-measure-tour');
}

export async function startAddExtraTour()
{
    return startTour('add-extra-tour');
}

// Welcome dialog (first install + menu button); resolves 'setup'|'tour'|'skip', Setup Wizard button GM-only.
function _welcomeDialog()
{
    const isGM = !!game.user?.isGM;
    const setupNote = isGM
        ? `<p style="margin: 8px 0 0;"><b>First time here?</b> Hit <b>Setup Wizard</b> to turn the module's main features on or off with a few plain yes/no questions, then take the tour.</p>`
        : '';
    return new Promise((resolve) =>
    {
        const buttons = {};
        if (isGM)
        {
            buttons.setup = {
                icon: '<i class="fas fa-wand-magic-sparkles"></i>',
                label: 'Setup Wizard',
                callback: () => resolve('setup'),
            };
        }
        buttons.start = {
            icon: '<i class="fas fa-play"></i>',
            label: 'Start Tour',
            callback: () => resolve('tour'),
        };
        buttons.skip = {
            icon: '<i class="fas fa-times"></i>',
            label: 'Skip',
            callback: () => resolve('skip'),
        };
        new Dialog({
            title: 'Lancer Automations',
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">WELCOME TO LANCER AUTOMATIONS</div>
                    <div class="lancer-dialog-subtitle">A module that went way bigger than I initially planned.</div>
                </div>
                <div style="padding: 8px 10px; line-height: 1.5;">
                    <p style="margin: 0 0 8px;">First of all, thanks for downloading.</p>
                    <p style="margin: 0 0 8px;">It's a very dense, powerful, big module. Its use is mainly for me, so the design is catered to what I like.</p>
                    <p style="margin: 0 0 8px;">Since it's a big module, here's a set of tours for the important stuff. They can run long, so take them one at a time and come back later.</p>
                    <p style="margin: 0 0 8px;">If you have any question or issue, head out to the <a href="https://discord.com/invite/lancer" target="_blank" rel="noopener">Lancer Discord</a>, or come talk to me directly on <a href="https://discord.com/channels/426286410496999425/1436087781666455642" target="_blank" rel="noopener">my channel</a>.</p>
                    <p style="margin: 0; opacity: 0.85;">Shout to the people tipping me on <a href="https://www.patreon.com/cw/LaSossis" target="_blank" rel="noopener">Patreon</a>.</p>
                    ${setupNote}
                    <p style="margin: 10px 0 0; padding: 6px 8px; border-left: 3px solid #ff6400; background: rgba(255,100,0,0.08);"><b>Last warning:</b> if you installed this without reading <a href="https://agraael.github.io/lancer-automations/" target="_blank" rel="noopener">the documentation</a>, please go read it. This is not a plug and play module, and you have to be serious about that.</p>
                </div>
                <p style="padding: 6px 10px 0; font-size: 0.85em; opacity: 0.7; border-top: 1px solid rgba(120,46,34,0.2); margin-top: 6px;">You can re-launch this tour later from <b>Configure Settings</b> &gt; <b>Module Settings</b> &gt; <b>Lancer Automations</b> &gt; <b>Tour</b>, or from Foundry's <b>Configure Tours</b> menu.</p>
            `,
            buttons,
            default: isGM ? 'setup' : 'start',
            close: () => resolve('skip'),
        }, { width: 600, classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
    });
}

function _movementWarningDialog()
{
    return new Promise((resolve) =>
    {
        new Dialog({
            title: 'Lancer Automations - Movement',
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">A WORD ON MOVEMENT</div>
                    <div class="lancer-dialog-subtitle">Please read this once.</div>
                </div>
                <div style="padding: 8px 10px; line-height: 1.5;">
                    <p style="margin: 0 0 8px;">Movement and the automation around it (Overwatch, Engagement, reactions on move, boost split, etc.) hooks into Foundry's v13 move pipeline. The multi step stacks (Boost &amp; Move, Overcharge &amp; Boost &amp; Move) advance on <code>onMove</code> / <code>onActivation</code>, which fire post commit, so each leg has settled before the next one runs.</p>
                    <p style="margin: 0 0 8px;">It's only medium stable though, so a few caveats:</p>
                    <ul style="margin: 0 0 8px 18px;">
                        <li>Be wary on <b>very vertical maps</b>: heavy climbing / hover / big elevation deltas can throw off the cost math, and the longer chains (3 leg Overcharge path) have the most surface to misbehave.</li>
                        <li>If a stack stalls or a leg lands wrong, fall back to <b>Ignore</b> on the choice card, or hold the <b>free movement</b> key for a single drag.</li>
                        <li>For purely measuring (no token follow, no cost), <b>Ctrl+drag</b> from any empty hex gives you the vanilla ruler.</li>
                    </ul>
                    <p style="margin: 0; opacity: 0.85;">Predictive / multi waypoint dragging is still beta. If you hit weirdness, splitting the move into two drags usually unblocks it.</p>
                </div>
            `,
            buttons: {
                ok: {
                    icon: '<i class="fas fa-check"></i>',
                    label: 'Got it',
                    callback: () => resolve(true),
                },
            },
            default: 'ok',
            close: () => resolve(true),
        }, { width: 600, classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
    });
}

async function _maybeShowMovementWarning()
{
    let shown = false;
    try
    {
        shown = !!game.settings.get(NS, SETTING_MOVEMENT_WARNING_SHOWN);
    }
    catch
    { /* not registered yet */ }
    if (shown)
        return;
    await _movementWarningDialog();
    try
    {
        await game.settings.set(NS, SETTING_MOVEMENT_WARNING_SHOWN, true);
    }
    catch
    { /* not ready */ }
}

// GMs get all four tours + ruler; players only get TAH + ruler (the rest show GM-only forms).
async function _runFullTour()
{
    if (!game.user.isGM)
    {
        if (_tahTour)
        {
            _tahTour.onComplete(async () =>
            {
                if (_rulerTour)
                {
                    _rulerTour.onComplete(async () =>
                    {
                        await startAdvMeasureTour();
                    });
                }
                await startRulerTour();
            });
        }
        await startTahTour();
        return;
    }
    await _ensureConfigOpen();
    if (!_configTour)
        return;
    _configTour.onComplete(async () =>
    {
        if (_activationTour)
        {
            _activationTour.onComplete(async () =>
            {
                if (_tahTour)
                {
                    _tahTour.onComplete(async () =>
                    {
                        if (_effectManagerTour)
                        {
                            _effectManagerTour.onComplete(async () =>
                            {
                                if (_rulerTour)
                                {
                                    _rulerTour.onComplete(async () =>
                                    {
                                        await startAdvMeasureTour();
                                    });
                                }
                                await startRulerTour();
                            });
                        }
                        await startEffectManagerTour();
                    });
                }
                await startTahTour();
            });
        }
        await startActivationManagerTour();
    });
    await _configTour.start();
}

async function _runChooser()
{
    const choice = await _welcomeDialog();
    if (choice === 'setup')
    {
        await maybeRunSettingsOnboarding();
        return _runChooser();
    }
    if (choice === 'tour')
        await _runFullTour();
    try
    {
        await game.settings.set(NS, SETTING_TOUR_DONE, true);
    }
    catch
    { /* not ready */ }
}

// Settings-menu button: shows the welcome chooser, no actual form.
class TourMenu extends FormApplication
{
    render()
    {
        _runChooser();
        return this;
    }
    async _updateObject()
    { /* no-op */ }
}

export function registerTourBootstrap()
{
    console.log('lancer-automations | registerTourBootstrap called');
    game.settings.register(NS, SETTING_TOUR_DONE, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });

    game.settings.register(NS, SETTING_MOVEMENT_WARNING_SHOWN, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });

    game.settings.registerMenu(NS, 'tourMenu', {
        name: 'Configuration Tour',
        label: 'Start Tour',
        hint: 'Guided walkthrough of the configuration window or the Activation Manager.',
        icon: 'fas fa-route',
        type: TourMenu,
        restricted: false,
    });

    const doRegister = () =>
    {
        console.log('lancer-automations | tour registration starting, Tour=', typeof Tour, 'game.tours=', !!game.tours);
        for (const entry of TOURS)
        {
            try
            {
                const tour = new _RootTour({
                    title: entry.title,
                    description: entry.description,
                    display: true,
                    canBeResumed: false,
                    steps: entry.steps(),
                }, entry.root);
                if (entry.ensure)
                {
                    const baseStart = tour.start.bind(tour);
                    tour.start = async () =>
                    {
                        const ready = await entry.ensure();
                        if (entry.gated && !ready)
                            return false;
                        await baseStart();
                        return true;
                    };
                }
                if (entry.cleanup)
                {
                    for (const method of ['exit', 'complete'])
                    {
                        const base = tour[method].bind(tour);
                        tour[method] = async () =>
                        {
                            try
                            {
                                await base();
                            }
                            finally
                            {
                                // no await on sync cleanups: keeps resolution timing identical to the old per-tour wrappers
                                const pending = entry.cleanup();
                                if (pending)
                                    await pending;
                            }
                        };
                    }
                }
                entry.assign(tour);
                game.tours.register(NS, entry.id, tour);
            }
            catch (e)
            {
                console.error(`lancer-automations | failed to register tour ${entry.id}`, e);
            }
        }
        console.log('lancer-automations | tours registered OK', game.tours.get(`${NS}.config-tour`), game.tours.get(`${NS}.activation-manager-tour`), game.tours.get(`${NS}.tah-tour`));
    };

    Hooks.once('setup', doRegister);

    Hooks.once('ready', async () =>
    {
        let done = true;
        try
        {
            done = !!game.settings.get(NS, SETTING_TOUR_DONE);
        }
        catch
        { /* not ready */ }
        if (!done)
            await _runChooser();
        await _maybeShowMovementWarning();
    });
}
