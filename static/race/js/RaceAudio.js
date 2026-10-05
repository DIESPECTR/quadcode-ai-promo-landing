// RaceAudio.js — race sounds over Sound3D: an engine loop whose pitch follows the speed, a tyre
// skid loop by slip, material-dependent rolling contact and one-shots for race events.
// Every event also has a visible cue in the HUD — sound is never the only signal.
//
//     const audio = new RaceAudio();
//     audio.start();                      // loops begin (after the first user input)
//     audio.update(car, running);         // every frame
//     audio.play('beep');                 // one-shot by name

const RACE_SOUNDS = {
    engine: 'assets/sounds/race_engine.wav',
    skid: 'assets/sounds/race_skid.wav',
    surfaceDirt: 'assets/sounds/race_surface_dirt.wav',
    surfaceMud: 'assets/sounds/race_surface_mud.wav',
    landingDirt: 'assets/sounds/race_landing_dirt.wav',
    landingMud: 'assets/sounds/race_landing_mud.wav',
    impact: 'assets/sounds/race_impact.wav',
    beep: 'assets/sounds/race_beep.wav',
    go: 'assets/sounds/race_go.wav',
    lap: 'assets/sounds/race_lap.wav',
    finish: 'assets/sounds/race_finish.wav',
    click: 'assets/sounds/ui_click.wav',
};

class RaceAudio {
    constructor(materialAt = () => '') {
        this.engine = null;
        this.skid = null;
        this.dirt = null;
        this.mud = null;
        this._materialAt = materialAt;
        this._rate = 0.6;
    }

    start() {
        if (this.engine) return;
        this.engine = Sound3D.play(RACE_SOUNDS.engine, { loop: true, volume: 0.35 });
        this.skid = Sound3D.play(RACE_SOUNDS.skid, { loop: true, volume: 0 });
        this.dirt = Sound3D.play(RACE_SOUNDS.surfaceDirt, { loop: true, volume: 0 });
        this.mud = Sound3D.play(RACE_SOUNDS.surfaceMud, { loop: true, volume: 0 });
    }

    stop() {
        if (this.engine) this.engine.stop();
        if (this.skid) this.skid.stop();
        if (this.dirt) this.dirt.stop();
        if (this.mud) this.mud.stop();
        this.engine = this.skid = this.dirt = this.mud = null;
    }

    play(name, volume) {
        const src = RACE_SOUNDS[name];
        if (src) Sound3D.play(src, { volume: volume == null ? 0.7 : volume });
    }

    // car — RaceCar; running — the race clock runs (idle hum otherwise).
    update(car, running, throttle) {
        if (!this.engine) return;
        const top = car.c.top, k = Math.min(1.2, Math.abs(car.fwd) / top);
        // Two fake gears: pitch climbs, drops a little at the shift point, climbs again.
        const gear = k < 0.45 ? k / 0.45 : (k - 0.45) / 0.75;
        const target = 0.62 + gear * 0.75 + (throttle ? 0.06 : 0);
        this._rate += (target - this._rate) * 0.15;
        const src = this.engine.source;
        if (src) src.playbackRate.value = this._rate;
        this.engine.setVolume(0.22 + (throttle ? 0.2 : 0.08) + k * 0.12);
        if (this.skid) this.skid.setVolume(running ? Math.min(0.6, car.skid * 0.7) : 0);
        // Only grounded, moving tyres make contact noise. Unknown surfaces stay silent.
        // SoundHandle.setVolume smooths both sides of a material change with Sound3D.FADE.
        const material = this._materialAt();
        const contact = running && !car.air && !car.crash && car.speed > 20;
        const roll = contact ? Math.min(1, car.speed / Math.max(1, top)) : 0;
        if (this.dirt) this.dirt.setVolume(material === 'dirt' ? roll * 0.12 : 0);
        if (this.mud) this.mud.setVolume(material === 'mud' ? roll * 0.18 : 0);
        for (const handle of [this.dirt, this.mud]) if (handle && handle.source) {
            handle.source.playbackRate.value = 0.85 + roll * 0.35;
        }
    }
}
