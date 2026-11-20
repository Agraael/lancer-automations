/* global Tour, game, ui, Dialog, Hooks, FormApplication, $, fetch */

import { maybeRunSettingsOnboarding } from './settings-onboarding.js';
import { localize, localizeFormat } from '../tools/string-utils.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getBoostOfferMode } from './settings-register.js';
import { getWeapons } from '../interactive/deployables.js';
import { queueFirstRun } from './first-run-queue.js';

const SETTING_TOUR_DONE = 'tourCompleted';
const SETTING_RESUME_TOUR = 'tourResumeAfterReload';
const GM_TOUR_IDS = ['config-tour', 'activation-manager-tour', 'tah-tour', 'effect-manager-tour', 'ruler-tour', 'attack-tour', 'vision-tour', 'carousel-tour', 'cards-tour', 'roll-uplink-tour', 'battle-log-tour', 'clocks-tour', 'advanced-measure-tour'];
const PLAYER_TOUR_IDS = ['tah-tour', 'ruler-tour', 'attack-tour', 'vision-tour', 'carousel-tour', 'cards-tour', 'clocks-tour', 'advanced-measure-tour'];
const TOUR_GROUPS = [
    { label: 'LA.settingsMenus.section.tutorialsStart.label', ids: ['config-tour', 'tah-tour', 'ruler-tour'] },
    { label: 'LA.settingsMenus.section.tutorialsCombat.label', ids: ['attack-tour', 'vision-tour', 'carousel-tour', 'cards-tour', 'roll-uplink-tour', 'battle-log-tour'] },
    { label: 'LA.settingsMenus.section.tutorialsTools.label', ids: ['clocks-tour', 'tah-advanced-tour', 'advanced-measure-tour', 'effect-manager-tour', 'add-extra-tour'] },
    { label: 'LA.settingsMenus.section.tutorialsAutomation.label', ids: ['activation-manager-tour'] },
];
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

const EFFECT_MANAGER_STEPS = () => [
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

const AD_EXTRA_STEPS = () => [
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

const _configTabStep = (tab, contentKey) => ({
    id: tab,
    tab,
    title: localize(`LA.settingsMenus.tab.${tab}.label`),
    content: localize(contentKey),
    selector: `${ROOT} .tab[data-tab="${tab}"]`,
});

const CONFIG_STEPS = () => [
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
    _configTabStep('ruler', 'LA.tour.content.configRulerIs'),
    {
        id: 'statuses',
        tab: 'statuses',
        title: localize('LA.tour.step.statusesFx'),
        content: localize('LA.tour.content.theFxSectionStatusVisualEffects'),
        selector: `${ROOT} .tab[data-tab="statuses"]`,
    },
    {
        id: 'vision',
        tab: 'vision',
        title: localize('LA.tour.step.vision'),
        content: localize('LA.tour.content.visionFromEdgeForBigTokens'),
        selector: `${ROOT} .tab[data-tab="vision"]`,
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
    _configTabStep('statbars', 'LA.tour.content.configStatBarsIs'),
    {
        id: 'tah',
        tab: 'tah',
        title: localize('LA.tour.step.tokenActionHud'),
        content: localize('LA.tour.content.hereYouCanEnableTheTah'),
        selector: `${ROOT} .tab[data-tab="tah"]`,
    },
    _configTabStep('colors', 'LA.tour.content.configColorsIs'),
    {
        id: 'sounds',
        tab: 'sounds',
        title: localize('LA.tour.step.sounds'),
        content: localize('LA.tour.content.allTheSoundFeedbackOptionsIncluding'),
        selector: `${ROOT} .tab[data-tab="sounds"]`,
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
        ..._configTabStep('mapModules', 'LA.tour.content.configMapModulesIs'),
        condition: () => !!game.modules.get('terrain-height-tools')?.active || !!game.modules.get('templatemacro')?.active,
    },
    _configTabStep('battelog', 'LA.tour.content.configBattleLogIs'),
    {
        id: 'tools',
        tab: 'tools',
        title: localize('LA.tour.step.toolsExtras'),
        content: localize('LA.tour.content.myOptionalContentPacksPersonalStuff'),
        selector: `${ROOT} .tab[data-tab="tools"]`,
    },
    _configTabStep('control', 'LA.tour.content.configControlIs'),
    {
        id: 'tutorials',
        tab: 'tutorials',
        title: localize('LA.tour.step.tutorialsHelp'),
        content: localize('LA.tour.content.reRunTheSetupWizardOr'),
        selector: `${ROOT} .tab[data-tab="tutorials"]`,
    },
    _configTabStep('performance', 'LA.tour.content.configPerformanceIs'),
    {
        id: 'debug',
        tab: 'debug',
        title: localize('LA.tour.step.debug'),
        content: localize('LA.tour.content.flipTheseOnIfSomethingFeels'),
        selector: `${ROOT} .tab[data-tab="debug"]`,
    },
    {
        id: 'save',
        title: localize('LA.common.save'),
        content: localize('LA.tour.content.oneSaveCommitsEveryTabAt'),
        selector: `${ROOT} footer`,
    },
];

const ACTIVATION_MANAGER_STEPS = () => [
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
        action: _ensureAutomationEditorOpen,
    },
    {
        id: 'editor-binding',
        title: localize('LA.tour.step.itemBoundOrGeneral'),
        content: localize('LA.tour.content.bindItToAnItemBy'),
        selector: '#reaction-editor input[name="isGeneral"]',
        action: _ensureAutomationEditorOpen,
    },
    {
        id: 'editor-lid',
        title: localize('LA.tour.step.itemLid'),
        content: localize('LA.tour.content.forItemBoundActivationsTheItem'),
        selector: '#reaction-editor input[name="lid"]',
        action: _ensureAutomationEditorOpen,
    },
    {
        id: 'editor-triggers',
        title: localize('LA.tour.step.triggers'),
        content: localize('LA.tour.content.tickTheTriggersThatFireIt'),
        selector: '#reaction-editor .trigger-groups-container',
        action: _ensureAutomationEditorOpen,
    },
    {
        id: 'editor-options',
        title: localize('LA.tour.step.filters'),
        content: localize('LA.tour.content.narrowWhenItFiresReactTo'),
        selector: '#reaction-editor .la-eligibility',
        action: _ensureAutomationEditorOpen,
    },
    {
        id: 'editor-code',
        title: localize('LA.tour.step.codeBlocks'),
        content: localize('LA.tour.content.yourLogicEvaluateShouldItFire'),
        selector: '#reaction-editor .CodeMirror',
        action: _ensureAutomationEditorOpen,
    },
    {
        id: 'editor-autocomplete',
        title: localize('LA.tour.step.autocomplete'),
        content: localize('LA.tour.content.theEditorSuggestsApiNamesAs'),
        selector: '#reaction-editor .CodeMirror',
        action: _ensureAutomationEditorOpen,
        cleanup: _closeAutomationEditor,
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

            for (let attempt = 0; attempt < 40; attempt++)
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

const TAH_STEPS = () => [
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
        selector: '#la-combat-bar span[title="Revert Last Action"]',
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
            const col1Rows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));

            if (col1Rows[0])
            {
                $(col1Rows[0]).trigger('mouseenter');
                $(col1Rows[0]).trigger('click');
            }

            for (let i = 0; i < 40; i++)
            {
                const allRows = document.querySelectorAll(`${TAH_ROOT} .la-hud-row`);
                if (allRows.length > col1Rows.length)
                    break;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }

            const allRows = Array.from(document.querySelectorAll(`${TAH_ROOT} .la-hud-row`));
            const firstItemRow = allRows[col1Rows.length];
            firstItemRow?.classList.add('la-hud-tour-item');
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
                const leaf = document.querySelector(`${TAH_ROOT} .la-hud-row.la-hud-rclick`);

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
    _tahCategoryStep('Actions', "Your actions, grouped by activation: Basic, Attacks, Invades, Quick, Full, Reactions and more. Tech actions sit with their activation."),
    _tahDrillStep('actions-basic', 'Basic', "The common actions, split into Quick and Full sections.", ['actions'], 'basic'),
    _tahDrillStep('actions-attacks', 'Attacks', "Skirmish, Barrage, Fight, and the Basic Attack and Basic Tech tools.", ['actions'], 'attacks'),
    _tahDrillStep('actions-invades', 'Invades', "Invade, then every invade option you have.", ['actions'], 'invades'),
    _tahDrillStep('scan', 'Scan', "A successful scan feeds the target's data into the Glossary.", ['actions', 'quick actions'], 'scan'),
    _tahDrillStep('actions-reaction', 'Reactions', "Overwatch, Brace, and your other reactions.", ['actions'], 'reaction'),
    _tahCategoryStep('Weapons', "Equipped weapons, by mount."),
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
            const utilityRow = rows.find((row) => row.textContent?.trim().toLowerCase().startsWith('utility'));
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

const ADV_TAH_STEPS = () => _withNeeds([
    {
        id: 'adv-intro',
        title: localize('LA.tour.step.advancedTahTools'),
        content: localize('LA.tour.content.aPassThroughTheToolsTucked'),
        selector: TAH_ROOT,
    },
    _tahDrillStep('adv-attacks', localize('LA.tour.step.skirmishBarrage'), localize('LA.tour.content.tahSkirmishBarrage'), ['actions', 'attacks'], 'skirmish'),
    _tahDrillStep('adv-basic-tools', localize('LA.tour.step.basicTools'), localize('LA.tour.content.tahBasicTools'), ['actions', 'attacks'], 'basic attack'),
    _tahDrillStep('adv-boost', localize('LA.tour.step.boost'), localize('LA.tour.content.tahBoost'), ['actions', 'basic'], 'boost'),
    _tahDrillStep('adv-deploy', localize('LA.tour.step.deploy'), localize('LA.tour.content.tahDeploy'), ['deployables'], 'deploy item'),
    _tahDrillStep('adv-recall', localize('LA.tour.step.recallItem'), localize('LA.tour.content.tahRecallItem'), ['deployables'], 'recall item'),
    _tahDrillStep('adv-link-actor', localize('LA.tour.step.linkUnlinkActor'), localize('LA.tour.content.tahLinkUnlinkActor'), ['deployables'], 'link/unlink actor'),
    _tahDrillStep('adv-contest', localize('LA.tour.step.contest'), localize('LA.tour.content.tahContest'), ['attributes', 'skills'], 'contest'),
    _tahDrillStep('adv-force-check', localize('LA.tour.step.forceCheck'), localize('LA.tour.content.tahForceCheck'), ['attributes', 'skills'], 'force check'),
    _tahDrillStep('adv-scan', localize('LA.tour.step.generateScan'), localize('LA.tour.content.tahGenerateScan'), ['utility', 'gameplay'], 'generate scan'),
    _tahDrillStep('adv-link', localize('LA.tour.step.linkToToken'), localize('LA.tour.content.tahLinkToToken'), ['utility', 'gameplay'], 'link to token'),
    _tahDrillStep('adv-reinforcement', localize('LA.tour.step.reinforcement'), localize('LA.tour.content.tahReinforcement'), ['utility', 'gameplay'], 'reinforcement'),
    _tahDrillStep('adv-leave', localize('LA.tour.step.leaveBattlefield'), localize('LA.tour.content.tahLeaveBattlefield'), ['utility', 'gameplay'], 'leave battlefield'),
    _tahDrillStep('adv-downtime', localize('LA.tour.step.downtime'), localize('LA.tour.content.tahDowntime'), ['utility', 'misc'], 'downtime'),
    _tahDrillStep('adv-reserve', localize('LA.tour.step.reserve'), localize('LA.tour.content.tahReserve'), ['utility', 'misc'], 'reserve'),
    _tahDrillStep('adv-vote', localize('LA.tour.step.vote'), localize('LA.tour.content.tahVote'), ['utility', 'misc'], 'vote'),
    {
        id: 'adv-outro',
        title: localize('LA.tour.step.andMore'),
        content: localize('LA.tour.content.thatSTheToolboxDigThrough'),
        selector: TAH_ROOT,
    },
], {
    'adv-link-actor': ['deployLines'],
});

const RULER_DEMO = '#la-tour-ruler-demo';
const RULER_DEMO_LAST = `${RULER_DEMO} .la-demo-last`;

let _rulerCardShown = false;

async function _dropRulerCard()
{
    if (!_rulerCardShown)
        return;
    _rulerCardShown = false;
    await _hideEncounterDemos();
}

async function _rulerDemo()
{
    await _dropRulerCard();
    const { ensureRulerDemo } = await import('./tour-ruler-demo.js');
    await ensureRulerDemo();
}

async function _wheelDemo()
{
    await _dropRulerCard();
    const { showWheelPreview } = await import('./tour-ruler-demo.js');
    await showWheelPreview();
}

async function _hideRulerTourDemos()
{
    await _dropRulerCard();
    const { hideTourDemos } = await import('./tour-ruler-demo.js');
    hideTourDemos();
}

async function _boostCardDemo()
{
    const { hideTourDemos } = await import('./tour-ruler-demo.js');
    hideTourDemos();
    _rulerCardShown = true;
    await _cardDemo('boost');
}

const _rulerDemoStep = (id, titleKey, contentKey, selector) => ({
    id,
    title: localize(titleKey),
    content: localize(contentKey),
    selector,
    action: _rulerDemo,
});

const RULER_STEPS = () => _withNeeds([
    {
        id: 'intro',
        title: localize('LA.tour.step.lancerRuler'),
        content: localize('LA.tour.content.dragATokenToMeasureThe'),
        selector: 'body',
        allowCanvas: true,
        action: _hideRulerTourDemos,
    },
    {
        id: 'wheel',
        title: localize('LA.tour.step.movementWheel'),
        content: localize('LA.tour.content.pressMOnASelectedToken'),
        selector: '#la-tour-frame',
        action: _wheelDemo,
    },
    {
        id: 'wheel-current',
        title: localize('LA.tour.step.wheelCurrent'),
        content: localize('LA.tour.content.wheelCurrentType'),
        selector: '.lancer-movement-wheel .lancer-mw-btn.current',
        action: _wheelDemo,
    },
    {
        id: 'm-drag',
        title: localize('LA.tour.step.cycleWhileDragging'),
        content: localize('LA.tour.content.duringADragPressMTo'),
        selector: 'body',
        allowCanvas: true,
        action: _hideRulerTourDemos,
    },
    _rulerDemoStep('ruler-labels', 'LA.tour.step.rulerLabels', 'LA.tour.content.rulerLabelsIntro', RULER_DEMO),
    _rulerDemoStep('label-cost', 'LA.tour.step.labelCost', 'LA.tour.content.labelCostIs', `${RULER_DEMO_LAST} .la-badge-disc`),
    _rulerDemoStep('label-ring', 'LA.tour.step.labelRing', 'LA.tour.content.labelRingIs', RULER_DEMO),
    _rulerDemoStep('band-start', 'LA.tour.step.bandStart', 'LA.tour.content.bandStartIs', `${RULER_DEMO} .la-demo-boost`),
    _rulerDemoStep('label-distance', 'LA.tour.step.labelDistance', 'LA.tour.content.labelDistanceIs', `${RULER_DEMO_LAST} .la-notch`),
    _rulerDemoStep('label-row', 'LA.tour.step.labelRow', 'LA.tour.content.labelRowIs', `${RULER_DEMO_LAST} .la-badge-row`),
    _rulerDemoStep('label-saved', 'LA.tour.step.labelSaved', 'LA.tour.content.labelSavedIs', `${RULER_DEMO_LAST} .la-saved-value`),
    _rulerDemoStep('label-pathfind', 'LA.tour.step.labelPathfind', 'LA.tour.content.labelPathfindIs', `${RULER_DEMO_LAST} .la-badge-pathfind`),
    _rulerDemoStep('label-elevmode', 'LA.tour.step.labelElevMode', 'LA.tour.content.labelElevModeIs', `${RULER_DEMO_LAST} .la-badge-elevmode`),
    _rulerDemoStep('label-straight', 'LA.tour.step.labelStraight', 'LA.tour.content.labelStraightIs', `${RULER_DEMO_LAST} .la-badge-straight`),
    _rulerDemoStep('label-elevcost', 'LA.tour.step.labelElevCost', 'LA.tour.content.labelElevCostIs', `${RULER_DEMO_LAST} .la-badge-elevcost`),
    {
        id: 'boost-card',
        title: localize('LA.tour.step.pastYourSpeed'),
        content: localize('LA.tour.content.pastYourSpeedIs'),
        selector: TOUR_CARD,
        action: _boostCardDemo,
    },
    {
        id: 'over-speed',
        title: localize('LA.tour.step.overSpeed'),
        content: localize('LA.tour.content.overSpeedIs'),
        selector: TOUR_CARD,
        action: _boostCardDemo,
    },
    _rulerDemoStep('free-debug', 'LA.tour.step.freeDebug', 'LA.tour.content.holdVForFreeMovementNo', `${RULER_DEMO} .la-demo-free`),
    _rulerDemoStep('force', 'LA.tour.step.forceMovement', 'LA.tour.content.forceIsUnintentionalMovementKnockbackDrag', `${RULER_DEMO} .la-demo-force`),
], {
    'boost-card': ['overSpeed'],
});

const STAGE_FRAME = '#la-tour-frame';
const TOUR_CARD = '.la-tour-card';

async function _stageDemo(kind, part)
{
    const { showEncounterDemo } = await import('./tour-encounter-demo.js');
    await showEncounterDemo(kind, part);
}

async function _cardDemo(kind)
{
    const { showCardDemo } = await import('./tour-encounter-demo.js');
    await showCardDemo(kind);
}

async function _hideEncounterDemos()
{
    const { hideEncounterDemos } = await import('./tour-encounter-demo.js');
    hideEncounterDemos();
}

async function _battleLogDemo(kind, tab)
{
    const { showBattleLogDemo } = await import('./tour-battlelog-demo.js');
    await showBattleLogDemo(kind, tab);
}

async function _hideBattleLogDemos()
{
    const { hideBattleLogDemos } = await import('./tour-battlelog-demo.js');
    hideBattleLogDemos();
}

const _windowStep = (id, titleKey, contentKey, selector, kind, tab = null) => ({
    id,
    title: localize(titleKey),
    content: localize(contentKey),
    selector,
    action: () => _battleLogDemo(kind, tab),
});

const _stageStep = (id, titleKey, contentKey, kind, part, restricted = false) => ({
    id,
    title: localize(titleKey),
    content: localize(contentKey),
    selector: STAGE_FRAME,
    restricted,
    action: () => _stageDemo(kind, part),
});

const _cardStep = (id, titleKey, contentKey, selector, kind = 'arrival', restricted = true) => ({
    id,
    title: localize(titleKey),
    content: localize(contentKey),
    selector,
    restricted,
    action: () => _cardDemo(kind),
});

const _withNeeds = (steps, table) => steps.map(step => (table[step.id] ? { ...step, needs: table[step.id] } : step));

async function _overwatchOn(trigger)
{
    const { AutomationManager } = await import('../activations/automation-manager.js');
    const group = AutomationManager.getGeneralAutomations()?.Overwatch;
    return (group?.reactions ?? []).some(sub => sub && sub.enabled !== false && (sub.triggers ?? []).includes(trigger));
}

function _offNote(textKey, set = null, world = true)
{
    const isGM = !!game.user?.isGM;
    const askGm = world && set && !isGM ? ` ${localize('LA.tour.off.askGm')}` : '';
    return { text: `${localize(textKey)}${askGm}`, set: set && (!world || isGM) ? set : null };
}

const TOUR_NEEDS = {
    carousel: () => (getModuleSetting('combatCarousel') ? null : _offNote('LA.tour.off.carousel', { key: 'combatCarousel', value: true })),
    carouselShow: () => (getModuleSetting('carouselShow') ? null : _offNote('LA.tour.off.carouselShow', { key: 'carouselShow', value: true }, false)),
    clockWindow: () => (getModuleSetting('clockWindowEnabled') ? null : _offNote('LA.tour.off.clockWindow', { key: 'clockWindowEnabled', value: true }, false)),
    tah: () => (getModuleSetting('tahEnabled') ? null : _offNote('LA.tour.off.tah', { key: 'tahEnabled', value: true, reload: true }, false)),
    narrativeTah: () => (getModuleSetting('tah.narrativeMode') ? null : _offNote('LA.tour.off.narrativeTah', { key: 'tah.narrativeMode', value: true }, false)),
    attackPicker: () => (getModuleSetting('attackTargeting', 'auto') === 'off' ? _offNote('LA.tour.off.attackPicker', { key: 'attackTargeting', value: 'auto' }) : null),
    autoStart: () => (getModuleSetting('attackTargeting', 'auto') === 'picker' ? _offNote('LA.tour.off.autoStart', { key: 'attackTargeting', value: 'auto' }) : null),
    hitLabels: () =>
    {
        const mode = getModuleSetting('targetInfoDisplay') ?? 'gm';
        if (mode === 'all')
            return null;
        return _offNote(mode === 'gm' ? 'LA.tour.off.hitLabelsGm' : 'LA.tour.off.hitLabels', { key: 'targetInfoDisplay', value: 'all' });
    },
    lancerLos: () => (getModuleSetting('lancerLos') ? null : _offNote('LA.tour.off.lancerLos', { key: 'lancerLos', value: true })),
    losHover: () => (getModuleSetting('lancerLosAttackHover') ? null : _offNote('LA.tour.off.losHover', { key: 'lancerLosAttackHover', value: true })),
    tht: () => (game.modules.get('terrain-height-tools')?.active ? null : _offNote('LA.tour.off.tht')),
    reminders: () => (getModuleSetting('reactionNotificationMode') === 'gm' ? _offNote('LA.tour.off.reminders', { key: 'reactionNotificationMode', value: 'both' }) : null),
    uplink: () => (getModuleSetting('uplinkEnabled') ? null : _offNote('LA.tour.off.uplink', { key: 'uplinkEnabled', value: true })),
    uplinkAutoOpen: () => (getModuleSetting('uplinkAutoOpen') ? null : _offNote('LA.tour.off.uplinkAutoOpen', { key: 'uplinkAutoOpen', value: true }, false)),
    overwatchCard: async () => ((await _overwatchOn('onPreMove')) ? null : _offNote('LA.tour.off.overwatchCard')),
    reactionSkirmish: async () => ((await _overwatchOn('onMove')) ? null : _offNote('LA.tour.off.reactionSkirmish')),
    battleLog: () => (getModuleSetting('battleLogEnabled') ? null : _offNote('LA.tour.off.battleLog', { key: 'battleLogEnabled', value: true })),
    awards: () => (getModuleSetting('tah.disableAwards') ? _offNote('LA.tour.off.awards', { key: 'tah.disableAwards', value: false }) : null),
    visionModes: () => (getModuleSetting('lancerVisionAutoAdd') ? null : _offNote('LA.tour.off.visionModes', { key: 'lancerVisionAutoAdd', value: true })),
    distanceLabels: () => (getModuleSetting('enableTacticalDistance') === 'off' ? _offNote('LA.tour.off.distanceLabels', { key: 'enableTacticalDistance', value: 'combat' }, false) : null),
    deployLines: () => (getModuleSetting('showDeployableLines') ? null : _offNote('LA.tour.off.deployLines', { key: 'showDeployableLines', value: true }, false)),
    overSpeed: () => (['yes', 'auto'].includes(getBoostOfferMode()) ? null : _offNote('LA.tour.off.overSpeed', { key: 'enableBoostOffer', value: 'yes' })),
};

const CLOCK_NEEDS = ['clockWindow'];
const CAROUSEL_NEEDS = ['carousel', 'carouselShow'];
const UPLINK_NEEDS = ['uplink'];
const PICKER_NEEDS = ['attackPicker'];

const CLOCKS_STEPS = () => _withNeeds([
    _stageStep('clocks-intro', 'LA.tour.step.clocks', 'LA.tour.content.clocksIntro', 'clocks', '#la-world-clocks'),
    _stageStep('clock-set', 'LA.tour.step.clockSet', 'LA.tour.content.clockSetIs', 'clocks', '.lawc-row[data-key="la-tour-clock-a"] .lawc-pie-slot'),
    _stageStep('clock-add', 'LA.tour.step.clockAdd', 'LA.tour.content.clockAddIs', 'clocks', '[data-action="add"]', true),
    _stageStep('clock-pins', 'LA.tour.step.clockPins', 'LA.tour.content.clockPinsIs', 'clocks', '.lawc-block[data-key="block:pinned"]'),
    _stageStep('clock-hidden', 'LA.tour.step.clockHidden', 'LA.tour.content.clockHiddenIs', 'clocks', '[data-action="unhide"]'),
    _stageStep('clock-rings', 'LA.tour.step.clockRings', 'LA.tour.content.clockRingsIs', 'clock-rings', '#la-world-clocks'),
], {
    'clocks-intro': CLOCK_NEEDS,
    'clock-set': CLOCK_NEEDS,
    'clock-add': [...CLOCK_NEEDS, 'tah', 'narrativeTah'],
    'clock-pins': CLOCK_NEEDS,
    'clock-hidden': CLOCK_NEEDS,
    'clock-rings': CLOCK_NEEDS,
});

const ATTACK_STEPS = () => _withNeeds([
    _stageStep('attack-intro', 'LA.tour.step.attacking', 'LA.tour.content.attackIntro', 'attack', '#accdiff-hud'),
    _stageStep('attack-pick', 'LA.tour.step.attackPick', 'LA.tour.content.attackPickIs', 'attack', '.la-targeting-section .accdiff-ranges'),
    _stageStep('attack-cancel', 'LA.tour.step.attackCancel', 'LA.tour.content.attackCancelIs', 'attack', '.la-accdiff-hint'),
    _stageStep('attack-map', 'LA.tour.step.attackMap', 'LA.tour.content.attackMapIs', 'attack-board', '.la-ts-board'),
    _stageStep('attack-chance', 'LA.tour.step.attackChance', 'LA.tour.content.attackChanceIs', 'attack-board', '.la-ts-target-a'),
    _stageStep('attack-los', 'LA.tour.step.attackLos', 'LA.tour.content.attackLosIs', 'los-board', '.la-ts-board'),
    _stageStep('area-intro', 'LA.tour.step.areas', 'LA.tour.content.areasIntro', 'attack-area', '.la-targeting-section'),
    _stageStep('area-aim', 'LA.tour.step.areaAim', 'LA.tour.content.areaAimIs', 'area-board', '.la-ts-board'),
    _stageStep('area-options', 'LA.tour.step.areaOptions', 'LA.tour.content.areaOptionsAre', 'attack-area', '.la-accdiff-area-toggles'),
    _stageStep('area-shape', 'LA.tour.step.areaShape', 'LA.tour.content.areaShapeIs', 'attack-strip', '.la-attack-shape-strip'),
    _cardStep('invade', 'LA.tour.step.invade', 'LA.tour.content.invadeIs', TOUR_CARD, 'invade', false),
    _stageStep('fire-strip', 'LA.tour.step.skirmishBarrage', 'LA.tour.content.fireStripIs', 'attack-chain', '.la-fire-strip'),
    _stageStep('vulnerable-intro', 'LA.tour.step.vulnerable', 'LA.tour.content.vulnerableIntro', 'damage-vulnerable', '.la-vulnerable-row'),
    _stageStep('vulnerable-cards', 'LA.tour.step.vulnerableCards', 'LA.tour.content.vulnerableCardsAre', 'damage-vulnerable-multi', '.la-vulnerable-box'),
    _stageStep('reliable-type', 'LA.tour.step.reliableType', 'LA.tour.content.reliableTypeIs', 'damage-reliable', '.la-tour-reliable'),
    _stageStep('variable-damage', 'LA.tour.step.variableDamage', 'LA.tour.content.variableDamageIs', 'damage-variable', '.la-variable-row'),
], {
    'attack-intro': [...PICKER_NEEDS, 'autoStart'],
    'attack-pick': PICKER_NEEDS,
    'attack-cancel': PICKER_NEEDS,
    'attack-map': PICKER_NEEDS,
    'attack-chance': [...PICKER_NEEDS, 'hitLabels'],
    'attack-los': ['tht', 'lancerLos', 'losHover'],
    'area-intro': PICKER_NEEDS,
    'area-aim': PICKER_NEEDS,
    'area-options': PICKER_NEEDS,
    'area-shape': PICKER_NEEDS,
});

const CARDS_STEPS = () => _withNeeds([
    _cardStep('cards-intro', 'LA.tour.step.cards', 'LA.tour.content.cardsIntro', TOUR_CARD, 'skirmish', false),
    _cardStep('cards-rows', 'LA.tour.step.cardsRows', 'LA.tour.content.cardsRowsAre', `${TOUR_CARD} [data-role="pick-list"]`, 'skirmish', false),
    _cardStep('cards-queue', 'LA.tour.step.cardsQueue', 'LA.tour.content.cardsQueueIs', `${TOUR_CARD} .lancer-header`, 'skirmish', false),
    _cardStep('reactions-intro', 'LA.tour.step.reactions', 'LA.tour.content.reactionsIntro', TOUR_CARD, 'overwatch', false),
    _cardStep('reactions-card', 'LA.tour.step.reactionsCard', 'LA.tour.content.reactionsCardIs', `${TOUR_CARD} [data-role="choice-list"]`, 'overwatch', false),
    _stageStep('reactions-lane', 'LA.tour.step.reactionsLane', 'LA.tour.content.reactionsLaneIs', 'lane', '#la-reaction-lane'),
    _stageStep('reactions-row', 'LA.tour.step.reactionsRow', 'LA.tour.content.reactionsRowIs', 'lane', '.la-rx-strip[data-rx-index="0"]'),
    _stageStep('reactions-head', 'LA.tour.step.reactionsHead', 'LA.tour.content.reactionsHeadIs', 'lane', '.la-rx-head'),
    _cardStep('prepare-intro', 'LA.tour.step.prepare', 'LA.tour.content.prepareIntro', TOUR_CARD, 'prepare', false),
    _cardStep('prepare-trigger', 'LA.tour.step.prepareTrigger', 'LA.tour.content.prepareTriggerIs', TOUR_CARD, 'prepare-trigger', false),
    _cardStep('prepare-fire', 'LA.tour.step.prepareFire', 'LA.tour.content.prepareFireIs', TOUR_CARD, 'ask', false),
], {
    'reactions-intro': ['overwatchCard'],
    'reactions-card': ['overwatchCard'],
    'reactions-lane': ['reminders', 'reactionSkirmish'],
    'reactions-row': ['reminders'],
    'reactions-head': ['reminders'],
});

const CAROUSEL_STEPS = () => _withNeeds([
    _stageStep('carousel-intro', 'LA.tour.step.combatCarousel', 'LA.tour.content.carouselIntro', 'carousel', '#la-carousel'),
    _stageStep('carousel-lane', 'LA.tour.step.carouselLanes', 'LA.tour.content.carouselLanesAre', 'carousel', '.lac-head'),
    _stageStep('carousel-card', 'LA.tour.step.carouselUnits', 'LA.tour.content.carouselUnitsAre', 'carousel', '.lac-slot[data-id="la-tour-b"]'),
    _stageStep('carousel-acts', 'LA.tour.step.carouselActivations', 'LA.tour.content.carouselActivationsAre', 'carousel', '.lac-slot[data-id="la-tour-c"] .lac-pips'),
    _stageStep('carousel-active', 'LA.tour.step.carouselTurn', 'LA.tour.content.carouselTurnIs', 'carousel', '.lac-slot.is-active'),
    _stageStep('carousel-menu', 'LA.tour.step.carouselMenu', 'LA.tour.content.carouselMenuIs', 'carousel', '.lac-slot[data-id="la-tour-c"]'),
    _stageStep('carousel-deps', 'LA.tour.step.carouselDeployables', 'LA.tour.content.carouselDeployablesAre', 'carousel', '.lac-deps'),
    _stageStep('carousel-buttons', 'LA.tour.step.carouselButtons', 'LA.tour.content.carouselButtonsAre', 'carousel', '.lac-buttons.right', true),
    _stageStep('carousel-fold', 'LA.tour.step.carouselFold', 'LA.tour.content.carouselFoldIs', 'carousel', '[data-combat-action="fold"]'),
    _stageStep('reinforcement-intro', 'LA.tour.step.reinforcements', 'LA.tour.content.reinforcementsIntro', 'bar', '#la-reinforcement-bar', true),
    _stageStep('reinforcement-drop', 'LA.tour.step.reinforcementBar', 'LA.tour.content.reinforcementBarIs', 'bar', '#la-reinforcement-bar > b', true),
    _stageStep('reinforcement-arrive', 'LA.tour.step.reinforcementArrive', 'LA.tour.content.reinforcementArriveIs', 'bar', '.la-rf-bar-arrive', true),
    _stageStep('reinforcement-visibility', 'LA.tour.step.reinforcementVisibility', 'LA.tour.content.reinforcementVisibilityIs', 'bar', '[data-action="visibility"]', true),
    _stageStep('reinforcement-team', 'LA.tour.step.reinforcementTeam', 'LA.tour.content.reinforcementTeamIs', 'bar', '[data-action="team"]', true),
    _stageStep('reinforcement-marker', 'LA.tour.step.reinforcementMarker', 'LA.tour.content.reinforcementMarkerIs', 'board', '.la-ts-marker'),
    _stageStep('carousel-incoming', 'LA.tour.step.carouselIncoming', 'LA.tour.content.carouselComingIs', 'carousel', '.lac-rf-in'),
    _cardStep('arrival-card', 'LA.tour.step.arrivalCard', 'LA.tour.content.arrivalCardIs', TOUR_CARD),
    _stageStep('leave-intro', 'LA.tour.step.leaveBattlefield', 'LA.tour.content.leaveBattlefieldIntro', 'board', '.la-ts-leaver'),
    _stageStep('leave-mark', 'LA.tour.step.leaveMark', 'LA.tour.content.leaveBattlefieldIs', 'board', '.la-ts-leaver'),
    _stageStep('carousel-leaving', 'LA.tour.step.carouselLeaving', 'LA.tour.content.carouselLeavingIs', 'carousel', '.lac-slot.is-leaving'),
    _cardStep('leave-card', 'LA.tour.step.leaveOrStay', 'LA.tour.content.leaveOrStayIs', `${TOUR_CARD} [data-pick-index="2"]`),
], {
    'carousel-intro': CAROUSEL_NEEDS,
    'carousel-lane': CAROUSEL_NEEDS,
    'carousel-card': CAROUSEL_NEEDS,
    'carousel-acts': CAROUSEL_NEEDS,
    'carousel-active': CAROUSEL_NEEDS,
    'carousel-menu': CAROUSEL_NEEDS,
    'carousel-deps': CAROUSEL_NEEDS,
    'carousel-buttons': CAROUSEL_NEEDS,
    'carousel-fold': CAROUSEL_NEEDS,
    'carousel-incoming': CAROUSEL_NEEDS,
    'carousel-leaving': CAROUSEL_NEEDS,
});

const UPLINK_STEPS = () => _withNeeds([
    _stageStep('uplink-intro', 'LA.tour.step.rollUplink', 'LA.tour.content.rollUplinkIntro', 'uplink', '#la-uplink-panel'),
    _stageStep('uplink-bar', 'LA.tour.step.uplinkChips', 'LA.tour.content.uplinkChipsAre', 'uplink', '.lau-bar'),
    _stageStep('uplink-who', 'LA.tour.step.uplinkWho', 'LA.tour.content.uplinkWhoIs', 'uplink', '.lau-head'),
    _stageStep('uplink-choices', 'LA.tour.step.uplinkChoices', 'LA.tour.content.uplinkChoicesAre', 'uplink', '.lau-cols'),
    _stageStep('uplink-range', 'LA.tour.step.uplinkRange', 'LA.tour.content.uplinkRangeIs', 'uplink', '.lau-profile'),
    _stageStep('uplink-targets', 'LA.tour.step.uplinkTargets', 'LA.tour.content.uplinkTargetsAre', 'uplink', '.lau-tcard'),
], {
    'uplink-intro': [...UPLINK_NEEDS, 'uplinkAutoOpen'],
    'uplink-bar': UPLINK_NEEDS,
    'uplink-who': UPLINK_NEEDS,
    'uplink-choices': UPLINK_NEEDS,
    'uplink-range': UPLINK_NEEDS,
    'uplink-targets': UPLINK_NEEDS,
});

const GM_CARD = '.battelog-dialog';
const RECAP = '.battelog-recap-dialog';

const BATTLELOG_STEPS = () => _withNeeds([
    _windowStep('battlelog-intro', 'LA.tour.step.battleLog', 'LA.tour.content.battleLogIntro', GM_CARD, 'gm'),
    _windowStep('battlelog-outcome', 'LA.tour.step.battleLogOutcome', 'LA.tour.content.battleLogOutcomeIs', `${GM_CARD} .battelog-outcome`, 'gm'),
    _windowStep('battlelog-mvp', 'LA.tour.step.battleLogMvp', 'LA.tour.content.battleLogMvpIs', `${GM_CARD} .battelog-mvp`, 'gm'),
    _windowStep('battlelog-analysis', 'LA.tour.step.battleLogAnalysis', 'LA.tour.content.battleLogAnalysisIs', `${GM_CARD} .battelog-extra-add`, 'gm'),
    _windowStep('battlelog-broadcast', 'LA.tour.step.battleLogBroadcast', 'LA.tour.content.battleLogBroadcastIs', `${GM_CARD} .battelog-actions`, 'gm'),
    _windowStep('battlelog-recap', 'LA.tour.step.battleLogRecap', 'LA.tour.content.battleLogRecapIs', `${RECAP} .battelog-recap-head`, 'recap', 'squad'),
    _windowStep('battlelog-squad', 'LA.tour.step.battleLogSquad', 'LA.tour.content.battleLogSquadIs', `${RECAP} .battelog-recap-squad-grid`, 'recap', 'squad'),
    _windowStep('battlelog-awards', 'LA.tour.step.battleLogAwards', 'LA.tour.content.battleLogAwardsAre', `${RECAP} .battelog-pcol-medals`, 'recap', 'squad'),
    _windowStep('battlelog-encounter', 'LA.tour.step.battleLogEncounter', 'LA.tour.content.battleLogEncounterIs', `${RECAP} [data-tab-panel="encounter"]`, 'recap', 'encounter'),
    _windowStep('battlelog-telemetry', 'LA.tour.step.battleLogTelemetry', 'LA.tour.content.battleLogTelemetryIs', `${RECAP} [data-tab-panel="telemetry"]`, 'recap', 'telemetry'),
    _windowStep('battlelog-share', 'LA.tour.step.battleLogShare', 'LA.tour.content.battleLogShareIs', `${RECAP} .battelog-recap-share`, 'recap', 'squad'),
], {
    'battlelog-intro': ['battleLog'],
    'battlelog-mvp': ['awards'],
    'battlelog-awards': ['awards'],
});

const TOKEN_LA_TAB = '.la-compact-config';
let _tourTokenSheet = null;

async function _openTokenLaTab()
{
    await _hideEncounterDemos();
    const { subjectToken } = await import('./tour-samples.js');
    const sheet = (subjectToken() ?? canvas.tokens?.placeables?.find(token => token.actor))?.document?.sheet;
    if (!sheet)
        return;

    if (!sheet.rendered)
    {
        await sheet.render(true);
        _tourTokenSheet = sheet;
    }

    const rootOf = () => (sheet.element instanceof HTMLElement ? sheet.element : sheet.element?.[0]);
    for (let attempt = 0; attempt < 40 && !rootOf()?.querySelector('a[data-tab="la"]'); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));

    const root = rootOf();
    /** @type {HTMLElement | null | undefined} */ (root?.querySelector('a[data-tab="la"]'))?.click();

    const shown = [localize('LA.wreck.sectionAwareness'), localize('LA.wreck.sectionLineOfSight')];
    for (const section of root?.querySelectorAll('.la-config-section') ?? [])
    {
        if (shown.includes(section.querySelector('.la-config-section-head')?.textContent?.trim()))
            section.classList.remove('collapsed');
    }

    sheet.setPosition?.({ height: 'auto' });
}

async function _closeTokenLaTab()
{
    const sheet = _tourTokenSheet;
    _tourTokenSheet = null;
    if (sheet?.rendered)
        await sheet.close();
}

const VISION_STEPS = () => _withNeeds([
    _stageStep('vision-intro', 'LA.tour.step.vision', 'LA.tour.content.visionIntro', 'vision-board', '.la-ts-board'),
    _stageStep('vision-los', 'LA.tour.step.visionLos', 'LA.tour.content.visionLosIs', 'vision-board', '.la-ts-seen'),
    _stageStep('vision-terrain', 'LA.tour.step.visionTerrain', 'LA.tour.content.visionTerrainIs', 'vision-board', '.la-ts-terrain'),
    _stageStep('vision-sensors', 'LA.tour.step.visionSensors', 'LA.tour.content.visionSensorsIs', 'vision-board', '.la-ts-sensor'),
    _stageStep('vision-awareness', 'LA.tour.step.visionAwareness', 'LA.tour.content.visionAwarenessIs', 'vision-board', '.la-ts-aware'),
    _stageStep('vision-eye', 'LA.tour.step.visionEye', 'LA.tour.content.visionEyeIs', 'vision-board', '.la-ts-board'),
    {
        id: 'vision-token',
        title: localize('LA.tour.step.visionToken'),
        content: localize('LA.tour.content.visionTokenIs'),
        selector: TOKEN_LA_TAB,
        restricted: true,
        action: _openTokenLaTab,
        cleanup: _closeTokenLaTab,
    },
], {
    'vision-intro': ['lancerLos'],
    'vision-los': ['lancerLos'],
    'vision-terrain': ['tht', 'lancerLos'],
    'vision-sensors': ['visionModes'],
    'vision-awareness': ['visionModes'],
    'vision-eye': ['lancerLos', 'distanceLabels'],
});

const AM_ROOT = '#la-measure-toolbar';

const ADV_MEASURE_STEPS = () => [
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
        selector: `${AM_ROOT} .la-mt-shapes`,
    },
    {
        id: 'range',
        title: localize('LA.tour.step.rangePulse'),
        content: localize('LA.tour.content.pulseARangeAroundTheShape'),
        selector: `${AM_ROOT} .la-mt-range`,
    },
    {
        id: 'pins',
        title: localize('LA.tour.step.pinnedRings'),
        content: localize('LA.tour.content.rightClickARangeSourceOr'),
        selector: `${AM_ROOT} .la-mt-range`,
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

    await _waitForTahBound(target);
    return true;
}

const TAH_BIND_WAIT_MS = 10000;
const TAH_BIND_POLL_MS = 100;
const TAH_STABLE_POLLS = 2;

async function _waitForTahBound(target)
{
    const { hud } = await import('../tah/index.js');
    let lastElement = null;
    let lastKey = null;
    let stable = 0;

    for (let waited = 0; waited < TAH_BIND_WAIT_MS && stable < TAH_STABLE_POLLS; waited += TAH_BIND_POLL_MS)
    {
        await new Promise((resolve) => setTimeout(resolve, TAH_BIND_POLL_MS));
        const element = hud._el?.[0];
        const ready = hud._token?.id === target.id && !!element?.isConnected && !hud._el.is(':animated');
        const box = ready ? element.getBoundingClientRect() : null;
        const key = box ? `${box.left}|${box.top}|${box.width}|${box.height}` : null;
        stable = ready && element === lastElement && key === lastKey ? stable + 1 : 0;
        lastElement = element;
        lastKey = key;
    }
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

const FIXED_OVERFLOW = new Set(['hidden', 'clip']);

function _scrollIntoViewLocked(target)
{
    const locked = [];

    for (let node = target.parentElement; node; node = node.parentElement)
    {
        const style = getComputedStyle(node);
        locked.push({ node, top: FIXED_OVERFLOW.has(style.overflowY) ? node.scrollTop : null, left: FIXED_OVERFLOW.has(style.overflowX) ? node.scrollLeft : null });
    }

    Element.prototype.scrollIntoView.call(target, { block: 'nearest', inline: 'nearest' });

    for (const { node, top, left } of locked)
    {
        if (top !== null)
            node.scrollTop = top;
        if (left !== null)
            node.scrollLeft = left;
    }
}

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
    async progress(stepIndex)
    {
        if (this._progressing)
            return;

        this._progressing = true;

        try
        {
            return await super.progress(stepIndex);
        }
        finally
        {
            this._progressing = false;
        }
    }
    async _preStep()
    {
        this._stepShown = false;
        await super._preStep();
        if (foundry.nue.Tour.activeTour !== this)
            return;

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

        if (foundry.nue.Tour.activeTour !== this)
            return;

        await this._noteNeeds(step);

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
    async _noteNeeds(step)
    {
        this._needNotes = new Map();
        if (!step?.needs?.length)
            return;

        const notes = await Promise.all(step.needs.map(async id => [id, await TOUR_NEEDS[id]?.()]));
        const failing = notes.filter(([, note]) => note);
        if (!failing.length)
            return;

        this._needNotes = new Map(failing);
        this._notedStep = step;
        this._notedContent = step.content;

        const lines = failing.map(([id, note]) =>
        {
            const button = note.set ? `<button type="button" class="la-tour-turn-on" data-need="${id}">${localize(note.set.reload ? 'LA.tour.off.turnOnReload' : 'LA.tour.off.turnOn')}</button>` : '';
            return `<span class="la-tour-off-line"><i class="fas fa-power-off"></i><span class="la-tour-off-body"><span>${note.text}</span>${button}</span></span>`;
        });

        step.content = `${localize(step.content)}\n<span class="la-tour-off">${lines.join('')}</span>`;
    }
    _restoreNotes()
    {
        if (this._notedStep)
        {
            this._notedStep.content = this._notedContent;
            this._notedStep = null;
            this._notedContent = null;
        }
    }
    async _turnOn(button)
    {
        const note = this._needNotes?.get(button.dataset.need);
        if (!note?.set)
            return;

        button.disabled = true;
        await game.settings.set(MODULE_ID, note.set.key, note.set.value);

        if (note.set.reload)
        {
            foundry.utils.debouncedReload();
            return;
        }

        button.closest('.la-tour-off-line')?.replaceChildren(localize('LA.tour.off.done'));
    }
    async _postStep()
    {
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

        if (this._stepShown)
            await super._postStep();
        this._stepShown = false;
        this._restoreBlanked();
        this._restoreNotes();

        for (const button of game.tooltip.tooltip?.querySelectorAll('.step-button') ?? [])
            /** @type {HTMLElement} */ (button).style.pointerEvents = 'none';
    }
    async _renderStep()
    {
        if (foundry.nue.Tour.activeTour !== this)
            return;

        const step = /** @type {any} */ (this.currentStep);
        const self = /** @type {any} */ (this);

        if (step?.selector && !self.targetElement?.isConnected)
        {
            self.targetElement = document.querySelector(step.selector);

            if (!self.targetElement)
            {
                this._blankedSelector = step.selector;
                this._blankedStep = step;
                step.selector = null;
            }
        }

        const target = step?.selector ? self.targetElement : null;
        if (target)
            target.scrollIntoView = () => _scrollIntoViewLocked(target);

        try
        {
            await super._renderStep();
        }
        finally
        {
            if (target)
                delete target.scrollIntoView;
        }

        this._stepShown = true;
        const shown = step?.selector ? game.tooltip.tooltip : self.targetElement;

        for (const button of shown?.querySelectorAll?.('.la-tour-turn-on') ?? [])
            button.addEventListener('click', () => this._turnOn(button));

        if (step?.allowCanvas)
        {
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
        const fn = this._onCompleteHook;
        this._onCompleteHook = null;
        await super.complete();
        if (fn)
            await fn();
    }
    async exit()
    {
        this._onCompleteHook = null;
        await super.exit();
    }
}

let _configTour;
let _activationTour;
let _effectManagerTour;
let _rulerTour;
let _attackTour;
let _carouselTour;
let _cardsTour;
let _clocksTour;
let _uplinkTour;
let _battleLogTour;
let _visionTour;
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
    return _ensureWindowOpen('reaction-manager-config', '../activations/automation-manager.js', 'AutomationConfig');
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

    const dlg = Object.values(/** @type {any} */ (ui.windows)).find((win) => /** @type {any} */ (win).element?.[0] === el || /** @type {any} */ (win).element?.[0]?.contains(el));

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

async function _ensureAutomationEditorOpen()
{
    if (document.querySelector('#reaction-editor'))
    {
        document.querySelector('#reaction-editor .la-band-fold')?.setAttribute('open', '');
        return true;
    }

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

async function _closeAutomationEditor()
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
        steps: () => CONFIG_STEPS().filter(step => !(/** @type {any} */ (step).condition) || /** @type {any} */ (step).condition()),
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
        steps: ACTIVATION_MANAGER_STEPS,
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
        steps: TAH_STEPS,
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
        steps: ADV_TAH_STEPS,
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
        steps: EFFECT_MANAGER_STEPS,
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
        steps: RULER_STEPS,
        cleanup: _hideRulerTourDemos,
        assign: (tour) => { _rulerTour = tour; },
        get: () => _rulerTour,
    },
    {
        id: 'attack-tour',
        title: localize('LA.tour.step.lancerAutomationsAttacking'),
        description: localize('LA.tour.attackDescription'),
        root: 'body',
        steps: ATTACK_STEPS,
        cleanup: _hideEncounterDemos,
        assign: (tour) => { _attackTour = tour; },
        get: () => _attackTour,
    },
    {
        id: 'carousel-tour',
        title: localize('LA.tour.step.lancerAutomationsCombatCarousel'),
        description: localize('LA.tour.carouselDescription'),
        root: 'body',
        steps: CAROUSEL_STEPS,
        cleanup: _hideEncounterDemos,
        assign: (tour) => { _carouselTour = tour; },
        get: () => _carouselTour,
    },
    {
        id: 'cards-tour',
        title: localize('LA.tour.step.lancerAutomationsCardsReactions'),
        description: localize('LA.tour.cardsDescription'),
        root: 'body',
        steps: CARDS_STEPS,
        cleanup: _hideEncounterDemos,
        assign: (tour) => { _cardsTour = tour; },
        get: () => _cardsTour,
    },
    {
        id: 'clocks-tour',
        title: localize('LA.tour.step.lancerAutomationsClocks'),
        description: localize('LA.tour.clocksDescription'),
        root: 'body',
        steps: CLOCKS_STEPS,
        cleanup: _hideEncounterDemos,
        assign: (tour) => { _clocksTour = tour; },
        get: () => _clocksTour,
    },
    {
        id: 'roll-uplink-tour',
        title: localize('LA.tour.step.lancerAutomationsRollUplink'),
        description: localize('LA.tour.rollUplinkLiveCopies'),
        root: 'body',
        restricted: true,
        steps: UPLINK_STEPS,
        cleanup: _hideEncounterDemos,
        assign: (tour) => { _uplinkTour = tour; },
        get: () => _uplinkTour,
    },
    {
        id: 'battle-log-tour',
        title: localize('LA.tour.step.lancerAutomationsBattleLog'),
        description: localize('LA.tour.battleLogDescription'),
        root: 'body',
        restricted: true,
        steps: BATTLELOG_STEPS,
        cleanup: _hideBattleLogDemos,
        assign: (tour) => { _battleLogTour = tour; },
        get: () => _battleLogTour,
    },
    {
        id: 'vision-tour',
        title: localize('LA.tour.step.lancerAutomationsVision'),
        description: localize('LA.tour.visionDescription'),
        root: 'body',
        steps: VISION_STEPS,
        cleanup: _hideEncounterDemos,
        assign: (tour) => { _visionTour = tour; },
        get: () => _visionTour,
    },
    {
        id: 'advanced-measure-tour',
        title: localize('LA.tour.step.lancerAutomationsAdvancedMeasure'),
        description: localize('LA.tour.theAdvancedMeasureToolShapesRanges'),
        root: AM_ROOT,
        steps: ADV_MEASURE_STEPS,
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
        steps: AD_EXTRA_STEPS,
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

export async function startTourAt(id, stepId = null)
{
    const tour = TOURS.find((candidate) => candidate.id === id)?.get();
    const index = stepId && tour ? tour.steps.findIndex((step) => step.id === stepId) : -1;

    if (index > 0)
        await tour.progress(index);
    else
        await startTour(id);
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

// Welcome dialog (first install + menu button); resolves 'setup'|'tour:<id>'|'skip', Setup Wizard button GM-only.
function _welcomeDialog()
{
    const isGM = !!game.user?.isGM;

    const setupNote = isGM
        ? `<p style="margin: 8px 0 0;">${localize('LA.tour.welcome.firstTime')}</p>`
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

        buttons.skip = {
            icon: '<i class="fas fa-times"></i>',
            label: localize('LA.common.skip'),
            callback: () => resolve('skip'),
        };

        const dialog = new Dialog({
            title: localize('LA.tour.step.lancerAutomations'),
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">${localize('LA.tour.welcome.title')}</div>
                    <div class="lancer-dialog-subtitle">${localize('LA.tour.welcome.subtitle')}</div>
                </div>
                <div style="padding: 8px 10px; line-height: 1.5;">
                    <p style="margin: 0 0 8px;">${localize('LA.tour.welcome.thanks')}</p>
                    <p style="margin: 0 0 8px;">${localize('LA.tour.welcome.dense')}</p>
                    <p style="margin: 0 0 8px;">${localize('LA.tour.welcome.tours')}</p>
                    ${_tourListHtml()}
                    <p style="margin: 0 0 8px;">${localize('LA.tour.welcome.help')}</p>
                    <p style="margin: 0;">${localize('LA.tour.welcome.support')}</p>
                    ${setupNote}
                    <p style="margin: 10px 0 0; padding: 6px 8px; border-left: 3px solid #ff6400; background: rgba(255,100,0,0.08);">${localize('LA.tour.welcome.lastWarning')}</p>
                </div>
                <p style="padding: 6px 10px 0; font-size: 0.85em; opacity: 0.7; border-top: 1px solid rgba(120,46,34,0.2); margin-top: 6px;">${localize('LA.tour.resumeBody')}</p>
            `,
            buttons,
            default: isGM ? 'setup' : 'skip',
            render: (html) => _bindTourList(html, (id) =>
            {
                resolve(`tour:${id}`);
                dialog.close();
            }),
            close: () => resolve('skip'),
        }, { width: 600, classes: ['lancer-dialog-base', 'lancer-no-title'] });

        dialog.render(true);
    });
}

function _tourRowHtml(id)
{
    const tour = TOURS.find(entry => entry.id === id)?.get();
    if (!tour)
        return '';

    const title = String(tour.title ?? '').replace(/^Lancer Automations:\s*/i, '');
    const steps = tour.steps?.length ?? 0;
    return `<div class="la-tour-row"><div class="la-kb-text"><div class="la-kb-name">${title}${steps ? `<span class="la-tour-steps">${localizeFormat('LA.tour.stepCount', { count: steps })}</span>` : ''}</div></div><button type="button" class="la-tour-play lancer-action-btn la-primary" data-tour-id="${id}"><i class="fas fa-play"></i> ${localize('LA.configUi.play')}</button></div>`;
}

function _tourListHtml()
{
    const allowed = new Set(game.user?.isGM ? GM_TOUR_IDS : PLAYER_TOUR_IDS);

    const groups = TOUR_GROUPS.map((group) =>
    {
        const rows = group.ids.filter(id => allowed.has(id)).map(_tourRowHtml).join('');
        return rows ? `<div class="la-tour-group">${localize(group.label)}</div>${rows}` : '';
    });

    return `<div class="la-welcome-tours">${groups.join('')}</div>`;
}

function _bindTourList(html, onPick)
{
    const root = html?.[0] ?? html;
    for (const button of root.querySelectorAll('[data-tour-id]'))
        button.addEventListener('click', () => onPick(button.dataset.tourId));
}

function _resumeDialog()
{
    return new Promise((resolve) =>
    {
        const dialog = new Dialog({
            title: localize('LA.tour.step.lancerAutomations'),
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">${localize('LA.tour.resumeTitle')}</div>
                    <div class="lancer-dialog-subtitle">${localize('LA.tour.resumeSubtitle')}</div>
                </div>
                ${_tourListHtml()}
                <p style="padding: 8px 10px 0; font-size: 0.85em; opacity: 0.7;">${localize('LA.tour.resumeBody')}</p>
            `,
            buttons: {
                later: {
                    icon: '<i class="fas fa-clock"></i>',
                    label: localize('LA.common.later'),
                    callback: () => resolve(null),
                },
            },
            default: 'later',
            render: (html) => _bindTourList(html, (id) =>
            {
                resolve(id);
                dialog.close();
            }),
            close: () => resolve(null),
        }, { width: 460, classes: ['lancer-dialog-base', 'lancer-no-title'] });

        dialog.render(true);
    });
}

async function _runResume()
{
    await game.settings.set(MODULE_ID, SETTING_RESUME_TOUR, false);
    const id = await _resumeDialog();
    if (id)
        await startTour(id);
}

async function _runChooser()
{
    const choice = await _welcomeDialog();

    if (choice === 'setup')
    {
        const stayed = await maybeRunSettingsOnboarding();

        if (!stayed)
        {
            await game.settings.set(MODULE_ID, SETTING_RESUME_TOUR, true);
            await game.settings.set(MODULE_ID, SETTING_TOUR_DONE, true);
            return;
        }

        return _runChooser();
    }

    if (choice.startsWith('tour:'))
        await startTour(choice.slice('tour:'.length));

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

    game.settings.register(MODULE_ID, SETTING_RESUME_TOUR, {
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
                    title: localize(entry.title),
                    description: localize(entry.description),
                    display: true,
                    restricted: !!entry.restricted,
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
            await queueFirstRun(() => _runChooser());
        else if (getModuleSetting(SETTING_RESUME_TOUR))
            await queueFirstRun(() => _runResume());
    });
}
