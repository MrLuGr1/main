// Cannon-es dice simulation. A roll is visually simulated for exactly two seconds, then damped onto a readable face.
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

const DIE_SIZE = .9;
const HALF = DIE_SIZE / 2;
const GRAVITY = 19;
const KEEP_SPACING = 1.7;
const KEEP_CENTER = 7.4;
function keptPosition(index) {
  // The diagonal row is outside the board in world space and its full
  // projection remains beyond the board silhouette in the isometric view.
  const offset=(index-2.5)*KEEP_SPACING/Math.SQRT2;
  return {x:KEEP_CENTER+offset,z:KEEP_CENTER-offset};
}
const THROW_POWER = { low: .62, medium: 1, high: 1.42 };
const REST_GAP = 1.32;

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
    this.world.solver.iterations = 16;
    this.world.solver.tolerance = .001;
    this.diceMaterial = new CANNON.Material('ivory-dice');
    this.tableMaterial = new CANNON.Material('felt-table');
    this.world.defaultContactMaterial.friction = .38;
    this.world.defaultContactMaterial.restitution = .2;
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.diceMaterial, this.tableMaterial, { friction: .48, restitution: .22 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.diceMaterial, this.diceMaterial, { friction: .34, restitution: .08 }));
    this.bodies = [];
    this.stashTransitions = new Map();
    this.roll = null;
    this.addTable();
    for (let i = 0; i < count; i++) this.addDie(i);
  }

  addTable() {
    const ground = new CANNON.Body({ mass: 0, material: this.tableMaterial, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    const addWall = (x, z, halfX, halfZ) => {
      // Tall, thick walls stop even high-power throws from hopping over the board edge.
      const wall = new CANNON.Body({ mass: 0, material: this.tableMaterial, position: new CANNON.Vec3(x, 2.9, z) });
      wall.addShape(new CANNON.Box(new CANNON.Vec3(halfX, 3, halfZ)));
      this.world.addBody(wall);
    };
    // Physical bounds match the 100 × 150 cm rectangular table in game.js.
    addWall(-4.88, 0, .12, 7.35); addWall(4.88, 0, .12, 7.35);
    addWall(0, -7.35, 4.9, .12); addWall(0, 7.35, 4.9, .12);
  }

  addDie(id) {
    const rack=keptPosition(id);
    const body = new CANNON.Body({
      mass: 0, type: CANNON.Body.STATIC, material: this.diceMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
      position: new CANNON.Vec3(rack.x, HALF + .012, rack.z), allowSleep: true,
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
      this.stashTransitions.delete(id);
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

  /** Pick nearby, non-overlapping flat landing points for any dice that were stacked. */
  resolveLandingPositions(ids) {
    const active=new Set(ids);
    // Reserve the rack positions of dice kept from previous rolls in this turn.
    const occupied=this.bodies
      .filter(body=>!active.has(body.dieId)&&body.type===CANNON.Body.STATIC)
      .map(body=>({x:body.position.x,z:body.position.z}));
    const resolved=new Map();
    const xSlots=[];const zSlots=[];
    for(let x=-4.05;x<=4.051;x+=REST_GAP)xSlots.push(x);
    for(let z=-6.4;z<=6.401;z+=REST_GAP)zSlots.push(z);
    const order=[...ids].sort((a,b)=>this.bodies[a].position.y-this.bodies[b].position.y);
    for(const id of order){
      const body=this.bodies[id];
      const original={x:Math.max(-4.05,Math.min(4.05,body.position.x)),z:Math.max(-6.4,Math.min(6.4,body.position.z))};
      const candidates=[original];
      for(const x of xSlots)for(const z of zSlots)candidates.push({x,z});
      candidates.sort((a,b)=>(a.x-original.x)**2+(a.z-original.z)**2-((b.x-original.x)**2+(b.z-original.z)**2));
      const spot=candidates.find(candidate=>occupied.every(other=>Math.abs(candidate.x-other.x)>=REST_GAP||Math.abs(candidate.z-other.z)>=REST_GAP))||original;
      occupied.push(spot);resolved.set(id,new CANNON.Vec3(spot.x,HALF+.012,spot.z));
    }
    return resolved;
  }

  /** Advance the physical animation. Returns a face map once the two-second throw has settled. */
  step(delta) {
    if (!this.roll) return null;
    const remaining = Math.max(0, 2 - this.roll.elapsed);
    const step = Math.min(delta, remaining);
    this.world.step(1 / 120, step, 12);
    this.roll.elapsed += step;
    if (this.roll.elapsed >= 1.68 && !this.roll.targets) {
      const landing=this.resolveLandingPositions(this.roll.ids);
      this.roll.targets = new Map(this.roll.ids.map(id => {
        const body = this.bodies[id], face = topFace(body);
        return [id, { face, quaternion: faceQuaternion(face), position:landing.get(id), fromPosition:body.position.clone(), fromQuaternion:body.quaternion.clone() }];
      }));
    }
    if (this.roll.elapsed >= 1.68 && this.roll.targets) {
      const progress = Math.min(1, (this.roll.elapsed - 1.68) / .32);
      const blend = progress * progress * (3 - 2 * progress);
      for (const id of this.roll.ids) {
        const body = this.bodies[id], target = this.roll.targets.get(id);
        body.quaternion.copy(target.fromQuaternion);
        blendQuaternion(body.quaternion, target.quaternion, blend);
        body.position.set(
          target.fromPosition.x+(target.position.x-target.fromPosition.x)*blend,
          target.fromPosition.y+(target.position.y-target.fromPosition.y)*blend,
          target.fromPosition.z+(target.position.z-target.fromPosition.z)*blend,
        );
        body.velocity.scale(.55, body.velocity);
        body.angularVelocity.scale(.45, body.angularVelocity);
        body.aabbNeedsUpdate = true;
      }
    }
    if (this.roll.elapsed < 2) return null;
    const faces = new Map();
    for (const id of this.roll.ids) {
      const body = this.bodies[id], target = this.roll.targets.get(id);
      faces.set(id, target.face);
      body.position.copy(target.position); body.quaternion.copy(target.quaternion);
      body.velocity.setZero(); body.angularVelocity.setZero(); body.force.setZero(); body.torque.setZero();
      body.aabbNeedsUpdate = true; body.sleep();
    }
    this.roll = null;
    return faces;
  }

  stashDie(id, rackIndex) {
    const body = this.bodies[id];
    body.type = CANNON.Body.STATIC; body.mass = 0; body.updateMassProperties();
    const from=body.position.clone();
    const rack=keptPosition(rackIndex);
    const to=new CANNON.Vec3(rack.x, HALF + .012, rack.z);
    this.stashTransitions.set(id,{from,to,elapsed:0,duration:.38});
    body.velocity.setZero(); body.angularVelocity.setZero(); body.force.setZero(); body.torque.setZero();
    body.aabbNeedsUpdate = true;
  }

  updateStashes(delta){
    for(const [id,transition] of this.stashTransitions){
      transition.elapsed=Math.min(transition.duration,transition.elapsed+delta);
      const t=transition.elapsed/transition.duration,eased=t*t*(3-2*t),body=this.bodies[id];
      body.position.set(
        transition.from.x+(transition.to.x-transition.from.x)*eased,
        transition.from.y+(transition.to.y-transition.from.y)*eased,
        transition.from.z+(transition.to.z-transition.from.z)*eased,
      );
      body.aabbNeedsUpdate=true;
      if(t>=1){body.position.copy(transition.to);this.stashTransitions.delete(id);}
    }
  }

  sync(meshes) {
    for (const body of this.bodies) {
      const mesh = meshes[body.dieId];
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    }
  }
}

