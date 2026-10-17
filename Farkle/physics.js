// Cannon-es dice simulation. A roll is visually simulated for exactly two seconds, then damped onto a readable face.
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

const DIE_SIZE = .9;
const HALF = DIE_SIZE / 2;
const GRAVITY = 19;
const KEEP_X = [-3.85, -2.31, -.77, .77, 2.31, 3.85];
const THROW_POWER = { low: .62, medium: 1, high: 1.42 };

function topFace(body) {
  const axes = [
    [3, new CANNON.Vec3(1, 0, 0)], [4, new CANNON.Vec3(-1, 0, 0)],
    [1, new CANNON.Vec3(0, 1, 0)], [6, new CANNON.Vec3(0, -1, 0)],
    [2, new CANNON.Vec3(0, 0, 1)], [5, new CANNON.Vec3(0, 0, -1)],
  ];
  let face = 1, highest = -Infinity;
  for (const [value, axis] of axes) {
    const worldAxis = body.quaternion.vmult(axis);
    if (worldAxis.y > highest) { highest = worldAxis.y; face = value; }
  }
  return face;
}

function faceQuaternion(face, yaw = Math.random() * Math.PI * 2) {
  const q = new CANNON.Quaternion();
  if (face === 6) q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI);
  if (face === 2) q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  if (face === 5) q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2);
  if (face === 3) q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2);
  if (face === 4) q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -Math.PI / 2);
  const spin = new CANNON.Quaternion();
  spin.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
  return spin.mult(q);
}

function blendQuaternion(from, to, amount) {
  let bx = to.x, by = to.y, bz = to.z, bw = to.w;
  if (from.x * bx + from.y * by + from.z * bz + from.w * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const t = amount, x = from.x * (1 - t) + bx * t, y = from.y * (1 - t) + by * t;
  const z = from.z * (1 - t) + bz * t, w = from.w * (1 - t) + bw * t;
  const length = Math.hypot(x, y, z, w) || 1;
  from.set(x / length, y / length, z / length, w / length);
}

export class DicePhysics {
  constructor(count = 6) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0), allowSleep: true });
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.solver.iterations = 10;
    this.diceMaterial = new CANNON.Material('ivory-dice');
    this.tableMaterial = new CANNON.Material('felt-table');
    this.world.defaultContactMaterial.friction = .38;
    this.world.defaultContactMaterial.restitution = .2;
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.diceMaterial, this.tableMaterial, { friction: .48, restitution: .22 }));
    this.bodies = [];
    this.roll = null;
    this.addTable();
    for (let i = 0; i < count; i++) this.addDie(i);
  }

  addTable() {
    const ground = new CANNON.Body({ mass: 0, material: this.tableMaterial, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    const addWall = (x, z, halfX, halfZ) => {
      const wall = new CANNON.Body({ mass: 0, material: this.tableMaterial, position: new CANNON.Vec3(x, .22, z) });
      wall.addShape(new CANNON.Box(new CANNON.Vec3(halfX, .24, halfZ)));
      this.world.addBody(wall);
    };
    // Physical bounds match the 100 × 150 cm rectangular table in game.js.
    addWall(-4.88, 0, .12, 7.35); addWall(4.88, 0, .12, 7.35);
    addWall(0, -7.35, 4.9, .12); addWall(0, 7.35, 4.9, .12);
  }

  addDie(id) {
    const body = new CANNON.Body({
      mass: 0, type: CANNON.Body.STATIC, material: this.diceMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
      position: new CANNON.Vec3(KEEP_X[id], HALF, 5.45), allowSleep: true,
      sleepSpeedLimit: .08, sleepTimeLimit: .22, linearDamping: .22, angularDamping: .23,
    });
    body.dieId = id;
    this.world.addBody(body);
    this.bodies.push(body);
  }

  throwDice(ids, power = 'medium') {
    const strength = THROW_POWER[power] || THROW_POWER.medium;
    const positions = [-3.85, -2.31, -.77, .77, 2.31, 3.85];
    ids.forEach((id, index) => {
      const body = this.bodies[id];
      body.type = CANNON.Body.DYNAMIC; body.mass = 1; body.updateMassProperties(); body.wakeUp();
      body.position.set(positions[index % positions.length], 2.5 + Math.random() * .65, Math.random() * 4.6 - 2.3);
      body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      // The lobby power scales the actual launch impulse/velocity, not just the animation.
      body.velocity.set((Math.random() - .5) * 4.5 * strength, (1 + Math.random() * 2.5) * strength, (Math.random() - .5) * 6.5 * strength);
      const spin = Math.sqrt(strength);
      body.angularVelocity.set((Math.random() - .5) * 18 * spin, (Math.random() - .5) * 17 * spin, (Math.random() - .5) * 18 * spin);
      body.force.setZero(); body.torque.setZero(); body.aabbNeedsUpdate = true;
    });
    this.roll = { ids: [...ids], elapsed: 0, targets: null };
  }

  /** Advance the physical animation. Returns a face map once the two-second throw has settled. */
  step(delta) {
    if (!this.roll) return null;
    const remaining = Math.max(0, 2 - this.roll.elapsed);
    const step = Math.min(delta, remaining);
    this.world.step(1 / 60, step, 4);
    this.roll.elapsed += step;
    if (this.roll.elapsed >= 1.68 && !this.roll.targets) {
      this.roll.targets = new Map(this.roll.ids.map(id => {
        const body = this.bodies[id], face = topFace(body);
        return [id, { face, quaternion: faceQuaternion(face) }];
      }));
    }
    if (this.roll.elapsed >= 1.68 && this.roll.targets) {
      const progress = Math.min(1, (this.roll.elapsed - 1.68) / .32);
      const blend = Math.min(1, progress * progress * (3 - 2 * progress) * .44);
      for (const id of this.roll.ids) {
        const body = this.bodies[id], target = this.roll.targets.get(id);
        blendQuaternion(body.quaternion, target.quaternion, blend);
        body.velocity.scale(.72, body.velocity);
        body.angularVelocity.scale(.68, body.angularVelocity);
        body.position.y += (HALF + .012 - body.position.y) * Math.min(.35, progress * .12);
        body.aabbNeedsUpdate = true;
      }
    }
    if (this.roll.elapsed < 2) return null;
    const faces = new Map();
    for (const id of this.roll.ids) {
      const body = this.bodies[id], target = this.roll.targets.get(id);
      faces.set(id, target.face);
      body.position.y = HALF + .012; body.quaternion.copy(target.quaternion);
      body.velocity.setZero(); body.angularVelocity.setZero(); body.force.setZero(); body.torque.setZero();
      body.aabbNeedsUpdate = true; body.sleep();
    }
    this.roll = null;
    return faces;
  }

  stashDie(id, rackIndex) {
    const body = this.bodies[id];
    body.type = CANNON.Body.STATIC; body.mass = 0; body.updateMassProperties();
    body.position.set(KEEP_X[rackIndex % KEEP_X.length], HALF + .012, 5.45);
    body.velocity.setZero(); body.angularVelocity.setZero(); body.force.setZero(); body.torque.setZero();
    body.aabbNeedsUpdate = true;
  }

  sync(meshes) {
    for (const body of this.bodies) {
      const mesh = meshes[body.dieId];
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    }
  }
}

