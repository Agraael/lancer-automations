/* global foundry, libWrapper */

const MODULE_ID = 'lancer-automations';

// Per-cell parity override for HexagonalGrid.getDirectPath. v13's EPS tie-break uses the call's
// starting cube parity, which flips between A->B (preview) and A->S + S->B (animation split).
// Deriving the EPS sign from each interpolated cell's own parity makes the path split-invariant.

function _cubeRoundFallback(q, r, s) {
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    else rs = -rq - rr;
    return { q: rq, r: rr, s: rs };
}

function _stableGetDirectPath(waypoints) {
    if (waypoints.length === 0) return [];

    let c0 = this.getCube(waypoints[0]);
    let { q: q0, r: r0, k: k0 } = c0;
    const is3D = k0 !== undefined;
    const path = [this.getOffset(c0)];

    const GD = /** @type {any} */ (foundry).CONST?.GRID_DIAGONALS;
    const diagonals = GD ? this.diagonals !== GD.ILLEGAL : true;
    const EPS = 1e-6;

    for (let i = 1; i < waypoints.length; i++) {
        const c1 = this.getCube(waypoints[i]);
        const { q: q1, r: r1, k: k1 } = c1;
        const s0v = (typeof c1.s === 'number') ? c1.s : (-q1 - r1);
        if (q0 === q1 && r0 === r1 && k0 === k1) continue;

        const dq = q0 - q1;
        const dr = r0 - r1;
        const n = this.constructor.cubeDistance(c0, c1);

        const collinearSENW = (dq === dr);
        const collinearAlt1 = this.columns ? (-2 * dq === dr) : (dq === -2 * dr);
        const collinearAlt2 = this.columns ? (dq === -2 * dr) : (-2 * dq === dr);
        const even = this.even;
        const columns = this.columns;

        const epsFor = (qMix, rMix) => {
            let eq = 0, er = 0;
            if (!(collinearSENW || collinearAlt1 || collinearAlt2)) return { eq, er };
            const sMix = 0 - qMix - rMix;
            const cell = this._cubeRound
                ? this._cubeRound({ q: qMix, r: rMix, s: sMix })
                : _cubeRoundFallback(qMix, rMix, sMix);
            const cq = cell.q, cr = cell.r;
            if (columns) {
                if (collinearSENW) {
                    er = (((cq + cr) & 1) === 0) === even ? EPS : -EPS;
                    eq = -er;
                } else if (collinearAlt1) {
                    eq = ((cr & 1) === 0) === even ? EPS : -EPS;
                } else if (collinearAlt2) {
                    er = ((cq & 1) === 0) === even ? -EPS : EPS;
                }
            } else {
                if (collinearSENW) {
                    eq = (((cq + cr) & 1) === 0) === even ? EPS : -EPS;
                    er = -eq;
                } else if (collinearAlt1) {
                    er = ((cq & 1) === 0) === even ? EPS : -EPS;
                } else if (collinearAlt2) {
                    eq = ((cr & 1) === 0) === even ? -EPS : EPS;
                }
            }
            return { eq, er };
        };

        if (is3D) {
            if (n !== 0) {
                let q = q0, r = r0, s = s0v, k = k0, j = 0;
                const sk = k0 < k1 ? 1 : -1;
                if (diagonals) {
                    const dk = 0 - Math.abs(k0 - k1);
                    let e = n + dk;
                    for (;;) {
                        const e2 = e * 2;
                        if (e2 >= dk) {
                            e += dk; j++;
                            const t = (j + EPS) / n;
                            const qMix = Math.mix(q0, q1, t);
                            const rMix = Math.mix(r0, r1, t);
                            const { eq, er } = epsFor(qMix, rMix);
                            q = qMix + eq;
                            r = rMix + er;
                            s = 0 - q - r;
                        }
                        if (e2 <= n) { e += n; k += sk; }
                        if (j === n && k === k1) break;
                        path.push(this.getOffset({ q, r, s, k }));
                    }
                } else {
                    const dk1 = Math.abs(k0 - k1) || 1;
                    let tc = dk1, tk = n;
                    for (;;) {
                        if (tc <= tk) {
                            tc += dk1; j++;
                            const t = (j + EPS) / n;
                            const qMix = Math.mix(q0, q1, t);
                            const rMix = Math.mix(r0, r1, t);
                            const { eq, er } = epsFor(qMix, rMix);
                            q = qMix + eq;
                            r = rMix + er;
                            s = 0 - q - r;
                        } else { tk += n; k += sk; }
                        if (j === n && k === k1) break;
                        path.push(this.getOffset({ q, r, s, k }));
                    }
                }
                path.push(this.getOffset(c1));
            } else {
                const last = path.at(-1);
                let k = k0;
                const sk = k0 < k1 ? 1 : -1;
                while (k !== k1) { k += sk; path.push({ i: last.i, j: last.j, k }); }
            }
        } else {
            for (let j = 1; j < n; j++) {
                const t = (j + EPS) / n;
                const qMix = Math.mix(q0, q1, t);
                const rMix = Math.mix(r0, r1, t);
                const { eq, er } = epsFor(qMix, rMix);
                const q = qMix + eq;
                const r = rMix + er;
                const s = 0 - q - r;
                path.push(this.getOffset({ q, r, s }));
            }
            path.push(this.getOffset(c1));
        }

        c0 = c1; q0 = q1; r0 = r1; k0 = k1;
    }

    return path;
}

export function initHexDragStabilizer() {
    if (typeof libWrapper === 'undefined') return;
    const HexClass = /** @type {any} */ (foundry)?.grid?.HexagonalGrid;
    if (!HexClass) return;

    libWrapper.register(
        MODULE_ID,
        'foundry.grid.HexagonalGrid.prototype.getDirectPath',
        /**
         * @param {(...args: any[]) => any} wrapped
         * @param {any[]} waypoints
         */
        function wrapStablePath(wrapped, waypoints) {
            try {
                return _stableGetDirectPath.call(this, waypoints);
            } catch (e) {
                console.warn(`${MODULE_ID} | stable getDirectPath failed, falling back`, e);
                return wrapped(waypoints);
            }
        },
        'MIXED'
    );

    console.log('[LA-HEX] per-cell parity override active');
}
