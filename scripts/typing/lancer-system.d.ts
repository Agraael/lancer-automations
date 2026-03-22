/**
 * Minimal Lancer actor system type declarations.
 */

interface LancerActorSystem {
    // ─── Common properties ───────────────────────────────────────────────────
    activations: number;
    agi: number;
    armor: number;
    bonuses: { flat: object; weapon_bonuses: any[] };
    burn: number;
    custom_counters: any[];
    edef: number;
    eng: number;
    evasion: number;
    grit?: number;
    hp: { min: number; max: number; value: number };
    hull: number;
    inherited_effects: any;
    lid: string;
    overshield: { min: number; max: number; value: number };
    resistances: { burn: boolean; energy: boolean; explosive: boolean; heat: boolean; kinetic: boolean; variable: boolean };
    save: number;
    sensor_range: number;
    size: number;
    speed: number;
    statuses: {
        dangerzone: boolean;
        downandout: boolean;
        engaged: boolean;
        exposed: boolean;
        hidden: boolean;
        immobilized: boolean;
        impaired: boolean;
        invisible: boolean;
        jammed: boolean;
        lockon: boolean;
        prone: boolean;
        shredded: boolean;
        shutdown: boolean;
        slowed: boolean;
        stunned: boolean;
    };
    sys: number;
    tech_attack: number;
    action_tracker: { protocol: boolean; move: number; full: boolean; quick: boolean; reaction: boolean | number };

    // ─── NPC / Mech / Deployable / Pilot specific (optional) ───────────────
    tier?: number;
    level?: number;
    heat?: { min: number; max: number; value: number };
    stress?: { min: number; max: number; value: number };
    structure?: { min: number; max: number; value: number };
    repairs?: { min: number; max: number; value: number };
    core_active?: boolean;
    core_energy?: number;
    overcharge?: number;
    overcharge_sequence?: string;
    meltdown_timer?: number | null;
    loadout?: LancerLoadout;
    pilot?: any;
    notes?: string;
    stress_repair_cost?: number;
    structure_repair_cost?: number;
    destroyed?: boolean;
    disabled?: boolean;
    class?: any;
    templates?: any[];
    actions?: LancerAction[];
    activation?: string;
    deactivation?: string | null;
    recall?: string | null;
    redeploy?: string | null;
    avail_mounted?: boolean;
    avail_unmounted?: boolean;
    cost?: number;
    counters?: any[];
    deployer?: any | null;
    detail?: string;
    hp_bonus?: number;
    instances?: number;
    owner?: any;
    stats?: any;
    synergies?: any[];
    tags?: any[];
    type?: string;
    active_mech?: any;
    background?: string;
    bond?: any | null;
    bond_state?: any;
    callsign?: string;
    cloud_id?: string;
    history?: string;
    last_cloud_update?: string;
    mounted?: boolean;
    player_name?: string;
    status?: string;
    text_appearance?: string;

    [key: string]: any;
}

interface LancerLoadout {
    ai_cap: { max: number; min: number; value: number };
    frame: { id: string; status: string; value: any };
    limited_bonus: number;
    sp: { max: number; min: number; value: number };
    systems: any[];
    weapon_mounts: LancerWeaponMount[];
}

interface LancerWeaponMount {
    bracing: boolean;
    slots: LancerMountSlot[];
    type: string;
}

interface LancerMountSlot {
    weapon: { id: string; status: string; value: any } | null;
    mod: { id: string; status: string; value: any } | null;
    size: string;
}

/**
 * Lancer action object — mirrors the ACTION() factory in the Lancer system.
 * Used in system.actions[] arrays on mech_system, mech_weapon, npc_feature, etc.
 */
interface LancerAction {
    name:               string;   // required
    activation:         string;   // required — "Quick" | "Full" | "Protocol" | "Reaction" | "Free" | "Quick Tech" | "Full Tech" | "Invade" | ...
    detail?:            string;   // HTML effect text
    lid?:               string;
    cost?:              number;
    heat_cost?:         number;
    frequency?:         string | null;
    init?:              string;
    trigger?:           string;
    terse?:             string;
    tech_attack?:       boolean;
    damage?:            { val: string; type: string }[];
    range?:             { val: string; type: string }[];
    mech?:              boolean;
    pilot?:             boolean;
    synergy_locations?: string[];
}

/**
 * Minimal Lancer item system type declarations.
 */
interface LancerItemSystem {
    // ─── Universal ───────────────────────────────────────────────────────────
    lid: string;
    equipped?: boolean;
    destroyed?: boolean;

    // ─── Text / display ──────────────────────────────────────────────────────
    description?: string;
    effect?: string;
    flavor?: string;
    tactics?: string;
    detail?: string;

    // ─── Tags / synergies / actions ──────────────────────────────────────────
    tags?: any[];
    synergies?: any[];
    actions?: LancerAction[];
    counters?: any[];
    bonuses?: any[];

    // ─── NPC class (npc_class) ───────────────────────────────────────────────
    role?: string;
    base_features?: Set<string> | string[];
    optional_features?: Set<string> | string[];
    base_stats?: any[];

    // ─── NPC feature / weapon / system (npc_feature) ─────────────────────────
    type?: string;
    activation?: string;
    recharge?: number | null;
    charged?: boolean;
    uses?: { min: number; max: number; value: number };
    accuracy?: number;
    attack_bonus?: number;
    range?: any[];
    damage?: any[];
    on_hit?: string;
    on_crit?: string;

    // ─── Pilot / mech gear ───────────────────────────────────────────────────
    license?: string;
    license_level?: number;
    cost?: number;
    limited?: number;
    pilot?: boolean;

    [key: string]: any;
}