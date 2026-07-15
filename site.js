(function () {
  "use strict";

  const CONTENT_SELECTOR = "[data-site-content]";
  const STORAGE_KEY = "ztw-music-state";
  const music = document.getElementById("site-music");
  const musicToggle = document.getElementById("music-toggle");
  const musicVolume = document.getElementById("music-volume");
  const musicStatus = document.getElementById("music-status");
  const players = new Set();
  let playerNumber = 0;
  let navigating = false;
  let youtubeReady;

  function readMusicState() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
    } catch (_error) {
      return {};
    }
  }

  function saveMusicState() {
    if (!music) return;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentTime: Number.isFinite(music.currentTime) ? music.currentTime : 0,
      volume: music.volume,
      playing: !music.paused
    }));
  }

  function syncMusicControls(message) {
    if (!music || !musicToggle) return;
    const playing = !music.paused;
    musicToggle.textContent = playing ? "Pause music" : "Play music";
    musicToggle.setAttribute("aria-pressed", String(playing));
    if (musicStatus && message) musicStatus.textContent = message;
  }

  function pauseMusic(message) {
    if (!music) return;
    music.pause();
    saveMusicState();
    syncMusicControls(message || "Music paused");
  }

  async function toggleMusic() {
    if (!music) return;
    if (!music.paused) {
      pauseMusic();
      return;
    }

    try {
      await music.play();
      syncMusicControls("Music playing");
      saveMusicState();
    } catch (_error) {
      syncMusicControls("Press Play music to continue");
    }
  }

  function restoreMusic() {
    if (!music) return;
    const state = readMusicState();
    music.volume = typeof state.volume === "number" ? state.volume : 0.2;
    if (musicVolume) musicVolume.value = String(music.volume);

    const restoreTime = function () {
      if (typeof state.currentTime === "number" && Number.isFinite(state.currentTime)) {
        try { music.currentTime = state.currentTime; } catch (_error) {}
      }
    };

    if (music.readyState >= 1) restoreTime();
    else music.addEventListener("loadedmetadata", restoreTime, { once: true });

    syncMusicControls();
    if (state.playing) {
      music.play().then(function () {
        syncMusicControls("Music resumed");
      }).catch(function () {
        syncMusicControls("Press Play music to continue");
      });
    }
  }

  function pauseAllVideos(exceptPlayer) {
    players.forEach(function (player) {
      if (player !== exceptPlayer && typeof player.pauseVideo === "function") {
        try { player.pauseVideo(); } catch (_error) {}
      }
    });
  }

  function loadYouTubeAPI() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (youtubeReady) return youtubeReady;

    youtubeReady = new Promise(function (resolve, reject) {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof previousReady === "function") previousReady();
        resolve(window.YT);
      };

      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return youtubeReady;
  }

  async function startYouTubeVideo(trigger) {
    const videoId = trigger.dataset.videoId;
    const videoTitle = trigger.dataset.videoTitle || "YouTube video";
    const placeholder = document.createElement("div");
    placeholder.id = "youtube-player-" + (++playerNumber);
    placeholder.className = "video-frame";
    trigger.replaceWith(placeholder);
    pauseMusic("Music paused for video");

    try {
      const YT = await loadYouTubeAPI();
      let player;
      player = new YT.Player(placeholder.id, {
        host: "https://www.youtube-nocookie.com",
        videoId: videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: function (event) {
            event.target.getIframe().title = videoTitle;
          },
          onStateChange: function (event) {
            if (event.data === YT.PlayerState.PLAYING) {
              pauseMusic("Music paused for video");
              pauseAllVideos(player);
            }
          }
        }
      });
      players.add(player);
    } catch (_error) {
      const frame = document.createElement("iframe");
      frame.className = "video-frame";
      frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&rel=0";
      frame.title = videoTitle;
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true;
      placeholder.replaceWith(frame);
    }
  }

  function isPageLink(anchor) {
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return false;
    const target = new URL(anchor.href, location.href);
    if (target.origin !== location.origin) return false;
    if (target.hash && target.pathname === location.pathname) return false;
    return /(?:\/|index\.html|videos\.html)$/.test(target.pathname);
  }

  function transitionDelay() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;
  }

  async function navigate(target, addHistory) {
    if (navigating) return;
    navigating = true;
    const currentContent = document.querySelector(CONTENT_SELECTOR);
    if (currentContent) currentContent.classList.add("is-leaving");
    await new Promise(function (resolve) { setTimeout(resolve, transitionDelay()); });

    try {
      const response = await fetch(target.href, { headers: { "X-Requested-With": "site-navigation" } });
      if (!response.ok) throw new Error("Navigation failed");
      const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
      const nextContent = parsed.querySelector(CONTENT_SELECTOR);
      const currentStyles = document.getElementById("page-styles");
      const nextStyles = parsed.getElementById("page-styles");
      if (!nextContent || !currentContent || !currentStyles || !nextStyles) throw new Error("Missing page content");

      pauseAllVideos();
      players.clear();
      currentStyles.replaceWith(nextStyles);
      nextContent.classList.remove("is-leaving");
      currentContent.replaceWith(nextContent);
      document.title = parsed.title;
      if (addHistory) history.pushState({}, "", target.href);
      window.scrollTo({ top: 0, behavior: "instant" });
      nextContent.setAttribute("tabindex", "-1");
      nextContent.focus({ preventScroll: true });
    } catch (_error) {
      saveMusicState();
      location.href = target.href;
      return;
    } finally {
      navigating = false;
    }
  }

  document.addEventListener("click", function (event) {
    const videoTrigger = event.target.closest(".video-trigger");
    if (videoTrigger) {
      event.preventDefault();
      startYouTubeVideo(videoTrigger);
      return;
    }

    const anchor = event.target.closest("a");
    if (!isPageLink(anchor) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(new URL(anchor.href, location.href), true);
  });

  window.addEventListener("popstate", function () {
    navigate(new URL(location.href), false);
  });

  window.addEventListener("pagehide", saveMusicState);
  if (musicToggle) musicToggle.addEventListener("click", toggleMusic);
  if (musicVolume && music) {
    musicVolume.addEventListener("input", function () {
      music.volume = Number(musicVolume.value);
      saveMusicState();
    });
  }
  if (music) {
    music.addEventListener("play", saveMusicState);
    music.addEventListener("pause", saveMusicState);
    music.addEventListener("timeupdate", saveMusicState);
  }
  restoreMusic();
}());
