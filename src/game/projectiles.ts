import * as THREE from 'three';

export type ProjKind = 'arrow' | 'bullet';

export interface Proj {
  kind: ProjKind;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  owner: number;
  reflected: boolean;
  /** batted back by a blade: kills whatever it reaches */
  lethal: boolean;
  life: number;
  dmg: number;
  post: number;
  stuck: boolean;
  whooshed: boolean;
}

const Z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();

/** Arrows (arcing, visible shafts) and matchlock bullets (fast, with a thin tracer). */
export class Projectiles {
  items: Proj[] = [];
  private arrow = new THREE.Group();
  private bullet = new THREE.Group();

  constructor(private scene: THREE.Scene) {
    const wood = new THREE.MeshStandardMaterial({ color: 0xb89a62, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xaab0ba, roughness: 0.3, metalness: 0.8 });
    const vane = new THREE.MeshStandardMaterial({ color: 0xcc3a2a, roughness: 0.8, side: THREE.DoubleSide });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.0, 6), wood);
    shaft.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6), steel);
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.54;
    this.arrow.add(shaft, head);
    for (let k = 0; k < 3; k++) {
      const g = new THREE.Group();
      g.rotation.z = (k * Math.PI * 2) / 3;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.05), vane);
      pl.rotation.y = Math.PI / 2;
      pl.position.set(0, 0.03, -0.42);
      g.add(pl);
      this.arrow.add(g);
    }

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2b8 }));
    const tracer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.003, 1.5, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffb060,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    tracer.rotation.x = Math.PI / 2;
    tracer.position.z = -0.75;
    this.bullet.add(core, tracer);
  }

  spawn(kind: ProjKind, pos: THREE.Vector3, vel: THREE.Vector3, owner: number, dmg: number, post: number): Proj {
    const mesh = (kind === 'arrow' ? this.arrow : this.bullet).clone(true);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(Z, _d.copy(vel).normalize());
    this.scene.add(mesh);
    const p: Proj = {
      kind,
      mesh,
      pos: pos.clone(),
      prev: pos.clone(),
      vel: vel.clone(),
      owner,
      reflected: false,
      lethal: false,
      life: 3.2,
      dmg,
      post,
      stuck: false,
      whooshed: false,
    };
    this.items.push(p);
    return p;
  }

  update(dt: number) {
    for (const p of this.items) {
      if (p.stuck) {
        p.life -= dt;
        continue;
      }
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      if (p.kind === 'arrow') p.vel.y -= 1.8 * dt;
      p.life -= dt;
      p.mesh.position.copy(p.pos);
      if (p.vel.lengthSq() > 1e-4) p.mesh.quaternion.setFromUnitVectors(Z, _d.copy(p.vel).normalize());
    }
  }

  remove(p: Proj) {
    const i = this.items.indexOf(p);
    if (i >= 0) this.items.splice(i, 1);
    this.scene.remove(p.mesh);
  }

  dispose() {
    for (const p of this.items.slice()) this.remove(p);
  }
}
