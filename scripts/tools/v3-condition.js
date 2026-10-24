const STATUS_ALIASES = { slowed: 'slow', lock_on: 'lockon', 'lock on': 'lockon', danger_zone: 'dangerzone', down_and_out: 'downandout', shut_down: 'shutdown' };
const ALL_TYPES = ['mech', 'pilot', 'npc'];

function systemValue(path)
{
    return actor => path.split('.').reduce((node, key) => node?.[key], actor?.system);
}

function pilotOf(actor)
{
    const ref = actor?.system?.pilot;
    if (ref?.value?.system)
        return ref.value;
    const id = typeof ref === 'string' ? ref : ref?.id;
    if (!id)
        return null;
    return id.startsWith('Actor.') ? fromUuidSync(id) : game.actors?.get(id);
}

const SPECIAL_VALUES = {
    ll: { types: ['mech', 'pilot'], read: actor => (actor.type === 'mech' ? pilotOf(actor) : actor)?.system?.level },
    grit: { types: ['mech', 'pilot'], read: systemValue('grit') },
    tier: { types: ['npc'], read: systemValue('tier') },
    hull: { types: ALL_TYPES, read: systemValue('hull') },
    agi: { types: ALL_TYPES, read: systemValue('agi') },
    sys: { types: ALL_TYPES, read: systemValue('sys') },
    eng: { types: ALL_TYPES, read: systemValue('eng') },
    size: { types: ['mech', 'npc'], read: systemValue('size') },
    hp: { types: ALL_TYPES, read: systemValue('hp.max') },
    armor: { types: ['mech', 'pilot'], read: systemValue('armor') },
    speed: { types: ALL_TYPES, read: systemValue('speed') },
    evasion: { types: ALL_TYPES, read: systemValue('evasion') },
    edef: { types: ALL_TYPES, read: systemValue('edef') },
    heatcap: { types: ['mech', 'npc'], read: systemValue('heat.max') },
    sensors: { types: ['mech', 'npc'], read: systemValue('sensor_range') },
    save: { types: ['mech', 'npc'], read: systemValue('save') },
    structure: { types: ['mech'], read: systemValue('structure.max') },
    stress: { types: ['mech'], read: systemValue('stress.max') },
    repcap: { types: ['mech'], read: systemValue('repairs.max') },
    sp: { types: ['mech'], read: systemValue('loadout.sp.max') },
    overshield: { types: ['mech'], read: systemValue('overshield.value') }
};

const SPECIAL_LABELS = { ll: 'License Level', grit: 'Grit', tier: 'Tier', hull: 'Hull', agi: 'Agility', sys: 'Systems', eng: 'Engineering', size: 'Size', hp: 'Max HP', armor: 'Armor', speed: 'Speed', evasion: 'Evasion', edef: 'E-Defense', heatcap: 'Heat Cap', sensors: 'Sensors', save: 'Save Target', structure: 'Structure', stress: 'Stress', repcap: 'Repair Cap', sp: 'SP', overshield: 'Overshield' };

export function v3ConditionLabel(expression)
{
    return String(expression ?? '').replace(/\{([^{}]+)\}/g, (_match, name) =>
    {
        const key = name.trim().toLowerCase();
        if (SPECIAL_LABELS[key])
            return SPECIAL_LABELS[key];
        const status = CONFIG.statusEffects?.find(effect => effect.id === normalizeV3StatusId(key));
        return status?.name ? game.i18n.localize(status.name) : name.trim();
    }).trim();
}

export function normalizeV3StatusId(id)
{
    const key = String(id ?? '').trim().toLowerCase();
    return STATUS_ALIASES[key] ?? key;
}

function tokenValue(name, actor)
{
    const key = name.trim().toLowerCase();
    const special = SPECIAL_VALUES[key];
    if (special)
    {
        const value = special.types.includes(actor?.type) ? Number(special.read(actor)) : Number.NaN;
        return Number.isFinite(value) ? `(${value})` : '';
    }
    return actor?.statuses?.has(normalizeV3StatusId(key)) ? '(1)' : '(0)';
}

function parseArithmetic(source)
{
    const tokens = source.match(/\d+(?:\.\d+)?|[-+*/()]|\S/g) ?? [];
    let position = 0;
    const peek = () => tokens[position];
    const next = () => tokens[position++];
    const primary = () =>
    {
        const token = next();
        if (token === '(')
        {
            const value = sum();
            if (next() !== ')')
                throw new Error('unclosed parenthesis');
            return value;
        }
        if (token === '-')
            return -primary();
        if (token === '+')
            return primary();
        if (token !== undefined && /^\d/.test(token))
            return Number(token);
        throw new Error(`unexpected token ${token}`);
    };
    const product = () =>
    {
        let value = primary();
        while (peek() === '*' || peek() === '/')
            value = next() === '*' ? value * primary() : value / primary();
        return value;
    };
    const sum = () =>
    {
        let value = product();
        while (peek() === '+' || peek() === '-')
            value = next() === '+' ? value + product() : value - product();
        return value;
    };
    const result = sum();
    if (position < tokens.length)
        throw new Error(`unexpected token ${tokens[position]}`);
    return result;
}

export function evaluateV3Expression(expression, actor)
{
    if (typeof expression === 'number')
        return Number.isFinite(expression) ? Math.ceil(expression) : 0;
    const source = String(expression ?? '').replace(/\{([^{}]+)\}/g, (_match, name) => tokenValue(name, actor));
    try
    {
        const value = Math.ceil(parseArithmetic(source));
        return Number.isFinite(value) ? value : 0;
    }
    catch
    {
        return 0;
    }
}

export function v3ConditionMet(condition, actor)
{
    if (condition === undefined || condition === null || condition === '')
        return true;
    return evaluateV3Expression(condition, actor) !== 0;
}
