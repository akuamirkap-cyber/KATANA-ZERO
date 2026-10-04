import * as THREE from 'three';
import { outlineMat } from './rig';

interface Ghost {
  root: THREE.Object3D;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  op: number;
}

/** Afterimages: frozen translucent snapshots of the fighter, left behind during dashes and sprints. */
export class Afterimages {
  private items: Ghost[] = [];

  constructor(
    private scene: THREE.Scene,
    private max = 4,
  ) {}

  snap(src: THREE.Object3D, color: number, opacity: number, dur: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false });
    const root = src.clone(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const old = m.material as THREE.Material;
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      // skip ink outlines and tiny details — keeps the ghost cheap and clean
      if (old === (outlineMat as THREE.Material) || old.side === THREE.BackSide || g.boundingSphere!.radius < 0.03) {
        m.visible = false;
        return;
      }
      m.material = mat;
      m.castShadow = false;
    });
    this.scene.add(root);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      o.matrixAutoUpdate = false;
    });
    this.items.push({ root, mat, t: 0, dur, op: opacity });
    while (this.items.length > this.max) this.drop(this.items.shift()!);
  }

  update(real: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += real;
      const f = it.t / it.dur;
      if (f >= 1) {
        this.drop(it);
        this.items.splice(i, 1);
        continue;
      }
      it.mat.opacity = it.op * Math.pow(1 - f, 1.6);
    }
  }

  private drop(g: Ghost) {
    this.scene.remove(g.root);
    g.mat.dispose();
  }

  dispose() {
    for (const g of this.items) this.drop(g);
    this.items.length = 0;
  }
}
