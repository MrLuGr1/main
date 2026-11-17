(() => {
  'use strict';

  const { TAU, SURVEY_RADIUS_LY, PATTERN_SPEED, SPUR_OFFSET, armPhase, orbitalSpeed, clamp, project } = window.MilkyWay;
  const SOL_DISTANCE_LY = 26000;
  const SOL_RADIUS = SOL_DISTANCE_LY / SURVEY_RADIUS_LY;
  const solPhase = armPhase(SOL_RADIUS) + SPUR_OFFSET;
  const solSpeed = orbitalSpeed(SOL_RADIUS);

  function locateSol(years, position) {
    const phase = TAU * (solPhase + years * solSpeed);
    position.x = SOL_RADIUS * Math.cos(phase);
    position.y = SOL_RADIUS * Math.sin(phase);
  }

  // Representative beacons sampled near the same arm crests as the gas knots.
  const pulsars = [
    [0.186, 0.50, 0.82], [0.223, 0.25, 1.11], [0.278, 0.75, 1.39],
    [0.306, 0.00, 1.64], [0.351, 0.50, 1.93], [0.404, 0.25, 2.24],
    [0.451, 0.75, 2.56], [0.480, 0.00, 2.81],
  ].map(([radius, arm, frequency], index) => ({
    radius, frequency, phase: armPhase(radius) + arm + 0.013
      + 0.009 * Math.sin(radius * 42) + 0.004 * Math.sin(radius * 101),
    pulseOffset: index * 0.381966,
  }));

  const colors = new Uint32Array(9);
  new Uint8Array(colors.buffer).set([
    114, 154, 175, 255, 113, 218, 237, 255, 224, 251, 255, 255,
    155, 114, 90, 255, 243, 171, 107, 255, 255, 236, 197, 255,
    154, 100, 139, 255, 246, 128, 196, 255, 255, 220, 246, 255,
  ]);

  const MAX_LENS_RADIUS = 64;
  const FALLOFF_STEPS = 512;
  const falloff = Float32Array.from({ length: FALLOFF_STEPS + 1 }, (_, i) => {
    const r2 = i / FALLOFF_STEPS;
    // Soften the center and taper the distortion to zero at the patch boundary.
    return (1 - r2) ** 2 * Math.min(1, r2 * 55) / (0.20 + r2);
  });

  function createEffects() {
    const scratch = new Uint32Array((2 * MAX_LENS_RADIUS + 1) ** 2);
    const point = { x: 0, y: 0 };

    function lens(pixels, width, height, projection, zoom, emphasis) {
      const strength = emphasis ? 0.46 : 0.32 * clamp((zoom - 2.7) / 4, 0, 1);
      if (strength === 0) return;
      const cx = Math.round(projection.cx);
      const cy = Math.round(projection.cy);
      const radius = clamp(Math.round(projection.scale * 0.075), 12, MAX_LENS_RADIUS);
      const left = Math.max(0, cx - radius);
      const right = Math.min(width - 1, cx + radius);
      const top = Math.max(0, cy - radius);
      const bottom = Math.min(height - 1, cy + radius);
      if (left >= right || top >= bottom) return;
      const patchWidth = right - left + 1;
      for (let y = top; y <= bottom; y++) {
        const row = y * width;
        const patchRow = (y - top) * patchWidth;
        for (let x = left; x <= right; x++) scratch[patchRow + x - left] = pixels[row + x];
      }
      const lookupScale = FALLOFF_STEPS / (radius * radius);
      for (let y = top; y <= bottom; y++) {
        const row = y * width;
        const dy = y - cy;
        for (let x = left; x <= right; x++) {
          const dx = x - cx;
          const index = ((dx * dx + dy * dy) * lookupScale) | 0;
          if (index >= FALLOFF_STEPS) continue;
          const pull = Math.min(0.56, strength * falloff[index]);
          const sx = x - Math.round(dx * pull);
          const sy = y - Math.round(dy * pull);
          if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
            pixels[row + x] = scratch[(sy - top) * patchWidth + sx - left];
          }
        }
      }
    }

    function render(pixels, width, height, projection, years, zoom, emphasis, pulseTime, band) {
      lens(pixels, width, height, projection, zoom, emphasis);
      const palette = band * 3;
      for (const pulsar of pulsars) {
        const angle = TAU * (pulsar.phase + years * PATTERN_SPEED);
        project(projection, pulsar.radius * Math.cos(angle), pulsar.radius * Math.sin(angle), 0, point);
        const { x, y } = point;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const cycle = (pulseTime * pulsar.frequency + pulsar.pulseOffset) % 1;
        const pixel = y * width + x;
        pixels[pixel] = colors[palette + (cycle < 0.10 ? 2 : cycle < 0.20 ? 1 : 0)];
        if (cycle < 0.10 && x > 0 && x + 1 < width && y > 0 && y + 1 < height) {
          pixels[pixel - 1] = pixels[pixel + 1] = colors[palette + 1];
          pixels[pixel - width] = pixels[pixel + width] = colors[palette + 1];
        }
      }
    }

    return { render };
  }

  Object.assign(window.MilkyWay, { SOL_RADIUS, SOL_DISTANCE_LY, locateSol, createEffects });
})();
