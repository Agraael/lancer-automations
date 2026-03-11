/**
 * Declarations for optional/external modules and global type augmentations.
 */

// ─── Sequencer Module ─────────────────────────────────────────────────────────

interface Window {
    Sequencer: typeof Sequencer;
    Sequence: typeof Sequence;
}



interface SequencerSection {
    file(path: string): this;
    attachTo(target: object): this;
    size(size: number | { width: number; height: number }): this;
    persist(value?: boolean): this;
    origin(id: string): this;
    scaleToObject(factor?: number): this;
    duration(ms: number): this;
    fadeIn(ms: number): this;
    fadeOut(ms: number): this;
    opacity(value: number): this;
    play(): Promise<void>;
    [key: string]: any;
}

declare class Sequence {
    effect(): SequencerSection;
    sound(): SequencerSection;
    play(): Promise<void>;
    [key: string]: any;
}

declare namespace Sequencer {
    const EffectManager: {
        endEffects(options: { origin?: string; name?: string; object?: object }): Promise<void>;
        getEffects(options?: object): object[];
    };
    const Preloader: {
        preload(files: string[]): Promise<void>;
        preloadForClients(files: string[]): Promise<void>;
    };
}

// ─── Foundry FlagConfig augmentation ─────────────────────────────────────────
interface FlagConfig {
    Actor: {
        "lancer-automations": {
            constant_bonuses?: any[];
            global_bonuses?: any[];
            ephemeral_bonuses?: any[];
            smokeTemplates?: string[];
            [key: string]: any;
        };
        "token-factions"?: {
            team?: any;
            [key: string]: any;
        };
        [key: string]: any;
    };
    ActiveEffect: {
        "lancer-automations": LancerEffectFlags;
        [key: string]: any;
    };
    Token: {
        "lancer-automations": {
            fallStartElevation?: number;
            [key: string]: any;
        };
        "token-factions"?: {
            team?: any;
            [key: string]: any;
        };
        [key: string]: any;
    };
    Item: {
        "lancer-automations": {
            [key: string]: any;
        };
        [key: string]: any;
    };
    Combat: {
        "lancer-automations": {
            delayedAppearances?: any[];
            [key: string]: any;
        };
        [key: string]: any;
    };
}

// ─── CodeMirror ───────────────────────────────────────────────────────────────
declare const CodeMirror: any;

// ─── Combatant / Combat augmentation ─────────────────────────────────────────
interface Combatant {
    token: TokenDocument | null;
    actor: Actor | null;
    [key: string]: any;
}

interface Combat {
    combatants: Collection<Combatant>;
    [key: string]: any;
}

// ─── ActiveEffect augmentation ───────────────────────────────────────────────
interface ActiveEffect {
    name: string;
    statuses: Set<string>;
    flags: any;
    img?: string;
    icon?: string;
    [key: string]: any;
}

// ─── libWrapper ───────────────────────────────────────────────────────────────
declare const libWrapper: any;

// ─── Application augmentation ────────────────────────────────────────────────
interface Application {
    _needsReload?: boolean;
}

interface Item {
    sheet?: any;
    name?: string;
    type?: string;
}

interface Actor {
    sheet?: any;
}

interface Token {
    elevationruler?: { measurementHistory?: any[];[key: string]: any };
    _movement?: { points: number[];[key: string]: any } | null;
    effects?: PIXI.Container & { bg?: any;[key: string]: any };
}

// ─── Lancer document system augmentation ─────────────────────────────────────
interface Actor {
    name: string;
    type: string;
    system: LancerActorSystem;
    prototypeToken: any;
    flags: any;
    is_mech?(): boolean;
    is_npc?(): boolean;
    is_pilot?(): boolean;
    is_deployable?(): boolean;
}

interface Item {
    type: string;
    system: LancerItemSystem;
}

// ─── Lancer system (game.lancer) ──────────────────────────────────────────────

interface LancerWeaponRangeTemplate {
    fromRange(range: { type: string; val: number }): { placeTemplate(): Promise<any> };
}

interface LancerSystemAPI {
    flows: Map<string, any>;
    canvas: {
        WeaponRangeTemplate: LancerWeaponRangeTemplate;
    };
    targetsFromTemplate(templateId: string): Promise<Token[]>;
    [key: string]: any;
}

interface Game {
    lancer?: LancerSystemAPI;
    settings: any;
}

// ─── CONFIG.lancer / CONFIG.GeometryLib augmentation ─────────────────────────
interface CONFIG {
    lancer?: {
        flowClasses?: {
            WeaponAttackFlow?: any;
            [key: string]: any;
        };
        [key: string]: any;
    };
    GeometryLib?: {
        utils: {
            gridUnitsToPixels(units: number): number;
            pixelsToGridUnits(pixels: number): number;
            [key: string]: any;
        };
        [key: string]: any;
    };
}

// ─── CompendiumCollection.getIndex augmentation ───────────────────────────────
interface CompendiumCollection<Metadata extends CompendiumCollection.Metadata = CompendiumCollection.Metadata> {
    getIndex(options?: { fields?: string[] }): Promise<Collection<any>>;
}

// ─── grid-aware-auras canvas layer ───────────────────────────────────────────
interface Canvas {
    gaaAuraLayer?: any;
    lancerDebugPath?: any;
}

// ─── MeasurementSegment augmentation ─────────────────────────────────────────
declare namespace Ruler {
    interface MeasurementSegment {
        _calculatedPath?: { i: number; j: number }[];
    }
}

// ─── EffectDescriptorInput (flagged-effects.js) ──────────────────────────────
interface EffectDescriptorInput {
    name?: string;
    icon?: string;
    isCustom?: boolean;
    [key: string]: any;
}

// ─── SetEffectOptions (flagged-effects.js) ───────────────────────────────────
interface SetEffectOptions {
    consumption?: { grouped?: boolean; groupId?: string;[key: string]: any };
    linkedBonusId?: string;
    stack?: number;
    allowStack?: boolean;
    forceNew?: boolean;
    grouped?: boolean;
    groupId?: string;
    changes?: any[];
    [key: string]: any;
}

// ─── PathHex types (grid-helpers.js) ─────────────────────────────────────────
interface PathHexStep {
    x: number;
    y: number;
    cx: number;
    cy: number;
    hexes: { x: number; y: number }[];
    isHistory: boolean;
}

type PathHexArray = PathHexStep[] & {
    historyStartIndex: number;
    getPathPositionAt: (index: number) => { x: number; y: number } | null;
};

// ─── fromUuid override ────────────────────────────────────────────────────────
declare function fromUuid(uuid: string): Promise<any>;
declare function fromUuidSync(uuid: string): any;

// ─── Startup script globals ───────────────────────────────────────────────────
declare const api: LancerAutomationsAPI;
