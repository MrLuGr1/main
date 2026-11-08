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

/** Full-window pixel field. Nearby pixels drift away from the pointer and softly return. */
export class AmbientPixels {
  constructor(canvas) {
    this.canvas=canvas;
    this.context=canvas.getContext('2d',{alpha:true});
    this.pixels=[];this.pointer={x:-1000,y:-1000,vx:0,vy:0,lastX:0,lastY:0,lastAt:0};this.width=0;this.height=0;
    this.palette=['#650000','#c30000','#b0aea8','#ffffff'];
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
    const count=Math.min(320,Math.max(130,Math.round(this.width*this.height/6500)));
    this.pixels=Array.from({length:count},()=>({x:Math.random()*this.width,y:Math.random()*this.height,vx:(Math.random()-.5)*12,vy:(Math.random()-.5)*12,size:2+Math.floor(Math.random()*3),color:this.palette[Math.floor(Math.random()*this.palette.length)],phase:Math.random()*7}));
  }

  update(dt) {
    const ctx=this.context;ctx.clearRect(0,0,this.width,this.height);
    const now=performance.now();
    const pointerSpeed=Math.min(1,Math.hypot(this.pointer.vx,this.pointer.vy)/1150);
    for(const pixel of this.pixels){
      const dx=pixel.x-this.pointer.x,dy=pixel.y-this.pointer.y,distance=Math.hypot(dx,dy)||1;
      if(distance<210){
        const influence=1-distance/210,force=influence*(90+pointerSpeed*680);
        pixel.vx+=(dx/distance*force+this.pointer.vx*.22*influence)*dt;
        pixel.vy+=(dy/distance*force+this.pointer.vy*.22*influence)*dt;
      }
      pixel.vx+=(Math.sin(pixel.phase+now*.00025)*4-pixel.vx)*dt*.18;
      pixel.vy+=(Math.cos(pixel.phase+now*.0002)*4-pixel.vy)*dt*.18;
      const speed=Math.hypot(pixel.vx,pixel.vy);
      if(speed>150){pixel.vx=pixel.vx/speed*150;pixel.vy=pixel.vy/speed*150;}
      pixel.x+=pixel.vx*dt;pixel.y+=pixel.vy*dt;
      if(pixel.x<-8)pixel.x=this.width+8;if(pixel.x>this.width+8)pixel.x=-8;
      if(pixel.y<-8)pixel.y=this.height+8;if(pixel.y>this.height+8)pixel.y=-8;
      ctx.globalAlpha=.13+.16*(.5+.5*Math.sin(now*.001+pixel.phase));
      ctx.fillStyle=pixel.color;ctx.fillRect(Math.round(pixel.x),Math.round(pixel.y),pixel.size,pixel.size);
    }
    ctx.globalAlpha=1;
    const decay=Math.exp(-dt*5.5);this.pointer.vx*=decay;this.pointer.vy*=decay;
  }
}

