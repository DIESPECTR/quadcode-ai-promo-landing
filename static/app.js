(() => {
  // YouTube is not requested until the visitor explicitly plays an official demo.
  const officialVideos = new Set(['nyHDkDUzH-o', '6S5AX__QRyA']);
  document.querySelectorAll('.demo-play[data-video-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const videoId = button.dataset.videoId;
      if (!officialVideos.has(videoId)) return;
      const player = button.closest('.demo-player');
      if (!player) return;
      const frame = document.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`;
      frame.title = button.getAttribute('aria-label') || 'Quadcode AI video';
      frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      player.replaceChildren(frame);
      frame.focus();
    }, {once: true});
  });
})();

// Load on explicit request; closing releases WebGL/audio.
(() => {
  const launch = document.getElementById('race-launch');
  const close = document.getElementById('race-close');
  const player = document.getElementById('race-player');
  const cover = document.getElementById('race-cover');
  const status = document.getElementById('race-status');
  if (!launch || !close || !player || !cover || !status) return;
  launch.addEventListener('click', () => {
    if (player.querySelector('iframe')) return;
    const frame = document.createElement('iframe');
    frame.src = '/static/race/index.html';
    frame.title = 'ArcRace — playable 3D racing game';
    frame.allow = 'fullscreen; autoplay; gamepad';
    frame.allowFullscreen = true;
    frame.addEventListener('load', () => {
      status.textContent = 'Choose your track and ride, then press Start Race. Blank screen? Use Open game above.';
    }, {once: true});
    player.replaceChildren(frame);
    player.hidden = false;
    cover.hidden = true;
    close.hidden = false;
    launch.setAttribute('aria-expanded', 'true');
    status.textContent = 'Loading your race… If it does not appear, use Open game above.';
    player.scrollIntoView({block: 'start', behavior: 'instant'});
    frame.focus({preventScroll: true});
  });
  close.addEventListener('click', () => {
    player.replaceChildren();
    player.hidden = true;
    cover.hidden = false;
    close.hidden = true;
    launch.setAttribute('aria-expanded', 'false');
    status.textContent = 'Race closed. Play again whenever you like.';
    launch.focus({preventScroll: true});
    cover.scrollIntoView({block: 'center', behavior: 'instant'});
  });
})();

// Cinematic artwork, not gameplay. Loop the full clip; pause during gameplay.
(() => {
  const video = document.getElementById('race-cinematic');
  const button = document.getElementById('race-motion');
  const cover = document.getElementById('race-cover');
  if (!video || !button || !cover) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  let visible = false, userPaused = false, optedIn = false, failed = false, pending = false;
  const protectedMode = () => reduced.matches || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '');
  const allowed = () => visible && !document.hidden && !cover.hidden && !userPaused && !failed && (!protectedMode() || optedIn);
  const label = () => { button.textContent = video.ended ? 'Replay preview' : video.paused ? 'Play preview' : 'Pause preview'; };
  const sync = () => {
    if (!allowed()) { video.pause(); label(); return; }
    if (pending || !video.paused) return;
    if (!video.hasAttribute('src')) { video.src = video.dataset.src; video.load(); }
    pending = true;
    video.play().then(() => {
      if (!allowed()) video.pause();
    }).catch(() => { userPaused = true; }).finally(() => { pending = false; label(); });
  };
  button.hidden = false;
  button.addEventListener('click', () => {
    if (!video.paused) { userPaused = true; video.pause(); }
    else { userPaused = false; optedIn = true; if (video.ended) video.currentTime = 0; sync(); }
    label();
  });
  video.addEventListener('playing', () => { video.classList.add('is-ready'); label(); });
  video.addEventListener('pause', label);
  video.addEventListener('ended', label);
  video.addEventListener('error', () => { failed = true; video.pause(); video.classList.remove('is-ready'); button.hidden = true; });
  document.addEventListener('visibilitychange', sync);
  const preferenceChanged = () => { optedIn = false; sync(); };
  reduced.addEventListener('change', preferenceChanged);
  connection?.addEventListener('change', preferenceChanged);
  new MutationObserver(sync).observe(cover, {attributes: true, attributeFilter: ['hidden']});
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting && entry.intersectionRatio >= 0.2; sync(); }, {threshold: [0, 0.2]}).observe(cover);
  } else { visible = true; userPaused = true; }
})();

// One contact chooser for every promo CTA; links keep their native no-JS fallback.
(() => {
  const choice = document.getElementById('contact-options');
  if (!choice) return;
  const summary = choice.querySelector('summary');
  const reveal = () => { choice.open = true; };
  document.querySelectorAll('[data-contact-trigger]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      reveal();
      choice.scrollIntoView({block: 'start', behavior: 'instant'});
      summary.focus({preventScroll: true});
    });
  });
  const revealFromHash = () => { if (location.hash === '#contact-options') reveal(); };
  window.addEventListener('hashchange', revealFromHash);
  revealFromHash();
  choice.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && choice.open) {
      event.preventDefault();
      choice.open = false;
      summary.focus({preventScroll: true});
    }
  });
})();
