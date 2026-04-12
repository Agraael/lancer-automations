/**
 * Type declarations for lancer-automations internal API.
 */

// ─── Base trigger data ────────────────────────────────────────────────────────

interface TriggerDataBase {
    triggeringToken?: Token;
    distanceToTrigger?: number | null;
    /** Re-launches the flow or action that generated this trigger. For item triggers uses item.beginActivationFlow(); for general actions uses executeSimpleActivation(). Warns if action type is Automatic or Other, or if no context is available. */
    startRelatedFlow(): Promise<void>;
    /** Routes startRelatedFlow to the specified userId's client (or the token owner if omitted). If the target is the current user, runs locally. extraData is injected into flow.state.la_extraData and surfaced as triggerData.extraData on the triggered onActivation. If wait is true, awaits completion of the remote flow before resolving. */
    startRelatedFlowToReactor(userId?: string | null, extraData?: Record<string, any> | null, options?: { wait?: boolean }): Promise<void>;
    /** Sends a message to the reactor token's owner client. Calls onMessage on the matching reaction there. data must be JSON-serializable. If userId is omitted, falls back to the token's owner (with a warning). */
    sendMessageToReactor(data: any, userId?: string | null): Promise<void>;
    [key: string]: any;
}

// ─── Move history types ───────────────────────────────────────────────────────

interface MoveHistoryEntry {
    distanceMoved: number;
    movementCost: number;
    isDrag: boolean;
    isFreeMovement: boolean;
    boostSet: number[];
    startPos: { x: number; y: number };
}

interface MoveHistoryData {
    moves: MoveHistoryEntry[];
}

/** Returned when getMovementHistory has data. */
interface MovementHistoryResult {
    exists: true;
    /** Physical squares traveled (no terrain penalty overhead). */
    totalMoved: number;
    /** Movement cap consumed (terrain penalty counted). */
    totalCost: number;
    intentional: {
        total: number;
        totalCost: number;
        regular: number;
        regularCost: number;
        free: number;
        freeCost: number;
    };
    unintentional: number;
    unintentionalCost: number;
    nbBoostUsed: number;
    startPosition: { x: number; y: number };
    movementCap: number;
}

/** Physical distance + cap cost for a set of moves. */
interface MoveSummary {
    moved: number;
    cost: number;
}

// ─── Shared subtypes ─────────────────────────────────────────────────────────

interface FlowState {
    injectFlowExtraData(extraData: object): void;
    getFlowExtraData(): object;
    injectBonus(bonus: object): void;
    [key: string]: any;
}

interface ActionData {
    type: "action" | "attack" | "tech";
    title: string;
    action: { name: string; activation?: string };
    detail: string;
    attack_type?: string;
    isInvade?: boolean;
    tags: Array<{ lid: string;[key: string]: any }>;
    flowState: FlowState;
}

interface MoveInfo {
    isInvoluntary: boolean;
    isTeleport: boolean;
    isUndo?: boolean;
    isModified?: boolean;
    pathHexes: PathHexArray;
    isBoost?: boolean;
    boostSet?: any[];
    extraData?: object;
}

/** Entry in onHit targets array */
interface AttackHitEntry {
    target: Token;
    roll: Roll;
    crit: boolean;
}

/** Entry in onMiss targets array */
interface AttackMissEntry {
    target: Token;
    roll: Roll;
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
    cancelTriggeredMove: (reason?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => Promise<void>;
    changeTriggeredMove: (position: { x: number; y: number; elevation?: number }, extraData?: object, reason?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => Promise<void>;
}

interface TriggerDataOnKnockback extends TriggerDataBase {
    triggeringToken: Token;
    range: number;
    pushedActors: any[];
    actionName: string;
    item: any;
    distanceToTrigger: number | null;
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

interface TriggerDataOnAttack extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    targets: Token[];
    attackType: string;
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    distanceToTrigger: number | null;
}

interface TriggerDataOnHit extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    targets: AttackHitEntry[];
    attackType: string;
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    distanceToTrigger: number | null;
}

interface TriggerDataOnMiss extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    targets: AttackMissEntry[];
    attackType: string;
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    distanceToTrigger: number | null;
}

interface TriggerDataOnInitAttack extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    targets: Token[];
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    cancelAttack: (reason?: string, title?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnTechAttack extends TriggerDataBase {
    triggeringToken: Token;
    techItem: any;
    targets: Token[];
    actionName: string;
    isInvade: boolean;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    distanceToTrigger: number | null;
}

interface TriggerDataOnTechHit extends TriggerDataBase {
    triggeringToken: Token;
    techItem: any;
    targets: AttackHitEntry[];
    actionName: string;
    isInvade: boolean;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    distanceToTrigger: number | null;
}

interface TriggerDataOnTechMiss extends TriggerDataBase {
    triggeringToken: Token;
    techItem: any;
    targets: AttackMissEntry[];
    actionName: string;
    isInvade: boolean;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
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
    cancelTechAttack: (reason?: string, title?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnCheck extends TriggerDataBase {
    triggeringToken: Token;
    statName: string;
    roll: Roll;
    total: number;
    success: boolean;
    checkAgainstToken: Token | null;
    targetVal: number | null;
    distanceToTrigger: number | null;
}

interface TriggerDataOnInitCheck extends TriggerDataBase {
    triggeringToken: Token;
    statName: string;
    checkAgainstToken: Token | null;
    targetVal: number | null;
    cancelCheck: (reason?: string, title?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnActivation extends TriggerDataBase {
    triggeringToken: Token;
    actionType: string;
    actionName: string;
    item: any;
    actionData: ActionData;
    endActivation: boolean;
    /** Extra data injected via startRelatedFlowToReactor(userId, extraData), sourced from flow.state.la_extraData. */
    extraData: Record<string, any>;
    distanceToTrigger: number | null;
}

interface TriggerDataOnInitActivation extends TriggerDataOnActivation {
    cancelAction: (reason?: string, title?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
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

interface TriggerDataOnPreStatusApplied extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    cancelChange: (reason?: string, title?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnPreStatusRemoved extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    cancelChange: (reason?: string, title?: string, showCard?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
}

interface TriggerDataOnDeploy extends TriggerDataBase {
    triggeringToken: Token;
    item: any;
    deployedTokens: any[];
    deployType: "deployable" | "throw";
    distanceToTrigger: number | null;
}

interface TriggerDataonHeatGain extends TriggerDataBase {
    triggeringToken: Token;
    heatGained: number;
    currentHeat: number;
    inDangerZone: boolean;
    distanceToTrigger: number | null;
}

interface TriggerDataonHeatLoss extends TriggerDataBase {
    triggeringToken: Token;
    heatCleared: number;
    currentHeat: number;
    distanceToTrigger: number | null;
}

interface TriggerDataOnHpLoss extends TriggerDataBase {
    triggeringToken: Token;
    hpLost: number;
    currentHP: number;
    distanceToTrigger: number | null;
}

interface TriggerDataonHpGain extends TriggerDataBase {
    triggeringToken: Token;
    hpRestored: number;
    currentHP: number;
    maxHP: number;
    distanceToTrigger: number | null;
}

interface TriggerDataOnDestroyed extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnStructure extends TriggerDataBase { triggeringToken: Token; remainingStructure: number; rollResult: number; rollDice: number[]; cancelStructureOutcome: CancelFunction; modifyRoll: (newTotal: number) => void; flowState: any; }
interface TriggerDataOnStress extends TriggerDataBase { triggeringToken: Token; remainingStress: number; rollResult: number; rollDice: number[]; cancelStressOutcome: CancelFunction; modifyRoll: (newTotal: number) => void; flowState: any; }
interface TriggerDataOnTurnStart extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnTurnEnd extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnEnterCombat extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }
interface TriggerDataOnExitCombat extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; }

type TriggerData =
    | TriggerDataOnMove
    | TriggerDataOnPreMove
    | TriggerDataOnKnockback
    | TriggerDataOnDamage
    | TriggerDataOnAttack
    | TriggerDataOnHit
    | TriggerDataOnMiss
    | TriggerDataOnInitAttack
    | TriggerDataOnTechAttack
    | TriggerDataOnTechHit
    | TriggerDataOnTechMiss
    | TriggerDataOnInitTechAttack
    | TriggerDataOnCheck
    | TriggerDataOnInitCheck
    | TriggerDataOnActivation
    | TriggerDataOnInitActivation
    | TriggerDataOnStatusApplied
    | TriggerDataOnStatusRemoved
    | TriggerDataOnPreStatusApplied
    | TriggerDataOnPreStatusRemoved
    | TriggerDataOnDeploy
    | TriggerDataonHeatGain
    | TriggerDataonHeatLoss
    | TriggerDataOnHpLoss
    | TriggerDataonHpGain
    | TriggerDataOnDestroyed
    | TriggerDataOnStructure
    | TriggerDataOnStress
    | TriggerDataOnTurnStart
    | TriggerDataOnTurnEnd
    | TriggerDataOnEnterCombat
    | TriggerDataOnExitCombat;

type TriggerType =
    | "onMove" | "onPreMove"
    | "onKnockback"
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
    | "onDestroyed" | "onPreStructure" | "onStructure" | "onPreStress" | "onStress"
    | "onPreHeatChange" | "onHeatGain" | "onHeatLoss"
    | "onPreHpChange" | "onHpLoss" | "onHpGain"
    | "onDeploy"
    | "onTurnStart" | "onTurnEnd"
    | "onEnterCombat" | "onExitCombat"
    | "onUpdate";

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
    // ── OverwatchAPI ──────────────────────────────────────────────────────────
    checkOverwatchCondition(reactorToken: Token, moverToken: Token, startPos: object): boolean;

    // ── ReactionsAPI ──────────────────────────────────────────────────────────
    executeSimpleActivation(actor: any, options: object, extraData?: object): Promise<{ completed: boolean; flow: any }>;
    /** Register item-based reactions keyed by item LID */
    registerDefaultItemReactions(reactions: Record<string, ReactionGroup>): void;
    /** Register general (non-item) reactions by name */
    registerDefaultGeneralReactions(reactions: Record<string, ReactionConfig | ReactionGroup>): void;
    /** Register a named utility function retrievable across activation scripts */
    registerUserHelper(name: string, fn: Function): void;
    /** Retrieve a registered user helper by name */
    getUserHelper(name: string): Function | null;

    // ── EffectsAPI ────────────────────────────────────────────────────────────
    /** @deprecated Use findEffectOnToken */
    findFlaggedEffectOnToken(token: Token, identifier: string | ((e: any) => boolean)): any | undefined;
    findEffectOnToken(token: Token, identifier: string | ((e: any) => boolean)): any | undefined;
    getAllEffects(target: Token | any): any[];
    applyEffectsToTokens(options?: {
        tokens?: Token[];
        effectNames?: Array<string | { name: string;[key: string]: any }>;
        note?: string;
        duration?: object;
        checkEffectCallback?: Function;
        notify?: boolean | object;
        [key: string]: any;
    }, extraOptions?: { consumption?: ConsumptionConfig;[key: string]: any }): Promise<any>;
    /** @deprecated Use applyEffectsToTokens */
    applyFlaggedEffectToTokens(options?: {
        tokens?: Token[];
        effectNames?: Array<string | { name: string;[key: string]: any }>;
        notify?: boolean | object;
        [key: string]: any;
    }, extraOptions?: object): Promise<any>;
    removeEffectsByNameFromTokens(options?: {
        tokens?: Token[];
        effectNames?: string | string[];
        originId?: string;
        extraFlags?: object;
        notify?: boolean | object;
    }): Promise<void>;
    removeEffectsByName(actor: any, effectNames: string | string[], originId?: string): Promise<void>;
    removeEffectByName(token: Token, effectName: string, extraFlags?: object): Promise<void>;
    deleteEffect(token: Token | any | string, effect: any | string): Promise<void>;
    deleteAllEffects(tokens: Array<Token | any>): Promise<void>;
    consumeEffectCharge(effect: any): Promise<boolean>;
    triggerEffectImmunity(token: Token, effectNames: string | string[], source?: any, notify?: boolean): Promise<void>;
    checkEffectImmunities(actor: any, effectName: string): string[];
    /** @deprecated Use applyEffectsToTokens */
    setEffect(token: Token, effectData: object, options?: object): Promise<any>;
    processEffectConsumption(triggerType: TriggerType, triggerData: TriggerData): Promise<void>;
    executeEffectManager(options?: object): Promise<void>;

    // ── BonusesAPI ────────────────────────────────────────────────────────────
    addGlobalBonus(actor: any, bonusData: {
        id?: string;
        name?: string;
        type: string;
        subtype?: string;
        effects?: string[];
        damageTypes?: string[];
        tagName?: string;
        val?: number | string;
        tagMode?: "add" | "override";
        removeTag?: boolean;
        rangeType?: string;
        rangeMode?: "add" | "override" | "change";
        bonuses?: object[];
        uses?: number;
        stat?: string;
        rollTypes?: string[];
        condition?: string | Function;
        itemLids?: string[];
        applyTo?: string[];
        damage?: Array<{ type: string; val: any }>;
        [key: string]: any;
    }, options?: {
        duration?: "indefinite" | "end" | "start";
        durationTurns?: number;
        origin?: string;
        consumption?: ConsumptionConfig;
    }): Promise<string>;
    removeGlobalBonus(actor: any, bonusId: string, skipEffectRemoval?: boolean): Promise<void>;
    getGlobalBonuses(actor: any): any[];
    addConstantBonus(actor: any, bonusData: object, options?: object): Promise<void>;
    getConstantBonuses(actor: any): any[];
    removeConstantBonus(actor: any, bonusId: string): Promise<void>;
    getImmunityBonuses(actor: any, subtype: string): any[];
    applyDamageImmunities(actor: any, damages: Array<{ type: string; val: any }>): Array<{ type: string; val: any }>;
    hasCritImmunity(actor: any, attackerActor?: any): Promise<boolean>;
    hasHitImmunity(actor: any, attackerActor?: any): Promise<boolean>;
    hasMissImmunity(actor: any, attackerActor?: any): Promise<boolean>;

    // ── InteractiveAPI ────────────────────────────────────────────────────────
    chooseToken(sourceToken: Token, options?: {
        range?: number;
        count?: number;
        filter?: (token: Token) => boolean;
        includeHidden?: boolean;
        includeSelf?: boolean;
        title?: string;
        description?: string;
        icon?: string;
        headerClass?: string;
    }): Promise<Token[] | null>;
    placeZone(casterToken: Token, options?: {
        x?: number;
        y?: number;
        range?: number;
        size?: number;
        type?: "Blast" | "Burst" | "Cone" | "Line";
        fillColor?: string;
        borderColor?: string;
        texture?: string;
        count?: number;
        hooks?: Record<string, { command?: string; function?: Function; asGM?: boolean }>;
        dangerous?: { damageType: string; damageValue: number };
        statusEffects?: string[];
        difficultTerrain?: { movementPenalty: number; isFlatPenalty: boolean };
        centerLabel?: string;
        title?: string;
        description?: string;
        icon?: string;
        attachToToken?: TokenDocument | string;
    }): Promise<any>;
    placeToken(options?: {
        actor?: any | any[];
        range?: number;
        count?: number;
        extraData?: object;
        origin?: Token | { x: number; y: number };
        onSpawn?: (newTokenDoc: any, origin: any) => void;
        title?: string;
        noCard?: boolean;
    }): Promise<any>;
    knockBackToken(tokens: Token | Token[], distance: number, options?: { title?: string; description?: string; icon?: string; headerClass?: string; triggeringToken?: Token; actionName?: string; item?: any }): Promise<any>;
    applyKnockbackMoves(moveList: Array<{ tokenId: string; updateData: { x: number; y: number } }>, triggeringToken: Token | null, distance: number, actionName?: string, item?: any): Promise<void>;
    startChoiceCard(options?: {
        mode?: "or" | "and" | "vote" | "vote-hidden";
        choices?: Array<{ text: string; icon?: string; callback?: (data: any) => any; data?: any;[key: string]: any }>;
        title?: string;
        description?: string;
        icon?: string;
        headerClass?: string;
        userIdControl?: string | string[] | null;
        traceData?: any;
        numberToChoose?: number;
        selectionValidator?: (selected: any[]) => { valid: boolean; message?: string };
        item?: Item;
        relatedToken?: Token | null;
        originToken?: Token | null;
    }): Promise<{ choiceIdx: number | null; responderIds: string[] } | null>;
    openChoiceMenu(): Promise<void>;
    pickItem(items: any[], options?: {
        title?: string;
        description?: string;
        icon?: string;
        formatText?: (item: any) => string;
        relatedToken?: Token | null;
    }): Promise<any | null>;
    revertMovement(token: Token): Promise<void>;
    clearMovementHistory(token: Token): void;
    clearMoveData(tokenOrId: Token | string): void;
    undoMoveData(tokenOrId: Token | string, distance?: number): void;
    getMovementCap(tokenOrId: Token | string): number;
    initMovementCap(token: Token): void;
    increaseMovementCap(tokenOrId: Token | string, value: number): void;
    getActiveGMId(): string | null;
    getTokenOwnerUserId(token: Token): string[];

    // ── Spatial & Distance ────────────────────────────────────────────────────
    getTokenDistance(t1: Token, t2: Token): number;
    getMinGridDistance(t1: Token, t2: Token, overridePos1?: { x: number; y: number }): number;
    getGridDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number;
    isHostile(t1: Token, t2: Token): boolean;
    isFriendly(t1: Token, t2: Token): boolean;
    getTokenCells(token: Token): Array<[number, number]>;
    getMaxGroundHeightUnderToken(token: Token, terrainAPI?: any): number;
    drawThreatDebug(token: Token): void;
    drawDistanceDebug(): void;
    drawRangeHighlight(token: Token, range: number, color?: number, alpha?: number): any;

    // ── MiscAPI ───────────────────────────────────────────────────────────────
    getItemLID(item: any): string | null;
    isItemAvailable(item: any, reactionPath?: string): boolean;
    hasReactionAvailable(token: Token): boolean;
    isFriendly(t1: Token, t2: Token): boolean;
    findItemByLid(actor: any, lid: string): any | null;
    getWeapons(token: Token | any): any[];
    updateTokenSystem(token: Token, data: object): Promise<void>;
    reloadOneWeapon(actorOrToken: Token | any, targetName?: string): Promise<any | null>;
    rechargeSystem(actorOrToken: Token | any, targetName?: string): Promise<any | null>;
    findAura(actorOrToken: Token | any, auraName: string): object | null;

    // ── Weapon & Item Details ─────────────────────────────────────────────────
    getItemTags_WithBonus(item: any, actor?: any): Promise<any[]>;
    getActorMaxThreat(actor: any): Promise<number>;
    getMaxWeaponRanges_WithBonus(input: any | any[]): Promise<Record<string, number>>;
    getMaxWeaponReach_WithBonus(input: any | any[]): Promise<number>;
    getWeaponType(item: any): string;
    getItemType(item: any): string;
    getWeaponProfiles_WithBonus(weapon: any, actor?: any): any[];

    // ── Resource Management ───────────────────────────────────────────────────
    setReaction(actorOrToken: Token | any, value: boolean): Promise<void>;
    setItemResource(item: any, nb: number | boolean, counterIndex?: number): Promise<void>;

    // ── Deployment & Thrown Weapons ───────────────────────────────────────────
    addItemFlags(item: any, flags: Record<string, any>): Promise<any>;
    getItemFlags(item: any, flagName?: string): any;
    addExtraDeploymentLids(item: any, lids: string | string[]): Promise<any>;
    addExtraActions(target: any, actions: object | object[]): Promise<any>;
    getItemActions(item: any): object[];
    getActorActions(tokenOrActor: Token | any): object[];
    removeExtraActions(target: any, filter?: Function | string | string[] | null): Promise<void>;
    getItemDeployables(item: any, actor?: any): string[];
    placeDeployable(options: {
        deployable: any | string | Array<any | string>;
        ownerActor: any;
        systemItem?: any;
        consumeUse?: boolean;
        fromCompendium?: boolean;
        width?: number;
        height?: number;
        range?: number;
        count?: number;
        at?: Token | { x: number; y: number };
        title?: string;
        noCard?: boolean;
    }): Promise<any>;
    beginDeploymentCard(options: {
        actor: any;
        item: any;
        deployableOptions?: object[];
    }): Promise<any>;
    deployWeaponToken(weapon: any, ownerActor: any, originToken?: Token, options?: object): Promise<any>;
    openDeployableMenu(actor: any): Promise<void>;
    recallDeployable(ownerToken: Token): Promise<void>;
    pickupWeaponToken(ownerToken: Token): Promise<void>;
    openThrowMenu(actor: any): Promise<void>;
    beginThrowWeaponFlow(weapon: any): Promise<any>;
    openItemBrowser(targetInput?: any): Promise<void>;
    addItemTag(item: any, tagData: { id: string; val?: any;[key: string]: any }): Promise<any>;
    removeItemTag(item: any, tagId: string): Promise<any>;

    // ── AurasAPI ──────────────────────────────────────────────────────────────
    createAura(owner: Token | any, auraConfig: object): Promise<any>;
    deleteAuras(owner: Token | any, filter: string | object, options?: object): Promise<void>;

    // ── ScanAPI ───────────────────────────────────────────────────────────────
    performSystemScan(token: Token, target: Token, options?: object): Promise<void>;

    // ── TerrainAPI ────────────────────────────────────────────────────────────
    getTerrainAt(x: number, y: number): any;

    // ── DowntimeAPI ───────────────────────────────────────────────────────────
    executeDowntimeAction(actor: any, action: string, options?: object): Promise<void>;

    // ── Main helpers ──────────────────────────────────────────────────────────
    handleTrigger(triggerType: TriggerType, data: object): Promise<void>;
    getMovementHistory(token: Token | string): MovementHistoryResult | { exists: false };
    getCumulativeMoveData(tokenOrId: Token | string): MoveSummary;
    getIntentionalMoveData(tokenOrId: Token | string): MoveSummary;
    executeStatRoll(actor: any, stat: string, title: string, target?: number | Token | TokenDocument | "token", extraData?: { targetStat?: string; sendToOwner?: boolean; cardTitle?: string; cardDescription?: string;[key: string]: any }): Promise<{ completed: boolean; total?: number; roll?: any; passed?: boolean }>;

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
    category?: string;
    itemType?: string;
    triggers: TriggerType[];
    triggerSelf?: boolean;
    triggerOther?: boolean;
    outOfCombat?: boolean;
    isReaction?: boolean;
    checkReaction?: boolean;
    enabled?: boolean;
    onlyOnSourceMatch?: boolean;
    autoActivate?: boolean;
    awaitActivationCompletion?: boolean;
    actionType?: string;
    frequency?: string;
    activationType?: "code" | "macro" | "item-use" | "flow" | "none";
    activationMode?: "instead" | "after";
    reactionPath?: string;
    dispositionFilter?: string[];
    onInit?: ((token: Token, item: any, api: LancerAutomationsAPI) => Promise<void>) | string;
    onMessage?: ((triggerType: TriggerType, data: any, reactorToken: Token, item: any, activationName: string, api: LancerAutomationsAPI) => Promise<void>) | string;
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
