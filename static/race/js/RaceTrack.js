// RaceTrack.js — the circuit as DATA: a closed spline sampled by arc length. Physics, walls,
// surfaces, lap counting and the meshes (RaceScene.js) all read the same samples, so what you
// see is what you collide with. Pure math, no Babylon — tests/race.test.mjs.
// Map px: x to the right, y down the map (skill world3d, §Coordinates).

// Control points of the circuit, clockwise on the map. Start/finish is on the bottom straight
// (s = 0 at the first point), the car drives toward +x there.
const RACE_TRACK_POINTS = [
    [753, 1848], [1034, 1841], [1342, 1832], [1728, 1698], [1852, 1521], [1846, 1360],
    [1737, 1237], [1516, 1133], [1426, 1002], [1454, 846], [1609, 668], [1707, 494],
    [1684, 336], [1551, 221], [1286, 204], [1048, 363], [886, 651], [758, 837],
    [628, 924], [379, 1004], [251, 1134], [184, 1388], [253, 1575], [487, 1733],
];

// All circuits. points — clockwise control loop (start on the first point, driving toward the
// second); features — jumps (RaceTrack._buildHeights); grip — road grip multiplier (dirt/snow
// slide more); medals — race seconds for gold/silver/bronze in time trial (no rivals);
// theme — RaceScene palette and world dressing.
const RACE_TRACKS = [
    {
        id: 'valley', name: { en: 'Valley Circuit', ru: 'Долина' },
        points: RACE_TRACK_POINTS, features: [], grip: 1, medals: null,
        theme: { kind: 'valley' },
    },
    {
        id: 'canyon', name: { en: 'Dust Canyon', ru: 'Пыльный каньон' },
        points: [
            [492, 1717], [950, 1745], [1407, 1760], [1700, 1640], [1780, 1405], [1690, 1057],
            [1760, 774], [1727, 457], [1487, 270], [1060, 296], [797, 220], [430, 277],
            [280, 517], [325, 893], [279, 1160], [300, 1500],
        ],
        // MotorStorm scale: twice the size, a 420 px wide dirt road with open run-off,
        // kickers with long landing slopes, mud bogs to fight through.
        scale: 2, halfWidth: 210, kerb: 10, runoff: 110, grip: 0.82, medals: [118, 136, 160],
        features: [
            { at: 0.07, type: 'ramp', len: 260, h: 110, drop: 420 },
            { at: 0.2075, type: 'crest', len: 420, h: 90 },   // off the hairpin (r 173 -> 283)
            { at: 0.40, type: 'table', len: 640, h: 100 },
            { at: 0.58, type: 'ramp', len: 300, h: 140, drop: 520 },
            { at: 0.76, type: 'crest', len: 380, h: 80 },
            { at: 0.90, type: 'ramp', len: 220, h: 90, drop: 360 },
        ],
        // Mud: at — start (lap fraction), len px, lat0..lat1 — lateral band (px, + is right).
        zones: [
            { at: 0.15, len: 520, lat0: -230, lat1: 60, type: 'mud' },
            { at: 0.33, len: 420, lat0: -40, lat1: 240, type: 'mud' },
            { at: 0.50, len: 600, lat0: -240, lat1: 240, type: 'mud' },
            { at: 0.68, len: 460, lat0: -200, lat1: 20, type: 'mud' },
            { at: 0.84, len: 380, lat0: 30, lat1: 260, type: 'mud' },
        ],
        theme: { kind: 'canyon' },
    },
    {
        id: 'arctic', name: { en: 'Glacier Run', ru: 'Ледник' },
        points: [
            [615, 1707], [1150, 1720], [1610, 1608], [1783, 1300], [1725, 956], [1709, 678],
            [1640, 391], [1393, 214], [889, 347], [693, 440], [399, 490],
            [190, 690], [213, 1143], [380, 1505],
        ],
        scale: 2, halfWidth: 210, kerb: 10, runoff: 110, grip: 0.62, medals: [124, 144, 170],
        features: [
            { at: 0.06, type: 'crest', len: 460, h: 100 },
            { at: 0.20, type: 'ramp', len: 280, h: 130, drop: 500 },
            { at: 0.38, type: 'table', len: 700, h: 110 },
            { at: 0.55, type: 'ramp', len: 320, h: 170, drop: 640 },
            { at: 0.81, type: 'crest', len: 420, h: 90 },     // off the hairpin (r 108 -> 879)
            { at: 0.88, type: 'ramp', len: 240, h: 100, drop: 400 },
        ],
        // Slush pits (behave like mud): wet, heavy snow.
        zones: [
            { at: 0.12, len: 480, lat0: -240, lat1: 0, type: 'mud' },
            { at: 0.30, len: 520, lat0: 0, lat1: 250, type: 'mud' },
            { at: 0.47, len: 440, lat0: -250, lat1: 250, type: 'mud' },
            { at: 0.64, len: 500, lat0: -120, lat1: 200, type: 'mud' },
        ],
        theme: { kind: 'arctic' },
    },
];

// The playable world (px): LOCATION_WIDTH/HEIGHT must match (Constants.js). Track control
// points are authored in a 2048 box and mapped into it: centred, times def.scale.
const RACE_WORLD = 4096;

function raceTrackPoints(def) {
    const k = def.scale || 1, c = RACE_WORLD / 2;
    return def.points.map((p) => [(p[0] - 1024) * k + c, (p[1] - 1024) * k + c]);
}

// RaceTrack for a RACE_TRACKS entry.
function raceTrackFromDef(def) {
    return new RaceTrack(raceTrackPoints(def), {
        halfWidth: def.halfWidth, kerb: def.kerb, runoff: def.runoff, features: def.features, zones: def.zones,
        material: def.theme && def.theme.kind === 'arctic' ? 'snow'
            : def.theme && def.theme.kind === 'canyon' ? 'dirt' : 'asphalt',
        grip: def.grip || 1,
    });
}

class RaceTrack {
    /**
     * @param {number[][]} points closed loop of [x, y] control points
     * @param {{ halfWidth?: number, kerb?: number, runoff?: number, step?: number, features?: any[], zones?: any[], material?: string, grip?: number }} [opts]
     */
    constructor(points, opts) {
        const o = opts || {};
        this.roadMaterial = o.material || 'asphalt';
        this.gripScale = o.grip || 1;
        this.halfWidth = o.halfWidth || 96;    // px: asphalt half-width
        this.kerb = o.kerb || 16;              // px: kerb strip outside the asphalt
        this.runoff = o.runoff || 60;          // px: grass between the kerb and the wall
        this.step = o.step || 8;               // px: sample spacing along the centerline
        this.wall = this.halfWidth + this.kerb + this.runoff;
        this._build(points);
        this._buildHeights(o.features || []);
        this._buildZones(o.zones || []);
    }

    // --- Surface zones: mud ------------------------------------------------------------
    // zones: [{ at, len, lat0, lat1, type }] -> { s0, len, lat0, lat1, type }. Edges are wobbly
    // (a bog is not a rectangle): the lateral band narrows towards both ends.
    _buildZones(zones) {
        this.zones = zones.map((z) => ({
            type: z.type || 'mud', s0: ((z.at % 1) + 1) % 1 * this.length, len: Math.max(40, z.len || 300),
            lat0: Math.min(z.lat0, z.lat1), lat1: Math.max(z.lat0, z.lat1),
        }));
    }

    // Zone under (s, lat) or null. Shape: the band is full in the middle and pinches to 35% at
    // the ends, with a slow wobble on the edges — the same function draws the mud (RaceScene).
    zoneAt(s, lat) {
        for (const z of this.zones) {
            let d = (s - z.s0) % this.length;
            if (d < 0) d += this.length;
            if (d > z.len) continue;
            const e = this.zoneEdges(z, d);
            if (lat > e[0] && lat < e[1]) return z;
        }
        return null;
    }

    // Lateral edges [lo, hi] of zone z at distance d (0..len) from its start. inset — 0..1,
    // shrinks the band towards its middle (RaceScene draws the wet centre with 0.5).
    zoneEdges(z, d, inset) {
        const u = d / z.len, k = (0.35 + 0.65 * Math.sin(Math.PI * u)) * (1 - (inset || 0));
        const mid = (z.lat0 + z.lat1) / 2, half = (z.lat1 - z.lat0) / 2 * k;
        const wob = Math.sin(d * 0.021 + z.s0) * 14 * (1 - (inset || 0));
        return [mid - half + wob, mid + half - wob];
    }

    // --- Elevation: jumps ------------------------------------------------------------
    //
    // features: [{ at, type, len, h, drop? }] — at is the START as a fraction of the lap, len and
    // h in px. The height is the SAME across the whole width (a ramp spans wall to wall), and it
    // is an analytic function of s with a continuous slope on crests: the car leaves the ground
    // exactly when the road falls away faster than gravity (RaceCar.updateHeight).
    //   ramp  — linear kicker up to h, then a near-vertical drop: a guaranteed launch;
    //   crest — a smooth hump (cosine): flies only at speed;
    //   table — smooth rise, flat top, smooth fall: a tabletop.
    _buildHeights(features) {
        this.features = features.map((f) => ({
            type: f.type || 'ramp', s0: ((f.at % 1) + 1) % 1 * this.length,
            len: Math.max(24, f.len || 160), h: f.h || 40, drop: Math.max(8, f.drop || 26),
        }));
        this.hasHeight = this.features.length > 0;
        this.h = new Float64Array(this.count);
        for (let i = 0; i < this.count; i++) this.h[i] = this._profileHeight(i * this.ds);
    }



    // Public height follows the same piecewise-linear samples as the road mesh.
    // The authored analytic profile is used ONLY to build those samples.
    heightAt(s) {
        const u = ((s % this.length) + this.length) % this.length / this.ds;
        const i = Math.floor(u), f = u - i;
        return this.h[this.wrap(i)] * (1 - f) + this.h[this.wrap(i + 1)] * f;
    }

    // Shared contact description in MAP coordinates (x/y ground plane, z up).
    // Current roads are flat across their width; branches/crossfall are not introduced here.
    sampleSurface(s, lat = 0) {
        const p = this.pointAt(s), surface = this.surface(lat, s);
        const grade = this.hasHeight ? (this.heightAt(s + 6) - this.heightAt(s - 6)) / 12 : 0;
        const gradient = { x: grade * p.tx, y: grade * p.ty };
        const norm = Math.hypot(gradient.x, gradient.y, 1);
        const material = surface === 'mud' ? (this.roadMaterial === 'snow' ? 'slush' : 'mud')
            : surface === 'kerb' ? 'kerb' : surface === 'grass'
                ? (this.roadMaterial === 'asphalt' ? 'grass' : this.roadMaterial) : this.roadMaterial;
        return { height: this.heightAt(s), surface, material, gradient,
            normal: { x: -gradient.x / norm, y: -gradient.y / norm, z: 1 / norm },
            gripScale: this.gripScale, halfWidth: this.halfWidth, wall: this.wall };
    }

    // Sample-height lookup (meshes).
    heightAtIndex(i) { return this.h[this.wrap(i)]; }

    // Authored analytic profile, sampled once when building the road.
    _profileHeight(s) {
        let h = 0;
        const L = this.length;
        for (const f of this.features) {
            let d = (s - f.s0) % L;
            if (d < 0) d += L;
            if (f.type === 'ramp') {
                if (d < f.len) h += f.h * (d / f.len);
                else if (d < f.len + f.drop) h += f.h * (1 - (d - f.len) / f.drop);
            } else if (f.type === 'table') {
                const r = f.len * 0.3;
                if (d < r) h += f.h * 0.5 * (1 - Math.cos(Math.PI * d / r));
                else if (d < f.len - r) h += f.h;
                else if (d < f.len) h += f.h * 0.5 * (1 + Math.cos(Math.PI * (d - f.len + r) / r));
            } else if (d < f.len) {
                h += f.h * 0.5 * (1 - Math.cos(2 * Math.PI * d / f.len));
            }
        }
        return h;
    }


    // Closed Catmull-Rom through the control points, densely sampled, then resampled at a
    // fixed arc-length step: every sample i sits at s = i * ds.
    _build(points) {
        const n = points.length, dense = [];
        const SUB = 40;
        for (let i = 0; i < n; i++) {
            const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
            for (let k = 0; k < SUB; k++) {
                const t = k / SUB, t2 = t * t, t3 = t2 * t;
                const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
                dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
            }
        }
        const cum = [0];
        for (let i = 1; i <= dense.length; i++) {
            const a = dense[i - 1], b = dense[i % dense.length];
            cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        const total = cum[dense.length];
        const count = Math.max(16, Math.round(total / this.step));
        this.count = count;
        this.length = total;
        this.ds = total / count;
        this.px = new Float64Array(count); this.py = new Float64Array(count);
        this.tx = new Float64Array(count); this.ty = new Float64Array(count);
        let j = 0;
        for (let i = 0; i < count; i++) {
            const s = i * this.ds;
            while (cum[j + 1] < s) j++;
            const a = dense[j], b = dense[(j + 1) % dense.length];
            const u = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
            this.px[i] = a[0] + (b[0] - a[0]) * u;
            this.py[i] = a[1] + (b[1] - a[1]) * u;
        }
        for (let i = 0; i < count; i++) {
            const a = (i - 1 + count) % count, b = (i + 1) % count;
            const dx = this.px[b] - this.px[a], dy = this.py[b] - this.py[a], l = Math.hypot(dx, dy) || 1;
            this.tx[i] = dx / l; this.ty[i] = dy / l;
        }
    }

    wrap(i) { return ((i % this.count) + this.count) % this.count; }

    // Signed shortest arc distance from s0 to s1 (−L/2 … L/2).
    delta(s0, s1) {
        const L = this.length;
        let d = (s1 - s0) % L;
        if (d > L / 2) d -= L;
        if (d < -L / 2) d += L;
        return d;
    }

    // Point and tangent at arc length s. The left-hand normal on the map is (ty, −tx);
    // lateral offsets are measured along n = (−ty, tx) — positive to the RIGHT of travel.
    pointAt(s) {
        const L = this.length, u = ((s % L) + L) % L / this.ds;
        const i = Math.floor(u) % this.count, k = (i + 1) % this.count, f = u - Math.floor(u);
        const tx = this.tx[i] + (this.tx[k] - this.tx[i]) * f, ty = this.ty[i] + (this.ty[k] - this.ty[i]) * f;
        const l = Math.hypot(tx, ty) || 1;
        return { x: this.px[i] + (this.px[k] - this.px[i]) * f, y: this.py[i] + (this.py[k] - this.py[i]) * f, tx: tx / l, ty: ty / l };
    }

    // Nearest centerline point to (x, y). hint — the sample index from the previous frame:
    // the search stays local (fast, and never jumps to a parallel stretch of the track).
    // -> { i, s, lat, cx, cy, tx, ty }
    project(x, y, hint) {
        let best = -1, bestD = Infinity;
        const scan = (from, to) => {
            for (let k = from; k <= to; k++) {
                const i = this.wrap(k), dx = x - this.px[i], dy = y - this.py[i], d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = i; }
            }
        };
        if (hint != null && hint >= 0) {
            const win = Math.ceil(this.wall * 2 / this.ds) + 8;
            scan(hint - win, hint + win);
            if (bestD > this.wall * this.wall * 4) { bestD = Infinity; scan(0, this.count - 1); }
        } else {
            scan(0, this.count - 1);
        }
        // Refine on the neighbouring segments.
        let s = best * this.ds, cx = this.px[best], cy = this.py[best];
        for (const j of [this.wrap(best - 1), best]) {
            const k = this.wrap(j + 1);
            const ax = this.px[j], ay = this.py[j], bx = this.px[k] - ax, by = this.py[k] - ay;
            const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by || 1)));
            const qx = ax + bx * t, qy = ay + by * t, d = (x - qx) ** 2 + (y - qy) ** 2;
            if (d <= (x - cx) ** 2 + (y - cy) ** 2) { cx = qx; cy = qy; s = (j + t) * this.ds; }
        }
        const tx = this.tx[best], ty = this.ty[best];
        return { i: best, s: s % this.length, lat: (x - cx) * -ty + (y - cy) * tx, cx, cy, tx, ty };
    }

    // Surface by the lateral offset (and arc length s for zones): 'road' | 'kerb' | 'grass' | 'mud'.
    surface(lat, s) {
        if (s != null && this.zones && this.zones.length && this.zoneAt(s, lat)) return 'mud';
        const a = Math.abs(lat);
        return a <= this.halfWidth ? 'road' : a <= this.halfWidth + this.kerb ? 'kerb' : 'grass';
    }

    // Signed curvature at sample i (1/px): > 0 — turning right (clockwise on the map).
    curvature(i) {
        const a = this.wrap(i - 3), b = this.wrap(i + 3);
        const cross = this.tx[a] * this.ty[b] - this.ty[a] * this.tx[b];
        return cross / (6 * this.ds);
    }

    // Signed offset of the embankment foot. The inner side must remain inside the local
    // turn radius; an unconstrained height-scaled offset folds back through the road.
    bankOffset(i, side) {
        const off = this.wall + 4, width = off + 10 + this.h[this.wrap(i)] * 1.4;
        let turn = 0;
        for (const j of [this.wrap(i - 1), this.wrap(i + 1)]) {
            const cross = this.tx[this.wrap(i)] * this.ty[j] - this.ty[this.wrap(i)] * this.tx[j];
            const dot = this.tx[this.wrap(i)] * this.tx[j] + this.ty[this.wrap(i)] * this.ty[j];
            const direction = j === this.wrap(i - 1) ? -1 : 1;
            turn = Math.max(turn, side * direction * Math.atan2(cross, dot) / this.ds);
        }
        // A fixed geometric safety margin, not a change to the playable road width.
        const safe = turn > 1e-9 ? 0.8 / turn : Infinity;
        return side * Math.max(off + 1, Math.min(width, safe));
    }

    // Smallest distance between two stretches of the centerline that are far apart ALONG the
    // track — must stay above 2 × wall or the walls of the two stretches overlap (test).
    minClearance() {
        let min = Infinity;
        const gap = Math.ceil(this.wall * 3 / this.ds), stride = 2;
        for (let i = 0; i < this.count; i += stride) {
            for (let j = i + gap; j < this.count; j += stride) {
                if (this.count - (j - i) < gap) continue;
                const d = Math.hypot(this.px[i] - this.px[j], this.py[i] - this.py[j]);
                if (d < min) min = d;
            }
        }
        return min;
    }
}

// Lap counting by DISTANCE driven along the track: progress grows only by small forward
// steps of the projected s. Shortcuts, driving backwards over the line or a respawn cannot
// complete a lap — the only way to +L is to drive the whole loop. The finish line is s = 0.
class RaceProgress {
    /** @param {RaceTrack} track @param {number} laps */
    constructor(track, laps) {
        this.track = track;
        this.laps = laps;
        this.reset(0);
    }

    // s0 — the projected start position (the grid stands a little BEFORE the line).
    reset(s0) {
        this.lastS = s0;
        this.progress = this.track.delta(0, s0);   // negative on the grid behind the line
        if (this.progress > this.track.length / 2) this.progress -= this.track.length;
        this.lap = 0;              // completed laps
        this.lapStart = 0;
        this.lapTimes = [];
        this.finished = false;
    }

    // Maximum believable step of s per update (px): a larger jump — a teleport, not counted.
    static get MAX_STEP() { return 120; }

    // s — projected arc length now, time — race clock (s). -> events
    update(s, time) {
        const events = [];
        const d = this.track.delta(this.lastS, s);
        this.lastS = s;
        if (this.finished || Math.abs(d) > RaceProgress.MAX_STEP) return events;
        this.progress += d;
        while (!this.finished && this.progress >= (this.lap + 1) * this.track.length) {
            const lapTime = time - this.lapStart;
            this.lapTimes.push(lapTime);
            this.lap++;
            this.lapStart = time;
            events.push({ type: 'lap', lap: this.lap, time: lapTime });
            if (this.lap >= this.laps) {
                this.finished = true;
                events.push({ type: 'finish', time });
            }
        }
        return events;
    }

    // 0..1 of the current lap.
    lapFraction() {
        const L = this.track.length;
        return Math.max(0, Math.min(1, (this.progress - this.lap * L) / L));
    }
}
