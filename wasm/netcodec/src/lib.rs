//! 通信の差分圧縮。src/core/netcodec.js の JavaScript 版と、同じ入力から 1 バイトも違わない結果を作る。
//!
//! 形: [varint: 元の長さ n] のあと、n バイトに届くまで
//!     [varint: 0 の数 z][varint: そのままのバイトの数 L][L バイト]
//! を繰り返す。中身は「今回のバイト列」と「相手が持っている前のバイト列（base）」の XOR（base が短ければ 0 と XOR）。
//! 毎回ほとんど変わらない配信は、XOR がほぼ 0 になるので、とても小さくなる。
//! そのままのバイトの並びは、0 が 2 つ続いたところで切る（0 が 1 つだけなら、並びに含めた方が小さい）。
//!
//! JavaScript からの使い方:
//!   base_ptr() に base、cur_ptr() に今回（またはデコードしたい圧縮データ）を書いて
//!   encode(base_len, cur_len) / decode(base_len, data_len) → out_ptr() に結果。戻り値は長さ（壊れていれば -1）
#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

const CAP: usize = 65536;
const OUT_CAP: usize = CAP + CAP / 2 + 16;

static mut BASE: [u8; CAP] = [0; CAP];
static mut CUR: [u8; CAP] = [0; CAP];
static mut OUT: [u8; OUT_CAP] = [0; OUT_CAP];

#[no_mangle]
pub extern "C" fn base_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(BASE) as *mut u8
}
#[no_mangle]
pub extern "C" fn cur_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(CUR) as *mut u8
}
#[no_mangle]
pub extern "C" fn out_ptr() -> *const u8 {
    core::ptr::addr_of!(OUT) as *const u8
}
#[no_mangle]
pub extern "C" fn cap() -> u32 {
    CAP as u32
}

fn put_varint(out: &mut [u8], mut o: usize, mut v: usize) -> usize {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out[o] = b;
            return o + 1;
        }
        out[o] = b | 0x80;
        o += 1;
    }
}

fn get_varint(d: &[u8], o: &mut usize) -> Option<usize> {
    let mut v: usize = 0;
    let mut shift = 0;
    loop {
        if *o >= d.len() || shift > 28 {
            return None;
        }
        let b = d[*o];
        *o += 1;
        v |= ((b & 0x7f) as usize) << shift;
        if b & 0x80 == 0 {
            return Some(v);
        }
        shift += 7;
    }
}

/// 差分を作る（純粋な関数。テストと WebAssembly の両方から使う）。out は cur.len() * 3 / 2 + 16 以上
pub fn encode_into(base: &[u8], cur: &[u8], out: &mut [u8]) -> usize {
    let n = cur.len();
    let x = |i: usize| -> u8 { cur[i] ^ if i < base.len() { base[i] } else { 0 } };
    let mut o = put_varint(out, 0, n);
    let mut i = 0;
    while i < n {
        let z0 = i;
        while i < n && x(i) == 0 {
            i += 1;
        }
        let z = i - z0;
        let l0 = i;
        while i < n {
            if x(i) == 0 && (i + 1 >= n || x(i + 1) == 0) {
                break;
            }
            i += 1;
        }
        let l = i - l0;
        o = put_varint(out, o, z);
        o = put_varint(out, o, l);
        for k in l0..i {
            out[o] = x(k);
            o += 1;
        }
    }
    o
}

/// 差分から元に戻す。壊れていれば None
pub fn decode_into(base: &[u8], data: &[u8], out: &mut [u8]) -> Option<usize> {
    let mut o = 0usize;
    let n = get_varint(data, &mut o)?;
    if n > out.len() {
        return None;
    }
    let mut i = 0usize;
    while i < n {
        let z = get_varint(data, &mut o)?;
        let l = get_varint(data, &mut o)?;
        if z + l == 0 || i + z + l > n || o + l > data.len() {
            return None;
        }
        for _ in 0..z {
            out[i] = if i < base.len() { base[i] } else { 0 };
            i += 1;
        }
        for k in 0..l {
            out[i] = data[o + k] ^ if i < base.len() { base[i] } else { 0 };
            i += 1;
        }
        o += l;
    }
    if o != data.len() {
        return None;
    }
    Some(n)
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn encode(base_len: u32, cur_len: u32) -> i32 {
    let (b, c) = (base_len as usize, cur_len as usize);
    if b > CAP || c > CAP {
        return -1;
    }
    unsafe { encode_into(&BASE[..b], &CUR[..c], &mut OUT) as i32 }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn decode(base_len: u32, data_len: u32) -> i32 {
    let (b, d) = (base_len as usize, data_len as usize);
    if b > CAP || d > CAP {
        return -1;
    }
    unsafe {
        match decode_into(&BASE[..b], &CUR[..d], &mut OUT[..CAP]) {
            Some(n) => n as i32,
            None => -1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let base: Vec<u8> = (0..300u32).map(|i| (i * 7) as u8).collect();
        let mut cur = base.clone();
        cur[5] ^= 1;
        cur[100] = 0;
        cur.push(9);
        let mut out = vec![0u8; 1000];
        let n = encode_into(&base, &cur, &mut out);
        assert!(n < 20);
        let mut back = vec![0u8; 1000];
        let m = decode_into(&base, &out[..n], &mut back).unwrap();
        assert_eq!(&back[..m], &cur[..]);
        let n2 = encode_into(&[], &cur, &mut out);
        let m2 = decode_into(&[], &out[..n2], &mut back).unwrap();
        assert_eq!(&back[..m2], &cur[..]);
    }
}
