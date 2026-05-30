/* global game, Sequencer, Sequence */

// Free-user JB2A fallbacks. Only assets that need a substitution are listed.
// Anything not here goes through Sequencer.Database; if even that can't find
// it we fall back to the placeholder image and warn once.
const JB2A_FALLBACKS = {
    'jb2a.ui.heartbeat.01.red':    { src: 'jb2a.ui.heartbeat.01.green', tint: 0xff3030 },
    'jb2a.ui.heartbeat.01.blue':   { src: 'jb2a.ui.heartbeat.01.green', tint: 0x4a9eff },
    'jb2a.ui.heartbeat.01.purple': { src: 'jb2a.ui.heartbeat.01.green', tint: 0xa040ff },
    'jb2a.ui.heartbeat.01.yellow': { src: 'jb2a.ui.heartbeat.01.green', tint: 0xffcc33 },

    'jb2a.ui.critical.yellow': { src: 'jb2a.ui.critical.red.0' },
    'jb2a.ui.miss.red':        { src: 'jb2a.ui.miss.white' },

    'jb2a.zoning.directional.once.redyellow.line200.01': { src: 'jb2a.zoning.directional.once.bluegreen.line200.02', tint: 0xffcc33 },
    'jb2a.zoning.inward.square.once.redyellow.01.01':    { src: 'jb2a.zoning.inward.circle.once.bluegreen.01.01', tint: 0xffcc33 },

    'jb2a.markers_scifi.001.complete.003.white': { src: 'jb2a.markers_scifi.001.complete.001.white' },
    'jb2a.energy_strands.in.yellow':             { src: 'jb2a.energy_strands.in.green', tint: 0xffcc33 },
    'jb2a.on_token_buff.002.002.orangeyellow':   { src: 'jb2a.on_token_buff.001.001.blue', tint: 0xff9930 },
    'jb2a.static_electricity.01.yellow':         { src: 'jb2a.static_electricity.01.blue', tint: 0xffcc33 },
    'jb2a.static_electricity.03':                { src: 'jb2a.static_electricity.03.blue' },
    'jb2a.static_electricity.03.blue02':         { src: 'jb2a.static_electricity.03.blue', tint: 0x2040c0 },
    'jb2a.static_electricity.03.green02':        { src: 'jb2a.static_electricity.03.blue', tint: 0x208030 },
    'jb2a.static_electricity.03.dark_red':       { src: 'jb2a.static_electricity.03.blue', tint: 0x802020 },
    'jb2a.greatsword.throw':                     { src: 'jb2a.dagger.throw' },

    'jb2a.impact.003.yellow':  { src: 'jb2a.impact.003.blue', tint: 0xffcc33 },
    'jb2a.impact.004.orange':  { src: 'jb2a.impact.004.blue', tint: 0xff8800 },
    'jb2a.impact.005.white':   { src: 'jb2a.impact.005.orange', tint: 0xffffff },
    'jb2a.impact.007.purple':  { src: 'jb2a.impact.007.yellow', tint: 0xa040ff },
    'jb2a.impact.009.white':   { src: 'jb2a.impact.009.orange', tint: 0xffffff },
    'jb2a.impact.010.blue':    { src: 'jb2a.impact.010.orange', tint: 0xffffff },
    'jb2a.impact.012.green02': { src: 'jb2a.impact.012.blue', tint: 0x208030 },
    'jb2a.impact.boulder.02':            { src: '' },
    'jb2a.impact.earth.01.browngreen.0': { src: 'jb2a.impact_themed.ice_shard.blue', tint: 0x8b5a2b },
    'jb2a.impact.ground_crack.white.01': { src: 'jb2a.impact.ground_crack.orange.01' },

    'jb2a.template_circle.out_pulse.02.burst.greenorange': { src: 'jb2a.template_circle.out_pulse.02.burst.bluewhite', tint: 0xff8800 },

    'jb2a.markers.chain.standard.complete.02.grey': { src: 'jb2a.markers.chain.standard.complete.02.red', tint: 0x888888 },
    'jb2a.ui.success.green' : {src: ''},
    'jb2a.ui.failure.red' : {src: ''},
    'jb2a.ui.hit.blue': {src: ''},
    'jb2a.template_circle.radar.loop.800px.001.pulse.purplered': {src: 'jb2a.template_circle.radar.loop.800px.001.pulse.greenpurple', tint: 0xff3030}
};

const PLACEHOLDER = 'modules/lancer-automations/FX/Debugempty.png';

const _runtimeRegistry = new Map();
const _warnedIds = new Set();

function _hasPatreon() {
    try {
        if (game.settings.get('lancer-automations', 'debugForceJb2aFree'))
            return false;
    } catch { /* setting not registered yet */ }
    return !!game.modules.get('jb2a_patreon')?.active;
}

function _existsInDatabase(id) {
    try {
        const db = /** @type {any} */ (Sequencer)?.Database;
        if (!db)
            return false;
        if (db.entryExists?.(id) === true)
            return true;
        const entry = db.getEntry?.(id);
        if (entry === false || entry == null || entry === "")
            return false;
        return true;
    } catch {
        return false;
    }
}

/** @param {string} id */
export function resolveJb2a(id) {
    if (typeof id !== 'string' || !id.startsWith('jb2a.'))
        return { src: id };

    // Paid + present → original. Old paid installs may lack newer assets; fall through.
    if (_hasPatreon() && _existsInDatabase(id))
        return { src: id };

    const entry = JB2A_FALLBACKS[id] ?? _runtimeRegistry.get(id);
    if (entry)
        return { src: entry.src ?? id, tint: entry.tint };

    if (_existsInDatabase(id))
        return { src: id };

    if (!_warnedIds.has(id)) {
        _warnedIds.add(id);
        console.warn(`lancer-automations | JB2A asset "${id}" missing from user's library, using placeholder. Register a fallback in scripts/fx/jb2a-fallback.js`);
    }
    _runtimeRegistry.set(id, { src: PLACEHOLDER });
    return { src: PLACEHOLDER };
}

export function jb2aFile(id) {
    return resolveJb2a(id).src;
}

export function jb2aPreloadList(ids) {
    if (!Array.isArray(ids))
        return ids;
    return ids.map((id) => typeof id === 'string' && id.startsWith('jb2a.') ? jb2aFile(id) : id);
}

export function installJb2aHooks() {
    if (typeof Sequencer === 'undefined' || /** @type {any} */ (Sequencer)._laJb2aHooked)
        return;
    /** @type {any} */ (Sequencer)._laJb2aHooked = true;

    try {
        const pl = /** @type {any} */ (Sequencer.Preloader);
        if (pl?.preloadForClients) {
            const orig = pl.preloadForClients.bind(pl);
            pl.preloadForClients = function (entries, ...rest) {
                return orig(jb2aPreloadList(entries), ...rest);
            };
        }
    } catch (e) {
        console.warn('lancer-automations | failed to hook Sequencer.Preloader', e);
    }

    // Patch section .file() via prototype probed off a throwaway Sequence.
    try {
        const probe = new Sequence();
        const protos = [];
        const eff = probe.effect();
        if (eff)
            protos.push(Object.getPrototypeOf(eff));
        if (typeof probe.sound === 'function') {
            const snd = probe.sound();
            if (snd)
                protos.push(Object.getPrototypeOf(snd));
        }
        for (const proto of protos) {
            if (!proto || typeof proto.file !== 'function' || proto._laJb2aHooked)
                continue;
            proto._laJb2aHooked = true;
            const origFile = proto.file;
            proto.file = function (input, ...rest) {
                if (typeof input === 'string' && input.startsWith('jb2a.')) {
                    const r = resolveJb2a(input);
                    const ret = origFile.call(this, r.src, ...rest);
                    if (r.tint !== undefined && typeof this.tint === 'function')
                        this.tint(r.tint);
                    return ret;
                }
                return origFile.call(this, input, ...rest);
            };
        }
    } catch (e) {
        console.warn('lancer-automations | failed to hook Sequencer section .file()', e);
    }
}
