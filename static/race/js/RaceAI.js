// RaceAI.js — rival drivers. Pure math, no Babylon (tests/race.test.mjs). Each rival is a
// RaceCar with the same physics as the player; RaceAI only produces its input:
//   steering  — toward a point ahead on its own racing lane (lookahead grows with speed);
//   speed     — the tightest curvature ahead sets a corner speed (v = sqrt(aLat / k)),
//               throttle below it, brake above it;
//   recovery  — stuck against a wall: reverse out; still stuck — back on the centerline;
//   rubber band — a mild skill nudge from the gap to the player keeps the pack together.
//
//     const ai = new RaceAI(track, car, { skill: 0.95, lane: -30, seed: 2 });
//     const input = ai.drive(dt, playerProgress);   // then car.step(dt, input, surface)

class RaceAI {
    /**
     * @param {RaceTrack} track
     * @param {RaceCar} car
     * @param {{ skill?: number, lane?: number, seed?: number, aggression?: number }} [opts]
     */
    constructor(track, car, opts) {
        const o = opts || {};
        this.track = track;
        this.car = car;
        this.skill = o.skill != null ? o.skill : 0.92;     // 0.8 (slow) .. 1.05 (fast)
        this.lane = o.lane || 0;                           // px: preferred lateral offset
        this.aggression = o.aggression != null ? o.aggression : 0.5;
        this.phase = ((o.seed || 1) * 1.7) % 6.28;
        this.proj = null;
        this.progress = null;        // RaceProgress — set by Game (positions, laps)
        this.stuck = 0;              // s nearly stopped while trying to drive
        this.reverse = 0;            // s left of reversing out
        this.band = 1;               // rubber band multiplier
        this.baseTop = car.c.top;
    }

    reset() {
        this.proj = this.track.project(this.car.x, this.car.y);
        this.stuck = 0;
        this.reverse = 0;
        this.band = 1;
    }

    // Corner speed (px/s) for the tightest curvature within `ahead` px of s.
    cornerSpeed(s, ahead) {
        const t = this.track, i0 = Math.round(s / t.ds), n = Math.ceil(ahead / t.ds);
        let kMax = 1e-5;
        for (let k = 0; k <= n; k += 2) kMax = Math.max(kMax, Math.abs(t.curvature(i0 + k)));
        const aLat = 950 * (this.car.gripScale || 1) * this.skill * this.band;
        return Math.sqrt(aLat / kMax);
    }

    /**
     * @param {number} dt
     * @param {number} [playerProgress] the player's RaceProgress.progress (rubber band)
     * @returns {{ throttle: number, brake: number, steer: number, handbrake: boolean }}
     */
    drive(dt, playerProgress) {
        const car = this.car, t = this.track;
        this.proj = t.project(car.x, car.y, this.proj ? this.proj.i : undefined);
        const p = this.proj, spd = car.speed;

        // Rubber band: ahead of the player by > 1/8 lap — ease off; far behind — push.
        if (this.progress && playerProgress != null) {
            const gap = this.progress.progress - playerProgress, L = t.length;
            const want = gap > L * 0.12 ? 0.93 : gap < -L * 0.12 ? 1.07 : 1;
            this.band += (want - this.band) * Math.min(1, dt * 0.5);
        }
        car.c.top = this.baseTop * (0.9 + 0.1 * this.skill) * this.band;

        // Recovery: reversing out of a wall.
        if (this.reverse > 0) {
            this.reverse -= dt;
            const side = Math.sign(p.lat) || 1;
            return { throttle: 0, brake: 1, steer: side, handbrake: false };
        }

        // Target point on the lane ahead. The lane breathes a little so rivals don't drive
        // like trains, and pulls toward the inside of the coming corner.
        const look = 60 + spd * 0.35;
        const sT = p.s + look;
        const curvAhead = t.curvature(Math.round(sT / t.ds));
        const inside = Math.sign(curvAhead) * Math.min(1, Math.abs(curvAhead) / 0.004) * 40;
        let lane = this.lane + Math.sin(p.s / 500 + this.phase) * 18 + inside;
        const limit = t.halfWidth - car.radius - 6;
        lane = Math.max(-limit, Math.min(limit, lane));
        const q = t.pointAt(sT);
        const tx = q.x - q.ty * lane, ty = q.y + q.tx * lane;
        const want = Math.atan2(ty - car.y, tx - car.x);
        const err = Math.atan2(Math.sin(want - car.heading), Math.cos(want - car.heading));
        const steer = Math.max(-1, Math.min(1, err * 2.4));

        // Speed for the corners ahead (longer look at speed: braking distance).
        const vMax = Math.min(car.c.top, this.cornerSpeed(p.s, 140 + spd * 0.7));
        let throttle = 0, brake = 0;
        if (spd < vMax - 15) throttle = 1;
        else if (spd > vMax + 40) brake = Math.min(1, (spd - vMax) / 150);
        else throttle = 0.4;
        // Off the road: lift a little and steer back (the lane target already pulls in).
        if (Math.abs(p.lat) > t.halfWidth + t.kerb) throttle = Math.min(throttle, 0.8);
        // Big steering error at speed (after a spin, a hit) — brake and a dab of handbrake.
        const handbrake = Math.abs(err) > 0.9 && spd > 200 && this.aggression > 0.3;
        if (Math.abs(err) > 1.3) { throttle = 0.5; brake = 0; }

        // Stuck detection (only while trying to go).
        if (spd < 30 && !car.air) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
        if (this.stuck > 1.2 && this.stuck < 1.3) this.reverse = 0.8;
        if (this.stuck > 4) this.respawn();

        return { throttle, brake, steer, handbrake };
    }

    // Back on the centerline at the current progress point, facing the right way.
    respawn() {
        const p = this.track.pointAt(this.proj ? this.proj.s : 0);
        this.car.place(p.x - p.ty * this.lane * 0.5, p.y + p.tx * this.lane * 0.5, Math.atan2(p.ty, p.tx));
        if (this.progress) this.progress.lastS = this.proj ? this.proj.s : 0;
        this.stuck = 0;
        this.reverse = 0;
    }
}

// Rival roster: name, paint, skill. Game takes the first N.
const RACE_RIVALS = [
    { name: 'Vex', color: '#3c7fd1', skill: 0.97, aggression: 0.8 },
    { name: 'Moss', color: '#4fb35a', skill: 0.92, aggression: 0.4 },
    { name: 'Rook', color: '#f2c14e', skill: 0.95, aggression: 0.6 },
    { name: 'Nova', color: '#a35bd6', skill: 0.89, aggression: 0.5 },
    { name: 'Blaze', color: '#f08a2c', skill: 1.0, aggression: 0.9 },
];
