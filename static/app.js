(() => {
  // YouTube is not requested until the visitor explicitly plays an official demo.
  const officialVideos = new Set(['nyHDkDUzH-o', '6S5AX__QRyA', 'HFVjbUmvWDU']);
  document.querySelectorAll('.demo-play[data-video-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const videoId = button.dataset.videoId;
      if (!officialVideos.has(videoId)) return;
      const player = button.closest('.demo-player');
      if (!player) return;
      const frame = document.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
      frame.title = button.getAttribute('aria-label') || 'Quadcode AI video';
      frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      player.replaceChildren(frame);
      frame.focus();
    }, {once: true});
  });
})();
