// 管理モード（ホストだけ）。準備画面でオンにして合言葉を入れると、ゲーム中に管理パネルが出る。
// この端末のこのタブの間だけ有効（タブを閉じると消える）。合言葉はおまけの鍵で、本当の守りは
// 「ホストの端末からしか操作を受け付けない」こと（サーバーもホストからの指示だけ受け付ける）。

const KEY = 'wanwan.admin';
const PASS = 'norainu';

export function isAdminOn() {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** 合言葉が合っていればオンにする。戻り値: オンになったか */
export function enableAdmin(pass) {
  if (String(pass || '').trim() !== PASS) return false;
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* 保存できなくても、このあとは使えないだけ */
    return false;
  }
  return true;
}

export function disableAdmin() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
