// Config constants for the token stat-bar system: setting keys, flag keys, visibility
// modes, animation timings, and layout dimensions. Leaf module, no imports.

export const MODULE_ID = 'lancer-automations';

export const SETTING_ENABLED = 'tokenStatBar';
export const SETTING_DEFAULT_HIDDEN = 'statBarDefaultHidden';
export const SETTING_DEFAULT_COMBAT_ONLY = 'statBarDefaultCombatOnly';
export const SETTING_DEFAULT_ROW_HEIGHT = 'statBarDefaultRowHeight';
export const SETTING_VIS_OUT_OF_COMBAT = 'statBarVisibilityOutOfCombat';
export const SETTING_VIS_IN_COMBAT = 'statBarVisibilityInCombat';
export const SETTING_EFFECT_ICON_SCALE = 'statBarEffectIconScale';
export const SETTING_MIN_ZOOM_SCALE = 'statBarMinZoomScale';
export const SETTING_DEFAULT_PILOT_STRESS = 'statBarDefaultPilotStress';
export const SETTING_SHOW_VALUES = 'statBarShowValues';
export const SETTING_AUTO_INJECT_TALENTS = 'statBarAutoInjectTalents';
export const SETTING_AUTO_INJECT_TALENT_COLOR = 'statBarAutoInjectTalentColor';
export const SETTING_AUTO_INJECT_TALENT_WIDTH = 'statBarAutoInjectTalentWidthPct';
export const SETTING_AUTO_INJECT_TALENT_FEEDBACK = 'statBarAutoInjectTalentFeedback';
export const SETTING_AUTO_INJECT_CUSTOM_FLAGS = 'statBarAutoInjectCustomFlags';

export const VIS_ALL = 'all';
export const VIS_OWNER = 'owner';
export const VIS_NONE = 'none';

export const FLASH_HOLD_MS = 250;
export const FLASH_SHRINK_MS = 1300;
export const FLASH_TOTAL_MS = FLASH_HOLD_MS + FLASH_SHRINK_MS;
export const FLASH_LINGER_MS = 600;

// Hub width cap; larger tokens get a centered hub.
export const MAX_BAR_WIDTH = 500;

export const REF_GRID_SIZE = 100;
export const REF_ROW_HEIGHT = 7;

export const ISO_SETTING_STATBAR = 'iso.statBar';
export const ISO_SETTING_RETICLE = 'iso.targetReticle';
export const ISO_SETTING_HITZONE = 'iso.clickZone';

export const FLAG_HIDDEN = 'statBarHidden';
export const FLAG_COMBAT_ONLY = 'statBarCombatOnly';
export const FLAG_ROW_HEIGHT = 'statBarRowHeight';
export const FLAG_VIS_OUT_OF_COMBAT = 'statBarVisibilityOutOfCombat';
export const FLAG_VIS_IN_COMBAT = 'statBarVisibilityInCombat';
export const FLAG_PILOT_STRESS = 'statBarPilotStress';
export const FLAG_EXTRAS = 'statBarExtras';
export const FLAG_AUTO_KEYS = 'statBarAutoInjectedKeys';
// Templates on Item/Actor. Auto-injected onto scene tokens of the actor.
export const FLAG_TEMPLATES = 'extraBarTemplates';

export const DEFAULT_EXTRA_BAR_ICON = 'modules/lancer-automations/icons/perspective-dice-two.svg';
