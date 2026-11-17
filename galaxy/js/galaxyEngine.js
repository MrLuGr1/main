(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const TABLE_SIZE = 16384;
  const TABLE_MASK = TABLE_SIZE - 1;
  const QUARTER_TURN = TABLE_SIZE / 4;
  const CAMERA_DISTANCE = 4.4;
  const SURVEY_RADIUS_LY = 100000;
  const ARM_START = 0.13;
  const MINOR_ARM = 0.25;
  const SPUR_OFFSET = 0.121;
  const PATTERN_SPEED = 0.53;
  const DISK_STARS = 72000;
  const BAR_STARS = 3900;
  const BULGE_STARS = 1250;
  const HALO_STARS = 2800;
  const STAR_COUNT = DISK_STARS + BAR_STARS + BULGE_STARS + HALO_STARS;

  const sine = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin(TAU * i / TABLE_SIZE);

  const wrap = (value, period) => ((value % period) + period) % period;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const armPhase = radius => -0.525 * Math.log(Math.max(ARM_START, radius) / ARM_START);

  const wave = new Float32Array(TABLE_SIZE);
  const spur = new Float32Array(TABLE_SIZE);
  function ridge(distance, width) {
    const cloud = Math.exp(-0.5 * (distance / width) ** 2);
    const dust = Math.exp(-0.5 * ((distance + width * 0.76) / (width * 0.27)) ** 2);
    return cloud * (1 - 0.92 * dust);
  }

  for (let i = 0; i < TABLE_SIZE; i++) {
    const phase = i / TABLE_SIZE;
    const major = wrap(phase + 0.25, 0.5) - 0.25;
    const minor = wrap(phase - MINOR_ARM + 0.25, 0.5) - 0.25;
    const local = wrap(phase - SPUR_OFFSET + 0.5, 1) - 0.5;
    wave[i] = 1.04 * ridge(major, 0.023) + 0.63 * ridge(minor, 0.019);
    spur[i] = ridge(local, 0.014);
  }

  const palette = new Uint32Array(2048);
  const rgba = new Uint8Array(palette.buffer);
  for (let i = 0; i < palette.length; i++) {
    const gray = Math.round(255 * (1 - Math.exp(-i / 174)));
    rgba.set([gray, gray, gray, 255], i * 4);
  }

  function makeStars() {
    const stride = 8;
    const data = new Float32Array(STAR_COUNT * stride);
    let seed = 0x6d696c6b;
    let offset = 0;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    function gaussian() {
      return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
    }
    function luminosity() {
      return 0.24 + random() * 0.55 + 1.85 * random() ** 11;
    }
    function append(radius, phase, z, speed, light, spiral = 0, reach = 0, local = 0) {
      data[offset++] = radius;
      data[offset++] = phase;
      data[offset++] = z;
      data[offset++] = speed;
      data[offset++] = light;
      data[offset++] = spiral;
      data[offset++] = reach;
      data[offset++] = local;
    }

    for (let i = 0; i < DISK_STARS; i++) {
      const radius = random() ** 0.72 * 0.562;
      const phase = random();
      const vertical = gaussian() * (0.004 + radius * 0.014);
      // Softened Keplerian omega, normalized to Orion's reference radius.
      const speed = (0.27 ** 2 / (radius ** 2 + 0.055 ** 2)) ** 0.75;
      const taper = clamp((0.554 - radius) / 0.112, 0, 1);
      const rise = clamp((radius - 0.09) / 0.078, 0, 1);
      const knots = 0.76 + 0.24 * Math.cos(radius * 107 + Math.sin(radius * 56)) ** 2;
      const bend = 0.009 * Math.sin(radius * 42) + 0.004 * Math.sin(radius * 101);
      const local = Math.max(0, 1 - Math.abs(radius - 0.274) / 0.09);
      append(radius, phase, vertical, speed, luminosity() * taper, armPhase(radius) + bend, rise * knots, local);
    }

    for (let i = 0; i < BAR_STARS; i++) {
      const x = (random() - 0.5) * 0.292;
      const taper = 1 - Math.abs(x) * 4.6;
      const y = gaussian() * 0.017 * taper;
      append(Math.hypot(x, y), Math.atan2(y, x) / TAU, gaussian() * 0.023 * taper,
        PATTERN_SPEED, luminosity() * taper * 0.47);
    }
    for (let i = 0; i < BULGE_STARS; i++) {
      const radius = Math.abs(gaussian()) * 0.039;
      const speed = (0.27 ** 2 / (radius ** 2 + 0.055 ** 2)) ** 0.75;
      append(radius, random(), gaussian() * 0.032, speed, luminosity() * 0.61);
    }
    for (let i = 0; i < HALO_STARS; i++) {
      const radius = 0.11 + random() ** 1.4 * 0.78;
      const height = 2 * random() - 1;
      const speed = (0.27 / radius) ** 1.5;
      append(radius * Math.sqrt(1 - height * height), random(), height * radius, speed,
        luminosity() * (0.25 - radius * 0.17));
    }
    return data;
  }

  function createProjection() {
    return { cx: 0, cy: 0, scale: 1, yawSin: 0, yawCos: 1, pitchSin: 1, pitchCos: 0 };
  }

  function updateProjection(projection, width, height, baseScale, camera) {
    projection.cx = width / 2 + camera.x;
    projection.cy = height / 2 + camera.y;
    projection.scale = baseScale * camera.zoom;
    projection.yawSin = Math.sin(camera.yaw);
    projection.yawCos = Math.cos(camera.yaw);
    projection.pitchSin = Math.sin(camera.pitch);
    projection.pitchCos = Math.cos(camera.pitch);
  }

  function project(projection, x, y, z, point) {
    const across = x * projection.yawCos - y * projection.yawSin;
    const forward = x * projection.yawSin + y * projection.yawCos;
    const depth = forward * projection.pitchCos + z * projection.pitchSin;
    const scale = projection.scale * CAMERA_DISTANCE / (CAMERA_DISTANCE - depth);
    point.x = Math.round(projection.cx + across * scale);
    point.y = Math.round(projection.cy + (forward * projection.pitchSin - z * projection.pitchCos) * scale);
    return point;
  }

  function createEngine(canvas) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    const data = makeStars();
    let width, height, frame, pixels, energy;

    function resize(nextWidth, nextHeight) {
      width = canvas.width = nextWidth;
      height = canvas.height = nextHeight;
      context.imageSmoothingEnabled = false;
      frame = context.createImageData(width, height);
      pixels = new Uint32Array(frame.data.buffer);
      energy = new Float32Array(pixels.length);
    }

    function render(projection, years, zoom) {
      energy.fill(0);
      const pattern = years * PATTERN_SPEED;
      const diskEnd = DISK_STARS * 8;
      const detail = Math.log2(zoom);
      const gain = 137 + 23 * detail;
      const zoomSize = 0.38 * detail;
      const { cx, cy, scale, yawCos, yawSin, pitchCos, pitchSin } = projection;
      for (let i = 0; i < data.length; i += 8) {
        const turns = data[i + 1] + years * data[i + 3];
        const index = Math.floor(turns * TABLE_SIZE) & TABLE_MASK;
        const radius = data[i];
        const x = radius * sine[(index + QUARTER_TURN) & TABLE_MASK];
        const y = radius * sine[index];
        const z = data[i + 2];
        const forward = x * yawSin + y * yawCos;
        const depth = forward * pitchCos + z * pitchSin;
        const projectedScale = scale * CAMERA_DISTANCE / (CAMERA_DISTANCE - depth);
        const px = Math.round(cx + (x * yawCos - y * yawSin) * projectedScale);
        const py = Math.round(cy + (forward * pitchSin - z * pitchCos) * projectedScale);
        if (px < -2 || py < -2 || px > width + 1 || py > height + 1) continue;

        const intrinsic = data[i + 4];
        let light = intrinsic;
        if (i < diskEnd) {
          // Stars pass through the slower pattern. Dust removes light on its trailing side.
          const phase = (Math.floor((turns - pattern - data[i + 5]) * TABLE_SIZE)) & TABLE_MASK;
          light *= 0.115 + data[i + 6] * wave[phase] + 0.72 * data[i + 7] * spur[phase];
        }
        const strength = light * gain * clamp(0.84 + 1.22 * depth, 0.22, 1.65);
        if (strength < 0.45) continue;
        const size = Math.min(4, Math.floor(1 + zoomSize + 0.7 * light));
        if (size === 1 && px >= 0 && py >= 0 && px < width && py < height) {
          energy[py * width + px] += strength;
          continue;
        }
        const left = px - (size >> 1);
        const top = py - (size >> 1);
        const endX = Math.min(width, left + size);
        const endY = Math.min(height, top + size);
        for (let row = Math.max(0, top); row < endY; row++) {
          const start = row * width;
          for (let col = Math.max(0, left); col < endX; col++) energy[start + col] += strength;
        }
      }

      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = palette[Math.min(palette.length - 1, energy[i] | 0)];
      }
      context.putImageData(frame, 0, 0);
    }

    return { resize, render };
  }

  window.MilkyWay = {
    TAU, SURVEY_RADIUS_LY, STAR_COUNT, PATTERN_SPEED, SPUR_OFFSET,
    clamp, wrap, armPhase, createProjection, updateProjection, project, createEngine,
  };
})();
