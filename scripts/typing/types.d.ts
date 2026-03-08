/**
 * Type declarations for lancer-automations internal API.
 */

// ─── Base trigger data ────────────────────────────────────────────────────────

interface TriggerDataBase {
    triggeringToken?: Token;
    distanceToTrigger?: number | null;
    [key: string]: any;
}

// ─── Shared subtypes ─────────────────────────────────────────────────────────

interface ActionData {
    type: "action" | "attack" | "tech";
    title: string;
    action: { name: string; activation?: string };
    detail: string;
    attack_type?: string;
    isInvade?: boolean;
    tags: Array<{ lid: string;[key: string]: any }>;
    stateData: any;
}

interface MoveInfo {
    isInvoluntary: boolean;
    isTeleport: boolean;
    isUndo?: boolean;
    isModified?: boolean;
    pathHexes: PathHexArray;
    isBoost?: boolean;
    boostSet?: any[];
}

// ─── TriggerData per trigger type ────────────────────────────────────────────

interface TriggerDataOnMove extends TriggerDataBase {
    triggeringToken: Token;
    distanceMoved: number;
    elevationMoved: number;
    startPos: { x: number; y: number; elevation: number };
    endPos: { x: number; y: number; elevation: number };
    isDrag: boolean;
    moveInfo: MoveInfo;
    distanceToTrigger: number | null;
}

/** Fires before move. NOTE: uses `token` not `triggeringToken`. Supports cancelTriggeredMove. */
interface TriggerDataOnPreMove extends TriggerDataBase {
    token: Token;
    distanceToMove: number;
    elevationToMove: number;
    startPos: { x: number; y: number };
    endPos: { x: number; y: number };
    isDrag: boolean;
    moveInfo: MoveInfo;
    cancel: () => void;
    cancelTriggeredMove: (reason?: string, showCard?: boolean, gmControl?: boolean) => Promise<void>;
}

interface TriggerDataOnDamage extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    target: Token;
    damages: number[];
    types: string[];
    isCrit: boolean;
    isHit: boolean;
    attackType: string;
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    distanceToTrigger: number | null;
}

interface TriggerDataOnActivation extends TriggerDataBase {
    triggeringToken: Token;
    actionType: string;
    actionName: string;
    item: any;
    actionData: ActionData;
    endActivation: boolean;
    distanceToTrigger: number | null;
}

interface TriggerDataOnInitActivation extends TriggerDataOnActivation {
    cancelAction: (reason?: string) => void;
}

interface TriggerDataOnInitAttack extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    targets: Token[];
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    cancelAttack: (reason?: string) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnInitTechAttack extends TriggerDataBase {
    triggeringToken: Token;
    techItem: any;
    targets: Token[];
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    isInvade: boolean;
    cancelTechAttack: (reason?: string) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnInitCheck extends TriggerDataBase {
    triggeringToken: Token;
    statName: string;
    checkAgainstToken: Token | null;
    targetVal: number | null;
    cancelCheck: (reason?: string) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnStatusApplied extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    distanceToTrigger: number | null;
}

interface TriggerDataOnStatusRemoved extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    distanceToTrigger: number | null;
}

interface TriggerDataOnDestroyed extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnStructure extends TriggerDataBase { triggeringToken: Token; remainingStructure: number; rollResult: number; }
interface TriggerDataOnStress extends TriggerDataBase { triggeringToken: Token; remainingStress: number; rollResult: number; }
interface TriggerDataOnTurnStart extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnTurnEnd extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnEnterCombat extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnExitCombat extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }

type TriggerData =
    | TriggerDataOnMove
    | TriggerDataOnPreMove
    | TriggerDataOnDamage
    | TriggerDataOnActivation
    | TriggerDataOnInitActivation
    | TriggerDataOnInitAttack
    | TriggerDataOnInitTechAttack
    | TriggerDataOnInitCheck
    | TriggerDataOnStatusApplied
    | TriggerDataOnStatusRemoved
    | TriggerDataOnDestroyed
    | TriggerDataOnStructure
    | TriggerDataOnStress
    | TriggerDataOnTurnStart
    | TriggerDataOnTurnEnd
    | TriggerDataOnEnterCombat
    | TriggerDataOnExitCombat;

type TriggerType =
    | "onMove" | "onPreMove"
    | "onDamage"
    | "onHit" | "onMiss"
    | "onAttack"
    | "onTechAttack" | "onTechHit" | "onTechMiss"
    | "onCheck"
    | "onActivation" | "onInitActivation"
    | "onInitAttack" | "onInitTechAttack"
    | "onInitCheck"
    | "onStatusApplied" | "onStatusRemoved"
    | "onPreStatusApplied" | "onPreStatusRemoved"
    | "onDestroyed" | "onStructure" | "onStress"
    | "onHeat" | "onClearHeat"
    | "onHpLoss" | "onHPRestored"
    | "onKnockback"
    | "onDeploy"
    | "onTurnStart" | "onTurnEnd"
    | "onEnterCombat" | "onExitCombat";

// ─── Shared subtypes ─────────────────────────────────────────────────────────

interface ConsumptionConfig {
    trigger?: TriggerType;
    originId?: string;
    grouped?: boolean;
    groupId?: string;
    itemLid?: string;
    itemId?: string;
    actionName?: string;
    statusId?: string;
    isBoost?: boolean;
    minDistance?: number;
    checkType?: string;
    checkAbove?: number;
    checkBelow?: number;
    evaluate?: ((triggerType: TriggerType, triggerData: TriggerData, bearerToken: Token, effect: any) => Promise<boolean> | boolean) | string;
    [key: string]: any;
}

// ─── Module API ───────────────────────────────────────────────────────────────

interface LancerAutomationsAPI {
    // OverwatchAPI
    checkOverwatchCondition(reactorToken: Token, moverToken: Token, startPos: object): boolean;

    // ReactionsAPI
    executeSimpleActivation(actor: any, options: object, extraData?: object): Promise<{ completed: boolean, flow: any }>;
    /** Register item-based reactions keyed by item LID */
    registerDefaultItemReactions(reactions: Record<string, ReactionGroup>): void;
    /** Register general (non-item) reactions by name */
    registerDefaultGeneralReactions(reactions: Record<string, ReactionConfig | ReactionGroup>): void;

    // EffectsAPI
    /** @deprecated Use findEffectOnToken */
    findFlaggedEffectOnToken(token: Token, identifier: string | ((e: any) => boolean)): any | undefined;
    /** @deprecated Use applyEffectsToTokens */
    applyFlaggedEffectToTokens(options?: { tokens?: Token[]; effectNames?: Array<string | { name: string;[key: string]: any }>; note?: string; duration?: object; checkEffectCallback?: Function; notify?: boolean | object;[key: string]: any }, extraOptions?: { consumption?: ConsumptionConfig;[key: string]: any }): Promise<any>;
    findEffectOnToken(token: Token, identifier: string | ((e: any) => boolean)): any | undefined;
    removeEffectsByNameFromTokens(options?: { tokens?: Token[]; effectNames?: string[]; extraFlags?: object; notify?: boolean | object }): Promise<void>;
    /** @deprecated Use applyEffectsToTokens */
    setEffect(token: Token, effectData: object, options?: object): Promise<any>;
    removeEffectByName(token: Token, effectName: string, extraFlags?: object): Promise<void>;
    applyEffectsToTokens(options?: { tokens?: Token[]; effectNames?: Array<string | { name: string;[key: string]: any }>; note?: string; duration?: object; checkEffectCallback?: Function; notify?: boolean | object;[key: string]: any }, extraOptions?: { consumption?: ConsumptionConfig;[key: string]: any }): Promise<any>;
    /** @deprecated Use applyEffectsToTokens */
    applyFlaggedEffectToTokens(options?: { tokens?: Token[]; effectNames?: Array<string | { name: string;[key: string]: any }>; notify?: boolean | object;[key: string]: any }, extraOptions?: object): Promise<any>;
    processEffectConsumption(triggerType: TriggerType, triggerData: TriggerData): Promise<void>;

    // InteractiveAPI
    chooseToken(sourceToken: Token, options?: object): Promise<Token[] | null>;
    knockBackToken(token: Token, direction: object, distance: number): Promise<void>;
    applyKnockbackMoves(token: Token, moves: object[]): Promise<void>;
    startChoiceCard(options?: {
        mode?: "or" | "and";
        choices?: Array<{ text: string; icon?: string; callback?: Function; data?: any }>;
        title?: string;
        description?: string;
        icon?: string;
        headerClass?: string;
        gmControl?: boolean;
        traceData?: any;
    }): Promise<true | null>;
    revertMovement(token: Token): Promise<void>;
    clearMovementHistory(token: Token): void;

    // MiscAPI
    getItemLID(item: any): string | null;
    isItemAvailable(item: any, reactionPath?: string): boolean;
    hasReactionAvailable(token: Token): boolean;
    isFriendly(token: Token, other: Token): boolean;
    findItemByLid(actor: any, lid: string): any | null;
    getWeapons(token: Token): any[];
    updateTokenSystem(token: Token, data: object): Promise<void>;

    // BonusesAPI
    getConstantBonuses(actor: any): any[];
    getImmunityBonuses(actor: any, type: string): any[];
    applyDamageImmunities(actor: any, damages: any[]): any[];
    hasCritImmunity(actor: any): boolean;
    addGlobalBonus(actor: any, bonus: object, options?: object): Promise<void>;
    addConstantBonus(actor: any, bonus: object, options?: object): Promise<void>;
    removeConstantBonus(actor: any, bonusId: string): Promise<void>;
    getGlobalBonuses(actor: any): any[];
    injectBonusToNextRoll(actor: any, bonus: object): void;

    // ScanAPI
    performSystemScan(token: Token, target: Token, options?: object): Promise<void>;

    // TerrainAPI
    getTerrainAt(x: number, y: number): any;

    // DowntimeAPI
    executeDowntimeAction(actor: any, action: string, options?: object): Promise<void>;

    // Main helpers
    handleTrigger(triggerType: TriggerType, data: object): Promise<void>;
    getMovementHistory(token: Token | string): object;
    getCumulativeMoveData(token: Token): object[];
    executeStatRoll(actor: any, stat: string, title: string, sourceToken?: Token): Promise<any>;

    [key: string]: any;
}



// ─── ReactionConfig ───────────────────────────────────────────────────────────

type ReactionCallback = (
    triggerType: TriggerType,
    triggerData: TriggerData,
    reactorToken: Token,
    item: any,
    activationName: string,
    api: LancerAutomationsAPI
) => any;

interface ReactionConfig {
    name?: string;
    category?: string;
    itemType?: string;
    triggers: TriggerType[];
    triggerSelf?: boolean;
    triggerOther?: boolean;
    outOfCombat?: boolean;
    isReaction?: boolean;
    consumesReaction?: boolean;
    enabled?: boolean;
    onlyOnSourceMatch?: boolean;
    autoActivate?: boolean;
    forceSynchronous?: boolean;
    actionType?: string;
    frequency?: string;
    activationType?: "code" | "macro" | "item-use" | "flow" | "none";
    activationMode?: "instead" | "after";
    reactionPath?: string;
    dispositionFilter?: string[];
    onInit?: ((token: Token, item: any, api: LancerAutomationsAPI) => Promise<void>) | string;
    evaluate?: ReactionCallback | string;
    activationCode?: ReactionCallback | string;
    triggerDescription?: string;
    effectDescription?: string;
    comments?: string;
    [key: string]: any;
}

interface ReactionGroup {
    category?: string;
    itemType?: string;
    enabled?: boolean;
    reactions: ReactionConfig[];
    [key: string]: any;
}

// ─── Module augmentation ─────────────────────────────────────────────────────

interface Module {
    api?: LancerAutomationsAPI;
}

// ─── Effect Flags ─────────────────────────────────────────────────────────────

interface DurationEntry {
    label: string;
    turns: number;
    originID: string;
    stack: number;
}

interface LancerEffectFlags {
    targetID: string;
    effect: string;
    duration: any;
    note: string;
    originID: string;
    appliedRound?: number;
    appliedStack?: number;
    durationEntries?: DurationEntry[];
    suppressSourceId?: string;
    RemoteMachineGunID?: string;
    markerRifleSource?: string;
    [key: string]: any;
}
