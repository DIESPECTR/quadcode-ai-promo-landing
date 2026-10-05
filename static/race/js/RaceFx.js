// RaceFx.js — gameplay-driven effects: tyre marks (protected pools of instanced quads), tyre
// smoke on asphalt, dust on grass/dirt, mud splash, sparks on hits. Meshes and particles use
// fixed-capacity pools. quality 'low' cuts particle counts and mark capacity, never the feedback.
//
// Marks: 'skid' — dark slide marks on tarmac; 'rut' — rolling tyre tracks on loose ground
// (dirt/snow/grass, theme colour); 'mud' — deep dark ruts through bogs. A mark stays while it is
// in the frame and disappears only after it has been off-screen for RaceFx.MARK_OFFSCREEN_SEC.
//
//     const fx = new RaceFx(app, { quality: 'high' });
//     fx.setTheme({ loose: true, ruts: '#83563a', mud: '#3f2716' });
//     fx.update(dt, car, wheels, surface);    // player: marks + particles; wheels — RaceScene.rearWheels(car)
//     fx.trail(car, wheels, surface);         // rivals: marks only
//     fx.impact(x, y, strength);              // strength 0..1

// Shared soft puff texture (one per scene).
let RACE_PUFF_TEX = null;

class RaceFx {
    constructor(app, opts) {
        const o = opts || {};
        this.view = app.location.view;
        this.scene = this.view.scene;
        this.low = o.quality === 'low';
        this._buildMarks();
        this.smoke = this._particles('race-smoke', '#e9e6e0', this.low ? 120 : 320, false);
        this.dust = this._particles('race-dust', '#b89a6a', this.low ? 100 : 260, false);
        // Dedicated emitter: wheel updates must not move a landing burst to the rear axle.
        this.groundImpact = this._particles('race-ground-impact', '#b89a6a', this.low ? 100 : 260, false);
        this.sparks = this._particles('race-sparks', '#ffc466', this.low ? 60 : 160, true);
        this._setupSparks();
        this.splash = this._particles('race-splash', '#4a2f1b', this.low ? 90 : 240, false);
        this._setupSplash();
        // Reuse the capped contact pool; wood already has physical planks in RaceProps.
        const palette = (r, g, b) => ({
            color1: new BABYLON.Color4(r, g, b, 0.7),
            color2: new BABYLON.Color4(r * 0.8, g * 0.8, b * 0.8, 0.5),
            colorDead: new BABYLON.Color4(r, g, b, 0),
        });
        this.propColors = {
            wood: palette(0.52, 0.32, 0.17), straw: palette(0.78, 0.67, 0.36),
            rubber: palette(0.12, 0.13, 0.15), plastic: palette(0.8, 0.36, 0.15),
        };
        this._trails = new WeakMap();  // car -> [last point per rear wheel]
        this._clock = 0;
        this._sweepAt = 0;
        this.loose = false;            // track surface is dirt/snow: rolling ruts everywhere
    }

    // Theme: loose — ruts on the road itself; ruts / mud / dust — colours (hex).
    setTheme(t) {
        const o = t || {};
        this.track = o.track || null;
        this.loose = !!o.loose;
        const set = (pool, hex) => {
            if (!hex) return;
            const c = BABYLON.Color3.FromHexString(hex);
            pool.mat.diffuseColor = c; pool.mat.emissiveColor = c.clone();
        };
        set(this.pools.rut, o.ruts);
        set(this.pools.mud, o.mud);
        if (o.dust) {
            const c = BABYLON.Color3.FromHexString(o.dust);
            this.dust.color1.set(c.r, c.g, c.b, 0.55);
            this.dust.color2.set(c.r * 0.9, c.g * 0.9, c.b * 0.9, 0.4);
            this.dust.colorDead.set(c.r, c.g, c.b, 0);
        }
        if (o.mud) {
            const c = BABYLON.Color3.FromHexString(o.mud);
            this.splash.color1 = new BABYLON.Color4(c.r, c.g, c.b, 0.9);
            this.splash.color2 = new BABYLON.Color4(c.r * 1.2, c.g * 1.2, c.b * 1.2, 0.8);
            this.splash.colorDead = new BABYLON.Color4(c.r, c.g, c.b, 0);
        }
    }

    // --- Tyre marks ----------------------------------------------------------

    _buildMarks() {
        const L = this.low;
        this.pools = {
            skid: this._pool('skid', '#141417', 0.42, L ? 300 : 900, 7),
            rut: this._pool('rut', '#83563a', 0.5, L ? 700 : 2600, 8),
            mud: this._pool('mud', '#2e1d10', 0.75, L ? 300 : 1100, 12),
        };
    }

    _pool(name, hex, alpha, cap, width) {
        const quad = BABYLON.MeshBuilder.CreateGround('race-mark-' + name, { width: 1, height: 1 }, this.scene);
        const m = new BABYLON.StandardMaterial('race-mark-mat-' + name, this.scene);
        const c = BABYLON.Color3.FromHexString(hex);
        m.diffuseColor = c;
        m.specularColor = BABYLON.Color3.Black();
        m.alpha = alpha;
        m.disableLighting = true;
        m.emissiveColor = c.clone();
        quad.material = m;
        const inst = World3D.addInstances(this.view, quad, 'prop',
            Array.from({ length: cap }, () => RaceFx.HIDDEN),
            { dynamic: true, castShadow: false, receiveShadows: false, ink: false, outline: false });
        // Fixed-capacity free queue: visible slots are never recycled by new tracks.
        return { inst, mat: m, quad, cap, width, dirty: false,
            free: Int32Array.from({ length: cap }, (_, i) => i), head: 0, available: cap,
            px: new Float32Array(cap), py: new Float32Array(cap), pz: new Float32Array(cap),
            radius: new Float32Array(cap),
            used: new Uint8Array(cap), off: new Float32Array(cap).fill(-1) };
    }

    _groundPoint(x, y, kind, fallbackHeight, hint) {
        if (!this.track) return { x, y, h: fallbackHeight, gx: 0, gy: 0 };
        const p = this.track.project(x, y, hint), q = this.track.sampleSurface(p.s, p.lat);
        return { x, y, h: q.height + 2.6 + (kind === 'mud' ? 0.4 : kind === 'rut' ? 0.2 : 0),
            gx: q.gradient.x, gy: q.gradient.y, i: p.i };
    }

    _mark(kind, a, b, h) {
        const P = this.pools[kind];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (len < 0.5 || !P.available) return false;
        const A = Number.isFinite(a.h) ? a : this._groundPoint(a.x, a.y, kind, h);
        const B = Number.isFinite(b.h) ? b : this._groundPoint(b.x, b.y, kind, h, A.i);
        const dz = B.h - A.h, length = Math.hypot(len, dz);
        const lx = dx / length, ly = dz / length, lz = dy / length;
        // Width axis lies on the contact plane; Gram-Schmidt keeps the quad orthogonal.
        let sx = -dy / len, sz = dx / len;
        let sy = ((A.gx + B.gx) * sx + (A.gy + B.gy) * sz) / 2;
        const dot = sx * lx + sy * ly + sz * lz;
        sx -= dot * lx; sy -= dot * ly; sz -= dot * lz;
        const sn = Math.hypot(sx, sy, sz);
        sx /= sn; sy /= sn; sz /= sn;
        const nx = sy * lz - sz * ly, ny = sz * lx - sx * lz, nz = sx * ly - sy * lx;
        const i = P.free[P.head]; P.head = (P.head + 1) % P.cap; P.available--;
        const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, height = (A.h + B.h) / 2;
        const out = P.inst.matrices, k = i * 16;
        out[k] = lx * (length + 1); out[k + 1] = ly * (length + 1); out[k + 2] = lz * (length + 1); out[k + 3] = 0;
        out[k + 4] = nx; out[k + 5] = ny; out[k + 6] = nz; out[k + 7] = 0;
        out[k + 8] = sx * P.width; out[k + 9] = sy * P.width; out[k + 10] = sz * P.width; out[k + 11] = 0;
        out[k + 12] = x; out[k + 13] = height; out[k + 14] = y; out[k + 15] = 1;
        P.px[i] = x; P.py[i] = y; P.pz[i] = height;
        P.radius[i] = Math.hypot(length + 1, P.width) / 2;
        P.used[i] = 1; P.off[i] = -1; P.dirty = true;
        return true;
    }

    // Which mark a wheel leaves on this surface, or null.
    _markKind(car, surface) {
        if (car.air || car.speed < 25) return null;
        if (surface === 'mud') return 'mud';
        if (surface === 'grass' || (this.loose && surface !== 'kerb')) return 'rut';
        return car.skid > 0.3 && car.speed > 40 ? 'skid' : null;
    }

    // Lay marks behind a car's rear wheels (any car; chains break when the kind changes).
    trail(car, wheels, surface) {
        let st = this._trails.get(car);
        if (!st) { st = { last: [null, null], kind: null }; this._trails.set(car, st); }
        const kind = this._markKind(car, surface);
        if (kind !== st.kind) { st.last = [null, null]; st.kind = kind; }
        if (!kind) return;
        const h = (car.z || 0) + 2.6 + (kind === 'mud' ? 0.4 : kind === 'rut' ? 0.2 : 0);
        // A bike's two "wheels" are the same rut — one chain is enough.
        const n = car.type === 'bike' ? 1 : 2;
        for (let k = 0; k < n; k++) {
            const w = wheels[k], last = st.last[k];
            if (!last) st.last[k] = this._groundPoint(w.x, w.y, kind, h);
            else {
                const distance = Math.hypot(w.x - last.x, w.y - last.y);
                if (distance < 7) continue;
                // Short quads follow changes of grade instead of spanning a whole crest.
                const steps = Math.min(32, Math.ceil(distance / (this.track ? this.track.ds : 7)));
                let a = last;
                for (let j = 1; j <= steps; j++) {
                    const f = j / steps;
                    const b = this._groundPoint(last.x + (w.x - last.x) * f,
                        last.y + (w.y - last.y) * f, kind, h, a.i);
                    this._mark(kind, a, b, h);
                    a = b;
                }
                // Even when full, advance the chain; freed slots must not bridge a long gap.
                st.last[k] = a;
            }
        }
    }

    // Forget a car's last mark points (teleport / reset): the next mark starts a new chain.
    breakTrail(car) { this._trails.delete(car); }

    // Marks that have been out of the camera frustum long enough are hidden. The check runs
    // a few times a second over every used slot (cheap: 6 plane tests per mark).
    _sweep() {
        const cam = this.scene.activeCamera;
        if (!cam) return;
        const planes = BABYLON.Frustum.GetPlanes(this.scene.getTransformMatrix());
        const t = this._clock, ttl = RaceFx.MARK_OFFSCREEN_SEC, M = 30;
        for (const key in this.pools) {
            const P = this.pools[key];
            for (let i = 0; i < P.cap; i++) {
                if (!P.used[i]) continue;
                let inside = true;
                for (const pl of planes) {
                    if (pl.normal.x * P.px[i] + pl.normal.y * P.pz[i] + pl.normal.z * P.py[i] + pl.d < -Math.max(M, P.radius[i])) { inside = false; break; }
                }
                if (inside) { P.off[i] = -1; continue; }
                if (P.off[i] < 0) { P.off[i] = t; continue; }
                if (t - P.off[i] > ttl) {
                    P.inst.set(i, RaceFx.HIDDEN); P.used[i] = 0; P.off[i] = -1; P.dirty = true;
                    P.free[(P.head + P.available) % P.cap] = i; P.available++;
                }
            }
        }
    }

    clearMarks() {
        for (const key in this.pools) {
            const P = this.pools[key];
            for (let i = 0; i < P.cap; i++) P.inst.set(i, RaceFx.HIDDEN);
            P.used.fill(0); P.off.fill(-1); P.head = 0; P.available = P.cap;
            for (let i = 0; i < P.cap; i++) P.free[i] = i;
            P.dirty = false;
            P.inst.flush();
        }
        this._trails = new WeakMap();
    }

    // Live marks per pool (tests, debug).
    markCount(kind) {
        const P = this.pools[kind];
        let n = 0;
        for (let i = 0; i < P.cap; i++) n += P.used[i];
        return n;
    }

    // --- Particles -------------------------------------------------------------

    static puffTexture(scene) {
        if (RACE_PUFF_TEX && RACE_PUFF_TEX.getScene() === scene) return RACE_PUFF_TEX;
        const t = new BABYLON.DynamicTexture('race-puff', { width: 64, height: 64 }, scene, false);
        const g = /** @type {CanvasRenderingContext2D} */ (t.getContext());
        const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.6, 'rgba(255,255,255,0.45)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        t.hasAlpha = true;
        t.update();
        RACE_PUFF_TEX = t;
        return t;
    }

    _particles(name, hex, capacity, additive) {
        const ps = new BABYLON.ParticleSystem(name, capacity, this.scene);
        ps.particleTexture = RaceFx.puffTexture(this.scene);
        ps.emitter = new BABYLON.Vector3(-9999, -50, -9999);
        const c = BABYLON.Color3.FromHexString(hex);
        ps.color1 = new BABYLON.Color4(c.r, c.g, c.b, 0.55);
        ps.color2 = new BABYLON.Color4(c.r * 0.9, c.g * 0.9, c.b * 0.9, 0.4);
        ps.colorDead = new BABYLON.Color4(c.r, c.g, c.b, 0);
        ps.minSize = 14; ps.maxSize = 34;
        ps.minLifeTime = 0.5; ps.maxLifeTime = 1.1;
        ps.minEmitPower = 8; ps.maxEmitPower = 30;
        ps.direction1 = new BABYLON.Vector3(-1, 1.2, -1);
        ps.direction2 = new BABYLON.Vector3(1, 2.2, 1);
        ps.minEmitBox = new BABYLON.Vector3(-4, 0, -4);
        ps.maxEmitBox = new BABYLON.Vector3(4, 4, 4);
        ps.addSizeGradient(0, 0.5);
        ps.addSizeGradient(1, 1.6);
        ps.blendMode = additive ? BABYLON.ParticleSystem.BLENDMODE_ADD : BABYLON.ParticleSystem.BLENDMODE_STANDARD;
        ps.emitRate = 0;
        ps.updateSpeed = 1 / 60;
        ps.start();
        return ps;
    }

    _setupSparks() {
        const s = this.sparks;
        s.minSize = 3; s.maxSize = 7;
        s.minLifeTime = 0.2; s.maxLifeTime = 0.5;
        s.minEmitPower = 120; s.maxEmitPower = 260;
        s.gravity = new BABYLON.Vector3(0, -600, 0);
        s.direction1 = new BABYLON.Vector3(-1, 0.6, -1);
        s.direction2 = new BABYLON.Vector3(1, 1.6, 1);
        s.color1 = new BABYLON.Color4(1, 0.85, 0.45, 1);
        s.color2 = new BABYLON.Color4(1, 0.55, 0.2, 1);
        s.colorDead = new BABYLON.Color4(1, 0.3, 0.1, 0);
        s.removeSizeGradient(0); s.removeSizeGradient(1);
    }

    // Mud splash: heavy dark clods thrown up and back, falling fast.
    _setupSplash() {
        const s = this.splash;
        s.minSize = 6; s.maxSize = 16;
        s.minLifeTime = 0.35; s.maxLifeTime = 0.8;
        s.minEmitPower = 60; s.maxEmitPower = 160;
        s.gravity = new BABYLON.Vector3(0, -700, 0);
        s.direction1 = new BABYLON.Vector3(-1, 1.6, -1);
        s.direction2 = new BABYLON.Vector3(1, 3, 1);
        s.removeSizeGradient(0); s.removeSizeGradient(1);
    }

    // Contact uses map-space height/normal. Legacy calls still mean a metal collision.
    // Ground bursts never share an emitter with the continuously updated tyre particles.
    impact(x, y, strength, contact) {
        const c = contact || {}, ground = c.material && c.material !== 'metal';
        const s = ground ? this.groundImpact : this.sparks;
        const height = Number.isFinite(c.height) ? c.height : 12;
        /** @type {BABYLON.Vector3} */ (s.emitter).set(x, height, y);
        if (ground) {
            const source = (this.propColors && this.propColors[c.material]) ||
                (c.material === 'mud' || c.material === 'slush' ? this.splash
                : c.material === 'asphalt' || c.material === 'kerb' ? this.smoke : this.dust);
            s.color1 = source.color1; s.color2 = source.color2; s.colorDead = source.colorDead;
            const n = c.normal || { x: 0, y: 0, z: 1 };
            s.direction1.set(n.x - 1, n.z, n.y - 1);
            s.direction2.set(n.x + 1, n.z * 2, n.y + 1);
        }
        s.manualEmitCount = Math.round((this.low ? 10 : 26) * Math.max(0.2, Math.min(1, strength)));
    }

    // --- Per frame -------------------------------------------------------------

    update(dt, car, wheels, surface) {
        this._clock += dt || 0;
        const spd = car.speed, ground = !car.air;
        const mud = ground && surface === 'mud';
        const loose = ground && !mud && (surface === 'grass' || (this.loose && surface !== 'kerb'));
        const sliding = ground && car.skid > 0.3 && spd > 40;
        this.trail(car, wheels, surface);
        if (this._clock >= this._sweepAt) { this._sweep(); this._sweepAt = this._clock + 0.25; }
        this.flush();

        const mid = { x: (wheels[0].x + wheels[1].x) / 2, y: (wheels[0].y + wheels[1].y) / 2 };
        const k = this.low ? 0.4 : 1, z = (car.z || 0) + 4;
        // Smoke from sliding on the tarmac.
        /** @type {BABYLON.Vector3} */ (this.smoke.emitter).set(mid.x, z, mid.y);
        this.smoke.emitRate = sliding && !loose && !mud ? 160 * car.skid * k : 0;
        // Dust on loose ground: more when sliding.
        /** @type {BABYLON.Vector3} */ (this.dust.emitter).set(mid.x, z, mid.y);
        this.dust.emitRate = loose && spd > 60 ? Math.min(260, spd * (0.35 + car.skid * 0.5)) * k : 0;
        // Mud clods flying off the tyres.
        /** @type {BABYLON.Vector3} */ (this.splash.emitter).set(mid.x, z, mid.y);
        this.splash.emitRate = mud && spd > 30 ? Math.min(300, spd * 0.7) * k : 0;
    }

    // Upload changed mark buffers (once per frame, after all trail() calls).
    flush() {
        for (const key in this.pools) {
            const P = this.pools[key];
            if (P.dirty) { P.inst.flush(); P.dirty = false; }
        }
    }

    dispose() {
        this.smoke.dispose(); this.dust.dispose(); this.groundImpact.dispose(); this.sparks.dispose(); this.splash.dispose();
        for (const key in this.pools) {
            const P = this.pools[key];
            P.inst.dispose();
            try { P.mat.dispose(); P.quad.dispose(); } catch (e) { /* ok */ }
        }
    }
}

RaceFx.HIDDEN = { x: -9999, y: -9999, h: -50, heading: 0, scale: 0.001 };
RaceFx.MARK_OFFSCREEN_SEC = 4;   // s a mark must stay out of the frame before it disappears
