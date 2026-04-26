/* global Tour, game, ui, Dialog, Hooks, FormApplication, $, fetch */

const SETTING_TOUR_DONE = 'tourCompleted';
const NS = 'lancer-automations';
const ROOT = '#lancer-automations-config';
const RM_ROOT = '#reaction-manager-config';
const TAH_ROOT = '#la-hud';

const CONFIG_STEPS = [
    {
        id: 'shortcut',
        title: 'Where to find this',
        content: "Re-open this any time from the <b>Lancer Automations</b> button in the Game Settings sidebar, under the LANCER section.",
        selector: '#lancer-automations-overview',
        action: () => {
            /** @type {any} */ (ui).sidebar?.activateTab?.('settings');
        },
    },
    {
        id: 'welcome',
        title: 'Configuration',
        content: "Pretty simple, here's the configuration menu where all the Lancer Automations options live.",
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
        title: 'Statuses',
        content: "A bit like Lancer QoL: status visual effects plus extra statuses I added for the module. Won't play nice if Lancer QoL's status stuff is also on, so pick one or the other.",
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
        content: "My optional content packs (personal stuff), and one-shot maintenance buttons: LCP repair, reset, export, import.",
        selector: `${ROOT} .tab[data-tab="tools"]`,
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
        action: () => {
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
        content: "Clicking Add opens this. Triggers, filters, and the actual code blocks live here. Save commits, close discards.",
        selector: '#reaction-editor',
        action: async () => {
            if (document.querySelector('#reaction-editor'))
                return;
            const btn = document.querySelector(`${RM_ROOT} .tab[data-tab="custom"] .add-reaction`);
            if (btn instanceof HTMLElement)
                btn.click();
            for (let i = 0; i < 20; i++) {
                if (document.querySelector('#reaction-editor'))
                    break;
                await new Promise((r) => setTimeout(r, 50));
            }
        },
        cleanup: async () => {
            const app = Object.values(/** @type {any} */ (ui.windows)).find((w) => /** @type {any} */ (w).id === 'reaction-editor');
            if (app)
                await /** @type {any} */ (app).close({ submit: false });
        },
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

function _tahCategoryStep(label, content) {
    const cls = `la-hud-tour-cat-${label.toLowerCase().replace(/\s+/g, '')}`;
    return {
        id: `cat-${label.toLowerCase().replace(/\s+/g, '-')}`,
        title: label,
        content,
        selector: `${TAH_ROOT} .${cls}`,
        action: () => {
            document.querySelectorAll(`${TAH_ROOT} .${cls}`).forEach((el) => el.classList.remove(cls));
            const rows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            const target = rows.find((r) => r.textContent?.trim().toLowerCase().startsWith(label.toLowerCase()));
            target?.classList.add(cls);
        },
        cleanup: () => {
            document.querySelectorAll(`${TAH_ROOT} .${cls}`).forEach((el) => el.classList.remove(cls));
        },
    };
}

const TAH_STEPS = [
    {
        id: 'intro',
        title: 'Token Action HUD',
        content: 'This is Lancer automation Token Action HUD, is it not relted the module of the same name, this HUD  is standalone.',
        selector: TAH_ROOT,
    },
    {
        id: 'token-name',
        title: 'Token Name',
        content: 'Click the name to open the actor sheet. On the right the lock idon allow you to change the position of the HUD',
        selector: `${TAH_ROOT} .la-hud-token-name`,
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
        content: 'HP, heat, structure, stress, overshield and burn.',
        selector: '#la-hud-stats',
    },
    {
        id: 'movement',
        title: 'Movement Cap',
        content: 'Movement display: the right number is the max move allowed this turn (speed); the left number is what the token has consumed so far. Boost (or anything that grants extra move) extends movement cap.',
        selector: '#la-combat-bar',
    },
    {
        id: 'action-economy',
        title: 'Action Economy',
        content: 'Pips for Quick / Full / Reaction / Protocol / Free actions. These fucntion exactly  like the action reminder form the lancer system.',
        selector: '#la-combat-bar',
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
        content: "Any  item that is not a sub-category is an item row. Left  would usually activate the item, right click would open the detail sheet.",
        selector: `${TAH_ROOT} .la-hud-tour-item`,
        action: async () => {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-item`).forEach((el) => el.classList.remove('la-hud-tour-item'));
            // Open the first c1 category (Attacks). TAH wires either click or
            // mouseenter depending on the click-to-open setting; trigger both
            // through jQuery so its bound handlers actually fire.
            const c1Rows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            if (c1Rows[0]) {
                $(c1Rows[0]).trigger('mouseenter');
                $(c1Rows[0]).trigger('click');
            }
            for (let i = 0; i < 40; i++) {
                const allRows = document.querySelectorAll(`${TAH_ROOT} .la-hud-row`);
                if (allRows.length > c1Rows.length)
                    break;
                await new Promise((r) => setTimeout(r, 50));
            }
            const allRows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            const firstChild = allRows[c1Rows.length];
            firstChild?.classList.add('la-hud-tour-item');
        },
        cleanup: () => {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-item`).forEach((el) => el.classList.remove('la-hud-tour-item'));
            // Close any cascading columns (c2/c3/c4) opened by the action.
            const colLabels = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-col-label`));
            for (let i = 1; i < colLabels.length; i++) {
                const col = colLabels[i].parentElement;
                if (col instanceof HTMLElement)
                    col.style.display = 'none';
            }
        },
    },
    _tahCategoryStep('Attacks', "Skirmish, Barrage and basic attacks."),
    _tahCategoryStep('Weapons', "Your equipped weapons by mount."),
    _tahCategoryStep('Tech', "Tech actions and tech-tagged systems."),
    _tahCategoryStep('Actions', "Every other action your token can take, sorted by Quick / Full / Reaction / Protocol / Free. Most common actions are under Basic"),
    _tahCategoryStep('Deployables', "Whatever your loadout deploys."),
    _tahCategoryStep('Systems', "Mech systems"),
    _tahCategoryStep('Class', "Frame info, traits, core power, talents."),
    {
        id: 'utility',
        title: 'Utility',
        content: "Utility groups the secondary stuff.",
        selector: `${TAH_ROOT} .la-hud-tour-utility`,
        action: () => {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-utility`).forEach((el) => el.classList.remove('la-hud-tour-utility'));
            const rows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            const utilityRow = rows.find((r) => r.textContent?.trim().toLowerCase().startsWith('utility'));
            utilityRow?.classList.add('la-hud-tour-utility');
        },
        cleanup: () => {
            document.querySelectorAll(`${TAH_ROOT} .la-hud-tour-utility`).forEach((el) => el.classList.remove('la-hud-tour-utility'));
        },
    },
    _tahCategoryStep('Statuses', "Status effects on the token."),
];

let _tahPrevControlled = [];
let _tahDemoToken = null;
let _tahDemoAddedToCombat = false;
let _tahCreatedCombat = false;

function _waitForTokenDialog() {
    return new Promise((resolve) => {
        new Dialog({
            title: 'Lancer Automations',
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">PLACE A TOKEN</div>
                    <div class="lancer-dialog-subtitle">The TAH tour needs a token to bind to.</div>
                </div>
                <p style="padding: 4px 6px;">Drag any actor (mech, pilot, NPC) onto the current scene, then click Continue.</p>
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

function _findUsableToken() {
    return canvas.tokens.controlled[0]
        ?? canvas.tokens.placeables.find((t) => t.actor && !t.document.hidden);
}

async function _ensureTAHOpen() {
    if (document.querySelector(TAH_ROOT))
        return true;

    if (!game.settings.get(NS, 'tahEnabled')) {
        ui.notifications.warn('Token Action HUD is disabled. Enable it in module configuration first.');
        return false;
    }

    _tahPrevControlled = canvas.tokens.controlled.slice();

    let target = _findUsableToken();
    while (!target) {
        const proceed = await _waitForTokenDialog();
        if (!proceed) {
            _tahPrevControlled = [];
            return false;
        }
        target = _findUsableToken();
    }

    target.control({ releaseOthers: true });
    _tahDemoToken = target;

    // Combat must exist, the token must be a combatant, AND the combat must
    // be started for the combat-bar (action economy, movement) to render.
    if (!game.combat) {
        const combat = await Combat.create({ scene: canvas.scene.id, active: true });
        if (combat)
            _tahCreatedCombat = true;
    }
    if (!target.inCombat) {
        await /** @type {any} */ (target.document).toggleCombatant?.(true);
        _tahDemoAddedToCombat = true;
    }
    if (game.combat && !game.combat.started) {
        try {
            await game.combat.startCombat();
        } catch { /* ignore */ }
    }

    for (let i = 0; i < 30; i++) {
        if (document.querySelector(TAH_ROOT))
            break;
        await new Promise((r) => setTimeout(r, 50));
    }
    for (let i = 0; i < 40; i++) {
        if (document.querySelector('#la-combat-bar'))
            break;
        await new Promise((r) => setTimeout(r, 50));
    }
    return true;
}

async function _restoreAfterTAH() {
    try {
        if (_tahDemoToken && _tahDemoAddedToCombat)
            await /** @type {any} */ (_tahDemoToken.document).toggleCombatant?.(false);
    } catch { /* ignore */ }
    try {
        if (_tahCreatedCombat && game.combat)
            await game.combat.delete();
    } catch { /* ignore */ }
    try {
        _tahDemoToken?.release();
    } catch { /* ignore */ }
    for (const t of _tahPrevControlled) {
        try {
            t.control({ releaseOthers: false });
        } catch { /* ignore */ }
    }
    _tahPrevControlled = [];
    _tahDemoToken = null;
    _tahDemoAddedToCombat = false;
    _tahCreatedCombat = false;
}

let _tahTour;

export async function startTahTour() {
    if (!(await _ensureTAHOpen()))
        return;
    if (_tahTour)
        await /** @type {any} */ (_tahTour).start();
    try {
        await game.settings.set(NS, SETTING_TOUR_DONE, true);
    } catch { /* not ready */ }
}

class _RootTour extends Tour {
    constructor(config, root) {
        super(config);
        this._root = root;
        this._onCompleteHook = null;
    }
    async _preStep() {
        await super._preStep();
        const step = /** @type {any} */ (this.currentStep);
        if (step?.tab) {
            const tab = document.querySelector(`${this._root} nav.sheet-tabs a[data-tab="${step.tab}"]`);
            if (tab instanceof HTMLElement)
                tab.click();
        }
        if (typeof step?.action === 'function') {
            try {
                await step.action();
            } catch (e) {
                console.warn('lancer-automations | tour step action failed', e);
            }
        }
    }
    async _postStep() {
        const step = /** @type {any} */ (this.currentStep);
        if (typeof step?.cleanup === 'function') {
            try {
                await step.cleanup();
            } catch (e) {
                console.warn('lancer-automations | tour step cleanup failed', e);
            }
        }
        await super._postStep();
    }
    /** @param {() => Promise<void> | void} fn */
    onComplete(fn) {
        this._onCompleteHook = fn;
    }
    async complete() {
        const fn = this._onCompleteHook;
        this._onCompleteHook = null;
        await super.complete();
        if (fn)
            await fn();
    }
    async exit() {
        this._onCompleteHook = null;
        await super.exit();
    }
}

let _configTour;
let _activationTour;

function _ensureConfigOpen() {
    const open = Object.values(/** @type {any} */ (ui.windows)).find((w) => /** @type {any} */ (w).id === 'lancer-automations-config');
    if (open)
        return Promise.resolve();
    return import('./settingsMenus.js').then(({ LancerAutomationsConfig }) => {
        new LancerAutomationsConfig().render(true);
        return new Promise((r) => setTimeout(r, 200));
    });
}

function _ensureActivationManagerOpen() {
    const open = Object.values(/** @type {any} */ (ui.windows)).find((w) => /** @type {any} */ (w).id === 'reaction-manager-config');
    if (open)
        return Promise.resolve();
    return import('./reaction-manager.js').then(({ ReactionConfig }) => {
        new ReactionConfig().render(true);
        return new Promise((r) => setTimeout(r, 200));
    });
}

export async function startConfigTour() {
    await _ensureConfigOpen();
    if (_configTour)
        await _configTour.start();
    try {
        await game.settings.set(NS, SETTING_TOUR_DONE, true);
    } catch { /* not ready */ }
}

export async function startActivationManagerTour() {
    await _ensureActivationManagerOpen();
    if (_activationTour)
        await _activationTour.start();
    try {
        await game.settings.set(NS, SETTING_TOUR_DONE, true);
    } catch { /* not ready */ }
}

// Lancer-styled welcome shown on first install and from the menu button.
function _welcomeDialog() {
    return new Promise((resolve) => {
        new Dialog({
            title: 'Lancer Automations',
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">WELCOME TO LANCER AUTOMATIONS</div>
                    <div class="lancer-dialog-subtitle">A module that went way bigger than I initially planned.</div>
                </div>
                <div style="padding: 8px 10px; line-height: 1.5;">
                    <p style="margin: 0 0 8px;">First of all, thanks for downloading.</p>
                    <p style="margin: 0 0 8px;">This module does a lot of stuff. Its use is mainly for me, so the design is catered to what I like.</p>
                    <p style="margin: 0 0 8px;">I hope you read the <a href="https://github.com/Agraael/lancer-automations#readme" target="_blank" rel="noopener"><b>README</b> on GitHub</a> a bit. If not, you should.</p>
                    <p style="margin: 0 0 8px;">Since it's a big module, here's a little tour to show the most important stuff.</p>
                    <p style="margin: 0 0 8px;">If you have any question or issue, head out to the <a href="https://discord.com/invite/lancer" target="_blank" rel="noopener">Lancer Discord</a>.</p>
                    <p style="margin: 0; opacity: 0.85;">Shout to the 2 people tipping me on <a href="https://www.patreon.com/cw/LaSossis" target="_blank" rel="noopener">Patreon</a>, it's not needed but it's nice.</p>
                </div>
                <p style="padding: 6px 10px 0; font-size: 0.85em; opacity: 0.7; border-top: 1px solid rgba(120,46,34,0.2); margin-top: 6px;">You can re-launch this tour later from <b>Configure Settings</b> &gt; <b>Module Settings</b> &gt; <b>Lancer Automations</b> &gt; <b>Tour</b>, or from Foundry's <b>Configure Tours</b> menu.</p>
            `,
            buttons: {
                start: {
                    icon: '<i class="fas fa-play"></i>',
                    label: 'Start Tour',
                    callback: () => resolve(true),
                },
                skip: {
                    icon: '<i class="fas fa-times"></i>',
                    label: 'Skip',
                    callback: () => resolve(false),
                },
            },
            default: 'start',
            close: () => resolve(false),
        }, { width: 600, classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
    });
}

// Run all three tours back to back: configuration, activation manager, TAH.
async function _runFullTour() {
    await _ensureConfigOpen();
    if (!_configTour)
        return;
    _configTour.onComplete(async () => {
        if (_activationTour)
            _activationTour.onComplete(async () => {
                await startTahTour();
            });
        await startActivationManagerTour();
    });
    await _configTour.start();
}

async function _runChooser() {
    const take = await _welcomeDialog();
    if (take) {
        await _runFullTour();
    }
    try {
        await game.settings.set(NS, SETTING_TOUR_DONE, true);
    } catch { /* not ready */ }
}

// Settings-menu button: shows the welcome chooser, no actual form.
class TourMenu extends FormApplication {
    render() {
        _runChooser();
        return this;
    }
    async _updateObject() { /* no-op */ }
}

export function registerTourBootstrap() {
    console.log('lancer-automations | registerTourBootstrap called');
    game.settings.register(NS, SETTING_TOUR_DONE, {
        scope: 'world',
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

    const doRegister = () => {
        console.log('lancer-automations | tour registration starting, Tour=', typeof Tour, 'game.tours=', !!game.tours);
        try {
            _configTour = new _RootTour({
                title: 'Lancer Automations: Configuration',
                description: 'Guided walkthrough of every tab in the Lancer Automations configuration window.',
                display: true,
                canBeResumed: false,
                steps: CONFIG_STEPS,
            }, ROOT);
            _activationTour = new _RootTour({
                title: 'Lancer Automations: Activation Manager',
                description: 'Walks through the Activation Manager dialog (custom activations, defaults, startup scripts).',
                display: true,
                canBeResumed: false,
                steps: ACTIVATION_MANAGER_STEPS,
            }, RM_ROOT);
            _tahTour = new _RootTour({
                title: 'Lancer Automations: Token Action HUD',
                description: 'Walks through the Token Action HUD on a controlled token.',
                display: true,
                canBeResumed: false,
                steps: TAH_STEPS,
            }, TAH_ROOT);
            const cfgStart = _configTour.start.bind(_configTour);
            _configTour.start = async () => {
                await _ensureConfigOpen();
                await cfgStart();
            };
            const amStart = _activationTour.start.bind(_activationTour);
            _activationTour.start = async () => {
                await _ensureActivationManagerOpen();
                await amStart();
            };
            const tahStart = _tahTour.start.bind(_tahTour);
            _tahTour.start = async () => {
                if (!(await _ensureTAHOpen()))
                    return;
                await tahStart();
            };
            const tahExit = _tahTour.exit.bind(_tahTour);
            _tahTour.exit = async () => {
                try {
                    await tahExit();
                } finally {
                    await _restoreAfterTAH();
                }
            };
            const tahComplete = _tahTour.complete.bind(_tahTour);
            _tahTour.complete = async () => {
                try {
                    await tahComplete();
                } finally {
                    await _restoreAfterTAH();
                }
            };
            game.tours.register(NS, 'config-tour', _configTour);
            game.tours.register(NS, 'activation-manager-tour', _activationTour);
            game.tours.register(NS, 'tah-tour', _tahTour);
            console.log('lancer-automations | tours registered OK', game.tours.get(`${NS}.config-tour`), game.tours.get(`${NS}.activation-manager-tour`), game.tours.get(`${NS}.tah-tour`));
        } catch (e) {
            console.error('lancer-automations | failed to register tours', e);
        }
    };

    Hooks.once('setup', doRegister);

    Hooks.once('ready', async () => {
        if (!game.user.isGM)
            return;
        let done = true;
        try {
            done = !!game.settings.get(NS, SETTING_TOUR_DONE);
        } catch { /* not ready */ }
        if (done)
            return;
        _pingNewInstallCounter();
        await _runChooser();
    });
}

// Anonymous install counter, fired once on first-run.
function _pingNewInstallCounter() {
    fetch('https://api.counterapi.dev/v2/cedric-cescuttis-team-3920/first-counter-3920/up')
        .catch(() => { /* offline / blocked, ignore */ });
}
