/**
 * Type declarations for lancer-automations internal API.
 */

// Base trigger data

/** Opts accepted by every cancel/modify helper, controls which documents the confirm card shows. */
interface CancelCardOpts {
    item?: any;
    originToken?: Token | null;
    relatedToken?: Token | null;
}

/**
 * Blocks the pending action. Calling it aborts immediately (the flag is set synchronously).
 * `preConfirm` returning false takes the ignore path, which redoes the original action.
 */
interface CancelFunction {
    (
        reasonText?: string,
        title?: string,
        allowConfirm?: boolean,
        userIdControl?: string | string[] | null,
        preConfirm?: (() => Promise<boolean>) | null,
        postChoice?: ((chose: boolean) => Promise<void> | void) | null,
        opts?: CancelCardOpts
    ): Promise<void>;
    /** Resolves once the confirm card (and any ignore-path redo) has settled. */
    wait(): Promise<void>;
}

/** Cancels a move. Same contract as CancelFunction but with no `title` param. */
interface CancelMoveFunction {
    (
        reasonText?: string,
        allowConfirm?: boolean,
        userIdControl?: string | string[] | null,
        preConfirm?: (() => Promise<boolean>) | null,
        postChoice?: ((chose: boolean) => Promise<void> | void) | null,
        opts?: CancelCardOpts
    ): Promise<void>;
}

/** Reroutes a move to `position` instead of cancelling it. The redo is treated as a new move. */
type ChangeMoveFunction = (
    position: { x: number; y: number },
    extraData?: Record<string, any>,
    reasonText?: string,
    allowConfirm?: boolean,
    userIdControl?: string | string[] | null,
    preConfirm?: (() => Promise<boolean>) | null,
    postChoice?: ((chose: boolean) => Promise<void> | void) | null,
    opts?: CancelCardOpts
) => Promise<void>;

/** Replaces the pending HP/heat value. `.wait()` resolves once the card has settled. */
interface ModifyValueFunction {
    (
        newValue: number,
        reasonText?: string,
        allowConfirm?: boolean,
        userIdControl?: string | string[] | null,
        preConfirm?: (() => Promise<boolean>) | null,
        postChoice?: ((chose: boolean) => Promise<void> | void) | null,
        opts?: CancelCardOpts
    ): Promise<void>;
    wait(): Promise<void>;
}

/** Re-rolls the triggering roll. `subtype` picks the card wording ('retry', 'reroll', ...). */
type RerollFunction = (
    reasonText?: string | null,
    subtype?: string,
    title?: string | null,
    allowConfirm?: boolean,
    userIdControl?: string | string[] | null,
    opts?: CancelCardOpts
) => Promise<void>;

/** Overwrites the roll total in place. */
type ChangeRollFunction = (
    newTotal: number,
    reasonText?: string | null,
    title?: string | null,
    allowConfirm?: boolean,
    userIdControl?: string | string[] | null,
    preConfirm?: (() => Promise<boolean>) | null,
    postChoice?: ((chose: boolean) => Promise<void> | void) | null,
    opts?: CancelCardOpts
) => Promise<void>;

interface TriggerDataBase {
    triggeringToken?: Token;
    distanceToTrigger?: number | null;
    canTriggerReaction?: boolean;
    /** Normalized target tokens: unwraps `targets` entries ({ target }/{ token } wrappers or raw tokens) and single `target`/`token`/`checkAgainstToken`, actor-bearing only. */
    hitTokens?: Token[];
    /** True when the reactor token is one of the event's targets (per-reactor). */
    isTarget?: boolean;
    /** The reactor's own entry of `targets` ({ target/token, roll, crit, ... }) when the trigger carries per-target entries, else null. */
    targetEntry?: { target?: Token; token?: Token; roll?: Roll; crit?: boolean; [key: string]: any } | null;
    /** Whether the trigger's attack is ranged. Item-less basic attacks report Melee, past 1 hex from every target they count as ranged. */
    isRangedAttack(): boolean;
    /** Launch the item's default activation flow (WeaponAttackFlow / ActivationFlow / SystemFlow depending on shape) on the current client. */
    startRelatedFlow(): Promise<void>;
    /** Same as startRelatedFlow but routed to a user's client. `wait: true` awaits the remote flow. */
    startRelatedFlowToReactor(userId?: string | null, extraData?: Record<string, any> | null, options?: { wait?: boolean }): Promise<void>;
    /** Sends a message to the reactor token's owner client. Calls onMessage on the matching reaction there. data must be JSON-serializable. If userId is omitted, falls back to the token's owner (with a warning). */
    sendMessageToReactor(data: any, userId?: string | null): Promise<void>;
    /** Dumps triggerType/triggerData/reactorToken/item/activationName to the console and returns a summary. */
    debugActivation(label?: string): any;
    [key: string]: any;
}

// Move history types

interface MoveHistoryEntry {
    distanceMoved: number;
    movementCost: number;
    isDrag: boolean;
    isFreeMovement: boolean;
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

// Shared subtypes

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
    isFreeMovement?: boolean;
    movementCost?: number;
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

// TriggerData per trigger type

interface TriggerDataOnMove extends TriggerDataBase {
    triggeringToken: Token;
    distanceMoved: number;
    elevationMoved: number;
    startPos: { x: number; y: number; elevation: number };
    endPos: { x: number; y: number; elevation: number };
    isDrag: boolean;
    moveInfo: MoveInfo;
    /** Leg classification vs the turn's movement bands. Null out of combat or on free moves. `boosted` = the move ends in a boost or over-boost leg. */
    moveLeg: { start: string | null; end: string | null; boosted: boolean; granted: boolean; spentBefore: number; spentAfter: number } | null;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

/** Fires before move. NOTE: uses `token` not `triggeringToken`. Supports cancelTriggeredMove. */
interface TriggerDataOnPreMove extends TriggerDataBase {
    triggeringToken: Token;
    distanceToMove: number;
    elevationToMove: number;
    startPos: { x: number; y: number };
    endPos: { x: number; y: number };
    isDrag: boolean;
    moveInfo: MoveInfo;
    cancel: () => void;
    cancelTriggeredMove: (reason?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => Promise<void>;
    changeTriggeredMove: (position: { x: number; y: number; elevation?: number }, extraData?: object, reason?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => Promise<void>;
}

interface TriggerDataOnInvoluntaryMove extends TriggerDataBase {
    triggeringToken: Token;
    token: Token;
    distance: number;
    actionName: string;
    item: any;
    destination: { x: number; y: number };
    cancel: (reason?: string) => void;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
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
    canTriggerReaction?: boolean;
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
    canTriggerReaction?: boolean;
}

interface TriggerDataOnPreDamage extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    targets: Token[];
    hitTokens: Token[];
    attackType: string;
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    /** Aborts the whole damage roll, not one target. */
    cancelDamage: CancelFunction;
    flowState: any;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
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
    canTriggerReaction?: boolean;
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
    canTriggerReaction?: boolean;
}

interface TriggerDataOnInitAttack extends TriggerDataBase {
    triggeringToken: Token;
    weapon: any;
    targets: Token[];
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    cancelAttack: (reason?: string, title?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
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
    canTriggerReaction?: boolean;
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
    canTriggerReaction?: boolean;
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
    canTriggerReaction?: boolean;
}

interface TriggerDataOnInitTechAttack extends TriggerDataBase {
    triggeringToken: Token;
    techItem: any;
    targets: Token[];
    actionName: string;
    tags: Array<{ lid: string;[key: string]: any }>;
    actionData: ActionData;
    isInvade: boolean;
    cancelTechAttack: (reason?: string, title?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnCheck extends TriggerDataBase {
    triggeringToken: Token;
    statName: string;
    roll: Roll;
    total: number;
    success: boolean;
    checkAgainstToken: Token | null;
    targetVal: number | null;
    /** Item the check was attributed to, null unless the caller stamped `sourceItemUuid` */
    item: any | null;
    /** Action the check was attributed to, null unless the caller stamped `sourceAction` */
    actionName: string | null;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnInitCheck extends TriggerDataBase {
    triggeringToken: Token;
    statName: string;
    checkAgainstToken: Token | null;
    targetVal: number | null;
    /** Item the check was attributed to, null unless the caller stamped `sourceItemUuid` */
    item: any | null;
    /** Action the check was attributed to, null unless the caller stamped `sourceAction` */
    actionName: string | null;
    cancelCheck: (reason?: string, title?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnActivation extends TriggerDataBase {
    triggeringToken: Token;
    actionType: string;
    actionName: string;
    item: any;
    actionData: ActionData;
    /** Set when the activator is a deployable actor. `lid` is the deployable's `system.lid`
     * (e.g. "dep_moonlight_drone"). `triggerData.item` is auto-resolved to the source item
     * (the parent item whose `system.deployables[]` contains this LID). */
    deployable?: { actor: any; lid: string | null } | null;
    /** False on `onActivation` / `onInitActivation`, true on `onEndActivation` / `onInitEndActivation`. */
    endActivation: boolean;
    /** Extra data injected via startRelatedFlowToReactor(userId, extraData), sourced from flow.state.la_extraData.
     * Mod activations carry `hostWeapon` (the weapon the mod is mounted on). */
    extraData: Record<string, any>;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnInitActivation extends TriggerDataOnActivation {
    cancelAction: (reason?: string, title?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
}

/** Fired when an item activation is ended (the "end action" from setItemAsActivated), not started. */
interface TriggerDataOnEndActivation extends TriggerDataOnActivation { }

interface TriggerDataOnInitEndActivation extends TriggerDataOnInitActivation { }

interface TriggerDataOnStatusApplied extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnStatusRemoved extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnPreStatusApplied extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    cancelChange: (reason?: string, title?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnPreStatusRemoved extends TriggerDataBase {
    triggeringToken: Token;
    statusId: string;
    effect: any;
    cancelChange: (reason?: string, title?: string, allowConfirm?: boolean, userIdControl?: string | string[] | null, preConfirm?: (() => Promise<boolean>) | null, postChoice?: ((chose: boolean) => any) | null, opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }) => void;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnDeploy extends TriggerDataBase {
    triggeringToken: Token;
    item: any;
    deployedTokens: any[];
    deployType: "deployable" | "throw";
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataonHeatGain extends TriggerDataBase {
    triggeringToken: Token;
    heatChange: number;
    currentHeat: number;
    inDangerZone: boolean;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataonHeatLoss extends TriggerDataBase {
    triggeringToken: Token;
    heatCleared: number;
    currentHeat: number;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnHpLoss extends TriggerDataBase {
    triggeringToken: Token;
    hpLost: number;
    currentHP: number;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataonHpGain extends TriggerDataBase {
    triggeringToken: Token;
    hpChange: number;
    currentHP: number;
    maxHP: number;
    distanceToTrigger: number | null;
    canTriggerReaction?: boolean;
}

interface TriggerDataOnDestroyed extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; canTriggerReaction?: boolean; }
interface TriggerDataOnStructure extends TriggerDataBase { triggeringToken: Token; remainingStructure: number; rollResult: number; rollDice: number[]; cancelStructureOutcome: CancelFunction; modifyRoll: (newTotal: number) => void; flowState: any; canTriggerReaction?: boolean; }

/** Fired after a roll resolves, before the card prints. `reroll()` re-runs the Lancer roll step, `changeRoll(newTotal)` sets the total. Both cascade, re-firing onRoll so later reactions see the new result. */
interface TriggerDataOnRoll extends TriggerDataBase {
    triggeringToken: Token;
    rollType: "attackRoll" | "techAttackRoll" | "damageRoll" | "skillRoll" | "structureRoll" | "stressRoll";
    roll: any;
    total: number | null;
    success: boolean | undefined;
    targets?: Array<{ token: Token | null; total?: number | null; hit?: boolean; crit?: boolean; damage?: any }>;
    item: any;
    isReroll: boolean;
    rerollCount: number;
    /**
     * Re-run the underlying roll step. `subtype` "retry" (default) replaces the original,
     * "highest" / "lowest" auto-keep the better/worse total, "choose" asks the user to pick Original vs Alt.
     * `allowConfirm: false` skips the "USE REROLL?" prompt and runs silently.
     * `opts` may carry `{ item, originToken, relatedToken, preConfirm, postChoice }` and is auto-defaulted from the reactor context.
     */
    reroll: (
        reason?: string | null,
        subtype?: "retry" | "highest" | "lowest" | "choose",
        title?: string | null,
        allowConfirm?: boolean,
        userIdControl?: string | string[] | null,
        opts?: {
            item?: any;
            originToken?: Token | null;
            relatedToken?: Token | null;
            preConfirm?: (() => Promise<boolean>) | null;
            postChoice?: ((chose: boolean) => any) | null;
        }
    ) => Promise<void>;
    /**
     * Set the roll total directly (recomputes hit/crit for attack flows, structure/stress only update `_total`).
     * `allowConfirm: false` skips the "CHANGE ROLL?" prompt.
     */
    changeRoll: (
        newTotal: number,
        reason?: string | null,
        title?: string | null,
        allowConfirm?: boolean,
        userIdControl?: string | string[] | null,
        preConfirm?: (() => Promise<boolean>) | null,
        postChoice?: ((chose: boolean) => any) | null,
        opts?: { item?: any; originToken?: Token | null; relatedToken?: Token | null }
    ) => Promise<void>;
    flowState: any;
    canTriggerReaction?: boolean;
}
interface TriggerDataOnStress extends TriggerDataBase { triggeringToken: Token; remainingStress: number; rollResult: number; rollDice: number[]; cancelStressOutcome: CancelFunction; modifyRoll: (newTotal: number) => void; flowState: any; canTriggerReaction?: boolean; }
interface TriggerDataOnTurnStart extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; canTriggerReaction?: boolean; }
interface TriggerDataOnTurnEnd extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; canTriggerReaction?: boolean; }
interface TriggerDataOnEnterCombat extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; canTriggerReaction?: boolean; }
interface TriggerDataOnExitCombat extends TriggerDataBase { triggeringToken: Token; distanceToTrigger: number | null; canTriggerReaction?: boolean; }

type TriggerData =
    | TriggerDataOnMove
    | TriggerDataOnPreMove
    | TriggerDataOnInvoluntaryMove
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
    | TriggerDataOnRoll
    | TriggerDataOnStress
    | TriggerDataOnTurnStart
    | TriggerDataOnTurnEnd
    | TriggerDataOnEnterCombat
    | TriggerDataOnExitCombat;

type TriggerType =
    | "onMove" | "onPreMove"
    | "onInvoluntaryMove"
    | "onPreDamage"
    | "onDamage"
    | "onHit" | "onMiss"
    | "onAttack"
    | "onTechAttack" | "onTechHit" | "onTechMiss"
    | "onCheck"
    | "onActivation" | "onInitActivation"
    | "onEndActivation" | "onInitEndActivation"
    | "onInitAttack" | "onInitTechAttack"
    | "onInitCheck"
    | "onStatusApplied" | "onStatusRemoved"
    | "onPreStatusApplied" | "onPreStatusRemoved"
    | "onDestroyed" | "onTokenCreated" | "onTokenRemoved" | "onTokenVisibility"
    | "onPreStructure" | "onStructure" | "onPreStress" | "onStress"
    | "onRoll"
    | "onPreHeatChange" | "onHeatGain" | "onHeatLoss"
    | "onPreHpChange" | "onHpLoss" | "onHpGain"
    | "onDeploy"
    | "onTurnStart" | "onTurnEnd"
    | "onRoundStart"
    | "onEnterCombat" | "onExitCombat"
    | "onUpdate";

// Shared subtypes

interface ConsumptionConfig {
    trigger?: TriggerType | TriggerType[];
    originId?: string;
    grouped?: boolean;
    groupId?: string;
    itemLid?: string;
    itemId?: string;
    actionName?: string;
    statusId?: string;
    minDistance?: number;
    checkType?: string;
    checkAbove?: number;
    checkBelow?: number;
    evaluate?: ((triggerType: TriggerType, triggerData: TriggerData, bearerToken: Token, effect: any) => Promise<boolean> | boolean) | string;
    [key: string]: any;
}

// Module API

interface LancerAutomationsAPI {
    // OverwatchAPI

    // ReactionsAPI
    executeSimpleActivation(actor: any, options: object, extraData?: object): Promise<{ completed: boolean; flow: any }>;  // scripts/tools/misc-tools.js
    playMineDetonationFX(mineToken: Token): Promise<void>;  // scripts/fx/actionFX.js
    /** Register item-based reactions keyed by item LID */
    registerDefaultItemReactions(reactions: Record<string, ReactionGroup>): void;  // scripts/activations/reactions-registry.js
    /** Register general (non-item) reactions by name */
    registerDefaultGeneralReactions(reactions: Record<string, ReactionConfig | ReactionGroup>): void;  // scripts/activations/reactions-registry.js
    /** Register a named utility function retrievable across activation scripts */
    registerUserHelper(name: string, fn: Function): void;  // scripts/main.js
    /** Retrieve a registered user helper by name */
    getUserHelper(name: string): Function | null;  // scripts/main.js

    // EffectsAPI
    /** @deprecated Use findEffectOnToken */
    findFlaggedEffectOnToken: typeof import("../bonuses/flagged-effects.js").findFlaggedEffectOnToken;
    findEffectOnToken: typeof import("../bonuses/flagged-effects.js").findEffectOnToken;
    hasStatus: typeof import("../bonuses/flagged-effects.js").hasStatus;
    getAllEffects: typeof import("../bonuses/flagged-effects.js").getAllEffects;
    applyEffectsToTokens(options?: {  // scripts/bonuses/flagged-effects.js
        tokens?: Token[];
        effectNames?: Array<string | { name: string;[key: string]: any }>;
        note?: string;
        duration?: object;
        checkEffectCallback?: Function;
        notify?: boolean | object;
        [key: string]: any;
    }, extraOptions?: { consumption?: ConsumptionConfig;[key: string]: any }): Promise<any>;
    /** @deprecated Use applyEffectsToTokens */
    applyFlaggedEffectToTokens(options?: {  // scripts/bonuses/flagged-effects.js
        tokens?: Token[];
        effectNames?: Array<string | { name: string;[key: string]: any }>;
        notify?: boolean | object;
        [key: string]: any;
    }, extraOptions?: object): Promise<any>;
    removeEffectsByNameFromTokens(options?: {  // scripts/bonuses/flagged-effects.js
        tokens?: Token[];
        effectNames?: string | string[];
        originId?: string;
        extraFlags?: object;
        notify?: boolean | object;
    }): Promise<void>;
    ensureLinkedEffect(options?: { items?: any[]; effectNames?: any; note?: string; duration?: object }, extraOptions?: object): Promise<any[]>;  // scripts/bonuses/flagged-effects.js
    applyMark(sourceToken: Token, targets: Token | Token[], options: { effect: string | { name: string; icon?: string; isCustom?: boolean }; note?: string; duration?: object; flagKey?: string; extraOptions?: object }): Promise<any>;  // scripts/bonuses/flagged-effects.js
    findMarkedTokens(sourceToken: Token, effectName: string, options?: { flagKey?: string }): Token[];  // scripts/bonuses/flagged-effects.js
    findEffectFrom: typeof import("../bonuses/flagged-effects.js").findEffectFrom;
    findEffectsOnToken(token: Token, effectName: string, options?: { extraFlags?: object; hasFlags?: string[]; excludeId?: string }): any[];  // scripts/bonuses/flagged-effects.js
    clearMarks(sourceToken: Token, effectName: string, options?: { flagKey?: string }): Promise<Token[]>;  // scripts/bonuses/flagged-effects.js
    removeEffectsByName: typeof import("../bonuses/flagged-effects.js").removeEffectsByName;
    deleteEffect: typeof import("../bonuses/flagged-effects.js").deleteEffect;
    deleteAllEffects: typeof import("../bonuses/flagged-effects.js").deleteAllEffects;
    consumeEffectCharge: typeof import("../bonuses/flagged-effects.js").consumeEffectCharge;
    triggerEffectImmunity: typeof import("../bonuses/flagged-effects.js").triggerEffectImmunity;
    checkEffectImmunities: typeof import("../bonuses/genericBonuses.js").checkEffectImmunities;
    /** @deprecated Use applyEffectsToTokens */
    setEffect: typeof import("../bonuses/flagged-effects.js").setEffect;
    processEffectConsumption(triggerType: TriggerType, triggerData: TriggerData): Promise<void>;  // scripts/activations/reactions-engine.js
    executeEffectManager: typeof import("../bonuses/effectManager.js").executeEffectManager;

    // BonusesAPI
    addGlobalBonus(actor: any, bonusData: {  // scripts/bonuses/genericBonuses.js
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
        applyToCondition?: string | Function;
        damage?: Array<{ type: string; val: any }>;
        [key: string]: any;
    }, options?: {
        duration?: "indefinite" | "end" | "start";
        durationTurns?: number;
        origin?: string | Token;
        icon?: string;
        consumption?: ConsumptionConfig;
    }): Promise<string>;
    removeGlobalBonus: typeof import("../bonuses/genericBonuses.js").removeGlobalBonus;
    consumeBonusUse(actor: any, bonus: any, opts?: { removeWhenNoUses?: boolean }): Promise<string | false>;  // scripts/bonuses/genericBonuses.js
    consumeImmunityUse(actor: any, subtype: string, state?: any, options?: { damageTypes?: string[] | null }): Promise<boolean>;  // scripts/bonuses/genericBonuses.js
    supportsConsumeOnUsage: typeof import("../bonuses/genericBonuses.js").supportsConsumeOnUsage;
    getGlobalBonuses: typeof import("../bonuses/genericBonuses.js").getGlobalBonuses;
    addConstantBonus: typeof import("../bonuses/genericBonuses.js").addConstantBonus;
    ensureLinkedBonus(options?: { items?: any[]; bonusData?: object; addOptions?: object }, extraOptions?: object): Promise<any[]>;  // scripts/bonuses/genericBonuses.js
    getConstantBonuses: typeof import("../bonuses/genericBonuses.js").getConstantBonuses;
    removeConstantBonus: typeof import("../bonuses/genericBonuses.js").removeConstantBonus;
    getImmunityBonuses: typeof import("../bonuses/genericBonuses.js").getImmunityBonuses;
    applyDamageImmunities(actor: any, damages: Array<{ type: string; val: any }>): Array<{ type: string; val: any }>;  // scripts/bonuses/genericBonuses.js
    hasCritImmunity: typeof import("../bonuses/genericBonuses.js").hasCritImmunity;
    hasHitImmunity: typeof import("../bonuses/genericBonuses.js").hasHitImmunity;
    hasMissImmunity: typeof import("../bonuses/genericBonuses.js").hasMissImmunity;

    // InteractiveAPI
    chooseToken(sourceToken: Token, options?: {  // scripts/interactive/tools/chooseToken.js
        range?: number | "sensors";
        count?: number;
        disposition?: "friendly" | "hostile";
        filter?: (token: Token) => boolean;
        filterWarning?: string;
        soft?: boolean;
        includeHidden?: boolean;
        includeSelf?: boolean;
        title?: string;
        description?: string;
        icon?: string;
        headerClass?: string;
        item?: any;
        originToken?: Token | null;
        relatedToken?: Token | null;
    }): Promise<Token[] | null>;
    placeZone(casterToken: Token, options?: {  // scripts/interactive/tools/placeZone.js
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
        rangeOrigin?: { x: number; y: number } | null;
        expires?: { on: "ownerTurnStart" | "ownerTurnEnd"; originToken?: Token | string; turns?: number };
        /** Extra templatemacro graphics flags (fill/line/texture), merged onto the template */
        tmacGraphics?: Record<string, any>;
        /** Template Macro library preset, by name or id */
        preset?: string;
    }): Promise<any>;
    tokensInTemplate: typeof import("../interactive/tools/placeZone.js").tokensInTemplate;
    placeToken(options?: {  // scripts/interactive/tools/placeToken.js
        actor?: any | any[];
        range?: number;
        count?: number;
        extraData?: object;
        origin?: Token | { x: number; y: number };
        onSpawn?: (newTokenDoc: any, origin: any) => void;
        title?: string;
        noCard?: boolean;
    }): Promise<any>;
    knockBackToken(tokens: Token | Token[], distance: number, options?: { title?: string; description?: string; icon?: string; headerClass?: string; triggeringToken?: Token; actionName?: string; item?: any }): Promise<any>;  // scripts/interactive/tools/moveTokenRuler.js
    applyKnockbackMoves(moveList: Array<{ tokenId: string; updateData: { x: number; y: number } }>, triggeringToken: Token | null, distance: number, actionName?: string, item?: any, options?: { asVoluntary?: boolean }): Promise<void>;  // scripts/interactive/canvas-helpers.js
    startChoiceCard: typeof import("../interactive/network.js").startChoiceCard;
    confirmCard(options?: { title?: string; description?: string; icon?: string; confirmText?: string; confirmIcon?: string; userIdControl?: string | string[] | null; item?: Item; relatedToken?: Token | null; originToken?: Token | null }): Promise<boolean>;  // scripts/interactive/network.js
    askCard(options?: { title?: string; description?: string; icon?: string; yesText?: string; yesIcon?: string; noText?: string; noIcon?: string; owner?: Token; userIdControl?: string | string[] | null; item?: Item; relatedToken?: Token | null; originToken?: Token | null }): Promise<{ confirmed: boolean; responderIds: string[] }>;  // scripts/interactive/network.js
    pickCard(entries: any[], options?: { label?: string | ((entry: any) => string); entryIcon?: string | ((entry: any) => string); title?: string; description?: string; icon?: string; userIdControl?: string | string[] | null; item?: Item; relatedToken?: Token | null; originToken?: Token | null }): Promise<any | null>;  // scripts/interactive/network.js
    openChoiceMenu: typeof import("../interactive/combat.js").openChoiceMenu;
    pickItem(items: any[], options?: {  // scripts/interactive/deployables.js
        title?: string;
        description?: string;
        icon?: string;
        formatText?: (item: any) => string;
        relatedToken?: Token | null;
    }): Promise<any | null>;
    revertMovement: typeof import("../interactive/combat.js").revertMovement;
    clearMovementHistory: typeof import("../interactive/combat.js").clearMovementHistory;
    clearMoveData(tokenOrId: Token | string): void;  // scripts/movement/move-tracking.js
    /** Shorthand for recordMovementExtra on the leg currently being spent. */
    increaseMovementCap(tokenOrId: Token | string, value: number): void;  // scripts/movement/move-tracking.js
    getActiveGMId(): string | null;  // scripts/interactive/network.js
    getTokenOwnerUserId: typeof import("../interactive/network.js").getTokenOwnerUserId;

    // Spatial & Distance
    getTokenDistance: typeof import("../combat/overwatch.js").getTokenDistance;
    getMinGridDistance(t1: Token, t2: Token, overridePos1?: { x: number; y: number }, includeElevation?: boolean): number;  // scripts/combat/grid-helpers.js
    getGridDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number;  // scripts/interactive/canvas-helpers.js
    measureGridDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number;  // scripts/combat/grid-helpers.js
    snapTokenCenter(token: Token, center: { x: number; y: number }): { x: number; y: number };  // scripts/combat/grid-helpers.js
    getOccupiedCenters(token: Token, overridePos?: { x: number; y: number } | null): Array<{ x: number; y: number }>;  // scripts/combat/grid-helpers.js
    getHexCenter(col: number, row: number): { x: number; y: number };  // scripts/combat/grid-helpers.js
    pixelToOffset(x: number, y: number): { col: number; row: number };  // scripts/combat/grid-helpers.js
    neighborKeys(key: string): string[];  // scripts/combat/grid-helpers.js
    getCellToward(from: Token | { x: number; y: number }, toward: Token | { x: number; y: number }, opts?: { steps?: number; away?: boolean }): { x: number; y: number };  // scripts/combat/grid-helpers.js
    isHostile: typeof import("../combat/overwatch.js").isHostile;
    isFriendly: typeof import("../combat/overwatch.js").isFriendly;
    getTokenCells: typeof import("../combat/terrain-utils.js").getTokenCells;
    getMaxGroundHeightUnderToken: typeof import("../combat/terrain-utils.js").getMaxGroundHeightUnderToken;
    drawThreatDebug: typeof import("../combat/overwatch.js").drawThreatDebug;
    drawDistanceDebug(): void;  // scripts/combat/overwatch.js
    drawRangeHighlight(token: Token, range: number, color?: number, alpha?: number): any;  // scripts/interactive/canvas-helpers.js

    // MiscAPI
    findItemByLid: typeof import("../interactive/deployables.js").findItemByLid;
    getWeapons: typeof import("../interactive/deployables.js").getWeapons;
    updateTokenSystem: typeof import("../tools/misc-tools.js").updateTokenSystem;
    reloadOneWeapon: typeof import("../interactive/deployables.js").reloadOneWeapon;
    rechargeSystem: typeof import("../interactive/deployables.js").rechargeSystem;
    findAura(actorOrToken: Token | any, auraName: string): object | null;  // scripts/tools/aura.js
    getTokensInAura(actorOrToken: Token | any, auraName: string): Token[] | null;  // scripts/tools/aura.js

    // Weapon & Item Details
    getActorMaxThreat: typeof import("../tools/weapon-bonus-utils.js").getActorMaxThreat;
    getMaxWeaponRanges_WithBonus: typeof import("../tools/weapon-bonus-utils.js").getMaxWeaponRanges_WithBonus;
    getMaxWeaponReach_WithBonus: typeof import("../tools/weapon-bonus-utils.js").getMaxWeaponReach_WithBonus;

    // Resource Management
    setReaction: typeof import("../tools/misc-tools.js").setReaction;
    setItemResource: typeof import("../tools/misc-tools.js").setItemResource;

    // Deployment & Thrown Weapons
    addItemFlags: typeof import("../interactive/deployables.js").addItemFlags;
    getItemFlags: typeof import("../interactive/deployables.js").getItemFlags;
    addExtraDeploymentLids(target: any, lids: string | Array<string | { lid: string; tier?: number; range?: number; count?: number }>): Promise<any>;  // scripts/interactive/deployables.js
    addExtraDeploymentActor: typeof import("../interactive/deployables.js").addExtraDeploymentActor;
    removeExtraDeploymentActor: typeof import("../interactive/deployables.js").removeExtraDeploymentActor;
    getActorDeployables: typeof import("../interactive/deployables.js").getActorDeployables;
    getExtraDeployableOpts(target: any, key: string): { range?: number; count?: number; tier?: 1 | 2 | 3 } | null;  // scripts/interactive/deployables.js
    setExtraDeployableOpts(target: any, key: string, opts: { range?: number | null; count?: number | null; tier?: 1 | 2 | 3 | null }): Promise<any>;  // scripts/interactive/deployables.js
    isPrimaryActionHidden(item: any): boolean;  // scripts/interactive/deployables.js
    setHidePrimaryAction: typeof import("../interactive/deployables.js").setHidePrimaryAction;
    consumeExtraAction(actor: any, actionName: string): Promise<boolean>;  // scripts/interactive/deployables.js
    reloadExtraAction(actor: any, actionName: string): Promise<void>;  // scripts/interactive/deployables.js
    rechargeExtraActionsForActor(actor: any): Promise<void>;  // scripts/interactive/deployables.js
    addExtraActions: typeof import("../interactive/deployables.js").addExtraActions;
    getItemActions: typeof import("../interactive/deployables.js").getItemActions;
    getActorActions: typeof import("../interactive/deployables.js").getActorActions;
    getActionOverlays: typeof import("../interactive/action-overlays.js").getActionOverlays;
    getActionOverlay: typeof import("../interactive/action-overlays.js").getActionOverlay;
    setActionOverlay: typeof import("../interactive/action-overlays.js").setActionOverlay;
    removeActionOverlay: typeof import("../interactive/action-overlays.js").removeActionOverlay;
    applyActionOverlays: typeof import("../interactive/action-overlays.js").applyActionOverlays;
    resolveGrantedActionRange: typeof import("../interactive/action-overlays.js").resolveGrantedActionRange;
    removeExtraActions: typeof import("../interactive/deployables.js").removeExtraActions;
    lockActorAction(target: any, actionName: string, sourceIdOrOpts?: string | { reason?: string }, opts?: { reason?: string }): Promise<any>;  // scripts/interactive/deployables.js
    unlockActorAction(target: any, actionName: string, sourceId?: string): Promise<any>;  // scripts/interactive/deployables.js
    isActionLocked(target: any, actionName: string): boolean;  // scripts/interactive/deployables.js
    getLockedActions(target: any): string[];  // scripts/interactive/deployables.js
    getItemDeployables: typeof import("../interactive/deployables.js").getItemDeployables;
    getAllItemDeployables(item: any): string[];  // scripts/interactive/deployables.js
    getOwnerTier(ownerActor: any, item?: any): number | null;  // scripts/interactive/deployables.js
    linkTierGate(entry: any, ownerActor: any, item?: any): boolean;  // scripts/interactive/deployables.js
    placeDeployable(options: {  // scripts/interactive/deployables.js
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
    beginDeploymentCard(options: {  // scripts/interactive/deployables.js
        actor: any;
        item: any;
        deployableOptions?: object[];
    }): Promise<any>;
    deployWeaponToken: typeof import("../interactive/deployables.js").deployWeaponToken;
    openDeployableMenu: typeof import("../interactive/deployables.js").openDeployableMenu;
    recallDeployable: typeof import("../interactive/deployables.js").recallDeployable;
    pickupWeaponToken: typeof import("../interactive/deployables.js").pickupWeaponToken;
    openThrowMenu: typeof import("../interactive/combat.js").openThrowMenu;
    beginWeaponThrowFlow(weapon: any, options?: object, extraData?: object): Promise<{ completed: boolean; flow?: any }>;  // scripts/tools/misc-tools.js
    openItemBrowser: typeof import("../bonuses/effectManager.js").openItemBrowser;
    addItemTag(item: any, tagData: { id: string; val?: any;[key: string]: any }): Promise<any>;  // scripts/tools/misc-tools.js
    removeItemTag: typeof import("../tools/misc-tools.js").removeItemTag;

    // AurasAPI
    createAura(owner: Token | TokenDocument | Item | any, auraConfig: object): Promise<any>;  // scripts/tools/aura.js
    ensureAura(owner: Token | TokenDocument | Item | Actor | any, auraConfig: object): Promise<any | null>;  // scripts/tools/aura.js
    deleteAuras(owner: Token | any, filter: string | object, options?: object): Promise<void>;  // scripts/tools/aura.js

    // ScanAPI

    // TerrainAPI

    // DowntimeAPI
    executeDowntime(): Promise<void>;  // scripts/tools/downtime.js

    // Main helpers
    handleTrigger(triggerType: TriggerType, data: object): Promise<void>;  // scripts/activations/reactions-engine.js
    getMovementHistory(token: Token | string): MovementHistoryResult | { exists: false };  // scripts/movement/move-tracking.js
    getCumulativeMoveData(tokenOrId: Token | string): MoveSummary;  // scripts/movement/move-tracking.js
    getIntentionalMoveData(tokenOrId: Token | string): MoveSummary;  // scripts/movement/move-tracking.js
    executeStatRoll(actor: any, stat: string, title: string, target?: number | Token | TokenDocument | "token", extraData?: { targetStat?: string; sendToOwner?: boolean; cardTitle?: string; cardDescription?: string;[key: string]: any }): Promise<{ completed: boolean; total?: number; roll?: any; passed?: boolean }>;  // scripts/tools/misc-tools.js
    executeSaveVsEffect(targets: Token | Token[], options: { stat: string; title: string; origin?: number | Token; effects?: any; duration?: object; note?: string; extraFlags?: object; cardTitle?: string; cardDescription?: string | ((target: Token) => string); sendToOwner?: boolean; onFail?: (target: Token, result: any) => any; onPass?: (target: Token, result: any) => any; halfDamageOnSave?: { value: number | string; type?: string; title?: string } }): Promise<Array<{ target: Token; passed: boolean; result: any }>>;  // scripts/tools/misc-tools.js
    attackWith(weapon: Item, targets?: Token | Token[] | null, options?: { reloadIfEmpty?: boolean;[key: string]: any }): Promise<{ completed: boolean; flow?: any; reloaded?: boolean }>;  // scripts/tools/misc-tools.js
    getTier: typeof import("../tools/misc-tools.js").getTier;
    tierValue: typeof import("../tools/misc-tools.js").tierValue;
    getFlowFlag: typeof import("../tools/misc-tools.js").getFlowFlag;
    setFlowFlag: typeof import("../tools/misc-tools.js").setFlowFlag;
    consumeOncePerRound: typeof import("../tools/misc-tools.js").consumeOncePerRound;
    consumeOncePerTurn: typeof import("../tools/misc-tools.js").consumeOncePerTurn;
    consumeGate(owner: Token | Actor | any, key: string, options?: { subject?: Token | Actor | string | null; rounds?: number | null; turn?: boolean }): Promise<boolean>;  // scripts/tools/misc-tools.js
    checkGate: typeof import("../tools/misc-tools.js").checkGate;
    clearGate: typeof import("../tools/misc-tools.js").clearGate;

    executeDamageRoll(  // scripts/tools/misc-tools.js
        attacker: Token | TokenDocument | any,
        targets: Array<Token | TokenDocument> | null,
        damageValue?: string | number | null,
        damageType?: string | null,
        title?: string,
        options?: {
            tags?: any[];
            hit_results?: any[];
            has_normal_hit?: boolean;
            has_crit_hit?: boolean;
            ap?: boolean;
            paracausal?: boolean;
            half_damage?: boolean;
            overkill?: boolean;
            reliable?: boolean;
            add_burn?: boolean;
            invade?: boolean;
            bonus_damage?: any[];
            [key: string]: any;
        },
        extraData?: {
            flow_bonus?: any[];
            [key: string]: any;
        }
    ): Promise<{ completed: boolean; flow?: any }>;

    // ExtraBarsAPI
    /**
     * Update an extra-bar value. Token target: manual entry only. Item/Actor target:
     * manual templates mutate + reinject, path templates write through .update().
     */
    updateExtraBarValue(  // scripts/tah/tokenStatBar.js
        target: Token | TokenDocument | Item | Actor | string,
        entryId: string,
        value: number | string,
    ): Promise<number | null>;
    /**
     * Create an extra bar. Token target writes to statBarExtras (returns entry id).
     * Item/Actor target writes to extraBarTemplates + auto-injects (returns template id).
     */
    addExtraBar(  // scripts/tah/tokenStatBar.js
        target: Token | TokenDocument | Item | Actor | string,
        partial?: object,
    ): Promise<string | null>;
    /**
     * Remove an entry (Token) or template (Item/Actor) by id.
     */
    removeExtraBar(  // scripts/tah/tokenStatBar.js
        target: Token | TokenDocument | Item | Actor | string,
        entryId: string,
    ): Promise<boolean>;
    /**
     * List extra bars on a target. Token → statBarExtras entries. Item/Actor → template records [{ id, entry }].
     */
    getExtraBars: typeof import("../tah/tokenStatBar.js").getExtraBars;

    // ExtraConfigAPI
    setItemAutoConsumeDisabled(  // scripts/interactive/extra-config.js
        item: Item,
        type: 'uses' | 'loading' | 'charged' | 'perTurn' | 'perRound' | 'reserveUsed',
        disabled: boolean,
    ): Promise<string[]>;
    setItemAutoConsumeDisabledAll: typeof import("../interactive/extra-config.js").setItemAutoConsumeDisabledAll;
    isAutoConsumeDisabled: typeof import("../interactive/extra-config.js").isAutoConsumeDisabled;
    getAutoConsumeDisabled: typeof import("../interactive/extra-config.js").getAutoConsumeDisabled;
    getSubAutoConsumeDisabled: typeof import("../interactive/extra-config.js").getSubAutoConsumeDisabled;
    setSubAutoConsumeDisabled: typeof import("../interactive/extra-config.js").setSubAutoConsumeDisabled;
    getConsumeOn: typeof import("../interactive/extra-config.js").getConsumeOn;
    setConsumeOn: typeof import("../interactive/extra-config.js").setConsumeOn;
    consumeItemResource(  // scripts/interactive/extra-config.js
        item: Item,
        type: 'uses' | 'loading' | 'charged' | 'perTurn' | 'perRound' | 'reserveUsed',
        amount?: number,
    ): Promise<number | boolean | null>;
    rechargeItemResource(  // scripts/interactive/extra-config.js
        item: Item,
        type: 'uses' | 'loading' | 'charged' | 'perTurn' | 'perRound' | 'reserveUsed',
        amount?: number,
    ): Promise<number | boolean | null>;
    configureItemExtraConfig: typeof import("../interactive/extra-config.js").configureItemExtraConfig;
    getExtraConfig: typeof import("../interactive/extra-config.js").getExtraConfig;

    // Public API

    // Overwatch / engagement (sync)
    canEngage: typeof import("../combat/overwatch.js").canEngage;
    canProvokeReaction: typeof import("../combat/overwatch.js").canProvokeReaction;
    checkOverwatchCondition(reactor: Token, mover: Token, startPos: { x: number; y: number }): boolean;  // scripts/combat/overwatch.js
    updateAllEngagements: typeof import("../combat/overwatch.js").updateAllEngagements;

    // Movement cap (sync). Derived from the granted bands, never below what is already spent.
    getMovementCap(tokenOrId: Token | TokenDocument | string): number;  // scripts/movement/move-tracking.js
    /** Ordered movement legs for this turn. `granted` legs are paid for; the rest are previews. */
    getMovementBands(tokenOrId: Token | TokenDocument | string): Array<{ name: string; size: number; max: number; granted: boolean }>;  // scripts/movement/move-tracking.js
    /** Speed after prone halving. Prefer this over reading `actor.system.speed`. */
    tokenSpeed(tokenOrActor: Token | TokenDocument | Actor): number;  // scripts/movement/move-tracking.js
    /** Add spaces to one leg. `current` picks the granted leg the spent distance sits in. */
    recordMovementExtra(tokenOrId: Token | TokenDocument | string, value: number, options?: { leg?: 'standard' | 'boost' | 'current' }): void;  // scripts/movement/move-tracking.js
    recordBoostCast(tokenOrId: Token | TokenDocument | string, speed: number): void;  // scripts/movement/move-tracking.js
    initMovementCap(token: Token | TokenDocument | string): void;  // scripts/movement/move-tracking.js
    undoMoveData(tokenOrId: Token | TokenDocument | string, distance?: number): void;  // scripts/movement/move-tracking.js

    // Action / flow execution
    executeBarrage: typeof import("../tools/misc-tools.js").executeBarrage;
    executeInvade(actorOrToken: any, bypassChoice?: any): Promise<void>;  // scripts/interactive/combat.js (+1)
    executeItemActivation(item: any, options?: { path?: string; flowName?: string }, extraData?: object): Promise<{ completed: boolean; flow?: any }>;  // scripts/tools/misc-tools.js
    executeReactorExplosion: typeof import("../tools/misc-tools.js").executeReactorExplosion;
    executeReactorMeltdown: typeof import("../tools/misc-tools.js").executeReactorMeltdown;
    executeRest: typeof import("../tools/rest.js").executeRest;
    executeFall: typeof import("../tools/movement-tools.js").executeFall;
    executeStandingUp: typeof import("../tools/movement-tools.js").executeStandingUp;
    executeTeleport: typeof import("../tools/movement-tools.js").executeTeleport;
    executeContestedCheck(input1: any, stat1: string, input2: any, stat2: string, options?: { title?: string; sendToOwner?: boolean }): Promise<{ winner: any; loser: any;[key: string]: any }>;  // scripts/tools/misc-tools.js
    executeForceCheck(skill: string, targets?: Token[] | null, options?: { saveVs?: any; sendToOwner?: boolean; title?: string }): Promise<{ completed: boolean; results: any[] }>;  // scripts/tools/misc-tools.js
    openForceCheckCard(preset?: { tokenA?: Token | null; skill?: string | null; range?: number | Array<{ type: string; val: number }> | null; saveVs?: any; targets?: Token[] | null; sendToOwner?: boolean }): Promise<any>;  // scripts/interactive/tools/forceCheck.js
    executeGenericBonusMenu: typeof import("../bonuses/genericBonuses.js").executeGenericBonusMenu;
    executeDowntime(): Promise<void>;  // scripts/tools/downtime.js

    // Scan
    executeGenerateScan: typeof import("../tools/scan.js").executeGenerateScan;
    executeScanOnActivation: typeof import("../tools/scan.js").executeScanOnActivation;
    regenerateScans(opts?: object): Promise<{ updated: string[]; missing: string[]; skipped: string[] }>;  // scripts/tools/scan.js

    // Pilot reserves
    openAddReserveDialog: typeof import("../tools/pilot-reserves.js").openAddReserveDialog;

    // Throw flow
    beginWeaponThrowFlow(weapon: any, options: object, extraData?: object): Promise<{ completed: boolean; flow?: object }>;  // scripts/tools/misc-tools.js

    // Item queries (sync unless noted)
    getItemType: typeof import("../tools/misc-tools.js").getItemType;
    getWeaponType: typeof import("../tools/misc-tools.js").getWeaponType;
    getWeaponProfiles_WithBonus: typeof import("../tools/weapon-bonus-utils.js").getWeaponProfiles_WithBonus;
    getMaxItemRanges_WithBonus: typeof import("../tools/weapon-bonus-utils.js").getMaxItemRanges_WithBonus;
    getItemTags_WithBonus: typeof import("../tools/weapon-bonus-utils.js").getItemTags_WithBonus;
    getSensorRange_WithBonus: typeof import("../tools/weapon-bonus-utils.js").getSensorRange_WithBonus;
    hasTag: typeof import("../tools/misc-tools.js").hasTag;
    debugActivation: typeof import("../tools/misc-tools.js").debugActivation;
    isItemDisabled(item: any): boolean;  // scripts/setup/lancer-modif.js
    isDisableable(item: any): boolean;  // scripts/setup/lancer-modif.js
    setItemDisabled(item: any, disabled: boolean): Promise<any>;  // scripts/setup/lancer-modif.js
    getActivationIcon: typeof import("../tools/misc-tools.js").getActivationIcon;

    // Bonus injection
    injectBonusToFlowState: typeof import("../bonuses/genericBonuses.js").injectBonusToFlowState;

    [key: string]: any;
}



// ReactionConfig

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
    /** Fires when the reactor is one of the event's targets, even with triggerOther off. Target-capable triggers only. */
    triggerTarget?: boolean;
    outOfCombat?: boolean;
    isReaction?: boolean;
    checkReaction?: boolean;
    enabled?: boolean;
    onlyOnSourceMatch?: boolean;
    autoActivate?: boolean;
    awaitActivationCompletion?: boolean;
    actionType?: string;
    frequency?: string;
    activationType?: "code" | "macro" | "flow" | "none";
    activationMode?: "instead" | "after";
    /** General only. Evaluate once as the active scene on the GM client. "add" keeps the per-token passes, "only" replaces them. */
    sceneReactor?: "off" | "add" | "only";
    /** General only. Limit the activation to this scene id, empty for every scene. */
    sceneId?: string;
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

// Module augmentation

interface Module {
    api?: LancerAutomationsAPI;
}

// Effect Flags

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
