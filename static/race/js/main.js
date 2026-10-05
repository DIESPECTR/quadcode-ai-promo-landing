// main.js — entry point: 3D engine -> location with objects from Objects.js -> camera ->
// UI (UILayout.js) -> game (Game.js) -> frame loop (Sound3D hears from where the camera is). window.app = { location, camera, game } —
// for the console and for game code built on top of the kit.

function updateLoadingProgress(percent) {
    const bar = /** @type {HTMLElement | null} */ (document.querySelector('.loading-progress'));
    if (bar) bar.style.width = percent + '%';
}

// The loading screen goes away when the location is ready.
function hideLoader() {
    updateLoadingProgress(100);
    setTimeout(() => {
        const screen = document.getElementById('loading-screen');
        if (screen) screen.style.display = 'none';
    }, 300);
}

function showBootError(text) {
    console.error(text);
    const el = document.querySelector('.loading-text');
    if (el) el.textContent = text;
}

function startGame() {
    if (window.app) return;                 // guard against a repeated start
    if (typeof SimplexNoise === 'undefined') { showBootError('Нет libs/simplex-noise.js'); return; }
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('world3d'));
    updateLoadingProgress(40);
    if (!World3D.init(canvas)) { showBootError('3D недоступен: нет libs/babylon.js или WebGL'); return; }

    const location = new Location3D({ objects: typeof LOCATION_OBJECTS !== 'undefined' ? LOCATION_OBJECTS : [] });
    const camera = new CameraController(location.view, {
        terrain: location.terrain,
        bounds: { w: location.width, h: location.height }
    });
    // Racing keys belong to Game; the chase camera is updated without free-flight input.
    UI.init(canvas);
    window.app = { location, camera, game: null };
    const game = window.app.game = new Game(window.app);
    console.log('ArcEngine: локация запущена, объектов ' + location.objects.length + '.');
    updateLoadingProgress(70);

    let last = performance.now();
    let contextLost = false;
    World3D.engine.onContextLostObservable.add(() => {
        contextLost = true;
        game._onBlur();
        game.audio.stop();
    });
    World3D.engine.onContextRestoredObservable.add(() => {
        // Restoration rebuilds GPU resources, but never resumes a race for the player.
        game._onBlur();
        game.audio.stop();
        last = performance.now();
        contextLost = false;
    });
    World3D.engine.runRenderLoop(() => {
        const now = performance.now(), dt = (now - last) / 1000;
        last = now;
        if (contextLost) {
            // A menu/key action during the outage must not run a race behind a blank canvas.
            game._onBlur();
            game.audio.stop();
            return;
        }
        const frameDt = game.update(dt);
        location.update(frameDt);
        camera.update(frameDt);
        Sound3D.update(camera);
        World3D.renderFrame();
    });
    window.addEventListener('resize', () => World3D.resize());
    location.ready.then(hideLoader);
}

window.onload = () => startGame();
