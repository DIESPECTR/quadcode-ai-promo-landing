// RaceScene.js — everything you SEE of the circuit, built from RaceTrack samples: asphalt,
// kerbs, lines, barriers, start/finish gantry, grandstand, trees, bushes, the mill landmark
// and the car (Blender GLB with a procedural fallback). Map x/y = Babylon X/Z, Y — height.
// Many copies of one thing go through World3D.addInstances (one draw call each).
//
//     const scene = new RaceScene(app, track);
//     scene.placeCar(car);            // every frame: position, heading, lean, wheels

// Surface heights (px above the ground) — flat layers, no z-fighting.
const RACE_H = { road: 1.2, kerb: 1.8, line: 2.2 };

// Palette — sunny stylized club circuit (meta/plans/arcengine-racing-production.md).
const RACE_COLORS = {
    asphalt: '#3a3f47', line: '#f2eee3', kerbRed: '#d8433b', kerbWhite: '#f4f1ea',
    rail: '#b9c2c9', post: '#4a525c', tyre: '#1c2127', car: '#e2483d', carDark: '#23272e',
    glass: '#8fd0e6', trunk: '#7a5a3c', crown: '#3f8f5a', crown2: '#5aa665', rock: '#a79b86',
    sand: '#d9c08f', stand: '#e3d3b0', roof: '#c9523f', banner: '#20252c', chevron: '#f2b33d',
};

// Per-track palettes over RACE_COLORS (RACE_TRACKS[].theme.kind). surface — 'asphalt' gets
// painted lines; 'dirt' / 'snow' get tyre ruts instead. ground — the whole location floor
// (null keeps the grass texture).
const RACE_THEMES = {
    valley: { surface: 'asphalt', ground: null, shoulder: '#5f9448', bank: '#557f40' },
    canyon: {
        surface: 'dirt', ground: '#b9916a', asphalt: '#d0aa78', ruts: '#b2895d', kerbWhite: '#c7a075',
        kerbRed: '#b5532f', shoulder: '#bf996e', bank: '#926b50', rail: '#8a6243', post: '#4d3524',
        rock: '#a86447', rock2: '#dfac79', crown: '#6f8a3a', crown2: '#8ea24a', trunk: '#6b4a2f',
        strata: ['#71504a', '#995d49', '#c38458', '#dfac79'],
        plank: '#7a5434', lip: '#f2b33d', stand: '#d9b98a', roof: '#3c7fd1',
    },
    arctic: {
        surface: 'snow', ground: '#e8eff5', asphalt: '#d6e0e8', ruts: '#a9bccb', kerbWhite: '#f6f9fb',
        kerbRed: '#2f6fb0', shoulder: '#edf3f7', bank: '#dbe5ec', rail: '#8e9ead', post: '#3d4a57',
        rock: '#9fb3c4', rock2: '#c4d3df', crown: '#2f5d4a', crown2: '#f4f8fb', trunk: '#5a4434',
        plank: '#86b3d6', lip: '#e2483d', stand: '#c9d5df', roof: '#e2483d',
    },
};

class RaceScene {
    /** @param {any} app @param {RaceTrack} track @param {any} [def] RACE_TRACKS entry */
    constructor(app, track, def) {
        this.app = app;
        this.track = track;
        this.def = def || { id: 'valley', theme: { kind: 'valley' } };
        this.kind = (this.def.theme && this.def.theme.kind) || 'valley';
        this.C = Object.assign({}, RACE_COLORS, RACE_THEMES[this.kind] || RACE_THEMES.valley);
        this.view = app.location.view;
        this.scene = this.view.scene;
        this._mats = {};
        this._cameraMeshes = new Set();
        this._cameraTrees = new Map();
        this._objs = [];             // World3D.addObject roots we own (dispose)
        this._insts = [];            // Instances3D we own (dispose)
        this._models = [];           // Model3D roots (async GLB) we own (dispose with materials)
        this._before = new Set(this.scene.meshes);   // anything new after this is ours
        this._dead = false;
        this._rand = RaceScene.rng(7 + (this.def.id || '').length * 13);
        this.cars = [];
        this._applyGround();
        this._buildRoad();
        this._buildKerbs();
        this._buildShoulders();
        this._buildJumps();
        this._buildMud();
        this._buildBarriers();
        this._buildStart();
        this._buildGrandstand();
        if (this.kind === 'valley') this._buildNature(); else this._buildWild();
        if (this.kind === 'valley') this._buildLandmarks();
        this.player = this.addCar(this.C.car);
        // Back-compat for code that reads the single car (Game, tests).
        this.carRoot = this.player.root;
        this.carLean = this.player.lean;
        this.wheels = this.player.wheels;
        this._owned = this.scene.meshes.filter((m) => !this._before.has(m));
        this._before = null;
    }

    // Wrappers that remember what we register, so dispose() can take the track down cleanly.
    _add(mesh, kind, opts) {
        World3D.addObject(this.view, mesh, kind, opts);
        this._objs.push(mesh);
        if (kind === 'prop') for (const part of [mesh].concat(mesh.getChildMeshes(false))) {
            if (part.getTotalVertices() > 0) this._cameraMeshes.add(part);
        }
        return mesh;
    }

    _inst(source, kind, items, opts) {
        const inst = World3D.addInstances(this.view, source, kind, items, opts);
        this._insts.push(inst);
        if (kind === 'prop' && !(opts && opts.dynamic)) for (const part of inst.parts) {
            part.thinInstanceEnablePicking = true;
            this._cameraMeshes.add(part);
        }
        return inst;
    }

    // Segment-box broad phase, inclusive at the boundary and parallel-safe.
    static cameraBoxHit(ray, min, max) {
        let near = 0, far = ray.length;
        for (const axis of ['x', 'y', 'z']) {
            const o = ray.origin[axis], d = ray.direction[axis];
            if (Math.abs(d) < 1e-9) { if (o < min[axis] || o > max[axis]) return false; continue; }
            let a = (min[axis] - o) / d, b = (max[axis] - o) / d;
            if (a > b) [a, b] = [b, a];
            near = Math.max(near, a); far = Math.min(far, b);
            if (near > far) return false;
        }
        return true;
    }

    // Triangle BVH is independent of render submeshes: no extra draw calls for road ribbons.
    static cameraGeometry(mesh) {
        const positions = mesh.getVerticesData('position'), indices = mesh.getIndices(), triangles = [];
        const point = i => new BABYLON.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        for (let i = 0; i < indices.length; i += 3) triangles.push({
            a: point(indices[i]), b: point(indices[i + 1]), c: point(indices[i + 2]) });
        const build = list => {
            const min = new BABYLON.Vector3(Infinity, Infinity, Infinity), max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
            for (const t of list) for (const p of [t.a, t.b, t.c]) for (const axis of ['x', 'y', 'z']) {
                min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]);
            }
            if (list.length <= 16) return { min, max, triangles: list };
            const axis = ['x', 'y', 'z'].sort((a, b) => (max[b] - min[b]) - (max[a] - min[a]))[0];
            list.sort((a, b) => (a.a[axis] + a.b[axis] + a.c[axis]) - (b.a[axis] + b.b[axis] + b.c[axis]));
            const middle = list.length >> 1;
            return { min, max, left: build(list.slice(0, middle)), right: build(list.slice(middle)) };
        };
        return build(triangles);
    }

    static cameraTriangleDistance(ray, tree) {
        let closest = ray.length, found = false;
        const stack = [tree];
        while (stack.length) {
            const node = stack.pop();
            if (!RaceScene.cameraBoxHit(ray, node.min, node.max)) continue;
            if (node.triangles) for (const t of node.triangles) {
                const hit = ray.intersectsTriangle(t.a, t.b, t.c);
                if (hit && hit.distance >= 0 && hit.distance <= closest) { closest = hit.distance; found = true; }
            } else stack.push(node.left, node.right);
        }
        return found ? closest : null;
    }

    // Static source geometry and instance transforms do not change during a race.
    // Cache each INSTANCE's box and inverse, rather than ray-picking a whole batched forest.
    _cameraRayHit(ray) {
        if (this._cameraBoundsSize !== this._cameraMeshes.size) {
            this._cameraBounds = [];
            for (const mesh of this._cameraMeshes) {
                if (mesh.isDisposed()) continue;
                const base = mesh.computeWorldMatrix(true), raw = mesh.getRawBoundingInfo().boundingBox;
                const matrices = mesh.thinInstanceCount > 0 ? mesh.thinInstanceGetWorldMatrices().map(m => m.multiply(base)) : [base.clone()];
                for (const world of matrices) {
                    const box = new BABYLON.BoundingInfo(raw.minimum, raw.maximum, world).boundingBox;
                    this._cameraBounds.push({ mesh, world, inverse: BABYLON.Matrix.Invert(world),
                        min: box.minimumWorld.clone(), max: box.maximumWorld.clone() });
                }
            }
            this._cameraBoundsSize = this._cameraMeshes.size;
        }
        let closest = null;
        for (const part of this._cameraBounds) {
            const mesh = part.mesh;
            if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible ||
                !RaceScene.cameraBoxHit(ray, part.min, part.max)) continue;
            const local = BABYLON.Ray.Transform(ray, part.inverse);
            let tree = this._cameraTrees.get(mesh);
            if (!tree) { tree = RaceScene.cameraGeometry(mesh); this._cameraTrees.set(mesh, tree); }
            const distance = RaceScene.cameraTriangleDistance(local, tree);
            if (distance == null) continue;
            const point = BABYLON.Vector3.TransformCoordinates(local.origin.add(local.direction.scale(distance)), part.world);
            const worldDistance = BABYLON.Vector3.Distance(ray.origin, point);
            if (worldDistance <= ray.length && (!closest || worldDistance < closest.distance))
                closest = { hit: true, distance: worldDistance, pickedMesh: mesh };
        }
        return closest;
    }

    // Camera query uses authored geometry, including individual thin instances, not batch bounds.
    // Seven parallel probes provide clearance around the eye; this is not a full swept sphere.
    cameraObstruction(anchor, eye) {
        const pad = typeof GAME_CAMERA_CLEARANCE !== 'undefined' ? GAME_CAMERA_CLEARANCE : 16;
        const from = new BABYLON.Vector3(anchor.x, anchor.h, anchor.y);
        const delta = new BABYLON.Vector3(eye.x - anchor.x, eye.h - anchor.h, eye.y - anchor.y);
        const length = delta.length();
        if (this._dead || length < 1e-6) return { anchor, fraction: 1 };
        const direction = delta.scale(1 / length);
        let distance = length;
        const offsets = [[0, 0, 0], [pad, 0, 0], [-pad, 0, 0],
            [0, pad, 0], [0, -pad, 0], [0, 0, pad], [0, 0, -pad]];
        for (const [x, y, z] of offsets) {
            const ray = new BABYLON.Ray(from.add(new BABYLON.Vector3(x, y, z)), direction, length);
            const hit = this._cameraRayHit(ray);
            if (hit && hit.hit) distance = Math.min(distance, Math.max(0, hit.distance - pad));
        }
        return { anchor, fraction: distance / length };
    }

    // Location floor colour for the theme (the grass texture is kept aside and put back on dispose).
    _applyGround() {
        const terr = this.app.location && this.app.location.terrain;
        if (!terr || !this.C.ground) return;
        this._terrainSaved = {
            tex: terr.material.diffuseTexture, col: terr.material.diffuseColor.clone(),
            otex: terr.outerMaterial.diffuseTexture, ocol: terr.outerMaterial.diffuseColor.clone(),
        };
        const c = BABYLON.Color3.FromHexString(this.C.ground);
        terr.material.diffuseTexture = null;
        terr.material.diffuseColor = c;
        terr.outerMaterial.diffuseTexture = null;
        terr.outerMaterial.diffuseColor = c.scale(0.9);
    }

    // Take the whole track down: registered objects, instances, any mesh created since the
    // constructor (async models too), our materials; the ground texture comes back.
    dispose() {
        this._dead = true;
        this._cameraMeshes && this._cameraMeshes.clear();
        this._cameraTrees && this._cameraTrees.clear();
        this._cameraBounds = [];
        this._cameraBoundsSize = -1;
        // Imported materials must be collected before batches or parents destroy their meshes.
        for (const m of this._models) { try { if (!m.isDisposed()) Model3D.dispose(this.view, m); } catch (e) { /* ok */ } }
        for (const inst of this._insts) { try { inst.dispose(); } catch (e) { /* ok */ } }
        for (const m of this._objs) { try { if (!m.isDisposed()) World3D.removeObject(this.view, m); } catch (e) { /* ok */ } }
        // Meshes made synchronously while building (instance sources, helpers) — ours too.
        for (const m of this._owned || []) {
            if (!m.isDisposed()) { try { this.view.removeShadowCaster(m); m.dispose(false, false); } catch (e) { /* ok */ } }
        }
        for (const k in this._mats) { try { this._mats[k].dispose(); } catch (e) { /* ok */ } }
        for (const car of this.cars) for (const m of car.mats || []) { try { m.dispose(); } catch (e) { /* ok */ } }
        const terr = this.app.location && this.app.location.terrain, s = this._terrainSaved;
        if (terr && s) {
            terr.material.diffuseTexture = s.tex; terr.material.diffuseColor = s.col;
            terr.outerMaterial.diffuseTexture = s.otex; terr.outerMaterial.diffuseColor = s.ocol;
        }
        this._objs = []; this._insts = []; this._models = []; this._owned = []; this._mats = {}; this.cars = [];
    }

    // Deterministic PRNG — the same scenery every load.
    static rng(seed) {
        let s = seed >>> 0;
        return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }

    mat(key, hex, opts) {
        if (this._mats[key]) return this._mats[key];
        const m = new BABYLON.StandardMaterial('race-' + key, this.scene);
        m.diffuseColor = BABYLON.Color3.FromHexString(hex);
        m.specularColor = BABYLON.Color3.Black();
        if (opts && opts.unlit) { m.disableLighting = true; m.emissiveColor = m.diffuseColor.clone(); }
        this._mats[key] = m;
        return m;
    }

    // Point at arc sample i shifted by `off` px along the right-hand normal, at height y.
    // y is relative to the road height at the sample (jumps lift road, kerbs, rails together).
    _at(i, off, y) {
        const t = this.track, h = t.h ? t.h[i] : 0;
        return new BABYLON.Vector3(t.px[i] - t.ty[i] * off, y + h, t.py[i] + t.tx[i] * off);
    }

    // Flat (or vertical) strip along the whole loop between two offsets.
    _strip(name, offA, offB, yA, yB, material, opts) {
        const t = this.track, A = [], B = [];
        for (let k = 0; k <= t.count; k++) {
            const i = k % t.count;
            A.push(this._at(i, offA, yA));
            B.push(this._at(i, offB, yB));
        }
        const mesh = BABYLON.MeshBuilder.CreateRibbon(name, { pathArray: [A, B], sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
        mesh.material = material;
        this._add(mesh, 'prop', Object.assign({ castShadow: false, ink: false, outline: false }, opts || {}));
        mesh.receiveShadows = true;
        return mesh;
    }

    // Copies of `mesh` at every `every` px along the loop at lateral offset(s).
    _along(mesh, every, offsets, h, filter) {
        const t = this.track, items = [], stride = Math.max(1, Math.round(every / t.ds));
        for (let i = 0; i < t.count; i += stride) {
            if (filter && !filter(i)) continue;
            const heading = Math.atan2(t.ty[i], t.tx[i]);
            for (const off of offsets) {
                const p = this._at(i, off, h);
                items.push({ x: p.x, y: p.z, h: p.y, heading });
            }
        }
        return this._inst(mesh, 'prop', items, { castShadow: false, ink: false, outline: false });
    }

    _buildRoad() {
        const t = this.track, w = t.halfWidth, C = this.C;
        this._strip('race-asphalt', -w, w, RACE_H.road, RACE_H.road, this.mat('asphalt', C.asphalt));
        if (C.surface !== 'asphalt') {
            // Dirt / snow: two pairs of darker tyre ruts instead of painted lines.
            const rut = this.mat('ruts', C.ruts);
            for (const c of [-w * 0.45, w * 0.45]) {
                this._strip('race-rut', c - 16, c - 8, RACE_H.line - 0.6, RACE_H.line - 0.6, rut);
                this._strip('race-rut', c + 8, c + 16, RACE_H.line - 0.6, RACE_H.line - 0.6, rut);
            }
            return;
        }
        const line = this.mat('line', RACE_COLORS.line);
        this._strip('race-edge-l', -w + 6, -w + 11, RACE_H.line, RACE_H.line, line);
        this._strip('race-edge-r', w - 11, w - 6, RACE_H.line, RACE_H.line, line);
        // Dashed centre line.
        const dash = BABYLON.MeshBuilder.CreateGround('race-dash', { width: 26, height: 4 }, this.scene);
        dash.material = line;
        dash.position.y = 0;
        this._along(dash, 56, [0], RACE_H.line, null);
    }

    _buildKerbs() {
        const t = this.track, a = t.halfWidth, b = t.halfWidth + t.kerb;
        // White base strip on both sides, red blocks on top every other 32 px — only on corners
        // (on the straights the kerb stays white: less noise, corners read at a glance).
        const C = this.C;
        this._strip('race-kerb-l', -b, -a, RACE_H.kerb - 0.2, RACE_H.kerb - 0.2, this.mat('kerbW', C.kerbWhite));
        this._strip('race-kerb-r', a, b, RACE_H.kerb - 0.2, RACE_H.kerb - 0.2, this.mat('kerbW', C.kerbWhite));
        const block = BABYLON.MeshBuilder.CreateGround('race-kerb-red', { width: 16, height: t.kerb }, this.scene);
        block.material = this.mat('kerbR', C.kerbRed);
        const corner = (i) => Math.abs(t.curvature(i)) > 0.0016;
        let flip = 0;
        this._along(block, 32, [-(a + b) / 2, (a + b) / 2], RACE_H.kerb, (i) => corner(i) && (flip++ % 2 === 0));
        if (this.kind !== 'valley') return;
        // Sand run-off on the OUTSIDE of the tighter corners — the classic "you went wide" look.
        const sand = BABYLON.MeshBuilder.CreateGround('race-sand', { width: 12, height: t.runoff - 6 }, this.scene);
        sand.material = this.mat('sand', RACE_COLORS.sand);
        const outside = (i, side) => Math.abs(t.curvature(i)) > 0.0024 && Math.sign(t.curvature(i)) === -side;
        this._along(sand, 10, [b + t.runoff / 2 - 2], RACE_H.road - 0.4, (i) => outside(i, 1));
        this._along(sand, 10, [-(b + t.runoff / 2 - 2)], RACE_H.road - 0.4, (i) => outside(i, -1));
    }

    // Run-off between the kerb and the barrier, at road height. On flat valley it is just grass
    // (the terrain shows through), elsewhere it carries the theme colour, and where the road is
    // lifted (jumps) an embankment slopes from the barrier down to the ground.
    _buildShoulders() {
        const t = this.track, C = this.C, b = t.halfWidth + t.kerb, off = t.wall + 4;
        if (this.kind !== 'valley') {
            const sh = this.mat('shoulder', C.shoulder);
            this._strip('race-shoulder-l', -off, -b, RACE_H.road - 0.5, RACE_H.road - 0.5, sh);
            this._strip('race-shoulder-r', b, off, RACE_H.road - 0.5, RACE_H.road - 0.5, sh);
        }
        if (!t.hasHeight) return;
        // Embankment: inner edge follows the road height, outer edge on the ground (y 0.4).
        const bank = this.mat('bank', C.bank);
        for (const side of [-1, 1]) {
            const A = [], B = [];
            for (let k = 0; k <= t.count; k++) {
                const i = k % t.count;
                A.push(this._at(i, side * off, RACE_H.road - 0.6));
                const o = t.bankOffset(i, side);
                B.push(new BABYLON.Vector3(t.px[i] - t.ty[i] * o, 0.4, t.py[i] + t.tx[i] * o));
            }
            const m = BABYLON.MeshBuilder.CreateRibbon('race-bank', { pathArray: [A, B], sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
            m.material = bank;
            this._add(m, 'prop', { castShadow: false, ink: false, outline: false });
            m.receiveShadows = true;
        }
    }

    // Jumps: wooden planks on the kicker face, a bright lip stripe at the take-off and
    // chevron marker boards on both sides, so the player sees the jump coming.
    _buildJumps() {
        const t = this.track, C = this.C, w = t.halfWidth;
        if (!t.hasHeight) return;
        const plankItems = [], lipItems = [], markItems = [];
        for (const f of t.features) {
            // Take-off sample: top of a ramp, middle of a crest, start of a table's fall.
            const top = f.type === 'ramp' ? f.s0 + f.len : f.type === 'table' ? f.s0 + f.len * 0.7 : f.s0 + f.len / 2;
            const iTop = t.wrap(Math.round(top / t.ds));
            const hd = Math.atan2(t.ty[iTop], t.tx[iTop]);
            if (f.type === 'ramp') {
                // Planks every 14 px along the kicker face.
                for (let d = 6; d < f.len; d += 14) {
                    const i = t.wrap(Math.round((f.s0 + d) / t.ds));
                    const p = this._at(i, 0, RACE_H.line);
                    plankItems.push({ x: p.x, y: p.z, h: p.y, heading: Math.atan2(t.ty[i], t.tx[i]) });
                }
            }
            const lp = this._at(iTop, 0, RACE_H.line + 0.3);
            lipItems.push({ x: lp.x, y: lp.z, h: lp.y, heading: hd });
            // Warning markers 1/3 of the way up, both sides.
            const iM = t.wrap(Math.round((f.s0 + f.len * 0.2) / t.ds));
            for (const side of [-1, 1]) {
                const p = this._at(iM, side * (w + t.kerb + 14), 0);
                markItems.push({ x: p.x, y: p.z, h: p.y, heading: Math.atan2(t.ty[iM], t.tx[iM]) });
            }
        }
        const plank = BABYLON.MeshBuilder.CreateBox('race-plank', { width: 9, height: 1.4, depth: w * 2 - 8 }, this.scene);
        plank.material = this.mat('plank', C.plank || C.chevron);
        if (plankItems.length) this._inst(plank, 'prop', plankItems, { castShadow: false, ink: false, outline: false });
        const lip = BABYLON.MeshBuilder.CreateBox('race-lip', { width: 8, height: 1.6, depth: w * 2 }, this.scene);
        lip.material = this.mat('lip', C.lip || C.chevron, { unlit: true });
        this._inst(lip, 'prop', lipItems, { castShadow: false, ink: false, outline: false });
        const mark = BABYLON.MeshBuilder.CreateBox('race-jump-mark', { width: 4, height: 34, depth: 16 }, this.scene);
        mark.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 17, 0));
        mark.material = this.mat('lip', C.lip || C.chevron, { unlit: true });
        this._inst(mark, 'prop', markItems, { castShadow: true, ink: true, outline: false });
    }

    // Mud bogs / slush pits: a dark band in the exact shape RaceTrack.zoneAt uses for the
    // physics, plus a glossy wet centre — so "looks like mud" = "drives like mud".
    _buildMud() {
        const t = this.track;
        if (!t.zones || !t.zones.length) return;
        const arctic = this.kind === 'arctic';
        const mud = this.mat('mud', arctic ? '#9aa9b6' : '#5a3a22');
        const wet = this.mat('mud-wet', arctic ? '#7f93a5' : '#3f2716');
        wet.specularColor = new BABYLON.Color3(0.35, 0.35, 0.35);
        wet.specularPower = 24;
        const ribbon = (z, inset, y, m) => {
            const A = [], B = [];
            for (let d = 0; d <= z.len; d += t.ds) {
                const i = t.wrap(Math.round((z.s0 + d) / t.ds)), e = t.zoneEdges(z, d, inset);
                A.push(this._at(i, e[0], y));
                B.push(this._at(i, e[1], y));
            }
            const mesh = BABYLON.MeshBuilder.CreateRibbon('race-mud', { pathArray: [A, B], sideOrientation: BABYLON.Mesh.DOUBLESIDE }, this.scene);
            mesh.material = m;
            this._add(mesh, 'prop', { castShadow: false, ink: false, outline: false });
            mesh.receiveShadows = true;
        };
        for (const z of t.zones) {
            ribbon(z, 0, RACE_H.line - 0.1, mud);
            ribbon(z, 0.5, RACE_H.line + 0.2, wet);
        }
    }

    _buildBarriers() {
        const t = this.track, off = t.wall + 4;
        const rail = this.mat('rail', this.C.rail);
        for (const side of [-1, 1]) {
            this._strip('race-rail-' + side, side * off, side * off, 10, 22, rail, { castShadow: true, ink: true });
        }
        const post = BABYLON.MeshBuilder.CreateBox('race-post', { width: 4, height: 22, depth: 4 }, this.scene);
        post.material = this.mat('post', this.C.post);
        post.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 11, 0));
        this._along(post, 64, [-off - 3, off + 3], 0, null);
        // Chevron boards on the outside of the sharp corners.
        const board = BABYLON.MeshBuilder.CreateBox('race-chevron', { width: 20, height: 18, depth: 3 }, this.scene);
        board.material = this.mat('chevron', RACE_COLORS.chevron);
        board.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 30, 0));
        const sharp = (i, side) => Math.abs(t.curvature(i)) > 0.003 && Math.sign(t.curvature(i)) === -side;
        this._along(board, 48, [off + 8], 0, (i) => sharp(i, 1));
        this._along(board, 48, [-off - 8], 0, (i) => sharp(i, -1));
    }

    _buildStart() {
        const t = this.track, p = t.pointAt(0), heading = Math.atan2(p.ty, p.tx), w = t.halfWidth;
        // Chequered line: two rows of squares across the road.
        const sq = 12, cols = Math.floor((w * 2) / sq);
        const white = [], black = [];
        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < cols; c++) {
                const along = (r - 0.5) * sq, across = -w + sq / 2 + c * sq;
                const item = { x: p.x + p.tx * along - p.ty * across, y: p.y + p.ty * along + p.tx * across, h: RACE_H.line, heading };
                ((r + c) % 2 ? black : white).push(item);
            }
        }
        const mk = (name, hex, items) => {
            const m = BABYLON.MeshBuilder.CreateGround(name, { width: sq, height: sq }, this.scene);
            m.material = this.mat(name, hex);
            this._inst(m, 'prop', items, { castShadow: false, ink: false, outline: false });
        };
        mk('race-check-w', '#f4f1ea', white);
        mk('race-check-b', '#1b1f24', black);
        // Grid box behind the line.
        const grid = BABYLON.MeshBuilder.CreateGround('race-grid', { width: 4, height: 44 }, this.scene);
        grid.material = this.mat('line', RACE_COLORS.line);
        const s0 = t.length - 70, g = t.pointAt(s0), gh = Math.atan2(g.ty, g.tx);
        this._inst(grid, 'prop', [
            { x: g.x - g.tx * 30, y: g.y - g.ty * 30, h: RACE_H.line, heading: gh },
        ], { castShadow: false, ink: false, outline: false });

        // Gantry over the line: two pillars and a banner.
        const root = new BABYLON.Mesh('race-gantry', this.scene);
        const span = w + t.kerb + 26;
        const dark = this.mat('banner', RACE_COLORS.banner), red = this.mat('kerbR', RACE_COLORS.kerbRed);
        for (const s of [-1, 1]) {
            const pil = BABYLON.MeshBuilder.CreateBox('gantry-pillar', { width: 12, height: 466, depth: 12 }, this.scene);
            pil.position.set(0, 233, s * span);
            pil.material = dark;
            pil.parent = root;
        }
        const beam = BABYLON.MeshBuilder.CreateBox('gantry-beam', { width: 16, height: 26, depth: span * 2 + 12 }, this.scene);
        beam.position.set(0, 453, 0);
        beam.material = red;
        beam.parent = root;
        const stripe = BABYLON.MeshBuilder.CreateBox('gantry-stripe', { width: 17, height: 6, depth: span * 2 + 13 }, this.scene);
        stripe.position.set(0, 453, 0);
        stripe.material = this.mat('kerbW', RACE_COLORS.kerbWhite);
        stripe.parent = root;
        root.position.set(p.x, this.track.h ? this.track.h[0] : 0, p.y);
        root.rotation.y = -heading;
        this._add(root, 'prop');
        this.startHeading = heading;
    }

    _buildGrandstand() {
        const t = this.track, side = -1;   // inside of the start straight (the infield)
        const s = 380, p = t.pointAt(s), heading = Math.atan2(p.ty, p.tx);
        const off = side * (t.wall + 70);
        const root = new BABYLON.Mesh('race-stand', this.scene);
        const stand = this.mat('stand', this.C.stand);
        for (let k = 0; k < 4; k++) {
            const step = BABYLON.MeshBuilder.CreateBox('stand-step', { width: 420, height: 14 + k * 14, depth: 22 }, this.scene);
            step.position.set(0, (14 + k * 14) / 2, -side * 0 + side * k * 22);
            step.material = stand;
            step.parent = root;
        }
        const roof = BABYLON.MeshBuilder.CreateBox('stand-roof', { width: 440, height: 6, depth: 110 }, this.scene);
        roof.position.set(0, 110, side * 34);
        roof.material = this.mat('roof', this.C.roof);
        roof.parent = root;
        for (const x of [-200, 0, 200]) {
            const col = BABYLON.MeshBuilder.CreateBox('stand-col', { width: 6, height: 110, depth: 6 }, this.scene);
            col.position.set(x, 55, side * 80);
            col.material = this.mat('post', RACE_COLORS.post);
            col.parent = root;
        }
        root.position.set(p.x - p.ty * off, 0, p.y + p.tx * off);
        root.rotation.y = -heading;
        this._add(root, 'prop');
        // Spectators: small coloured blocks on the steps (3 colours = 3 draw calls).
        const rand = this._rand, groups = [[], [], []];
        for (let k = 0; k < 4; k++) {
            for (let x = -196; x <= 196; x += 12) {
                if (rand() < 0.25) continue;
                const lx = x + (rand() - 0.5) * 4, lz = side * k * 22;
                const wx = p.x - p.ty * off + p.tx * lx - p.ty * lz;
                const wy = p.y + p.tx * off + p.ty * lx + p.tx * lz;
                groups[Math.floor(rand() * 3)].push({ x: wx, y: wy, h: 14 + k * 14, heading });
            }
        }
        ['#e2483d', '#3c7fd1', '#f2c14e'].forEach((hex, gi) => {
            const fan = BABYLON.MeshBuilder.CreateBox('race-fan-' + gi, { width: 7, height: 12, depth: 7 }, this.scene);
            fan.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 6, 0));
            fan.material = this.mat('fan' + gi, hex);
            this._inst(fan, 'prop', groups[gi], { castShadow: false, ink: false, outline: false });
        });
    }

    // Is (x, y) free for scenery: far enough from the track and inside the location.
    _free(x, y, margin) {
        const L = this.app.location;
        if (x < 40 || y < 40 || x > L.width - 40 || y > L.height - 40) return false;
        const p = this.track.project(x, y);
        return Math.abs(p.lat) > this.track.wall + margin;
    }

    _buildNature() {
        const rand = this._rand, scene = this.scene;
        // Low-poly tree: trunk + two stacked cones, ~90 px tall.
        const tree = new BABYLON.Mesh('race-tree', scene);
        const trunk = BABYLON.MeshBuilder.CreateCylinder('tree-trunk', { height: 30, diameterTop: 7, diameterBottom: 10, tessellation: 6 }, scene);
        trunk.position.y = 15; trunk.material = this.mat('trunk', RACE_COLORS.trunk); trunk.parent = tree;
        const c1 = BABYLON.MeshBuilder.CreateCylinder('tree-crown1', { height: 50, diameterTop: 0, diameterBottom: 56, tessellation: 7 }, scene);
        c1.position.y = 48; c1.material = this.mat('crown', RACE_COLORS.crown); c1.parent = tree;
        const c2 = BABYLON.MeshBuilder.CreateCylinder('tree-crown2', { height: 38, diameterTop: 0, diameterBottom: 40, tessellation: 7 }, scene);
        c2.position.y = 74; c2.material = this.mat('crown2', RACE_COLORS.crown2); c2.parent = tree;
        // Trees in clusters: pick cluster centres, scatter around them.
        const trees = [], W = this.app.location.width, H = this.app.location.height;
        for (let c = 0; c < 140 && trees.length < 700; c++) {
            const cx = rand() * W, cy = rand() * H;
            if (!this._free(cx, cy, 80)) continue;
            const n = 3 + Math.floor(rand() * 7);
            for (let k = 0; k < n; k++) {
                const x = cx + (rand() - 0.5) * 220, y = cy + (rand() - 0.5) * 220;
                if (!this._free(x, y, 110)) continue;   // tall crowns stay clear of the chase view
                trees.push({ x, y, h: 0, heading: rand() * 6.28, scale: 0.75 + rand() * 0.6 });
            }
        }
        // Tree line along the outer edge of the location — frames the view, hides the void.
        // Valley sits in the middle 2048 of the world: the frame of trees goes around that block.
        const o = (W - 2048) / 2;
        for (let a = o; a < o + 2048; a += 70) {
            for (const [x, y] of [[a, o + 70], [a, o + 1980], [o + 70, a], [o + 1980, a]]) {
                const jx = x + (rand() - 0.5) * 50, jy = y + (rand() - 0.5) * 50;
                if (this._free(jx, jy, 40)) trees.push({ x: jx, y: jy, h: 0, heading: rand() * 6.28, scale: 0.9 + rand() * 0.5 });
            }
        }
        this._inst(tree, 'prop', trees, { castShadow: true });
        this.treeCount = trees.length;

        // Rocks — flattened low-poly spheres near the run-off.
        const rock = BABYLON.MeshBuilder.CreateIcoSphere('race-rock', { radius: 12, subdivisions: 1 }, scene);
        rock.scaling.y = 0.6;
        rock.bakeCurrentTransformIntoVertices();
        rock.material = this.mat('rock', RACE_COLORS.rock);
        const rocks = [];
        for (let k = 0; k < 1600 && rocks.length < 70; k++) {
            const x = rand() * W, y = rand() * H;
            if (this._free(x, y, 24) && !this._free(x, y, 120)) rocks.push({ x, y, h: 2, heading: rand() * 6.28, scale: 0.6 + rand() * 1.2 });
        }
        this._inst(rock, 'prop', rocks, { castShadow: true });

        // Bushes from the kit's own model, along the barriers.
        Model3D.load('assets/models/Bush_3.fbx', scene).then((model) => {
            if (this._dead) return;
            const root = Model3D.build(model, scene, { name: 'race-bush' });
            this._models.push(root);
            // The kit bush is ~250 px tall — normalize to ~45 px so it never hides the road.
            root.computeWorldMatrix(true);
            const bb = root.getHierarchyBoundingVectors(true);
            const fit = 45 / Math.max(1, bb.max.y - bb.min.y);
            const bushes = [];
            for (let k = 0; k < 2400 && bushes.length < 120; k++) {
                const x = rand() * W, y = rand() * H;
                if (this._free(x, y, 14) && !this._free(x, y, 70)) bushes.push({ x, y, h: 0, heading: rand() * 6.28, scale: fit * (0.7 + rand() * 0.5) });
            }
            this._inst(root, 'prop', bushes, { castShadow: true });
        }).catch((e) => console.warn('RaceScene: bushes not loaded', e));
    }

    _buildLandmarks() {
        // The mill — the big landmark of the infield, visible from most of the lap.
        const scene = this.scene;
        Model3D.load('assets/models/mill.fbx', scene).then((model) => {
            if (this._dead) return;
            const root = Model3D.build(model, scene, { name: 'race-mill' });
            const o = (this.app.location.width - 2048) / 2;   // valley is centred in the world
            const spot = this._findSpot(1080 + o, 1100 + o, 140);
            root.position.set(spot.x, 0, spot.y);
            root.rotation.y = 0.6;
            this._add(root, 'prop');
            this._models.push(root);
            this.mill = root;
        }).catch((e) => console.warn('RaceScene: mill not loaded', e));
    }

    // Scenery for the off-road themes, all procedural (no extra assets):
    //   canyon — sandstone mesas and boulders, scrubby green trees;
    //   arctic — snow-capped pines, ice boulders, snow drifts.
    _buildWild() {
        const rand = this._rand, scene = this.scene, C = this.C, arctic = this.kind === 'arctic';
        // Trees: canyon — squat round scrub; arctic — tall pine with a white tip.
        const tree = new BABYLON.Mesh('race-tree', scene);
        const trunk = BABYLON.MeshBuilder.CreateCylinder('tree-trunk', { height: 24, diameterTop: 6, diameterBottom: 9, tessellation: 6 }, scene);
        trunk.position.y = 12; trunk.material = this.mat('trunk', C.trunk); trunk.parent = tree;
        if (arctic) {
            const c1 = BABYLON.MeshBuilder.CreateCylinder('tree-crown1', { height: 60, diameterTop: 0, diameterBottom: 50, tessellation: 7 }, scene);
            c1.position.y = 50; c1.material = this.mat('crown', C.crown); c1.parent = tree;
            const c2 = BABYLON.MeshBuilder.CreateCylinder('tree-crown2', { height: 26, diameterTop: 0, diameterBottom: 24, tessellation: 7 }, scene);
            c2.position.y = 82; c2.material = this.mat('crown2', C.crown2); c2.parent = tree;
        } else {
            const c1 = BABYLON.MeshBuilder.CreateIcoSphere('tree-crown1', { radius: 22, subdivisions: 1 }, scene);
            c1.scaling.y = 0.7; c1.position.y = 34; c1.material = this.mat('crown', C.crown); c1.parent = tree;
        }
        const trees = [], W = this.app.location.width, H = this.app.location.height;
        for (let c = 0; c < 150 && trees.length < 800; c++) {
            const cx = rand() * W, cy = rand() * H;
            if (!this._free(cx, cy, 80)) continue;
            const n = arctic ? 4 + Math.floor(rand() * 7) : 2 + Math.floor(rand() * 4);
            for (let k = 0; k < n; k++) {
                const x = cx + (rand() - 0.5) * 200, y = cy + (rand() - 0.5) * 200;
                if (this._free(x, y, 100)) trees.push({ x, y, h: 0, heading: rand() * 6.28, scale: 0.75 + rand() * 0.6 });
            }
        }
        for (let a = 0; a < W; a += 90) {
            for (const [x, y] of [[a, 70], [a, H - 70], [70, a], [W - 70, a]]) {
                const jx = x + (rand() - 0.5) * 50, jy = y + (rand() - 0.5) * 50;
                if (this._free(jx, jy, 40)) trees.push({ x: jx, y: jy, h: 0, heading: rand() * 6.28, scale: 0.9 + rand() * 0.5 });
            }
        }
        this._inst(tree, 'prop', trees, { castShadow: true });
        this.treeCount = trees.length;

        // Boulders near the run-off (they make the barriers feel dangerous).
        const rock = BABYLON.MeshBuilder.CreateIcoSphere('race-rock', { radius: 14, subdivisions: 1 }, scene);
        rock.scaling.y = 0.65;
        rock.bakeCurrentTransformIntoVertices();
        rock.material = this.mat('rock', C.rock);
        const rocks = [];
        for (let k = 0; k < 4000 && rocks.length < 260; k++) {
            const x = rand() * W, y = rand() * H;
            if (this._free(x, y, 24) && !this._free(x, y, 140)) rocks.push({ x, y, h: 2, heading: rand() * 6.28, scale: 0.6 + rand() * 1.4 });
        }
        this._inst(rock, 'prop', rocks, { castShadow: true });

        // Skyline: one four-band sandstone module, instanced rather than dozens of materials.
        const big = arctic
            ? BABYLON.MeshBuilder.CreateIcoSphere('race-drift', { radius: 40, subdivisions: 1 }, scene)
            : this._canyonMesa('race-mesa');
        if (arctic) {
            big.scaling.y = 0.35; big.bakeCurrentTransformIntoVertices();
            big.material = this.mat('rock2', C.rock2);
        }
        const bigs = [];
        for (let k = 0; k < 2000 && bigs.length < (arctic ? 120 : 46); k++) {
            const x = rand() * W, y = rand() * H;
            if (this._free(x, y, arctic ? 90 : 200)) bigs.push({ x, y, h: 0, heading: rand() * 6.28, scale: 0.7 + rand() * 0.8 });
        }
        this._inst(big, 'prop', bigs, { castShadow: true, ink: arctic, outline: false });
        if (!arctic) {
            this._buildCanyonGateway();
            this._buildCanyonWalls();
        }
    }

    // Enclosed first-jump/mud sector, then open space before the following crest.
    // Only safe sites are retained: footprint and world bounds, not merely root positions.
    _buildCanyonWalls() {
        const t = this.track, ramp = t.features.find(f => f.type === 'ramp'), zone = t.zones[0];
        if (!ramp || !zone) return;
        const items = [], W = this.app.location.width, H = this.app.location.height;
        for (let s = ramp.s0; s <= zone.s0 + zone.len; s += 130) {
            const p = t.pointAt(s), scale = 1.5 + 0.3 * Math.pow(Math.sin(s * 0.011), 2);
            const radius = 110 * scale; // circumscribes the authored module, including stratum offsets
            for (const side of [-1, 1]) {
                const off = side * (t.wall + 270), x = p.x - p.ty * off, y = p.y + p.tx * off;
                if (x - radius <= 40 || y - radius <= 40 || x + radius >= W - 40 || y + radius >= H - 40) continue;
                if (!this._free(x, y, radius + 40)) continue;
                items.push({ x, y, h: 0, heading: Math.atan2(p.ty, p.tx), scale });
            }
        }
        this.canyonWallItems = items;
        if (items.length) this._inst(this._canyonMesa('race-canyon-wall'), 'prop', items,
            { castShadow: true, ink: false, outline: false });
    }

    // Authored rock-module coordinates (asset geometry, not handling parameters).
    // Terraced silhouette and warm tops/cool bases remain readable without a new shader.
    _canyonMesa(name) {
        const root = new BABYLON.Mesh(name, this.scene);
        const bands = [[48, 180, 210, 24], [50, 170, 190, 73],
            [26, 150, 182, 111], [52, 128, 160, 150]];
        bands.forEach(([height, top, bottom, y], i) => {
            const rock = BABYLON.MeshBuilder.CreateCylinder(name + '-stratum-' + i,
                { height, diameterTop: top, diameterBottom: bottom, tessellation: 9 }, this.scene);
            rock.material = this.mat('sandstone-' + i, this.C.strata[i]);
            rock.position.set(i % 2 ? 4 : -3, y, i % 2 ? -3 : 2);
            rock.rotation.y = i * 0.17;
            rock.parent = root;
        });
        return root;
    }

    // A recognisable gateway BEFORE the first ramp, not an invisible obstacle over a landing.
    // Foundations sit beyond both physical walls; beam underside is 440 px above flat road.
    _buildCanyonGateway() {
        const t = this.track, ramp = t.features.find(f => f.type === 'ramp');
        if (!ramp) return;
        const s = ramp.s0 - ramp.len, p = t.pointAt(s), span = t.wall + 90;
        const root = new BABYLON.Mesh('race-canyon-gateway', this.scene);
        for (const side of [-1, 1]) {
            const pillar = this._canyonMesa('gateway-rock-' + side);
            pillar.scaling.set(0.65, 2.5, 0.65);
            pillar.position.set(0, 0, side * span);
            pillar.parent = root;
        }
        for (const [width, height, depth, y, band] of [
            [90, 54, span * 2 + 90, 467, 2], [72, 20, span * 2 + 50, 504, 3],
        ]) {
            const stone = BABYLON.MeshBuilder.CreateBox('gateway-cap', { width, height, depth }, this.scene);
            stone.position.y = y;
            stone.material = this.mat('sandstone-' + band, this.C.strata[band]);
            stone.parent = root;
        }
        root.position.set(p.x, t.heightAt(s), p.y);
        root.rotation.y = -Math.atan2(p.ty, p.tx);
        this._add(root, 'prop', { castShadow: true, ink: false, outline: false });
        this.canyonGateway = root;
    }

    // --- Destructible props (RaceProps) -------------------------------------

    // One dynamic thin-instance mesh per prop type; meshes are CENTRED on their origin
    // (RaceProps.matrix lifts them by half their height and tumbles them about the centre).
    buildProps(props) {
        this.disposeProps();
        const scene = this.scene, C = this.C, arctic = this.kind === 'arctic';
        const wood = this.mat('prop-wood', C.plank && this.kind !== 'arctic' ? C.plank : '#9a6b3e');
        const woodDark = this.mat('prop-wood-dark', '#5e3f24');
        const tyre = this.mat('tyre', RACE_COLORS.tyre), white = this.mat('kerbW', RACE_COLORS.kerbWhite);
        const box = (name, w, h, d, m, parent, x, y, z) => {
            const b = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
            b.material = m; if (parent) { b.parent = parent; b.position.set(x || 0, y || 0, z || 0); }
            return b;
        };
        const cyl = (name, dTop, dBot, h, m, parent, y, tess) => {
            const c = BABYLON.MeshBuilder.CreateCylinder(name, { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: tess || 10 }, scene);
            c.material = m; if (parent) { c.parent = parent; c.position.y = y || 0; }
            return c;
        };
        const make = {
            cone: () => {
                const r = cyl('prop-cone', 2, 13, 18, this.mat('prop-cone', '#f07a2a'), null, 0, 8);
                cyl('prop-cone-band', 6.2, 8.6, 4, white, r, 1, 8);
                box('prop-cone-base', 15, 2, 15, this.mat('prop-cone', '#f07a2a'), r, 0, -8, 0);
                return r;
            },
            barrel: () => {
                const r = cyl('prop-barrel', 22, 22, 26, this.mat('prop-barrel', arctic ? '#2f6fb0' : '#c9452f'), null, 0, 12);
                for (const y of [-7, 7]) cyl('prop-barrel-ring', 22.6, 22.6, 2, this.mat('carDark', RACE_COLORS.carDark), r, y, 12);
                return r;
            },
            crate: () => {
                const r = box('prop-crate', 22, 22, 22, wood);
                box('prop-crate-strap', 22.6, 4, 22.6, woodDark, r, 0, 0, 0);
                box('prop-crate-strap2', 4, 22.6, 22.6, woodDark, r, 0, 0, 0);
                return r;
            },
            tyres: () => {
                const r = cyl('prop-tyres', 28, 28, 20, tyre, null, 0, 14);
                cyl('prop-tyres-band', 28.6, 28.6, 3, this.kind === 'valley' ? this.mat('kerbR', C.kerbRed) : white, r, 0, 14);
                return r;
            },
            hay: () => {
                const r = box('prop-hay', 32, 18, 22, this.mat('prop-hay', '#d9b456'));
                for (const x of [-8, 8]) box('prop-hay-strap', 2, 18.6, 22.6, this.mat('prop-hay-strap', '#8a6a2a'), r, x, 0, 0);
                return r;
            },
            fence: () => {
                const r = box('prop-fence', 26, 4, 2.5, wood);
                box('prop-fence-rail', 26, 4, 2.5, wood, r, 0, 6, 0);
                for (const x of [-12, 12]) box('prop-fence-post', 3, 16, 3, woodDark, r, x, 0, 0);
                return r;
            },
            plank: () => box('prop-plank', 14, 3, 5, wood),
        };
        this._props = {};
        const byType = {};
        props.list.forEach((p) => (byType[p.type] || (byType[p.type] = [])).push(p));
        for (const type in byType) {
            if (!make[type]) continue;
            const list = byType[type];
            const inst = this._inst(make[type](), 'prop', list.map(() => ({ x: 0, y: 0, h: -9999 })),
                { dynamic: true, castShadow: true, ink: true, outline: false });
            this._props[type] = { inst, list };
        }
        props.dirty = true;
        this.updateProps(props);
    }

    // Matrices of every prop from the simulation (only when something moved).
    updateProps(props) {
        if (!this._props || !props.dirty) return;
        for (const type in this._props) {
            const { inst, list } = this._props[type];
            if (!inst.ok) continue;
            for (let k = 0; k < list.length; k++) RaceProps.matrix(inst.matrices, k, list[k]);
            inst.flush();
        }
        props.dirty = false;
    }

    disposeProps() {
        if (!this._props) return;
        for (const type in this._props) {
            const inst = this._props[type].inst;
            try { inst.dispose(); } catch (e) { /* ok */ }
            this._insts = this._insts.filter((i) => i !== inst);
        }
        this._props = null;
    }

    // Free spot near (x, y) for a large object (spiral search).
    _findSpot(x, y, margin) {
        for (let r = 0; r < 600; r += 20) {
            for (let a = 0; a < 6.28; a += 0.4) {
                const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
                if (this._free(px, py, margin)) return { x: px, y: py };
            }
        }
        return { x, y };
    }

    // --- The car -------------------------------------------------------------

    // A car view (player or rival): root → lean → body. `color` repaints the body ('Paint'
    // material of the GLB, the body boxes of the placeholder) — each car has its own paint.
    // -> { root, lean, wheels, mats, model }; placeCar(car, dt, view) drives it.
    addCar(color, type) {
        const scene = this.scene, idx = this.cars.length + (this._carSeq = (this._carSeq || 0) + 1) * 100;
        const view = { root: null, lean: null, wheels: [], mats: [], model: null, color, type: type || 'car' };
        view.root = new BABYLON.Mesh('race-car-' + idx, scene);
        view.lean = new BABYLON.Mesh('race-car-lean-' + idx, scene);
        view.lean.parent = view.root;
        const paint = new BABYLON.StandardMaterial('race-paint-' + idx, scene);
        paint.diffuseColor = BABYLON.Color3.FromHexString(color || RACE_COLORS.car);
        paint.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
        view.mats.push(paint);
        view.paint = paint;
        if (view.type === 'bike') {
            this._proceduralBike(view, paint);
            this._add(view.root, 'actor');
            this.cars.push(view);
            return view;
        }
        this._proceduralCar(view, paint);
        this._add(view.root, 'actor');
        this.cars.push(view);
        // The Blender model replaces the placeholder when it arrives (tools/blender/make_car.py).
        Model3D.load('assets/models/race_car.glb', scene).then((model) => {
            if (this._dead || view.dead) return;
            const car = Model3D.build(model, scene, { name: 'race-car-model-' + idx });
            try { this._useModel(view, car); }
            catch (e) {
                Model3D.dispose(this.view, car);
                throw e;
            }
        }).catch((e) => console.warn('RaceScene: race_car.glb not loaded, keeping the placeholder', e));
        return view;
    }

    // Remove a rival view (track change keeps the scene, fewer rivals).
    removeCar(view) {
        view.dead = true;
        if (view.model) {
            try { Model3D.dispose(this.view, view.model); } catch (e) { /* ok */ }
            this._models = this._models.filter(m => m !== view.model);
        }
        try { World3D.removeObject(this.view, view.root); } catch (e) { /* ok */ }
        for (const m of view.mats) m.dispose();
        this.cars = this.cars.filter((v) => v !== view);
    }

    // Player ride: 'car' | 'bike'. Swaps the player's view in place when the type changes.
    setPlayerVehicle(type) {
        const t = type === 'bike' ? 'bike' : 'car';
        if (this.player && this.player.type === t) return this.player;
        const old = this.player;
        this.player = this.addCar(this.C.car, t);
        if (old) this.removeCar(old);
        this.carRoot = this.player.root;
        this.carLean = this.player.lean;
        this.wheels = this.player.wheels;
        this.carModel = null;
        return this.player;
    }

    // Placeholder built from primitives: body, cabin, spoiler, 4 real round wheels.
    _proceduralCar(view, paint) {
        const parent = view.lean;
        const scene = this.scene, red = paint, dark = this.mat('carDark', RACE_COLORS.carDark);
        const glass = this.mat('glass', RACE_COLORS.glass), tyre = this.mat('tyre', RACE_COLORS.tyre);
        const part = (name, dim, x, y, z, m) => {
            const b = BABYLON.MeshBuilder.CreateBox(name, dim, scene);
            b.position.set(x, y, z); b.material = m; b.parent = parent;
            return b;
        };
        part('car-body', { width: 70, height: 12, depth: 34 }, 0, 14, 0, red);
        part('car-nose', { width: 18, height: 8, depth: 30 }, 38, 11, 0, red);
        part('car-cabin', { width: 30, height: 12, depth: 26 }, -6, 26, 0, glass);
        part('car-roof', { width: 22, height: 3, depth: 24 }, -8, 33, 0, red);
        part('car-wing', { width: 8, height: 3, depth: 36 }, -34, 30, 0, dark);
        part('car-wing-l', { width: 5, height: 10, depth: 3 }, -33, 24, -14, dark);
        part('car-wing-r', { width: 5, height: 10, depth: 3 }, -33, 24, 14, dark);
        part('car-stripe', { width: 72, height: 12.4, depth: 6 }, 0, 14, 0, this.mat('kerbW', RACE_COLORS.kerbWhite));
        for (const { x, z, front } of [{ x: 24, z: -18, front: true }, { x: 24, z: 18, front: true }, { x: -24, z: -18, front: false }, { x: -24, z: 18, front: false }]) {
            const steer = new BABYLON.Mesh('wheel-steer', scene);
            steer.position.set(x, 9, z); steer.parent = parent;
            const spin = new BABYLON.Mesh('wheel-spin', scene);
            spin.parent = steer;
            const w = BABYLON.MeshBuilder.CreateCylinder('wheel', { diameter: 18, height: 9, tessellation: 14 }, scene);
            w.rotation.x = Math.PI / 2; w.material = tyre; w.parent = spin;
            const hub = BABYLON.MeshBuilder.CreateBox('wheel-hub', { width: 8, height: 8, depth: 9.6 }, scene);
            hub.material = this.mat('rail', RACE_COLORS.rail); hub.parent = spin;
            view.wheels.push({ steer: front ? steer : null, spin, base: 0 });
        }
    }

    // Dirt bike + rider from primitives, ~56 px long, nose +X. Hierarchy: lean (roll/pitch) →
    // parts; view.rider — the rider group (thrown off on a wipeout).
    _proceduralBike(view, paint) {
        const parent = view.lean, scene = this.scene;
        const dark = this.mat('carDark', RACE_COLORS.carDark), tyre = this.mat('tyre', RACE_COLORS.tyre);
        const metal = this.mat('rail', RACE_COLORS.rail), suit = this.mat('suit', '#2a2f38');
        const part = (name, dim, x, y, z, m, p) => {
            const b = BABYLON.MeshBuilder.CreateBox(name, dim, scene);
            b.position.set(x, y, z); b.material = m; b.parent = p || parent;
            return b;
        };
        // Frame, tank, seat, fenders, number plate, forks, exhaust.
        part('bike-frame', { width: 34, height: 6, depth: 6 }, 0, 16, 0, dark);
        part('bike-tank', { width: 16, height: 9, depth: 11 }, 6, 22, 0, paint);
        part('bike-seat', { width: 20, height: 4, depth: 9 }, -9, 22, 0, dark);
        part('bike-fender-r', { width: 18, height: 3, depth: 8 }, -20, 24, 0, paint);
        part('bike-fender-f', { width: 14, height: 3, depth: 8 }, 22, 22, 0, paint);
        part('bike-plate', { width: 2, height: 10, depth: 12 }, 17, 26, 0, this.mat('kerbW', RACE_COLORS.kerbWhite));
        part('bike-exhaust', { width: 18, height: 3, depth: 3 }, -12, 15, 6, metal);
        for (const z of [-4, 4]) {
            const fork = part('bike-fork', { width: 2.5, height: 20, depth: 2.5 }, 21, 17, z, metal);
            fork.rotation.z = -0.35;
        }
        part('bike-bars', { width: 3, height: 3, depth: 22 }, 16, 30, 0, dark);
        // Two wheels: rear spins, front spins and steers.
        for (const { x, front } of [{ x: -20, front: false }, { x: 22, front: true }]) {
            const steer = new BABYLON.Mesh('bike-wheel-steer', scene);
            steer.position.set(x, 10, 0); steer.parent = parent;
            const spin = new BABYLON.Mesh('bike-wheel-spin', scene);
            spin.parent = steer;
            const w = BABYLON.MeshBuilder.CreateCylinder('bike-wheel', { diameter: 20, height: 6, tessellation: 14 }, scene);
            w.rotation.x = Math.PI / 2; w.material = tyre; w.parent = spin;
            const hub = BABYLON.MeshBuilder.CreateBox('bike-hub', { width: 6, height: 6, depth: 6.6 }, scene);
            hub.material = metal; hub.parent = spin;
            view.wheels.push({ steer: front ? steer : null, spin, base: 0 });
        }
        // Rider: legs, torso leaning forward, arms to the bars, helmet in the bike colour.
        const rider = new BABYLON.Mesh('bike-rider', scene);
        rider.parent = parent;
        part('rider-legs', { width: 14, height: 10, depth: 12 }, -6, 26, 0, suit, rider);
        const torso = part('rider-torso', { width: 10, height: 18, depth: 12 }, -2, 37, 0, suit, rider);
        torso.rotation.z = -0.5;
        for (const z of [-7, 7]) {
            const arm = part('rider-arm', { width: 14, height: 3.5, depth: 3.5 }, 8, 34, z, suit, rider);
            arm.rotation.z = -0.3;
        }
        part('rider-helmet', { width: 11, height: 11, depth: 11 }, 3, 48, 0, paint, rider);
        part('rider-visor', { width: 2, height: 4, depth: 9 }, 9, 48, 0, this.mat('glass', RACE_COLORS.glass), rider);
        view.rider = rider;
    }

    // Swap the placeholder for the GLB: normalize its size to ~76 px long, stand it on the
    // ground, find wheel_* nodes for spin/steer.
    _useModel(view, model) {
        // Prepare the import before touching the working fallback.
        const wheels = [];
        model.parent = null;           // measure in the model's own frame (the car may be turned)
        model.computeWorldMatrix(true);
        const b = model.getHierarchyBoundingVectors(true);
        const len = b.max.x - b.min.x;
        if (!Number.isFinite(len) || len <= 0 || !Number.isFinite(b.min.y))
            throw new Error('Invalid car model bounds');
        const k = 76 / len;
        model.scaling.scaleInPlace(k);
        model.position.y = -b.min.y * k;
        const nodes = model.getDescendants(false);
        for (const n of nodes) {
            const name = n.name.toLowerCase();
            if (!/wheel_(fl|fr|rl|rr)/.test(name) || !(n instanceof BABYLON.TransformNode)) continue;
            // Only the node itself (a glTF mesh node named wheel_FL), not its primitives.
            if (n.parent && /wheel_/.test(n.parent.name.toLowerCase())) continue;
            n.rotationQuaternion = null;
            wheels.push({ steer: /wheel_f/.test(name) ? n : null, spin: n, base: n.rotation.x, glb: true });
        }
        // Own paint: every material whose name says "paint" gets this car's colour (clones —
        // Model3D.build materials are per build, but keep it explicit).
        for (const m of model.getChildMeshes(false)) {
            const mat = m.material;
            if (!mat || !/paint/i.test(mat.name)) continue;
            if (mat.albedoColor) mat.albedoColor = view.paint.diffuseColor.clone();
            else if (mat.diffuseColor) mat.diffuseColor = view.paint.diffuseColor.clone();
        }
        // Register only the new model (outline, shadows). removeObject would DISPOSE the root.
        World3D.addObject(this.view, model, 'actor');
        for (const c of view.lean.getChildren()) c.dispose(false, false);
        view.wheels = wheels;
        model.parent = view.lean;
        view.model = model;
        this._models.push(model);
        if (view === this.player) this.carModel = model;
        if (view === this.player) this.wheels = view.wheels;
    }

    // Visual state of a car from the physics (default — the player's car).
    placeCar(car, dt, view) {
        const v = view || this.player;
        const r = v.root;
        r.position.set(car.x, car.z || 0, car.y);
        r.rotation.y = -car.heading;
        // Body lean: roll into the slide, pitch on throttle/brake — smoothed; in the air the
        // nose follows the flight path (car.pitchAir).
        const k = 1 - Math.exp(-8 * (dt || 0.016));
        let roll = Math.max(-0.09, Math.min(0.09, -car.accelLat / 9000));
        // + the road slope (ramps, crests) on the ground.
        const pitch = Math.max(-0.05, Math.min(0.05, car.accelLong / 12000)) + (car.pitchAir || 0) + (car.pitchGround || 0);
        // Suspension: the body dips on landings and shakes on rough ground.
        v.lean.position.y = (car.susp || 0) * 0.35;   // ≤ 5 px: wheels stay on the ground
        if (v.type === 'bike') {
            // A bike leans INTO the turn (opposite of a car body's roll), a lot.
            roll = Math.max(-0.6, Math.min(0.6, car.accelLat / 2500));
            // Wipeout: bike on its side, rider thrown off to the outside and back.
            const down = car.crash > 0;
            if (down && !v.downSide) v.downSide = Math.sign(car.accelLat) || 1;
            if (!down) v.downSide = 0;
            if (down) roll = 1.35 * v.downSide;
            if (v.rider) {
                const rx = down ? -26 : 0, rz = down ? -22 * v.downSide : 0, ry = down ? -30 : 0;
                v.rider.position.x += (rx - v.rider.position.x) * k;
                v.rider.position.y += (ry - v.rider.position.y) * k;
                v.rider.position.z += (rz - v.rider.position.z) * k;
            }
        }
        v.lean.rotation.x += (roll - v.lean.rotation.x) * k;
        v.lean.rotation.z += (pitch - v.lean.rotation.z) * k;
        for (const w of v.wheels) {
            if (w.glb) {
                // glTF frame: nose +Z, axle X (Gltf3D turns the whole model to nose +X).
                w.spin.rotation.x = w.base + car.wheelSpin;
                if (w.steer) w.spin.rotation.y = -car.steer * 0.42;
            } else {
                w.spin.rotation.z = -car.wheelSpin;
                if (w.steer) w.steer.rotation.y = -car.steer * 0.42;
            }
        }
    }

    // Rear wheel contact points in map px (skid marks, smoke).
    rearWheels(car) {
        // A bike leaves one rut: both "wheels" sit almost on the centre line.
        const bike = car.type === 'bike';
        const c = Math.cos(car.heading), s = Math.sin(car.heading), back = bike ? -20 : -24, side = bike ? 1.5 : 18;
        return [-1, 1].map((k) => ({ x: car.x + c * back - s * side * k, y: car.y + s * back + c * side * k }));
    }
}
