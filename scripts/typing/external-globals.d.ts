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
    constructor(options?: string | { moduleName?: string; softFail?: boolean }, softFail?: boolean);
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

// Module registry, flags and Lancer system data live in fvtt-config.d.ts.
// They only take effect through `declare module "fvtt-types/configuration"`.

// ─── CodeMirror ───────────────────────────────────────────────────────────────
declare const CodeMirror: any;

// ─── libWrapper ───────────────────────────────────────────────────────────────
declare const libWrapper: any;

// ─── Application augmentation ────────────────────────────────────────────────
interface Application {
    _needsReload?: boolean;
}

// Actor / Item / Token belong in fvtt-config.d.ts. A bare global interface replaces the
// fvtt-types class rather than merging, stripping every core member project-wide.

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
    /** Stamped on the effect. Saved statuses resolve theirs from CONFIG instead, leave this unset for those. */
    description?: string;
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

// ─── DiceTerm (foundry-vtt-types omits results on the base RollTerm) ─────────
declare class DiceTerm extends RollTerm {
    results: { result: number; active: boolean; discarded: boolean; hidden?: boolean }[];
}

// ─── Startup script globals ───────────────────────────────────────────────────
declare const api: LancerAutomationsAPI;
