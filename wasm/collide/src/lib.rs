//! いぬいぬゴム鉄砲バトルの当たり判定（線分と箱）。
//!
//! src/games/gomuBattle/arena.js の `segmentHit` と同じ計算を、同じ順番の浮動小数の演算で行う
//! （JavaScript と結果が 1 ビットも変わらないように。ホストとゲストで違う方を使っても、ずれない）。
//!
//! JavaScript からの使い方（src/games/gomuBattle/collide.js）:
//! 1. `boxes_ptr()` の場所に、箱を 6 つずつ（x0, x1, y0, y1, z0, z1）書きこむ（最大 `max_boxes()` 個）
//! 2. `set_world(箱の数, 部屋の幅, 部屋の奥行き)`
//! 3. `segment_hit(ax, ay, az, bx, by, bz, r)` → 当たった割合 t（0〜1。当たらなければ 1）。
//!    当たった面の向きは `out_ptr()` の場所に (nx, ny, nz)
#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

const MAX: usize = 1024;

static mut BOXES: [f64; MAX * 6] = [0.0; MAX * 6];
static mut N: usize = 0;
static mut ROOM_W: f64 = 0.0;
static mut ROOM_D: f64 = 0.0;
static mut FLOOR: f64 = 0.0;
static mut OUT: [f64; 3] = [0.0; 3];

/// 箱を書きこむ場所（f64 が 6 × max_boxes() 個）
#[no_mangle]
pub extern "C" fn boxes_ptr() -> *mut f64 {
    core::ptr::addr_of_mut!(BOXES) as *mut f64
}

/// 当たった面の向き (nx, ny, nz) が入る場所
#[no_mangle]
pub extern "C" fn out_ptr() -> *const f64 {
    core::ptr::addr_of!(OUT) as *const f64
}

#[no_mangle]
pub extern "C" fn max_boxes() -> u32 {
    MAX as u32
}

/// 箱の数と部屋の大きさ（床・まわりの壁）
#[no_mangle]
pub extern "C" fn set_world(n: u32, w: f64, d: f64) {
    unsafe {
        N = (n as usize).min(MAX);
        ROOM_W = w;
        ROOM_D = d;
    }
}

/// 床の高さ（くぼみがある会場では、いちばん深い所。丘・くぼみそのものは JavaScript で見る）
#[no_mangle]
pub extern "C" fn set_floor(y: f64) {
    unsafe {
        FLOOR = y;
    }
}

/// 線分 a → b（太さ r）が最初に何かに当たる割合 t（0〜1）。当たらなければ 1
#[no_mangle]
pub extern "C" fn segment_hit(ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64, r: f64) -> f64 {
    let (n, w, d, f) = unsafe { (N, ROOM_W, ROOM_D, FLOOR) };
    let boxes = unsafe { &*core::ptr::addr_of!(BOXES) };
    let (t, nrm) = hit_floor(&boxes[..n * 6], w, d, f, ax, ay, az, bx, by, bz, r);
    unsafe {
        OUT = nrm;
    }
    t
}

/// 計算の本体（テストからも呼べるように、静的な場所を使わない形）
#[allow(clippy::too_many_arguments)]
pub fn hit(boxes: &[f64], room_w: f64, room_d: f64, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64, r: f64) -> (f64, [f64; 3]) {
    hit_floor(boxes, room_w, room_d, 0.0, ax, ay, az, bx, by, bz, r)
}

/// 床の高さ floor つき
#[allow(clippy::too_many_arguments)]
pub fn hit_floor(boxes: &[f64], room_w: f64, room_d: f64, floor: f64, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64, r: f64) -> (f64, [f64; 3]) {
    let mut best = 1.0_f64;
    let mut n = [0.0_f64; 3];
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    // 床・壁: (向きの成分, 距離, 面の向き, 越える向き)
    let planes: [(f64, f64, [f64; 3], f64); 5] = [
        (dy, floor + r - ay, [0.0, 1.0, 0.0], -1.0), // 床 y = floor + r（下向きに越える）
        (dx, -room_w / 2.0 + r - ax, [1.0, 0.0, 0.0], -1.0),
        (dx, room_w / 2.0 - r - ax, [-1.0, 0.0, 0.0], 1.0),
        (dz, -room_d / 2.0 + r - az, [0.0, 0.0, 1.0], -1.0),
        (dz, room_d / 2.0 - r - az, [0.0, 0.0, -1.0], 1.0),
    ];
    for (dd, dist, nn, sign) in planes {
        if dd * sign <= 0.0 {
            continue; // 離れる向き
        }
        let t = dist / dd;
        if t >= 0.0 && t < best {
            best = t;
            n = nn;
        }
    }
    // 箱（太さ r だけ広げた箱と線分のスラブ法）
    let o = [ax, ay, az];
    let dv = [dx, dy, dz];
    for b in boxes.chunks_exact(6) {
        // b = [x0, x1, y0, y1, z0, z1]
        let mut t0 = 0.0_f64;
        let mut t1 = best;
        let mut hit_n: Option<[f64; 3]> = None;
        let mut ok = true;
        for k in 0..3 {
            if !ok {
                break;
            }
            let lo = b[k * 2] - r;
            let hi = b[k * 2 + 1] + r;
            let d = dv[k];
            if d.abs() < 1e-9 {
                if o[k] < lo || o[k] > hi {
                    ok = false;
                }
                continue;
            }
            let mut ta = (lo - o[k]) / d;
            let mut tb = (hi - o[k]) / d;
            let mut sgn = -1.0;
            if ta > tb {
                core::mem::swap(&mut ta, &mut tb);
                sgn = 1.0;
            }
            if ta > t0 {
                t0 = ta;
                let mut h = [0.0; 3];
                h[k] = sgn;
                hit_n = Some(h);
            }
            if tb < t1 {
                t1 = tb;
            }
            if t0 > t1 {
                ok = false;
            }
        }
        if let (true, Some(h)) = (ok, hit_n) {
            if t0 < best {
                best = t0;
                n = h;
            }
        }
    }
    (best, n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floor_and_box() {
        // 床へ落ちる
        let (t, n) = hit(&[], 10.0, 10.0, 0.0, 2.0, 0.0, 0.0, -2.0, 0.0, 0.0);
        assert!((t - 0.5).abs() < 1e-12);
        assert_eq!(n, [0.0, 1.0, 0.0]);
        // x = 1〜2 の箱へ横から
        let b = [1.0, 2.0, 0.0, 1.0, -1.0, 1.0];
        let (t, n) = hit(&b, 10.0, 10.0, 0.0, 0.5, 0.0, 4.0, 0.5, 0.0, 0.0);
        assert!((t - 0.25).abs() < 1e-12);
        assert_eq!(n, [-1.0, 0.0, 0.0]);
        // 当たらない
        let (t, _) = hit(&b, 10.0, 10.0, 0.0, 1.5, 0.0, 4.0, 1.5, 0.0, 0.0);
        assert_eq!(t, 1.0);
    }
}
