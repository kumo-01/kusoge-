// 三人称の追従カメラ（自分の車を後ろから滑らかに追いかける）
import * as THREE from 'three';
import { lerpAngle } from '../../core/util.js';
import { KART } from './constants.js';

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.h = 0;
    this.ready = false;
    this.shake = 0;
    this.fov = camera.fov;
    this._tmp = new THREE.Vector3();
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** target: { x, y, z, h, sp, boost } — h はスピンを含まない進行方向 */
  update(target, dt) {
    const sr = Math.min(1.4, Math.max(0, target.sp) / KART.MAX_SPEED);
    if (!this.ready) {
      this.h = target.h;
    } else {
      this.h = lerpAngle(this.h, target.h, 1 - Math.exp(-dt * 4.5));
    }
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const dist = 8 + sr * 1.6;
    const height = 3.8 + sr * 0.4;
    const desired = this._tmp.set(target.x - fx * dist, target.y * 0.5 + height, target.z - fz * dist);
    if (!this.ready) {
      this.pos.copy(desired);
      this.look.set(target.x + fx * 4, 1.2, target.z + fz * 4);
      this.ready = true;
    } else {
      this.pos.lerp(desired, 1 - Math.exp(-dt * 7));
      this.look.lerp(this._tmp.set(target.x + fx * 4, 1.2 + target.y * 0.4, target.z + fz * 4), 1 - Math.exp(-dt * 12));
    }
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0.01) {
      const s = this.shake * 0.5;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    this.shake *= Math.exp(-dt * 6);
    cam.lookAt(this.look);
    const fovTarget = 62 + sr * 6 + (target.boost > 0 ? 10 : 0);
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  reset() {
    this.ready = false;
  }
}
