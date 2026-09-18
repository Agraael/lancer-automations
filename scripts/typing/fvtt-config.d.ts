/**
 * fvtt-types configuration.
 *
 * These interfaces MUST be merged through `declare module "fvtt-types/configuration"`.
 * A bare global `interface Foo` does not merge with fvtt-types, it replaces it, which
 * silently strips every core member from the type.
 */

export {};

declare module "fvtt-types/configuration"
{
    // ─── game.modules.get('lancer-automations').api ───────────────────────────
    interface ModuleConfig
    {
        "lancer-automations": {
            api: LancerAutomationsAPI;
        };
    }

    interface RequiredModules
    {
        "lancer-automations": true;
    }

    // Optional integrations reached through game.modules.get(...).api.
    interface ModuleConfig
    {
        "temporary-custom-statuses": { api: any };
        "templatemacro": { api: any };
    }

    // Hooks this module emits, plus the Lancer system and third-party hooks it listens to.
    namespace Hooks
    {
        interface HookConfig
        {
            [key: `lancer-automations.${string}`]: (...args: any[]) => any;
            [key: `lancer.preFlow.${string}`]: (...args: any[]) => any;
            [key: `lancer.postFlow.${string}`]: (...args: any[]) => any;
            "lancer.registerFlows": (...args: any[]) => any;
            "lancer.statusesReady": (...args: any[]) => any;
            "terrain-height-tools.updateTerrain": (...args: any[]) => any;
            forceUpdateTokenActionHud: (...args: any[]) => any;
            modifyPlannedMovement: (...args: any[]) => any;
            recordToken: (...args: any[]) => any;
            createSequencerEffect: (...args: any[]) => any;
            preCreateSequencerEffect: (...args: any[]) => any;
            endedSequencerEffect: (...args: any[]) => any;
        }
    }

    // ─── Document flags ───────────────────────────────────────────────────────
    interface FlagConfig
    {
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
        TokenDocument: {
            "lancer-automations": {
                fallStartElevation?: number;
                moveHistory?: MoveHistoryData;
                movementCap?: number;
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

    // ─── Lancer system data models ────────────────────────────────────────────
    // Subtypes come from systems/lancer/system.json documentTypes.
    interface DataConfig
    {
        Actor: {
            npc: LancerActorSystem;
            pilot: LancerActorSystem;
            mech: LancerActorSystem;
            deployable: LancerActorSystem;
        };
        Item: {
            core_bonus: LancerItemSystem;
            frame: LancerItemSystem;
            license: LancerItemSystem;
            npc_class: LancerItemSystem;
            npc_template: LancerItemSystem;
            npc_feature: LancerItemSystem;
            weapon_mod: LancerItemSystem;
            mech_system: LancerItemSystem;
            mech_weapon: LancerItemSystem;
            organization: LancerItemSystem;
            pilot_armor: LancerItemSystem;
            pilot_gear: LancerItemSystem;
            pilot_weapon: LancerItemSystem;
            reserve: LancerItemSystem;
            status: LancerItemSystem;
            talent: LancerItemSystem;
            skill: LancerItemSystem;
            bond: LancerItemSystem;
        };
    }

    interface SourceConfig
    {
        Actor: DataConfig["Actor"];
        Item: DataConfig["Item"];
    }

    // Lancer owns every subtype in play, so the "base" and module-subtype branches only
    // widen `.system` into an unusable union here.
    interface SystemConfig
    {
        Actor: {
            base: "ignore";
            moduleSubtype: "ignore";
        };
        Item: {
            base: "ignore";
            moduleSubtype: "ignore";
        };
    }

    // Value types are not declared per key yet, so reads stay as loose as they are today.
    interface SettingConfig
    {
        [key: `lancer-automations.${string}`]: any;
        [key: `lancer.${string}`]: any;
        [key: `csm-lancer-qol.${string}`]: any;
        [key: `token-factions.${string}`]: any;
        [key: `temporary-custom-statuses.${string}`]: any;
        [key: `player-groups.${string}`]: any;
        [key: `force-client-settings.${string}`]: any;
        [key: `templatemacro.${string}`]: any;
        [key: `isometric-perspective.${string}`]: any;
        [key: `terrain-height-tools.${string}`]: any;
    }

    // Everything in this module runs at or after ready, so the pre-ready game unions
    // are noise here.
    interface AssumeHookRan
    {
        ready: never;
    }

    namespace foundry
    {
        interface Game
        {
            lancer?: LancerSystemAPI;
        }
    }

    // Members the Lancer system adds to the document and placeable classes.
    namespace foundry.documents
    {
        interface Actor
        {
            is_mech(): boolean;
            is_npc(): boolean;
            is_pilot(): boolean;
            is_deployable(): boolean;
        }

        interface Item
        {
            is_npc_class(): boolean;
            is_npc_feature(): boolean;
            is_npc_template(): boolean;
        }
    }

    namespace foundry.canvas.placeables
    {
        interface Token
        {
            effects: PIXI.Container & { bg?: any;[key: string]: any };
            _movement: { points: number[];[key: string]: any } | null;
            // Wall Height adds this getter
            losHeight?: number;
        }
    }
}
