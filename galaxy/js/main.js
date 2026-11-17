(() => {
  'use strict';

  const {
    TAU, STAR_COUNT, spectralBands, clamp, wrap, createEngine, createHud,
    createProjection, updateProjection, project, locateSol,
  } = window.MilkyWay;
  const canvas = document.querySelector('#galaxy');
  const overlay = document.querySelector('#astrometry');
  const engine = createEngine(canvas);
  const hud = createHud(overlay);
  if (!engine || !hud) {
    const status = document.querySelector('#status');
    status.textContent = 'This observatory requires Canvas 2D support.';
    status.hidden = false;
    return;
  }

  const FRAME_TIME = 1000 / 60;
  const MAX_ZOOM = 60;
  const WARP_SECONDS = 0.72;
  const DEFAULT_CAMERA = { yaw: 0.34, pitch: 62 * TAU / 360, zoom: 1, x: 0, y: 0 };
  const viewpoints = {
    overview: DEFAULT_CAMERA,
    edge: { ...DEFAULT_CAMERA, yaw: 0.75, pitch: 0 },
    core: { ...DEFAULT_CAMERA, pitch: 1.16, zoom: 8 },
    sol: { ...DEFAULT_CAMERA, pitch: 1.35, zoom: 4.2 },
  };
  const camera = { ...DEFAULT_CAMERA };
  const target = { ...DEFAULT_CAMERA };
  const warpStart = { ...DEFAULT_CAMERA };
  const solProjection = createProjection();
  const solWorld = { x: 0, y: 0 };
  const solScreen = { x: 0, y: 0 };
  const starView = createProjection();
  const hudView = createProjection();
  const rasterCamera = { ...DEFAULT_CAMERA };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointers = new Map();
  let width, height, rasterWidth, rasterHeight, rasterScale, baseScale;
  let sceneY = 0;
  let yawVelocity = 0;
  let pitchVelocity = 0;
  let lastPointerTime = 0;
  let years = 0;
  let pulseTime = 0;
  let speed = 1;
  let band = 0;
  let lensEmphasis = false;
  let showSol = false;
  let viewpoint = 'overview';
  let warpElapsed = WARP_SECONDS;
  let paused = motion.matches;
  let showGrid = true;
  let showHud = true;
  let nextFrame;
  let previousTime;
  let lastReadout;
  let lastReport;
  let renderedFrames = 0;
  let dirty = true;

  const byId = id => document.getElementById(id);
  const telemetry = byId('telemetry');
  const identity = byId('identity');
  const survey = byId('survey');
  const help = byId('camera-help');
  const azimuth = byId('yaw');
  const elevation = byId('pitch');
  const magnification = byId('zoom');
  const epoch = byId('epoch');
  const mode = byId('mode');
  const play = byId('play');
  const playLabel = byId('play-label');
  const grid = byId('grid');
  const hudToggle = byId('hud-toggle');
  const rate = byId('rate');
  const rateValue = byId('rate-value');
  const viewButtons = document.querySelectorAll('#viewpoints [data-view]');
  const lens = byId('lens');
  const fps = byId('fps');

  byId('star-count').textContent = STAR_COUNT.toLocaleString('en-US') + ' stars';

  function resize() {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    const nextScale = Math.min(width * 0.405, height * 0.435);
    const ratio = nextScale / (baseScale || nextScale);
    camera.x *= ratio;
    camera.y *= ratio;
    target.x *= ratio;
    target.y *= ratio;
    warpStart.x *= ratio;
    warpStart.y *= ratio;
    baseScale = nextScale;
    // Bound raster work even on high-DPI and ultrawide displays.
    rasterScale = Math.min(2 / 3, 960 / width, 640 / height);
    rasterWidth = Math.max(1, Math.round(width * rasterScale));
    rasterHeight = Math.max(1, Math.round(height * rasterScale));
    engine.resize(rasterWidth, rasterHeight);
    hud.resize(width, height);
    updateSceneCenter();
    dirty = true;
  }

  function updateSceneCenter() {
    // In portrait layouts, frame the galaxy in the space above the controls.
    sceneY = showHud && width <= 540 && height >= 560
      ? Math.round((telemetry.offsetTop + 92 - height) / 2) : 0;
  }

  function refreshReadouts() {
    const degrees = 360 / TAU;
    const yaw = (Math.round(wrap(camera.yaw, TAU) * degrees * 10) % 3600) / 10;
    azimuth.textContent = yaw.toFixed(1).padStart(5, '0') + '\u00b0';
    elevation.textContent = (camera.pitch * degrees).toFixed(1) + '\u00b0';
    magnification.textContent = camera.zoom.toFixed(2) + '\u00d7';
    epoch.textContent = years.toFixed(3);
  }

  function setPaused(next) {
    paused = next;
    mode.textContent = paused ? 'Paused' : 'Orbit';
    mode.classList.toggle('paused', paused);
    playLabel.textContent = paused ? 'Play' : 'Pause';
    if (paused) fps.textContent = '-- FPS';
    dirty = true;
  }

  function toggleGrid() {
    showGrid = !showGrid;
    grid.setAttribute('aria-pressed', String(showGrid));
    dirty = true;
  }

  function toggleHud() {
    showHud = !showHud;
    if (!showHud && telemetry.contains(document.activeElement)) hudToggle.focus();
    telemetry.hidden = identity.hidden = survey.hidden = help.hidden = !showHud;
    updateSceneCenter();
    hudToggle.setAttribute('aria-pressed', String(showHud));
    if (showHud) refreshReadouts();
    dirty = true;
  }

  function updateViewButtons() {
    for (const button of viewButtons) {
      const active = button.dataset.view === 'sol' ? showSol : button.dataset.view === viewpoint;
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function warpTo(next) {
    viewpoint = next;
    Object.assign(warpStart, camera);
    Object.assign(target, viewpoints[next]);
    target.yaw = camera.yaw + wrap(target.yaw - camera.yaw + Math.PI, TAU) - Math.PI;
    yawVelocity = pitchVelocity = 0;
    warpElapsed = 0;
    updateViewButtons();
    dirty = true;
  }

  function releaseView() {
    if (!viewpoint) return;
    if (warpElapsed < WARP_SECONDS || viewpoint === 'sol') Object.assign(target, camera);
    viewpoint = null;
    warpElapsed = WARP_SECONDS;
    updateViewButtons();
  }

  function cycleBand() {
    band = (band + 1) % spectralBands.length;
    byId('band').textContent = spectralBands[band];
    dirty = true;
  }

  function updateRate() {
    speed = rate.valueAsNumber;
    rateValue.textContent = speed.toFixed(2) + '\u00d7';
  }

  function zoomAt(factor, x, y, previousX = x, previousY = y) {
    releaseView();
    const zoom = clamp(target.zoom * factor, 1, MAX_ZOOM);
    const ratio = zoom / target.zoom;
    target.x = x + (target.x - previousX) * ratio;
    target.y = y + (target.y - previousY) * ratio;
    // At overview scale re-center the survey, even after a long zoom chain.
    if (zoom === 1) target.x = target.y = 0;
    target.zoom = zoom;
    dirty = true;
  }

  function orbit(dx, dy) {
    releaseView();
    target.yaw += dx * 0.007;
    target.pitch = clamp(target.pitch + dy * 0.0055, 0, Math.PI / 2);
    dirty = true;
  }

  function pointerDown(event) {
    if ((event.pointerType === 'mouse' && event.button !== 0) || pointers.size >= 2) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    yawVelocity = pitchVelocity = 0;
    lastPointerTime = event.timeStamp;
  }

  function pointerMove(event) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    const oldX = point.x;
    const oldY = point.y;
    point.x = event.clientX;
    point.y = event.clientY;
    const elapsed = clamp((event.timeStamp - lastPointerTime) / 1000, 0.012, 0.09);
    lastPointerTime = event.timeStamp;
    if (pointers.size === 1) {
      const dx = point.x - oldX;
      const dy = point.y - oldY;
      yawVelocity = 0.42 * yawVelocity + 0.58 * clamp(dx * 0.007 / elapsed, -4, 4);
      pitchVelocity = 0.42 * pitchVelocity + 0.58 * clamp(dy * 0.0055 / elapsed, -2.6, 2.6);
      orbit(dx, dy);
      return;
    }

    let other;
    for (const [id, position] of pointers) {
      if (id !== event.pointerId) other = position;
    }
    const distance = Math.hypot(point.x - other.x, point.y - other.y);
    const oldDistance = Math.hypot(oldX - other.x, oldY - other.y);
    const rect = canvas.getBoundingClientRect();
    const originX = rect.left + width / 2;
    const originY = rect.top + height / 2 + sceneY;
    zoomAt(distance / Math.max(1, oldDistance), (point.x + other.x) / 2 - originX,
      (point.y + other.y) / 2 - originY, (oldX + other.x) / 2 - originX, (oldY + other.y) / 2 - originY);
  }

  function pointerEnd(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (!pointers.size) canvas.classList.remove('dragging');
    if (motion.matches || event.type !== 'pointerup' || event.timeStamp - lastPointerTime > 100) {
      yawVelocity = pitchVelocity = 0;
    }
  }

  function updateCamera(seconds) {
    if (warpElapsed < WARP_SECONDS || viewpoint === 'sol') {
      const moving = warpElapsed < WARP_SECONDS;
      warpElapsed = motion.matches ? WARP_SECONDS : Math.min(WARP_SECONDS, warpElapsed + seconds);
      const progress = warpElapsed / WARP_SECONDS;
      const ease = progress * progress * (3 - 2 * progress);
      camera.yaw = warpStart.yaw + (target.yaw - warpStart.yaw) * ease;
      camera.pitch = warpStart.pitch + (target.pitch - warpStart.pitch) * ease;
      camera.zoom = warpStart.zoom * (target.zoom / warpStart.zoom) ** ease;
      let x = target.x;
      let y = target.y;
      if (viewpoint === 'sol') {
        locateSol(years, solWorld);
        // Project without pan to derive the exact offset for the current orientation.
        camera.x = camera.y = 0;
        updateProjection(solProjection, 0, 0, baseScale, camera);
        project(solProjection, solWorld.x, solWorld.y, 0, solScreen);
        x = -solScreen.x;
        y = -solScreen.y;
      }
      camera.x = warpStart.x + (x - warpStart.x) * ease;
      camera.y = warpStart.y + (y - warpStart.y) * ease;
      if (progress === 1 && viewpoint !== 'sol') {
        target.yaw = camera.yaw = wrap(target.yaw, TAU);
        Object.assign(camera, target);
      }
      return moving;
    }
    if (!pointers.size) {
      const decay = Math.exp(-8 * seconds);
      const travel = (1 - decay) / 8;
      target.yaw += yawVelocity * travel;
      target.pitch = clamp(target.pitch + pitchVelocity * travel, 0, Math.PI / 2);
      yawVelocity *= decay;
      pitchVelocity *= decay;
      if (Math.abs(yawVelocity) < 0.003) yawVelocity = 0;
      if (Math.abs(pitchVelocity) < 0.003) pitchVelocity = 0;
    }
    const ease = motion.matches ? 1 : 1 - Math.exp(-13 * seconds);
    const moving = camera.yaw !== target.yaw || camera.pitch !== target.pitch
      || camera.zoom !== target.zoom || camera.x !== target.x || camera.y !== target.y;
    if (!moving) return false;

    camera.yaw += (target.yaw - camera.yaw) * ease;
    camera.pitch += (target.pitch - camera.pitch) * ease;
    camera.zoom += (target.zoom - camera.zoom) * ease;
    camera.x += (target.x - camera.x) * ease;
    camera.y += (target.y - camera.y) * ease;
    if (Math.abs(camera.yaw - target.yaw) < 0.0001 && Math.abs(camera.pitch - target.pitch) < 0.0001
      && Math.abs(camera.zoom - target.zoom) < 0.0001 && Math.hypot(camera.x - target.x, camera.y - target.y) < 0.02) {
      target.yaw = wrap(target.yaw, TAU);
      Object.assign(camera, target);
    }
    return true;
  }

  function animate(now) {
    requestAnimationFrame(animate);
    nextFrame ??= now;
    if (now + 0.8 < nextFrame) return;
    nextFrame += FRAME_TIME * (1 + Math.floor((now + 0.8 - nextFrame) / FRAME_TIME));
    const seconds = Math.min((now - (previousTime ?? now - FRAME_TIME)) / 1000, 0.05);
    previousTime = now;
    if (!paused) {
      years += seconds * speed / 78;
      pulseTime += seconds;
    }
    const moving = updateCamera(seconds);
    if (dirty || moving || !paused) {
      rasterCamera.yaw = camera.yaw;
      rasterCamera.pitch = camera.pitch;
      rasterCamera.zoom = camera.zoom;
      rasterCamera.x = camera.x * rasterScale;
      rasterCamera.y = (camera.y + sceneY) * rasterScale;
      updateProjection(starView, rasterWidth, rasterHeight, baseScale * rasterScale, rasterCamera);
      updateProjection(hudView, width, height, baseScale, camera);
      hudView.cy += sceneY;
      engine.render(starView, years, camera.zoom, band, lensEmphasis, pulseTime);
      hud.render(hudView, camera.zoom, years, showGrid, showHud, showSol, sceneY);
      renderedFrames++;
      dirty = false;
    }
    lastReadout ??= now;
    if (showHud && now - lastReadout >= 100) {
      refreshReadouts();
      lastReadout = now;
    }
    lastReport ??= now;
    if (now - lastReport >= 500) {
      if (showHud) fps.textContent = paused ? '-- FPS' : Math.min(60, Math.round(renderedFrames * 1000 / (now - lastReport))) + ' FPS';
      renderedFrames = 0;
      lastReport = now;
    }
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('lostpointercapture', pointerEnd);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const units = event.deltaMode;
    const delta = event.deltaY * (units === 1 ? 16 : units === 2 ? height : 1);
    zoomAt(Math.exp(-clamp(delta, -260, 260) * 0.0025), event.clientX - rect.left - width / 2,
      event.clientY - rect.top - height / 2 - sceneY);
  }, { passive: false });

  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.target === rate && (key.startsWith('arrow') || key === 'home' || key === ' ')) return;
    if (key === ' ' && event.target instanceof HTMLButtonElement) return;
    if (event.repeat && [' ', 'g', 'h', 'r', 'f', 'home'].includes(key)) return;
    switch (key) {
      case ' ': setPaused(!paused); break;
      case 'g': toggleGrid(); break;
      case 'h': toggleHud(); break;
      case 'f': cycleBand(); break;
      case 'r':
      case 'home': warpTo('overview'); break;
      case '+':
      case '=': zoomAt(1.32, 0, 0); break;
      case '-': zoomAt(1 / 1.32, 0, 0); break;
      case 'arrowleft': orbit(-22, 0); break;
      case 'arrowright': orbit(22, 0); break;
      case 'arrowup': orbit(0, -22); break;
      case 'arrowdown': orbit(0, 22); break;
      default: return;
    }
    event.preventDefault();
  });

  play.addEventListener('click', () => setPaused(!paused));
  grid.addEventListener('click', toggleGrid);
  hudToggle.addEventListener('click', toggleHud);
  byId('reset').addEventListener('click', () => warpTo('overview'));
  byId('spectrum').addEventListener('click', cycleBand);
  lens.addEventListener('click', () => {
    lensEmphasis = !lensEmphasis;
    lens.setAttribute('aria-pressed', String(lensEmphasis));
    dirty = true;
  });
  rate.addEventListener('input', updateRate);
  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.view;
      if (next === 'sol') {
        showSol = !showSol;
        if (!showSol) {
          if (viewpoint === 'sol') releaseView();
          updateViewButtons();
          dirty = true;
          return;
        }
      }
      warpTo(next);
    });
  }
  motion.addEventListener('change', event => {
    if (event.matches) setPaused(true);
  });
  window.addEventListener('resize', resize);

  resize();
  setPaused(paused);
  updateRate();
  refreshReadouts();
  requestAnimationFrame(animate);
})();
