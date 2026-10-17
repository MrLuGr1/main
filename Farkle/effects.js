// Small GPU point bursts for wins, hot dice and farkles; effects are discarded when their lifetime ends.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

export class ParticleEffects {
  constructor(scene) { this.scene = scene; this.bursts = []; }

  burst(color = '#f3d37b', count = 42, origin = new THREE.Vector3(0, .5, 0)) {
    const positions = new Float32Array(count * 3);
    const particles = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x; positions[i * 3 + 1] = origin.y; positions[i * 3 + 2] = origin.z;
      const angle = Math.random() * Math.PI * 2;
      const lift = .6 + Math.random() * 2.3;
      particles.push({ x: Math.cos(angle) * (.8 + Math.random() * 1.8), y: lift, z: Math.sin(angle) * (.8 + Math.random() * 1.8), life: .8 + Math.random() * .8 });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color, size: .14, sizeAttenuation: true, transparent: true, opacity: .95, depthWrite: false });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, particles, age: 0, duration: 1.6 });
  }

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;
      const values = burst.points.geometry.attributes.position.array;
      burst.particles.forEach((p, index) => {
        p.y -= 3.6 * dt;
        const drag = Math.max(0, 1 - dt * 1.3);
        p.x *= drag; p.z *= drag;
        values[index * 3] += p.x * dt;
        values[index * 3 + 1] += p.y * dt;
        values[index * 3 + 2] += p.z * dt;
      });
      burst.points.geometry.attributes.position.needsUpdate = true;
      burst.points.material.opacity = Math.max(0, 1 - burst.age / burst.duration);
      if (burst.age >= burst.duration) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose(); burst.points.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}

