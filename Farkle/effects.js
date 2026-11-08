// Small GPU point bursts for wins, hot dice and farkles; effects are discarded when their lifetime ends.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

export class ParticleEffects {
  constructor(scene) { this.scene = scene; this.bursts = []; }

  burst(color = '#ffffff', count = 42, origin = new THREE.Vector3(0, .5, 0)) {
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

/** Pixel sparks hover above every scoring die in Easy mode. */
export class ScoringFlames {
  constructor(dieMeshes) {
    this.targets=Array(dieMeshes.length).fill(false);
    this.enabled=false;
    this.particlesPerDie=18;
    const flameMap=this.createPixelMap();
    this.groups=dieMeshes.map(mesh=>{
      mesh.geometry.computeBoundingBox();
      const bounds=mesh.geometry.boundingBox;
      const size=bounds.getSize(new THREE.Vector3());
      const center=bounds.getCenter(new THREE.Vector3());
      const positions=new Float32Array(this.particlesPerDie*3);
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const material=new THREE.PointsMaterial({
        color:'#808080',map:flameMap,size:.22,sizeAttenuation:true,transparent:true,opacity:.5,
        depthWrite:false,toneMapped:false,blending:THREE.CustomBlending,
        // Destination-aware screen blend brightens dark pixels and shifts with the felt beneath it.
        blendEquation:THREE.AddEquation,blendSrc:THREE.OneMinusDstColorFactor,blendDst:THREE.OneFactor,
      });
      const points=new THREE.Points(geometry,material);
      points.position.set(center.x,bounds.max.y+.05,center.z);
      points.frustumCulled=false;points.renderOrder=4;points.visible=false;mesh.add(points);
      return {
        points,
        particles:Array.from({length:this.particlesPerDie},()=>({
          x:(Math.random()-.5)*size.x*.38,z:(Math.random()-.5)*size.z*.38,phase:Math.random(),speed:.72+Math.random()*.65,
        })),
      };
    });
  }

  createPixelMap() {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=8;
    const ctx=canvas.getContext('2d');
    const rows=['...#....','..###...','.#####..','#######.','########','########','..####..','...##...'];
    const colors=['#ffffff','#ffffff','#b0aea8','#c30000','#c30000','#650000','#c30000','#b0aea8'];
    rows.forEach((row,y)=>[...row].forEach((pixel,x)=>{if(pixel==='#'){ctx.fillStyle=colors[y];ctx.fillRect(x,y,1,1);}}));
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;
    return texture;
  }

  setTargets(targets, enabled) {
    this.enabled=enabled;
    targets.forEach((target,index)=>{this.targets[index]=Boolean(target);});
  }

  update(_delta, time) {
    this.groups.forEach((group,index)=>{
      const visible=this.enabled&&this.targets[index];
      group.points.visible=visible;
      if(!visible)return;
      const values=group.points.geometry.attributes.position.array;
      group.particles.forEach((particle,particleIndex)=>{
        const life=(time*particle.speed+particle.phase)%1;
        const flicker=Math.sin(life*Math.PI*2+particle.phase*8)*.035;
        values[particleIndex*3]=particle.x+flicker;
        values[particleIndex*3+1]=.08+life*.58;
        values[particleIndex*3+2]=particle.z+Math.cos(life*Math.PI*2+particle.phase*8)*.035;
      });
      group.points.geometry.attributes.position.needsUpdate=true;
    });
  }
}

/** Full-window pixel field. Nearby pixels drift away from the pointer and softly return. */
export class AmbientPixels {
  constructor(canvas) {
    this.canvas=canvas;
    this.context=canvas.getContext('2d',{alpha:true});
    this.pixels=[];this.pointer={x:-1000,y:-1000,vx:0,vy:0,lastX:0,lastY:0,lastAt:0};this.width=0;this.height=0;
    this.palette=['#c30000','#b0aea8','#ffffff','#ffffff'];
    this.resize=()=>this.setSize();
    addEventListener('resize',this.resize,{passive:true});
    addEventListener('pointermove',event=>{
      const now=performance.now(),x=event.clientX,y=event.clientY,elapsed=(now-this.pointer.lastAt)/1000;
      if(elapsed>.001&&elapsed<.12){
        this.pointer.vx=Math.max(-2200,Math.min(2200,(x-this.pointer.lastX)/elapsed));
        this.pointer.vy=Math.max(-2200,Math.min(2200,(y-this.pointer.lastY)/elapsed));
      }
      this.pointer.x=x;this.pointer.y=y;this.pointer.lastX=x;this.pointer.lastY=y;this.pointer.lastAt=now;
    },{passive:true});
    this.setSize();
  }

  setSize() {
    const ratio=Math.min(devicePixelRatio||1,1.5);
    this.width=innerWidth;this.height=innerHeight;
    this.canvas.width=Math.round(this.width*ratio);this.canvas.height=Math.round(this.height*ratio);
    this.context.setTransform(ratio,0,0,ratio,0,0);
    const count=Math.min(760,Math.max(300,Math.round(this.width*this.height/3200)));
    this.pixels=Array.from({length:count},()=>({x:Math.random()*this.width,y:Math.random()*this.height,vx:(Math.random()-.5)*26,vy:(Math.random()-.5)*26,size:3+Math.floor(Math.random()*4),color:this.palette[Math.floor(Math.random()*this.palette.length)],phase:Math.random()*7}));
  }

  update(dt) {
    const ctx=this.context;ctx.clearRect(0,0,this.width,this.height);
    const now=performance.now();
    const pointerSpeed=Math.min(1,Math.hypot(this.pointer.vx,this.pointer.vy)/850);
    for(const pixel of this.pixels){
      const dx=pixel.x-this.pointer.x,dy=pixel.y-this.pointer.y,distance=Math.hypot(dx,dy)||1;
      if(distance<270){
        const influence=1-distance/270,force=influence*(220+pointerSpeed*1250);
        pixel.vx+=(dx/distance*force+this.pointer.vx*.32*influence)*dt;
        pixel.vy+=(dy/distance*force+this.pointer.vy*.32*influence)*dt;
      }
      pixel.vx+=(Math.sin(pixel.phase+now*.00045)*10-pixel.vx)*dt*.11;
      pixel.vy+=(Math.cos(pixel.phase+now*.0004)*10-pixel.vy)*dt*.11;
      const speed=Math.hypot(pixel.vx,pixel.vy);
      if(speed>300){pixel.vx=pixel.vx/speed*300;pixel.vy=pixel.vy/speed*300;}
      pixel.x+=pixel.vx*dt;pixel.y+=pixel.vy*dt;
      if(pixel.x<-8)pixel.x=this.width+8;if(pixel.x>this.width+8)pixel.x=-8;
      if(pixel.y<-8)pixel.y=this.height+8;if(pixel.y>this.height+8)pixel.y=-8;
      ctx.globalAlpha=.42+.32*(.5+.5*Math.sin(now*.0016+pixel.phase));
      ctx.fillStyle=pixel.color;ctx.fillRect(Math.round(pixel.x),Math.round(pixel.y),pixel.size,pixel.size);
    }
    ctx.globalAlpha=1;
    const decay=Math.exp(-dt*5.5);this.pointer.vx*=decay;this.pointer.vy*=decay;
  }
}

