(() => {
  'use strict';

  const {
    TAU, SURVEY_RADIUS_LY, PATTERN_SPEED, SPUR_OFFSET, SOL_RADIUS, SOL_DISTANCE_LY,
    armPhase, clamp, project, locateSol, locatePulsar, pulseLevel,
  } = window.MilkyWay;
  const FONT = {
    A:[14,17,17,31,17,17,17], B:[30,17,17,30,17,17,30], C:[14,17,16,16,16,17,14],
    D:[30,17,17,17,17,17,30], E:[31,16,16,30,16,16,31], F:[31,16,16,30,16,16,16],
    G:[14,17,16,23,17,17,15], H:[17,17,17,31,17,17,17], I:[14,4,4,4,4,4,14],
    J:[7,2,2,2,18,18,12], K:[17,18,20,24,20,18,17], L:[16,16,16,16,16,16,31],
    M:[17,27,21,21,17,17,17], N:[17,25,21,19,17,17,17], O:[14,17,17,17,17,17,14],
    P:[30,17,17,30,16,16,16], Q:[14,17,17,17,21,18,13], R:[30,17,17,30,20,18,17],
    S:[15,16,16,14,1,1,30], T:[31,4,4,4,4,4,4], U:[17,17,17,17,17,17,14],
    V:[17,17,17,17,17,10,4], W:[17,17,17,21,21,21,10], X:[17,17,10,4,10,17,17],
    Y:[17,17,10,4,4,4,4], Z:[31,1,2,4,8,16,31],
    0:[14,17,19,21,25,17,14], 1:[4,12,4,4,4,4,14], 2:[14,17,1,2,4,8,31],
    3:[30,1,1,14,1,1,30], 4:[2,6,10,18,31,2,2], 5:[31,16,16,30,1,1,30],
    6:[14,16,16,30,17,17,14], 7:[31,1,2,4,8,8,8], 8:[14,17,17,14,17,17,14],
    9:[14,17,17,15,1,1,14], '\u00b0':[6,9,9,6,0,0,0], '*':[0,21,14,31,14,21,0],
    '/':[1,1,2,4,8,16,16], ',':[0,0,0,0,0,4,8], '-':[0,0,0,14,0,0,0],
  };

  const TICKS = 72;
  const RING_SAMPLES = 432;
  const circle = new Float32Array((RING_SAMPLES + 1) * 2);
  for (let i = 0; i <= RING_SAMPLES; i++) {
    const angle = i * TAU / RING_SAMPLES;
    circle[2 * i] = Math.cos(angle);
    circle[2 * i + 1] = Math.sin(angle);
  }

  const gridRadii = [0.12, 0.27, 0.54];
  const tickText = ['0/360\u00b0', '45\u00b0', '90\u00b0', '135\u00b0', '180\u00b0', '225\u00b0', '270\u00b0', '315\u00b0'];
  const boundaryInk = ['#215b60', '#27666b', '#347d82', '#49989d', '#6dbec2', '#739c92', '#a3835b', '#b99463', '#977653'];
  const solTrailInk = ['#53604a', '#7f8051', '#b6a162', '#e6c67d'];
  const SOL_TRAIL_STEPS = 24;
  const SOL_TRAIL_ARC = TAU / 9;
  const landmarks = [
    { title:'GALACTIC CORE / SGR A*', dx:33, dy:-37, radius:0, phase:0, z:0, fade:16, ink:'#f1c594' },
    { title:'PERSEUS ARM', dx:-33, dy:27, radius:0.438, phase:armPhase(0.438), z:0, fade:6.5, ink:'#a9dfdf' },
    { title:'SCUTUM-CENTAURUS ARM', dx:31, dy:-24, radius:0.422, phase:armPhase(0.422) + 0.5, z:0, fade:6.5, ink:'#a9dfdf' },
    { title:'ORION SPUR', dx:-28, dy:-21, radius:0.274, phase:armPhase(0.274) + SPUR_OFFSET, z:0, fade:8, ink:'#a9dfdf' },
    { title:'OUTER HALO', dx:32, dy:22, radius:0.73, phase:0.052, z:0.16, fade:3, ink:'#a9dfdf' },
  ];

  function createHud(canvas) {
    const context = canvas.getContext('2d');
    if (!context) return null;

    let width, height, gutter, compact, scaleDistance, scaleLabel;
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const sol = { x: 0, y: 0 };
    const receiverTarget = { x: 0, y: 0, radius: 0, labelX: 0, labelY: 0 };
    const formatter = new Intl.NumberFormat('en-US');
    const solLabel = 'SOL / ' + formatter.format(SOL_DISTANCE_LY) + ' LY';

    function resize(nextWidth, nextHeight) {
      width = canvas.width = nextWidth;
      height = canvas.height = nextHeight;
      context.imageSmoothingEnabled = false;
      compact = width <= 700 || height <= 530;
      gutter = compact ? 16 : 32;
    }

    function text(label, x, y) {
      for (let index = 0; index < label.length; index++) {
        const glyph = FONT[label[index]];
        if (!glyph) continue;
        for (let row = 0; row < glyph.length; row++) {
          const mask = glyph[row];
          for (let col = 0; col < 5; col++) {
            if (mask & (16 >> col)) context.fillRect(x + index * 6 + col, y + row, 1, 1);
          }
        }
      }
    }

    function line(x, y, endX, endY, stride = 1) {
      // Reject invisible segments before walking their integer pixel coordinates.
      if (Math.max(x, endX) < 0 || Math.min(x, endX) >= width
        || Math.max(y, endY) < 0 || Math.min(y, endY) >= height) return;
      const dx = Math.abs(endX - x);
      const dy = -Math.abs(endY - y);
      const stepX = x < endX ? 1 : -1;
      const stepY = y < endY ? 1 : -1;
      let error = dx + dy;
      let pixel = 0;
      while (true) {
        if (pixel++ % stride === 0) context.fillRect(x, y, 1, 1);
        if (x === endX && y === endY) break;
        const twice = 2 * error;
        if (twice >= dy) { error += dy; x += stepX; }
        if (twice <= dx) { error += dx; y += stepY; }
      }
    }

    function ring(projection, radius, boundary) {
      project(projection, radius, 0, 0, a);
      const stride = boundary ? 1 : 3;
      for (let i = 1; i <= RING_SAMPLES; i++) {
        project(projection, radius * circle[2 * i], radius * circle[2 * i + 1], 0, b);
        if (boundary) context.fillStyle = boundaryInk[Math.floor((i - 1) * boundaryInk.length / RING_SAMPLES)];
        if (boundary || i % 3 !== 0) line(a.x, a.y, b.x, b.y, stride);
        a.x = b.x;
        a.y = b.y;
      }
    }

    function degreeTicks(projection) {
      const spacing = RING_SAMPLES / TICKS;
      const showNumbers = projection.pitchSin > 0.23 && projection.scale < Math.max(width, height);
      for (let i = 0; i < TICKS; i++) {
        const major = i % 9 === 0;
        const interval = 2 * i * spacing;
        const x = circle[interval];
        const y = circle[interval + 1];
        const tick = major ? 1.028 : 1.013;
        project(projection, x, y, 0, a);
        project(projection, x * tick, y * tick, 0, b);
        context.fillStyle = major ? '#75a4a4' : '#426467';
        line(a.x, a.y, b.x, b.y);
        if (major && showNumbers && (!compact || i % 18 === 0)) {
          const label = tickText[i / 9];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const length = label.length * 6 - 1;
          let textX = dx > 3 ? b.x + 5 : dx < -3 ? b.x - length - 4 : b.x - (length >> 1);
          let textY = dy > 3 ? b.y + 5 : dy < -3 ? b.y - 11 : b.y - 3;
          if (textX + length > width - gutter / 2 || textX < gutter / 2) {
            textX = clamp(textX, gutter / 2, width - gutter / 2 - length);
            textY = b.y + (dy >= 0 ? 8 : -14);
          }
          text(label, textX, clamp(textY, 3, height - 10));
        }
      }
    }

    function grid(projection, zoom, years, target) {
      for (const radius of gridRadii) {
        context.fillStyle = radius === 0.27 ? '#376366' : '#263e40';
        ring(projection, radius, false);
      }

      context.fillStyle = '#20383a';
      for (let axis = 0; axis < 8; axis++) {
        const index = axis * RING_SAMPLES / 8 * 2;
        // Project the dots themselves to retain regular spacing in the galactic plane.
        for (let dot = 1; dot <= 24; dot++) {
          const radius = dot / 25;
          project(projection, radius * circle[index], radius * circle[index + 1], 0, a);
          context.fillRect(a.x, a.y, 1, 1);
        }
      }

      for (const landmark of landmarks) {
        const opacity = clamp((landmark.fade - zoom) / (landmark.fade * 0.65), 0, 1);
        if (opacity < 0.01) continue;
        const phase = (landmark.phase + years * PATTERN_SPEED) * TAU;
        project(projection, landmark.radius * Math.cos(phase), landmark.radius * Math.sin(phase), landmark.z, a);
        if (a.x < 8 || a.x > width - 8 || a.y < 8 || a.y > height - 8) continue;

        const length = landmark.title.length * 6 - 1;
        const leftward = landmark.dx < 0;
        const labelX = clamp(a.x + landmark.dx - (leftward ? length : 0), 8, width - length - 8);
        const labelY = clamp(a.y + landmark.dy, 12, height - 15);
        if (target && labelX - 4 < target.labelX + 39 && labelX + length + 4 > target.labelX
          && Math.abs(labelY - target.labelY) < 13) continue;
        const elbowX = leftward ? labelX + length : labelX;
        context.globalAlpha = opacity;
        context.fillStyle = landmark.ink;
        line(a.x, a.y, elbowX, labelY + 10);
        context.fillRect(labelX, labelY + 10, length, 1);
        context.fillRect(a.x - 1, a.y - 1, 3, 3);
        context.fillStyle = '#000';
        context.fillRect(labelX - 2, labelY - 2, length + 4, 11);
        context.fillStyle = landmark.ink;
        text(landmark.title, labelX, labelY);
      }
      context.globalAlpha = 1;
    }

    function diskPlane(projection, x, y) {
      const rx = compact ? 22 : 30;
      const ry = projection.pitchSin * (compact ? 11 : 14);
      const cx = x + (compact ? 34 : 43);
      const cy = y + 31;
      context.fillStyle = '#060b0c';
      context.fillRect(x, y, compact ? 69 : 88, 49);
      context.fillStyle = '#283d40';
      context.fillRect(x, y, compact ? 69 : 88, 1);
      context.fillStyle = '#9ccece';
      text('DISK PLANE', x + 5, y + 6);

      context.fillStyle = '#4b797d';
      let px = cx + rx;
      let py = cy;
      for (let i = 12; i <= RING_SAMPLES; i += 12) {
        const nextX = cx + Math.round(rx * circle[2 * i]);
        const nextY = cy + Math.round(ry * circle[2 * i + 1]);
        line(px, py, nextX, nextY);
        px = nextX;
        py = nextY;
      }
      const zeroX = cx + Math.round(rx * projection.yawCos);
      const zeroY = cy + Math.round(ry * projection.yawSin);
      context.fillStyle = '#7d9290';
      line(cx, cy, zeroX, zeroY);
      context.fillStyle = '#ffc487';
      context.fillRect(zeroX - 1, zeroY - 1, 3, 3);
    }

    function instruments(projection, zoom, sceneY) {
      context.fillStyle = '#4b7275';
      for (let i = 0; i < 4; i++) {
        const edge = compact ? 7 : 12;
        const right = i % 2 === 1;
        const bottom = i > 1;
        const x = right ? width - edge - 1 : edge;
        const y = bottom ? height - edge - 1 : edge;
        context.fillRect(right ? x - 11 : x, y, 12, 1);
        context.fillRect(x, bottom ? y - 11 : y, 1, 12);
      }

      const cx = Math.round(width / 2);
      const cy = Math.round(height / 2 + sceneY);
      context.fillStyle = '#3b7b7e';
      context.fillRect(cx - 13, cy, 5, 1);
      context.fillRect(cx + 9, cy, 5, 1);
      context.fillRect(cx, cy - 13, 1, 5);
      context.fillRect(cx, cy + 9, 1, 5);

      const preferred = 19500 / zoom;
      const power = 10 ** Math.floor(Math.log10(preferred));
      const normalized = preferred / power;
      const distance = Math.max(500, (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * power);
      if (distance !== scaleDistance) {
        scaleDistance = distance;
        scaleLabel = formatter.format(distance) + ' LY';
      }
      const length = Math.round(projection.scale * distance / SURVEY_RADIUS_LY);
      const x = gutter;
      const y = height - gutter - 27;
      if (width >= 310 && height >= 250) diskPlane(projection, x, y - 60);
      context.fillStyle = '#9ccece';
      context.fillRect(x, y, length + 1, 1);
      context.fillRect(x, y - 4, 1, 5);
      context.fillRect(x + length, y - 4, 1, 5);
      text(scaleLabel, x + length + 9, y - 6);
    }

    function drawSol(projection, years) {
      context.fillStyle = '#76906b';
      ring(projection, SOL_RADIUS, false);
      locateSol(years, sol);
      const angle = Math.atan2(sol.y, sol.x);
      project(projection, SOL_RADIUS * Math.cos(angle - SOL_TRAIL_ARC),
        SOL_RADIUS * Math.sin(angle - SOL_TRAIL_ARC), 0, a);
      for (let i = 0; i < SOL_TRAIL_STEPS; i++) {
        const phase = angle - SOL_TRAIL_ARC * (1 - (i + 1) / SOL_TRAIL_STEPS);
        project(projection, SOL_RADIUS * Math.cos(phase), SOL_RADIUS * Math.sin(phase), 0, b);
        context.fillStyle = solTrailInk[Math.floor(i * solTrailInk.length / SOL_TRAIL_STEPS)];
        line(a.x, a.y, b.x, b.y);
        a.x = b.x;
        a.y = b.y;
      }
      project(projection, sol.x, sol.y, 0, a);
      const { x, y } = a;
      if (x < 0 || x >= width || y < 0 || y >= height) return;

      context.fillStyle = '#f8db91';
      for (let dy = -1; dy <= 1; dy += 2) {
        for (let dx = -1; dx <= 1; dx += 2) {
          const cornerX = x + dx * 9;
          const cornerY = y + dy * 9;
          context.fillRect(cornerX - (dx > 0 ? 3 : 0), cornerY, 4, 1);
          context.fillRect(cornerX, cornerY - (dy > 0 ? 3 : 0), 1, 4);
        }
      }
      context.fillRect(x - 1, y - 1, 3, 3);
      const length = solLabel.length * 6 - 1;
      const labelX = clamp(x + 16, 6, width - length - 6);
      const labelY = y >= 21 ? y - 17 : y + 16;
      context.fillStyle = '#060b0c';
      context.fillRect(labelX - 3, labelY - 2, length + 6, 11);
      context.fillStyle = '#f8db91';
      text(solLabel, labelX, labelY);
    }

    function drawPulsar(pulsar, target) {
      const { x, y, radius, labelX, labelY } = target;
      context.fillStyle = radius === 13 ? '#dbffff' : '#7ae3e6';
      for (let side = -1; side <= 1; side += 2) {
        line(x + side * radius, y, x + side * (radius - 4), y - 4);
        line(x + side * radius, y, x + side * (radius - 4), y + 4);
      }
      context.fillStyle = '#060b0c';
      context.fillRect(labelX - 2, labelY - 2, 39, 11);
      context.fillStyle = '#9ceff0';
      text(pulsar.name, labelX, labelY);
    }

    function render(projection, zoom, years, showGrid, showHud, showSol, sceneY, pulsar, pulseTime) {
      context.clearRect(0, 0, width, height);
      let target;
      if (pulsar) {
        locatePulsar(pulsar, years, receiverTarget);
        project(projection, receiverTarget.x, receiverTarget.y, 0, receiverTarget);
        const { x, y } = receiverTarget;
        if (x >= 0 && x < width && y >= 0 && y < height) {
          target = receiverTarget;
          target.radius = 9 + pulseLevel(pulsar, pulseTime) * 2;
          target.labelX = clamp(x + target.radius + 6, 3, width - 40);
          target.labelY = Math.max(3, y - 16);
        }
      }
      if (showGrid) grid(projection, zoom, years, target);
      ring(projection, 1, true);
      if (showGrid) degreeTicks(projection);
      if (showHud) instruments(projection, zoom, sceneY);
      if (showSol) drawSol(projection, years);
      if (target) drawPulsar(pulsar, target);
    }

    return { resize, render };
  }

  function createSignalTrace(canvas) {
    const context = canvas.getContext('2d');
    if (!context) return null;
    const { width, height } = canvas;
    context.imageSmoothingEnabled = false;
    return (pulsar, time) => {
      context.fillStyle = '#070e10';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#1b3034';
      for (let x = 6; x < width; x += 16) context.fillRect(x, 0, 1, height);
      for (let y = 7; y < height; y += 14) context.fillRect(0, y, width, 1);

      const last = width - 7;
      const baseline = height - 8;
      let previous;
      context.fillStyle = '#74d6d6';
      for (let x = 6; x <= last; x++) {
        const sample = time - 2 * (last - x) / (last - 6);
        const y = baseline - 13 * pulseLevel(pulsar, sample);
        previous ??= y;
        context.fillRect(x, Math.min(y, previous), 1, Math.abs(y - previous) + 1);
        previous = y;
      }
      context.fillStyle = previous === baseline ? '#9ceff0' : '#ecffff';
      context.fillRect(last - 1, previous - 1, 3, 3);
    };
  }

  Object.assign(window.MilkyWay, { createHud, createSignalTrace });
})();
