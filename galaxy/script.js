(() => {
  'use strict';

  const canvas = document.querySelector('#galaxy');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;

  const TAU = 2 * Math.PI;
  const INCLINATION = 0.55;
  const TILT_COS = Math.cos(INCLINATION);
  const TILT_SIN = Math.sin(INCLINATION);
  const ROTATION_SPEED = TAU / 150;
  const MIN_ZOOM = 0.45;
  const MAX_ZOOM = 48;
  const PIXEL_SIZE = 2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function generateStars() {
    const stars = [];
    let seed = 0x4d494c4b;

    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    function normal() {
      return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
    }

    function luminosity() {
      return 0.22 + 0.65 * random() + 2.5 * random() ** 10;
    }

    function addStar(x, y, z, light) {
      stars.push(x, y, z, light);
    }

    // Two dominant arms leave the ends of the bar. Two weaker arms run between them.
    const arms = [
      { phase: 0, start: 0.18, end: 1, count: 12500, light: 1 },
      { phase: Math.PI, start: 0.18, end: 0.96, count: 11800, light: 0.94 },
      { phase: 0.76, start: 0.33, end: 0.86, count: 6500, light: 0.69 },
      { phase: Math.PI + 0.85, start: 0.35, end: 0.92, count: 6300, light: 0.63 },
    ];

    for (const arm of arms) {
      for (let i = 0; i < arm.count; i++) {
        const progress = random();
        const radius = arm.start + (arm.end - arm.start) * progress;
        const bend = 0.044 * Math.sin(18 * progress + arm.phase);
        const angle = arm.phase + 3.65 * Math.log(radius / arm.start) + bend;
        const width = 0.012 + 0.032 * radius;
        const across = normal() * width;
        const offset = across / radius;

        // Thin dust lanes and uneven star-forming knots break up the arm ridges.
        const laneDistance = (across + width * 0.57) / (width * 0.24);
        const dust = 1 - 0.76 * Math.exp(-(laneDistance ** 2));
        const knots = 0.66 + 0.34 * Math.sin(31 * progress + arm.phase) ** 2;
        const taper = (1 - 0.87 * progress ** 5) * (0.53 + 0.47 * Math.min(1, progress * 12));
        const light = luminosity() * arm.light * taper * dust * knots;
        addStar(radius * Math.cos(angle + offset), radius * Math.sin(angle + offset),
          normal() * (0.011 + 0.016 * radius), light);
      }
    }

    // A thin, diffuse disk fills the space between the arms.
    for (let i = 0; i < 23000; i++) {
      const radius = Math.sqrt(random()) * 1.04;
      const angle = TAU * random();
      addStar(radius * Math.cos(angle), radius * Math.sin(angle),
        normal() * (0.012 + 0.032 * radius), luminosity() * (1 - radius / 1.11) * 0.58);
    }

    // An elongated bar and a thicker, compact bulge share the galactic center.
    for (let i = 0; i < 3900; i++) {
      const along = (random() - 0.5) * 0.42;
      const spread = 1 - Math.abs(along) * 2.5;
      addStar(along, normal() * 0.021 * spread, normal() * 0.029 * spread,
        luminosity() * 0.69 * spread);
    }

    for (let i = 0; i < 900; i++) {
      addStar(normal() * 0.034, normal() * 0.03, normal() * 0.045, luminosity() * 0.86);
    }

    return new Float32Array(stars);
  }

  const stars = generateStars();
  const shades = new Uint32Array(2048);
  const rgba = new Uint8Array(shades.buffer);
  for (let i = 0; i < shades.length; i++) {
    const gray = Math.round(255 * (1 - Math.exp(-i / 165)));
    rgba.set([gray, gray, gray, 255], i * 4);
  }

  const view = { zoom: 1, x: 0, y: 0 };
  const target = { ...view };
  let width;
  let height;
  let baseScale;
  let frame;
  let pixels;
  let density;
  let angle = 0.36;
  let previousTime;
  let animationFrame = 0;

  function resize() {
    width = Math.max(1, Math.round(canvas.clientWidth / PIXEL_SIZE));
    height = Math.max(1, Math.round(canvas.clientHeight / PIXEL_SIZE));
    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = false;

    // Account for the disk's incline when fitting the first view to the viewport.
    const nextScale = Math.min(width * 0.44, height * 0.49 / TILT_COS);
    const ratio = nextScale / (baseScale || nextScale);
    view.x *= ratio;
    view.y *= ratio;
    target.x *= ratio;
    target.y *= ratio;
    baseScale = nextScale;
    frame = context.createImageData(width, height);
    pixels = new Uint32Array(frame.data.buffer);
    density = new Float32Array(width * height);
    requestFrame();
  }

  function draw() {
    density.fill(0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const scale = baseScale * view.zoom;
    const centerX = width / 2 + view.x;
    const centerY = height / 2 + view.y;
    const zoomDetail = Math.max(0, Math.log2(view.zoom));
    const lightGain = 95 + 27 * zoomDetail;

    for (let i = 0; i < stars.length; i += 4) {
      const x = stars[i];
      const y = stars[i + 1];
      const z = stars[i + 2];
      const diskY = x * sin + y * cos;
      const projectedX = centerX + (x * cos - y * sin) * scale;
      const projectedY = centerY + (diskY * TILT_COS - z * TILT_SIN) * scale;
      const depth = diskY * TILT_SIN + z * TILT_COS;
      const light = stars[i + 3];
      const size = clamp(Math.floor(1 + 0.36 * zoomDetail + 0.66 * light), 1, 5);
      const left = Math.floor(projectedX - (size - 1) / 2);
      const top = Math.floor(projectedY - (size - 1) / 2);
      const right = Math.min(width, left + size);
      const bottom = Math.min(height, top + size);
      if (right <= 0 || bottom <= 0 || left >= width || top >= height) continue;

      // Positive depth faces the camera. Every overlapping square adds its light.
      const proximity = clamp(0.79 + 0.9 * depth, 0.24, 1.48);
      const energy = light * lightGain * proximity;
      for (let row = Math.max(0, top); row < bottom; row++) {
        const rowStart = row * width;
        for (let col = Math.max(0, left); col < right; col++) {
          density[rowStart + col] += energy;
        }
      }
    }

    // Tone-map the accumulated light to keep structure visible in dense clusters.
    for (let i = 0; i < density.length; i++) {
      pixels[i] = shades[Math.min(shades.length - 1, density[i] | 0)];
    }
    context.putImageData(frame, 0, 0);
  }

  function requestFrame() {
    if (!animationFrame) animationFrame = requestAnimationFrame(animate);
  }

  function animate(time) {
    animationFrame = 0;
    const seconds = Math.min((time - (previousTime ?? time - 16.67)) / 1000, 0.05);
    previousTime = time;
    const ease = 1 - Math.exp(-14 * seconds);
    view.zoom += (target.zoom - view.zoom) * ease;
    view.x += (target.x - view.x) * ease;
    view.y += (target.y - view.y) * ease;

    const settled = Math.abs(target.zoom - view.zoom) < 0.0001
      && Math.hypot(target.x - view.x, target.y - view.y) < 0.02;
    if (settled) Object.assign(view, target);

    if (!reduceMotion.matches) {
      // Keep individual stars in view longer at high magnification.
      const speed = ROTATION_SPEED / (1 + 0.35 * Math.max(0, view.zoom - 1));
      angle = (angle + speed * seconds) % TAU;
    }
    draw();

    if (!reduceMotion.matches || !settled) requestFrame();
    else previousTime = undefined;
  }

  function zoomAt(factor, x, y) {
    const nextZoom = clamp(target.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === target.zoom) return;

    // Keep the point under the cursor fixed as the camera moves between poses.
    const ratio = nextZoom / target.zoom;
    const overview = clamp((nextZoom - MIN_ZOOM) / (1 - MIN_ZOOM), 0, 1);
    const maxOffset = baseScale * nextZoom * overview;
    target.x = clamp(x + (target.x - x) * ratio, -maxOffset, maxOffset);
    target.y = clamp(y + (target.y - y) * ratio, -maxOffset, maxOffset);
    target.zoom = nextZoom;
    requestFrame();
  }

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * width / rect.width - width / 2;
    const y = (event.clientY - rect.top) * height / rect.height - height / 2;
    const units = event.deltaMode;
    const distance = event.deltaY * (units === 1 ? 16 : units === 2 ? rect.height : 1);
    zoomAt(Math.exp(-clamp(distance, -240, 240) * 0.0025), x, y);
  }, { passive: false });

  canvas.addEventListener('keydown', (event) => {
    switch (event.key) {
      case '+':
      case '=':
        zoomAt(1.35, 0, 0);
        break;
      case '-':
        zoomAt(1 / 1.35, 0, 0);
        break;
      case 'Home':
        Object.assign(target, { zoom: 1, x: 0, y: 0 });
        requestFrame();
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  window.addEventListener('resize', resize);
  reduceMotion.addEventListener('change', requestFrame);
  resize();
})();
