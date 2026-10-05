// RaceProps.js — destructible track dressing (FlatOut style): cones, barrels, crates, tyre
// stacks, hay bales, fence panels. Cars plough through them: a prop takes the car's momentum,
// flies off tumbling and bounces to rest where it lands; crates and fences BREAK into planks.
// The car pays a speed cost by mass (a cone — nothing, a hay bale — a real thump). Pure math,
// no Babylon (tests/race.test.mjs); the meshes are thin instances in RaceScene.buildProps().
//
//     const props = new RaceProps(track, def);
//     const n = props.hitCar(car);  props.events[0..n)   // per physics step, per car
//     props.step(dt);                                      // per frame: flying debris
//     props.matrix(out, k, p);                             // instance matrix of prop p
//     props.reset();                                       // new race: everything back home

// r — collision radius px, h — height px, mass — vs a car of 1, bounce — vertical restitution,
// breakAt — closing speed px/s that smashes it into `pieces` planks (0 — never breaks).
const RACE_PROP_TYPES = {
    cone: { material: 'plastic', r: 7, h: 18, mass: 0.02, bounce: 0.45, breakAt: 0, pieces: 0 },
    barrel: { material: 'metal', r: 11, h: 26, mass: 0.1, bounce: 0.4, breakAt: 0, pieces: 0 },
    crate: { material: 'wood', r: 12, h: 22, mass: 0.08, bounce: 0.3, breakAt: 140, pieces: 4 },
    tyres: { material: 'rubber', r: 14, h: 20, mass: 0.16, bounce: 0.55, breakAt: 0, pieces: 0 },
    hay: { material: 'straw', r: 16, h: 18, mass: 0.22, bounce: 0.2, breakAt: 0, pieces: 0 },
    fence: { material: 'wood', r: 12, h: 16, mass: 0.05, bounce: 0.3, breakAt: 90, pieces: 3 },
    plank: { material: 'wood', r: 6, h: 4, mass: 0.01, bounce: 0.35, breakAt: 0, pieces: 0 },
};

class RaceProps {
    /** @param {RaceTrack} track @param {any} def RACE_TRACKS entry */
    constructor(track, def) {
        this.track = track;
        this.kind = (def && def.theme && def.theme.kind) || 'valley';
        this.list = [];
        this.events = [];          // filled by hitCar(): { x, y, type, strength, mass, broke }
        this.dirty = true;         // some matrix changed since the view last read them
        this.smashed = 0;          // props hit this race
        this._seed = 1;
        this._layout();
        this.reset();
    }

    // Deterministic random (same layout every load — record runs are comparable).
    _rnd() {
        let t = (this._seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // One prop at arc length s, lateral offset lat; yaw relative to the track direction.
    _add(type, s, lat, yaw) {
        const T = RACE_PROP_TYPES[type], tr = this.track, q = tr.pointAt(s);
        const x = q.x - q.ty * lat, y = q.y + q.tx * lat;
        const p = { type, T, hx: x, hy: y, hyaw: Math.atan2(q.ty, q.tx) + (yaw || 0), hz: 0, kids: null, parent: null, hint: -1 };
        p.hint = tr.project(x, y).i;
        p.hz = this._groundAt(p);
        this.list.push(p);
        for (let k = 0; k < T.pieces; k++) {
            const kid = { type: 'plank', T: RACE_PROP_TYPES.plank, hx: x, hy: y, hyaw: p.hyaw, hz: p.hz, kids: null, parent: p, hint: p.hint };
            (p.kids || (p.kids = [])).push(kid);
            this.list.push(kid);
        }
        return p;
    }

    // Ground under a prop: the road height inside the walls, the embankment slope outside
    // (RaceScene builds it h × 1.4 wide), 0 beyond.
    _groundAt(p) {
        const tr = this.track;
        const pr = tr.project(p.x != null ? p.x : p.hx, p.y != null ? p.y : p.hy, p.hint >= 0 ? p.hint : undefined);
        p.hint = pr.i;
        if (!tr.hasHeight) return 0;
        const h = tr.heightAt(pr.s), out = Math.abs(pr.lat) - tr.wall;
        return out <= 0 ? h : h * Math.max(0, 1 - out / (10 + h * 1.4));
    }

    _skip(s) {
        const d = this.track.delta(0, s);
        return d > -420 && d < 320;            // the grid and the first corner stay clean
    }

    // Where things go: tyre walls / hay on the outside of corners, smash-through piles on the
    // landings of jumps, cone lines at the mouths of mud bogs, barrels and fences on the run-off.
    _layout() {
        const tr = this.track, L = tr.length, off = this.kind !== 'valley';
        const edge = tr.wall - 16, run0 = tr.halfWidth + tr.kerb + 14;
        const kMin = 1 / (tr.wall * 2.3);
        const cornerTypes = this.kind === 'canyon' ? ['hay', 'tyres'] : ['tyres'];
        // Corners: a stack every ~70 px along the outside.
        let corner = 0;
        for (let s = 0; s < L && corner < 90; s += 70) {
            if (this._skip(s)) continue;
            const k = tr.curvature(Math.round(s / tr.ds));
            if (Math.abs(k) < kMin) continue;
            const side = k > 0 ? -1 : 1;                   // turning right — the outside is left
            this._add(cornerTypes[corner++ % cornerTypes.length], s, side * edge, this._rnd() * 0.5);
        }
        // Jump landings: a broken line of crates and barrels across the road.
        for (const f of tr.features || []) {
            const sL = f.s0 + f.len + (f.type === 'ramp' ? f.drop + 140 : 90);
            if (this._skip(sL % L)) continue;
            const half = tr.halfWidth * 0.75;
            for (let lat = -half; lat <= half; lat += 44) {
                if (this._rnd() < 0.3) continue;
                this._add(this._rnd() < 0.6 ? 'crate' : 'barrel', sL + (this._rnd() - 0.5) * 40, lat, this._rnd());
            }
        }
        // Mud mouths: cones across the bog band, entry and exit.
        for (const z of tr.zones || []) {
            for (const s of [z.s0 - 30, z.s0 + z.len + 30]) {
                if (this._skip(((s % L) + L) % L)) continue;
                for (let lat = z.lat0 + 15; lat <= z.lat1 - 15; lat += 46) this._add('cone', s, lat, 0);
            }
        }
        // Run-off: barrel clusters; off-road — fence runs along the straights too.
        for (let s = 120; s < L; s += 300) {
            if (this._skip(s) || this._rnd() > 0.5) continue;
            const side = this._rnd() < 0.5 ? -1 : 1, lat = side * (run0 + this._rnd() * Math.max(10, edge - run0 - 10));
            const n = 2 + Math.floor(this._rnd() * 2);
            for (let k = 0; k < n; k++) this._add(off && k === 0 && this.kind === 'arctic' ? 'crate' : 'barrel', s + k * 20, lat + (this._rnd() - 0.5) * 20, this._rnd() * 3);
        }
        if (off) {
            for (let s = 200; s < L; s += 900) {
                if (this._skip(s)) continue;
                const k = tr.curvature(Math.round(s / tr.ds));
                if (Math.abs(k) > kMin * 0.5) continue;
                const side = this._rnd() < 0.5 ? -1 : 1;
                for (let j = 0; j < 7; j++) this._add('fence', s + j * 26, side * (edge - 4), 0);
            }
        }
        // Valley: cone chicane markers before the big corners (it has no jumps or mud).
        if (!off) {
            for (let s = 300; s < L; s += 700) {
                if (this._skip(s)) continue;
                for (let j = 0; j < 3; j++) this._add('cone', s + j * 24, (this._rnd() < 0.5 ? -1 : 1) * (tr.halfWidth + tr.kerb + 8), 0);
            }
        }
    }

    // Everything back home, standing, untouched; planks hidden inside their crates.
    reset() {
        for (const p of this.list) {
            p.x = p.hx; p.y = p.hy; p.z = p.hz;
            p.vx = 0; p.vy = 0; p.vz = 0;
            p.yaw = p.hyaw; p.spin = 0;
            p.tumble = 0; p.trate = 0; p.ax = 1; p.ay = 0;
            p.state = p.parent ? RaceProps.HIDDEN : RaceProps.IDLE;
        }
        this.smashed = 0;
        this.dirty = true;
    }

    // Car vs props this physics step. -> number of events in this.events.
    hitCar(car) {
        let n = 0;
        const cz = car.z || 0;
        for (const p of this.list) {
            if (p.state === RaceProps.HIDDEN) continue;
            const T = p.T, dx = p.x - car.x, dy = p.y - car.y, r = car.radius + T.r;
            if (dx > r || dx < -r || dy > r || dy < -r) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 >= r * r || cz > p.z + T.h + 4 || p.z > cz + 34) continue;
            const d = Math.sqrt(d2) || 0.01, nx = d2 > 1e-6 ? dx / d : Math.cos(car.heading), ny = d2 > 1e-6 ? dy / d : Math.sin(car.heading);
            p.x += nx * (r - d); p.y += ny * (r - d);
            const vn = (car.vx - p.vx) * nx + (car.vy - p.vy) * ny;
            this.dirty = true;
            if (vn <= 20) { if (p.state === RaceProps.IDLE) p.state = RaceProps.REST; continue; }
            // Momentum: the car loses its share, the prop takes the rest plus a carry of the
            // car's velocity (it gets swept along, not just pushed sideways).
            const w = T.mass / (T.mass + (car.mass || 1));
            car.vx -= nx * vn * w; car.vy -= ny * vn * w;
            car.yawRate += (this._rnd() - 0.5) * T.mass * 6;
            p.vx += nx * vn * (1 - w) * 1.3 + car.vx * 0.3;
            p.vy += ny * vn * (1 - w) * 1.3 + car.vy * 0.3;
            if (vn > 110) {
                p.vz = Math.max(p.vz, (70 + vn * 0.55) * (0.7 + 0.6 * this._rnd()) / (1 + T.mass * 2));
                p.spin = (this._rnd() - 0.5) * 14;
                p.trate = (6 + this._rnd() * 8) * (this._rnd() < 0.5 ? -1 : 1);
            }
            const sp = Math.hypot(p.vx, p.vy) || 1;
            p.ax = -p.vy / sp; p.ay = p.vx / sp;     // tumble about the horizontal axis across the flight
            // Only the first strike against an untouched prop earns boost/combo credit.
            // reset() restores IDLE; repeated physical impacts still emit feedback events.
            const reward = p.state === RaceProps.IDLE;
            if (reward) this.smashed++;
            p.state = RaceProps.FLY;
            const broke = T.pieces > 0 && vn > T.breakAt;
            if (broke) this._break(p);
            if (n < 16) this.events[n++] = {
                x: p.x - nx * T.r, y: p.y - ny * T.r,
                height: Math.max(p.z, Math.min(p.z + T.h, cz + 12)),
                normal: { x: -nx, y: -ny, z: 0 }, material: T.material,
                type: p.type, strength: Math.min(1, vn / 600), mass: T.mass, broke, reward,
            };
        }
        return n;
    }

    // Crate / fence -> planks flying out of where it stood.
    _break(p) {
        p.state = RaceProps.HIDDEN;
        for (const k of p.kids || []) {
            k.x = p.x + (this._rnd() - 0.5) * p.T.r; k.y = p.y + (this._rnd() - 0.5) * p.T.r;
            k.z = p.z + this._rnd() * p.T.h;
            k.vx = p.vx * (0.6 + this._rnd() * 0.6) + (this._rnd() - 0.5) * 220;
            k.vy = p.vy * (0.6 + this._rnd() * 0.6) + (this._rnd() - 0.5) * 220;
            k.vz = p.vz * (0.6 + this._rnd() * 0.6) + 80 + this._rnd() * 220;
            k.yaw = this._rnd() * 6.28; k.spin = (this._rnd() - 0.5) * 20;
            k.tumble = 0; k.trate = (this._rnd() - 0.5) * 30;
            k.ax = this._rnd() - 0.5; k.ay = this._rnd() - 0.5;
            const l = Math.hypot(k.ax, k.ay) || 1; k.ax /= l; k.ay /= l;
            k.hint = p.hint;
            k.state = RaceProps.FLY;
        }
    }

    // Flying and settling props: gravity, bounces, ground friction, tumble settles flat.
    step(dt) {
        if (dt <= 0) return;
        const G = typeof RaceCar !== 'undefined' ? RaceCar.GRAVITY : 760, W = typeof RACE_WORLD !== 'undefined' ? RACE_WORLD : 4096;
        const Q = Math.PI / 2;
        for (const p of this.list) {
            if (p.state === RaceProps.REST && p.tumble !== p._settle) {
                // Settling onto a face (a quarter turn), smoothly.
                const target = Math.round(p.tumble / Q) * Q;
                p.tumble += (target - p.tumble) * (1 - Math.exp(-10 * dt));
                if (Math.abs(target - p.tumble) < 0.01) p.tumble = target;
                p._settle = p.tumble;
                this.dirty = true;
                continue;
            }
            if (p.state !== RaceProps.FLY) continue;
            this.dirty = true;
            p.vz -= G * dt;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            p.yaw += p.spin * dt;
            p.tumble += p.trate * dt;
            if (p.x < 0 || p.y < 0 || p.x > W || p.y > W) { p.state = RaceProps.HIDDEN; continue; }
            const g = this._groundAt(p);
            if (p.z > g) continue;
            p.z = g;
            if (p.vz < -70) {
                p.vz = -p.vz * p.T.bounce;
                p.trate *= 0.6; p.spin *= 0.6;
            } else p.vz = 0;
            const f = Math.exp(-3.2 * dt);
            p.vx *= f; p.vy *= f; p.spin *= f;
            p.trate *= Math.exp(-5 * dt);
            if (p.vz === 0 && p.vx * p.vx + p.vy * p.vy < 36 && Math.abs(p.trate) < 1) {
                p.vx = p.vy = 0; p.spin = p.trate = 0;
                p.state = RaceProps.REST;
                p._settle = null;
            }
        }
    }

    // Instance matrix (16 floats at out[k*16]) for prop p: the mesh is CENTRED on its origin.
    // Yaw about the vertical, then the tumble about the horizontal axis (ax, ay) — Rodrigues on
    // each basis row; lifted so a lying prop rests on its side, not half under the ground.
    static matrix(out, k, p) {
        const o = k * 16;
        if (p.state === RaceProps.HIDDEN) { out.fill(0, o, o + 16); out[o + 13] = -9999; out[o + 15] = 1; return; }
        const a = -p.yaw, c = Math.cos(a), s = Math.sin(a);
        const rows = [[c, 0, -s], [0, 1, 0], [s, 0, c]];
        const th = p.tumble || 0, ct = Math.cos(th), st = Math.sin(th);
        const ux = p.ax, uz = p.ay;                       // map (x, y) -> Babylon (x, z)
        for (let r = 0; r < 3; r++) {
            const v = rows[r], dot = ux * v[0] + uz * v[2];
            // u × v with u = (ux, 0, uz)
            const cx = 0 * v[2] - uz * v[1], cy = uz * v[0] - ux * v[2], cz = ux * v[1] - 0 * v[0];
            out[o + r * 4] = v[0] * ct + cx * st + ux * dot * (1 - ct);
            out[o + r * 4 + 1] = v[1] * ct + cy * st;
            out[o + r * 4 + 2] = v[2] * ct + cz * st + uz * dot * (1 - ct);
            out[o + r * 4 + 3] = 0;
        }
        const lift = p.T.h / 2 * Math.abs(ct) + p.T.r * 0.85 * Math.abs(st);
        out[o + 12] = p.x; out[o + 13] = p.z + lift; out[o + 14] = p.y; out[o + 15] = 1;
    }
}

RaceProps.IDLE = 0;     // never touched — static
RaceProps.FLY = 1;      // moving (in the air or sliding)
RaceProps.REST = 2;     // knocked over and settled where it landed
RaceProps.HIDDEN = 3;   // a smashed crate / a plank still inside its crate / out of the world
