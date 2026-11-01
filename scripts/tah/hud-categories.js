import { laRenderWeaponBody, laRenderModBody, laRenderCoreBonusBody, laRenderCoreSystemBody, laFormatDetailHtml, laRenderActionDetail, laRenderActions, laPopupSectionLabel, laRenderDeployables, laRenderTags, laDetailPopup, stripDeployOwner } from '../interactive/detail-renderers.js';
import { weaponSkirmishable, executeSkirmish, executeBarrage, executeFight, executeImprovisedAttack, executeSimpleActivation, executeItemActivation, executeProfileSwitch, executeBasicAttack, executeDamageRoll, executeTechAttack, executeInvade, executeExtraActionCombat, executeReactorMeltdown, executeReactorExplosion, executeFall, executeStandingUp, executeTeleport, getActorActionItems, coreGrantedActions, coreActivationAction, hasReactionAvailable, getWeaponProfiles_WithBonus, getActorMaxThreat } from '../tools/misc-tools.js';
import { FREQ_SPECS, rankSubKey, traitSubKey, getSubUsed, actionSubKey, actionWithFrequency, actorActionSubKey } from '../combat/per-frequency-tags.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag, setLAFlag, getLAFlags } from '../tools/flag-utils.js';
import { corePowerState, resolvePilot, shortOverchargeTerm, rankParts } from '../utils/lancer-token.js';
import { MODULE_ID, BOOST_DETAIL } from '../tools/constants.js';
import { openThrowMenu, clearMovementHistory, revertMovement, openChoiceMenu } from '../interactive/combat.js';
import { pickupWeaponToken, openDeployableMenu, recallDeployable, getItemDeployables, getActorDeployables, deployDeployable, reloadOneWeapon, resolveDeployable, getDeployableInfoSync, endItemActivation, promptLinkOrUnlinkActor, consumeExtraAction, linkTierGate, gateActions, resolveGrant, resolveDeployRangeCount, isPrimaryActionHidden } from '../interactive/deployables.js';
import { applyActionOverlays } from '../interactive/action-overlays.js';
import { openExtrasDialog } from '../interactive/extras-dialog.js';
import { openClocksDialog, pilotHasBond, getCounters, setCounterValue, deleteCounter } from '../tools/pilot-clocks.js';
import { TriggerUseAmmoFlow } from '../setup/lancer-modif.js';
import { knockBackToken } from '../interactive/tools/moveTokenRuler.js';
import { openHaseContestCard } from '../interactive/tools/haseContest.js';
import { openForceCheckCard } from '../interactive/tools/forceCheck.js';
import { getEnvironmentActor } from '../tools/template-actors.js';
import { delayedTokenAppearance } from '../combat/reinforcement.js';
import { isActionDisabledByStatus, getActionLockInfo, getStatusLockedFields, getFieldLockingStatuses, lockEntryLabel } from '../combat/action-limits.js';
import { weaponSizeLevel, weaponTypeIcon, isWhiteIcon, getActivationIcon, getDeployableIcon, laHudItemChildren, getItemStatus, statusKindOf, activationTheme, appendReservePips, appendBondPowerPips, rechargeIcon, actionDisplayName } from './item-helpers.js';
import { isAutoConsumeDisabled, renderConsumeStatusHtml } from '../interactive/extra-config.js';
import * as altFlags from '../integrations/alt-sheets-flags.js';
import {
    isAdvancedMeasureActive,
    getAdvancedMeasureState,
    setAdvancedMeasureState,
    openAdvancedMeasureWithState,
    toggleRangePin,
    hasRangePin,
} from '../interactive/tools/advancedMeasure.js';
import { getActorMaxReach_WithBonus, getSensorRange_WithBonus } from '../tools/weapon-bonus-utils.js';
import { isLancerRulerActive } from '../movement/cost-rules.js';
import { resurrect } from '../tools/wreck.js';
import { noteRowIcon } from './action-tape.js';
import { toggleDetailPopup, withV3Chips, v3ActionPath } from './hud-popups.js';
import { playUiSound } from './sound.js';
import { executeGenerateScan } from '../tools/scan.js';
import { _resolveExtraBarValues, updateExtraBarValue } from './tokenStatBar.js';
import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';
import { cancelButton } from '../tools/dialog-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { corePowerOn, corePowerOff } from '../fx/statusFX.js';

const UTILITY_TOOLS = {
    effectManager: { name: 'Effect Manager', labelKey: 'LA.tokenHud.label.effectManager', detailKey: 'LA.tokenHud.detail.effectManager', icon: 'mdi mdi-cogs', run: (api) => (api?.executeEffectManager ? api.executeEffectManager() : /** @type {any} */ (ui.notifications).error('Lancer Automations API not found or outdated.')) },
    vote: { name: 'Vote', labelKey: 'LA.tokenHud.label.vote', detailKey: 'LA.tokenHud.detail.vote', icon: 'mdi mdi-vote', run: () => openChoiceMenu() },
    downtime: { name: 'Downtime', labelKey: 'LA.tokenHud.label.downtime', detailKey: 'LA.tokenHud.detail.downtime', icon: 'systems/lancer/assets/icons/white/downtime.svg', run: (api) => api?.executeDowntime?.() },
    reserve: { name: 'Reserve', labelKey: 'LA.tokenHud.label.reserve', detailKey: 'LA.tokenHud.detail.reserve', icon: 'systems/lancer/assets/icons/white/reserve_mech.svg', run: (api, target) => api?.openAddReserveDialog?.(target) },
    clocksBurdens: { name: 'Clocks & Burdens', labelKey: 'LA.tokenHud.label.clocksBurdens', detailKey: 'LA.tokenHud.detail.clocksBurdens', icon: 'mdi mdi-clock-outline', run: (_api, target) => openClocksDialog(target) },
    rest: { name: 'Rest', labelKey: 'LA.tokenHud.label.rest', detail: 'Open the rest dialog: spend repairs, clear heat and conditions.', icon: 'modules/lancer-automations/icons/night-sleep.svg', run: (api, target) => api?.executeRest?.(target) },
};

const ICON_TECH_QUICK = 'systems/lancer/assets/icons/tech_quick.svg';

const TOOL_ROWS = {
    basicAttack: { name: 'Basic Attack', labelKey: 'LA.tokenHud.label.basicAttack', icon: 'mdi mdi-target', detail: 'Tool: roll a bare attack against one target.' },
    basicTech: { name: 'Basic Tech', labelKey: 'LA.tokenHud.label.basicTech', icon: ICON_TECH_QUICK, techAttack: true, detail: 'Tool: roll a bare TECH ATTACK against one target\'s E-DEFENSE. No effect applied.' },
    damage: { name: 'Damage', labelKey: 'LA.tokenHud.label.damage', icon: 'mdi mdi-flare', detail: 'Tool: apply arbitrary damage to your target(s).' },
    contest: { name: 'Contest', labelKey: 'LA.tokenHud.label.contest', icon: 'mdi mdi-ab-testing', detailKey: 'LA.tokenHud.detail.contest' },
    forceCheck: { name: 'Force Check', labelKey: 'LA.tokenHud.label.forceCheck', icon: 'mdi mdi-alert-circle-check-outline', detailKey: 'LA.tokenHud.detail.forceCheck' },
};

/** Build compact tag string for ammo allowed types/sizes (only shows restrictions). */
function _ammoTagsHtml(checklist)
{
    if (!checklist)
        return '';
    const entries = Object.entries(checklist);
    const enabled = entries.filter(([, v]) => v).map(([k]) => k);
    if (enabled.length === 0 || enabled.length === entries.length)
        return '';
    return ` · ${enabled.join(', ')}`;
}

const ACTIVATION_TAGS = ['tg_quick_action', 'tg_full_action', 'tg_protocol', 'tg_reaction', 'tg_free_action'];

const WEAPON_ATTACK_ACTION ={ SKIRMISH: ['Skirmish', 'Quick'], BARRAGE: ['Barrage', 'Full'], FIGHT: ['Fight', 'Full'] };

// "LL7" for pilots and their mechs, "T2" for NPCs. Same text the stat hint shows.
export function rankText(actor)
{
    const parts = rankParts(actor);
    return parts ? `${parts.kind}${parts.value}` : null;
}

// Green rank suffix appended to a HUD row label.
function rankSuffix(actor)
{
    const text = rankText(actor);
    return text ? ` <span class="la-hud-rank">${text}</span>` : '';
}

function extraDotLabel(name)
{
    return `<span style="color:#e8a030;font-size:0.7em;vertical-align:middle;">●</span> ${escapeHtml(name)}`;
}

function coreBatteryBadge(charged)
{
    return `<i class="mdi ${charged ? 'mdi-battery is-ready' : 'mdi-battery-off is-off'}"></i>`;
}

function genericFavKey(name)
{
    return `generic:${String(name ?? '').toLowerCase().trim()}`;
}

/**
 * Item / Category data builders
 *
 * Category shape: { label, colLabel, icon?, getItems: () => Item[] }
 * Item shape:     { label, childColLabel?, getChildren?: () => Item[], onClick?: () => void, onRightClick?: (rowEl) => void }
 */
export class HudCategories
{
    constructor(hud)
    {
        this._hud = hud;
        this._pendingBlockReason = null;
    }

    get _actor()
    {
        return this._hud._actor;
    }

    get _token()
    {
        return this._hud._token;
    }

    get _tokens()
    {
        return this._hud._tokens;
    }

    get _narrativeMode()
    {
        return this._hud._narrativeMode;
    }

    scheduleRefresh(delay)
    {
        return this._hud.scheduleRefresh(delay);
    }

    _depthCallbacks()
    {
        return this._hud._depthCallbacks();
    }

    _writeInPlace(write)
    {
        return this._hud._writeInPlace(write);
    }

    _showPopupAt(popup, anchorEl)
    {
        return this._hud._showPopupAt(popup, anchorEl);
    }

    // Item-building helpers

    /** Returns a status-kind marker for destroyed/cascading/unavailable items. The renderer maps it to a striped style. */
    _statusColors(/** @type {any} */ status)
    {
        return {
            statusKind: statusKindOf(status),
        };
    }

    _applyGate(/** @type {any} */ row, /** @type {any} */ action)
    {
        if (action?._gate === 'disabled')
            row.statusKind = 'unavailable';
        else if (action?._gate === 'locked')
            row.softDisabled = true;
        return row;
    }

    // Shared row: destroyed-strike label + getItemStatus badge + _statusColors stripe; badge/badgeTone/statusKind overridable. Extra opts (onClick/onRightClick/getChildren/…) pass through.
    _itemRow(/** @type {any} */ item, /** @type {any} */ opts = {})
    {
        const { label, icon = null, action = null, category, badge, badgeTone, statusKind, hoverExtra, ...rest } = opts;
        const status = getItemStatus(item, action ?? undefined);
        const base = label ?? item?.name;
        let labelHtml;
        if (status.destroyed)
            labelHtml = this._destroyedLabel(base);
        else if (status.cascading)
            labelHtml = this._cascadingLabel(base);
        return {
            ...rest,
            label: base,
            labelHtml,
            icon,
            badge: badge !== undefined ? badge : (status.badge ?? null),
            badgeTone: badgeTone !== undefined ? badgeTone : (status.badgeTone ?? null),
            statusKind: statusKind !== undefined ? statusKind : this._statusColors(status).statusKind,
            hoverData: { actor: this._actor, item, action, category, ...(hoverExtra ?? {}) },
        };
    }

    /** Builds the standard effect + description + tags HTML for a system/item detail popup body. */
    _bodyHtml(/** @type {any} */ sys)
    {
        const text = sys?.effect || sys?.description || '';
        const effect = text ? `<div class="la-popup-effect" style="font-size:0.82em;color:#bbb;line-height:1.4;margin-bottom:4px;">${laFormatDetailHtml(text)}</div>` : '';
        return laRenderTags(sys?.tags ?? []) + effect;
    }

    /** Factory for executeSimpleActivation rows. Wires onClick / broadcast / right-click popup. */
    _simpleItem(label, icon, action, detail)
    {
        const counted = actionWithFrequency(action);
        const status = counted.frequency ? getItemStatus(counted, null, { holder: this._actor }) : null;
        return this._lockable({
            label,
            icon,
            ...(status ? { badge: status.badge, badgeTone: status.badgeTone, ...this._statusColors(status) } : {}),
            onClick:      () => executeSimpleActivation(this._actor, { title: action.name, action, detail }),
            broadcastFn:  (_t, a) => executeSimpleActivation(a, { title: action.name, action, detail }),
            onRightClick: this._actionPopup({ ...counted, detail }),
        }, action.name, action.activation);
    }

    _lockCat(row, field)
    {
        if (!getStatusLockedFields(this._actor).has(field))
            return row;
        row.statusKind = 'unavailable';
        const markChildren = (items) => (items ?? []).map(child =>
        {
            if (child?.isSectionLabel)
                return child;
            const marked = { ...child };
            if (!marked.statusKind)
                marked.statusKind = 'unavailable';
            if (child.getChildren)
                marked.getChildren = () => markChildren(child.getChildren());
            return marked;
        });
        const origChildren = row.getChildren;
        if (origChildren)
            row.getChildren = () => markChildren(origChildren());
        return row;
    }

    _lockRows(rows, field)
    {
        return rows.map(row => (row.isSectionLabel ? row : this._lockCat(row, field)));
    }

    _lockable(item, actionName, activation = null)
    {
        noteRowIcon(actionName, item.icon);
        if (activation && !item.spendActivation)
            item.spendActivation = activation;
        if (actionName && !item.favKey && !item.stableKey && !item.hoverData?.item)
            item.stableKey = genericFavKey(actionName);
        const origClick = item.onClick;
        const origBroadcast = item.broadcastFn;
        const info = getActionLockInfo(this._actor, actionName, activation);
        const byStatus = isActionDisabledByStatus(this._actor, actionName);
        const disabledKind = [...info.itemLocks, ...info.sources].some(entry => (entry?.kind ?? null) === 'disabled');
        if (byStatus || disabledKind)
            item.statusKind = 'unavailable';
        else if (info.itemLocks.length || info.sources.length)
            item.softDisabled = true;
        item.onClick = () =>
        {
            const now = getActionLockInfo(this._actor, actionName, activation);
            if (isActionDisabledByStatus(this._actor, actionName) || now.itemLocks.length || now.sources.length)
                ui.notifications.warn(localizeFormat('LA.notify.actionLockedFiringAnyway', { action: actionName, name: this._actor.name }));
            return origClick?.();
        };
        if (origBroadcast)
            item.broadcastFn = origBroadcast;
        return item;
    }

    _lockableAttack(actionRow, weaponName)
    {
        const [name, activation] = WEAPON_ATTACK_ACTION[actionRow.label] ?? [];
        return this._lockable(name ? this._lockable(actionRow, name, activation) : actionRow, weaponName);
    }

    _pilotHasTokenOnScene()
    {
        const pilot = resolvePilot(this._actor);
        return !!pilot && (pilot.getActiveTokens?.() ?? []).length > 0;
    }

    // Grey-stripe a row and block its click when a precondition is not met.
    // Reason is recorded by label so the detail popup can surface it.
    _blockIf(item, blocked, reason)
    {
        if (!blocked)
            return item;
        item.softDisabled = true;
        item.onClick = () => ui.notifications.warn(reason);
        item.broadcastFn = undefined;
        const origRightClick = item.onRightClick;
        item.onRightClick = (row) =>
        {
            this._pendingBlockReason = reason;
            try
            {
                return origRightClick?.(row);
            }
            finally
            {
                this._pendingBlockReason = null;
            }
        };
        return item;
    }

    _pendingBlockHtml()
    {
        const reason = this._pendingBlockReason;
        return reason ? `<p class="la-hud-action-locked-reason" style="margin:0 0 6px 0;padding:4px 6px;background:rgba(160,119,68,0.18);border-left:3px solid #a07744;font-size:0.85em;color:#e0c8a0;"><strong>Blocked:</strong> ${reason}</p>` : '';
    }

    // Category / item builders

    // Category list (order = HUD order)
    _buildCategories()
    {
        if (this._narrativeMode)
        {
            const linked = !!this._actor;
            const isNarrativeNpc = this._actor?.type === 'npc';
            return [
                this._catNarrativeEnvironment(),
                ...(linked ? [isNarrativeNpc ? this._catNpcFrame() : this._catPilot()] : []),
                ...(linked ? [this._catSkills()] : []),
                ...(linked ? [this._catResources()] : []),
                this._catNarrativeUtility(linked),
                this._catMacros(),
            ];
        }
        const types        = this._tokens.map(token => token.actor?.type);
        const isMech       = types.every(type => type === 'mech');
        const isDeployable = types.every(type => type === 'deployable');
        const isPilot      = types.every(type => type === 'pilot');
        const isNpc        = types.every(type => type === 'npc');
        return [
            this._catActions(),
            ...(isDeployable ? [] : [this._catWeapons()]),
            ...(this._actor?.type === 'mech' || this._actor?.type === 'npc' ? [] : [this._catTech()]),
            ...((isDeployable || isPilot) && this._deployableRows(this._actor).length === 0 ? [] : [this._catDeployables()]),
            ...(isDeployable ? [] : [this._catResources()]),
            ...(isMech ? [this._catSystems()] : isNpc ? [this._catNpcSystems()] : isPilot ? [this._catPilotGear()] : []),
            ...(isMech ? [this._catFrame()]   : isNpc ? [this._catNpcFrame()]   : isPilot ? [this._catPilot()] : []),
            ...(isMech ? [this._catTalents()] : []),
            this._catSkills(),
            this._catUtility(),
            this._catStatuses(),
            this._catMacros(),
        ];
    }

    _catActions()
    {
        const actor        = this._actor;
        const isDeployable = actor.type === 'deployable';

        if (isDeployable)
            return this._catActionsDeployable(actor);
        if (actor.type === 'pilot')
            return this._catActionsPilot(actor);

        return {
            label: localize('LA.tokenHud.label.actions'),
            colLabel: localize('LA.tokenHud.label.actions'),
            icon: 'mdi mdi-hexagon-outline',
            noCount: true,
            getItems: () => [
                {
                    label: 'Basic',
                    text: localize('LA.tokenHud.label.basic'),
                    icon: 'mdi mdi-hexagon-outline',
                    childColLabel: localize(actor.type === 'mech' ? 'LA.tokenHud.col.action' : 'LA.tokenHud.label.quick'),
                    getChildren: () => [
                        ...(actor.type === 'mech' ? [
                            this._lockable({ label: localize('LA.tokenHud.label.overcharge'), icon: 'systems/lancer/assets/icons/overcharge.svg', onClick: () => /** @type {any} */ (actor.beginOverchargeFlow()), broadcastFn: (_t, a) => /** @type {any} */ (a).beginOverchargeFlow(), onRightClick: this._actionPopup({ name: 'Overcharge', activation: 'Free', detail: 'Once per turn, you can OVERCHARGE your mech, allowing you to make any quick action as a free action, even actions you have already taken this turn.\n\nThe first time you OVERCHARGE, take 1 heat.\nThe second time, take 1d3 heat.\nThe third time, take 1d6 heat.\nEach time after, take 1d6+4 heat.\n\nA FULL REPAIR resets this counter.' }) }, 'Overcharge'),
                            { isSectionLabel: true, label: localize('LA.tokenHud.label.quick') },
                        ] : []),
                        ...this._lockRows(this._basicQuickRows(), 'quick'),
                        { isSectionLabel: true, label: localize('LA.tokenHud.label.full') },
                        ...this._lockRows(this._basicFullRows(), 'full'),
                    ],
                },
                { label: localize('LA.tokenHud.label.attacks'), childColLabel: localize('LA.tokenHud.label.attacks'), icon: 'systems/lancer/assets/icons/role_striker.svg', getChildren: () => this._catAttacks().getItems() },
                {
                    label: localize('LA.tokenHud.label.invades'),
                    childColLabel: localize('LA.tokenHud.label.invades'),
                    icon: getActivationIcon('Invade'),
                    keepPlace: true,
                    getChildren: () => [
                        { isSectionLabel: true, label: localize('LA.tokenHud.label.quickTech') },
                        this._techBasicRows().invade,
                        { isSectionLabel: true, label: localize('LA.tokenHud.label.invades') },
                        ...this._catInvades().getItems(),
                    ],
                },
                this._lockCat({
                    label: localize('LA.tokenHud.label.quickActions'),
                    childColLabel: localize('LA.tokenHud.label.quickActions'),
                    icon: getActivationIcon('Quick'),
                    keepPlace: true,
                    getChildren: () =>
                    {
                        const tech = this._techBasicRows();
                        return this._withDeployRows([
                            ...this._getActionsByActivation(actor, 'Quick', 'Actions'),
                            { isSectionLabel: true, label: localize('LA.tokenHud.label.quickTech') },
                            ...(actor.type === 'npc' ? [] : [tech.scan]),
                            tech.lockOn,
                            tech.bolster,
                            ...this._getActionsByActivation(actor, 'Quick Tech', 'Tech'),
                        ], actor, ['Quick', 'Quick Tech']);
                    },
                }, 'quick'),
                this._lockCat({
                    label: localize('LA.tokenHud.label.fullActions'),
                    childColLabel: localize('LA.tokenHud.label.fullActions'),
                    icon: getActivationIcon('Full'),
                    keepPlace: true,
                    getChildren: () => this._withDeployRows([
                        ...this._getActionsByActivation(actor, 'Full', 'Actions'),
                        { isSectionLabel: true, label: localize('LA.tokenHud.label.fullTech') },
                        ...this._getActionsByActivation(actor, 'Full Tech', 'Tech'),
                    ], actor, ['Full', 'Full Tech']),
                }, 'full'),
                this._lockCat({ label: localize('LA.actionEconomy.reaction'),      childColLabel: localize('LA.actionEconomy.reaction'), icon: getActivationIcon('Reaction'), keepPlace: true, getChildren: () => this._catReactions().getItems() }, 'reaction'),
                this._lockCat({ label: localize('LA.actionEconomy.protocol'),      childColLabel: localize('LA.actionEconomy.protocol'), icon: getActivationIcon('Protocol'), keepPlace: true, getChildren: () => this._catProtocols().getItems() }, 'protocol'),
                this._lockCat({ label: localize('LA.tokenHud.label.freeActions'),  childColLabel: localize('LA.tokenHud.label.freeActions'),     icon: getActivationIcon('Free'), keepPlace: true, getChildren: () => this._catFreeActions().getItems() }, 'free'),
                ...(() =>
                {
                    const deactItems = actor.items.filter(item =>
                        getLAFlags(item)?.activeStateData?.active
                        || (item.system?.tags ?? []).some(tag => tag.lid === 'tg_deactivate')
                    );
                    if (!deactItems.length)
                        return [];
                    return [{
                        label: localize('LA.tokenHud.label.deactivate'),
                        childColLabel: localize('LA.tokenHud.label.deactivate'),
                        icon: 'systems/lancer/assets/icons/status_shutdown.svg',
                        getChildren: () => deactItems.map(item =>
                        {
                            const asd = getLAFlags(item)?.activeStateData;
                            const endName = asd?.endActionDescription || `Deactivate ${item.name}`;
                            const activation = asd?.endAction || 'Protocol';
                            // Ending an activation is never gated by the locks that activation put up.
                            const action = { name: endName, activation, detail: item.system?.effect || '', _skipLockInfo: true };
                            return {
                                label: endName,
                                labelHtml: extraDotLabel(endName),
                                icon: getActivationIcon({ activation }),
                                hoverData: { actor, item, action, category: 'Actions' },
                                onClick: () => endItemActivation(item, this._token),
                                onRightClick: this._actionPopup(action, item),
                            };
                        })
                    }];
                })(),
            ],
        };
    }

    _catResources()
    {
        return {
            label: localize('LA.tokenHud.label.resources'),
            icon: 'mdi mdi-database-outline',
            colLabel: localize('LA.tokenHud.col.resources'),
            getItems: () => [
                { isSectionLabel: true, label: localize('LA.tokenHud.col.resources') },
                ...this._resourceItems(),
                { isSectionLabel: true, label: localize('LA.tokenHud.col.extra') },
                ...this._resourceExtras(),
                { isSectionLabel: true, label: localize('LA.tokenHud.label.custom') },
                ...this._resourceCustomFlags(),
                { isSectionLabel: true, label: localize('LA.tokenHud.label.ammo') },
                ...this._ammoItems(),
            ],
        };
    }

    _catActionsDeployable(/** @type {any} */ actor)
    {
        const sys = actor.system;
        const items = [];

        // Main activation action (the deployable itself)
        if (sys.activation)
        {
            const deployAction = applyActionOverlays(actor, [{ name: actor.name, activation: sys.activation, detail: sys.detail ?? '' }])[0];
            items.push({
                label: localize('LA.tokenHud.label.activation'),
                icon: getActivationIcon(deployAction),
                hoverData: { actor, item: null, action: deployAction, category: 'Actions' },
                onClick: () => executeSimpleActivation(actor, { title: actor.name, action: deployAction, detail: sys.detail ?? '' }),
                onRightClick: this._actionPopup(deployAction),
            });
        }

        // Recall action (no dialog, just deletes this token).
        if (sys.recall != null)
        {
            items.push({
                label: localize('LA.tokenHud.label.recall'),
                stableKey: genericFavKey('Recall'),
                icon: getActivationIcon({ activation: sys.recall }),
                onClick: () => this._token.document.delete(),
            });
        }

        for (const extra of gateActions(/** @type {any[]} */ (getLAFlag(actor,'extraActions') ?? []), actor))
        {
            items.push(this._applyGate({
                label: extra.name,
                icon: extra.icon ?? getActivationIcon(extra),
                hoverData: { actor, item: null, action: extra, category: 'Actions' },
                onClick: () => this._runExtraAction(actor, extra),
                onRightClick: this._actionPopup(extra),
            }, extra));
        }

        for (const action of applyActionOverlays(actor, sys.actions ?? []))
        {
            items.push({
                label: action.name,
                icon: getActivationIcon(action),
                hoverData: { actor, item: null, action, category: 'Actions' },
                onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail ?? '' }),
                onRightClick: this._actionPopup(action),
            });
        }

        const token = this._token;
        items.push({ isSectionLabel: true, label: localize('LA.tokenHud.label.tools') });
        items.push(this._toolRow('basicAttack', () => executeBasicAttack(actor), { hoverData: { actor, item: null, action: { name: 'Basic Attack', activation: 'Tool' }, category: 'Actions' } }));
        items.push(this._toolRow('basicTech', () => executeTechAttack(actor, { title: 'Basic Tech', grit: actor.system?.tech_attack, attack_type: 'Tech' }), { hoverData: { actor, item: null, action: { name: 'Basic Tech', activation: 'Tool' }, category: 'Actions' } }));
        items.push(this._toolRow('damage', () => executeDamageRoll(token, [...(game.user?.targets ?? [])], '0', 'Kinetic'), { hoverData: { actor, item: null, action: { name: 'Damage', activation: 'Tool' }, category: 'Actions' } }));

        return {
            label: localize('LA.tokenHud.label.actions'),
            colLabel: localize('LA.tokenHud.label.actions'),
            icon: 'mdi mdi-hexagon-outline',
            getItems: () => items,
        };
    }

    _catActionsPilot(/** @type {any} */ actor)
    {
        const actionPopup = action => this._actionPopup(action);
        const token = this._token;
        const showAHIS = getModuleSetting('tah.showAidHandleInteractSqueeze') ?? false;
        const basicQuick = () => [
            this._simpleItem('Boost',    'modules/lancer-automations/icons/speedometer.svg', { name: 'Boost',    activation: 'Quick'          }, BOOST_DETAIL),
            this._simpleItem('Hide',     'systems/lancer/assets/icons/status_hidden.svg',    { name: 'Hide',     activation: 'Quick'          }, 'Obscure your position, becoming HIDDEN and unable to be identified, precisely located, or targeted directly by attacks or hostile actions.'),
            this._simpleItem('Search',   'modules/lancer-automations/icons/search.svg',      { name: 'Search',   activation: 'Quick'          }, 'As a pilot on foot, make a contested skill check, adding bonuses from triggers as normal. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found using SEARCH, they immediately lose HIDDEN and can be located again by any character.'),
            ...(showAHIS ? [this._simpleItem('Interact', 'mdi mdi-gesture-tap',       { name: 'Interact', activation: 'Protocol/Quick' }, 'Manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn. If no hostile characters are adjacent to the object, you automatically succeed. Otherwise, make a contested skill check.')] : []),
            this._simpleItem('Prepare',  'mdi mdi-lightbulb-outline',  { name: 'Prepare',  activation: 'Quick'          }, 'Prepare any other Quick Action and specify a valid trigger in the form "When X then Y". Until the start of your next turn, when it is triggered, you can take this action as a Reaction. While holding a Prepared Action, you may not move or perform any other actions or Reactions.'),
            { label: localize('LA.tokenHud.label.reload'), icon: 'mdi mdi-magazine-rifle', onClick: () => reloadOneWeapon(token), broadcastFn: (targetToken) => reloadOneWeapon(targetToken), onRightClick: actionPopup({ name: 'Reload', activation: 'Quick', detail: localize('LA.tokenHud.detail.reloadWeapon') }) },
        ];
        const basicFull = () => [
            this._simpleItem('Disengage', 'mdi mdi-run-fast', { name: 'Disengage', activation: 'Full' }, 'Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.'),
            this._simpleItem('Mount',     'mdi mdi-location-enter',    { name: 'Mount',     activation: 'Full' }, 'You can MOUNT as a full action. You must be adjacent your mech to MOUNT.\nAdditionally, you can also MOUNT willing allied mechs or vehicles. When you do so, move into the same space and then move with them.'),
            this._simpleItem('Jockey',    'mdi mdi-hook',     { name: 'Jockey',    activation: 'Full' }, 'To JOCKEY, you must be adjacent to a mech. As a full action, make a contested skill check using GRIT. The mech contests with HULL. On a success, climb onto the mech, sharing its space.\nChoose one: DISTRACT (mech is IMPAIRED and SLOWED), SHRED (deal 2 heat), or DAMAGE (deal 4 kinetic damage).'),
        ];
        return {
            label: localize('LA.tokenHud.label.actions'),
            colLabel: localize('LA.tokenHud.label.actions'),
            icon: 'mdi mdi-hexagon-outline',
            getItems: () => [
                {
                    label: 'Basic',
                    text: localize('LA.tokenHud.label.basic'),
                    icon: 'mdi mdi-hexagon-outline',
                    childColLabel: localize('LA.tokenHud.label.quick'),
                    getChildren: () => [
                        ...this._lockRows(basicQuick(), 'quick'),
                        { isSectionLabel: true, label: localize('LA.tokenHud.label.full') },
                        ...this._lockRows(basicFull(), 'full'),
                    ],
                },
                { label: localize('LA.tokenHud.label.attacks'), childColLabel: localize('LA.tokenHud.label.attacks'), icon: 'systems/lancer/assets/icons/role_striker.svg', getChildren: () => this._catAttacks().getItems() },
                this._lockCat({ label: localize('LA.tokenHud.label.quickActions'), childColLabel: localize('LA.tokenHud.label.quickActions'), icon: getActivationIcon('Quick'), keepPlace: true, getChildren: () => this._withDeployRows(this._getActionsByActivation(actor, 'Quick', 'Actions'), actor, 'Quick') }, 'quick'),
                this._lockCat({ label: localize('LA.tokenHud.label.fullActions'),  childColLabel: localize('LA.tokenHud.label.fullActions'),  icon: getActivationIcon('Full'), keepPlace: true, getChildren: () => this._withDeployRows(this._getActionsByActivation(actor, 'Full',  'Actions'), actor, 'Full') }, 'full'),
                this._lockCat({ label: localize('LA.actionEconomy.reaction'),      childColLabel: localize('LA.actionEconomy.reaction'),      icon: getActivationIcon('Reaction'), keepPlace: true, getChildren: () => this._catReactions().getItems() }, 'reaction'),
                this._lockCat({ label: localize('LA.actionEconomy.protocol'),      childColLabel: localize('LA.actionEconomy.protocol'),      icon: getActivationIcon('Protocol'), keepPlace: true, getChildren: () => this._catProtocols().getItems() }, 'protocol'),
                this._lockCat({ label: localize('LA.tokenHud.label.freeActions'),  childColLabel: localize('LA.tokenHud.label.freeActions'),  icon: getActivationIcon('Free'), keepPlace: true, getChildren: () => this._catFreeActions().getItems() }, 'free'),
            ],
            noCount: true,
        };
    }

    _catDeployables()
    {
        const actor = this._actor;
        const token = this._token;
        return {
            label: localize('LA.tokenHud.label.deployables'),
            colLabel: localize('LA.tokenHud.label.tools'),
            icon: 'systems/lancer/assets/icons/deployable.svg',
            getItems: () => [
                { label: localize('LA.tokenHud.label.deployItem'), stableKey: genericFavKey('Deploy Item'), icon: 'systems/lancer/assets/icons/deployable.svg', noCount: true, onClick: () => openDeployableMenu(actor) },
                { label: localize('LA.tokenHud.label.recallItem'), stableKey: genericFavKey('Recall Item'), icon: 'modules/lancer-automations/icons/up-card.svg',     noCount: true, onClick: () => recallDeployable(token) },
                {
                    label: localize('LA.tokenHud.label.linkUnlinkActor'),
                    stableKey: genericFavKey('Link Unlink Actor'),
                    icon: 'modules/lancer-automations/icons/linked-rings.svg',
                    noCount: true,
                    onClick: () => promptLinkOrUnlinkActor(token),
                },
                { isSectionLabel: true, label: localize('LA.tokenHud.label.deployables') },
                ...this._deployableRows(actor),
            ],
        };
    }

    // Limited system whose point is its deployable: hidden from Systems (shown as a Deployable instead), uses badge stays on the deployable row.
    _deployBodyHtml(/** @type {any} */ item, /** @type {string} */ lid, /** @type {any} */ actor, /** @type {any} */ dep)
    {
        const extra = item
            ? [...(getLAFlag(item,'extraDeployables') ?? []), ...(getLAFlag(item,'extraDeployableActors') ?? [])]
            : [];
        const isExtra = !item || extra.includes(lid);
        return laRenderDeployables([dep], { label: isExtra ? 'EXTRA DEPLOYABLE' : 'DEPLOYABLE', metas: [resolveDeployRangeCount(item, lid, actor)] });
    }

    _deployRow(actor, lid, source, { depInfo = getDeployableInfoSync(lid, actor), itemRow = false, subtitle = null, activation = undefined } = {})
    {
        const label = stripDeployOwner(depInfo?.name ?? lid);
        const row = {
            label,
            ...(source ? {} : { labelHtml: extraDotLabel(label) }),
            icon: getDeployableIcon(depInfo),
            ...(activation === undefined ? {} : { activation }),
            onClick: () => deployDeployable(actor, lid, source, !!source),
            onRightClick: async (anchorRow) =>
            {
                const dep = (await resolveDeployable(lid, actor)).deployable;
                if (!dep)
                    return;
                const defaultSubtitle = source ? `Deployable · ${source.name}${source.system?.type ? ` (${source.system.type})` : ''}` : 'Extra Deployable';
                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: stripDeployOwner(dep.name), subtitle: subtitle?.() ?? defaultSubtitle, bodyHtml: this._deployBodyHtml(source, lid, actor, dep), theme: 'deployable', item: source, skipExtras: true, row: anchorRow });
            },
        };
        if (itemRow)
            return this._itemRow(source, { ...row, category: 'Deployables', hoverExtra: { deployLid: lid } });
        return { ...row, hoverData: { actor, item: source, action: null, category: 'Deployables', deployLid: lid } };
    }

    _withDeployRows(/** @type {any[]} */ items, /** @type {any} */ actor, /** @type {string|string[]} */ activationTypes)
    {
        return [...items, { isSectionLabel: true, label: localize('LA.tokenHud.label.deployables') }, ...this._deployableRows(actor, [activationTypes].flat())];
    }

    _deployableRows(/** @type {any} */ actor, /** @type {string[]|null} */ activationTypes = null)
    {
        // Mechs: equipped items only (systems + frame + weapons). NPCs: all actor.items.
        // Loadout entries can be raw ID strings or {id,status,value} objects; handle both.
        let equippedItems;
        if (actor.type === 'mech')
        {
            const loadout = actor.system?.loadout ?? {};
            const getId = (/** @type {any} */ entry) => (typeof entry === 'string' ? entry : entry?.id) ?? null;
            const equippedIds = new Set([
                ...(loadout.systems ?? []).map(getId),
                getId(loadout.frame),
                ...(loadout.weapon_mounts ?? []).flatMap((/** @type {any} */ m) =>
                    (m.slots ?? []).map((/** @type {any} */ sl) => getId(sl.weapon))
                ),
            ].filter(Boolean));
            equippedItems = [...actor.items].filter((/** @type {any} */ i) => equippedIds.has(i.id));
        }
        else
            equippedItems = [...actor.items];
        const deployableRows = [];
        for (const item of equippedItems)
        {
            const lids = getItemDeployables(item, actor);
            for (const lid of lids)
            {
                const depInfo = getDeployableInfoSync(lid, actor);
                if (activationTypes && !activationTypes.includes(depInfo?.activation))
                    continue;
                deployableRows.push(this._deployRow(actor, lid, item, { depInfo, itemRow: true, activation: activationTypes ? null : (depInfo?.activation ?? null) }));
            }
        }
        for (const lid of getActorDeployables(actor))
        {
            const depInfo = getDeployableInfoSync(lid, actor);
            if (activationTypes && !activationTypes.includes(depInfo?.activation))
                continue;
            deployableRows.push(this._deployRow(actor, lid, null, { depInfo, activation: activationTypes ? null : (depInfo?.activation ?? null) }));
        }

        return deployableRows;
    }

    _catAttacks()
    {
        const actor = this._actor;
        const token = this._token;
        const actionPopup = action => this._actionPopup(action);
        return {
            label: localize('LA.tokenHud.label.attacks'),
            colLabel: localize('LA.tokenHud.label.attacks'),
            getItems: () => this._enrichHoverData([
                ...(actor.type === 'mech' || actor.type === 'npc' ? [
                    this._lockCat(this._lockable({ label: localize('LA.tokenHud.label.skirmish'),          icon: 'modules/lancer-automations/icons/skirmish.svg', onClick: () => executeSkirmish(actor),    broadcastFn: (_token, otherActor) => executeSkirmish(otherActor),    onRightClick: actionPopup({ name: 'Skirmish',          activation: 'Quick', detail: 'When you SKIRMISH, you attack with a single weapon MOUNT. \r \n To SKIRMISH, choose a mount and a valid target within RANGE (or THREAT), then make an attack with the primary weapon on that mount. \r &bull; You may also attack with an AUXILIARY weapon on the same mount. That weapon does not deal bonus damage. \r &bull; SUPERHEAVY weapons are too cumbersome to use in a SKIRMISH, and can only be fired as part of a BARRAGE.' }) }, 'Skirmish', 'Quick'), 'quick'),
                    this._lockCat(this._lockable({ label: localize('LA.tokenHud.label.barrage'),           icon: 'modules/lancer-automations/icons/barrage.svg', onClick: () => executeBarrage(actor),     broadcastFn: (_token, otherActor) => executeBarrage(otherActor),     onRightClick: actionPopup({ name: 'Barrage',           activation: 'Full',  detail: 'When you BARRAGE, you attack with two weapon MOUNTS, or with one SUPERHEAVY weapon. \r \n To BARRAGE, choose your mounts (or one SUPERHEAVY) and either one target or different targets within range, then make an attack with the primary weapon on each mount. \r &bull; You may also attack with an AUXILIARY weapon on each mount that was fired, so long as it has not yet been fired this action. These AUXILIARY weapons do not deal bonus damage. \r &bull; SUPERHEAVY weapons can only be fired as part of a BARRAGE.' }) }, 'Barrage', 'Full'), 'full'),
                    this._lockCat(this._simpleItem('Ram',     'modules/lancer-automations/icons/ram.svg', { name: 'Ram',     activation: 'Quick' }, 'When you RAM, you make a melee attack with the aim of knocking a target down or back. \r \n To RAM, make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.'), 'quick'),
                    this._lockCat(this._simpleItem('Grapple', 'modules/lancer-automations/icons/grappling.svg', { name: 'Grapple', activation: 'Quick' }, 'When you GRAPPLE, you grab hold of a target to overpower them. \r \n To GRAPPLE, choose an adjacent character and make a melee attack. On a hit: \r &bull; both characters become ENGAGED; \r &bull; neither can BOOST or take reactions while grappled; \r &bull; the smaller becomes IMMOBILIZED and is dragged when the larger moves. If same SIZE, contested HULL check at start of turn decides who is larger. \r \n A GRAPPLE ends when adjacency breaks, the attacker ends it as a free action, or the defender wins a contested HULL check as a quick action.'), 'quick'),
                    this._lockCat(this._lockable({ label: localize('LA.tokenHud.label.improvisedAttack'), icon: 'mdi mdi-hexagon-slice-6', onClick: () => executeImprovisedAttack(actor), broadcastFn: (_token, otherActor) => executeImprovisedAttack(otherActor), onRightClick: actionPopup({ name: 'Improvised Attack', activation: 'Full',  detail: 'When you make an IMPROVISED ATTACK, you attack with a rifle butt, fist, or another improvised melee weapon. You can use anything from the butt of a weapon to a slab of concrete or a length of hull plating &mdash; the flavor of the attack is up to you! \r \n To make an IMPROVISED ATTACK, make a melee attack against an adjacent target. On a success, they take 1d6 kinetic damage.' }) }, 'Improvised Attack', 'Full'), 'full'),
                ] : []),
                ...(actor.type === 'pilot' ? [
                    this._lockCat(this._lockable({ label: localize('LA.tokenHud.label.fight'), icon: 'modules/lancer-automations/icons/crossed-slashes.svg', onClick: () => executeFight(actor), broadcastFn: (_token, otherActor) => executeFight(otherActor), onRightClick: actionPopup({ name: 'Fight', activation: 'Full', detail: 'Make a melee or ranged attack with a pilot weapon.' }) }, 'Fight', 'Full'), 'full'),
                ] : []),
                { isSectionLabel: true, label: localize('LA.tokenHud.label.tools') },
                this._toolRow('basicAttack', () => executeBasicAttack(actor), { broadcastFn: (_token, bcActor) => executeBasicAttack(bcActor) }),
                ...(actor.type === 'mech' || actor.type === 'npc' ? [this._techBasicRows().basicTech] : []),
                this._toolRow('damage', () => executeDamageRoll(token, [...(game.user?.targets ?? [])], '0', 'Kinetic')),
                { label: localize('LA.tokenHud.label.throwWeapon'),  icon: 'systems/lancer/assets/icons/thrown.svg',      onClick: () => openThrowMenu(actor),    broadcastFn: (bcToken, bcActor) => openThrowMenu(bcActor), onRightClick: actionPopup({ name: 'Throw Weapon', activation: 'Tool', detail: 'Throw an equipped THROWN weapon, dropping it as a token on the map. Retrieve it with Pickup Weapon.' }) },
                { label: localize('LA.tokenHud.label.pickupWeapon'), icon: 'modules/lancer-automations/icons/pickup.svg', onClick: () => pickupWeaponToken(token), broadcastFn: (bcToken) => pickupWeaponToken(bcToken), keepOpen: true, onRightClick: actionPopup({ name: 'Pickup Weapon', activation: 'Tool', detail: 'Pick up a weapon you previously threw, returning it to your loadout.' }) },
            ], { actor, category: 'Attacks' }),
        };
    }

    _catWeapons()
    {
        const actor = this._actor;
        const allMounts = () =>
        {
            const mounts = actor?.system?.loadout?.weapon_mounts ?? [];
            const hasWeapon = mount => !mount.bracing && (mount.slots ?? []).some(slot => slot.weapon?.id);
            return [...mounts].sort((a, b) => (hasWeapon(a) ? 0 : 1) - (hasWeapon(b) ? 0 : 1));
        };
        return {
            label: localize('LA.tokenHud.label.weapons'),
            colLabel: localize('LA.tokenHud.label.weapons'),
            icon: 'systems/lancer/assets/icons/weapon.svg',
            getItems: () =>
            {
                if (actor?.type === 'npc')
                    return actor.items.filter(item => item.type === 'npc_feature' && item.system.type === 'Weapon').map(weapon => this._weaponItem(weapon, null, null));
                if (actor?.type === 'pilot')
                    return actor.items.filter(item => item.type === 'pilot_weapon').map(weapon => this._weaponItem(weapon, null, null));
                const muted = (text) => ({ label: text, muted: true });
                const result = [];
                allMounts().forEach((mount) =>
                {
                    result.push({ label: localizeFormat('LA.tokenHud.label.mount', { type: mount.type }), isSectionLabel: true });
                    if (mount.bracing)
                    {
                        result.push(muted(localize('LA.tokenHud.label.locked')));
                        return;
                    }
                    // A Flex mount with a Main (or larger) weapon has no remaining capacity
                    const flexBlocked = mount.type === 'Flex' && (mount.slots ?? []).some(slot =>
                    {
                        if (!slot.weapon?.id)
                            return false;
                        const slotWeapon = actor.items.get(slot.weapon.id);
                        return slotWeapon && !['aux', 'auxiliary'].includes((slotWeapon.system?.size ?? '').toLowerCase());
                    });
                    (mount.slots ?? []).forEach(slot =>
                    {
                        if (slot.weapon?.id)
                        {
                            const weapon = actor.items.get(slot.weapon.id);
                            const mod    = slot.mod?.id ? actor.items.get(slot.mod.id) : null;
                            if (weapon)
                                result.push(this._weaponItem(weapon, mod, mount));
                        }
                        else if (!flexBlocked)
                            result.push(muted(localize('LA.tokenHud.label.empty')));
                    });
                });
                return result;
            },
        };
    }

    _catTech()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.tech'),
            colLabel: localize('LA.tokenHud.label.tech'),
            icon: 'systems/lancer/assets/icons/tech_quick.svg',
            getItems: () => this._withDeployRows([
                ...this._catInvades().getItems(),
                ...this._getActionsByActivation(actor, 'Quick Tech', 'Tech'),
                ...this._getActionsByActivation(actor, 'Full Tech', 'Tech'),
            ], actor, ['Quick Tech', 'Full Tech']),
        };
    }

    _techBasicRows()
    {
        const actor = this._actor;
        const actionPopup = action => this._actionPopup(action);
        const [basicTech, scan, lockOn, bolster, invade] = this._enrichHoverData([
            this._lockable(this._toolRow('basicTech', () => executeTechAttack(actor, { title: 'Basic Tech', grit: actor.system?.tech_attack, attack_type: 'Tech' })), 'Basic Tech', 'Quick Tech'),
            this._lockable({ label: localize('LA.tokenHud.label.scan'),       icon: 'modules/lancer-automations/icons/radar-sweep.svg', onClick: () => executeSimpleActivation(actor, { title: 'Scan',     action: { name: 'Scan',     activation: 'Quick' }, detail: 'Choose a character or object within SENSORS and line of sight, then ask the GM for one of: its full statistics and loadout, one piece of hidden information, or generic public information. Only current at the time of the SCAN.' }), onRightClick: actionPopup({ name: 'Scan',     activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character or object within SENSORS and line of sight, then ask the GM for one of: its full statistics and loadout, one piece of hidden information, or generic public information. Only current at the time of the SCAN.' }) }, 'Scan', 'Quick Tech'),
            this._lockable({ label: localize('LA.tokenHud.label.lockOn'),    icon: 'systems/lancer/assets/icons/white/condition_lockon.svg', onClick: () => executeSimpleActivation(actor, { title: 'Lock On',  action: { name: 'Lock On',  activation: 'Quick' }, detail: 'Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves.' }),  onRightClick: actionPopup({ name: 'Lock On',  activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves.' }) }, 'Lock On', 'Quick Tech'),
            this._lockable({ label: localize('LA.tokenHud.label.bolster'),    icon: 'modules/lancer-automations/icons/upgrade.svg', onClick: () => executeSimpleActivation(actor, { title: 'Bolster',  action: { name: 'Bolster',  activation: 'Quick' }, detail: 'Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time.' }),                                                              onRightClick: actionPopup({ name: 'Bolster',  activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time.' }) }, 'Bolster', 'Quick Tech'),
            this._lockable({ label: localize('LA.tokenHud.label.invade'),     icon: 'modules/lancer-automations/icons/cpu-shot.svg', onClick: () => executeInvade(actor),                                                                                                                                                                                                                                                                                                                                                                       onRightClick: actionPopup({ name: 'Invade',   activation: 'Quick Tech', tech_attack: true, detail: 'Make a tech attack against a target. On success, deal 2 heat and choose one of the available Invade options.' }) }, 'Invade', 'Quick Tech'),
        ], { actor, category: 'Tech' });
        return { basicTech, scan, lockOn, bolster, invade };
    }

    _catInvades()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.invades'),
            colLabel: localize('LA.tokenHud.label.invades'),
            getItems: () => this._getInvadeOptions(actor).map(opt => this._blockIf(this._lockable({
                label: opt.name,
                labelHtml: opt.destroyed ? this._destroyedLabel(opt.name) : undefined,
                icon: 'modules/lancer-automations/icons/cpu-shot.svg',
                badge: opt.badge ?? null,
                badgeTone: opt.badgeTone ?? null,
                ...this._statusColors(opt),
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (row) => this._buildInvadePopup(opt, row),
            }, opt.name, 'Quick Tech'), !!opt.coreLocked, localize('LA.tokenHud.coreInactive'))),
        };
    }

    _basicQuickRows()
    {
        const actor = this._actor;
        const ap = action => this._actionPopup(action);
        const showAHIS = getModuleSetting('tah.showAidHandleInteractSqueeze') ?? false;
        const basicChildren = () =>
        {
            const items = [
                this._simpleItem('Boost',     'modules/lancer-automations/icons/speedometer.svg',  { name: 'Boost',     activation: 'Quick'          }, BOOST_DETAIL),
                ...(showAHIS && actor.type !== 'npc' ? [this._simpleItem('Aid', 'modules/lancer-automations/icons/medical-pack.svg', { name: 'Aid', activation: 'Quick' }, 'You assist a mech so it can Stabilize more easily. Choose an adjacent character. On their next turn, they may Stabilize as a quick action. They can choose to take this action even if they normally would not be able to take actions (for example, by being affected by the Stunned condition).')] : []),
                this._simpleItem('Hide',      'systems/lancer/assets/icons/status_hidden.svg',     { name: 'Hide',      activation: 'Quick'          }, 'Obscure the position of your mech, becoming HIDDEN and unable to be identified, precisely located, or be targeted directly by attacks or hostile actions.'),
                this._simpleItem('Search',    'modules/lancer-automations/icons/search.svg',       { name: 'Search',    activation: 'Quick'          }, 'Choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. Once a HIDDEN character has been found using SEARCH, they immediately lose HIDDEN and can be located again by any character.'),
                this._blockIf(this._simpleItem('Shut Down', 'systems/lancer/assets/icons/status_shutdown.svg',   { name: 'Shut Down', activation: 'Quick'          }, 'When you SHUT DOWN, your mech powers off to end tech effects and cool down. \r \n As a quick action, your mech takes the SHUT DOWN status: \r &bull; all heat is cleared, as is EXPOSED; \r &bull; cascading NHPs return to normal; \r &bull; tech-caused statuses (LOCK ON, etc.) immediately end; \r &bull; the mech gains IMMUNITY to all tech actions and attacks; \r &bull; the mech is STUNNED indefinitely. \r \n The only way to remove SHUT DOWN is to BOOT UP.'), actor.statuses?.has('shutdown'), 'Already SHUT DOWN.'),
                ...(showAHIS ? [this._simpleItem('Handle',    'modules/lancer-automations/icons/hand-truck.svg',   { name: 'Handle',    activation: 'Protocol/Quick' }, 'As a protocol or quick action, start to handle an adjacent object or willing character by lifting or dragging them. Mechs can drag characters or objects up to twice their SIZE but are SLOWED while doing so. They can also lift characters or objects of equal or lesser SIZE overhead but are IMMOBILIZED while doing so.')] : []),
                ...(showAHIS ? [this._simpleItem('Interact',  'mdi mdi-gesture-tap',        { name: 'Interact',  activation: 'Protocol/Quick' }, 'Manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn. If no hostile characters are adjacent to the object, you automatically succeed. Otherwise, make a contested skill check.')] : []),
                this._simpleItem('Prepare',   'mdi mdi-lightbulb-outline',   { name: 'Prepare',   activation: 'Quick'          }, 'Prepare any other Quick Action and specify a valid trigger in the form "When X then Y". Until the start of your next turn, when it is triggered, you can take this action as a Reaction. While holding a Prepared Action, you may not move or perform any other actions or Reactions.'),
                ...(actor.type !== 'npc' ? [this._blockIf(this._simpleItem('Eject',     'mdi mdi-parachute',    { name: 'Eject',     activation: 'Quick'          }, 'EJECT as a quick action, flying 6 spaces in the direction of your choice; however, this is a single-use system for emergency use only – it leaves your mech IMPAIRED. Your mech remains IMPAIRED and you cannot EJECT again until your next FULL REPAIR.'), this._pilotHasTokenOnScene(), 'The pilot already has a token on this scene.')] : []),
                this._blockIf(this._lockable({ label: localize('LA.tokenHud.label.standingUp'), icon: 'mdi mdi-eject', onClick: () => executeStandingUp(this._token), broadcastFn: (_t, a) => executeStandingUp(a.getActiveTokens()?.[0]), onRightClick: ap({ name: 'Standing Up', activation: 'Movement', detail: 'Stand up instead of taking your standard move. Removes Prone and grants +Speed movement.' }) }, 'Standing Up', 'Quick'), !actor.statuses?.has('prone'), 'Standing Up requires the PRONE status.'),
            ];
            if (actor.type === 'mech')
                items.push({ label: localize('LA.tokenHud.label.selfDestruct'), icon: 'mdi mdi-bomb', onClick: () => /** @type {any} */ (executeReactorMeltdown(actor)), broadcastFn: (_t, a) => executeReactorMeltdown(a), onRightClick: ap({ name: 'Self Destruct', activation: 'Quick', detail: 'When you SELF DESTRUCT, you overload your reactor in a final, catastrophic play. \r \n As a quick action, initiate a reactor meltdown. The mech explodes at the end of your next turn, or at the end of one of your turns within the following two rounds (your choice): \r &bull; the mech is annihilated, killing anyone inside; \r &bull; a BURST 2 explosion deals 4d6 explosive damage; \r &bull; characters caught who succeed on an AGILITY save take half damage.' }) });
            return this._enrichHoverData(items, { actor, category: 'Actions' });
        };
        return basicChildren();
    }

    _basicFullRows()
    {
        const actor = this._actor;
        const ap = action => this._actionPopup(action);
        const basicChildren = () =>
        {
            const items = [
                this._blockIf(this._simpleItem('Boot Up',   'modules/lancer-automations/icons/boot.svg',      { name: 'Boot Up',   activation: 'Full' }, 'You can BOOT UP a mech that you are piloting as a full action, clearing SHUT DOWN and restoring your mech to a powered state.'), !actor.statuses?.has('shutdown'), 'Boot Up requires the SHUT DOWN status.'),
                this._simpleItem('Disengage', 'mdi mdi-run-fast', { name: 'Disengage', activation: 'Full' }, 'Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.'),
                ...(actor.type !== 'npc' ? [this._blockIf(this._simpleItem('Dismount',  'mdi mdi-location-exit',  { name: 'Dismount',  activation: 'Full' }, 'When you DISMOUNT, you climb off of a mech. You can DISMOUNT as a full action. When you DISMOUNT, you are placed in an adjacent space – if there are no free spaces, you cannot DISMOUNT. Additionally, you can also DISMOUNT willing allied mechs or vehicles you have MOUNTED.'), this._pilotHasTokenOnScene(), 'The pilot already has a token on this scene.')] : []),
            ];
            if (actor.type === 'mech' || actor.type === 'npc')
                items.push({ label: localize('LA.tokenHud.label.stabilize'), icon: 'systems/lancer/assets/icons/repair.svg', onClick: () => /** @type {any} */ (actor.beginStabilizeFlow()), broadcastFn: (_t, a) => /** @type {any} */ (a).beginStabilizeFlow(), onRightClick: ap({ name: 'Stabilize', activation: 'Full', detail: 'To STABILIZE, choose ONE of these two items: \r &bull; Cool your mech (clearing all heat and ending the EXPOSED status); \r &bull; Spend ONE Repair to heal your mech to max HP. \r \n Additionally, choose ONE the following four items: \r &bull; Reload all LOADING weapons on your mech; \r &bull; Clear any burn on your mech; \r &bull; Clear ONE condition from yourself NOT caused by your own systems/talents (etc); \r &bull; Clear ONE condition from an ADJACENT ally NOT caused by their own systems/talents (etc).' }) });
            return this._enrichHoverData(items, { actor, category: 'Actions' });
        };
        return basicChildren();
    }

    _catReactions()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.reactions'),
            colLabel: localize('LA.tokenHud.label.reactions'),
            getItems: () =>
            {
                const reactionAvail = hasReactionAvailable(actor);
                const noBrace     = actor.type === 'deployable' || actor.type === 'pilot' || actor.type === 'npc';
                const noOverwatch = actor.type === 'deployable';
                const items = this._withDeployRows([
                    ...(noBrace ? [] : [
                        this._simpleItem('Brace',     'modules/lancer-automations/icons/brace.svg', { name: 'Brace',     activation: 'Reaction' }, 'You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.'),
                    ]),
                    ...(noOverwatch ? [] : [
                        this._simpleItem('Overwatch', 'systems/lancer/assets/icons/reaction.svg',   { name: 'Overwatch', activation: 'Reaction', trigger: 'A hostile character starts any movement (including BOOST and other actions) inside one of your weapons\' THREAT.' }, 'Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move.'),
                    ]),
                    ...this._getActionsByActivation(actor, 'Reaction', 'Actions'),
                ], actor, 'Reaction');
                if (!reactionAvail)
                {
                    items.forEach(item =>
                    {
                        if (!item.statusKind && !item.isSectionLabel)
                            item.statusKind = 'spent';
                    });
                }
                return this._enrichHoverData(items, { actor, category: 'Actions' });
            },
        };
    }

    _catProtocols()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.protocols'),
            colLabel: localize('LA.tokenHud.label.protocols'),
            getItems: () => this._enrichHoverData(this._withDeployRows([
                ...this._getActionsByActivation(actor, 'Protocol', 'Actions'),
            ], actor, 'Protocol'), { actor, category: 'Actions' }),
        };
    }

    _catFreeActions()
    {
        const actor = this._actor;
        const showAHIS = getModuleSetting('tah.showAidHandleInteractSqueeze') ?? false;
        return {
            label: localize('LA.tokenHud.label.freeActions'),
            colLabel: localize('LA.tokenHud.label.freeActions'),
            getItems: () => this._enrichHoverData(this._withDeployRows([
                ...(showAHIS && actor.type !== 'deployable' ? [this._simpleItem('Squeeze', 'modules/lancer-automations/icons/contract.svg', { name: 'Squeeze', activation: 'Free' }, 'A character may squeeze as a free action, treating themselves as one Size smaller for the purposes of movement. While squeezing, the character is additionally treated as Prone. The character may stop squeezing as a free action while in a space able to accommodate their normal Size.')] : []),
                ...this._getActionsByActivation(actor, 'Free', 'Actions'),
            ], actor, 'Free'), { actor, category: 'Actions' }),
        };
    }

    _catSkills()
    {
        const actor = this._actor;
        const isNpc = actor.type === 'npc';

        const statDefs = [
            { key: 'hull', label: localize('LA.tokenHud.label.hull') },
            { key: 'agi',  label: localize('LA.tokenHud.label.agility') },
            { key: 'sys',  label: localize('LA.tokenHud.label.systems') },
            { key: 'eng',  label: localize('LA.tokenHud.label.engineering') },
            { key: 'grit', label: localize('LA.tokenHud.label.grit') },
            { key: 'tier', label: localize('LA.tokenHud.label.tier') },
        ];
        const statsItems = statDefs
            .filter(stat => actor.system[stat.key] !== undefined)
            .map(stat => ({
                label: stat.label,
                stableKey: genericFavKey(stat.key),
                icon: `modules/lancer-automations/icons/stats/${stat.key}.svg`,
                badge: (actor.system[stat.key] >= 0 ? '+' : '') + actor.system[stat.key],
                badgeTone: 'neutral',
                hoverData: { actor, item: null, action: { name: stat.label }, category: 'Skills' },
                onClick:     () => /** @type {any} */ (actor).beginStatFlow(`system.${stat.key}`),
                broadcastFn: (_token, targetActor) => /** @type {any} */ (targetActor)?.beginStatFlow?.(`system.${stat.key}`),
                onRightClick: this._actionPopup({ name: stat.label, activation: 'Check', detail: `Roll 1d20 + ${stat.label.toUpperCase()} (${(actor.system[stat.key] >= 0 ? '+' : '') + actor.system[stat.key]}).` }),
            }));
        // Generic untrained trigger (1d20+0), like alternative sheets' "Other Skill".
        const otherSkillItem = {
            label: localize('LA.tokenHud.label.otherSkill'),
            stableKey: genericFavKey('Other Skill'),
            badge: '+0',
            badgeTone: 'neutral',
            icon: 'systems/lancer/assets/icons/white/skill.svg',
            hoverData: { actor, item: null, action: { name: 'Other Skill' }, category: 'Skills' },
            onClick:     () => /** @type {any} */ (actor).beginStatFlow?.('system.other_skill', 'SKILL TRIGGER'),
            onRightClick: (row) => this._showItemPopup({
                cssClass: 'la-hud-popup la-hud-skill-popup',
                dataKey: 'skill-name',
                dataValue: 'Other Skill',
                title: localize('LA.tokenHud.label.otherSkill'),
                subtitle: localize('LA.tokenHud.detail.untrainedTrigger0'),
                bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${localize('LA.tokenHud.detail.otherSkillBody')}</div>`,
                theme: 'system',
                item: null,
                row,
            }),
            broadcastFn: (_token, targetActor) => /** @type {any} */ (targetActor)?.beginStatFlow?.('system.other_skill', 'SKILL TRIGGER'),
        };
        if (isNpc)
            statsItems.push(/** @type {any} */ (otherSkillItem));

        statsItems.push(/** @type {any} */ (this._toolRow('contest', () => openHaseContestCard({ tokenA: this._token }), { hoverData: { actor, item: null, action: { name: 'Contest' }, category: 'Skills' } })));
        statsItems.push(/** @type {any} */ (this._toolRow('forceCheck', () => openForceCheckCard({ tokenA: this._token, saveVs: this._token }), { hoverData: { actor, item: null, action: { name: 'Force Check' }, category: 'Skills' } })));

        const skillItems = [];
        if (!isNpc)
        {
            const pilot = resolvePilot(actor) ?? actor;
            const skills = pilot.items?.filter(item => item.type === 'skill') ?? [];
            for (const skill of skills)
            {
                const bonus = (skill.system.curr_rank ?? 0) * 2;
                const skillName = skill.name;
                skillItems.push({
                    label: skill.name,
                    badge: `+${bonus}`,
                    badgeTone: 'neutral',
                    icon: skill.img ?? null,
                    hoverData: { actor, item: skill, action: { name: skill.name }, category: 'Skills' },
                    onClick:     () => skill.beginSkillFlow?.(),
                    onRightClick: (row) => this._showItemPopup({
                        cssClass: 'la-hud-popup la-hud-skill-popup',
                        dataKey: 'skill-id',
                        dataValue: skill.id,
                        title: skill.name,
                        subtitle: localizeFormat('LA.tokenHud.detail.triggerBonus', { bonus }),
                        bodyHtml: (skill.system?.description ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('DESCRIPTION', '#1565c0')}<div style="font-size:0.82em;color:#bbb;line-height:1.4;margin-top:2px;">${laFormatDetailHtml(skill.system.description)}</div></div>` : '')
                            + (skill.system?.detail ? `<div>${laPopupSectionLabel('DETAIL', '#e65100')}<div style="font-size:0.82em;color:#bbb;line-height:1.4;margin-top:2px;">${laFormatDetailHtml(skill.system.detail)}</div></div>` : ''),
                        theme: 'system',
                        item: skill,
                        row,
                    }),
                    broadcastFn: (_t, a) =>
                    {
                        const skillOwner = resolvePilot(a) ?? a;
                        const matchedSkill = skillOwner?.items?.find(skillItem => skillItem.type === 'skill' && skillItem.name === skillName);
                        return matchedSkill?.beginSkillFlow?.();
                    },
                });
            }
        }

        if (isNpc)
        {
            return {
                label: localize('LA.tokenHud.label.skills'),
                colLabel: localize('LA.tokenHud.label.skills'),
                icon: 'mdi mdi-tune-vertical',
                getItems: () => [
                    ...statsItems,
                ],
            };
        }

        return {
            label: localize('LA.tokenHud.label.attributes'),
            colLabel: localize('LA.tokenHud.label.attributes'),
            icon: 'mdi mdi-chart-bar',
            noCount: true,
            getItems: () => [
                { label: localize('LA.tokenHud.label.skills'),   childColLabel: localize('LA.tokenHud.label.skills'),   icon: 'mdi mdi-tune-vertical', getChildren: () => statsItems },
                ...(skillItems.length ? [{ label: localize('LA.tokenHud.label.triggers'), childColLabel: localize('LA.tokenHud.label.triggers'), icon: 'modules/lancer-automations/icons/skills.svg', getChildren: () => skillItems }] : []),
                otherSkillItem,
            ],
        };
    }

    _catNarrativeEnvironment()
    {
        const fromEnvironment = (run) => async () =>
        {
            const environment = await getEnvironmentActor();
            if (environment)
                run(environment);
        };
        const items = [
            this._toolRow('basicAttack', fromEnvironment(environment => executeBasicAttack(environment)), { detail: localize('LA.tokenHud.detail.environmentAttack') }),
            this._toolRow('basicTech', fromEnvironment(environment => executeTechAttack(environment, { title: 'Basic Tech', grit: environment.system?.tech_attack, attack_type: 'Tech' })), { detail: localize('LA.tokenHud.detail.environmentTech') }),
            this._toolRow('damage', fromEnvironment(environment => executeDamageRoll(environment, [...(game.user?.targets ?? [])], '0', 'Kinetic')), { detail: localize('LA.tokenHud.detail.environmentDamage') }),
            this._toolRow('contest', () => openHaseContestCard()),
            this._toolRow('forceCheck', () => openForceCheckCard()),
        ];
        return {
            label: localize('LA.tokenHud.label.environment'),
            colLabel: localize('LA.tokenHud.label.environment'),
            icon: 'modules/lancer-automations/icons/world.svg',
            getItems: () => items,
        };
    }

    _toolRow(kind, onClick, { detail = null, hoverData = undefined, broadcastFn = undefined } = {})
    {
        const tool = TOOL_ROWS[kind];
        return {
            label: localize(tool.labelKey),
            icon: tool.icon,
            ...(hoverData ? { hoverData } : {}),
            onClick,
            ...(broadcastFn ? { broadcastFn } : {}),
            onRightClick: this._actionPopup({ name: tool.name, activation: 'Tool', ...(tool.techAttack ? { tech_attack: true } : {}), detail: detail ?? (tool.detailKey ? localize(tool.detailKey) : tool.detail) }),
        };
    }

    _utilityRow(key, target = null, { icon = null } = {})
    {
        const tool = UTILITY_TOOLS[key];
        return {
            label: localize(tool.labelKey),
            icon: icon ?? tool.icon,
            onClick: () => tool.run(/** @type {any} */ (game.modules.get(MODULE_ID))?.api, target),
            onRightClick: this._actionPopup({ name: tool.name, activation: 'Tool', detail: tool.detailKey ? localize(tool.detailKey) : tool.detail }),
        };
    }

    _catNarrativeUtility(linked)
    {
        const actor = this._actor;
        const items = [
            { label: localize('LA.tokenHud.label.glossary'), icon: 'systems/lancer/assets/icons/compendium.svg', isGlossaryPanel: true },
            this._utilityRow('effectManager'),
            this._utilityRow('vote', null, { icon: 'modules/lancer-automations/icons/vote.svg' }),
            this._utilityRow('downtime'),
        ];
        if (linked && actor)
        {
            items.push(this._utilityRow('reserve', actor));
            items.push(this._utilityRow('clocksBurdens', actor));
            if (actor.type === 'pilot')
                items.push(this._utilityRow('rest', { actor }));
        }
        return {
            label: localize('LA.tokenHud.label.utility'),
            colLabel: localize('LA.tokenHud.label.utility'),
            icon: 'modules/lancer-automations/icons/tinker.svg',
            getItems: () => items,
        };
    }

    _catUtility()
    {
        const token = this._token;

        const actor = this._actor;
        const isMechOrNpc = actor?.type === 'mech' || actor?.type === 'npc';

        const gameplayItems = [
            { label: localize('LA.tokenHud.label.fullRepair'),
                icon: 'modules/lancer-automations/icons/auto-repair.svg',
                onClick: async () =>
                {
                    const targets = (this._tokens?.length ? this._tokens : [token]).filter(Boolean);
                    const actors = [...new Set(targets.map(target => target.actor).filter(Boolean))];
                    if (actors.length <= 1)
                    {
                    /** @type {any} */ (actors[0] ?? actor)?.beginFullRepairFlow();
                        return;
                    }
                    const ok = await Dialog.confirm({
                        title: localize('LA.dialogTitle.fullRepair'),
                        content: localizeFormat('LA.tokenHud.confirmFullRepair', { count: actors.length, names: actors.map(repairActor => escapeHtml(repairActor.name)).join(', ') }),
                    });
                    if (!ok)
                        return;
                    // fire the flow hooks per actor so Lancer Weapon FX plays per token; skip the per-actor dialog
                    const step = /** @type {any} */ (game).lancer?.flowSteps?.get('executeFullRepair');
                    for (const a of actors)
                    {
                        if (!step)
                        {
                            await /** @type {any} */ (a).loadoutHelper?.fullRepair(); continue;
                        }
                        const flow = { state: { name: 'FullRepairFlow', actor: a, item: null, currentStep: 'executeFullRepair', data: { title: '', description: '', tags: [] } } };
                        Hooks.callAll('lancer.preFlow.FullRepairFlow', flow);
                        const done = await step(flow.state);
                        Hooks.callAll('lancer.postFlow.FullRepairFlow', flow, done !== false);
                    }
                },
                onRightClick: this._actionPopup({ name: 'Full Repair', activation: 'Tool', detail: localize('LA.tokenHud.detail.fullRepair') }) },
            { label: localize('LA.tokenHud.label.linkToToken'),
                icon: 'modules/lancer-automations/icons/pin.svg',
                onClick: async () =>
                {
                    const api = /** @type {any} */ (game.modules.get(MODULE_ID))?.api;
                    const picked = await api?.chooseToken?.(token, { count: 1, includeSelf: false, title: localize('LA.dialogTitle.linkToToken'), description: `Which token should ${escapeHtml(token.name)} be linked to?`, icon: 'cci cci-deployable' });
                    if (!picked || !picked.length)
                        return;
                    const target = picked[0];
                    await setLAFlag(token.document,'ownerActorUuid', target.actor.uuid);
                    await setLAFlag(token.document,'ownerName', target.actor.name ?? '');
                },
                onRightClick: this._actionPopup({ name: 'Link to Token', activation: 'Tool', detail: localize('LA.tokenHud.detail.linkToToken') }) },
            ...(isMechOrNpc ? [
                {
                    label: localize('LA.tokenHud.label.structure'),
                    icon: 'systems/lancer/assets/icons/macro-icons/condition_shredded.svg',
                    onClick: async () =>
                    {
                        await actor?.update({ 'system.hp.value': 0 });
                        /** @type {any} */ (actor)?.beginStructureFlow();
                    },
                    onRightClick: this._actionPopup({ name: 'Structure', activation: 'Tool', detail: localize('LA.tokenHud.detail.structure') }),
                },
                {
                    label: localize('LA.tokenHud.label.overheat'),
                    icon: 'systems/lancer/assets/icons/macro-icons/damage_heat.svg',
                    onClick: async () =>
                    {
                        const maxHeat = actor?.system?.heat?.max ?? 0;
                        await actor?.update({ 'system.heat.value': maxHeat });
                        /** @type {any} */ (actor)?.beginOverheatFlow();
                    },
                    onRightClick: this._actionPopup({ name: 'Overheat', activation: 'Tool', detail: localize('LA.tokenHud.detail.overheat') }),
                },
                { label: localize('LA.tokenHud.label.suicide'),          icon: 'modules/lancer-automations/icons/suicide.svg',   onClick: () => actor?.update({ 'system.structure.value': 0, 'system.stress.value': 0, 'system.hp.value': 0 }), onRightClick: this._actionPopup({ name: 'Suicide', activation: 'Tool', detail: localize('LA.tokenHud.detail.suicide') }) },
                { label: localize('LA.tokenHud.label.reactorExplosion'), icon: 'modules/lancer-automations/icons/mushroom-cloud.svg', onClick: () => executeReactorExplosion(token), onRightClick: this._actionPopup({ name: 'Reactor Explosion', activation: 'Tool', detail: localize('LA.tokenHud.detail.reactorExplosion') }) },
            ] : []),
            ...(getLAFlag(token.document,'isWreck') ? [
                { label: localize('LA.tokenHud.label.resurrect'), icon: 'modules/lancer-automations/icons/angel-outfit.svg', onClick: () => resurrect(token), onRightClick: this._actionPopup({ name: 'Resurrect', activation: 'Tool', detail: localize('LA.tokenHud.detail.resurrect') }) },
            ] : []),
            ...(actor?.type === 'npc' ? [
                { label: localize('LA.tokenHud.label.recharge'), icon: 'modules/lancer-automations/icons/ammo-box.svg', onClick: () => /** @type {any} */ (actor).beginRechargeFlow(), broadcastFn: (_token, targetActor) => /** @type {any} */ (targetActor).beginRechargeFlow(), onRightClick: this._actionPopup({ name: 'Recharge', activation: 'Tool', detail: localize('LA.tokenHud.detail.recharge') }) },
                { label: localize('LA.tokenHud.label.reloadWeapon'), icon: 'mdi mdi-magazine-rifle',       onClick: () => reloadOneWeapon(token), broadcastFn: (targetToken) => reloadOneWeapon(targetToken), onRightClick: this._actionPopup({ name: 'Reload Weapon', activation: 'Tool', detail: localize('LA.tokenHud.detail.reloadWeapon') }) },
            ] : []),
            { label: localize('LA.tokenHud.label.generateScan'), icon: 'mdi mdi-qrcode-scan', onClick: () => executeGenerateScan(this._tokens?.length ? this._tokens : [token]), onRightClick: this._actionPopup({ name: 'Generate Scan', activation: 'Tool', detail: localize('LA.tokenHud.detail.generateScan') }) },
            this._utilityRow('effectManager'),
            { label: localize('LA.tokenHud.label.reinforcement'), icon: 'modules/lancer-automations/icons/rally-the-troops.svg', onClick: () => delayedTokenAppearance(), onRightClick: this._actionPopup({ name: 'Reinforcement', activation: 'Tool', detail: localize('LA.tokenHud.detail.reinforcement') }) },
            { label: token.document.hidden ? 'Reveal Token' : 'Hide Token', icon: 'systems/lancer/assets/icons/white/status_hidden.svg', onClick: () => token.document.update({ hidden: !token.document.hidden }), onRightClick: this._actionPopup({ name: 'Hide / Reveal Token', activation: 'Tool', detail: localize('LA.tokenHud.detail.hideRevealToken') }) },
        ];

        const ap = action => this._actionPopup(action);
        const movementItems = [
            { label: localize('LA.tokenHud.label.knockback'),      icon: 'modules/lancer-automations/icons/push.svg', onClick: () => knockBackToken([token], -1, { title: localize('LA.card.knockback'), description: 'Place each token at its knockback destination.', urgent: false }), onRightClick: ap({ name: 'Knockback', activation: 'Movement', detail: 'Move tokens to picked destinations as forced movement.' }) },
            this._lockable({ label: localize('LA.tokenHud.label.teleport'), icon: 'modules/lancer-automations/icons/teleport.svg', onClick: () => executeTeleport(token), broadcastFn: (_token, targetActor) => executeTeleport(targetActor.getActiveTokens()?.[0]), onRightClick: ap({ name: 'Teleport', activation: 'Movement', detail: 'Teleport to a destination within your speed range. Costs speed in movement.' }) }, 'Teleport'),
            { label: localize('LA.tokenHud.label.fall'), icon: 'modules/lancer-automations/icons/falling.svg', onClick: () => executeFall(token), onRightClick: ap({ name: 'Fall', activation: 'Movement', detail: 'Drop to ground level and take falling damage.' }) },
            { label: localize('LA.tokenHud.label.resetHistory'),  icon: 'modules/lancer-automations/icons/trash-can.svg', onClick: () => clearMovementHistory(token, false), onRightClick: ap({ name: 'Reset History', activation: 'Movement', detail: 'Clear this token\'s recorded movement history.' }) },
            { label: localize('LA.tokenHud.label.revertLastMovement'), icon: 'modules/lancer-automations/icons/anticlockwise-rotation.svg', onClick: () => revertMovement(token), onRightClick: ap({ name: 'Revert Last Movement', activation: 'Movement', detail: 'Move the token back along its last recorded move.' }) },
            { label: localize('LA.tokenHud.label.revertAllMovements'), icon: 'modules/lancer-automations/icons/backward-time.svg', onClick: () => clearMovementHistory(token, true), onRightClick: ap({ name: 'Revert All Movements', activation: 'Movement', detail: 'Move the token back to where its history started.' }) },
            {
                inputCell: true,
                subtype: 'type',
                name: 'Move Cap',
                icon: 'modules/lancer-automations/icons/path-distance.svg',
                getValue: () => game.modules.get(MODULE_ID)?.api?.getMovementCap(token) ?? 0,
                onValueChanged: (newVal) =>
                {
                    const api = game.modules.get(MODULE_ID)?.api;
                    if (!api)
                        return;
                    api.increaseMovementCap(token, newVal - api.getMovementCap(token));
                },
            },
        ];

        // Ranges section: Advanced Measure state proxies (no GAA auras).
        const threatVal = getActorMaxThreat(actor);
        const sensorVal = actor?.type === 'pilot' ? 5 : getSensorRange_WithBonus(actor);
        const reachVal = getActorMaxReach_WithBonus(actor);
        const amIsActive = () =>
        {
            if (!isAdvancedMeasureActive())
                return false;
            const st = getAdvancedMeasureState();
            return !!st.pulseEnabled;
        };
        const amSourceMatches = (source) => amIsActive() && getAdvancedMeasureState().rangeSource === source;
        const togglePin = (source, opts) =>
        {
            if (!isAdvancedMeasureActive() && !hasRangePin(token, source, opts?.weaponItemId ?? null))
                openAdvancedMeasureWithState({});
            toggleRangePin(token, source, opts);
        };

        const rangeItems = [
            {
                inputCell: true,
                subtype: 'toggle',
                name: `Threat (${threatVal})`,
                icon: 'systems/lancer/assets/icons/white/threat.svg',
                getValue: () => hasRangePin(token, 'threat'),
                onToggle: () => togglePin('threat'),
            },
            {
                inputCell: true,
                subtype: 'toggle',
                name: `Sensors (${sensorVal})`,
                icon: 'systems/lancer/assets/icons/white/sensor.svg',
                getValue: () => hasRangePin(token, 'sensor'),
                onToggle: () => togglePin('sensor'),
            },
            {
                inputCell: true,
                subtype: 'toggle',
                name: `Max Reach (${reachVal})`,
                icon: 'modules/lancer-automations/icons/nested-hexagons.svg',
                getValue: () => hasRangePin(token, 'reach'),
                onToggle: () => togglePin('reach'),
            },
            ...(isLancerRulerActive() ? [{
                inputCell: true,
                subtype: 'toggle',
                name: `Movement (${actor?.system?.speed ?? 0})`,
                icon: 'fa-solid fa-person-running',
                getValue: () => isAdvancedMeasureActive() && getAdvancedMeasureState().movementReachEnabled,
                onToggle: (on) =>
                {
                    if (on)
                        openAdvancedMeasureWithState({ movementReachEnabled: true });
                    else
                        setAdvancedMeasureState({ movementReachEnabled: false });
                },
            }] : []),
            { isSectionLabel: true, label: localize('LA.tokenHud.label.custom') },
            {
                inputCell: true,
                subtype: 'increment',
                name: 'Size',
                icon: 'systems/lancer/assets/icons/white/range.svg',
                noColor: true,
                min: 1,
                max: 100,
                getValue: () => getLAFlag(token.document,'customMeasureSize') ?? 10,
                onValueChanged: async (newVal) =>
                {
                    await setLAFlag(token.document,'customMeasureSize', newVal);
                    if (amSourceMatches('manual'))
                        setAdvancedMeasureState({ manualRadius: newVal });
                    if (hasRangePin(token, 'manual'))
                    {
                        toggleRangePin(token, 'manual');
                        toggleRangePin(token, 'manual', { range: newVal });
                    }
                },
            },
            {
                inputCell: true,
                subtype: 'toggle',
                name: 'Measure',
                icon: 'systems/lancer/assets/icons/white/range.svg',
                getValue: () => hasRangePin(token, 'manual'),
                onToggle: () =>
                {
                    const size = getLAFlag(token.document,'customMeasureSize') ?? 10;
                    togglePin('manual', { range: size });
                },
            },
        ];

        return {
            label: localize('LA.tokenHud.label.utility'),
            colLabel: localize('LA.tokenHud.label.utility'),
            icon: 'modules/lancer-automations/icons/tinker.svg',
            noCount: true,
            getItems: () => [
                { label: localize('LA.tokenHud.label.gameplay'),  childColLabel: localize('LA.tokenHud.label.gameplay'),  icon: 'modules/lancer-automations/icons/pawn.svg', getChildren: () => gameplayItems },
                { label: localize('LA.tokenHud.label.movement'),  childColLabel: localize('LA.tokenHud.label.movement'),  icon: 'mdi mdi-arrow-right-bold-hexagon-outline', getChildren: () => movementItems },
                ...(rangeItems.length > 0 ? [{ label: localize('LA.tokenHud.label.measures'), childColLabel: localize('LA.tokenHud.label.measures'), icon: 'mdi mdi-ruler-square-compass', getChildren: () => rangeItems }] : []),
                { label: localize('LA.tokenHud.label.log'), icon: 'modules/lancer-automations/icons/checklist.svg', isLogPanel: true },
                { label: localize('LA.tokenHud.label.glossary'), icon: 'systems/lancer/assets/icons/compendium.svg', isGlossaryPanel: true },
                { label: localize('LA.tokenHud.label.misc'),
                    childColLabel: localize('LA.tokenHud.label.misc'),
                    icon: 'modules/lancer-automations/icons/open-folder.svg',
                    getChildren: () => [
                        this._utilityRow('vote'),
                        this._utilityRow('downtime'),
                        ...(actor?.type === 'npc' || actor?.type === 'deployable' ? [] : [
                            this._utilityRow('reserve', token),
                            this._utilityRow('clocksBurdens', token),
                            this._utilityRow('rest', token),
                        ]),
                        { label: localize('LA.tokenHud.label.addExtra'),
                            icon: 'modules/lancer-automations/icons/files.svg',
                            onClick: () => openExtrasDialog(actor),
                            onRightClick: ap({ name: 'Add Extra', activation: 'Tool', detail: 'Attach extra actions, deployables, or resource bars to the actor.' }) },
                    ] },
            ],
        };
    }

    _catSystems()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.systems'),
            colLabel: localize('LA.tokenHud.label.systems'),
            icon: 'systems/lancer/assets/icons/mech_system.svg',
            getItems: () =>
            {
                const systems = (actor.system?.loadout?.systems ?? [])
                    .map(/** @type {any} */ entry => entry?.value)
                    .filter(/** @type {any} */ item => !!item);
                if (!systems.length)
                    return [];
                return systems.map(item =>
                {
                    const sys = item.system;
                    return this._itemRow(item, {
                        icon: item.img ?? null,
                        category: 'Systems',
                        childColLabel: item.name,
                        getChildren: () => this._systemChildren(item, actor),
                        onRightClick: (row) =>
                        {
                            const actionsHtml = (sys.actions ?? []).map(/** @type {any} */ action =>
                            {
                                const det = action.detail ? `<div style="font-size:0.77em;color:#bbb;margin-top:2px;">${laFormatDetailHtml(action.detail)}</div>` : '';
                                const cost = Number(action.cost) || 1;
                                return `<div style="margin-top:6px;padding:4px;background:rgba(255,255,255,0.04);border-radius:3px;"><div style="font-size:0.78em;font-weight:bold;color:#e8a020;">[${escapeHtml(action.activation)}] ${escapeHtml(action.name)} <span style="color:#888;font-weight:normal;">Cost: ${cost}</span></div>${det}</div>`;
                            }).join('');
                            const depLids = getItemDeployables(item, actor);
                            const depActors = depLids.map(lid => getDeployableInfoSync(lid, actor)).filter(Boolean);
                            const deployablesHtml = depActors.length ? laRenderDeployables(depActors) : '';
                            const ammoHtml = (sys.ammo ?? []).filter(ammo => ammo.name).map(ammo =>
                            {
                                const cost = ammo.cost ?? 1;
                                return `<div style="margin-top:4px;padding:3px 4px;background:rgba(255,255,255,0.04);border-radius:3px;">
                                    <div style="font-size:0.78em;font-weight:bold;color:#1a8a3a;">${escapeHtml(ammo.name)} <span style="color:#888;font-weight:normal;">Cost: ${cost}</span></div>
                                    ${ammo.description ? `<div style="font-size:0.75em;color:#bbb;margin-top:1px;">${ammo.description}</div>` : ''}
                                </div>`;
                            }).join('');
                            const ammoSection = ammoHtml ? `<div style="margin-top:4px;"><div style="font-size:0.72em;font-weight:bold;color:#888;text-transform:uppercase;margin-bottom:2px;">Ammo</div>${ammoHtml}</div>` : '';
                            const bodyHtml = this._bodyHtml(sys) + actionsHtml + deployablesHtml + ammoSection;
                            const subtitle = this._joinSubtitle(sys.type, sys.license ? `${sys.manufacturer} ${sys.license_level}` : null);
                            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'system-id', dataValue: item.id, title: item.name, subtitle, bodyHtml, theme: 'system', item, row });
                        },
                    });
                });
            },
        };
    }

    _systemChildren(/** @type {any} */ item, /** @type {any} */ actor)
    {
        const sys = item.system;
        const ap = act => this._actionPopup(act, item);
        const children = [];
        const activationTag = (sys.tags ?? []).find(/** @type {any} */ tag => ACTIVATION_TAGS.includes(tag.lid));
        const sysActions = sys.actions ?? [];
        const hidePrimary = isPrimaryActionHidden(item);
        if (!hidePrimary && sysActions.length <= 1)
        {
            const single = sysActions[0] ?? null;
            const actStr = single?.activation ?? (activationTag ? activationTag.lid.replace('tg_', '').replace('_action', ' action') : 'Activation');
            const singleName = single ? actionDisplayName(item, single) : item.name;
            children.push(this._lockable(this._itemRow(item, {
                label: singleName,
                action: single ?? { name: item.name, activation: actStr },
                category: 'Systems',
                icon: single ? getActivationIcon(single) : (activationTag ? getActivationIcon(actStr) : 'systems/lancer/assets/icons/activate.svg'),
                onClick: single ? () => /** @type {any} */ (item).beginActivationFlow('system.actions.0') : () => /** @type {any} */ (item).beginSystemFlow(),
                onRightClick: single ? ap(single)
                    : activationTag ? (/** @type {any} */ row) =>
                    {
                        const subtitle = this._joinSubtitle(sys.type, sys.license ? `${sys.manufacturer} ${sys.license_level}` : null);
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'sys-activate', dataValue: item.id, title: item.name, subtitle, bodyHtml: this._bodyHtml(sys), theme: 'system', item, row });
                    }
                        : ap({ name: item.name, activation: 'Activation', detail: 'Default system activation.' }),
            }), singleName, actStr));
        }
        else if (!hidePrimary)
        {
            sysActions.forEach((action, idx) =>
            {
                const name = actionDisplayName(item, action);
                children.push(this._lockable(this._itemRow(item, {
                    label: name,
                    action,
                    category: 'Systems',
                    icon: getActivationIcon(action),
                    onClick: () => /** @type {any} */ (item).beginActivationFlow(`system.actions.${idx}`),
                    onRightClick: ap(action),
                }), name, action.activation));
            });
        }
        const sysActionNames = new Set((sys.actions ?? []).map(/** @type {any} */ action => action.name));
        const invadeOpts = this._getInvadeOptions(actor).filter(opt => opt.item?.id === item.id && !sysActionNames.has(opt.name));
        for (const opt of invadeOpts)
        {
            children.push(this._lockable({
                label: opt.name,
                labelHtml: opt.destroyed ? this._destroyedLabel(opt.name) : undefined,
                icon: ICON_TECH_QUICK,
                badge: opt.badge ?? null,
                badgeTone: opt.badgeTone ?? null,
                ...this._statusColors(opt),
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (/** @type {any} */ row) => this._buildInvadePopup(opt, row),
            }, opt.name, 'Quick Tech'));
        }
        children.push({ isSectionLabel: true, label: localize('LA.tokenHud.label.deployables') });
        for (const lid of getItemDeployables(item, actor))
            children.push(this._deployRow(actor, lid, item, { itemRow: true }));
        children.push({ isSectionLabel: true, label: localize('LA.tokenHud.label.ammo') });
        (sys.ammo ?? []).forEach((ammo, idx) =>
        {
            if (ammo.name)
                children.push(this._ammoRow(actor, item, ammo, idx, { category: 'Systems', subtitle: `Ammo · ${item.name}` }));
        });
        return children;
    }

    _ammoRow(actor, sysItem, ammo, idx, { category, subtitle })
    {
        const cost = ammo.cost ?? 1;
        return {
            label: `${ammo.name}`,
            badge: `${cost}`,
            badgeTone: 'ok',
            icon: 'systems/lancer/assets/icons/ammo.svg',
            hoverData: { actor, item: sysItem, action: { name: ammo.name, activation: 'Ammo' }, category },
            onClick: () =>
            {
                TriggerUseAmmoFlow(sysItem.uuid, idx);
            },
            onRightClick: (/** @type {any} */ row) =>
            {
                const sizeTags = _ammoTagsHtml(ammo.allowed_sizes);
                const typeTags = _ammoTagsHtml(ammo.allowed_types);
                const bodyHtml = `${ammo.description ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${ammo.description}</div>` : ''}
                    <div style="font-size:0.75em;color:#888;margin-top:4px;">Cost: ${cost}${sizeTags}${typeTags}</div>`;
                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-ammo-popup', dataKey: 'ammo-idx', dataValue: `${sysItem.id}-${idx}`, title: ammo.name, subtitle, bodyHtml, theme: 'system', item: sysItem, row, v3Scope: false });
            },
        };
    }

    _catFrame()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.frame'),
            colLabel: localize('LA.tokenHud.label.frame'),
            icon: 'systems/lancer/assets/icons/frame.svg',
            noCount: true,
            getItems: () =>
            {
                const frame = actor?.system?.loadout?.frame?.value;
                if (!frame)
                    return [];
                const sys = frame.system;
                const actorSystem = actor.system;
                const frameSubtitle = this._joinSubtitle(sys.manufacturer, sys.license ? `LL${sys.license_level}` : null, ...(sys.mechtype ?? []), actorSystem.size != null ? `Size ${actorSystem.size}` : null);
                const repairs = actorSystem.repairs?.max ?? actorSystem.repcap;
                const frameStats = sys.stats ?? {};
                const statsGrids = this._statsGrids([
                    ['HP', actorSystem.hp?.max, frameStats.hp], ['Armor', actorSystem.armor, frameStats.armor], ['E-Def', actorSystem.edef, frameStats.edef], ['Evasion', actorSystem.evasion, frameStats.evasion], ['Heat', actorSystem.heat?.max, frameStats.heatcap],
                    ['Speed', actorSystem.speed, frameStats.speed], ['Sensors', actorSystem.sensor_range, frameStats.sensor_range], ['Save', actorSystem.save, frameStats.save], ['Tech', actorSystem.tech_attack, frameStats.tech_attack], ['Repairs', repairs, frameStats.repcap],
                ], 5, 'Base Stats');
                const currentStats = statsGrids.current;
                const mountCounts = (sys.mounts ?? []).reduce((/** @type {any} */ acc, /** @type {any} */ m) =>
                {
                    acc[m] = (acc[m] ?? 0) + 1;
                    return acc;
                }, {});
                const mountsHtml = Object.keys(mountCounts).length ? `<div style="font-size:0.8em;color:#888;margin-top:2px;border-top:1px solid #2a2a2a;padding-top:5px;">${Object.entries(mountCounts).map(([m, n]) => `${n > 1 ? n + '× ' : ''}${m}`).join(' · ')}</div>` : '';
                const baseStats = sys.stats ? statsGrids.base : '';
                const rows = /** @type {any[]} */ ([
                    {
                        label: frame.name,
                        labelHtml: escapeHtml(frame.name) + rankSuffix(actor),
                        stableKey: frame.uuid,
                        icon: 'systems/lancer/assets/icons/frame.svg',
                        onClick: () => /** @type {any} */ (frame).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'frame-id', dataValue: frame.id, title: frame.name, subtitle: frameSubtitle, bodyHtml: currentStats + mountsHtml + baseStats, theme: 'frame', item: frame, row }),
                    },
                    { label: localize('LA.tokenHud.label.corePower'),  childColLabel: localize('LA.tokenHud.label.corePower'),  icon: 'modules/lancer-automations/icons/materials-science.svg', getChildren: () => this._corePowerItems(frame, actor), onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-system', dataValue: frame.id, title: frame.system?.core_system?.name ?? 'Core System', subtitle: frame.name, bodyHtml: laRenderCoreSystemBody(frame.system?.core_system), theme: 'frame', item: frame, row, v3Scope: { type: 'core' } }) },
                ]);
                const intLids = [
                    ...(frame.system?.traits ?? []).flatMap((/** @type {any} */ t) => t.integrated ?? []),
                    ...(frame.system?.core_system?.integrated ?? []),
                ];
                const intDepLids = /** @type {string[]} */ (frame.system?.core_system?.deployables ?? []);
                if (intLids.length || intDepLids.length)
                    rows.push({ label: localize('LA.tokenHud.label.integrated'), childColLabel: localize('LA.tokenHud.label.integrated'), icon: 'systems/lancer/assets/icons/system.svg', getChildren: () => this._frameIntegratedItems(frame, actor, intLids, intDepLids) });
                rows.push({ label: localize('LA.tokenHud.label.reserves'),    childColLabel: localize('LA.tokenHud.label.reserves'),    icon: 'systems/lancer/assets/icons/white/reserve_mech.svg', getChildren: () => this._catReserves({ source: resolvePilot(actor), typeFilter: 'Mech' }).getItems() });
                if (actor?.system?.overcharge_sequence)
                {
                    const ocSeq = actor.system.overcharge_sequence.split(',').map(part => part.trim());
                    rows.push({
                        inputCell: true,
                        subtype: 'increment',
                        name: 'Overcharge',
                        icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg',
                        noColor: true,
                        min: 0,
                        max: ocSeq.length - 1,
                        getValue: () => actor?.system?.overcharge ?? 0,
                        formatValue: (step) => shortOverchargeTerm(ocSeq[step] ?? `${step}`),
                        onValueChanged: (newVal) => actor?.update({ 'system.overcharge': newVal }),
                    });
                }
                if (actor?.system?.repairs)
                {
                    rows.push({
                        inputCell: true,
                        subtype: 'increment',
                        name: 'Repairs',
                        icon: 'systems/lancer/assets/icons/macro-icons/repair.svg',
                        noColor: true,
                        min: 0,
                        max: actor.system.repairs.max ?? actor.system.repcap ?? 0,
                        getValue: () => actor?.system?.repairs?.value ?? 0,
                        onValueChanged: (newVal) => actor?.update({ 'system.repairs.value': newVal }),
                    });
                }
                rows.push(
                    { isSectionLabel: true, label: localize('LA.tokenHud.label.traits') },
                    ...this._frameTraitItems(frame, actor),
                    { isSectionLabel: true, label: localize('LA.tokenHud.label.coreBonus') },
                    ...this._coreBonusItems(actor),
                );
                return rows;
            },
        };
    }

    /** @param {{ source?: any, typeFilter?: string|null, excludeType?: string|null, label?: string }} [opts] */
    _catReserves({ source, typeFilter = null, excludeType = null, label = localize('LA.tokenHud.col.reserves') } = {})
    {
        return {
            label,
            colLabel: label,
            getItems: () =>
            {
                const reserves = (source?.items ?? []).filter(/** @type {any} */ item => item.type === 'reserve');
                let filtered = typeFilter ? reserves.filter(/** @type {any} */ reserve => (reserve.system?.type ?? '') === typeFilter) : reserves;
                if (excludeType)
                    filtered = filtered.filter(/** @type {any} */ reserve => (reserve.system?.type ?? '') !== excludeType);
                if (!filtered.length)
                    return [];
                const TYPE_ORDER  = ['Mech', 'Tactical', 'Project', 'Organization', 'Resources', 'Resource', 'Bonus'];
                const TYPE_ICON   = { Mech: 'cci cci-reserve-mech', Organization: 'mdi mdi-account-multiple', Project: 'cci cci-orbital', Resources: 'cci cci-reserve-resource', Resource: 'cci cci-reserve-resource', Tactical: 'cci cci-reserve-tac', Bonus: 'cci cci-accuracy' };
                const buckets = {};
                for (const reserve of filtered)
                {
                    const reserveType = reserve.system?.type ?? 'Other';
                    (buckets[reserveType] = buckets[reserveType] || []).push(reserve);
                }
                const keys = TYPE_ORDER.filter(key => buckets[key]).concat(Object.keys(buckets).filter(key => !TYPE_ORDER.includes(key)));
                const items = [];
                const useSections = !typeFilter;
                for (const key of keys)
                {
                    if (useSections && keys.length > 1)
                        items.push({ isSectionLabel: true, label: key.toUpperCase() });
                    // Merge identical reserves; consumable (has usage) never merges with non-consumable.
                    const groups = new Map();
                    const groupOrder = [];
                    for (const res of buckets[key])
                    {
                        const identity = `${res.system?.consumable ? 'C' : 'N'}|${res.system?.lid || `${res.name}::${res.system?.type ?? key}`}`;
                        if (!groups.has(identity))
                        {
                            groups.set(identity, []);
                            groupOrder.push(identity);
                        }
                        groups.get(identity).push(res);
                    }
                    for (const identity of groupOrder)
                    {
                        const group = groups.get(identity);
                        const rep = group[0];
                        const sys = rep.system ?? {};
                        const icon = TYPE_ICON[key] ?? 'cci cci-reserve-tac';
                        const baseLabel = rep.name || sys.label;
                        let badge = null;
                        let badgeTone = null;
                        let statusKind = null;
                        if (sys.consumable)
                        {
                            const available = group.filter(/** @type {any} */ copy => !copy.system?.used).length;
                            badge = `${available}/${group.length}`;
                            badgeTone = available <= 0 ? 'bad' : (available < group.length ? 'warn' : 'ok');
                            if (available <= 0)
                                statusKind = 'spent';
                        }
                        else if (group.length > 1)
                        {
                            badge = `×${group.length}`;
                            badgeTone = 'neutral';
                        }
                        items.push({
                            label: baseLabel,
                            icon,
                            statusKind,
                            badge,
                            badgeTone,
                            hoverData: { actor: source, item: rep, action: null, category: 'Reserves' },
                            onClick: sys.consumable
                                ? () => this._consumeReserveGroup(group)
                                : () => /** @type {any} */ (rep).sheet.render(true),
                            onRightClick: (/** @type {any} */ row) =>
                            {
                                const bodyHtml = this._bodyHtml(sys) + laRenderActions(sys.actions ?? []);
                                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-reserve-popup', dataKey: 'reserve-id', dataValue: rep.id, title: baseLabel, subtitle: `Reserve · ${key}`, bodyHtml, theme: 'resource', item: rep, row, pips: false, postRender: (popup) => appendReservePips(group, popup) });
                            },
                        });
                    }
                }
                return items;
            },
        };
    }

    async _consumeReserveGroup(group)
    {
        const next = (group ?? []).find(/** @type {any} */ copy => !copy.system?.used);
        if (!next)
        {
            ui.notifications?.info(localize('LA.notify.allCopiesOfThisReserveAreAlready'));
            return;
        }
        if (!isAutoConsumeDisabled(group[0], 'reserveUsed'))
            await next.update({ 'system.used': true });
        game.lancer?.beginItemChatFlow?.(next, {})?.catch?.(() => null);
    }

    _catPilot()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.pilot'),
            colLabel: localize('LA.tokenHud.label.pilot'),
            icon: 'mdi mdi-card-account-details-star-outline',
            noCount: true,
            getItems: () =>
            {
                const actorSys = actor.system ?? {};
                const armor = (actorSys.loadout?.armor ?? [])[0]?.value ?? null;

                const grit = actorSys.grit ?? Math.floor((actorSys.level ?? 0) / 2);
                const base = { hp: 6 + grit, armor: 0, edef: 10, evasion: 10, speed: 4 };
                const cur  = { hp: actorSys.hp?.max, armor: actorSys.armor, edef: actorSys.edef, evasion: actorSys.evasion, speed: actorSys.speed };

                const statsGrids = this._statsGrids([
                    ['HP',      cur.hp,      base.hp],
                    ['Armor',   cur.armor,   base.armor],
                    ['E-Def',   cur.edef,    base.edef],
                    ['Evasion', cur.evasion, base.evasion],
                    ['Speed',   cur.speed,   base.speed],
                ], 5, 'Base Stats (no armor)');
                const currentStats = statsGrids.current;
                const haseRow = `<div style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;">${this._statsGrids([
                    ['HULL', actorSys.hull],
                    ['AGI',  actorSys.agi],
                    ['SYS',  actorSys.sys],
                    ['ENG',  actorSys.eng],
                    ['Grit', grit],
                ], 5).current}</div>`;
                const baseStats = statsGrids.base;

                const pilotSubtitle = this._joinSubtitle(actorSys.callsign, actorSys.player_name, actorSys.level != null ? `LL${actorSys.level}` : null);

                const armorBody = armor
                    ? (laRenderTags(armor.system?.tags ?? []) + (armor.system?.description ? `<div style="margin-bottom:8px;font-size:0.82em;line-height:1.5;color:#bbb;">${laFormatDetailHtml(armor.system.description)}</div>` : '') + (armor.system?.effect ? `<div style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;font-size:0.82em;line-height:1.5;color:#bbb;">${laFormatDetailHtml(armor.system.effect)}</div>` : '') + laRenderActions(armor.system?.actions ?? []))
                    : '<div style="font-size:0.82em;color:#bbb;line-height:1.5;">The pilot wears no armor.</div>';

                return [
                    {
                        label: actor.name,
                        labelHtml: escapeHtml(actor.name) + rankSuffix(actor),
                        stableKey: actor.uuid,
                        icon: 'systems/lancer/assets/icons/pilot.svg',
                        onClick: () => /** @type {any} */ (actor).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'pilot-id', dataValue: actor.id, title: actor.name, subtitle: pilotSubtitle, bodyHtml: currentStats + haseRow + baseStats, theme: 'frame', item: null, row }),
                    },
                    {
                        label: armor ? armor.name : 'NO ARMOR',
                        stableKey: armor?.uuid,
                        icon: armor?.img ?? 'systems/lancer/assets/icons/role_tank.svg',
                        onClick: () => armor && /** @type {any} */ (armor).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: armor ? 'armor-id' : 'no-armor', dataValue: armor ? armor.id : actor.id, title: armor ? armor.name : 'No Armor', subtitle: 'Pilot Armor', bodyHtml: armorBody, theme: 'system', item: armor, row }),
                    },
                    ...this._clockRows(actor),
                    ...this._reserveRows(actor),
                    ...this._bondRows(actor),
                ];
            },
        };
    }

    _reserveRows(/** @type {any} */ actor)
    {
        const listRows = () => this._catReserves({ source: actor, excludeType: 'Mech' }).getItems()
            .filter(/** @type {any} */ row => !row.isSectionLabel);
        const count = listRows().length;
        if (!count)
            return [];
        const label = localize('LA.tokenHud.label.reserves');
        return [{
            label,
            icon: 'systems/lancer/assets/icons/white/reserve_mech.svg',
            childColLabel: label,
            childCount: count,
            getChildren: () => [...listRows(), {
                label: localize('LA.tokenHud.label.add'),
                icon: 'mdi mdi-plus',
                keepOpen: true,
                onClick: () =>
                {
                    const api = /** @type {any} */ (game.modules.get(MODULE_ID))?.api;
                    api?.openAddReserveDialog?.(actor);
                },
            }],
        }];
    }

    _clockRows(/** @type {any} */ actor)
    {
        const pilot = resolvePilot(actor);
        if (!pilot)
            return [];
        const hasBond = pilotHasBond(pilot);
        const clocks = getCounters(pilot, 'clocks').length;
        const burdens = hasBond ? getCounters(pilot, 'burdens').length : 0;
        // The row names everything it holds; the child column names only its first group.
        const firstKey = clocks || !burdens ? 'LA.tokenHud.label.clocks' : 'LA.tokenHud.label.burdens';
        return [{
            label: localize(clocks && burdens ? 'LA.tokenHud.label.clocksBurdens' : firstKey),
            icon: 'mdi mdi-clock-outline',
            childColLabel: localize(firstKey),
            childCount: clocks + burdens,
            getChildren: () => this._clockChildren(pilot, hasBond),
        }];
    }

    _clockChildren(/** @type {any} */ pilot, /** @type {boolean} */ hasBond)
    {
        const rows = [];
        // The column header already names the first group; only later groups need a label.
        const addKind = (/** @type {string} */ kind, /** @type {boolean} */ bad, /** @type {string} */ sectionKey) =>
        {
            const counters = getCounters(pilot, kind);
            if (!counters.length)
                return;
            if (rows.length)
                rows.push({ isSectionLabel: true, label: localize(sectionKey) });
            counters.forEach((/** @type {any} */ counter, /** @type {number} */ index) =>
            {
                rows.push({
                    inputCell: true,
                    subtype: 'pips',
                    name: counter.name || localize('LA.clocks.unnamed'),
                    min: counter.min ?? 0,
                    max: counter.max ?? 6,
                    bad,
                    getValue: () => getCounters(pilot, kind)[index]?.value ?? 0,
                    onValueChanged: (/** @type {number} */ newVal) => setCounterValue(pilot, kind, index, newVal),
                    onRightClick: (/** @type {any} */ cell) => this._openRowActionsPopup(counter.name || localize('LA.clocks.unnamed'), localize(sectionKey), [{
                        label: localize('LA.common.remove'),
                        icon: 'fas fa-trash',
                        danger: true,
                        onClick: async () =>
                        {
                            const liveIndex = counter.lid ? getCounters(pilot, kind).findIndex((/** @type {any} */ entry) => entry.lid === counter.lid) : index;
                            if (liveIndex < 0)
                                return;
                            await deleteCounter(pilot, kind, liveIndex);
                            this.scheduleRefresh();
                        },
                    }], cell),
                });
            });
        };
        addKind('clocks', false, 'LA.tokenHud.label.clocks');
        if (hasBond)
            addKind('burdens', true, 'LA.tokenHud.label.burdens');
        rows.push({
            label: localize('LA.tokenHud.label.add'),
            icon: 'mdi mdi-plus',
            keepOpen: true,
            onClick: () => openClocksDialog(pilot),
        });
        return rows;
    }

    _bondRows(/** @type {any} */ actor)
    {
        const bond = actor?.system?.bond ?? actor?.items?.find((/** @type {any} */ ownedItem) => ownedItem.type === 'bond') ?? null;
        if (!bond)
            return [];
        const bondState = actor.system?.bond_state ?? {};
        return [
            { isSectionLabel: true, label: localize('LA.tokenHud.label.bond') },
            {
                label: bond.name,
                icon: 'systems/lancer/assets/icons/bond.svg',
                isBondPanel: true,
                hoverData: { actor, item: bond, category: 'Bond' },
            },
            {
                inputCell: true,
                subtype: 'increment',
                name: 'Stress',
                icon: 'mdi mdi-brain',
                invertScale: true,
                step: 1,
                min: 0,
                max: bondState.stress?.max ?? 8,
                getValue: () => actor.system?.bond_state?.stress?.value ?? 0,
                onValueChanged: (/** @type {number} */ newVal) => actor.update({ 'system.bond_state.stress.value': newVal }),
            },
            {
                inputCell: true,
                subtype: 'increment',
                name: 'XP',
                icon: 'mdi mdi-head-cog-outline',
                noColor: true,
                step: 1,
                min: 0,
                max: bondState.xp?.max ?? 8,
                getValue: () => actor.system?.bond_state?.xp?.value ?? 0,
                onValueChanged: (/** @type {number} */ newVal) => actor.update({ 'system.bond_state.xp.value': newVal }),
            },
            {
                label: localize('LA.tokenHud.label.powers'),
                icon: 'modules/lancer-automations/icons/spiked-halo.svg',
                childColLabel: localize('LA.tokenHud.label.powers'),
                getChildren: () => this._bondPowerItems(bond),
            },
        ];
    }

    _bondPowerItems(/** @type {any} */ bond)
    {
        const rows = /** @type {any[]} */ ([]);
        const powers = /** @type {any[]} */ (bond.system?.powers ?? []);
        powers.forEach((power, powerIdx) =>
        {
            if (!power.unlocked)
                return;
            const uses = power.uses;
            const hasUses = !!uses && uses.max > 0;
            let badgeParts = null;
            if (hasUses)
            {
                const pips = [];
                for (let pip = 0; pip < uses.max; pip++)
                    pips.push(`<i class="mdi ${pip < uses.value ? 'mdi-calendar-today is-ready' : 'mdi-calendar-blank is-off'}"></i>`);
                badgeParts = { badge: pips.join(' '), badgeTone: uses.value <= 0 ? 'bad' : 'ok' };
            }
            rows.push({
                label: power.name,
                icon: power.master ? 'mdi mdi-rhombus-split' : power.veteran ? 'mdi mdi-rhombus-medium' : 'modules/lancer-automations/icons/spiked-halo.svg',
                ...(badgeParts ?? {}),
                onClick: () =>
                {
                    if (hasUses && uses.value <= 0)
                    {
                        ui.notifications.warn(localizeFormat('LA.notify.powerNoUsesLeft', { name: power.name }));
                        return;
                    }
                    executeItemActivation(bond, { path: `powers.${powerIdx}` });
                },
                onRightClick: (/** @type {any} */ row) =>
                {
                    const rank = power.master ? 'Master' : power.veteran ? 'Veteran' : 'Power';
                    const desc = laFormatDetailHtml(power.description ?? '');
                    const prereq = power.prerequisite
                        ? `<div style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;font-size:0.78em;color:#888;">${laFormatDetailHtml(power.prerequisite)}</div>`
                        : '';
                    const bodyHtml = ((desc ? `<div style="font-size:0.82em;line-height:1.5;color:#bbb;">${desc}</div>` : '') + prereq)
                        || '<div style="font-size:0.82em;color:#888;">No description.</div>';
                    this._showItemPopup({
                        cssClass: 'la-hud-popup la-hud-talent-popup',
                        dataKey: 'bond-power',
                        dataValue: `${bond.id}_${powerIdx}`,
                        title: power.name,
                        subtitle: this._joinSubtitle(rank, power.frequency || null, bond.name),
                        bodyHtml,
                        theme: 'talent',
                        item: bond,
                        skipExtras: true,
                        pips: false,
                        row,
                        postRender: (/** @type {any} */ popup) => appendBondPowerPips(bond, powerIdx, popup),
                    });
                },
            });
        });
        rows.push({
            label: localize('LA.tokenHud.label.unlockPower'),
            icon: 'mdi mdi-lock-open-plus-outline',
            onClick: () => this._openUnlockPowerDialog(bond),
        });
        return rows;
    }

    _openUnlockPowerDialog(/** @type {any} */ bond)
    {
        const locked = (/** @type {any[]} */ (bond.system?.powers ?? []))
            .map((power, powerIdx) => ({ power, powerIdx }))
            .filter(entry => !entry.power.unlocked);
        if (!locked.length)
        {
            ui.notifications.info(localize('LA.notify.allPowersOfThisBondAreUnlocked'));
            return;
        }
        const entriesHtml = locked.map(entry =>
        {
            const rank = entry.power.master ? ' <span style="color:#b8860b;font-size:0.8em;">[Master]</span>'
                : entry.power.veteran ? ' <span style="color:#4682b4;font-size:0.8em;">[Veteran]</span>'
                    : ' <span style="color:#888;font-size:0.8em;">[Power]</span>';
            const prereq = entry.power.prerequisite
                ? `<div style="font-size:0.8em;color:#888;margin-top:2px;">${entry.power.prerequisite}</div>`
                : '';
            return `<div class="lancer-item-card la-bond-unlock-entry" data-idx="${entry.powerIdx}" style="margin-bottom:6px;padding:8px;cursor:pointer;">
                <div class="lancer-item-content" style="flex:1;min-width:0;">
                    <div class="lancer-item-name">${escapeHtml(entry.power.name)}${rank}</div>
                    ${prereq}
                </div>
            </div>`;
        }).join('');
        const dialog = new Dialog({
            title: localize('LA.dialogTitle.unlockPower'),
            content: `
                <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                    <div class="lancer-dialog-title">UNLOCK POWER</div>
                    <div class="lancer-dialog-subtitle">${escapeHtml(bond.name)}</div>
                </div>
                <div style="max-height:400px;overflow-y:auto;">${entriesHtml}</div>`,
            buttons: {
                cancel: cancelButton(),
            },
            render: (/** @type {any} */ html) =>
            {
                html.find('.la-bond-unlock-entry').on('click', async (/** @type {any} */ ev) =>
                {
                    const powerIdx = Number($(ev.currentTarget).data('idx'));
                    await bond.update({ [`system.powers.${powerIdx}.unlocked`]: true });
                    dialog.close();
                });
            },
            default: 'cancel',
        }, {
            width: 420,
            classes: ['lancer-dialog-base', 'lancer-no-title'],
        });
        dialog.render(true);
    }

    _catPilotGear()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.gear'),
            colLabel: localize('LA.tokenHud.label.gear'),
            icon: 'mdi mdi-bag-personal-outline',
            getItems: () =>
            {
                const gear = (actor.system?.loadout?.gear ?? [])
                    .map(/** @type {any} */ slot => slot?.value)
                    .filter(/** @type {any} */ item => !!item);
                if (!gear.length)
                    return [];
                return gear.map(item =>
                {
                    const sys = item.system;
                    return this._itemRow(item, {
                        icon: item.img ?? null,
                        category: 'Gear',
                        childColLabel: item.name,
                        getChildren: () => this._pilotGearChildren(item, actor),
                        onRightClick: (/** @type {any} */ row) =>
                        {
                            const bodyHtml = this._bodyHtml(sys) + laRenderActions(sys.actions ?? []);
                            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'gear-id', dataValue: item.id, title: item.name, subtitle: 'Pilot Gear', bodyHtml, theme: 'system', item, row });
                        },
                    });
                });
            },
        };
    }

    _pilotGearChildren(/** @type {any} */ item, /** @type {any} */ actor)
    {
        const sys = item.system;
        const ap = act => this._actionPopup(act, item);
        const sysActions = applyActionOverlays(item, sys.actions ?? []);

        if (sysActions.length <= 1)
        {
            const single = sysActions[0] ?? null;
            const actStr = single?.activation ?? 'Quick';
            return [this._itemRow(item, {
                label: single?.name ?? item.name,
                action: single ?? { name: item.name, activation: actStr },
                category: 'Gear',
                icon: single ? getActivationIcon(single) : 'systems/lancer/assets/icons/activate.svg',
                onClick: single
                    ? () => /** @type {any} */ (item).beginActivationFlow('system.actions.0')
                    : () => executeSimpleActivation(actor, { title: item.name, action: { name: item.name, activation: actStr }, detail: sys.effect ?? '' }, { item }),
                onRightClick: single
                    ? ap(single)
                    : ap({ name: item.name, activation: actStr, detail: sys.effect ?? '' }),
            })];
        }

        return sysActions.map((/** @type {any} */ action, /** @type {number} */ idx) => this._itemRow(item, {
            label: action.name,
            action,
            category: 'Gear',
            icon: getActivationIcon(action),
            onClick: () => /** @type {any} */ (item).beginActivationFlow(`system.actions.${idx}`),
            onRightClick: ap(action),
        }));
    }

    _catNpcFrame()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.class'),
            colLabel: localize('LA.tokenHud.label.class'),
            noCount: true,
            icon: `systems/lancer/assets/icons/npc_tier_${Math.min(3, Math.max(1, /** @type {any} */ (this._actor?.system)?.tier ?? 1))}.svg`,
            getItems: () =>
            {
                const npcClass = /** @type {any} */ (actor.items.find(/** @type {any} */ item => item.type === 'npc_class'));
                const tier = /** @type {any} */ (actor.system)?.tier ?? 1;
                const tierClamped = Math.min(3, Math.max(1, tier));
                const tierIcon = `systems/lancer/assets/icons/npc_tier_${tierClamped}.svg`;
                if (!npcClass)
                    return [];
                const actorSys = /** @type {any} */ (actor.system) ?? {};
                const tierIdx = Math.max(0, Math.min(2, tierClamped - 1));
                const baseStats = npcClass.system?.base_stats?.[tierIdx] ?? {};
                const statsGrids = this._statsGrids([
                    ['HP',      actorSys.hp?.max ?? actorSys.hp,               baseStats.hp],
                    ['Armor',   actorSys.armor,                                baseStats.armor],
                    ['E-Def',   actorSys.edef,                                 baseStats.edef],
                    ['Evasion', actorSys.evasion,                              baseStats.evasion],
                    ['Heat',    actorSys.heat?.max ?? actorSys.heatcap,        baseStats.heatcap],
                    ['Speed',   actorSys.speed,                                baseStats.speed],
                    ['Sensors', actorSys.sensor_range,                         baseStats.sensor_range],
                    ['Save',    actorSys.save,                                 baseStats.save],
                    ['Act.',    actorSys.activations,                          baseStats.activations],
                    ['Struct',  actorSys.structure?.max ?? actorSys.structure, baseStats.structure],
                    ['Reactor', actorSys.stress?.max ?? actorSys.stress,       baseStats.stress],
                    null,
                    ['Hull',    actorSys.hull,                                 baseStats.hull],
                    ['Agility', actorSys.agi,                                  baseStats.agi],
                    ['Systems', actorSys.sys,                                  baseStats.sys],
                    ['Eng',     actorSys.eng,                                  baseStats.eng],
                ], 4, `Base Stats (Tier ${tierClamped})`);
                const bodyHtml = statsGrids.current + statsGrids.base;
                return [
                    {
                        label: npcClass.name,
                        labelHtml: escapeHtml(npcClass.name) + rankSuffix(actor),
                        stableKey: npcClass.uuid,
                        icon: tierIcon,
                        onClick: () => /** @type {any} */ (npcClass).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({
                            cssClass: 'la-hud-popup la-hud-npcclass-popup',
                            dataKey: 'npcclass-id',
                            dataValue: npcClass.id,
                            title: npcClass.name,
                            subtitle: this._joinSubtitle(
                                `Tier ${tierClamped}`,
                                npcClass.system?.role ? npcClass.system.role.charAt(0).toUpperCase() + npcClass.system.role.slice(1) : null,
                                actorSys.size != null ? `Size ${actorSys.size}` : (baseStats.size != null ? `Size ${baseStats.size}` : null),
                            ),
                            bodyHtml,
                            theme: 'frame',
                            item: npcClass,
                            row,
                        }),
                    },
                    { label: localize('LA.tokenHud.label.templates'), childColLabel: localize('LA.tokenHud.label.templates'), icon: 'systems/lancer/assets/icons/npc_template.svg', getChildren: () => this._npcTemplateItems(actor) },
                    { label: localize('LA.tokenHud.label.traits'),    childColLabel: localize('LA.tokenHud.label.traits'),    icon: 'systems/lancer/assets/icons/trait.svg', getChildren: () => this._npcTraitItems(actor) },
                ];
            },
        };
    }

    _npcTemplateItems(/** @type {any} */ actor)
    {
        const templates = actor.items.filter(/** @type {any} */ item => item.type === 'npc_template');
        return templates.map(/** @type {any} */ tmpl => ({
            label: tmpl.name,
            icon: tmpl.img ?? null,
            onClick: () => /** @type {any} */ (tmpl).sheet.render(true),
            onRightClick: (/** @type {any} */ row) =>
            {
                const desc = tmpl.system?.description
                    ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(tmpl.system.description)}</div>` : '';
                if (!desc)
                    return;
                this._showItemPopup({
                    cssClass: 'la-hud-popup la-hud-npctemplate-popup',
                    dataKey: 'npctemplate-id',
                    dataValue: tmpl.id,
                    title: tmpl.name,
                    subtitle: localize('LA.tokenHud.detail.template'),
                    bodyHtml: desc,
                    theme: 'frame',
                    item: tmpl,
                    row,
                });
            },
        }));
    }

    _npcTraitItems(/** @type {any} */ actor)
    {
        const traits = actor.items.filter(/** @type {any} */ item => item.type === 'npc_feature' && item.system.type === 'Trait');
        if (!traits.length)
            return [];
        return traits.map(/** @type {any} */ feat =>
        {
            const sys = feat.system;
            return this._itemRow(feat, {
                icon: feat.img ?? null,
                category: 'Traits',
                onClick: () => /** @type {any} */ (feat).beginSystemFlow(),
                broadcastFn: (_t, a) =>
                {
                    const feature = a.items.find(item => item.type === 'npc_feature' && item.system?.lid === sys.lid); if (feature) /** @type {any} */
                        (feature).beginSystemFlow();
                },
                onRightClick: (/** @type {any} */ row) =>
                {
                    const tagsHtml = laRenderTags(sys.tags ?? []);
                    const effect   = sys.effect ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(sys.effect)}</div>` : '';
                    const bodyHtml = tagsHtml + effect;
                    if (!bodyHtml)
                        return;
                    const origin = sys.origin?.name ? `${sys.origin.name} · ${sys.origin.type}` : '';
                    this._showItemPopup({
                        cssClass: 'la-hud-popup la-hud-npctrait-popup',
                        dataKey: 'npctrait-id',
                        dataValue: feat.id,
                        title: feat.name,
                        subtitle: origin,
                        bodyHtml,
                        theme: 'trait',
                        item: feat,
                        row,
                    });
                },
            });
        });
    }

    _catNpcSystems()
    {
        const actor = this._actor;
        const ACT_LABELS = /** @type {Record<string,string>} */ ({
            tg_quick_action: 'Quick Action',
            tg_full_action:  'Full Action',
            tg_protocol:     'Protocol',
            tg_reaction:     'Reaction',
            tg_free_action:  'Free Action',
        });
        return {
            label: localize('LA.tokenHud.label.systems'),
            colLabel: localize('LA.tokenHud.label.systems'),
            icon: 'systems/lancer/assets/icons/mech_system.svg',
            getItems: () =>
            {
                const features = actor.items.filter(/** @type {any} */ feat =>
                    feat.type === 'npc_feature' &&
                    (feat.system.type === 'System' || feat.system.type === 'Reaction')
                );
                if (!features.length)
                    return [];
                return /** @type {any[]} */ (features).map(item =>
                {
                    const sys = item.system;
                    const actTag = (sys.tags ?? []).find(/** @type {any} */ tag => ACTIVATION_TAGS.includes(tag.lid));
                    const TYPE_TO_ACTIVATION = { Reaction: 'Reaction', System: null, Tech: 'Quick Tech', Trait: null, Weapon: null };
                    const activation = actTag
                        ? actTag.lid.replace('tg_', '').replace('_action', ' action')
                        : (TYPE_TO_ACTIVATION[sys.type] ?? null);
                    const actLabel = actTag ? (ACT_LABELS[actTag.lid] ?? actTag.lid) : (activation ?? null);
                    const origin = sys.origin?.name ? `${sys.origin.name} · ${sys.origin.type}` : '';
                    const npcRightClick = (/** @type {any} */ row) =>
                    {
                        const trigger = sys.trigger ? `<div style="font-size:0.8em;color:#888;margin-bottom:4px;"><b>Trigger:</b> ${laFormatDetailHtml(sys.trigger)}</div>` : '';
                        const effect  = sys.effect  ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(sys.effect)}</div>` : '';
                        const npcAction = /** @type {any} */ ((sys.actions ?? []).find(/** @type {any} */ candidate => Number(candidate?.cost) > 0)) ?? null;
                        const cost = Number(npcAction?.cost) || 1;
                        const costLine = `<div style="font-size:0.8em;color:#888;margin-bottom:4px;"><b>Cost:</b> ${cost}</div>`;
                        const bodyHtml = laRenderTags(sys.tags ?? []) + costLine + trigger + effect;
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-npcsys-popup', dataKey: 'npcsys-id', dataValue: item.id, title: item.name, subtitle: this._joinSubtitle(actLabel ?? sys.type, origin), bodyHtml, theme: activation ? activationTheme(activation) : 'system', item, row });
                    };
                    const npcSysChildren = () =>
                    {
                        const sysActions = /** @type {any[]} */ (applyActionOverlays(item, sys.actions ?? []));
                        const extraActions = /** @type {any[]} */ (gateActions(
                            /** @type {any[]} */ (getLAFlag(item,'extraActions') || [])
                                .filter(/** @type {any} */ action => linkTierGate(action, actor, item)),
                            actor,
                            item
                        ));
                        const baseRows = [];
                        const hidePrimary = isPrimaryActionHidden(item);
                        if (!hidePrimary && sysActions.length <= 1)
                        {
                            const single = sysActions[0] ?? null;
                            const actStr = single?.activation ?? activation ?? 'Activation';
                            baseRows.push(this._lockable(this._itemRow(item, {
                                label: item.name,
                                action: { name: item.name, activation: actStr },
                                category: 'Systems',
                                icon: (single || activation) ? getActivationIcon({ ...(single ?? {}), name: item.name, activation: actStr }) : 'systems/lancer/assets/icons/activate.svg',
                                onClick: () => /** @type {any} */ (item).beginSystemFlow(),
                                onRightClick: npcRightClick,
                            }), item.name, actStr));
                        }
                        else if (!hidePrimary)
                        {
                            sysActions.forEach((action, idx) => baseRows.push(this._lockable(this._itemRow(item, {
                                label: actionDisplayName(item, action),
                                action,
                                category: 'Systems',
                                icon: getActivationIcon(action),
                                onClick: () => /** @type {any} */ (item).beginActivationFlow(`system.actions.${idx}`),
                                onRightClick: npcRightClick,
                            }), actionDisplayName(item, action), action.activation)));
                        }
                        const depLids = getItemDeployables(item, actor);
                        if (depLids.length)
                        {
                            baseRows.push({ isSectionLabel: true, label: localize('LA.tokenHud.label.deployables') });
                            for (const lid of depLids)
                                baseRows.push(this._deployRow(actor, lid, item, { itemRow: true }));
                        }
                        // Extra actions (from addExtraActions)
                        for (const action of extraActions)
                        {
                            const status = this._overlayRecharge(action, {});
                            baseRows.push(this._applyGate(this._lockable({
                                label: action.name,
                                labelHtml: extraDotLabel(action.name),
                                badge: status.badge ?? null,
                                badgeTone: status.badgeTone ?? null,
                                ...this._statusColors(status),
                                icon: getActivationIcon(action),
                                onClick: () => this._runExtraAction(actor, action, item),
                                onRightClick: this._actionPopup(action, item),
                                hoverData: { actor, item, action, category: 'Systems' },
                            }, action.name, action.activation), action));
                        }
                        return baseRows;
                    };
                    return this._itemRow(item, {
                        icon: item.img ?? null,
                        category: 'Systems',
                        childColLabel: item.name,
                        getChildren: npcSysChildren,
                        hoverExtra: { action: activation ? { name: item.name, activation } : null },
                        onRightClick: npcRightClick,
                    });
                });
            },
        };
    }

    _corePowerItems(/** @type {any} */ frame, /** @type {any} */ actor)
    {
        const coreSystem = frame.system?.core_system;
        const coreName = coreSystem?.active_name ?? 'Core Power';
        const core = corePowerState(actor);
        const coreUsed = core.hasCore && !core.charged;
        const activeAction = coreSystem?.active_actions?.[0];
        const passiveName = coreSystem?.passive_name ?? '';
        const passiveActions = coreSystem?.passive_actions ?? [];
        const counters = coreSystem?.counters ?? [];

        const coreActivation = coreSystem?.activation ?? activeAction?.activation ?? 'Protocol';
        const inactiveReason = localize('LA.tokenHud.coreInactive');
        const self = this;
        const rows = /** @type {any[]} */ ([
            { label: localize('LA.tokenHud.label.activation'), isSectionLabel: true },
            {
                label: coreName,
                icon: getActivationIcon(coreActivation),
                badge: coreBatteryBadge(!coreUsed),
                badgeTone: coreUsed ? 'bad' : 'ok',
                onBadgeClick: () => self._writeInPlace(() => actor.update({ 'system.core_energy': coreUsed ? 1 : 0 })),
                statusKind: coreUsed ? 'spent' : null,
                onClick: () => /** @type {any} */ (frame.beginCoreActiveFlow('system.core_system')),
                onRightClick: this._actionPopup(coreActivationAction(coreSystem), frame),
            },
            {
                inputCell: true,
                subtype: 'pills',
                noCount: true,
                pills: [
                    {
                        label: localize('LA.tokenHud.label.charged'),
                        icon: 'mdi mdi-battery',
                        iconOff: 'mdi mdi-battery-off',
                        getValue: () => !coreUsed,
                        onToggle: (/** @type {boolean} */ on) => self._writeInPlace(() => actor.update({ 'system.core_energy': on ? 1 : 0 })),
                    },
                    {
                        label: localize('LA.tokenHud.label.active'),
                        icon: 'mdi mdi-flash',
                        getValue: () => !!actor.system?.core_active,
                        onToggle: (/** @type {boolean} */ on) => self._writeInPlace(async () =>
                        {
                            if (on && corePowerState(actor).charged)
                                await actor.update({ 'system.core_energy': 0 });
                            await (on ? corePowerOn(actor) : corePowerOff(actor));
                        }),
                    },
                ],
            },
            { label: localize('LA.tokenHud.label.whileActive'), isSectionLabel: true },
        ]);
        for (const action of coreGrantedActions(coreSystem))
        {
            rows.push(this._blockIf(this._itemRow(frame, {
                label: action.name,
                icon: getActivationIcon(action),
                action,
                category: 'Actions',
                onClick: () => this._runAction(actor, this._token, action, frame),
                onRightClick: this._actionPopup(action, frame),
            }), !core.active, inactiveReason));
        }
        const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
        (coreSystem?.active_synergies ?? []).forEach((/** @type {any} */ synergy, /** @type {number} */ idx) =>
        {
            const detail = String(synergy?.detail ?? '');
            const name = `${coreName} Synergy ${ROMAN[idx] ?? idx + 1}`;
            rows.push(this._blockIf({
                label: name,
                icon: 'systems/lancer/assets/icons/core_bonus.svg',
                ...this._frameFreqBadge(frame, synergy),
                hoverData: { actor, item: frame, action: { name, activation: 'Free' }, category: 'Actions' },
                onClick: () => executeSimpleActivation(actor, { title: name, action: { name, activation: 'Free' }, detail }, { item: frame }),
                onRightClick: this._actionPopup({ name, activation: 'Free', detail }, frame, 'frame'),
            }, !core.active, inactiveReason));
        });

        if ((passiveName && coreSystem?.passive_effect) || passiveActions.length)
        {
            rows.push({ label: localize('LA.tokenHud.label.passive'), isSectionLabel: true });
            if (passiveName)
            {
                rows.push({
                    label: passiveName,
                    icon: 'mdi mdi-circle-expand',
                    hoverData: { actor, item: frame, action: { name: passiveName, activation: 'Passive' }, category: 'Frame' },
                    onClick: () => executeSimpleActivation(actor, { title: passiveName, action: { name: passiveName, activation: 'Passive' }, detail: coreSystem?.passive_effect ?? '' }, { item: frame }),
                    onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-passive', dataValue: frame.id, title: passiveName, subtitle: `${frame.name} · Core Passive`, bodyHtml: `<div class="la-popup-effect" style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(coreSystem?.passive_effect ?? '')}</div>${laRenderActions(coreSystem?.passive_actions ?? [])}`, theme: 'frame', item: frame, row, v3Scope: { type: 'core', passive: true } }),
                });
            }
            for (const action of passiveActions)
            {
                const theme = action.activation === 'Invade' ? 'invade' : 'frame';
                rows.push(this._itemRow(frame, { label: action.name, icon: getActivationIcon(action), action, category: 'Tech', onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail ?? '' }, { item: frame }), onRightClick: this._actionPopup(action, frame, theme) }));
            }
        }

        if (counters.length)
        {
            rows.push({ label: localize('LA.tokenHud.label.resources'), isSectionLabel: true });
            counters.forEach((/** @type {any} */ counter, /** @type {number} */ cidx) =>
            {
                const path = `system.core_system.counters.${cidx}.value`;
                rows.push(this._buildCounterRow(counter, path, frame));
            });
        }

        return rows;
    }

    _frameTraitItems(/** @type {any} */ frame, /** @type {any} */ actor)
    {
        const ap = action => this._actionPopup(action, frame, 'frame');
        const traits = frame.system?.traits ?? [];
        if (!traits.length)
            return [];
        return traits.map(/** @type {any} */ (trait, /** @type {number} */ traitIdx) =>
        {
            const traitCtx = { item: frame, key: traitSubKey(traitIdx) };
            return ({
                label: trait.name,
                icon: 'systems/lancer/assets/icons/trait.svg',
                ...this._frameFreqBadge(frame, trait, traitCtx),
                hoverData: { actor, item: trait, category: 'Frame Traits' },
                onClick: () => executeSimpleActivation(actor, { title: trait.name, action: { name: trait.name, activation: 'Passive' }, detail: trait.description ?? '' }, { item: frame, traitIndex: traitIdx }),
                childColLabel: trait.name,
                getChildren: () =>
                {
                    const children = [];
                    for (const action of applyActionOverlays(frame, trait.actions ?? []))
                    {
                        children.push({
                            label: action.name,
                            icon: getActivationIcon(action),
                            onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail ?? '' }, { item: frame }),
                            onRightClick: ap(action),
                        });
                    }
                    for (const lid of (trait.deployables ?? []))
                        children.push(this._deployRow(actor, lid, frame, { subtitle: () => `Deployable · ${trait.name} (Trait)` }));
                    for (const lid of (trait.integrated ?? []))
                    {
                        const intItem = /** @type {any} */ (actor.items.find(/** @type {any} */ (item) => item.system?.lid === lid));
                        if (!intItem)
                            continue;
                        if (intItem.type === 'mech_weapon' || intItem.type === 'pilot_weapon')
                            children.push(this._weaponItem(intItem, null, null));
                        else
                        {
                            children.push({
                                label: intItem.name,
                                icon: intItem.img ?? null,
                                childColLabel: intItem.name,
                                getChildren: () => this._systemChildren(intItem, actor),
                            });
                        }
                    }
                    return children.length ? children : null;
                },
                onRightClick: (/** @type {any} */ row) =>
                {
                    const bodyHtml = trait.description
                        ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(trait.description)}</div>`
                        : '<div style="font-size:0.82em;color:#888;">No description.</div>';
                    this._showItemPopup({ cssClass: 'la-hud-popup la-hud-trait-popup', dataKey: 'trait-name', dataValue: trait.name, title: trait.name, subtitle: `${frame.name} · Trait`, bodyHtml, theme: 'trait', item: frame, row, pipsArgs: { subData: trait, subKey: traitSubKey(traitIdx) }, v3Scope: { type: 'trait', index: traitIdx } });
                },
            });
        });
    }

    _coreBonusItems(/** @type {any} */ actor)
    {
        const bonuses = (resolvePilot(actor) ?? actor).items.filter(/** @type {any} */ item => item.type === 'core_bonus');
        return bonuses.map(/** @type {any} */ (cb) => ({
            label: cb.name,
            icon: cb.img ?? null,
            onClick: () => executeSimpleActivation(actor, { title: cb.name, action: { name: cb.name, activation: cb.system?.activation || 'Passive' }, detail: cb.system?.effect ?? '' }),
            onRightClick: (/** @type {any} */ row) =>
            {
                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-cb-popup', dataKey: 'cb-id', dataValue: cb.id, title: cb.name, subtitle: 'Core Bonus', bodyHtml: laRenderCoreBonusBody(cb), theme: 'core_bonus', item: cb, row });
            },
        }));
    }

    _frameIntegratedItems(/** @type {any} */ frame, /** @type {any} */ actor, /** @type {string[]} */ lids, /** @type {string[]} */ depLids = [])
    {
        const items = lids
            .map(lid => /** @type {any} */ (actor.items.find(/** @type {any} */ item => item.system?.lid === lid)))
            .filter(/** @type {any} */ item => !!item);
        const rows = items.map(/** @type {any} */ intItem =>
        {
            if (intItem.type === 'mech_weapon' || intItem.type === 'pilot_weapon')
                return this._weaponItem(intItem, null, null);
            return this._itemRow(intItem, {
                icon: intItem.img ?? null,
                category: 'Systems',
                childColLabel: intItem.name,
                getChildren: () => this._systemChildren(intItem, actor),
                onRightClick: (/** @type {any} */ row) =>
                {
                    this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'system-id', dataValue: intItem.id, title: intItem.name, subtitle: `Integrated · ${frame.name}`, bodyHtml: this._bodyHtml(intItem.system), theme: 'system', item: intItem, row });
                },
            });
        });
        if (depLids.length)
        {
            for (const lid of depLids)
                rows.push(/** @type {any} */ (this._deployRow(actor, lid, frame, { subtitle: () => `Deployable · ${frame.name} (Core)` })));
        }
        return rows;
    }

    _rankIcon(rank)
    {
        return `systems/lancer/assets/icons/white/rank_${Math.min(3, Math.max(1, rank))}.svg`;
    }

    _catTalents()
    {
        const actor = this._actor;
        return {
            label: localize('LA.tokenHud.label.talents'),
            colLabel: localize('LA.tokenHud.label.talents'),
            icon: 'systems/lancer/assets/icons/white/talent.svg',
            getItems: () =>
            {
                const pilot = resolvePilot(actor) ?? actor;
                if (!pilot)
                    return [];
                const talents = [...pilot.items.values()].filter(item => item.type === 'talent');
                if (!talents.length)
                    return [];
                return talents.map(talent => ({
                    label: talent.name,
                    icon: this._rankIcon(talent.system.curr_rank ?? 1),
                    onClick: () => /** @type {any} */ (talent).sheet.render(true),
                    childColLabel: talent.name,
                    hoverData: { actor, item: talent, action: null, category: 'Talents' },
                    getChildren: () => this._talentRankItems(talent),
                }));
            },
        };
    }

    _rankFreqStatus(talent, rank, rankIdx)
    {
        const status = getItemStatus(talent, rank, { subKey: rankSubKey(rankIdx) });
        return status.badge ? status : null;
    }

    _frameFreqBadge(frame, sub, ctx = null)
    {
        const icons = [];
        let depleted = false;
        for (const spec of FREQ_SPECS)
        {
            const max = spec.limitFromSub(sub, ctx);
            if (max <= 0)
                continue;
            const used = ctx?.key ? getSubUsed(frame, ctx.key, spec.field) : Number(frame.system?.[spec.field]?.value ?? 0);
            const ready = used < max;
            if (!ready)
                depleted = true;
            icons.push(`<i class="mdi ${ready ? `${spec.ready} is-ready` : `${spec.off} is-off`}"></i>`);
        }
        return icons.length ? { badge: icons.join(' '), badgeTone: depleted ? 'bad' : 'ok' } : {};
    }

    _talentRankItems(talent)
    {
        const ranks    = talent.system.ranks ?? [];
        const currRank = talent.system.curr_rank ?? 0;
        const roman    = ['I', 'II', 'III', 'IV', 'V'];
        return Array.from({ length: currRank }, (_, i) =>
        {
            const rank       = ranks[i];
            const rankLabel  = `${rank.name}`;
            const freq       = this._rankFreqStatus(talent, rank, i);
            const rankRow = {
                label: rankLabel,
                badge: freq?.badge ?? null,
                badgeTone: freq?.badgeTone ?? null,
                icon: this._rankIcon(i + 1),
                onClick: () => executeItemActivation(talent, { path: `ranks.${i}` }, { sourceTokenId: this._token?.id }),
                onRightClick: (row) =>
                {
                    const key = `${talent.id}_${i}`;
                    const desc = laFormatDetailHtml(rank.description ?? '');
                    const descHtml = desc ? `<div class="la-popup-effect" style="margin-bottom:8px;font-size:0.82em;line-height:1.5;color:#bbb;">${desc}</div>` : '';
                    const actionsHtml = laRenderActions(rank.actions ?? []);
                    const rankCounters = rank.counters ?? [];
                    const countersHtml = rankCounters.length
                        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('RESOURCES', '#1a3a5c')}${rankCounters.map(counter =>
                            `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.04);border-radius:3px;display:flex;justify-content:space-between;align-items:center;">
                                <span style="font-size:0.78em;font-weight:bold;color:#ccc;">${escapeHtml(counter.name)}</span>
                                <span style="font-size:0.78em;color:#aaa;">${counter.value ?? 0} / ${counter.max ?? 0}</span>
                            </div>`).join('')}</div>`
                        : '';
                    const bodyHtml = (descHtml + actionsHtml + countersHtml) || '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    this._showItemPopup({ cssClass: 'la-hud-popup la-hud-talent-popup', dataKey: 'rank-key', dataValue: key, title: rankLabel, subtitle: `${talent.name} · Rank ${roman[i] ?? i + 1}`, bodyHtml, theme: 'talent', item: talent, pipsArgs: { subData: rank, subKey: rankSubKey(i) }, row, v3Scope: { type: 'rank', index: i } });
                },
            };
            return [rankRow, ...this._talentRankActionItems(rank, talent, i).map(child => ({ ...child, indent: true }))];
        }).flat();
    }

    _talentRankActionItems(rank, talent, rankIdx)
    {
        const actions  = applyActionOverlays(talent, rank.actions ?? []);
        const counters = rank.counters ?? [];
        const items    = [];

        if (actions.length)
        {
            actions.forEach((action, actionIdx) =>
            {
                const status = getItemStatus(talent, action);
                items.push({
                    label: action.name,
                    icon: getActivationIcon(action),
                    badge: status.badge ?? null,
                    badgeTone: status.badge ? status.badgeTone : null,
                    onClick: () =>
                    {
                        if (action.activation === 'Invade')
                        {
                            const opt = this._getInvadeOptions(this._actor).find(entry => entry.item?.id === talent.id && entry.name === action.name);
                            if (opt)
                                executeInvade(this._actor, opt);
                        }
                        else
                            executeItemActivation(talent, { path: `ranks.${rankIdx}.actions.${actionIdx}` }, { sourceTokenId: this._token?.id });
                    },
                    onRightClick: this._actionPopup(action, talent, null, { subKey: actionSubKey(talent, action) ?? rankSubKey(rankIdx) }),
                });
            });
        }

        counters.forEach((counter, cidx) =>
        {
            const path    = `system.ranks.${rankIdx}.counters.${cidx}.value`;
            items.push(this._buildCounterRow(counter, path, talent));
        });

        return items;
    }

    _resourceItems()
    {
        const actor = this._actor;
        const pilot = resolvePilot(actor) ?? actor;
        const items = [];
        const roman = ['I', 'II', 'III', 'IV', 'V'];
        for (const talent of [...pilot.items.values()].filter(/** @type {any} */ item => item.type === 'talent'))
        {
            const sys      = /** @type {any} */ (talent).system;
            const ranks    = sys?.ranks ?? [];
            const currRank = sys?.curr_rank ?? 0;
            // Counters sharing an lid/name supersede across ranks: keep only the highest rank.
            const byKey = new Map();
            for (let rankIdx = 0; rankIdx < Math.min(currRank, ranks.length); rankIdx++)
            {
                const rank = ranks[rankIdx];
                if (!rank)
                    continue;
                const counters = rank.counters ?? [];
                for (let cidx = 0; cidx < counters.length; cidx++)
                {
                    const counter = counters[cidx];
                    const key = counter?.lid || counter?.name || `r${rankIdx}c${cidx}`;
                    byKey.set(key, { rankIdx, cidx, counter, rank });
                }
            }
            for (const { rankIdx, cidx, counter, rank } of byKey.values())
            {
                const path    = `system.ranks.${rankIdx}.counters.${cidx}.value`;
                const rankLabel = `${roman[rankIdx] ?? String(rankIdx + 1)}: ${rank.name}`;
                const onRightClick = (/** @type {any} */ row) =>
                {
                    const key = `${/** @type {any} */ (talent).id}_${rankIdx}_${cidx}`;
                    const desc = laFormatDetailHtml(rank.description ?? '');
                    const descHtml = desc ? `<div class="la-popup-effect" style="margin-bottom:8px;font-size:0.82em;line-height:1.5;color:#bbb;">${desc}</div>` : '';
                    const actionsHtml = laRenderActions(rank.actions ?? []);
                    const bodyHtml = (descHtml + actionsHtml) || '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    this._showItemPopup({ cssClass: 'la-hud-popup la-hud-talent-popup', dataKey: 'rank-key', dataValue: key, title: rankLabel, subtitle: `${/** @type {any} */ (talent).name} · Rank ${roman[rankIdx] ?? rankIdx + 1}`, bodyHtml, theme: 'talent', item: /** @type {any} */ (talent), pipsArgs: { subData: rank, subKey: rankSubKey(rankIdx) }, row, v3Scope: { type: 'rank', index: rankIdx } });
                };
                items.push(this._buildCounterRow(counter, path, /** @type {any} */ (talent), 'modules/lancer-automations/icons/perspective-dice-two.svg', onRightClick));
            }
        }
        const frame = actor?.system?.loadout?.frame?.value;
        const csCounters = frame?.system?.core_system?.counters ?? [];
        csCounters.forEach((/** @type {any} */ counter, /** @type {number} */ cidx) =>
        {
            const path = `system.core_system.counters.${cidx}.value`;
            items.push(this._buildCounterRow(counter, path, frame, 'modules/lancer-automations/icons/perspective-dice-two.svg'));
        });
        return items;
    }

    // Drop only talent:/frame: autoKeys (they render as counter rows above). linked:* pass through.
    _resourceExtras()
    {
        const actor = this._actor;
        const tokenDoc = /** @type {any} */ (this._token?.document);
        const raw = (getLAFlag(tokenDoc,'statBarExtras') ?? [])
            .filter(/** @type {any} */ entry =>
            {
                const key = entry?.autoKey;
                // bondXp is already the XP row in the BOND section of the Pilot column.
                return !key || (!key.startsWith('talent:') && !key.startsWith('frame:') && key !== 'bondXp');
            });
        const out = [];
        for (const entry of raw)
        {
            const resolved = _resolveExtraBarValues(actor, entry);
            if (!resolved.ownerOk)
                continue;
            // max must be a number. inputCell stringifies it into `${cur}/${max}`.
            out.push({
                inputCell: true,
                subtype: 'increment',
                name: entry.label || 'Extra',
                icon: entry.icon || 'modules/lancer-automations/icons/perspective-dice-two.svg',
                step: 1,
                min: 0,
                max: resolved.max,
                getValue: () =>
                {
                    const live = (getLAFlag(tokenDoc,'statBarExtras') ?? [])
                        .find(/** @type {any} */ item => item?.id === entry.id);
                    return _resolveExtraBarValues(actor, live ?? entry).value;
                },
                onValueChanged: (newVal) => updateExtraBarValue(tokenDoc, entry.id, newVal),
                ...(entry.linkedItemUuid ? {
                    onRightClick: async () =>
                    {
                        const item = await fromUuid(entry.linkedItemUuid);
                        if (item?.sheet)
                            item.sheet.render(true);
                        else
                            ui.notifications?.warn(localizeFormat('LA.notify.linkedItemNotFound', { uuid: entry.linkedItemUuid }));
                    },
                } : {}),
            });
        }
        return out;
    }

    // alt-sheets 'value' custom flags -> plain counter rows (fraction flags render as bars via _resourceExtras).
    _resourceCustomFlags()
    {
        const actor = this._actor;
        if (!altFlags.isActive())
            return [];
        const out = [];
        for (const flag of altFlags.listValueFlags(actor))
        {
            out.push({
                inputCell: true,
                subtype: 'increment',
                name: flag.name || 'Custom',
                icon: flag.icon || 'modules/lancer-automations/icons/perspective-dice-two.svg',
                step: 1,
                min: 0,
                getValue: () => Number(foundry.utils.getProperty(actor, flag.valuePath)) || 0,
                onValueChanged: (newVal) => altFlags.writeFlagValue(actor, flag.id, newVal),
            });
        }
        return out;
    }

    _ammoItems()
    {
        const actor = this._actor;
        const items = [];
        const systems = actor.type === 'mech'
            ? (actor.system?.loadout?.systems ?? []).map(slot => slot?.value).filter(Boolean)
            : (actor.items?.filter(item => item.type === 'mech_system') ?? []);
        for (const sysItem of systems)
        {
            const ammoArr = sysItem.system?.ammo ?? [];
            if (!ammoArr.filter(entry => entry.name).length)
                continue;
            ammoArr.forEach((ammo, idx) =>
            {
                if (ammo.name)
                    items.push(this._ammoRow(actor, sysItem, ammo, idx, { category: 'Ammo', subtitle: sysItem.name }));
            });
        }
        return items;
    }

    /** Build a single increment/decrement counter row item. */
    _buildCounterRow(/** @type {any} */ counter, path, /** @type {any} */ owner, icon = null, onRightClick = null)
    {
        return {
            inputCell: true,
            subtype: 'increment',
            name: counter.name,
            ...(icon ? { icon } : {}),
            ...(onRightClick ? { onRightClick } : {}),
            step: 1,
            min: 0,
            max: counter.max,
            getValue: () => counter.value,
            onValueChanged: (newVal) => owner.update({ [path]: newVal }),
        };
    }

    // STATUSES panel

    _catStatuses()
    {
        return { label: localize('LA.tokenHud.label.statuses'), icon: 'systems/lancer/assets/icons/white/accuracy.svg', isStatusPanel: true };
    }

    // MACROS panel (per-client list of Foundry macro shortcuts)

    _catMacros()
    {
        return {
            label: localize('LA.tokenHud.label.macros'),
            colLabel: localize('LA.tokenHud.label.macros'),
            icon: 'mdi mdi-file-code-outline',
            getItems: () => this._buildMacroItems(),
        };
    }

    _getMacroList()
    {
        const raw = getModuleSetting('tah.macroList');
        return Array.isArray(raw) ? raw : [];
    }

    async _saveMacroList(list)
    {
        await game.settings.set(MODULE_ID,'tah.macroList', list);
        Hooks.callAll('forceUpdateTokenActionHud');
    }

    // White-source SVGs render invisibly on light HUD rows; invert them to black.
    _macroIconHtml(img, size = 20, invertOverride)
    {
        if (!img)
            return '';
        const doInvert = typeof invertOverride === 'boolean'
            ? invertOverride
            : isWhiteIcon(img);
        const filter = doInvert ? 'invert(1)' : 'none';
        const cls = doInvert ? 'la-hud-icon la-hud-icon--white' : 'la-hud-icon la-hud-icon--dark';
        return `<img class="${cls}" src="${escapeHtml(img)}" onerror="this.onerror=null;this.src='icons/svg/dice-target.svg';" style="width:${size}px;height:${size}px;filter:${filter};margin-right:5px;vertical-align:middle;flex-shrink:0;border:none;outline:none;">`;
    }

    _macroScope()
    {
        const scope = {};
        if (this._token)
            scope.token = this._token;
        if (this._actor)
            scope.actor = this._actor;
        return scope;
    }

    _buildMacroItems()
    {
        const list = this._getMacroList();
        /** @type {any[]} */
        const items = list.map(entry =>
        {
            const macro = game.macros.get(entry.macroId);
            const img = entry.iconOverride ?? macro?.img ?? entry.icon;
            const name = entry.name ?? macro?.name ?? '(missing macro)';
            const iconHtml = this._macroIconHtml(img, 20, entry.iconInvert);
            // Wrap in flex span so v13 TAH's column-direction row doesn't push the icon onto a separate line.
            const wrap = (inner) => `<span style="display:inline-flex;align-items:center;gap:0;white-space:nowrap;">${iconHtml}${inner}</span>`;
            if (!macro)
            {
                return {
                    label: name,
                    labelHtml: wrap(`<s style="opacity:0.7">${escapeHtml(name)}</s>`),
                    stableKey: `macro:${entry.macroId}`,
                    onRightClick: (row) => this._openMacroRowPopup(entry, null, row),
                };
            }
            return {
                label: name,
                labelHtml: wrap(escapeHtml(name)),
                stableKey: `macro:${entry.macroId}`,
                onClick:      () => macro.execute(this._macroScope()),
                onRightClick: (row) => this._openMacroRowPopup(entry, macro, row),
            };
        });
        items.push({
            label: localize('LA.tokenHud.label.addMacro'),
            icon: 'fas fa-plus',
            keepOpen: true,
            noCount: true,
            onClick: () => this._openAddMacroDialog(),
        });
        return items;
    }

    _openAddMacroDialog()
    {
        const list = this._getMacroList();
        const known = new Set(list.map(entry => entry.macroId));
        const macros = (game.macros?.contents ?? [])
            .filter(macro => !known.has(macro.id))
            .sort((a, b) => a.name.localeCompare(b.name));
        const rowsHtml = macros.length
            ? macros.map(macro => `
                <div class="la-tah-pick" data-id="${macro.id}" style="cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;background:color-mix(in srgb, var(--la-plate), #000 6%);">
                    ${this._macroIconHtml(macro.img, 22)}
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(macro.name)}</span>
                </div>`).join('')
            : '<div style="padding:12px;text-align:center;color:#888;font-size:0.85em;font-style:italic;">No macros available.</div>';
        const content = `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">ADD MACRO</div>
                <div class="lancer-dialog-subtitle">Pick from the list. Customize the icon and name before adding.</div>
            </div>
            <input type="text" class="la-tah-search" placeholder="Search..." style="margin-top:8px;width:100%;height:26px;padding:2px 6px;font-size:0.9em;">
            <div class="la-tah-pick-list lancer-scroll" style="margin-top:4px;max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid #ccc;background:var(--la-plate, #e4dccd);">
                ${rowsHtml}
            </div>
            <div class="la-tah-edit" style="margin-top:8px;display:flex;align-items:center;gap:8px;padding:6px;background:var(--la-plate);border:1px solid #cbd6e8;opacity:0.5;pointer-events:none;">
                <span class="la-tah-edit-icon" title="Click to change icon" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #ccc;background:#fff;flex-shrink:0;"></span>
                <input type="text" class="la-tah-edit-name" placeholder="${localize('LA.tokenHud.selectMacro')}" style="flex:1;height:26px;padding:2px 6px;font-size:0.9em;">
                <label class="la-tah-edit-invert-label" title="Invert SVG (white → black)" style="display:flex;align-items:center;gap:4px;font-size:0.78em;color:#666;opacity:0.4;">
                    <input type="checkbox" class="la-tah-edit-invert" disabled>Invert
                </label>
            </div>
            <div class="la-tah-macro-drop" style="margin-top:6px;padding:10px;border:1px dashed #888;text-align:center;font-size:0.85em;color:#888;">
                Drop a macro here to add it.
            </div>
        `;
        /** @type {{ id: string|null, name: string, img: string, iconOverride: string|null, invert: boolean }} */
        const state = { id: null, name: '', img: '', iconOverride: null, invert: false };
        const addEntry = async () =>
        {
            if (!state.id)
                return;
            const cur = this._getMacroList();
            if (cur.some(saved => saved.macroId === state.id))
                return;
            const entry = { macroId: state.id, name: state.name, icon: state.img };
            if (state.iconOverride)
                entry.iconOverride = state.iconOverride;
            const finalImg = state.iconOverride ?? state.img;
            if (state.invert !== isWhiteIcon(finalImg))
                entry.iconInvert = state.invert;
            cur.push(entry);
            await this._saveMacroList(cur);
        };
        const dlg = new Dialog({
            title: localize('LA.dialogTitle.addMacro'),
            content,
            buttons: {
                add: { label: localize('LA.tokenHud.label.add'), callback: () => addEntry() },
                cancel: cancelButton(),
            },
            default: 'add',
            render: (html) =>
            {
                const editEl     = html.find('.la-tah-edit');
                const editIcon   = html.find('.la-tah-edit-icon');
                const editName   = html.find('.la-tah-edit-name');
                const editInvert = html.find('.la-tah-edit-invert');
                const editInvertLabel = html.find('.la-tah-edit-invert-label');
                const search    = html.find('.la-tah-search');
                const refreshIconPreview = () =>
                {
                    const img = state.iconOverride ?? state.img;
                    editIcon.html(this._macroIconHtml(img, 24, state.invert));
                    const isSvg = !!img && img.endsWith('.svg');
                    /** @type {HTMLInputElement} */ (editInvert[0]).disabled = !isSvg;
                    /** @type {HTMLInputElement} */ (editInvert[0]).checked = state.invert;
                    editInvertLabel.css('opacity', isSvg ? 1 : 0.4);
                };
                const select = (id, name, img) =>
                {
                    state.id = id;
                    state.name = name;
                    state.img = img;
                    state.iconOverride = null;
                    state.invert = isWhiteIcon(img);
                    refreshIconPreview();
                    editName.val(name);
                    editEl.css({ opacity: 1, pointerEvents: 'all' });
                    html.find('.la-tah-pick').css({ background: 'color-mix(in srgb, var(--la-plate), #000 6%)', borderLeftColor: 'transparent' });
                    html.find(`.la-tah-pick[data-id="${id}"]`).css({ background: 'color-mix(in srgb, var(--la-plate), #000 16%)', borderLeftColor: 'var(--primary-color)' });
                };
                html.find('.la-tah-pick').on('click', (ev) =>
                {
                    const id = $(ev.currentTarget).data('id');
                    const macro = game.macros.get(id);
                    if (macro)
                        select(macro.id, macro.name, macro.img);
                });
                editIcon.on('click', () =>
                {
                    if (!state.id)
                        return;
                    new FilePicker({
                        type: 'image',
                        current: state.iconOverride ?? state.img,
                        callback: (path) =>
                        {
                            state.iconOverride = path;
                            state.invert = isWhiteIcon(path);
                            refreshIconPreview();
                        },
                    }).render(true);
                });
                editName.on('input', () =>
                {
                    state.name = String(editName.val() ?? '');
                });
                editInvert.on('change', () =>
                {
                    state.invert = /** @type {HTMLInputElement} */ (editInvert[0]).checked;
                    refreshIconPreview();
                });
                search.on('input', () =>
                {
                    const query = String(search.val() ?? '').toLowerCase().trim();
                    html.find('.la-tah-pick').each((_i, el) =>
                    {
                        const name = $(el).find('span').text().toLowerCase();
                        $(el).toggle(!query || name.includes(query));
                    });
                });
                const drop = html.find('.la-tah-macro-drop');
                drop.on('dragover', (ev) =>
                {
                    ev.preventDefault(); drop.css('border-color', 'var(--primary-color)');
                });
                drop.on('dragleave', () => drop.css('border-color', '#888'));
                drop.on('drop', async (ev) =>
                {
                    ev.preventDefault();
                    drop.css('border-color', '#888');
                    try
                    {
                        const data = JSON.parse(ev.originalEvent.dataTransfer.getData('text/plain'));
                        const doc = /** @type {any} */ (await fromUuid(data?.uuid));
                        if (doc?.documentName === 'Macro')
                            select(doc.id, doc.name, doc.img);
                    }
                    catch
                    { /* ignore malformed drop */ }
                });
            },
        }, { width: 380, classes: ['lancer-dialog-base', 'lancer-no-title'] });
        dlg.render(true);
    }

    _openMacroRowPopup(entry, macro, anchorRow)
    {
        const actions = [];
        if (macro)
            actions.push({ label: 'Open Sheet', icon: 'fas fa-external-link-alt', onClick: () => macro.sheet?.render(true) });
        actions.push({
            label: 'Remove',
            icon: 'fas fa-trash',
            danger: true,
            onClick: () => this._saveMacroList(this._getMacroList().filter(listed => listed.macroId !== entry.macroId)),
        });
        this._openRowActionsPopup(macro?.name ?? entry.name ?? 'Macro', macro ? '' : 'Macro missing', actions, anchorRow);
    }

    _openRowActionsPopup(title, subtitle, actions, anchorRow)
    {
        document.querySelectorAll('.la-hud-popup').forEach(node => node.remove());
        const baseStyle ='padding:3px 8px;cursor:pointer;font-size:0.78em;display:flex;align-items:center;gap:5px;font-family:inherit;';
        const buttons = actions.map((action, idx) =>
        {
            const colors = action.danger ? 'background:#3a1818;border:1px solid #803333;color:#ffaaaa;' : 'background:#2a2a2a;border:1px solid #444;color:#ddd;';
            return `<button data-action-idx="${idx}" style="${baseStyle}${colors}"><i class="${action.icon}"></i>${action.label}</button>`;
        });
        const bodyHtml = `<div style="display:flex;flex-direction:column;gap:4px;">${buttons.join('')}</div>`;
        const popup = laDetailPopup('la-hud-popup la-tah-row-popup', title, subtitle, bodyHtml, 'default');
        popup.css({ minWidth: 0, width: 'auto', maxWidth: 200 });
        popup.children().eq(0).css({ padding: '4px 8px' });
        popup.children().eq(0).find('div').first().css({ fontSize: '0.82em' });
        popup.children().eq(1).css({ padding: '4px 8px' });
        popup.find('button[data-action-idx]').on('click', async (ev) =>
        {
            const action = actions[Number($(ev.currentTarget).data('actionIdx'))];
            popup.remove();
            await action?.onClick();
        });
        this._showPopupAt(popup, anchorRow);
    }


    _weaponItem(weapon, modItem, mount = null)
    {
        const row = this._itemRow(weapon, {
            icon: weaponTypeIcon(weapon),
            sizeLevel: weaponSizeLevel(weapon),
            category: 'Weapons',
            childColLabel: weapon.name,
            getChildren: () => this._weaponChildren(weapon, modItem, mount),
            onRightClick: (row) =>
            {
                const buildBody = () =>
                {
                    const sys = weapon.system;
                    let profiles = getWeaponProfiles_WithBonus(weapon, this._actor);
                    if (!profiles.length && weapon.type === 'npc_feature')
                    {
                        const tierOverride = sys.tier_override ?? 0;
                        const tier = tierOverride > 0 ? tierOverride : (this._actor?.system?.tier ?? 1);
                        const tierIdx = Math.max(0, Math.min(2, tier - 1));
                        const atkBonus = Array.isArray(sys.attack_bonus) ? (sys.attack_bonus[tierIdx] ?? 0) : 0;
                        const atkAcc = Array.isArray(sys.accuracy) ? (sys.accuracy[tierIdx] ?? 0) : 0;
                        profiles = [{ name: null, damage: (sys.damage ?? [])[tierIdx] ?? [], range: sys.range ?? [], tags: sys.tags ?? [], effect: sys.effect || '', on_hit: sys.on_hit || '', attack_bonus: atkBonus, accuracy: atkAcc, tech_attack: sys.tech_attack ?? false, weapon_type: sys.weapon_type ?? '' }];
                    }
                    if (!profiles.length && weapon.type === 'pilot_weapon')
                        profiles = [{ name: null, damage: sys.damage ?? [], range: sys.range ?? [], tags: sys.tags ?? [], effect: sys.effect || '', on_hit: sys.on_hit || '' }];
                    return laRenderWeaponBody(profiles, {
                        actions: sys.actions ?? [],
                        modName: modItem?.name ?? null,
                        modItem: modItem ?? null,
                        activeProfileIndex: sys.selected_profile_index ?? 0,
                        switchable: (sys.profiles?.length ?? 0) > 1,
                    });
                };
                const weaponSubtitle = () =>
                {
                    const sys = weapon.system;
                    const profileType = sys.profiles?.[sys.selected_profile_index ?? 0]?.type;
                    return this._joinSubtitle(sys.mount_type ?? sys.size, profileType ?? sys.weapon_type);
                };
                const bindProfileSwitch = (popup) =>
                {
                    popup.data('laRebuild', () =>
                    {
                        popup.find('.la-weapon-body').html(withV3Chips(buildBody(), weapon));
                        popup.find('.la-detail-subtitle').text(weaponSubtitle());
                        bindProfileSwitch(popup);
                    });
                    popup.find('.la-profile-set[data-profile-idx]').on('click', async function (ev)
                    {
                        ev.stopPropagation();
                        const idx = Number(this.dataset.profileIdx);
                        if (idx === (weapon.system?.selected_profile_index ?? 0))
                            return;
                        playUiSound('toggle');
                        await executeProfileSwitch(weapon, idx);
                    });
                };
                const addAttackButton = (popup) =>
                {
                    const closeBtn = popup.find('.la-detail-close');
                    if (closeBtn.parent().find('.la-detail-subtitle').length)
                        closeBtn.wrap('<div style="display:flex;align-items:center;gap:4px;"></div>');
                    const attackBtn = $(htmlToElement(`<span class="la-detail-attack" title="${escapeHtml(localize('LA.tokenHud.attack'))}"><i class="fas fa-crosshairs"></i></span>`));
                    attackBtn.on('click', (ev) =>
                    {
                        ev.stopPropagation();
                        closeBtn.trigger('click');
                        const runAction = row.data('laRunAction');
                        if (runAction)
                            runAction();
                        else
                            attack.onClick();
                    });
                    closeBtn.before(attackBtn);
                };
                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-weapon-popup', dataKey: 'weapon-id', dataValue: weapon.id, title: weapon.name, subtitle: weaponSubtitle(), bodyHtml: this._actionLockReasonHtml(weapon.name) + `<div class="la-weapon-body">${buildBody()}</div>`, theme: 'weapon', item: weapon, row, pipsArgs: this._depthCallbacks(), postRender: (popup) =>
                {
                    bindProfileSwitch(popup);
                    addAttackButton(popup);
                } });
            },
        });
        const attack = this._lockable({
            onClick: () => weapon.beginWeaponAttackFlow(),
            broadcastFn: (_token, otherActor) => this._equivalentItem(otherActor, weapon)?.beginWeaponAttackFlow(),
        }, weapon.name);
        row.onClick = attack.onClick;
        row.broadcastFn = attack.broadcastFn;
        row.noRowClick = true;
        if (attack.statusKind)
            row.statusKind = attack.statusKind;
        const mountKey = mount ? (this._actor?.system?.loadout?.weapon_mounts ?? []).indexOf(mount) : -1;
        if (mountKey >= 0)
            row.mountKey = mountKey;
        const lockInfo = getActionLockInfo(this._actor, weapon.name);
        if (lockInfo.itemLocks.length || lockInfo.sources.length)
            row.softDisabled = true;
        return row;
    }

    _weaponChildren(weapon, modItem, mount)
    {
        const sys = weapon.system;
        const actor = this._actor;
        const addHover = children => children.map(child =>
        {
            if (child.isSectionLabel || (!child.onClick && !child._profile))
                return child;
            return { ...child, hoverData: { actor, item: weapon, action: child.action ?? { name: child.label, activation: child.activation ?? null }, category: 'Weapons', profile: child._profile ?? null, ...(child.rangeWeapons ? { weapons: child.rangeWeapons } : {}) } };
        });
        const addRightClicks = (children, attackLabel, bypassMountArg) => children.map(child =>
        {
            if (child.isSectionLabel || child.onRightClick)
                return child;
            // Mod row may have no onClick; handle it first.
            if (modItem && child.label === modItem.name)
            {
                const ms = modItem.system;
                const subtitle = this._joinSubtitle(ms?.type, ms?.license ? `${ms.manufacturer} ${ms.license_level}` : null) || 'Weapon Mod';
                return { ...child, onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-mod-popup', dataKey: 'mod-id', dataValue: modItem.id, title: modItem.name, subtitle, bodyHtml: laRenderModBody(modItem), theme: 'mod', item: modItem, row, pipsArgs: this._depthCallbacks() }) };
            }
            if (!child.onClick)
                return child;
            if (child.label === attackLabel)
            {
                const mountWeapons = (bypassMountArg?.slots ?? []).map((/** @type {any} */ s) => s.weapon?.value?.name).filter(Boolean);
                const weaponList = mountWeapons.length ? mountWeapons.join(', ') : weapon.name;
                const title = attackLabel === 'FIGHT' ? 'Fight' : attackLabel === 'BARRAGE' ? 'Barrage' : 'Skirmish';
                const activation = attackLabel === 'SKIRMISH' ? 'Quick' : 'Full';
                const detail = `${title} with: ${weaponList}`;
                return { ...child, onRightClick: this._actionPopup({ name: title, activation, detail }, null, 'weapon') };
            }
            return child;
        });
        const onActivate = (a, source) =>
        {
            const si = /** @type {any} */ (source ?? weapon);
            // Invade on mech_weapon: TechAttackFlow rejects weapon items, use executeInvade instead
            if (a.activation === 'Invade' && si.type === 'mech_weapon')
            {
                const opt = this._getInvadeOptions(actor).find(option => option.name === a.name && option.item?.id === si.id)
                    ?? { name: a.name, detail: a.detail ?? '', item: si, action: a, unavailable: false, destroyed: false };
                executeInvade(actor, opt);
                return;
            }
            const sysActions = si.system?.actions ?? [];
            const sysIdx = sysActions.findIndex(sa => sa.name === a.name && sa.activation === a.activation);
            if (sysIdx >= 0)
            {
                si.beginActivationFlow(`system.actions.${sysIdx}`);
                return;
            }
            const profIdx = si.system?.selected_profile_index ?? 0;
            const profActions = si.system?.profiles?.[profIdx]?.actions ?? [];
            const pIdx = profActions.findIndex(pa => pa.name === a.name && pa.activation === a.activation);
            if (pIdx >= 0)
            {
                si.beginActivationFlow(`system.profiles.${profIdx}.actions.${pIdx}`);
                return;
            }
            executeSimpleActivation(actor, { title: a.name, action: a, detail: a.detail ?? '' }, { item: si });
        };
        const rangeToggle = () =>
        {
            const profiles = getWeaponProfiles_WithBonus(weapon, actor);
            const activeProfile = profiles[weapon.system?.selected_profile_index ?? 0] ?? profiles[0];
            const rangeMap = {};
            for (const r of (activeProfile?.range ?? []))
            {
                const type = r.type ?? 'Range';
                const val = Number(r.val) || 0;
                if (val > (rangeMap[type] ?? 0))
                    rangeMap[type] = val;
            }
            const weaponRange = Math.max(0, ...Object.values(rangeMap));
            if (weaponRange <= 0)
                return [];
            const RANGE_CCI = { Range: 'cci-range', Threat: 'cci-threat', Line: 'cci-line', Cone: 'cci-cone', Blast: 'cci-blast', Burst: 'cci-burst', Thrown: 'cci-thrown' };
            const rangeLabel = 'Reach: ' + Object.entries(rangeMap)
                .map(([type, val]) => `<i class="cci ${RANGE_CCI[type] ?? 'cci-range'}" style="font-size:1.1em;vertical-align:middle;"></i>${val}`)
                .join(' ');
            return [{ label: localize('LA.tokenHud.label.range'), isSectionLabel: true }, {
                inputCell: true,
                subtype: 'toggle',
                name: 'Reach',
                nameHtml: rangeLabel,
                icon: 'mdi mdi-ruler-square-compass',
                getValue: () => hasRangePin(this._token, 'weapon', weapon.id),
                onToggle: () =>
                {
                    if (!isAdvancedMeasureActive() && !hasRangePin(this._token, 'weapon', weapon.id))
                        openAdvancedMeasureWithState({});
                    toggleRangePin(this._token, 'weapon', { weaponItemId: weapon.id });
                },
            }];
        };

        const patchProfileRefresh = (children, builder) =>
        {
            for (const c of children)
            {
                if (c._profile)
                    c.refreshCol4 = builder;
            }
            return children;
        };

        if (actor.type === 'pilot')
        {
            const buildPilot = () => patchProfileRefresh([...addRightClicks(addHover(laHudItemChildren(weapon, {
                defaultActions: [
                    {
                        label: 'FIGHT',
                        text: localize('LA.tokenHud.label.fight'),
                        favKey: `${weapon.uuid}|FIGHT`,
                        icon: 'modules/lancer-automations/icons/crossed-slashes.svg',
                        onClick: () => executeFight(actor, weapon),
                        broadcastFn: (_token, otherActor) => executeFight(otherActor, this._equivalentItem(otherActor, weapon)),
                    },
                ].map(actionRow => this._lockableAttack(actionRow, weapon.name)),
                modItem,
                showPopup: (popup, row) => this._showPopupAt(popup, row),
                onActivate,
                actionPopup: (action, source) => this._actionPopup(action, source ?? weapon),
            })), 'FIGHT', { slots: [{ weapon: { value: weapon } }] }), ...rangeToggle()], buildPilot);
            return buildPilot();
        }
        // Mech: sys.size === "Superheavy". NPC weapons store it in sys.weapon_type ("Superheavy Rifle", etc.).
        // Re-read per build: a profile switch can flip a superheavy between BARRAGE and SKIRMISH (Leviathan HAC).
        const isSuperHeavy = () => ((sys.size || sys.type || '').toLowerCase() === 'superheavy'
            || String(sys.weapon_type || '').toLowerCase().startsWith('superheavy'))
            && !weaponSkirmishable(weapon);
        const bypassMount = mount ?? { slots: [{ weapon: { value: weapon } }] };
        const mounts = actor.system?.loadout?.weapon_mounts ?? [];
        const mountIdx = mount ? mounts.indexOf(mount) : -1;
        const buildMech = () =>
        {
            const superHeavy = isSuperHeavy();
            const attackLabel = superHeavy ? 'BARRAGE' : 'SKIRMISH';
            const partners = superHeavy || mountIdx < 0 ? [] : this._barragePartners(mount, mounts);
            return patchProfileRefresh([...addRightClicks(addHover(laHudItemChildren(weapon, {
                defaultActions: [
                    ...[{
                        label: attackLabel,
                        ...(mountIdx >= 0 ? { glowMounts: [mountIdx] } : {}),
                        rangeWeapons: this._mountWeapons(bypassMount),
                        favKey: `${weapon.uuid}|${attackLabel}`,
                        icon: superHeavy
                            ? 'modules/lancer-automations/icons/barrage.svg'
                            : 'modules/lancer-automations/icons/skirmish.svg',
                        onClick: () => superHeavy
                            ? executeBarrage(actor, bypassMount)
                            : executeSkirmish(actor, bypassMount),
                        broadcastFn: (_token, otherActor) =>
                        {
                            const otherMount = { slots: [{ weapon: { value: this._equivalentItem(otherActor, weapon) } }] };
                            return superHeavy ? executeBarrage(otherActor, otherMount) : executeSkirmish(otherActor, otherMount);
                        },
                    }].map(actionRow => this._lockableAttack(actionRow, weapon.name)),
                    ...(partners.length ? [this._barrageWithRow(weapon, mount, mounts, partners)] : []),
                ],
                modItem,
                showPopup: (popup, row) => this._showPopupAt(popup, row),
                onActivate,
                actionPopup: (action, source) => this._actionPopup(action, source ?? weapon),
            })), attackLabel, bypassMount), ...rangeToggle()], buildMech);
        };
        return buildMech();
    }

    _mountWeapons(mount)
    {
        return (mount?.slots ?? [])
            .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? this._actor?.items.get(slot.weapon.id) : null))
            .filter(Boolean);
    }

    _barragePartners(mount, mounts)
    {
        return mounts.filter(other =>
        {
            if (other === mount || other.bracing)
                return false;
            const weapons = this._mountWeapons(other);
            return weapons.length > 0 && !weapons.some(entry => weaponSizeLevel(entry) === 3);
        });
    }

    _barrageWithRow(weapon, mount, mounts, partners)
    {
        const actor = this._actor;
        const mountIdx = mounts.indexOf(mount);
        const barrageAction = { name: 'Barrage', activation: 'Full' };
        const partnerRow = (partner) =>
        {
            const partnerIdx = mounts.indexOf(partner);
            const lead = this._mountWeapons(partner)[0];
            const firedWeapons = [...this._mountWeapons(mount), ...this._mountWeapons(partner)];
            const fired = firedWeapons.map(entry => entry.name).join(', ');
            return this._lockCat(this._lockable({
                label: localizeFormat('LA.tokenHud.label.mount', { type: partner.type }),
                icon: 'systems/lancer/assets/icons/weapon.svg',
                favKey: `${weapon.uuid}|BARRAGE_WITH|${lead?.uuid ?? partnerIdx}`,
                glowMounts: [mountIdx, partnerIdx],
                hoverData: { actor, item: null, action: barrageAction, category: 'Weapons', weapons: firedWeapons },
                onClick: () => executeBarrage(actor, [mount, partner]),
                onRightClick: this._actionPopup({ name: 'Barrage', activation: 'Full', detail: `Barrage with: ${fired}` }, null, 'weapon'),
            }, 'Barrage', 'Full'), 'full');
        };
        const ownWeapons = this._mountWeapons(mount).map(entry => entry.name).join(', ');
        return this._lockCat({
            label: 'Barrage',
            text: localize('LA.tokenHud.label.barrageWith'),
            icon: 'modules/lancer-automations/icons/barrage.svg',
            childColLabel: localize('LA.tokenHud.col.secondMount'),
            glowMounts: [mountIdx],
            hoverData: { actor, item: null, action: barrageAction, category: 'Weapons', weapons: this._mountWeapons(mount) },
            getChildren: () => partners.map(partnerRow),
            onRightClick: this._actionPopup({ name: 'Barrage', activation: 'Full', detail: `Barrage with: ${ownWeapons} and a second mount.` }, null, 'weapon'),
        }, 'full');
    }

    _getInvadeOptions(actor)
    {
        if (!actor)
            return [];
        const isNPC = actor.type === 'npc';
        const fragDetail = isNPC
            ? 'Deal 2 heat. Target becomes IMPAIRED until the end of their next turn.'
            : 'Deal 2 heat. Target becomes IMPAIRED and SLOWED until the end of their next turn.';
        const invades = (actor.type === 'deployable' || actor.type === 'pilot') ? [] : [{
            name: isNPC ? 'Fragment Signal (NPC)' : 'Fragment Signal',
            detail: fragDetail,
            item: null,
            action: null,
            tags: [],
            isFragmentSignal: true,
            destroyed: false,
            unavailable: false,
        }];
        const pushInvade = (name, detail, item, action, tags, coreLocked = false) =>
        {
            const status = item ? getItemStatus(item, action) : getItemStatus(action);
            invades.push({ name, detail, item, action, tags, isFragmentSignal: false, destroyed: status.destroyed, unavailable: status.unavailable, coreLocked: coreLocked && !status.destroyed, disabled: status.disabled, badge: status.badge, badgeTone: status.badgeTone });
        };
        const coreActive = corePowerState(actor).active;
        for (const { action, sourceItem, _coreGranted } of /** @type {any[]} */ (getActorActionItems(actor, 'Invade')))
        {
            const tags = sourceItem?.system?.active_profile?.tags ?? sourceItem?.system?.tags ?? action.tags ?? [];
            pushInvade(action.name, action.detail || '', sourceItem ?? null, action, tags, !!_coreGranted && !coreActive);
        }
        return invades;
    }

    _actionLockReasonHtml(actionName, activationField = null, activation = null)
    {
        if (!this._actor || !actionName)
            return '';
        const info = getActionLockInfo(this._actor, actionName, activation);
        const fieldStatuses = activationField ? getFieldLockingStatuses(this._actor, activationField) : [];
        if (!info.statuses.length && !info.sources.length && !info.itemLocks.length && !fieldStatuses.length)
            return '';
        const statusLabel = (id) =>
        {
            const raw = CONFIG.statusEffects?.find?.(effect => effect.id === id)?.name ?? id;
            const localized = localize(raw);
            return localized === raw && raw.includes('.') ? id : localized;
        };
        const parts = [
            ...[...new Set([...info.statuses, ...fieldStatuses])].map(statusLabel),
            ...info.itemLocks.map(lock => lock.reason || lock.item?.name || ''),
            ...info.sources.map(lockEntryLabel)
        ].filter(Boolean);
        return `<p class="la-hud-action-locked-reason" style="margin:0 0 6px 0;padding:4px 6px;background:rgba(160,119,68,0.18);border-left:3px solid #a07744;font-size:0.85em;color:#e0c8a0;"><strong>Locked by:</strong> ${parts.map(escapeHtml).join(', ')}</p>`;
    }

    _actionPopup(action, source = null, themeOverride = null, extraPipsArgs = null)
    {
        const sourceUuid = typeof source === 'string' ? null : /** @type {any} */ (source)?.uuid;
        const showPopup = (/** @type {any} */ row) =>
        {
            const sourceName = typeof source === 'string' ? source : /** @type {any} */ (source)?.name ?? null;
            const sourceType = typeof source === 'string' ? null : /** @type {any} */ (source)?.system?.type ?? null;
            const tier = (typeof source !== 'string' ? source?.parent?.system?.tier : null) ?? 1;
            const ACTIVATION_FIELD = { 'Free': 'free', 'Protocol': 'protocol', 'Reaction': 'reaction', 'Full': 'full', 'Full Tech': 'full', 'Quick': 'quick', 'Quick Tech': 'quick' };
            const blockHtml = this._pendingBlockHtml();
            const consumeHtml = source?.documentName === 'Item' ? renderConsumeStatusHtml(source, action) : '';
            const lockHtml = action._skipLockInfo ? '' : this._actionLockReasonHtml(action.name, ACTIVATION_FIELD[action.activation] ?? null, action.activation);
            const bodyHtml = blockHtml + lockHtml + laRenderActionDetail(action, { tier }) + consumeHtml;
            const subtitleParts = [action.activation ?? ''];
            if (sourceName)
                subtitleParts.push(sourceType ? `${sourceName} (${sourceType})` : sourceName);
            else if (action._grant)
            {
                const grantorName = resolveGrant(action)?.token?.name ?? null;
                const grantLabel = action._grant.label ?? null;
                if (grantorName || grantLabel)
                    subtitleParts.push(grantorName && grantLabel ? `${grantorName} (${grantLabel})` : (grantorName ?? grantLabel));
            }
            const theme = themeOverride ?? activationTheme(action.activation);
            const sourceItem = typeof source === 'string' ? null : source;
            const actorForExtra = this._actor;
            let actionPipsItem;
            let actionPips = true;
            let actorHeldKey = null;
            if (sourceItem)
                actionPipsItem = sourceItem;
            else if (action._addedViaExtrasUI)
                actionPipsItem = actorForExtra;
            else if (action.recharge)
                actionPipsItem = null;
            else if (action.frequency && actorForExtra?.type !== 'deployable')
            {
                actionPipsItem = actorForExtra;
                actorHeldKey = actorActionSubKey(action);
            }
            else
                actionPips = false;
            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: action.name, title: action.name, subtitle: this._joinSubtitle(...subtitleParts), bodyHtml, theme, item: sourceItem ?? action.name, skipExtras: true, row, pips: actionPips, pipsItem: actionPipsItem, pipsArgs: { action, ...(actorHeldKey ? { subKey: actorHeldKey } : {}), ...extraPipsArgs }, v3Scope: action._coreActive ? { type: 'core', passive: false } : { type: 'action', path: v3ActionPath(sourceItem, action) } });
        };
        showPopup.favId = sourceUuid ? `${sourceUuid}|${action.name}` : genericFavKey(action.name);
        return showPopup;
    }

    _getActionsByActivation(actor, activationType, category = null)
    {
        if (!actor)
            return [];
        const core = corePowerState(actor);
        const coreUsed = core.hasCore && !core.charged;
        return getActorActionItems(actor, activationType).map((/** @type {any} */ { action, sourceItem, rankIdx, _coreActive, _coreGranted }) =>
        {
            const talentSubKey = sourceItem?.type === 'talent' && rankIdx != null ? (actionSubKey(sourceItem, action) ?? rankSubKey(rankIdx)) : null;
            const status = sourceItem ? getItemStatus(sourceItem, action, talentSubKey ? { subKey: talentSubKey } : {}) : getItemStatus(action, null, { holder: actor });
            // Core power spent: mark the core active entry as unavailable (orange).
            if (_coreActive && coreUsed && !status.destroyed)
                status.unavailable = true;
            // Extra-action recharge: overlay action-level charged state onto item status
            this._overlayRecharge(action, status);
            // Core power: battery badge mirroring system.core_energy. Click toggles.
            if (_coreActive && !status.destroyed)
            {
                const charged = !coreUsed;
                status.badge = (status.badge ? status.badge + ' ' : '') + coreBatteryBadge(charged);
                status.badgeTone = charged ? (status.badgeTone ?? 'ok') : 'bad';
            }
            const displayName = actionDisplayName(sourceItem, action);
            return this._blockIf(this._applyGate(this._lockable({
                label: displayName,
                labelHtml: status.destroyed ? this._destroyedLabel(displayName)
                    : ((action._sourceItemId || action._addedViaExtrasUI || action._isExtra) ? extraDotLabel(displayName) : undefined),
                badge: status.badge ?? null,
                badgeTone: status.badgeTone ?? null,
                icon: _coreActive ? 'systems/lancer/assets/icons/corepower.svg' : (action.icon ?? getActivationIcon(action) ?? sourceItem?.img ?? null),
                ...(_coreActive ? { onBadgeClick: () => this._writeInPlace(() => actor.update({ 'system.core_energy': coreUsed ? 1 : 0 })) } : {}),
                ...this._statusColors(status),
                onClick: () => this._runAction(actor, this._token, action, sourceItem, { rankIdx, coreActive: _coreActive }),
                broadcastFn: (otherToken, otherActor) =>
                {
                    const equiv = _coreActive ? (otherActor.system?.loadout?.frame?.value ?? null) : this._equivalentItem(otherActor, sourceItem);
                    return this._runAction(otherActor, otherToken, action, equiv, { sourceType: sourceItem?.type, rankIdx, coreActive: _coreActive });
                },
                onRightClick: this._actionPopup(action, sourceItem, null, talentSubKey ? { subKey: talentSubKey } : null),
                hoverData: { actor, item: sourceItem ?? null, action, category },
            }, displayName, activationType), action), _coreGranted && !core.active && !status.destroyed, localize('LA.tokenHud.coreInactive'));
        });
    }

    _overlayRecharge(action, status)
    {
        if (action.recharge && !status.destroyed)
        {
            const charged = action.charged !== false;
            status.badge = (status.badge ? status.badge + ' ' : '') + rechargeIcon(charged);
            status.badgeTone = charged ? (status.badgeTone ?? 'ok') : 'bad';
            if (!charged)
                status.unavailable = true;
        }
        return status;
    }

    _equivalentItem(actor, item)
    {
        if (!item)
            return null;
        return actor?.items?.find(owned => owned.system?.lid === item.system?.lid) ?? null;
    }

    async _spendExtraAction(actor, action, item = null)
    {
        if (!action._addedViaExtrasUI || !Array.isArray(action.tags) || !action.tags.length)
            return true;
        return consumeExtraAction(item ?? actor, action.name);
    }

    async _runExtraAction(actor, action, item = null)
    {
        if (!(await this._spendExtraAction(actor, action, item)))
            return;
        await executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' }, item ? { item } : {});
        if (action.laCombat)
            await executeExtraActionCombat(actor, action, item);
    }

    async _runAction(actor, token, action, item, { sourceType = item?.type, rankIdx = null, coreActive = false } = {})
    {
        if (action.laCombat)
            return this._runExtraAction(actor, action, item);
        const itemFlow = ['mech_system', 'npc_feature', 'pilot_gear', 'pilot_armor', 'pilot_weapon'].includes(sourceType);
        if (!item && (coreActive || itemFlow || sourceType === 'talent'))
            return;
        if (!(await this._spendExtraAction(actor, action, item)))
            return;
        const simpleOptions = { title: action.name, action, detail: action.detail || '' };
        if (coreActive)
            item.beginCoreActiveFlow('system.core_system');
        else if (itemFlow)
        {
            if (item.type === 'npc_feature' && item.system?.tech_attack && item.beginTechAttackFlow)
                item.beginTechAttackFlow();
            else
            {
                const actionIdx = (item.system?.actions ?? []).findIndex(candidate => candidate === action || candidate.name === action.name);
                if (actionIdx >= 0)
                    item.beginActivationFlow(`system.actions.${actionIdx}`);
                else if (action._sourceItemId || action.recharge !== undefined || !item.beginSystemFlow)
                    executeSimpleActivation(actor, simpleOptions, { item });
                else
                    item.beginSystemFlow();
            }
        }
        else if (sourceType === 'talent')
        {
            if (action.activation === 'Invade')
            {
                const opt = this._getInvadeOptions(actor).find(option => option.item?.id === item.id && option.name === action.name);
                if (opt)
                    executeInvade(actor, opt);
            }
            else
            {
                const rank = rankIdx ?? 0;
                const actionIdx = (item.system?.ranks?.[rank]?.actions ?? []).findIndex(candidate => candidate.name === action.name);
                executeItemActivation(item, { path: `ranks.${rank}.actions.${Math.max(actionIdx, 0)}` }, { sourceTokenId: token?.id });
            }
        }
        else
            executeSimpleActivation(actor, simpleOptions, item ? { item } : {});
    }

    /** Thin wrapper around `toggleDetailPopup` that auto-wires `showPopupAt`. */
    _showItemPopup(opts)
    {
        const showFn = (p, r) => this._showPopupAt(p, r);
        toggleDetailPopup({ ...opts, showPopupAt: showFn });
    }

    /** Join non-empty subtitle parts with the ` · ` separator. */
    _joinSubtitle(...parts)
    {
        return parts.filter(Boolean).join(' · ');
    }

    _statCell(/** @type {string} */ label, /** @type {any} */ val, /** @type {any} */ base = undefined)
    {
        const delta = (val != null && base != null && val !== base)
            ? (val > base
                ? `<span style="position:absolute;bottom:2px;right:2px;color:#3a9e6e;font-size:0.55em;line-height:1;">▲</span>`
                : `<span style="position:absolute;bottom:2px;right:2px;color:#c33;font-size:0.55em;line-height:1;">▼</span>`)
            : '';
        return `<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;">${delta}<span style="font-size:0.68em;color:#666;text-transform:uppercase;letter-spacing:0.05em;">${label}</span><span style="font-size:0.95em;color:#ccc;font-weight:bold;">${val ?? '—'}</span></div>`;
    }

    _statGrid(/** @type {number} */ cols, /** @type {string[]} */ ...cells)
    {
        return `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px 4px;padding:4px 2px;">${cells.join('')}</div>`;
    }

    _statsGrids(rows, cols, baseLabel = null)
    {
        const cells = (baseOnly) => rows.map(row => (row ? this._statCell(row[0], baseOnly ? row[2] : row[1], baseOnly ? undefined : row[2]) : '<div></div>'));
        return {
            current: this._statGrid(cols, ...cells(false)),
            base: `<details style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;"><summary style="font-size:0.72em;color:#555;cursor:pointer;user-select:none;list-style:none;padding:2px 0;">▶ ${baseLabel}</summary>${this._statGrid(cols, ...cells(true))}</details>`,
        };
    }

    /** Add hoverData to clickable rows; skips labels, non-clickable, and already-enriched. */
    _enrichHoverData(items, { actor, category })
    {
        return items.map(/** @type {any} */ (it) =>
            it.hoverData || it.isSectionLabel || !it.onClick
                ? it
                : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category } }
        );
    }

    /** Red-strike HTML for an item/action whose source item is destroyed. */
    _destroyedLabel(name)
    {
        return `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${escapeHtml(name)}</s>`;
    }

    _cascadingLabel(name)
    {
        return `<span class="horus--subtle" style="color:#c084fc;">${escapeHtml(name)}</span>`;
    }

    /** Build the invade popup body + subtitle and open it. */
    _buildInvadePopup(opt, row)
    {
        const tier = opt.item?.parent?.system?.tier ?? 1;
        let bodyHtml;
        if (opt.action)
            bodyHtml = laRenderActionDetail(opt.action, { tier });
        else
        {
            const detail = laFormatDetailHtml(opt.detail);
            bodyHtml = detail
                ? `<div style="margin:0;font-size:0.82em;line-height:1.5;">${detail}</div>`
                : '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
        }
        bodyHtml = this._pendingBlockHtml() + this._actionLockReasonHtml(opt.name, 'quick', 'Quick Tech') + bodyHtml;
        const isWeapon    = opt.item?.type?.includes('weapon');
        const sourceType  = isWeapon ? ' (Weapon)' : (opt.item?.system?.type ? ` (${opt.item.system.type})` : '');
        const sourceLabel = !opt.isFragmentSignal && opt.item?.name ? ` · ${opt.item.name}${sourceType}` : '';
        const subtitle    = (opt.isFragmentSignal ? 'Fragment Signal · Quick Tech' : 'Invade · Quick Tech') + sourceLabel;
        this._showItemPopup({
            cssClass: 'la-hud-popup la-hud-invade-popup',
            dataKey: 'invade-name',
            dataValue: opt.name,
            title: opt.name,
            theme: 'invade',
            subtitle,
            bodyHtml,
            item: opt.item,
            row,
            pips: !!(opt.item && opt.action),
            pipsArgs: opt.action ? { action: opt.action } : undefined,
        });
    }
}
