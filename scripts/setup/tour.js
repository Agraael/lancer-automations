/* global Tour, game, ui, Dialog, Hooks, FormApplication, $, fetch */

import { maybeRunSettingsOnboarding } from './settings-onboarding.js';
import { localize } from '../tools/string-utils.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getWeapons } from '../interactive/deployables.js';

const SETTING_TOUR_DONE = 'tourCompleted';
const SETTING_MOVEMENT_WARNING_SHOWN = 'movementWarningShown';
import { MODULE_ID } from '../tools/constants.js';
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
        title: localize('LA.tour.step.effectManager'),
        content: localize('LA.tour.content.codingAndAutomationCanFeelRough'),
        selector: `${EM_ROOT} .lancer-dialog-header`,
    },
    {
        id: 'em-std',
        title: localize('LA.tour.step.standard'),
        content: localize('LA.tour.content.theStandardEffectPagePickA'),
        selector: `${EM_ROOT} #tab-standard`,
        action: _emTabClick('standard'),
    },
    {
        id: 'em-std-pick',
        title: localize('LA.tour.step.standardEffect'),
        content: localize('LA.tour.content.pickAStatusAndAStack'),
        selector: `${EM_ROOT} #std-effect-grid`,
    },
    {
        id: 'em-std-duration',
        title: localize('LA.tour.step.standardDuration'),
        content: localize('LA.tour.content.howLongItSticksEndStart'),
        selector: `${EM_ROOT} #std-duration`,
    },
    {
        id: 'em-std-trigger',
        title: localize('LA.tour.step.standardConsumeOn'),
        content: localize('LA.tour.content.optionalAutoConsumeTriggerOnHit'),
        selector: `${EM_ROOT} #std-trigger`,
    },
    {
        id: 'em-presets',
        title: localize('LA.tour.step.presets'),
        content: localize('LA.tour.content.saveAFilledInEffectAs'),
        selector: `${EM_ROOT} .preset-bar`,
    },
    {
        id: 'em-custom',
        title: localize('LA.tour.step.custom'),
        content: localize('LA.tour.content.registeringEveryPossibleStatusFromNpc'),
        selector: `${EM_ROOT} #tab-custom`,
        action: _emTabClick('custom'),
    },
    {
        id: 'em-custom-build',
        title: localize('LA.tour.step.customBuild'),
        content: localize('LA.tour.content.nameIconDurationNoteSameShape'),
        selector: `${EM_ROOT} #cust-name`,
    },
    {
        id: 'em-custom-saved',
        title: localize('LA.tour.step.customSaved'),
        content: localize('LA.tour.content.statusesSavedThroughTemporaryCustomStatuses'),
        selector: `${EM_ROOT} #cust-saved`,
    },
    {
        id: 'em-bonus',
        title: localize('LA.tour.step.bonus'),
        content: localize('LA.tour.content.theAdvancedStuffAndOneOf'),
        selector: `${EM_ROOT} #tab-bonus`,
        action: _emTabClick('bonus'),
    },
    {
        id: 'em-bonus-type',
        title: localize('LA.tour.step.bonusType'),
        content: localize('LA.tour.content.theBonusTypeEachOneReveals'),
        selector: `${EM_ROOT} #bonus-type`,
    },
    {
        id: 'em-bonus-trigger',
        title: localize('LA.tour.step.bonusConsume'),
        content: localize('LA.tour.content.sameTriggerPickerAsStandardCombined'),
        selector: `${EM_ROOT} #bonus-trigger`,
    },
    {
        id: 'em-bonus-add',
        title: localize('LA.tour.step.bonusAdd'),
        content: localize('LA.tour.content.addsTheBonusToTheTarget'),
        selector: `${EM_ROOT} #bonus-add`,
    },
    {
        id: 'em-manage',
        title: localize('LA.tour.step.manage'),
        content: localize('LA.tour.content.everythingCurrentlyOnATokenIncluding'),
        selector: `${EM_ROOT} #tab-manage`,
        action: _emTabClick('manage'),
    },
];

const AD_EXTRA_STEPS = [
    {
        id: 'sheet-btn',
        title: localize('LA.tour.step.onASheet'),
        content: localize('LA.tour.content.addExtrasAndEffectsToAny'),
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
        title: localize('LA.tour.step.lAMenu'),
        content: localize('LA.tour.content.theLAButtonOpensThis'),
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
        title: localize('LA.tour.step.addExtra'),
        content: localize('LA.tour.content.addExtraOpensThisTieExtra'),
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
        title: localize('LA.tour.step.extraActions'),
        content: localize('LA.tour.content.customActionsBoltedOntoTheActor'),
        selector: '.la-extras-act-new',
    },
    {
        id: 'extra-deploy',
        title: localize('LA.tour.step.extraDeployables'),
        content: localize('LA.tour.content.attachDeployablesByActorOrLid'),
        selector: '.la-extras-dep-new',
    },
    {
        id: 'extra-bars',
        title: localize('LA.tour.step.extraBars'),
        content: localize('LA.tour.content.quickAddAManualTokenStat'),
        selector: '.la-extras-bar-new',
    },
    {
        id: 'extra-drawer',
        title: localize('LA.tour.step.editor'),
        content: localize('LA.tour.content.actionsCanAlsoBeAnAttack'),
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
        title: localize('LA.tour.step.whereToFindThis'),
        content: localize('LA.tour.content.reOpenThisAnyTimeFrom'),
        selector: '#lancer-automations-overview',
        action: () =>
        {
            /** @type {any} */ (ui).sidebar?.activateTab?.('settings');
        },
    },
    {
        id: 'welcome',
        title: localize('LA.tour.step.configuration'),
        content: localize('LA.tour.content.prettySimpleHereSTheConfiguration'),
        selector: `${ROOT} .lancer-dialog-header`,
    },
    {
        id: 'tabs',
        title: localize('LA.tour.step.pages'),
        content: localize('LA.tour.content.everyPageGroupsRelatedStuffSorted'),
        selector: `${ROOT} .la-config-rail`,
    },
    {
        id: 'activations',
        tab: 'activations',
        title: localize('LA.tour.step.activations'),
        content: localize('LA.tour.content.howActivationPopupsFeelDuringPlay'),
        selector: `${ROOT} .tab[data-tab="activations"]`,
    },
    {
        id: 'combat',
        tab: 'combat',
        title: localize('LA.tour.step.combatMovement'),
        content: localize('LA.tour.content.allTheCombatFlavorTogglesKnockback'),
        selector: `${ROOT} .tab[data-tab="combat"]`,
    },
    {
        id: 'wrecks',
        tab: 'wrecks',
        title: localize('LA.tour.step.wrecks'),
        content: localize('LA.tour.content.whatHappensWhenSomethingDiesSpawn'),
        selector: `${ROOT} .tab[data-tab="wrecks"]`,
    },
    {
        id: 'tokens',
        tab: 'tokens',
        title: localize('LA.tour.step.tokensDisplay'),
        content: localize('LA.tour.content.halfSizeTokensAutoWallHeight'),
        selector: `${ROOT} .tab[data-tab="tokens"]`,
    },
    {
        id: 'iso',
        tab: 'iso',
        title: localize('LA.tour.step.isometric'),
        content: localize('LA.tour.content.fixesForIsometricModulesIsometricPerspective'),
        selector: `${ROOT} .tab[data-tab="iso"]`,
        condition: () => !!game.modules.get('isometric-perspective')?.active || !!game.modules.get('grape_juice-isometrics')?.active,
    },
    {
        id: 'tah',
        tab: 'tah',
        title: localize('LA.tour.step.tokenActionHud'),
        content: localize('LA.tour.content.hereYouCanEnableTheTah'),
        selector: `${ROOT} .tab[data-tab="tah"]`,
    },
    {
        id: 'sounds',
        tab: 'sounds',
        title: localize('LA.tour.step.sounds'),
        content: localize('LA.tour.content.allTheSoundFeedbackOptionsIncluding'),
        selector: `${ROOT} .tab[data-tab="sounds"]`,
    },
    {
        id: 'statuses',
        tab: 'statuses',
        title: localize('LA.tour.step.statusesFx'),
        content: localize('LA.tour.content.theFxSectionStatusVisualEffects'),
        selector: `${ROOT} .tab[data-tab="statuses"]`,
    },
    {
        id: 'debug',
        tab: 'debug',
        title: localize('LA.tour.step.debug'),
        content: localize('LA.tour.content.flipTheseOnIfSomethingFeels'),
        selector: `${ROOT} .tab[data-tab="debug"]`,
    },
    {
        id: 'tools',
        tab: 'tools',
        title: localize('LA.tour.step.toolsExtras'),
        content: localize('LA.tour.content.myOptionalContentPacksPersonalStuff'),
        selector: `${ROOT} .tab[data-tab="tools"]`,
    },
    {
        id: 'vision',
        tab: 'experimental',
        title: localize('LA.tour.step.vision'),
        content: localize('LA.tour.content.visionFromEdgeForBigTokens'),
        selector: `${ROOT} .tab[data-tab="experimental"]`,
    },
    {
        id: 'tutorials',
        tab: 'tutorials',
        title: localize('LA.tour.step.tutorialsHelp'),
        content: localize('LA.tour.content.reRunTheSetupWizardOr'),
        selector: `${ROOT} .tab[data-tab="tutorials"]`,
    },
    {
        id: 'save',
        title: localize('LA.common.save'),
        content: localize('LA.tour.content.oneSaveCommitsEveryTabAt'),
        selector: `${ROOT} footer`,
    },
];

const ACTIVATION_MANAGER_STEPS = [
    {
        id: 'shortcut',
        title: localize('LA.tour.step.whereToFindThis'),
        content: localize('LA.tour.content.reOpenActivationManager'),
        selector: '#lancer-automations-manager',
        action: () =>
        {
            /** @type {any} */ (ui).sidebar?.activateTab?.('settings');
        },
    },
    {
        id: 'welcome',
        title: localize('LA.tour.step.activationManager'),
        content: localize('LA.tour.content.whereYouBuildAutomationsItemBound'),
        selector: `${RM_ROOT} .lancer-dialog-header`,
    },
    {
        id: 'tabs',
        title: localize('LA.tour.step.tabs'),
        content: localize('LA.tour.content.customIsYourOwnStuffDefaults'),
        selector: `${RM_ROOT} .sheet-tabs`,
    },
    {
        id: 'custom',
        tab: 'custom',
        title: localize('LA.tour.step.custom'),
        content: localize('LA.tour.content.yourActivationsGroupedIntoFoldersEach'),
        selector: `${RM_ROOT} .tab[data-tab="custom"]`,
    },
    {
        id: 'add',
        tab: 'custom',
        title: 'Add',
        content: localize('LA.tour.content.createANewOneYouLl'),
        selector: `${RM_ROOT} .tab[data-tab="custom"] .add-reaction`,
    },
    {
        id: 'editor',
        title: localize('LA.tour.step.editor'),
        content: localize('LA.tour.content.addOpensThisEditorTriggersFilters'),
        selector: '#reaction-editor',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-binding',
        title: localize('LA.tour.step.itemBoundOrGeneral'),
        content: localize('LA.tour.content.bindItToAnItemBy'),
        selector: '#reaction-editor input[name="isGeneral"]',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-lid',
        title: localize('LA.tour.step.itemLid'),
        content: localize('LA.tour.content.forItemBoundActivationsTheItem'),
        selector: '#reaction-editor input[name="lid"]',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-triggers',
        title: localize('LA.tour.step.triggers'),
        content: localize('LA.tour.content.tickTheTriggersThatFireIt'),
        selector: '#reaction-editor .trigger-groups-container',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-options',
        title: localize('LA.tour.step.filters'),
        content: localize('LA.tour.content.narrowWhenItFiresReactTo'),
        selector: '#reaction-editor .options-grid',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-code',
        title: localize('LA.tour.step.codeBlocks'),
        content: localize('LA.tour.content.yourLogicEvaluateShouldItFire'),
        selector: '#reaction-editor .CodeMirror',
        action: _ensureReactionEditorOpen,
    },
    {
        id: 'editor-autocomplete',
        title: localize('LA.tour.step.autocomplete'),
        content: localize('LA.tour.content.theEditorSuggestsApiNamesAs'),
        selector: '#reaction-editor .CodeMirror',
        action: _ensureReactionEditorOpen,
        cleanup: _closeReactionEditor,
    },
    {
        id: 'folder',
        tab: 'custom',
        title: localize('LA.tour.step.folders'),
        content: localize('LA.tour.content.makeFoldersToKeepThingsTidy'),
        selector: `${RM_ROOT} .tab[data-tab="custom"] .create-folder-btn`,
    },
    {
        id: 'search',
        tab: 'custom',
        title: localize('LA.tour.step.searchFilter'),
        content: localize('LA.tour.content.filterByNameLidOrTrigger'),
        selector: `${RM_ROOT} .tab[data-tab="custom"] .filter-bar`,
    },
    {
        id: 'defaults',
        tab: 'defaults',
        title: localize('LA.tour.step.defaults'),
        content: localize('LA.tour.content.theActivationsBundledWithTheModule'),
        selector: `${RM_ROOT} .tab[data-tab="defaults"]`,
    },
    {
        id: 'startup',
        tab: 'startup',
        title: localize('LA.tour.step.startup'),
        content: localize('LA.tour.content.jsThatRunsOnceOnFoundry'),
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
        title: localize('LA.tour.step.tokenActionHud'),
        content: localize('LA.tour.content.theLancerAutomationsTokenActionHud'),
        selector: TAH_ROOT,
    },
    {
        id: 'token-name',
        title: localize('LA.tour.step.tokenName'),
        content: localize('LA.tour.content.clickTheNameToOpenThe'),
        selector: `${TAH_ROOT} .la-hud-token-name`,
    },
    {
        id: 'move-hud',
        title: localize('LA.tour.step.moveTheHud'),
        content: localize('LA.tour.content.unlockWithTheLockIconThen'),
        selector: `${TAH_ROOT} .la-hud-lock`,
    },
    {
        id: 'combat-toggle',
        title: localize('LA.tour.step.combatToggle'),
        content: localize('LA.tour.content.clickTheSwordsIconToAdd'),
        selector: `${TAH_ROOT} .la-combat-toggle`,
    },
    {
        id: 'stats',
        title: localize('LA.tour.step.statsBar'),
        content: localize('LA.tour.content.liveVitalsHpHeatStructureAnd'),
        selector: '#la-hud-stats',
    },
    {
        id: 'stats-detail',
        title: localize('LA.tour.step.moreStats'),
        content: localize('LA.tour.content.clickToExpandArmorEvasionE'),
        selector: `#la-hud-stats .la-stats-toggle`,
    },
    {
        id: 'movement',
        title: localize('LA.tour.step.movementCap'),
        content: localize('LA.tour.content.theRightNumberIsTheMax'),
        selector: '#la-combat-bar',
    },
    {
        id: 'action-economy',
        title: localize('LA.tour.step.actionTracker'),
        content: localize('LA.tour.content.quickFullReactionProtocolMovePips'),
        selector: '#la-combat-bar',
    },
    {
        id: 'move-history',
        title: localize('LA.tour.step.movementHistory'),
        content: localize('LA.tour.content.revertTheLastMoveOrClear'),
        selector: '#la-combat-bar span[title="Revert Last Move"]',
    },
    {
        id: 'keyboard-nav',
        title: localize('LA.tour.step.keyboardNavigation'),
        content: localize('LA.tour.content.driveTheHudByKeyboardShift'),
        selector: `${TAH_ROOT} .la-hud-col-label`,
    },
    {
        id: 'categories',
        title: localize('LA.tour.step.categories'),
        content: localize('LA.tour.content.theMenuColumnListsCategoriesActions'),
        selector: `${TAH_ROOT} .la-hud-col-label`,
    },
    {
        id: 'item-row',
        title: localize('LA.tour.step.itemRows'),
        content: localize('LA.tour.content.anyRowThatIsNotA'),
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
        title: localize('LA.tour.step.automationHint'),
        content: localize('LA.tour.content.aColouredTriangleOnARow'),
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
        title: localize('LA.tour.step.rightClickDetails'),
        content: localize('LA.tour.content.rightClickAnyItemOrShift'),
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
        title: localize('LA.tour.step.search'),
        content: localize('LA.tour.content.clickTheMagnifierOrPressShift'),
        selector: `${TAH_ROOT} .la-hud-search-toggle`,
    },
    {
        id: 'favorites',
        title: localize('LA.tour.step.favorites'),
        content: localize('LA.tour.content.ctrlRightClickAnyActionTo'),
        selector: `${TAH_ROOT} .la-hud-fav-icon`,
    },
    {
        id: 'action-wheel',
        title: localize('LA.tour.step.actionWheel'),
        content: localize('LA.tour.content.pressFOnASelectedToken'),
        selector: 'body',
        allowCanvas: true,
        action: async () =>
        {
            if (!canvas.tokens.controlled[0])
                canvas.tokens.placeables.find((token) => token.actor && !token.document.hidden)?.control({ releaseOthers: true });
            const { toggleActionWheel } = await import('../tah/action-wheel.js');
            if (!document.querySelector('.lancer-action-wheel'))
                await toggleActionWheel();
        },
        cleanup: async () =>
        {
            if (document.querySelector('.lancer-action-wheel'))
            {
                const { closeRadialWheel } = await import('../tools/radial-wheel.js');
                closeRadialWheel({ silent: true });
            }
        },
    },
    {
        id: 'status-wheel',
        title: localize('LA.tour.step.statusWheel'),
        content: localize('LA.tour.content.pressGForTheStatusesOn'),
        selector: 'body',
        allowCanvas: true,
        action: async () =>
        {
            if (!canvas.tokens.controlled[0])
                canvas.tokens.placeables.find((token) => token.actor && !token.document.hidden)?.control({ releaseOthers: true });
            const { toggleStatusWheel } = await import('../tah/status-wheel.js');
            if (!document.querySelector('.lancer-status-wheel'))
                toggleStatusWheel();
        },
        cleanup: async () =>
        {
            if (document.querySelector('.lancer-status-wheel'))
            {
                const { closeRadialWheel } = await import('../tools/radial-wheel.js');
                closeRadialWheel({ silent: true });
            }
        },
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
        title: localize('LA.tour.step.utility'),
        content: localize('LA.tour.content.subCategoriesOfToolsGameplayActions'),
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
        title: localize('LA.tour.step.andMore'),
        content: localize('LA.tour.content.thereIsALotMoreUnder'),
        selector: TAH_ROOT,
    },
];

const ADV_TAH_STEPS = [
    {
        id: 'adv-intro',
        title: localize('LA.tour.step.advancedTahTools'),
        content: localize('LA.tour.content.aPassThroughTheToolsTucked'),
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
        title: localize('LA.tour.step.andMore'),
        content: localize('LA.tour.content.thatSTheToolboxDigThrough'),
        selector: TAH_ROOT,
    },
];

const RULER_STEPS = [
    {
        id: 'intro',
        title: localize('LA.tour.step.lancerRuler'),
        content: localize('LA.tour.content.dragATokenToMeasureThe'),
        selector: 'body',
        allowCanvas: true,
    },
    {
        id: 'wheel',
        title: localize('LA.tour.step.movementWheel'),
        content: localize('LA.tour.content.pressMOnASelectedToken'),
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
        title: localize('LA.tour.step.cycleWhileDragging'),
        content: localize('LA.tour.content.duringADragPressMTo'),
        selector: 'body',
        allowCanvas: true,
    },
    {
        id: 'free-debug',
        title: localize('LA.tour.step.freeDebug'),
        content: localize('LA.tour.content.holdVForFreeMovementNo'),
        selector: 'body',
        allowCanvas: true,
    },
    {
        id: 'force',
        title: localize('LA.tour.step.forceMovement'),
        content: localize('LA.tour.content.forceIsUnintentionalMovementKnockbackDrag'),
        selector: 'body',
        allowCanvas: true,
    },
];

const AM_ROOT = '#la-measure-toolbar';

const ADV_MEASURE_STEPS = [
    {
        id: 'intro',
        title: localize('LA.tour.step.advancedMeasure'),
        content: localize('LA.tour.content.aMeasuringToolsetReusingLaS'),
        selector: AM_ROOT,
    },
    {
        id: 'help',
        title: localize('LA.tour.step.shortcuts'),
        content: localize('LA.tour.content.hoverHereForTheFullCheat'),
        selector: `${AM_ROOT} .la-mt-help`,
    },
    {
        id: 'shapes',
        title: localize('LA.tour.step.shapes'),
        content: localize('LA.tour.content.pickAShapeBlastBurstCone'),
        selector: `${AM_ROOT} .la-mt-icon-btn`,
    },
    {
        id: 'range',
        title: localize('LA.tour.step.rangePulse'),
        content: localize('LA.tour.content.pulseARangeAroundTheShape'),
        selector: `${AM_ROOT} .la-mt-dd`,
    },
    {
        id: 'pins',
        title: localize('LA.tour.step.pinnedRings'),
        content: localize('LA.tour.content.rightClickARangeSourceOr'),
        selector: `${AM_ROOT} .la-mt-dd`,
    },
    {
        id: 'marker',
        title: localize('LA.tour.step.markersRuler'),
        content: localize('LA.tour.content.shiftClickInFreeModeMarks'),
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
            title: localize('LA.tour.step.lancerAutomations'),
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">${localize('LA.tour.placeTokenTitle')}</div>
                    <div class="lancer-dialog-subtitle">${localize('LA.tour.placeTokenSubtitle')}</div>
                </div>
                <p style="padding: 4px 6px;">${localize('LA.tour.placeTokenBody')}</p>
            `,
            buttons: {
                continue: {
                    icon: '<i class="fas fa-check"></i>',
                    label: localize('LA.common.continue'),
                    callback: () => resolve(true),
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: localize('LA.tour.cancelTour'),
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
    if (!getModuleSetting('tahEnabled'))
    {
        const enable = await new Promise((resolve) =>
        {
            new Dialog({
                title: localize('LA.tour.step.tokenActionHud'),
                content: localize('LA.tour.content.tokenActionHudIsOffEnable'),
                buttons: {
                    yes: { icon: '<i class="fas fa-check"></i>', label: localize('LA.common.enable'), callback: () => resolve(true) },
                    no:  { icon: '<i class="fas fa-times"></i>', label: localize('LA.common.skip'),   callback: () => resolve(false) },
                },
                default: 'yes',
                close: () => resolve(false),
            }, { classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
        });
        if (!enable)
            return false;
        await game.settings.set(MODULE_ID, 'tahEnabled', true);
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

class _RootTour extends foundry.nue.Tour
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
            const tab = document.querySelector(`${this._root} nav.tabs a[data-tab="${step.tab}"]`);
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
        ui.notifications.warn(localize('LA.notify.theAddExtraTourNeedsAMech'));
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
        title: localize('LA.tour.step.lancerAutomationsConfiguration'),
        description: localize('LA.tour.guidedWalkthroughOfEveryTabIn'),
        root: ROOT,
        steps: () => CONFIG_STEPS.filter(step => !(/** @type {any} */ (step).condition) || /** @type {any} */ (step).condition()),
        ensure: _ensureConfigOpen,
        gated: false,
        assign: (tour) => { _configTour = tour; },
        get: () => _configTour,
    },
    {
        id: 'activation-manager-tour',
        title: localize('LA.tour.step.lancerAutomationsActivationManager'),
        description: localize('LA.tour.walksThroughTheActivationManagerDialog'),
        root: RM_ROOT,
        steps: () => ACTIVATION_MANAGER_STEPS,
        ensure: _ensureActivationManagerOpen,
        gated: false,
        assign: (tour) => { _activationTour = tour; },
        get: () => _activationTour,
    },
    {
        id: 'tah-tour',
        title: localize('LA.tour.step.lancerAutomationsTokenActionHud'),
        description: localize('LA.tour.walksThroughTheTokenActionHud'),
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
        title: localize('LA.tour.step.lancerAutomationsTahAdvancedTools'),
        description: localize('LA.tour.theGameplayToolsInsideTheToken'),
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
        title: localize('LA.tour.step.lancerAutomationsEffectManager'),
        description: localize('LA.tour.walksThroughTheEffectManagerDialog'),
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
        title: localize('LA.tour.step.lancerAutomationsLancerRuler'),
        description: localize('LA.tour.theMovementWheelMovementTypesAnd'),
        root: 'body',
        steps: () => RULER_STEPS,
        assign: (tour) => { _rulerTour = tour; },
        get: () => _rulerTour,
    },
    {
        id: 'advanced-measure-tour',
        title: localize('LA.tour.step.lancerAutomationsAdvancedMeasure'),
        description: localize('LA.tour.theAdvancedMeasureToolShapesRanges'),
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
        title: localize('LA.tour.step.lancerAutomationsAddExtra'),
        description: localize('LA.tour.addExtraAddEffectAndExtra'),
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
        await game.settings.set(MODULE_ID, SETTING_TOUR_DONE, true);
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
                label: localize('LA.settings.settingsOnboardingMenu.name'),
                callback: () => resolve('setup'),
            };
        }
        buttons.start = {
            icon: '<i class="fas fa-play"></i>',
            label: localize('LA.settings.tourMenu.label'),
            callback: () => resolve('tour'),
        };
        buttons.skip = {
            icon: '<i class="fas fa-times"></i>',
            label: localize('LA.common.skip'),
            callback: () => resolve('skip'),
        };
        new Dialog({
            title: localize('LA.tour.step.lancerAutomations'),
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
                    <p style="margin: 0; opacity: 0.85;">This module is free and always will be. If you wanna support my late nights, <a href="https://www.patreon.com/cw/LaSossis" target="_blank" rel="noopener">Patreon</a> or <a href="https://ko-fi.com/lasossis" target="_blank" rel="noopener">Ko-fi</a>.</p>
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
            title: localize('LA.tour.step.lancerAutomationsMovement'),
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
                    label: localize('LA.common.gotIt'),
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
    const shown = !!getModuleSetting(SETTING_MOVEMENT_WARNING_SHOWN);
    if (shown)
        return;
    await _movementWarningDialog();
    try
    {
        await game.settings.set(MODULE_ID, SETTING_MOVEMENT_WARNING_SHOWN, true);
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
        await game.settings.set(MODULE_ID, SETTING_TOUR_DONE, true);
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
    game.settings.register(MODULE_ID, SETTING_TOUR_DONE, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });

    game.settings.register(MODULE_ID, SETTING_MOVEMENT_WARNING_SHOWN, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });

    game.settings.registerMenu(MODULE_ID, 'tourMenu', {
        name: 'LA.settings.tourMenu.name',
        label: 'LA.settings.tourMenu.label',
        hint: 'LA.settings.tourMenu.hint',
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
                game.tours.register(MODULE_ID, entry.id, tour);
            }
            catch (e)
            {
                console.error(`lancer-automations | failed to register tour ${entry.id}`, e);
            }
        }
        console.log('lancer-automations | tours registered OK', game.tours.get(`${MODULE_ID}.config-tour`), game.tours.get(`${MODULE_ID}.activation-manager-tour`), game.tours.get(`${MODULE_ID}.tah-tour`));
    };

    Hooks.once('setup', doRegister);

    Hooks.once('ready', async () =>
    {
        const done = !!getModuleSetting(SETTING_TOUR_DONE, true);
        if (!done)
            await _runChooser();
        await _maybeShowMovementWarning();
    });
}
