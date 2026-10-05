// Game.js — Arc Race: a time trial on the Valley Circuit. States: menu -> countdown -> race
// (pause) -> results. Physics — RaceCar.js, track and lap counting — RaceTrack.js, visuals —
// RaceScene.js, effects — RaceFx.js, sound — RaceAudio.js. Records and settings — Store.
// Map x/y are Babylon x/z (skill world3d).

const RACE_TEXT = {
    en: {
        lap: 'LAP {n}/{of}', best: 'BEST {t}', noBest: 'BEST —', start: 'START', again: 'AGAIN', menu: 'MENU',
        resume: 'RESUME', restart: 'RESTART', pause: 'PAUSE', finish: 'FINISH', go: 'GO!', sub: 'Valley Circuit · {n} laps',
        records: 'Best race {race}\nBest lap {lap}', noRecords: 'No records yet — set the first one',
        sound: 'SOUND: {v}', quality: 'QUALITY: {v}', motion: 'MOTION: {v}', on: 'ON', off: 'OFF', high: 'HIGH', low: 'LOW',
        full: 'FULL', reduced: 'REDUCED', lang: 'LANGUAGE: EN',
        controls: 'W/↑ gas · S/↓ brake (in the air: nose up) · A D/← → steer\nShift/E boost · Space handbrake · R back on track · Esc pause',
        controlsTouch: 'GAS / BRK — right thumb · ◀ ▶ — left thumb · DRIFT — handbrake · NOS — boost',
        hint: 'Shift — boost (smash, jump, drift to fill) · Space — drift · R — back on track',
        wrong: 'WRONG WAY', offTrack: 'OFF TRACK', recoverBlocked: 'ROAD BLOCKED — RETRY', lastLap: 'FINAL LAP', lapTime: 'Lap {n}: {t}',
        newRecord: 'NEW RECORD!', record: 'Record: {t}', medal: { gold: '★ GOLD', silver: '★ SILVER', bronze: '★ BRONZE', none: 'Gold: {t}' },
        track: 'TRACK: {v}', rivals: 'RIVALS: {v}', pos: 'POS {n}/{of}', place: 'PLACE {n}/{of}', top3: 'Top 3 for a medal',
        air: 'AIR {t}s!', subTrack: '{track} · {n} laps',
        vehicle: 'RIDE: {v}', car: 'BUGGY', bike: 'DIRT BIKE', wipeout: 'WIPEOUT!', mud: 'MUD!',
        smash: 'SMASH ×{n}', perfect: 'PERFECT LANDING! +BOOST', bad: 'BAD LANDING',
    },
    ru: {
        lap: 'КРУГ {n}/{of}', best: 'ЛУЧШИЙ {t}', noBest: 'ЛУЧШИЙ —', start: 'СТАРТ', again: 'ЕЩЁ РАЗ', menu: 'МЕНЮ',
        resume: 'ПРОДОЛЖИТЬ', restart: 'ЗАНОВО', pause: 'ПАУЗА', finish: 'ФИНИШ', go: 'ПОЕХАЛИ!', sub: 'Долина · кругов: {n}',
        records: 'Лучшая гонка {race}\nЛучший круг {lap}', noRecords: 'Рекордов пока нет — поставь первый',
        sound: 'ЗВУК: {v}', quality: 'ГРАФИКА: {v}', motion: 'ДВИЖЕНИЕ: {v}', on: 'ВКЛ', off: 'ВЫКЛ', high: 'ВЫС', low: 'НИЗ',
        full: 'ПОЛНОЕ', reduced: 'МЕНЬШЕ', lang: 'ЯЗЫК: RU',
        controls: 'W/↑ газ · S/↓ тормоз (в воздухе: нос вверх) · A D/← → руль\nShift/E нитро · Пробел ручник · R на трассу · Esc пауза',
        controlsTouch: 'GAS / BRK — правый палец · ◀ ▶ — левый · DRIFT — ручник · NOS — нитро',
        hint: 'Shift — нитро (копится за удары, прыжки, заносы) · Пробел — занос · R — на трассу',
        wrong: 'НЕ ТУДА', offTrack: 'ВНЕ ТРАССЫ', recoverBlocked: 'НЕТ МЕСТА — ПОПРОБУЙ ЕЩЁ', lastLap: 'ПОСЛЕДНИЙ КРУГ', lapTime: 'Круг {n}: {t}',
        newRecord: 'НОВЫЙ РЕКОРД!', record: 'Рекорд: {t}', medal: { gold: '★ ЗОЛОТО', silver: '★ СЕРЕБРО', bronze: '★ БРОНЗА', none: 'Золото: {t}' },
        track: 'ТРАССА: {v}', rivals: 'СОПЕРНИКИ: {v}', pos: 'ПОЗ {n}/{of}', place: 'МЕСТО {n}/{of}', top3: 'Медаль — за топ-3',
        air: 'ПОЛЁТ {t}с!', subTrack: '{track} · кругов: {n}',
        vehicle: 'ТЕХНИКА: {v}', car: 'БАГГИ', bike: 'МОТОЦИКЛ', wipeout: 'ВЫЛЕТЕЛ!', mud: 'ГРЯЗЬ!',
        smash: 'РАЗНЁС ×{n}', perfect: 'ЧИСТОЕ ПРИЗЕМЛЕНИЕ! +НИТРО', bad: 'ПЛОХОЕ ПРИЗЕМЛЕНИЕ',
    },
};

class Game {
    constructor(app) {
        this.app = app;
        this.keys = new Set();
        this.laps = typeof GAME_LAPS !== 'undefined' ? GAME_LAPS : 3;
        this.settings = Object.assign({ sound: true, quality: 'high', motion: 'full', lang: Game.defaultLang(), track: 'valley', rivals: 3, vehicle: 'car', difficulty: 'easy' },
            Store.getJSON('arcrace.settings', {}));
        if (this.settings.vehicle !== 'bike') this.settings.vehicle = 'car';
        if (!['easy', 'normal', 'hard'].includes(this.settings.difficulty)) this.settings.difficulty = 'easy';
        this.car = new RaceCar(this.settings.vehicle);
        this.rivals = [];
        this._loadTrack(this.settings.track);
        this._makeFx();
        this.audio = new RaceAudio(() => this.track.sampleSurface(this._proj.s, this._proj.lat).material);
        this.state = 'menu';
        this.clock = 0;
        // Touch: on-screen buttons, held state per control (phones, tablets).
        this.touch = { left: false, right: false, gas: false, brake: false, drift: false, boost: false };
        this.isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) ||
            (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
        this._timers = { fps: 0, toast: 0, count: 0, wrong: 0 };
        this._hint = -1;
        this._applySettings();
        this._resetCar();
        this._bindInput();
        this._bindUI();
        this._openMenu();
    }

    static difficultyProfile(id) {
        return id === 'hard' ? { speed: 1, accel: 1, skill: 1, boost: true } :
            id === 'normal' ? { speed: 0.94, accel: 0.94, skill: 0.95, boost: true } :
            { speed: 0.82, accel: 0.85, skill: 0.88, boost: false };
    }

    static defaultLang() {
        return 'en'; // English first; explicitly saved language choices remain intact.
    }

    t(key, params) {
        const dict = RACE_TEXT[this.settings.lang] || RACE_TEXT.en;
        let s = key.split('.').reduce((o, k) => (o ? o[k] : undefined), dict);
        if (typeof s !== 'string') s = key;
        for (const k in params || {}) s = s.replace('{' + k + '}', String(params[k]));
        return s;
    }

    static fmt(sec) {
        if (!(sec > 0)) return '—';
        const m = Math.floor(sec / 60), s = sec - m * 60;
        return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
    }

    // --- Setup -------------------------------------------------------------------

    // Build (or rebuild) the circuit: data, scene, records, rivals. Menu only.
    _loadTrack(id) {
        const def = RACE_TRACKS.find((d) => d.id === id) || RACE_TRACKS[0];
        if (this.view) this.view.dispose();
        this.rivals = [];                         // their views went with the scene
        this.def = def;
        this.settings.track = def.id;
        this.track = raceTrackFromDef(def);
        this.progress = new RaceProgress(this.track, this.laps);
        this.view = new RaceScene(this.app, this.track, def);
        // Destructible dressing: same deterministic layout every load (records stay fair).
        this.props = new RaceProps(this.track, def);
        this.view.buildProps(this.props);
        this.view.setPlayerVehicle(this.car.type);
        this.car.gripScale = def.grip || 1;
        this._recordsKey = this._recKey();
        this.records = Object.assign({ race: 0, lap: 0 }, Store.getJSON(this._recordsKey, {}));
        this._syncRivals();
        if (this.fx) this.fx.setTheme(this._fxTheme());
        this._mapBg = null;                       // minimap redraws the new layout
    }

    // Effects for the current quality, coloured for the current track.
    _makeFx() {
        if (this.fx) this.fx.dispose();
        this.fx = new RaceFx(this.app, { quality: this.settings.quality });
        this.fx.setTheme(this._fxTheme());
    }

    _fxTheme() {
        const C = this.view.C, arctic = this.view.kind === 'arctic';
        return { track: this.track, loose: C.surface !== 'asphalt', ruts: C.ruts || '#6b5a3c',
            mud: arctic ? '#7f93a5' : '#2e1d10', dust: arctic ? '#e8f2f7' : '#b89a6a' };
    }

    // Player ride: 'car' | 'bike'. New physics object and a new view in place of the old one.
    _setVehicle(type) {
        this.settings.vehicle = type === 'bike' ? 'bike' : 'car';
        if (!['easy', 'normal', 'hard'].includes(this.settings.difficulty)) this.settings.difficulty = 'easy';
        this.car = new RaceCar(this.settings.vehicle);
        this.car.gripScale = this.def.grip || 1;
        this.view.setPlayerVehicle(this.settings.vehicle);
    }

    // New route/contact revision: legacy records remain stored, but are not comparable.
    // Separate vehicle and race format so switching the menu cannot reuse another class's best.
    _recKey() {
        const rivals = Math.max(0, Math.min(RACE_RIVALS.length, this.settings.rivals | 0));
        return 'arcrace.records.promo3.' + this.def.id + '.' + this.car.type + '.' + this.laps + '.' + rivals + '.' + (this.settings.difficulty || 'easy');
    }

    trackName() { return (this.def.name && (this.def.name[this.settings.lang] || this.def.name.en)) || this.def.id; }

    // Rival cars to match settings.rivals (0..RACE_RIVALS.length).
    _syncRivals() {
        for (const r of this.rivals) this.view.removeCar(r.view);
        this.rivals = [];
        const n = Math.max(0, Math.min(RACE_RIVALS.length, this.settings.rivals | 0));
        for (let i = 0; i < n; i++) {
            // Off-road tracks: every second rival rides a dirt bike (the MotorStorm mixed pack).
            const type = this.def.theme && this.def.theme.kind !== 'valley' && i % 2 === 1 ? 'bike' : 'car';
            const d = RACE_RIVALS[i], car = new RaceCar(type);
            car.gripScale = this.def.grip || 1;
            const profile = Game.difficultyProfile(this.settings.difficulty);
            car.c.top *= profile.speed; car.c.accel *= profile.accel;
            const ai = new RaceAI(this.track, car, { skill: d.skill * profile.skill, aggression: d.aggression, lane: (i % 2 ? 1 : -1) * 30, seed: i + 1 });
            const progress = new RaceProgress(this.track, this.laps);
            ai.progress = progress;
            this.rivals.push({ name: d.name, color: d.color, car, view: this.view.addCar(d.color, type), ai, progress, proj: null, finish: 0, surface: 'road' });
        }
    }

    // Grid: two cars per row behind the line, rivals in front, the player at the back
    // (FlatOut-style — you fight your way through the pack).
    _resetCar() {
        this._accumulator = 0;
        this._lastInput = null;
        const L = this.track.length, all = this.rivals.map((r) => r.car).concat([this.car]), n = all.length;
        const rowPitch = Math.max(...all.map((car) => 2 * (car.halfSegment + car.radius))) + this.car.radius;
        all.forEach((car, k) => {
            const row = Math.floor(k / 2), side = n === 1 ? 0 : (k % 2 ? 1 : -1);
            const s0 = L - 70 - row * rowPitch, q = this.track.pointAt(s0), lat = side * 34;
            car.place(q.x - q.ty * lat, q.y + q.tx * lat, Math.atan2(q.ty, q.tx));
            car.boost = RaceCar.BOOST_START;      // new race: fresh meter (recover() keeps it)
        });
        if (this.props) { this.props.reset(); this.view.updateProps(this.props); }
        this._smash = { n: 0, t: 0 };
        for (const r of this.rivals) {
            r.ai.reset();
            r.proj = r.ai.proj;
            r.progress.reset(r.proj.s);
            r.finish = 0;
            this.view.placeCar(r.car, 1, r.view);
        }
        const p = this.car;
        this._proj = this.track.project(p.x, p.y);
        this._hintIdx = this._proj.i;
        this.progress.reset(this._proj.s);
        this.fx && this.fx.clearMarks();
        const cam = this.app.camera;
        cam.obstruction = eye => this.view.cameraObstruction(
            { x: this.car.x, y: this.car.y, h: (this.car.z || 0) + CameraController.EYE_MIN }, eye);
        cam._obstructionFraction = 1;
        cam.follow(null);              // Game drives the chase camera itself (_camera)
        cam.lookAt(p.x, p.y);
        cam.azimuth = this.car.heading;
        this._camSpin = 0;
        cam.pitch = (typeof GAME_CAMERA_PITCH_DEG !== 'undefined' ? GAME_CAMERA_PITCH_DEG : 46) * Math.PI / 180;
        cam.zoom = cam.zoomTarget = this._baseZoom();
        cam._apply();
        this.view.placeCar(this.car, 1);
    }

    _baseZoom() { return typeof GAME_CAMERA_ZOOM !== 'undefined' ? GAME_CAMERA_ZOOM : 1.35; }

    _applySettings() {
        const recordKey = this._recKey();
        if (this._recordsKey !== recordKey) {
            this._recordsKey = recordKey;
            this.records = Object.assign({ race: 0, lap: 0 }, Store.getJSON(recordKey, {}));
        }
        Sound3D.setMuted(!this.settings.sound);
        Store.set('arcrace.settings', JSON.stringify(this.settings));
        const s = this.settings;
        const set = (id, text) => { const el = UI.get(id); if (el) el.setText(text); };
        set('btn-sound', this.t('sound', { v: this.t(s.sound ? 'on' : 'off') }));
        set('btn-quality', this.t('quality', { v: this.t(s.quality) }));
        set('btn-motion', this.t('motion', { v: this.t(s.motion) }));
        set('btn-lang', this.t('lang'));
        set('btn-start', this.t('start'));
        set('menu-sub', this.t('subTrack', { track: this.trackName(), n: this.laps }));
        set('btn-track', this.t('track', { v: this.trackName().toUpperCase() }));
        set('btn-rivals', this.t('rivals', { v: this.settings.rivals | 0 }));
        set('btn-difficulty', (s.lang === 'ru' ? 'СЛОЖНОСТЬ: ' : 'DIFFICULTY: ') + (s.lang === 'ru' ? {easy:'ЛЕГКО',normal:'ОБЫЧНО',hard:'СЛОЖНО'} : {easy:'EASY',normal:'NORMAL',hard:'HARD'})[s.difficulty || 'easy']);
        this._trackPreview();
        set('btn-vehicle', this.t('vehicle', { v: this.t(s.vehicle) }));
        set('menu-controls', s.lang === 'ru' ? 'W / ↑ газ · A D / ← → руль · S / ↓ тормоз\nShift / E — НИТРО · Пробел — занос\nНитро: прыжки, посадки, заносы, удары' : 'W / ↑ accelerate · A D / ← → steer · S / ↓ brake\nShift / E — NITRO · Space — drift\nRefill: jumps, landings, drifts, smashing props');
        if (this.isTouch) set('menu-controls', s.lang === 'ru' ? 'GAS — газ · BRK — тормоз · ◀ ▶ — руль\nNITRO — ускорение · DRIFT — занос\nНитро: прыжки, посадки, заносы, удары' : 'GAS / BRK — pedals · ◀ ▶ — steer\nNITRO — boost · DRIFT — slide\nRefill: jumps, landings, drifts, smashing props');
        set('pause-title', this.t('pause'));
        set('btn-resume', this.t('resume'));
        set('btn-restart', this.t('restart'));
        set('btn-menu', this.t('menu'));
        set('btn-again', this.t('again'));
        set('btn-res-menu', this.t('menu'));
        set('menu-records', this.records.race
            ? this.t('records', { race: Game.fmt(this.records.race), lap: Game.fmt(this.records.lap) })
            : this.t('noRecords'));
        this._menuCopy();
        // Quality: shadows are the big cost; effects keep their feedback, only density drops.
        const view = this.app.location.view;
        if (view && view.shadow) {
            const map = view.shadow.getShadowMap();
            if (map) map.refreshRate = s.quality === 'low' ? 2 : 1;
        }
        World3D.engine.setHardwareScalingLevel(s.quality === 'low' ? Math.max(1, 1.5 / (window.devicePixelRatio || 1)) : 1 / Math.min(2, window.devicePixelRatio || 1));
    }

    // Labels and state only; geometry and visual components remain in UILayout/UI.
    _menuCopy() {
        const ru = this.settings.lang === 'ru', s = this.settings;
        const set = (id, text) => { const e = UI.get(id); if (e) e.setText(text); };
        const selected = (id, label, on) => { const e = UI.get(id); if (e) { e.setText((on ? '✓ ' : '') + label); e.setSelected(on); } };
        const difficulty = ru ? { easy: 'Легко', normal: 'Обычно', hard: 'Сложно' } : { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
        set('btn-start', ru ? 'НАЧАТЬ ГОНКУ' : 'START RACE');
        set('btn-controls', ru ? 'Управление' : 'Controls');
        set('btn-settings', ru ? 'Настройки' : 'Settings');
        set('btn-fullscreen', ru ? 'Полный экран' : 'Fullscreen');
        set('track-heading', ru ? '01 / ВЫБЕРИТЕ ТРАССУ' : '01 / CHOOSE A TRACK');
        set('ride-heading', ru ? '02 / ВЫБЕРИТЕ ТЕХНИКУ' : '02 / CHOOSE YOUR RIDE');
        set('difficulty-heading', ru ? 'СЛОЖНОСТЬ' : 'DIFFICULTY');
        set('rivals-heading', ru ? 'СОПЕРНИКИ' : 'RIVALS');
        for (const type of ['car', 'bike']) selected('vehicle-' + type, this.t(type), s.vehicle === type);
        for (const id of ['easy', 'normal', 'hard']) selected('difficulty-' + id, difficulty[id], s.difficulty === id);
        for (const n of [0, 3, 5]) selected('rivals-' + n, String(n), s.rivals === n);
        set('race-summary', this.t(s.vehicle) + ' · ' + difficulty[s.difficulty] + '\n' + (ru ? 'Соперники: ' : 'Rivals: ') + s.rivals + ' · ' + this.laps + (ru ? ' круга' : ' laps'));
        set('menu-controls', ru ? 'W / ↑ — газ · A D / ← → — руль\nShift / E — нитро · R — на трассу' : 'W / ↑ accelerate · A D / ← → steer\nShift / E boost · R back on track');
        set('settings-panel-title', ru ? 'Настройки' : 'Settings');
        set('controls-panel-title', ru ? 'Управление' : 'Controls');
        for (const id of ['settings-panel', 'controls-panel']) set('close-' + id, ru ? 'Готово' : 'Done');
        set('controls-details', ru ? 'W / ↑           Газ\nS / ↓           Тормоз / нос вверх в воздухе\nA D / ← →    Поворот\nПробел        Ручник / занос\nShift / E       Нитро\nR                  Вернуться на трассу\nEsc / P         Пауза' : 'W / ↑           Accelerate\nS / ↓           Brake / nose up in the air\nA D / ← →    Steer\nSpace           Handbrake / drift\nShift / E       Nitro\nR                  Back on track\nEsc / P         Pause');
        set('controls-nitro', ru ? 'Нитро: прыжки, посадки, заносы\nи удары по объектам.\nКлавиши работают с любой раскладкой.' : 'Refill nitro with jumps, landings, drifts\nand smashing props.\nDriving keys work across keyboard layouts.');
        for (const [id, src] of [['car', 'assets/images/vehicle_car.png'], ['bike', 'assets/images/vehicle_bike.png']]) {
            const e = UI.get('vehicle-image-' + id); if (e) e.setImage(src, this.t(id));
        }
        if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = s.lang;
    }

    _selectRaceOption(key, value) {
        if (this.state !== 'menu' || UI.dialogId || this.settings[key] === value) return false;
        if (key === 'vehicle') this._setVehicle(value);
        else if (key === 'track') this._loadTrack(value);
        else { this.settings[key] = value; this._syncRivals(); }
        this._resetCar(); this._applySettings();
        return true;
    }

    async _fullscreen() {
        if (this.state !== 'menu' || UI.dialogId) return;
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
        } catch (_) {
            const e = UI.get('race-summary');
            if (e) e.setText(this.settings.lang === 'ru' ? 'Полный экран недоступен.\nМожно играть в этом окне.' : 'Fullscreen unavailable.\nYou can still play in this window.');
        }
    }

    _saveRecords() { Store.set(this._recKey(), JSON.stringify(this.records)); }

    // Layout-independent key id. e.code is the physical key on most browsers, but some
    // setups (non-Latin layouts in embedded webviews, some Linux/IME combos) report an empty
    // or layout-mapped code — then fall back to the typed character (Latin or Cyrillic
    // ЙЦУКЕН position) and finally to the legacy keyCode.
    static normKey(e) {
        if (e.code && Game.CODES.includes(e.code)) return e.code;
        const k = (e.key || '').toLowerCase();
        if (Game.KEY_CHARS[k]) return Game.KEY_CHARS[k];
        if (Game.KEY_CODES[e.keyCode]) return Game.KEY_CODES[e.keyCode];
        return e.code || '';
    }

    _bindInput() {
        this._onKeyDown = (e) => {
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target && e.target.tagName || '') || e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.target && e.target.closest && e.target.closest('[role=button]')) return;
            const code = Game.normKey(e);
            if (!Game.CODES.includes(code)) return;
            e.preventDefault();
            this.keys.add(code);
            if (e.repeat) return;
            this.audio.start();       // first user gesture unlocks audio
            if (code === 'Escape' || code === 'KeyP') this.togglePause();
            else if (code === 'KeyR' && (this.state === 'race' || this.state === 'countdown')) this.recover();
            else if (code === 'Enter') {
                if (this.state === 'menu' || this.state === 'results') this.startRace();
                else if (this.state === 'paused') this.togglePause();
            } else if (code === 'F3') { const f = UI.get('fps'); if (f) { this._fpsOn = !this._fpsOn; f.show(this._fpsOn); } }
        };
        this._onKeyUp = (e) => {
            this.keys.delete(Game.normKey(e));
            // Layout switch mid-press can change e.key between down and up: drop the raw code too.
            if (e.code) this.keys.delete(e.code);
        };
        this._onBlur = () => {
            this.keys.clear();
            for (const key in this.touch) this.touch[key] = false;
            if (this.state === 'race' || this.state === 'countdown') this.togglePause();
        };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
        document.addEventListener('visibilitychange', () => { if (document.hidden) this._onBlur(); });
    }

    _bindUI() {
        const on = (id, fn) => {
            const el = UI.get(id);
            if (el) el.onClick(() => { this.audio.start(); this.audio.play('click', 0.5); fn(); });
        };
        on('btn-controls', () => UI.openDialog('controls-panel', 'menu-modal', 'btn-controls'));
        on('btn-settings', () => UI.openDialog('settings-panel', 'menu-modal', 'btn-settings'));
        on('close-controls-panel', () => UI.closeDialog());
        on('close-settings-panel', () => UI.closeDialog());
        on('btn-fullscreen', () => this._fullscreen());
        for (const type of ['car', 'bike']) on('vehicle-' + type, () => this._selectRaceOption('vehicle', type));
        for (const id of ['easy', 'normal', 'hard']) on('difficulty-' + id, () => this._selectRaceOption('difficulty', id));
        for (const n of [0, 3, 5]) on('rivals-' + n, () => this._selectRaceOption('rivals', n));
        on('btn-start', () => this.startRace());
        on('btn-again', () => this.startRace());
        on('btn-resume', () => this.togglePause());
        on('btn-restart', () => this.startRace());
        on('btn-menu', () => this._openMenu());
        on('btn-res-menu', () => this._openMenu());
        on('btn-sound', () => { this.settings.sound = !this.settings.sound; this._applySettings(); });
        on('btn-quality', () => {
            this.settings.quality = this.settings.quality === 'high' ? 'low' : 'high';
            this._makeFx();
            this._applySettings();
        });
        on('btn-vehicle', () => {
            if (this.state !== 'menu') return;
            this._setVehicle(this.settings.vehicle === 'car' ? 'bike' : 'car');
            this._resetCar();
            this._applySettings();
        });
        on('btn-motion', () => { this.settings.motion = this.settings.motion === 'full' ? 'reduced' : 'full'; this._applySettings(); });
        for (const def of RACE_TRACKS) on('track-' + def.id, () => {
            if (this.state !== 'menu' || this.def.id === def.id) return;
            this._loadTrack(def.id); this._resetCar(); this._applySettings();
        });
        on('btn-difficulty', () => {
            if (this.state !== 'menu') return;
            const ids = ['easy', 'normal', 'hard'];
            this.settings.difficulty = ids[(ids.indexOf(this.settings.difficulty) + 1) % ids.length];
            this._syncRivals(); this._resetCar(); this._applySettings();
        });
        on('btn-track', () => {
            if (this.state !== 'menu') return;
            const i = RACE_TRACKS.findIndex((d) => d.id === this.def.id);
            this._loadTrack(RACE_TRACKS[(i + 1) % RACE_TRACKS.length].id);
            this._resetCar();
            this._applySettings();
        });
        on('btn-rivals', () => {
            if (this.state !== 'menu') return;
            const opts = [0, 3, 5], i = opts.indexOf(this.settings.rivals | 0);
            this.settings.rivals = opts[(i + 1) % opts.length];
            this._syncRivals();
            this._resetCar();
            this._applySettings();
        });
        on('btn-lang', () => { this.settings.lang = this.settings.lang === 'en' ? 'ru' : 'en'; this._applySettings(); this._hud(); });
        on('touch-pause', () => this.togglePause());
        // Hold buttons: pressed while a finger is on them (pointer capture keeps the press
        // when the finger slides a little off the button).
        for (const key of ['left', 'right', 'gas', 'brake', 'drift', 'boost']) {
            const el = UI.get('touch-' + key);
            const dom = el && el.el;
            if (!dom) continue;
            const down = (e) => {
                e.preventDefault();
                this.audio.start();
                this.touch[key] = true;
                if (dom.setPointerCapture && e.pointerId != null) { try { dom.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
            };
            const up = () => { this.touch[key] = false; };
            dom.addEventListener('pointerdown', down);
            dom.addEventListener('pointerup', up);
            dom.addEventListener('pointercancel', up);
            dom.addEventListener('lostpointercapture', up);
            dom.addEventListener('contextmenu', (e) => e.preventDefault());
            dom.style.touchAction = 'none';
            dom.style.userSelect = 'none';
        }
    }

    _trackPreview() {
        if (typeof document === 'undefined') return;
        const ru = this.settings.lang === 'ru';
        const names = ru ? {valley:'Долина',canyon:'Каньон',arctic:'Ледник'} : {valley:'Valley',canyon:'Canyon',arctic:'Glacier'};
        for (const def of RACE_TRACKS) {
            const el = UI.get('track-' + def.id);
            if (el) { el.setText((def.id === this.def.id ? '✓ ' : '') + names[def.id]); el.setSelected(def.id === this.def.id); }
        }
        const image = UI.get('track-preview');
        for (const [id, src] of [['valley', 'assets/images/track_valley.png'], ['canyon', 'assets/images/track_canyon.png'], ['arctic', 'assets/images/track_arctic.png']]) {
            const thumb = UI.get('thumb-' + id); if (thumb) thumb.setImage(src, names[id]);
        }
        if (image) image.setImage(({valley:'assets/images/track_valley.png',canyon:'assets/images/track_canyon.png',arctic:'assets/images/track_arctic.png'})[this.def.id], this.trackName());
        const panel = UI.get('track-route');
        if (panel) {
            const map = this._minimapLayer(300).canvas;
            map.style.cssText = 'width:100%;height:100%;display:block;';
            map.setAttribute('role', 'img'); map.setAttribute('aria-label', (ru ? 'Схема маршрута: ' : 'Route map: ') + this.trackName());
            panel.el.replaceChildren(map);
        }
        const desc = UI.get('track-description');
        if (desc) desc.setText((ru ? {valley:'Асфальт · быстрые повороты',canyon:'Грунт · трамплины · грязь',arctic:'Снег · скользкие повороты · прыжки'} : {valley:'Asphalt · fast corners',canyon:'Dirt · jumps · mud',arctic:'Snow · slippery corners · jumps'})[this.def.id]);
        const legend = UI.get('track-legend');
        if (legend) legend.setText(ru ? 'Белый: старт\nОранжевый: прыжки' : 'White: start\nOrange: jumps');
    }

    // --- States ------------------------------------------------------------------

    _screens(menu, pause, results, hud) {
        const show = (id, v) => { const el = UI.get(id); if (el) el.show(v); };
        show('dim', menu || pause || results);
        if (!menu) UI.closeDialog(false);
        show('menu', menu);
        show('pause', pause);
        show('results', results);
        for (const id of ['hud', 'lapbar', 'boostbar', 'boost-label', 'boost-help']) show(id, hud);
        show('pos', hud && this.rivals.length > 0);
        show('minimap', hud);
        // Speed sits where the thumb buttons are on a phone — hidden there.
        for (const id of ['speed', 'unit']) show(id, hud && !this.isTouch);
        const touchOn = hud && this.isTouch && !pause;
        for (const id of ['touch-left', 'touch-right', 'touch-gas', 'touch-brake', 'touch-drift', 'touch-boost', 'touch-pause']) show(id, touchOn);
        if (!touchOn) for (const k in this.touch) this.touch[k] = false;
    }

    _openMenu() {
        this.state = 'menu';
        this._resetCar();
        this._applySettings();
        this._screens(true, false, false, false);
        this._message('', 0);
        const h = UI.get('hint'); if (h) h.show(false);
        const tst = UI.get('toast'); if (tst) tst.show(false);
    }

    startRace() {
        if (UI.dialogId || !['menu', 'results', 'paused'].includes(this.state)) return false;
        this._resetCar();
        this.clock = 0;
        this.state = 'countdown';
        this._timers.count = 3.999;
        this._lastBeep = 4;
        this._screens(false, false, false, true);
        const h = UI.get('hint');
        if (h) { h.setText(this.t('hint')); h.show(!this.isTouch); }
        this._hintTime = 8;
        this._hud();
    }

    togglePause() {
        if (this.state === 'race' || this.state === 'countdown') {
            this._paused = this.state;
            this.state = 'paused';
            this._screens(false, true, false, true);
        } else if (this.state === 'paused') {
            this.state = this._paused || 'race';
            this._screens(false, false, false, true);
        }
    }

    // Rejoin at the SAME route distance. No forward teleport, ghosting or lap credit.
    recover() {
        const t = this.track, car = this.car, p = t.pointAt(this._proj.s);
        const heading = Math.atan2(p.ty, p.tx), z = t.heightAt(this._proj.s);
        const limit = Math.max(0, Math.min(t.halfWidth, t.wall) - car.radius);
        const slots = [0], step = car.radius * 4;
        for (let lat = step; lat < limit; lat += step) slots.push(-lat, lat);
        if (limit > 0) slots.push(-limit, limit);
        // One extra tyre radius of space makes a clear slot more than a tangent contact.
        const probe = { x: p.x, y: p.y, z, heading,
            radius: car.radius * 2, halfSegment: car.halfSegment };
        let found = false;
        for (const lat of slots) {
            probe.x = p.x - p.ty * lat; probe.y = p.y + p.tx * lat;
            if (this.rivals.some(r => RaceCar.contact(probe, r.car))) continue;
            const occupied = this.props && this.props.list.some(q => {
                if (q.state === RaceProps.HIDDEN || Math.abs(q.z - z) > q.T.h + probe.radius) return false;
                return !!RaceCar.contact(probe, { x: q.x, y: q.y, z,
                    heading: 0, radius: q.T.r, halfSegment: 0 });
            });
            if (occupied) continue;
            found = true;
            break;
        }
        if (!found) {
            this._toast(this.t('recoverBlocked'), 1);
            return false; // a full cross-section: leave state untouched and let the pack clear
        }
        car.place(probe.x, probe.y, heading);
        car.z = z; // stand on raised road immediately; place() keeps the next-step snap enabled
        this._proj = t.project(car.x, car.y, this._proj.i);
        this._hintIdx = this._proj.i;
        this.progress.lastS = this._proj.s;
        this.fx.breakTrail(car);   // no mark drawn across the teleport
        this._toast(this.t('offTrack'), 1);
        return true;
    }

    _finish() {
        this.state = 'results';
        const total = this.clock, laps = this.progress.lapTimes;
        const bestLap = Math.min(...laps);
        const newRace = !this.records.race || total < this.records.race;
        const newLap = !this.records.lap || bestLap < this.records.lap;
        if (newRace) this.records.race = total;
        if (newLap) this.records.lap = bestLap;
        this._saveRecords();
        // Medal: with rivals — by place; time trial — by the track's times (Valley — constants).
        const m = this.def.medals;
        const g = m ? m[0] : typeof GAME_MEDAL_GOLD_SEC !== 'undefined' ? GAME_MEDAL_GOLD_SEC : 50;
        const s = m ? m[1] : typeof GAME_MEDAL_SILVER_SEC !== 'undefined' ? GAME_MEDAL_SILVER_SEC : 58;
        const b = m ? m[2] : typeof GAME_MEDAL_BRONZE_SEC !== 'undefined' ? GAME_MEDAL_BRONZE_SEC : 70;
        const set = (id, text) => { const el = UI.get(id); if (el) el.setText(text); };
        set('res-title', this.t('finish'));
        if (this.rivals.length) {
            const place = 1 + this.rivals.filter((r) => r.finish > 0).length;
            const medal = ['gold', 'silver', 'bronze'][place - 1];
            set('res-medal', this.t('place', { n: place, of: this.rivals.length + 1 }) + '   ' + (medal ? this.t('medal.' + medal) : this.t('top3')));
        } else {
            const medal = total <= g ? 'gold' : total <= s ? 'silver' : total <= b ? 'bronze' : 'none';
            set('res-medal', this.t('medal.' + medal, { t: Game.fmt(g) }));
        }
        set('res-time', Game.fmt(total));
        set('res-laps', laps.map((t, i) => this.t('lapTime', { n: i + 1, t: Game.fmt(t) + (t === bestLap ? '  ★' : '') })).join('\n'));
        set('res-record', newRace ? this.t('newRecord') : this.t('record', { t: Game.fmt(this.records.race) }));
        this._screens(false, false, true, false);
        this.audio.play('finish', 0.8);
        const h = UI.get('hint'); if (h) h.show(false);
    }

    // --- HUD ---------------------------------------------------------------------

    _message(text, sec) {
        const el = UI.get('message');
        if (!el) return;
        el.setText(text);
        el.show(!!text);
        this._timers.msg = sec;
    }

    _toast(text, sec) {
        const el = UI.get('toast');
        if (!el) return;
        el.setText(text);
        el.show(true);
        this._timers.toast = sec;
    }

    _hud() {
        const set = (id, text) => { const el = UI.get(id); if (el) el.setText(text); };
        const lap = Math.min(this.laps, this.progress.lap + 1);
        set('lap', this.t('lap', { n: lap, of: this.laps }));
        set('timer', Game.fmt(this.clock) === '—' ? '0:00.00' : Game.fmt(this.clock));
        const bests = this.progress.lapTimes.concat(this.records.lap ? [this.records.lap] : []);
        set('best', bests.length ? this.t('best', { t: Game.fmt(Math.min(...bests)) }) : this.t('noBest'));
        const k = typeof GAME_SPEED_KMH !== 'undefined' ? GAME_SPEED_KMH : 0.34;
        set('speed', String(Math.round(Math.abs(this.car.fwd) * k)));
        set('unit', this.settings.lang === 'ru' ? 'КМ/Ч' : 'KM/H');
        const bar = UI.get('lapbar'); if (bar) bar.setValue(this.progress.lapFraction());
        const nos = UI.get('boostbar'); if (nos) nos.setValue(this.car.boost);
        const ru = this.settings.lang === 'ru', pct = Math.round(this.car.boost * 100);
        const action = this.isTouch ? 'NITRO' : 'Shift / E';
        set('boost-label', (ru ? 'НИТРО ' : 'NITRO ') + pct + '% · ' + action + (this.car.boosting ? (ru ? ' · АКТИВНО' : ' · ACTIVE') : pct === 0 ? (ru ? ' · ПУСТО' : ' · EMPTY') : ''));
        set('boost-help', ru ? 'Заряд: прыжки · посадки · заносы · удары' : 'Refill: jumps · landings · drifts · smashing');
        set('touch-boost', (ru ? 'НИТРО' : 'NITRO') + '\n' + pct + '%');
        if (this.rivals.length) set('pos', this.t('pos', { n: this.position(), of: this.rivals.length + 1 }));
    }

    // Player's race position: rivals with more distance (or already finished) are ahead.
    position() {
        const me = this.progress.progress;
        return 1 + this.rivals.filter((r) => r.finish > 0 || r.progress.progress > me).length;
    }

    // --- Frame -------------------------------------------------------------------

    _input() {
        const k = this.keys;
        const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
        const pad = pads && Array.from(pads).find((p) => p && p.connected);
        let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
        let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
        let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
        let handbrake = k.has('Space');
        let boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE');
        const tc = this.touch;
        if (tc.gas) throttle = 1;
        if (tc.brake) brake = 1;
        if (tc.left || tc.right) steer = (tc.right ? 1 : 0) - (tc.left ? 1 : 0);
        if (tc.drift) handbrake = true;
        if (tc.boost) boost = true;
        if (pad) {
            const ax = pad.axes[0] || 0;
            if (Math.abs(ax) > 0.15) steer = ax;
            if (pad.buttons[7]) throttle = Math.max(throttle, pad.buttons[7].value);
            if (pad.buttons[6]) brake = Math.max(brake, pad.buttons[6].value);
            if (pad.buttons[0] && pad.buttons[0].pressed) handbrake = true;
            if ((pad.buttons[1] && pad.buttons[1].pressed) || (pad.buttons[5] && pad.buttons[5].pressed)) boost = true;
        }
        return { throttle, brake, steer, handbrake, boost };
    }

    // One physics step for any car: drive, follow the road height (jumps), walls.
    // -> { surface, proj, impact, landing, hits } (hits — events in this.props.events)
    _stepCar(car, proj, dt, input) {
        const driveSurface = this.track.sampleSurface(proj.s, proj.lat);
        const surface = driveSurface.surface;
        car.gripScale = driveSurface.gripScale;
        car.step(dt, input, surface);
        proj = this.track.project(car.x, car.y, proj.i);
        const contact = this.track.sampleSurface(proj.s, proj.lat);
        // Grade along body heading; the same height/material/normal can feed FX and audio.
        const slope = contact.gradient.x * Math.cos(car.heading) + contact.gradient.y * Math.sin(car.heading);
        const landing = car.updateHeight(contact.height, dt, slope);
        const hits = this.props ? this.props.hitCar(car) : 0;
        const impact = car.collideWall(proj, this.track.wall);
        if (impact) proj = this.track.project(car.x, car.y, proj.i);
        return { surface, proj, impact, landing, hits };
    }

    // Countdown: every car stands still on its grid slot (no roll, no nudges from neighbours).
    _holdGrid() {
        for (const car of [this.car].concat(this.rivals.map((r) => r.car))) {
            car.vx = 0; car.vy = 0;
            if ('yawRate' in car) car.yawRate = 0;
        }
    }

    _physics(dt, input) {
        const car = this.car;
        const res = this._stepCar(car, this._proj, dt, input);
        const surface = res.surface, impact = res.impact;
        this._proj = res.proj;
        if (res.landing > 0) this._onLanding(res.landing);
        if (car.landed && car.airTime > 0.35) this._onLandingQuality(car.landing);
        if (res.hits) this._onSmash(res.hits);
        if (impact > 90) {
            const now = this.clock;
            if (!this._lastHit || now - this._lastHit > 0.25) {
                this._lastHit = now;
                const strength = Math.min(1, impact / 500);
                this.fx.impact(car.x, car.y, strength);
                this.audio.play('impact', 0.3 + strength * 0.6);
                if (this.settings.motion === 'full') this.app.camera.shake(180, 4 + strength * 10);
            }
            this._proj = this.track.project(car.x, car.y, this._proj.i);
        }
        return surface;
    }

    // Player landed: dust, thump, shake by impact; a long flight gets a toast.
    _onLanding(impact) {
        const car = this.car, strength = Math.min(1, impact / 700);
        if (impact > 150) {
            const contact = this.track.sampleSurface(this._proj.s, this._proj.lat);
            this.fx.impact(car.x, car.y, strength * 0.7,
                { height: contact.height + 4, normal: contact.normal, material: contact.material });
            const sound = contact.material === 'mud' ? 'landingMud' :
                contact.material === 'dirt' ? 'landingDirt' : 'impact';
            this.audio.play(sound, 0.2 + strength * 0.5);
            if (this.settings.motion === 'full') this.app.camera.shake(140, 3 + strength * 9);
        }
        if (car.airTime > 0.55 && this.state === 'race') this._toast(this.t('air', { t: car.airTime.toFixed(1) }), 1.2);
    }

    // Callout for how the jump was landed (RaceCar.updateHeight judged it).
    _onLandingQuality(q) {
        if (this.state !== 'race') return;
        if (q === 'perfect') { this._toast(this.t('perfect'), 1.4); this.audio.play('lap', 0.35); }
        else if (q === 'bad') this._toast(this.t('bad'), 1.2);
    }

    // Player ploughed through props this step: debris FX, thump by mass, boost, combo callout.
    _onSmash(n) {
        const car = this.car, ev = this.props.events;
        let heavy = 0, counted = 0;
        for (let i = 0; i < n; i++) {
            const e = ev[i];
            if (e.type === 'plank') continue;
            this.fx.impact(e.x, e.y, Math.min(1, e.strength * (e.broke ? 0.9 : 0.5)), e);
            heavy = Math.max(heavy, e.mass * e.strength);
            if (e.reward) {
                counted++;
                car.addBoost(0.02 + e.mass * 0.25);
            }
        }
        if (heavy > 0) this.audio.play('impact', Math.min(1, 0.15 + heavy * 4));
        if (heavy > 0.05 && this.settings.motion === 'full') this.app.camera.shake(120, 2 + heavy * 30);
        if (!counted) return;
        const s = this._smash || (this._smash = { n: 0, t: 0 });
        s.n = this.clock - s.t < 1.5 ? s.n + counted : counted;
        s.t = this.clock;
        if (s.n >= 2 && this.state === 'race') this._toast(this.t('smash', { n: s.n }), 1);
    }

    // Rivals: AI input, the same physics, laps; then car-to-car contacts (player included).
    _rivalsStep(dt, running) {
        if (!this.rivals.length) return;
        const me = this.progress.progress;
        for (const r of this.rivals) {
            // Not racing: handbrake only. Brake at zero speed is reverse — on the grid it backed
            // every rival into the cars behind.
            const input = running && !r.finish ? r.ai.drive(dt, me)
                : { throttle: 0, brake: 0, steer: 0, handbrake: true };
            // AI boosts on straights once it has some meter banked.
            input.boost = Game.difficultyProfile(this.settings && this.settings.difficulty).boost && input.throttle > 0.9 && Math.abs(input.steer) < 0.15 && r.car.boost > 0.4 && r.progress.progress <= me + this.track.length * 0.03;
            const res = this._stepCar(r.car, r.proj || r.ai.proj, dt, input);
            // Rivals smash props too: debris puff only (no sound/callouts for them).
            for (let i = 0; i < res.hits; i++) {
                const e = this.props.events[i];
                if (e.type !== 'plank') {
                    this.fx.impact(e.x, e.y, e.strength * 0.4, e);
                    if (e.reward) r.car.addBoost(0.02 + e.mass * 0.25);
                }
            }
            r.proj = r.ai.proj = res.proj;
            r.surface = res.surface;
            if (running) for (const ev of r.progress.update(r.proj.s, this.clock)) if (ev.type === 'finish') r.finish = this.clock;
        }
        const cars = [this.car].concat(this.rivals.map((r) => r.car));
        for (let i = 0; i < cars.length; i++) {
            for (let j = i + 1; j < cars.length; j++) {
                const hit = RaceCar.collide(cars[i], cars[j]);
                if (i === 0 && hit > 120) {
                    const now = this.clock;
                    if (!this._lastBump || now - this._lastBump > 0.2) {
                        this._lastBump = now;
                        const s = Math.min(1, hit / 450);
                        this.fx.impact((cars[0].x + cars[j].x) / 2, (cars[0].y + cars[j].y) / 2, s);
                        this.audio.play('impact', 0.25 + s * 0.5);
                        if (this.settings.motion === 'full') this.app.camera.shake(120, 3 + s * 8);
                    }
                }
            }
        }
        this._proj = this.track.project(this.car.x, this.car.y, this._proj.i);
    }

    // Fixed simulation tick. Rendering stays in update().
    _tickRace(dt) {
        let input = { throttle: 0, brake: 0, steer: 0, handbrake: false };

        if (this.state === 'countdown') {
            this._timers.count -= dt;
            const n = Math.ceil(this._timers.count);
            if (n !== this._lastBeep && n >= 1) { this._lastBeep = n; this._message(String(n), 1); this.audio.play('beep', 0.6); }
            if (this._timers.count <= 0) {
                this.state = 'race';
                this._message(this.t('go'), 0.8);
                this.audio.play('go', 0.7);
            }
        }
        const running = this.state === 'race';
        if (!running) { this._holdGrid(); return; }
        input = this._input();
        this._lastInput = input;

        if (running) {
            this.clock += dt;
            const surface = this._physics(dt, input);
            this._rivalsStep(dt, true);
            for (const ev of this.progress.update(this._proj.s, this.clock)) this._onLap(ev);
            // Rivals' tyre tracks first, then the player's (update flushes all mark buffers).
            for (const r of this.rivals) this.fx.trail(r.car, this.view.rearWheels(r.car), r.surface);
            if (this.props) { this.props.step(dt); this.view.updateProps(this.props); }
            this.fx.update(dt, this.car, this.view.rearWheels(this.car), surface);
            this._wrongWay(dt, running);
            this._feedback(surface, running);
        }

    }

    update(dt) {
        const h = 1 / 120; // invariant simulation frequency, independent of rendering
        if (!Number.isFinite(dt) || dt < 0) dt = 0;
        if (dt > 0.25 && (this.state === 'race' || this.state === 'countdown')) {
            this.togglePause();
            this.keys.clear();
            for (const key in this.touch) this.touch[key] = false;
            dt = 0; // a background/stalled frame must not launch a catch-up burst
        }
        dt = Math.min(0.1, dt);
        if (this.state === 'race' || this.state === 'countdown') {
            this._accumulator = (this._accumulator || 0) + dt;
            while (this._accumulator + 1e-12 >= h &&
                (this.state === 'race' || this.state === 'countdown')) {
                this._accumulator = Math.max(0, this._accumulator - h);
                this._tickRace(h);
            }
            if (this.state !== 'race' && this.state !== 'countdown') this._accumulator = 0;
        } else {
            this._accumulator = 0;
            if (this.state === 'menu') this._holdGrid();
        }


        this.view.placeCar(this.car, dt);
        for (const r of this.rivals) this.view.placeCar(r.car, dt, r.view);
        this._camera(dt);
        this.audio.update(this.car, this.state === 'race', !!(this._lastInput && this._lastInput.throttle > 0));
        this._tickTimers(dt);
        if (this.state === 'race' || this.state === 'countdown' || this.state === 'paused') { this._hud(); this._minimap(); }
        return dt; // entry point shares the same bounded delta with location and camera
    }

    // --- Minimap -------------------------------------------------------------------
    // A canvas inside the 'minimap' panel (UILayout places it). North-up top view of the map
    // (x right, y down = the 3D world from above, not mirrored): the road, mud, jumps, the
    // start line — drawn once per track — then every car as a dot, the player as an arrow.

    _minimap() {
        const panel = UI.get('minimap');
        if (!panel || !panel.visible || typeof document === 'undefined') return;
        const S = Game.MAP_PX;
        let cv = this._mapCanvas;
        if (!cv) {
            cv = this._mapCanvas = document.createElement('canvas');
            cv.width = cv.height = S;
            cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
        }
        if (cv.parentNode !== panel.el) panel.el.appendChild(cv);   // the UI editor rebuilds panels
        if (!this._mapBg) this._mapBg = this._minimapLayer(S);
        const g = cv.getContext('2d'), m = this._mapBg;
        g.clearRect(0, 0, S, S);
        g.drawImage(m.canvas, 0, 0);
        const dot = (car, color, r) => {
            g.beginPath(); g.arc(m.x(car.x), m.y(car.y), r, 0, Math.PI * 2);
            g.fillStyle = color; g.fill();
            g.lineWidth = 2; g.strokeStyle = '#0b1119'; g.stroke();
        };
        for (const r of this.rivals) dot(r.car, r.color || '#cccccc', 7);
        // Player: an arrow along the heading, white rim — readable over any dot.
        const c = this.car, px = m.x(c.x), py = m.y(c.y), a = c.heading;
        g.save(); g.translate(px, py); g.rotate(a);
        g.beginPath(); g.moveTo(14, 0); g.lineTo(-9, 9); g.lineTo(-4, 0); g.lineTo(-9, -9); g.closePath();
        g.fillStyle = '#ff3b30'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke();
        g.restore();
    }

    // Static layer: fit the track box into S px, road ribbon, mud, jumps, start line.
    _minimapLayer(S) {
        const t = this.track, pad = S * 0.08;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < t.count; i++) {
            x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]);
            y0 = Math.min(y0, t.py[i]); y1 = Math.max(y1, t.py[i]);
        }
        const k = (S - pad * 2) / Math.max(x1 - x0, y1 - y0, 1);
        const ox = (S - (x1 - x0) * k) / 2, oy = (S - (y1 - y0) * k) / 2;
        const X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y - y0) * k;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const g = canvas.getContext('2d');
        g.lineJoin = g.lineCap = 'round';
        const path = (s0, s1, lat) => {
            g.beginPath();
            for (let s = s0; s <= s1; s += t.ds * 2) {
                const p = t.pointAt(s), x = p.x - p.ty * lat, y = p.y + p.tx * lat;
                if (s === s0) g.moveTo(X(x), Y(y)); else g.lineTo(X(x), Y(y));
            }
        };
        const road = Math.max(8, t.halfWidth * 2 * k);
        path(0, t.length + t.ds * 2, 0);
        g.strokeStyle = '#0b1119'; g.lineWidth = road + 6; g.stroke();
        g.strokeStyle = '#8a96a3'; g.lineWidth = road; g.stroke();
        // Mud bogs: brown along their lateral band.
        for (const z of t.zones || []) {
            path(z.s0, z.s0 + z.len, (z.lat0 + z.lat1) / 2);
            g.strokeStyle = '#6b4423'; g.lineWidth = Math.max(4, (z.lat1 - z.lat0) * k * 0.8); g.stroke();
        }
        // Jumps: orange bars across the road.
        for (const f of t.features || []) {
            const p = t.pointAt(f.s0 + f.len * 0.5), w = road * 0.75;
            g.beginPath();
            g.moveTo(X(p.x) - p.ty * w, Y(p.y) + p.tx * w);
            g.lineTo(X(p.x) + p.ty * w, Y(p.y) - p.tx * w);
            g.strokeStyle = '#ffb020'; g.lineWidth = 6; g.stroke();
        }
        // Start / finish: a white bar at s = 0.
        const p = t.pointAt(0), w = road * 0.8;
        g.beginPath();
        g.moveTo(X(p.x) - p.ty * w, Y(p.y) + p.tx * w);
        g.lineTo(X(p.x) + p.ty * w, Y(p.y) - p.tx * w);
        g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.stroke();
        return { canvas, x: X, y: Y };
    }

    // Surface / crash callouts: off track, into the mud (once per bog), bike wipeout.
    _feedback(surface, running) {
        const car = this.car;
        if (surface === 'grass' && running && car.speed > 80) this._toast(this.t('offTrack'), 0.3);
        const mud = surface === 'mud' && !car.air;
        if (mud && !this._wasMud && running && car.speed > 60) this._toast(this.t('mud'), 0.8);
        this._wasMud = mud;
        const down = car.crash > 0;
        if (down && !this._wasDown) {
            this._toast(this.t('wipeout'), 1.4);
            this.fx.impact(car.x, car.y, 0.8);
            this.audio.play('impact', 0.9);
            if (this.settings.motion === 'full') this.app.camera.shake(260, 12);
        }
        this._wasDown = down;
    }

    _onLap(ev) {
        if (ev.type === 'lap' && ev.lap < this.laps) {
            this.audio.play('lap', 0.6);
            this._message(ev.lap === this.laps - 1 ? this.t('lastLap') : this.t('lap', { n: ev.lap + 1, of: this.laps }), 1.4);
            this._toast(this.t('lapTime', { n: ev.lap, t: Game.fmt(ev.time) }), 2.5);
        }
        if (ev.type === 'finish') this._finish();
    }

    _wrongWay(dt, running) {
        if (!running) return;
        const d = Math.cos(this.car.heading) * this._proj.tx + Math.sin(this.car.heading) * this._proj.ty;
        this._timers.wrong = d < -0.3 && this.car.speed > 40 ? this._timers.wrong + dt : 0;
        if (this._timers.wrong > 1) this._message(this.t('wrong'), 0.3);
    }

    _camera(dt) {
        const cam = this.app.camera, car = this.car;
        const full = this.settings.motion === 'full';
        if (dt <= 0) return;
        // Look along the direction of TRAVEL (velocity), with a quarter of the body heading mixed
        // in: in a drift the camera keeps flying down the road while the car turns sideways in
        // frame. Reversing / standing — the body heading.
        const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        const vHead = Math.atan2(car.vy, car.vx);
        const moving = car.speed > 50 && car.fwd > -10;
        const aim = moving ? car.heading + wrap(vHead - car.heading) * 0.75 : car.heading;
        // Angle spring: slightly under-damped (full motion) — the camera lags into a slide and
        // swings back a touch, like a chase cam on a cable. Reduced motion — critically damped.
        const err = wrap(aim - cam.azimuth);
        const K = full ? 26 : 14, D = 2 * Math.sqrt(K) * (full ? 0.78 : 1.05);
        this._camSpin = (this._camSpin || 0) + (K * err - D * this._camSpin) * dt;
        this._camSpin = Math.max(-4, Math.min(4, this._camSpin));
        cam.azimuth += this._camSpin * dt;
        // Target: a bit ahead along the velocity so the car sits low in the frame with road
        // ahead visible; follows the car tightly (no rubbery lag on position).
        const look = full ? 0.2 : 0.12;
        const tx = car.x + car.vx * look, ty = car.y + car.vy * look;
        const kp = 1 - Math.exp(-10 * dt);
        cam.target.x += (tx - cam.target.x) * kp;
        cam.target.y += (ty - cam.target.y) * kp;
        // Jumps: the target rises with the car (softly), so the car never leaves the frame.
        const wantLift = (car.z || 0) * 0.75;
        cam.lift += (wantLift - cam.lift) * (1 - Math.exp(-6 * dt));
        const k = Math.min(1, Math.abs(car.fwd) / car.c.top);
        const air = car.air ? 0.1 : 0;
        cam.zoomTarget = this._baseZoom() * (full ? 1 - 0.2 * k - air : 1);
    }

    // Menu / pause / results are fixed-size panels: on a narrow screen (phone in portrait)
    // shrink them to fit. UI.js owns the translate(); the scale is appended after it and
    // re-applied whenever UI rewrites the transform (on resize).
    _fitPanels() {
        if (typeof window === 'undefined') return;
        UI.fitColumns('menu', ['menu-left', 'menu-right'], ['btn-controls', 'btn-settings', 'btn-fullscreen']);
        for (const id of ['menu', 'pause', 'results', 'settings-panel', 'controls-panel']) {
            const el = UI.get(id), dom = el && el.el;
            if (!dom) continue;
            if (id === 'menu' || id.endsWith('-panel')) { el.fitViewport(); continue; }
            // On-screen size without our own scale (UI.js may scale its whole root).
            const rect = dom.getBoundingClientRect();
            const m = /scale\(([\d.]+)\)/.exec(dom.style.transform);
            const own = m ? parseFloat(m[1]) : 1;
            const w = rect.width / own, h = rect.height / own;
            if (!w || !h) continue;
            const k = Math.min(1, (window.innerWidth - 16) / w, (window.innerHeight - 16) / h);
            const base = dom.style.transform.replace(/\s*scale\([^)]*\)/, '');
            const want = k < 0.999 ? base + ' scale(' + k.toFixed(3) + ')' : base;
            if (dom.style.transform !== want) dom.style.transform = want;
        }
    }

    // Weak hardware: if the race runs below 40 fps for 4 s on HIGH, drop to LOW once and say so.
    // The player can switch back in the menu; the choice is saved like any other setting.
    _autoQuality(dt) {
        if (this.state !== 'race' || this.settings.quality !== 'high' || this._autoDropped) return;
        const slow = dt > 1 / 40;
        this._slowTime = slow ? (this._slowTime || 0) + dt : Math.max(0, (this._slowTime || 0) - dt * 0.5);
        if (this._slowTime < 4) return;
        this._autoDropped = true;
        this.settings.quality = 'low';
        this._makeFx();
        this._applySettings();
        this._toast(this.settings.lang === 'ru' ? 'Графика: НИЗ (для плавности)' : 'Quality: LOW (for smoother play)', 2.5);
    }

    _tickTimers(dt) {
        this._fitPanels();
        this._autoQuality(dt);
        const T = this._timers;
        if (T.msg > 0 && (T.msg -= dt) <= 0) { const m = UI.get('message'); if (m) m.show(false); }
        if (T.toast > 0 && (T.toast -= dt) <= 0) { const m = UI.get('toast'); if (m) m.show(false); }
        if (this._hintTime > 0 && this.state === 'race' && (this._hintTime -= dt) <= 0) { const h = UI.get('hint'); if (h) h.show(false); }
        if ((T.fps -= dt) <= 0) {
            T.fps = 0.5;
            const f = UI.get('fps');
            if (f) f.setText(Math.round(World3D.engine.getFps()) + ' fps');
        }
    }
}

Game.MAP_PX = 360;   // minimap canvas resolution (the panel scales it)
Game.CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyR', 'Escape', 'KeyP', 'Enter', 'F3',
    'ShiftLeft', 'ShiftRight', 'KeyE'];
// Typed character -> physical key (Latin QWERTY and Russian ЙЦУКЕН on the same keys).
Game.KEY_CHARS = {
    w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', r: 'KeyR', p: 'KeyP',
    'ц': 'KeyW', 'ф': 'KeyA', 'ы': 'KeyS', 'в': 'KeyD', 'к': 'KeyR', 'з': 'KeyP',
    e: 'KeyE', 'у': 'KeyE', shift: 'ShiftLeft', ' ': 'Space', spacebar: 'Space', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    escape: 'Escape', esc: 'Escape', enter: 'Enter', f3: 'F3',
};
// Legacy keyCode (layout-independent on Windows for letter keys).
Game.KEY_CODES = { 16: 'ShiftLeft', 69: 'KeyE', 87: 'KeyW', 65: 'KeyA', 83: 'KeyS', 68: 'KeyD', 82: 'KeyR', 80: 'KeyP', 32: 'Space',
    38: 'ArrowUp', 40: 'ArrowDown', 37: 'ArrowLeft', 39: 'ArrowRight', 27: 'Escape', 13: 'Enter', 114: 'F3' };
