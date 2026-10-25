// カメラ: 三人称（自分の車を後ろから追いかける）と一人称（運転席の犬の目線）
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
    this.mode = 'third';
    this._tmp = new THREE.Vector3();
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /**
   * @param {{ x, y, z, h, sp, boost, st?, spinAngle? }} target h はスピンを含まない進行方向
   * @param {'third' | 'first'} mode
   */
  update(target, dt, mode = 'third') {
    if (mode !== this.mode) {
      this.mode = mode;
      this.ready = false;
    }
    const sr = Math.min(1.4, Math.max(0, target.sp) / KART.MAX_SPEED);
    const cam = this.camera;
    if (mode === 'first') {
      this._first(target, dt, sr);
    } else {
      this._third(target, dt, sr);
    }
    if (this.shake > 0.01) {
      const s = this.shake * (mode === 'first' ? 0.25 : 0.5);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    this.shake *= Math.exp(-dt * 6);
    const base = mode === 'first' ? 72 : 62;
    const fovTarget = base + sr * 6 + (target.boost > 0 ? 10 : 0);
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  _third(target, dt, sr) {
    if (!this.ready) this.h = target.h;
    else this.h = lerpAngle(this.h, target.h, 1 - Math.exp(-dt * 4.5));
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const dist = 8.5 + sr * 1.8;
    const height = 3.9 + sr * 0.4;
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
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
  }

  _first(target, dt, sr) {
    // スピン中は視界も少し回る（酔いすぎないよう 35% だけ）
    const yaw = target.h + (target.spinAngle || 0) * 0.35;
    if (!this.ready) this.h = yaw;
    else this.h = lerpAngle(this.h, yaw, 1 - Math.exp(-dt * 18));
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const cam = this.camera;
    // 運転席の犬の目の高さ
    cam.position.set(target.x + fx * 0.1, target.y + 1.95, target.z + fz * 0.1);
    this.look.set(target.x + fx * 12, target.y + 1.35, target.z + fz * 12);
    // ハンドルを切ると少し傾く
    const roll = -(target.st || 0) * sr * 0.06;
    cam.up.set(Math.cos(this.h) * roll, 1, -Math.sin(this.h) * roll).normalize();
    cam.lookAt(this.look);
    this.pos.copy(cam.position);
    this.ready = true;
  }

  reset() {
    this.ready = false;
  }
}
