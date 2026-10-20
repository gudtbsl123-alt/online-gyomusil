/**
 * Auth.gs — 로그인·본인 확인·관리자 확인
 *
 * 비밀번호를 두는 곳
 * - 공통 비밀번호·관리자 비밀번호: 스크립트 속성에 '해시'로만 저장한다. 원래 글자는 어디에도 남지 않는다.
 * - 개인 번호 4자리: 교직원 탭에 '사람마다 다른 솔트 + 비밀 값(PIN_PEPPER)'을 섞은 해시로만 저장한다.
 * - 로그인 상태: 서명한 표(토큰)를 브라우저가 들고 있다. 번호·비밀번호 자체는 브라우저에 저장하지 않는다.
 *
 * 스크립트 속성 이름
 *   SHEET_ID, PIN_PEPPER, TOKEN_SECRET,
 *   COMMON_PW_HASH, COMMON_PW_SALT, COMMON_PW_VER,
 *   ADMIN_PW_HASH, ADMIN_PW_SALT, ADMIN_PW_VER, ADMIN_FAILS, ADMIN_LOCK_UNTIL
 */

function fileMark_Auth_() { return '2026-10-16e'; } // 판 표시(관리자 › 점검)

var AUTH_LOGIN_HOURS_ = 12;   // '기억하기'를 끈 로그인·본인 확인이 유지되는 시간 (제안)
var AUTH_ADMIN_HOURS_ = 2;    // 관리자 화면이 열려 있는 시간 (제안)
var AUTH_MIN_PW_ = 6;         // 공통·관리자 비밀번호 최소 글자 수 (제안)

function props_() {
  return PropertiesService.getScriptProperties();
}

// ---------------------------------------------------------------- 스크립트 속성 읽기(하루 한도·속도, 2026-10-19a)
// 요청마다 3~5번 읽던 값(서명 비밀 값·비밀번호 판·해시·시트ID)은 서버 기억(CacheService)에 10분 두고, 없으면 getProperties 한 번으로 모두 읽는다.
// 바꿀 때는 propSet_로 바꿔 기억도 버린다. 틀린 횟수·잠금 같은 보안 숫자와 그 밖의 속성은 늘 속성에서 읽는다
var PROP_KEYS_ = ['SHEET_ID', 'PIN_PEPPER', 'TOKEN_SECRET', 'COMMON_PW_HASH', 'COMMON_PW_SALT', 'COMMON_PW_VER', 'ADMIN_PW_HASH', 'ADMIN_PW_SALT', 'ADMIN_PW_VER'];
var PROP_TTL_ = 600; // 초
var PROP_MEMO_ = null; // 한 요청 안에서 쓰는 값(api()가 요청마다 비운다)

function propsCache_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

function propsMemo_() {
  if (PROP_MEMO_) return PROP_MEMO_;
  var c = propsCache_(), got = null;
  if (c) { try { got = JSON.parse(c.get('gy:props') || 'null'); } catch (e) { got = null; } }
  if (!got || typeof got !== 'object') {
    var all = props_().getProperties() || {};
    got = {};
    PROP_KEYS_.forEach(function (k) { if (all[k] !== undefined && all[k] !== null && all[k] !== '') got[k] = String(all[k]); });
    if (c) { try { c.put('gy:props', JSON.stringify(got), PROP_TTL_); } catch (e) { /* 기억을 못 써도 속성에서 읽으면 된다 */ } }
  }
  PROP_MEMO_ = got;
  return got;
}

/** 스크립트 속성 한 칸: 자주 읽는 것(PROP_KEYS_)은 기억에서, 그 밖은 속성에서 */
function propGet_(name) {
  if (PROP_KEYS_.indexOf(name) < 0) return props_().getProperty(name);
  var m = propsMemo_();
  return Object.prototype.hasOwnProperty.call(m, name) ? m[name] : null;
}

/** 스크립트 속성 바꾸기. 자주 읽는 것이면 기억을 버려 다음 요청이 새 값을 읽게 한다 */
function propSet_(name, value) {
  props_().setProperty(name, String(value));
  if (PROP_KEYS_.indexOf(name) >= 0) propsForget_();
}

function propsForget_() {
  PROP_MEMO_ = null;
  var c = propsCache_();
  if (c) { try { c.remove('gy:props'); } catch (e) { /* 10분 안에 저절로 사라진다 */ } }
}

// ---------------------------------------------------------------- 해시·서명

function hex_(bytes) {
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function sha256Hex_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

/** 없으면 만들어 두는 비밀 값(설치할 때 한 번 생김) */
function secretProp_(name) {
  var v = propGet_(name);
  if (!v) {
    v = props_().getProperty(name); // 기억이 늦었을 수 있다: 속성에 이미 있으면 그대로 쓴다(새로 만들면 모든 로그인이 풀린다)
    if (!v) {
      v = Utilities.getUuid() + Utilities.getUuid();
      props_().setProperty(name, v);
    }
    propsForget_();
  }
  return v;
}

function sign_(body) {
  var sig = Utilities.computeHmacSha256Signature(body, secretProp_('TOKEN_SECRET'));
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

/** 같은 길이로 끝까지 비교 */
function sameText_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function makeToken_(payload) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return body + '.' + sign_(body);
}

function readToken_(token, kind) {
  if (!token || typeof token !== 'string' || token.length > 2000) return null;
  var i = token.lastIndexOf('.');
  if (i < 1) return null;
  var body = token.slice(0, i);
  if (!sameText_(sign_(body), token.slice(i + 1))) return null;
  var o;
  try {
    var pad = body + '===='.slice(0, (4 - body.length % 4) % 4);
    o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString('UTF-8'));
  } catch (e) {
    return null;
  }
  if (!o || o.k !== kind || !(o.exp > Date.now())) return null;
  return o;
}

// ---------------------------------------------------------------- 공통·관리자 비밀번호

function pwKey_(kind) {
  return kind === 'admin' ? 'ADMIN' : 'COMMON';
}

function hasPassword_(kind) {
  return !!propGet_(pwKey_(kind) + '_PW_HASH');
}

function pwHash_(pw, salt) {
  return sha256Hex_(secretProp_('PIN_PEPPER') + ':' + salt + ':' + pw);
}

/** 비밀번호 정하기. 버전이 올라가 예전 로그인은 모두 풀린다. */
function setPassword_(kind, pw) {
  pw = String(pw || '');
  if (pw.length < AUTH_MIN_PW_) throw userError_('비밀번호는 ' + AUTH_MIN_PW_ + '자 이상으로 정해 주세요.');
  if (pw.length > 64) throw userError_('비밀번호는 64자까지 정할 수 있어요.');
  var k = pwKey_(kind);
  var other = kind === 'admin' ? 'common' : 'admin';
  if (hasPassword_(other) && checkPassword_(other, pw)) {
    throw userError_('공통 비밀번호와 관리자 비밀번호는 서로 다르게 정해 주세요.');
  }
  var salt = Utilities.getUuid();
  var p = props_();
  var ver = Number(p.getProperty(k + '_PW_VER') || 0) + 1; // 바꿀 때는 기억이 아니라 속성에서
  p.setProperty(k + '_PW_SALT', salt);
  p.setProperty(k + '_PW_HASH', pwHash_(pw, salt));
  p.setProperty(k + '_PW_VER', String(ver));
  propsForget_(); // 예전 로그인이 다음 요청부터 바로 풀리게
  if (kind === 'admin') {
    p.setProperty('ADMIN_FAILS', '0');
    p.setProperty('ADMIN_LOCK_UNTIL', '0');
  }
}

function checkPassword_(kind, pw) {
  var k = pwKey_(kind);
  var hash = propGet_(k + '_PW_HASH');
  var salt = propGet_(k + '_PW_SALT');
  if (!hash || !salt) return false;
  return sameText_(pwHash_(String(pw || ''), salt), hash);
}

function pwVer_(kind) {
  return Number(propGet_(pwKey_(kind) + '_PW_VER') || 0);
}

// ---------------------------------------------------------------- 잠금 기준 (설정 탭)

function lockRule_() {
  return {
    tries: Math.max(1, Number(setting_('잠금 횟수')) || 5),
    minutes: Math.max(1, Number(setting_('잠금 분')) || 10)
  };
}

function rememberDays_() {
  return Math.max(1, Number(setting_('기기 기억 일수')) || 30);
}

function expiry_(remember, hours) {
  return Date.now() + (remember ? rememberDays_() * 24 : hours) * 3600 * 1000;
}

// ---------------------------------------------------------------- 1) 공통 로그인

// 웹앱 주소를 아는 누구나 공통 비밀번호를 넣어 볼 수 있으므로, 학교 전체에서 짧은 시간에 많이 틀리면 잠시 막는다.
// 이미 로그인된(기억된) 기기는 그대로 쓴다. 숫자는 서버 기억(CacheService)에 두는 어림값이다
var LOGIN_FAIL_WINDOW_ = 15 * 60; // 초
var LOGIN_FAIL_MAX_ = 20;          // 이 시간 안에 이만큼 틀리면 남은 시간 동안 막는다

/** 최근에 공통 비밀번호를 틀린 수 { n, at(처음 틀린 때) } */
function loginFails_() {
  try {
    var v = CacheService.getScriptCache().get('gy:pwfail');
    var f = v ? JSON.parse(v) : null;
    if (f && f.at && Date.now() - f.at < LOGIN_FAIL_WINDOW_ * 1000) return f;
  } catch (e) { /* 기억을 못 쓰면 막지 않는다 */ }
  return { n: 0, at: 0 };
}

function addLoginFail_() {
  try {
    var f = loginFails_();
    if (!f.at) f = { n: 0, at: Date.now() };
    f.n++;
    CacheService.getScriptCache().put('gy:pwfail', JSON.stringify(f), LOGIN_FAIL_WINDOW_);
    return f.n;
  } catch (e) {
    return 0;
  }
}

function login_(args) {
  if (!hasPassword_('common')) {
    throw userError_('아직 공통 비밀번호가 정해지지 않았어요. 연구부장·부담당에게 알려 주세요.', 'SETUP');
  }
  var f = loginFails_();
  if (f.n >= LOGIN_FAIL_MAX_) {
    var left = Math.max(1, Math.ceil((f.at + LOGIN_FAIL_WINDOW_ * 1000 - Date.now()) / 60000));
    throw userError_('비밀번호를 여러 번 틀린 기록이 있어서 로그인을 잠시 막았어요. ' + left + '분 뒤에 다시 해 주세요. 이미 로그인된 기기는 그대로 쓸 수 있어요.', 'LOCKED');
  }
  if (!checkPassword_('common', args.password)) {
    var n = addLoginFail_();
    if (n === LOGIN_FAIL_MAX_) {
      withLock_(function () {
        writeLog_({ id: '', name: '' }, '설정', '', '잠김', '공통 비밀번호를 ' + Math.round(LOGIN_FAIL_WINDOW_ / 60) + '분 안에 ' + n + '번 틀려서 새 로그인을 잠시 막음', null, null);
      });
    }
    Utilities.sleep(1200); // 하나씩 맞춰 보는 것을 느리게
    throw userError_('비밀번호가 맞지 않아요. 다시 넣어 주세요.', 'BADPW');
  }
  // '이름만' 방식에서는 공통 비밀번호를 기기에 기억해 둔다(기억 기간: 설정 '기기 기억 일수')
  var remember = !!args.remember || !pinMode_();
  return {
    login: makeToken_({ k: 'L', v: pwVer_('common'), exp: expiry_(remember, AUTH_LOGIN_HOURS_) }),
    remember: remember
  };
}

/** 본인 확인 방식: '이름만'(이름 고르기) 또는 '이름+개인 번호' — 설정 탭에서 바꾼다 */
function pinMode_() {
  return setting_('본인 확인 방식') === '이름+개인 번호';
}

function identityModeCode_() {
  return pinMode_() ? 'P' : 'N';
}

function checkLogin_(token) {
  var o = readToken_(token, 'L');
  return !!(o && o.v === pwVer_('common'));
}

// ---------------------------------------------------------------- 2) 본인 확인 (이름 + 개인 번호)

/** 이름 고르기 목록: 사용 중인 분만 */
function staffPicker_() {
  var depts = categoryNames_('부서');
  return sortStaff_(liveRows_('교직원').filter(function (r) { return r['사용 여부'] !== '사용 안 함'; }))
    .map(function (r) {
      return {
        id: r['교직원ID'],
        name: r['이름'],
        position: r['직위'],
        group: r['소속'],
        dept: depts[r['부서ID']] || '',
        hasPin: !!r['개인번호해시']
      };
    });
}

function sortStaff_(rows) {
  return rows.slice().sort(function (a, b) {
    var oa = Number(a['순서']) || 9999, ob = Number(b['순서']) || 9999;
    if (oa !== ob) return oa - ob;
    return String(a['이름']).localeCompare(String(b['이름']), 'ko');
  });
}

function pinHash_(pin, salt) {
  return sha256Hex_(secretProp_('PIN_PEPPER') + ':' + salt + ':' + pin);
}

function verifyPin_(args) {
  if (!pinMode_()) return pickName_(args);
  var staffId = String(args.staffId || '');
  var pin = String(args.pin || '');
  if (!/^\d{4}$/.test(pin)) throw userError_('개인 번호 4자리를 숫자로 넣어 주세요.', 'BADPIN');
  var remember = !!args.remember;
  var rule = lockRule_();

  var result = withLock_(function () {
    var row = findRow_('교직원', staffId);
    if (!row || row['삭제 여부'] || row['사용 여부'] === '사용 안 함') {
      throw userError_('명단에서 이름을 다시 골라 주세요.', 'NOTFOUND');
    }
    if (!row['개인번호해시']) {
      throw userError_('아직 개인 번호가 없어요. 연구부장·부담당에게 받아 주세요.', 'NOPIN');
    }
    var until = Number(row['잠금 해제 시각']) || 0;
    if (until > Date.now()) {
      var left = Math.ceil((until - Date.now()) / 60000);
      throw userError_('번호를 여러 번 틀려서 잠시 잠겼어요. ' + left + '분 뒤에 다시 해 주세요. 급하면 연구부장·부담당에게 알려 주세요.', 'LOCKED');
    }
    if (sameText_(pinHash_(pin, row['솔트']), row['개인번호해시'])) {
      if (row['틀린 횟수'] && row['틀린 횟수'] !== '0') setCellsNoLog_('교직원', row, { '틀린 횟수': '0', '잠금 해제 시각': '' });
      return { ok: true, row: row };
    }
    var fails = (Number(row['틀린 횟수']) || 0) + 1;
    if (fails >= rule.tries) {
      setCellsNoLog_('교직원', row, { '틀린 횟수': '0', '잠금 해제 시각': String(Date.now() + rule.minutes * 60000) });
      writeLog_({ id: row['교직원ID'], name: row['이름'] }, '교직원', row['교직원ID'], '잠김',
        '개인 번호를 ' + rule.tries + '번 틀려서 ' + rule.minutes + '분 잠김', null, null);
      return { ok: false, msg: '번호를 ' + rule.tries + '번 틀려서 ' + rule.minutes + '분 동안 잠겼어요. 잠시 뒤에 다시 해 주세요.', code: 'LOCKED' };
    }
    setCellsNoLog_('교직원', row, { '틀린 횟수': String(fails) });
    return { ok: false, msg: '번호가 맞지 않아요. 남은 기회는 ' + (rule.tries - fails) + '번이에요.', code: 'BADPIN' };
  });

  if (!result.ok) {
    Utilities.sleep(600);
    throw userError_(result.msg, result.code);
  }
  var row = result.row;
  var out = {
    identity: makeToken_({ k: 'I', m: 'P', s: row['교직원ID'], p: row['번호 바꾼 날'], exp: expiry_(remember, AUTH_LOGIN_HOURS_) }),
    me: meView_(row),
    remember: remember
  };
  // 기억하기를 켜면 공통 로그인도 같은 기간 동안 유지한다
  if (remember) out.login = makeToken_({ k: 'L', v: pwVer_('common'), exp: expiry_(true, AUTH_LOGIN_HOURS_) });
  return out;
}

/** '이름만' 방식: 명단에서 고른 이름으로 본인 확인(번호 없음). 기록에는 고른 이름으로 남는다. */
function pickName_(args) {
  var row = findRow_('교직원', String(args.staffId || ''));
  if (!row || row['삭제 여부'] || row['사용 여부'] === '사용 안 함') {
    throw userError_('명단에서 이름을 다시 골라 주세요.', 'NOTFOUND');
  }
  var remember = !!args.remember;
  var out = {
    identity: makeToken_({ k: 'I', m: 'N', s: row['교직원ID'], p: row['번호 바꾼 날'], exp: expiry_(remember, AUTH_LOGIN_HOURS_) }),
    me: meView_(row),
    remember: remember
  };
  if (remember) out.login = makeToken_({ k: 'L', v: pwVer_('common'), exp: expiry_(true, AUTH_LOGIN_HOURS_) });
  return out;
}

/** 본인 확인 표를 확인하고 교직원 행을 돌려준다. 번호를 다시 정했거나 사용 안 함이거나 확인 방식이 바뀌면 풀린다. */
function checkIdentity_(token) {
  var o = readToken_(token, 'I');
  if (!o) return null;
  if ((o.m || 'P') !== identityModeCode_()) return null;
  var row = findRow_('교직원', o.s);
  if (!row || row['삭제 여부'] || row['사용 여부'] === '사용 안 함') return null;
  if (String(row['번호 바꾼 날']) !== String(o.p)) return null;
  return row;
}

function meView_(row) {
  var depts = categoryNames_('부서');
  return {
    id: row['교직원ID'],
    name: row['이름'],
    position: row['직위'],
    group: row['소속'],
    dept: depts[row['부서ID']] || '',
    deptId: row['부서ID'] || '',
    role: row['역할'] || '일반'
  };
}

// ---------------------------------------------------------------- 3) 관리자

function adminLogin_(args, actor) {
  if (!hasPassword_('admin')) {
    throw userError_('아직 관리자 비밀번호가 정해지지 않았어요. 시트 메뉴 "온라인 교무실 > 관리자 비밀번호 정하기"에서 먼저 정해 주세요.', 'SETUP');
  }
  checkAdminPwCounted_(args.password, actor);
  return { admin: makeToken_({ k: 'A', v: pwVer_('admin'), exp: Date.now() + AUTH_ADMIN_HOURS_ * 3600 * 1000 }) };
}

/**
 * 관리자 비밀번호 확인(틀린 횟수를 세고 여러 번 틀리면 잠근다). 관리자 들어가기와 관리자 비밀번호 바꾸기에서 함께 쓴다.
 * 틀리면 오류를 던진다. 잠김 기록에는 고른 이름(있으면)을 남긴다
 */
function checkAdminPwCounted_(password, actor) {
  var rule = lockRule_();
  var p = props_();
  var who = actor && actor.name ? { id: actor.id || '', name: actor.name } : { id: '', name: '' };
  var res = withLock_(function () {
    var until = Number(p.getProperty('ADMIN_LOCK_UNTIL') || 0);
    if (until > Date.now()) {
      return { ok: false, code: 'LOCKED', msg: '관리자 비밀번호를 여러 번 틀려서 잠겼어요. ' + Math.ceil((until - Date.now()) / 60000) + '분 뒤에 다시 해 주세요.' };
    }
    if (checkPassword_('admin', password)) {
      p.setProperty('ADMIN_FAILS', '0');
      return { ok: true };
    }
    var fails = Number(p.getProperty('ADMIN_FAILS') || 0) + 1;
    if (fails >= rule.tries) {
      p.setProperty('ADMIN_FAILS', '0');
      p.setProperty('ADMIN_LOCK_UNTIL', String(Date.now() + rule.minutes * 60000));
      writeLog_(who, '설정', '', '잠김', '관리자 비밀번호를 ' + rule.tries + '번 틀려서 ' + rule.minutes + '분 잠김', null, null);
      return { ok: false, code: 'LOCKED', msg: '관리자 비밀번호를 ' + rule.tries + '번 틀려서 ' + rule.minutes + '분 동안 잠겼어요.' };
    }
    p.setProperty('ADMIN_FAILS', String(fails));
    return { ok: false, code: 'BADPW', msg: '관리자 비밀번호가 맞지 않아요. 남은 기회는 ' + (rule.tries - fails) + '번이에요.' };
  });
  if (!res.ok) {
    Utilities.sleep(1200);
    throw userError_(res.msg, res.code);
  }
}

function checkAdmin_(token) {
  var o = readToken_(token, 'A');
  return !!(o && o.v === pwVer_('admin'));
}

// ---------------------------------------------------------------- 개인 번호 만들기

/** 무작위 4자리. 쉬운 번호(0000, 1234 등)는 피한다. */
function newPin_() {
  var bad = { '0000': 1, '1111': 1, '2222': 1, '3333': 1, '4444': 1, '5555': 1, '6666': 1, '7777': 1, '8888': 1, '9999': 1, '1234': 1, '4321': 1, '0123': 1, '9876': 1 };
  for (var n = 0; n < 50; n++) {
    var hex = Utilities.getUuid().replace(/[^0-9a-f]/gi, '');
    var v = parseInt(hex.slice(0, 7), 16);
    if (v >= 268430000) continue; // 0~268429999 만 써서 10000으로 나눈 나머지가 고르게
    var pin = ('000' + (v % 10000)).slice(-4);
    if (!bad[pin]) return pin;
  }
  throw new Error('번호를 만들지 못했어요');
}

/** 번호를 새로 정한다. 원래 숫자는 돌려주기만 하고 어디에도 저장하지 않는다. */
function assignPin_(row, actor) {
  var pin = newPin_();
  var salt = Utilities.getUuid();
  setCellsNoLog_('교직원', row, {
    '개인번호해시': pinHash_(pin, salt),
    '솔트': salt,
    '틀린 횟수': '0',
    '잠금 해제 시각': '',
    '번호 바꾼 날': String(Date.now())
  });
  writeLog_(actor, '교직원', row['교직원ID'], '번호 다시 정함', row['이름'] + ' 선생님 개인 번호를 새로 만듦(번호는 기록하지 않음)', null, null);
  return pin;
}
