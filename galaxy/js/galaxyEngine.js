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
  const NEBULA_KNOTS = 28;
  const GAS_SAMPLES = 104;
  const STRIDE = 10;
  const CHANNEL_LEVELS = 4096;

  const sine = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin(TAU * i / TABLE_SIZE);

  const wrap = (value, period) => ((value % period) + period) % period;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const armPhase = radius => -0.525 * Math.log(Math.max(ARM_START, radius) / ARM_START);

  const wave = new Float32Array(TABLE_SIZE);
  const spur = new Float32Array(TABLE_SIZE);
  const leadingEdge = new Float32Array(TABLE_SIZE);
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
    leadingEdge[i] = Math.max(ridge(major - 0.015, 0.014), ridge(minor - 0.012, 0.013));
  }

  const swatches = [
    0x94a3b8, 0xcbd5e1, 0x64748b, 0xb4afb0, // Diffuse disk and halo
    0xa8e6ff, 0xd4f4ff, 0x7eb6ff, 0xa6afff, // Young stellar associations
    0xffdf9e, 0xffb85c, 0xff8c42, 0xffeed5, // Bulge and bar
    0xff5c8a, 0xd946ef, 0xff7b7b, 0xee5768, // Ionized gas
  ];
  const linear = channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const colors = new Float32Array(swatches.length * 3);
  for (let i = 0; i < swatches.length; i++) {
    colors[3 * i] = linear((swatches[i] >>> 16) / 255);
    colors[3 * i + 1] = linear(((swatches[i] >>> 8) & 255) / 255);
    colors[3 * i + 2] = linear((swatches[i] & 255) / 255);
  }

  // A shared exposure per pixel preserves channel ratios as light accumulates.
  const exposure = new Float32Array(2048);
  for (let i = 1; i < exposure.length; i++) {
    exposure[i] = 4092 * linear(1 - Math.exp(-i / 193)) / i;
  }
  const packed = new Uint32Array(CHANNEL_LEVELS * 3);
  const bytes = new Uint8Array(packed.buffer);
  for (let i = 0; i < CHANNEL_LEVELS; i++) {
    const value = i / (CHANNEL_LEVELS - 1);
    const srgb = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    const code = Math.round(255 * srgb);
    bytes[i * 4] = code;
    bytes[i * 4 + 3] = 255;
    bytes[(CHANNEL_LEVELS + i) * 4 + 1] = code;
    bytes[(2 * CHANNEL_LEVELS + i) * 4 + 2] = code;
  }

  function makeStars() {
    const data = new Float32Array((STAR_COUNT + NEBULA_KNOTS * GAS_SAMPLES) * STRIDE);
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
    function append(radius, phase, z, speed, light, color, armColor = color, spiral = 0, reach = 0, local = 0) {
      data[offset++] = radius;
      data[offset++] = phase;
      data[offset++] = z;
      data[offset++] = speed;
      data[offset++] = light;
      data[offset++] = spiral;
      data[offset++] = reach;
      data[offset++] = local;
      data[offset++] = color * 3;
      data[offset++] = armColor * 3;
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
      const light = luminosity() * taper;
      const color = radius < 0.14 ? 3 : Math.floor(random() * 3);
      const armColor = 4 + Math.floor(random() * 4);
      append(radius, phase, vertical, speed, light, color, armColor, armPhase(radius) + bend, rise * knots, local);
    }

    for (let i = 0; i < BAR_STARS; i++) {
      const x = (random() - 0.5) * 0.292;
      const taper = 1 - Math.abs(x) * 4.6;
      const y = gaussian() * 0.017 * taper;
      append(Math.hypot(x, y), Math.atan2(y, x) / TAU, gaussian() * 0.023 * taper,
        PATTERN_SPEED, luminosity() * taper * 0.47, 8 + Math.floor(random() * 4));
    }
    for (let i = 0; i < BULGE_STARS; i++) {
      const radius = Math.abs(gaussian()) * 0.039;
      const speed = (0.27 ** 2 / (radius ** 2 + 0.055 ** 2)) ** 0.75;
      append(radius, random(), gaussian() * 0.032, speed, luminosity() * 0.61,
        radius < 0.028 ? 11 : 8 + Math.floor(random() * 3));
    }
    for (let i = 0; i < HALO_STARS; i++) {
      const radius = 0.11 + random() ** 1.4 * 0.78;
      const height = 2 * random() - 1;
      const speed = (0.27 / radius) ** 1.5;
      append(radius * Math.sqrt(1 - height * height), random(), height * radius, speed,
        luminosity() * (0.25 - radius * 0.17), Math.floor(random() * 3));
    }

    // Each knot follows the density wave. Scatter its gas along the crest, with
    // irregular widths and gaps so individual clouds stay visible in projection.
    for (let i = 0; i < NEBULA_KNOTS; i++) {
      const arm = i % 4;
      const segment = Math.floor(i / 4);
      const center = 0.184 + (segment + 0.2 + random() * 0.64) * 0.045;
      const phase = arm * 0.25 + 0.013 + 0.018 * (random() - 0.5);
      const width = 0.0028 + 0.0065 * random();
      const brightness = 0.12 + 0.2 * random();
      const height = (random() - 0.5) * 0.016;
      const color = 12 + Math.floor(random() * 4);
      for (let j = 0; j < GAS_SAMPLES; j++) {
        const along = gaussian();
        const across = gaussian();
        const radius = center + along * width;
        const bend = 0.009 * Math.sin(radius * 42) + 0.004 * Math.sin(radius * 101);
        const density = Math.exp(-0.38 * (along * along + across * across));
        append(radius, armPhase(radius) + bend + phase + across * width * 0.76,
          height + gaussian() * 0.0038, PATTERN_SPEED,
          brightness * density * (0.28 + 0.72 * random()), random() < 0.24 ? 14 : color);
      }
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
    let width, height, frame, pixels, lightBuffer, litPixels;

    function resize(nextWidth, nextHeight) {
      width = canvas.width = nextWidth;
      height = canvas.height = nextHeight;
      context.imageSmoothingEnabled = false;
      frame = context.createImageData(width, height);
      pixels = new Uint32Array(frame.data.buffer);
      lightBuffer = new Float32Array(pixels.length * 3);
      litPixels = new Uint32Array(pixels.length);
    }

    function render(projection, years, zoom) {
      let litCount = 0;
      const pattern = years * PATTERN_SPEED;
      const diskEnd = DISK_STARS * STRIDE;
      const detail = Math.log2(zoom);
      const gain = 137 + 23 * detail;
      const zoomSize = 0.38 * detail;
      const { cx, cy, scale, yawCos, yawSin, pitchCos, pitchSin } = projection;
      for (let i = 0; i < data.length; i += STRIDE) {
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

        let light = data[i + 4];
        const native = data[i + 8];
        let red = colors[native];
        let green = colors[native + 1];
        let blue = colors[native + 2];
        if (i < diskEnd) {
          // Stars pass through the slower pattern. Dust removes light on its trailing side.
          const phase = (Math.floor((turns - pattern - data[i + 5]) * TABLE_SIZE)) & TABLE_MASK;
          const arms = data[i + 6] * wave[phase];
          const local = 0.72 * data[i + 7] * spur[phase];
          light *= 0.115 + arms + local;
          const young = Math.min(1, (0.82 + 0.56 * leadingEdge[phase]) * arms + 1.1 * local);
          const hot = data[i + 9];
          red += young * (colors[hot] - red);
          green += young * (colors[hot + 1] - green);
          blue += young * (colors[hot + 2] - blue);
        }
        const strength = light * gain * clamp(0.84 + 1.22 * depth, 0.22, 1.65);
        if (strength < 0.45) continue;
        red *= strength;
        green *= strength;
        blue *= strength;
        const size = Math.min(4, Math.floor(1 + zoomSize + 0.7 * light));
        if (size === 1) {
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const offset = py * width + px;
          const pixel = offset * 3;
          const previousRed = lightBuffer[pixel];
          if (previousRed === 0) litPixels[litCount++] = offset;
          lightBuffer[pixel] = previousRed + red;
          lightBuffer[pixel + 1] += green;
          lightBuffer[pixel + 2] += blue;
          continue;
        }
        const left = px - (size >> 1);
        const top = py - (size >> 1);
        const endX = Math.min(width, left + size);
        const endY = Math.min(height, top + size);
        for (let row = Math.max(0, top); row < endY; row++) {
          const start = row * width + Math.max(0, left);
          const end = row * width + endX;
          for (let offset = start; offset < end; offset++) {
            const pixel = offset * 3;
            const previousRed = lightBuffer[pixel];
            if (previousRed === 0) litPixels[litCount++] = offset;
            lightBuffer[pixel] = previousRed + red;
            lightBuffer[pixel + 1] += green;
            lightBuffer[pixel + 2] += blue;
          }
        }
      }

      // The surrounding black field only needs a fast fill. Tone-map and clear
      // the light buffer at the pixels hit by this frame's projected samples.
      pixels.fill(packed[0]);
      for (let i = 0; i < litCount; i++) {
        const offset = litPixels[i];
        const pixel = offset * 3;
        const red = lightBuffer[pixel];
        const green = lightBuffer[pixel + 1];
        const blue = lightBuffer[pixel + 2];
        lightBuffer[pixel] = lightBuffer[pixel + 1] = lightBuffer[pixel + 2] = 0;
        const peak = Math.max(red, green, blue);
        if (peak < 0.5) continue;
        const level = Math.round(peak);
        const scale = level < exposure.length ? exposure[level] : 4092 / peak;
        pixels[offset] = packed[(red * scale) | 0]
          | packed[CHANNEL_LEVELS + ((green * scale) | 0)]
          | packed[2 * CHANNEL_LEVELS + ((blue * scale) | 0)];
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
