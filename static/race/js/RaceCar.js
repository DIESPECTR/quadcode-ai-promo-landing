// RaceCar.js — arcade car physics on the map plane. Pure math, no Babylon (tests/race.test.mjs).
// The velocity lives in WORLD space; turning rotates only the heading, so the car slides
// until lateral grip pulls the velocity back in line — that is the drift. Handbrake and
// grass lower the grip. Numbers — GAME_CAR_* in Constants.js (defaults below).
//
//     const car = new RaceCar();  car.place(x, y, heading);
//     car.step(dt, { throttle, brake, steer, handbrake }, 'road');
//     car.collideWall(track.project(car.x, car.y, hint), track.wall);   // -> impact px/s

class RaceCar {
    // Handling numbers. type 'bike' — a dirt bike: quicker off the line, sharper turn-in,
    // looser on loose ground, light in contacts (see RaceCar.collide) and it can WIPE OUT on a
    // bad landing. 'mud' — deep mud zones of the off-road tracks: the car bogs down.
    static cfg(type) {
        const U = 'undefined';
        const c = {
            top: typeof GAME_CAR_TOP_SPEED !== U ? GAME_CAR_TOP_SPEED : 560,
            accel: typeof GAME_CAR_ACCEL !== U ? GAME_CAR_ACCEL : 360,
            brake: typeof GAME_CAR_BRAKE !== U ? GAME_CAR_BRAKE : 700,
            reverse: typeof GAME_CAR_REVERSE_SPEED !== U ? GAME_CAR_REVERSE_SPEED : 150,
            turn: typeof GAME_CAR_TURN_RATE !== U ? GAME_CAR_TURN_RATE : 2.7,
            grip: typeof GAME_CAR_GRIP !== U ? GAME_CAR_GRIP : 11,
            drift: typeof GAME_CAR_HANDBRAKE_GRIP !== U ? GAME_CAR_HANDBRAKE_GRIP : 0.2,
            grassGrip: typeof GAME_GRASS_GRIP !== U ? GAME_GRASS_GRIP : 0.55,
            grassTop: typeof GAME_GRASS_TOP_SPEED !== U ? GAME_GRASS_TOP_SPEED : 0.5,
            mudGrip: typeof GAME_MUD_GRIP !== U ? GAME_MUD_GRIP : 0.5,
            mudTop: typeof GAME_MUD_TOP_SPEED !== U ? GAME_MUD_TOP_SPEED : 0.55,
            mudDrag: typeof GAME_MUD_DRAG !== U ? GAME_MUD_DRAG : 0.7,
        };
        if (type === 'bike') {
            c.top *= 1.05; c.accel *= 1.22; c.brake *= 0.9; c.turn *= 1.18; c.grip *= 0.92;
            c.drift = 0.3; c.grassGrip *= 0.9; c.mudGrip *= 0.8; c.mudTop *= 0.95;
        }
        return c;
    }

    /** @param {'car'|'bike'} [type] */
    constructor(type) {
        this.type = type === 'bike' ? 'bike' : 'car';
        this.radius = this.type === 'bike' ? 15 : 22;   // px: capsule radius; props retain circular contacts
        const length = this.type === 'bike'
            ? (typeof GAME_BIKE_COLLISION_LENGTH !== 'undefined' ? GAME_BIKE_COLLISION_LENGTH : 56)
            : (typeof GAME_CAR_COLLISION_LENGTH !== 'undefined' ? GAME_CAR_COLLISION_LENGTH : 76);
        this.halfSegment = Math.max(0, length / 2 - this.radius);
        this.mass = this.type === 'bike' ? 0.5 : 1;      // contacts: a bike gets thrown around
        this.c = RaceCar.cfg(this.type);
        this.place(0, 0, 0);
    }

    place(x, y, heading) {
        this.x = x; this.y = y; this.heading = heading;
        this.vx = 0; this.vy = 0;
        this.yawRate = 0;
        this.steer = 0;            // smoothed −1..1
        this.fwd = 0;              // px/s along the heading (last step)
        this.lat = 0;              // px/s sideways — slip
        this.accelLong = 0;        // px/s² — for the body pitch
        this.accelLat = 0;         // px/s² — for the body roll
        this.wheelSpin = 0;        // rad — wheel rotation for the visuals
        this.skid = 0;             // 0..1 — how hard the tyres are sliding (marks, smoke, sound)
        this.z = 0;                // px: height of the car (road height on the ground, more in the air)
        this.vz = 0;               // px/s: vertical speed
        this.air = false;          // airborne after a jump
        this.airTime = 0;          // s in the current flight
        this.pitchAir = 0;         // rad: nose pitch in flight (visual)
        this.crash = 0;            // s left of a bike wipeout (no control, rider down)
        this.crashed = false;      // set on the step the wipeout starts (Game: toast, sound)
        this.pitchCtl = 0;         // rad: player's air pitch input (S pulls the nose up)
        this.pitchGround = 0;      // rad: body pitch following the road slope (visual)
        this.susp = 0;             // px: suspension travel (− compressed), visual body bounce
        this.suspV = 0;
        this.landing = '';         // last landing: 'perfect' | 'ok' | 'bad'
        this.landed = false;       // set on the step of a landing (Game: callouts)
        this.boosting = false;
        if (this.boost == null) this.boost = RaceCar.BOOST_START;   // 0..1 — kept by recover()
        if (this.gripScale == null) this.gripScale = 1;   // track surface grip (dirt, snow)
        this._snap = true;
    }

    // Boost meter: earned by smashing props, air time, perfect landings and drifting.
    addBoost(v) { this.boost = Math.max(0, Math.min(1, this.boost + v)); }

    // Vertical motion over the road height `ground` (px) under the car after step().
    // On the ground the car follows the road; when the road falls away faster than gravity can
    // pull the car down (the lip of a ramp, a crest at speed) it takes off and flies ballistic.
    // -> landing impact (px/s downward relative to the road, 0 — no landing this step).
    // slope — road rise per px along the car's heading (0 — flat): the body pitches with it on
    // the ground, and a landing is judged against it (nose matched to the slope = PERFECT).
    updateHeight(ground, dt, slope) {
        const G = RaceCar.GRAVITY;
        this.landed = false;
        if (dt <= 0) return 0;
        const slopeA = Math.atan(slope || 0);
        if (this._snap !== false) {           // just placed: stand on the road, no launch
            this._snap = false;
            this.z = ground; this.vz = 0; this.air = false;
            this.pitchGround = slopeA;
            return 0;
        }
        if (!this.air) {
            // Road climb rate, limited by what a real slope can give at this speed: the height
            // profile runs along the centerline distance, which races ahead of the car on the
            // inside of a tight corner — unclamped, a crest there fired the car into orbit.
            const lim = this.speed * RaceCar.MAX_ROAD_SLOPE + 60;
            const vzRoad = Math.max(-lim, Math.min(lim, RaceCar.MAX_LAUNCH_VZ, (ground - this.z) / dt));
            if (vzRoad < this.vz - G * dt - 30 && this.speed > 120) {
                this.air = true;
                this.airTime = 0;
                this.pitchAir = this.pitchGround;   // leaves the lip nose-up, as the ramp was
                this.pitchGround = 0;
                this.pitchCtl = 0;
                this.vz -= G * dt;
                this.z += this.vz * dt;
                return 0;
            }
            this.vz = vzRoad;
            this.z = ground;
            this.pitchAir *= Math.exp(-10 * dt);
            this.pitchGround += (slopeA - this.pitchGround) * (1 - Math.exp(-14 * dt));
            this._spring(dt);
            return 0;
        }
        this.airTime += dt;
        this.vz -= G * dt;
        this.z += this.vz * dt;
        // Wheels hang on full droop in the air.
        this.susp += (4 - this.susp) * (1 - Math.exp(-6 * dt));
        this.suspV = 0;
        // Nose follows the fall; the player adds pitch (S — nose up for a flat landing).
        const want = Math.atan2(this.vz, Math.max(150, this.speed)) * 0.8 + this.pitchCtl;
        this.pitchAir += (want - this.pitchAir) * (1 - Math.exp(-3 * dt));
        if (this.z > ground) return 0;
        const impact = Math.max(0, -this.vz);
        this.z = ground;
        this.vz = 0;
        this.air = false;
        this.landed = true;
        // Landing quality: nose against the slope, body against the direction of travel.
        const vh = Math.atan2(this.vy, this.vx);
        const slip = Math.abs(Math.atan2(Math.sin(vh - this.heading), Math.cos(vh - this.heading)));
        const err = Math.abs(this.pitchAir - slopeA);
        this.landing = this.airTime > 0.35 && err < 0.24 && slip < 0.3 ? 'perfect'
            : (err > 0.62 || slip > 0.9) && impact > 200 ? 'bad' : 'ok';
        // Hard landings scrub speed; a clean one keeps it (and fills the boost), a bad one costs.
        let loss = Math.min(0.3, Math.max(0, impact - 200) / 2200);
        if (this.landing === 'perfect') { loss *= 0.25; this.addBoost(0.15); }
        else if (this.landing === 'bad') loss = Math.min(0.5, loss + 0.18);
        this.vx *= 1 - loss;
        this.vy *= 1 - loss;
        // Suspension takes the hit: the body dips and rebounds.
        this.pitchGround = this.pitchAir;
        this.pitchAir = 0;
        this.suspV = -Math.min(900, impact * 0.45);
        // Bike: land too hard, or crossed up / nose-first — wipeout.
        if (this.type === 'bike' && this.speed > 60) {
            if (impact > RaceCar.BIKE_CRASH_IMPACT || (impact > 260 && (slip > 0.75 || this.landing === 'bad'))) this.wipeout();
        }
        return impact;
    }

    // Visual suspension: an under-damped spring around 0 (px), kicked by landings and bumps.
    _spring(dt) {
        const K = 240, D = 2 * Math.sqrt(K) * 0.32;
        this.suspV += (-K * this.susp - D * this.suspV) * dt;
        this.susp = Math.max(-14, Math.min(6, this.susp + this.suspV * dt));
    }

    get speed() { return Math.hypot(this.vx, this.vy); }

    // Bike down: most of the speed gone, no control for RaceCar.CRASH_SEC.
    wipeout() {
        if (this.crash > 0 || !RaceCar.BIKE_WIPEOUTS) return;
        this.crash = RaceCar.CRASH_SEC;
        this.crashed = true;
        this.vx *= 0.3; this.vy *= 0.3;
        this.yawRate = 0;
    }

    /**
     * @param {number} dt s
     * @param {{ throttle?: number, brake?: number, steer?: number, handbrake?: boolean, boost?: boolean }} input
     * @param {string} surface 'road' | 'kerb' | 'grass' | 'mud'
     */
    step(dt, input, surface) {
        this.crashed = false;
        if (this.crash > 0) {
            // Sliding on the ground after a wipeout: friction only, then back up.
            this.crash = Math.max(0, this.crash - dt);
            input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
        }
        if (this.air) return this._stepAir(dt, input);
        const c = this.c, grass = surface === 'grass', mud = surface === 'mud';
        const gripK = (grass ? c.grassGrip : mud ? c.mudGrip : surface === 'kerb' ? 0.85 : 1) * this.gripScale;
        const throttle = Math.max(0, Math.min(1, input.throttle || 0));
        const brake = Math.max(0, Math.min(1, input.brake || 0));
        // Boost (MotorStorm): more push and a higher ceiling while the meter lasts.
        this.boosting = !!input.boost && this.boost > 0 && throttle > 0 && this.crash <= 0;
        if (this.boosting) this.boost = Math.max(0, this.boost - RaceCar.BOOST_DRAIN * dt);
        const top = c.top * (grass ? c.grassTop : mud ? c.mudTop : 1) * (this.boosting ? RaceCar.BOOST_TOP : 1);
        const hx = Math.cos(this.heading), hy = Math.sin(this.heading);
        let fwd = this.vx * hx + this.vy * hy;
        let lat = -this.vx * hy + this.vy * hx;

        // Steering: eases toward the input, back to centre faster.
        const target = Math.max(-1, Math.min(1, input.steer || 0));
        const rate = Math.abs(target) > Math.abs(this.steer) ? 7 : 11;
        this.steer += (target - this.steer) * (1 - Math.exp(-rate * dt));

        // Longitudinal force.
        let a = 0;
        if (throttle > 0) {
            if (fwd < 0) a += c.brake * throttle;                        // stop rolling back first
            else {
                const k = Math.min(1, fwd / top);
                a += c.accel * throttle * (1 - k * k);
                if (this.boosting) a += c.accel * 0.9 * (fwd < top ? 1 : 0);
            }
        }
        if (brake > 0) {
            if (fwd > 15) a -= c.brake * brake;
            else if (fwd > -c.reverse) a -= c.accel * 0.6 * brake;       // reverse
        }
        if (fwd > top) a -= (fwd - top) * 2.5;                           // grass bleeds speed
        if (input.handbrake) a -= Math.sign(fwd) * 260;
        a -= fwd * 0.12 + (throttle || brake ? 0 : Math.sign(fwd) * 70); // drag + rolling
        if (mud) a -= fwd * c.mudDrag;                                   // deep mud sucks at the tyres
        if (this.crash > 0) a -= Math.sign(fwd) * 500;                   // rider sliding on the ground
        const before = fwd;
        fwd += a * dt;
        if (!throttle && !brake && Math.sign(fwd) !== Math.sign(before)) fwd = 0;  // no creep
        this.accelLong = (fwd - before) / Math.max(1e-6, dt);

        // Lateral grip: slip decays exponentially; the handbrake lets the rear go.
        const latGrip = c.grip * gripK * (input.handbrake ? c.drift : 1);
        lat *= Math.exp(-latGrip * dt);

        this.vx = hx * fwd - hy * lat;
        this.vy = hy * fwd + hx * lat;

        // Yaw: needs speed, gets lazier at the top end; reversing flips it.
        const spd = Math.abs(fwd);
        const low = Math.min(1, spd / 140), high = 1 / (1 + spd / 900);
        const yawTarget = this.steer * c.turn * low * high * Math.sign(fwd || 1) *
            (input.handbrake ? 1.35 : 1) * (grass ? 0.8 : mud ? 0.7 : 1);
        this.yawRate += (yawTarget - this.yawRate) * (1 - Math.exp(-9 * dt));
        this.heading += this.yawRate * dt;

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.fwd = fwd;
        this.lat = lat;
        this.accelLat = fwd * this.yawRate;
        this.wheelSpin += fwd * dt / 9;    // wheel radius ~9 px
        const slide = Math.max(0, Math.abs(lat) - 45) / 160;
        const lock = brake > 0 && fwd > 220 ? 0.35 : 0;
        const burn = throttle > 0 && fwd < 120 && fwd >= 0 ? 0.25 : 0;
        this.skid = Math.min(1, slide + lock + burn + (input.handbrake && spd > 80 ? 0.4 : 0));
        // A committed slide at speed earns boost (not wheelspin, not braking).
        if (slide > 0.25 && spd > 220) this.addBoost(0.09 * dt);
        // Rough ground shakes the body (visual suspension).
        if (surface !== 'road' || this.gripScale < 1) this.suspV += (Math.random() - 0.5) * spd * (mud ? 0.5 : 0.25) * dt * 60 * 0.12;
    }

    // In flight: no traction, no grip — the velocity carries on (light drag); steering only
    // yaws the body a little (air control), so the landing angle is the player's call.
    _stepAir(dt, input) {
        const target = Math.max(-1, Math.min(1, input.steer || 0));
        this.steer += (target - this.steer) * (1 - Math.exp(-7 * dt));
        this.yawRate += (this.steer * 1.4 - this.yawRate) * (1 - Math.exp(-4 * dt));
        this.heading += this.yawRate * dt;
        // Air pitch: S (brake) pulls the nose up — flat landings after crests; released, it
        // settles back and the nose follows the fall (lines up with downhill landings itself).
        const pull = Math.max(0, Math.min(1, input.brake || 0));
        this.pitchCtl += (pull * 0.75 - this.pitchCtl) * (1 - Math.exp(-(pull ? 3 : 1.5) * dt));
        this.boosting = false;
        this.addBoost(0.1 * dt);       // hang time pays
        const drag = Math.exp(-0.05 * dt);
        this.vx *= drag; this.vy *= drag;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const hx = Math.cos(this.heading), hy = Math.sin(this.heading);
        this.fwd = this.vx * hx + this.vy * hy;
        this.lat = -this.vx * hy + this.vy * hx;
        this.accelLong = 0;
        this.accelLat = 0;
        // Wheels spin freely in the air; throttle revs them up (looks and sounds right).
        this.wheelSpin += (this.fwd + (input.throttle ? 200 : 0)) * dt / 9;
        this.skid = 0;
    }

    // Capsule contact: closest points on the longitudinal body segments, expanded by radius.
    // Pure map-space geometry; rendering and frame rate do not participate in contact decisions.
    static contact(a, b) {
        if (Math.abs((a.z || 0) - (b.z || 0)) > 30) return null;
        const ha = a.halfSegment || 0, hb = b.halfSegment || 0;
        const ax = Math.cos(a.heading), ay = Math.sin(a.heading);
        const bx = Math.cos(b.heading), by = Math.sin(b.heading);
        const dx = b.x - a.x, dy = b.y - a.y, r = a.radius + b.radius;
        if (dx * dx + dy * dy >= (ha + hb + r) ** 2) return null;
        const ux = 2 * ha * ax, uy = 2 * ha * ay, vx = 2 * hb * bx, vy = 2 * hb * by;
        const rx = a.x - ha * ax - b.x + hb * bx, ry = a.y - ha * ay - b.y + hb * by;
        const aa = ux * ux + uy * uy, bb = vx * vx + vy * vy;
        const ab = ux * vx + uy * vy, ar = ux * rx + uy * ry, br = vx * rx + vy * ry;
        const clamp = (v) => Math.max(0, Math.min(1, v));
        let s = 0, t = 0;
        if (aa < 1e-8) t = bb < 1e-8 ? 0 : clamp(br / bb);
        else if (bb < 1e-8) s = clamp(-ar / aa);
        else {
            const den = aa * bb - ab * ab;
            s = den > 1e-8 ? clamp((ab * br - bb * ar) / den) : 0;
            t = (ab * s + br) / bb;
            if (t < 0) { t = 0; s = clamp(-ar / aa); }
            else if (t > 1) { t = 1; s = clamp((ab - ar) / aa); }
        }
        const cx = -rx + vx * t - ux * s, cy = -ry + vy * t - uy * s;
        const d = Math.hypot(cx, cy);
        if (d >= r) return null;
        if (d > 1e-6) return { nx: cx / d, ny: cy / d, pen: r - d };
        // Crossing/collinear segments: the nearest-point normal is undefined. Choose a
        // separating support axis instead; even identical parked vehicles separate finitely.
        let pen = Infinity, nx = 0, ny = 1;
        for (const n of [[-ay, ax], [-by, bx], [ax, ay], [bx, by]]) {
            const dot = dx * n[0] + dy * n[1];
            const overlap = r + ha * Math.abs(ax * n[0] + ay * n[1]) +
                hb * Math.abs(bx * n[0] + by * n[1]) - Math.abs(dot);
            if (overlap < pen) {
                const sign = dot < 0 ? -1 : 1;
                pen = overlap; nx = n[0] * sign; ny = n[1] * sign;
            }
        }
        return { nx, ny, pen };
    }

    // Separate capsule bodies and exchange normal velocity (slightly bouncy).
    // Returns closing speed (px/s, 0 for a resting overlap); different heights can pass over.
    static collide(a, b) {
        const contact = RaceCar.contact(a, b);
        if (!contact) return 0;
        const { nx, ny, pen } = contact;
        // Mass shares: the lighter vehicle (bike) moves and changes speed more.
        const ma = a.mass || 1, mb = b.mass || 1, wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.x -= nx * pen * wa; a.y -= ny * pen * wa;
        b.x += nx * pen * wb; b.y += ny * pen * wb;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn >= 0) return 0;
        const j = -vn * 1.2;                     // (1 + e) with e = 0.2, split by mass
        a.vx -= nx * j * wa; a.vy -= ny * j * wa;
        b.vx += nx * j * wb; b.vy += ny * j * wb;
        // A side hit spins the struck car a little — that is the FlatOut feel.
        const spin = Math.min(1.6, -vn / 300);
        const side = (vx, vy, h) => Math.sign(-Math.sin(h) * vx + Math.cos(h) * vy) || 1;
        a.yawRate -= spin * side(nx, ny, a.heading) * 1.2 * wa;
        b.yawRate += spin * side(nx, ny, b.heading) * 1.2 * wb;
        // A hard hit knocks a rider off.
        if (-vn > RaceCar.BIKE_KNOCK) {
            if (a.type === 'bike' && wa >= 0.5) a.wipeout();
            if (b.type === 'bike' && wb >= 0.5) b.wipeout();
        }
        return -vn;
    }

    // Walls follow the track at `wall` px from the centerline. p — track.project() of the car.
    // Pushes the car back inside, kills the velocity INTO the wall with a small bounce and
    // scrapes some speed along it. -> impact speed (px/s, 0 — no contact).
    collideWall(p, wall) {
        const support = this.radius + this.halfSegment *
            Math.abs(-p.ty * Math.cos(this.heading) + p.tx * Math.sin(this.heading));
        const limit = wall - support;
        if (Math.abs(p.lat) <= limit) return 0;
        const side = Math.sign(p.lat);
        const nx = -p.ty * side, ny = p.tx * side;             // outward normal
        const pen = Math.abs(p.lat) - limit;
        this.x -= nx * pen;
        this.y -= ny * pen;
        const vn = this.vx * nx + this.vy * ny;
        if (vn <= 0) return 0;
        this.vx -= nx * vn * 1.25;
        this.vy -= ny * vn * 1.25;
        const scrape = 1 - Math.min(0.35, vn / 900);
        this.vx *= scrape;
        this.vy *= scrape;
        this.yawRate *= 0.4;
        return vn;
    }
}

RaceCar.GRAVITY = 760;   // px/s²: a little floaty on purpose — big off-road jumps hang in the air
RaceCar.BIKE_CRASH_IMPACT = 720;   // px/s downward on landing: a bike rider goes down
RaceCar.BIKE_KNOCK = 330;          // px/s closing speed: a car hit knocks a rider off
RaceCar.CRASH_SEC = 1.6;           // s on the ground after a wipeout
RaceCar.BIKE_WIPEOUTS = false;     // falls off the bike (landings, hits) — off until they feel fair
RaceCar.BOOST_START = 0.35;        // meter at the start of a race
RaceCar.BOOST_DRAIN = 0.3;         // meter per second while boosting (full tank ≈ 3.3 s)
RaceCar.BOOST_TOP = 1.3;           // top speed multiplier while boosting
RaceCar.MAX_ROAD_SLOPE = 1.2;      // rise per px of travel the road can push the car up (≈50°)
RaceCar.MAX_LAUNCH_VZ = 700;       // px/s: hardest take-off (≈320 px apex) — no "into orbit"
