/**
 * test.js — 서버 코드 자동 시험 (node tools/test.js)
 * 가짜 시트에서 1단계 완료 기준과 보안 규칙을 확인한다.
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadGas, GAS_FILES, GAS_DIR } = require('./load-gas.js');
const GasMock = require('./gas-mock.js');

let passed = 0;
const results = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    results.push('  ✓ ' + name);
  } catch (e) {
    results.push('  ✗ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e));
    process.exitCode = 1;
  }
}

const COMMON = 'common-pass-1';
const ADMIN = 'admin-pass-1';

/** 처음 설정 + 비밀번호 + 가짜 교직원(번호 1111)까지 마친 환경 */
function fresh(withUi) {
  const g = loadGas({ ui: withUi ? fakeUi() : null });
  g.setupAll_();
  g.setPassword_('common', COMMON);
  g.setPassword_('admin', ADMIN);
  g.seedTestData_('1111');
  return g;
}

function fakeUi() {
  return { alert: () => {}, showModalDialog: () => {}, ButtonSet: {}, Button: {}, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) };
}

/** 화면이 하는 것처럼 api()를 부른다 */
function call(g, action, args, tokens) {
  return JSON.parse(g.api(JSON.stringify({ action, args: args || {}, tokens: tokens || {} })));
}

function loginAll(g) {
  const L = call(g, 'login', { password: COMMON }).data.login;
  const staff = call(g, 'staffPicker', {}, { login: L }).data;
  return { L, staff };
}

/** vm 안에서 만든 값을 바깥 값으로 */
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

function sheetDump(g) {
  return JSON.stringify(g._ss.sheets.map((s) => [s.name, s.data]));
}

// ---------------------------------------------------------------- 시험

test('SHA-256·HMAC 가짜 구현이 Node crypto와 같다', () => {
  for (const s of ['', 'abc', '한글 비밀번호', 'x'.repeat(200)]) {
    assert.strictEqual(GasMock.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
    assert.strictEqual(GasMock.hmacHex('키' + s, s), crypto.createHmac('sha256', Buffer.from('키' + s, 'utf8')).update(s, 'utf8').digest('hex'));
  }
});

test('처음 설정: 탭 11개와 머리글, 설정 기본값을 만든다', () => {
  const g = loadGas();
  const r = g.setupAll_();
  assert.strictEqual(r.created.length, 11);
  const names = g._ss.sheets.map((s) => s.name);
  for (const t of Object.keys(g.tabs_())) assert.ok(names.includes(t), t);
  assert.deepStrictEqual(plain(g.headOf_('교직원')), plain(g.tabs_()['교직원']));
  assert.strictEqual(g.setting_('잠금 횟수'), '5');
  assert.strictEqual(g.setting_('잠금 분'), '10');
  assert.strictEqual(g.setting_('기기 기억 일수'), '30');
  assert.strictEqual(g.setting_('백업 남길 개수'), '30');
});

test('처음 설정을 두 번 눌러도 데이터와 칸이 그대로다', () => {
  const g = fresh();
  const before = g.readRows_('교직원').length;
  const r = g.setupAll_();
  assert.strictEqual(r.created.length, 0);
  assert.strictEqual(g.readRows_('교직원').length, before);
  assert.strictEqual(g.readRows_('설정').filter((x) => x['키'] === '학년도').length, 1);
});

test('처음 설정은 없어진 칸만 끝에 더한다(기존 칸 순서는 그대로)', () => {
  const g = loadGas();
  g.setupAll_();
  const sh = g._ss.getSheetByName('도움말');
  sh.data[0] = sh.data[0].slice(0, 3); // 칸 일부가 없어진 상황
  const r = g.setupAll_();
  assert.ok(r.extended.includes('도움말'));
  assert.deepStrictEqual(plain(g.headOf_('도움말').slice(0, 3)), ['항목ID', '분류ID', '제목']);
  assert.strictEqual(g.headOf_('도움말').length, g.tabs_()['도움말'].length);
});

test('공통 비밀번호: 틀리면 거절, 맞으면 로그인 표를 준다', () => {
  const g = fresh();
  const bad = call(g, 'login', { password: 'wrong' });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'BADPW');
  const ok = call(g, 'login', { password: COMMON });
  assert.strictEqual(ok.ok, true);
  assert.ok(ok.data.login);
});

test('로그인 없이는 명단·관리자 요청이 막힌다', () => {
  const g = fresh();
  assert.strictEqual(call(g, 'staffPicker').code, 'LOGIN');
  assert.strictEqual(call(g, 'admin.staff.list').code, 'LOGIN');
  assert.strictEqual(call(g, 'staffPicker', {}, { login: 'aaa.bbb' }).code, 'LOGIN');
});

test('로그인 표를 고쳐 쓰면(위조) 거절된다', () => {
  const g = fresh();
  const { L } = loginAll(g);
  const [body] = L.split('.');
  const forged = body + '.' + 'A'.repeat(43);
  assert.strictEqual(call(g, 'staffPicker', {}, { login: forged }).code, 'LOGIN');
});

test('본인 확인: 이름 + 번호가 맞으면 본인 확인됨', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  assert.strictEqual(staff.length, 8);
  const r = call(g, 'verify', { staffId: staff[0].id, pin: '1111' }, { login: L });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.data.me.name, '홍길동');
  const s = call(g, 'session', {}, { login: L, identity: r.data.identity });
  assert.strictEqual(s.data.me.name, '홍길동');
});

test('번호를 5번 틀리면 10분 잠기고, 잠긴 동안은 맞는 번호도 안 된다', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const id = staff[1].id;
  for (let i = 1; i <= 4; i++) {
    const r = call(g, 'verify', { staffId: id, pin: '9999' }, { login: L });
    assert.strictEqual(r.code, 'BADPIN');
    assert.ok(r.error.includes('남은 기회는 ' + (5 - i) + '번'), r.error);
  }
  const fifth = call(g, 'verify', { staffId: id, pin: '9999' }, { login: L });
  assert.strictEqual(fifth.code, 'LOCKED');
  assert.strictEqual(call(g, 'verify', { staffId: id, pin: '1111' }, { login: L }).code, 'LOCKED');
  g.__clock.offset = 9 * 60 * 1000;
  assert.strictEqual(call(g, 'verify', { staffId: id, pin: '1111' }, { login: L }).code, 'LOCKED');
  g.__clock.offset = 10 * 60 * 1000 + 1000;
  assert.strictEqual(call(g, 'verify', { staffId: id, pin: '1111' }, { login: L }).ok, true);
  assert.ok(g.readRows_('기록').some((r) => r['동작'] === '잠김'));
});

test('잠금 기준을 설정에서 바꾸면 그대로 따른다(3번)', () => {
  const g = fresh();
  g.putSetting_('잠금 횟수', '3', { id: '', name: '시험' });
  const { L, staff } = loginAll(g);
  call(g, 'verify', { staffId: staff[2].id, pin: '0000' }, { login: L });
  call(g, 'verify', { staffId: staff[2].id, pin: '0000' }, { login: L });
  assert.strictEqual(call(g, 'verify', { staffId: staff[2].id, pin: '0000' }, { login: L }).code, 'LOCKED');
});

test('맞히면 틀린 횟수가 0으로 돌아간다', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const id = staff[3].id;
  for (let i = 0; i < 4; i++) call(g, 'verify', { staffId: id, pin: '9999' }, { login: L });
  assert.strictEqual(call(g, 'verify', { staffId: id, pin: '1111' }, { login: L }).ok, true);
  for (let i = 0; i < 4; i++) assert.strictEqual(call(g, 'verify', { staffId: id, pin: '9999' }, { login: L }).code, 'BADPIN');
});

test('기억하기를 켜면 30일, 끄면 12시간 유지된다', () => {
  const g = fresh();
  const short = call(g, 'login', { password: COMMON }).data.login;
  const long = call(g, 'login', { password: COMMON, remember: true }).data.login;
  g.__clock.offset = 13 * 3600 * 1000;
  assert.strictEqual(call(g, 'staffPicker', {}, { login: short }).code, 'LOGIN');
  assert.strictEqual(call(g, 'staffPicker', {}, { login: long }).ok, true);
  g.__clock.offset = 29 * 24 * 3600 * 1000;
  assert.strictEqual(call(g, 'staffPicker', {}, { login: long }).ok, true);
  g.__clock.offset = 31 * 24 * 3600 * 1000;
  assert.strictEqual(call(g, 'staffPicker', {}, { login: long }).code, 'LOGIN');
});

test('본인 확인 때 기억하기를 켜면 공통 로그인도 30일 유지된다', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const r = call(g, 'verify', { staffId: staff[0].id, pin: '1111', remember: true }, { login: L }).data;
  assert.ok(r.login, '긴 로그인 표가 와야 함');
  g.__clock.offset = 20 * 24 * 3600 * 1000;
  assert.strictEqual(call(g, 'staffPicker', {}, { login: L }).code, 'LOGIN');
  assert.strictEqual(call(g, 'session', {}, { login: r.login, identity: r.identity }).data.me.name, '홍길동');
  const n = call(g, 'verify', { staffId: staff[1].id, pin: '1111' }, { login: r.login }).data;
  assert.strictEqual(n.login, undefined, '기억하기를 끄면 긴 표를 주지 않음');
});

test('공통 비밀번호를 바꾸면 예전 로그인은 모두 풀린다', () => {
  const g = fresh();
  const { L } = loginAll(g);
  g.setPassword_('common', 'new-common-2');
  assert.strictEqual(call(g, 'staffPicker', {}, { login: L }).code, 'LOGIN');
  assert.strictEqual(call(g, 'login', { password: 'new-common-2' }).ok, true);
});

test('공통·관리자 비밀번호를 같게 정할 수 없다, 짧은 비밀번호도 안 된다', () => {
  const g = fresh();
  assert.throws(() => g.setPassword_('admin', COMMON), /서로 다르게/);
  assert.throws(() => g.setPassword_('common', '123'), /6자 이상/);
});

test('관리자: 공통 로그인 + 관리자 비밀번호가 있어야 들어간다', () => {
  const g = fresh();
  const { L } = loginAll(g);
  assert.strictEqual(call(g, 'admin.staff.list', {}, { login: L }).code, 'ADMIN');
  assert.strictEqual(call(g, 'adminLogin', { password: COMMON }, { login: L }).code, 'BADPW');
  const A = call(g, 'adminLogin', { password: ADMIN }, { login: L }).data.admin;
  const list = call(g, 'admin.staff.list', {}, { login: L, admin: A });
  assert.strictEqual(list.ok, true);
  assert.strictEqual(list.data.staff.length, 8);
  assert.strictEqual(list.data.depts.length, 5);
  // 관리자 표를 로그인 표로 쓸 수 없다
  assert.strictEqual(call(g, 'staffPicker', {}, { login: A }).code, 'LOGIN');
});

test('관리자 비밀번호도 5번 틀리면 잠긴다', () => {
  const g = fresh();
  const { L } = loginAll(g);
  for (let i = 0; i < 4; i++) assert.strictEqual(call(g, 'adminLogin', { password: 'x' + i }, { login: L }).code, 'BADPW');
  assert.strictEqual(call(g, 'adminLogin', { password: 'x' }, { login: L }).code, 'LOCKED');
  assert.strictEqual(call(g, 'adminLogin', { password: ADMIN }, { login: L }).code, 'LOCKED');
});

test('관리자 화면은 2시간 뒤 다시 비밀번호를 묻는다', () => {
  const g = fresh();
  const { L } = loginAll(g);
  const A = call(g, 'adminLogin', { password: ADMIN }, { login: L }).data.admin;
  g.__clock.offset = 2 * 3600 * 1000 + 1000;
  assert.strictEqual(call(g, 'admin.staff.list', {}, { login: L, admin: A }).code, 'ADMIN');
});

function adminTokens(g) {
  const { L, staff } = loginAll(g);
  const A = call(g, 'adminLogin', { password: ADMIN }, { login: L }).data.admin;
  const I = call(g, 'verify', { staffId: staff[0].id, pin: '1111' }, { login: L }).data.identity;
  return { L, A, I, staff, t: { login: L, admin: A, identity: I } };
}

test('교직원 추가·수정: 기록에 누가·바뀌기 전·바뀐 뒤가 남는다', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  const add = call(g, 'admin.staff.save', { fields: { '이름': '전우치', '직위': '교사', '소속': '2학년 1반', '내선': '0108' } }, t);
  assert.strictEqual(add.ok, true, add.error);
  assert.strictEqual(add.data['내선'], '0108', '앞자리 0이 지켜져야 함');
  assert.strictEqual(add.data.hasPin, false);
  const id = add.data['교직원ID'];
  const ed = call(g, 'admin.staff.save', { id, fields: Object.assign({}, add.data, { '소속': '2학년 2반' }) }, t);
  assert.strictEqual(ed.data['소속'], '2학년 2반');
  const log = g.readRows_('기록').filter((r) => r['대상ID'] === id);
  assert.strictEqual(log[0]['동작'], '추가');
  assert.strictEqual(log[0]['이름'], '홍길동');
  assert.strictEqual(log[1]['동작'], '수정');
  assert.deepStrictEqual(JSON.parse(log[1]['바뀌기 전']), { '소속': '2학년 1반' });
  assert.deepStrictEqual(JSON.parse(log[1]['바뀐 뒤']), { '소속': '2학년 2반' });
});

test('내선에 개인 연락처 모양(글자)은 넣을 수 없고, 같은 이름·소속은 막는다', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  assert.strictEqual(call(g, 'admin.staff.save', { fields: { '이름': '임꺽정', '내선': '010-1234-abcd' } }, t).ok, false);
  assert.strictEqual(call(g, 'admin.staff.save', { fields: { '이름': '홍길동', '소속': '3학년 1반' } }, t).ok, false);
});

test('번호 새로 만들기: 4자리, 한 번만 보여 주고, 원래 숫자는 어디에도 없다', () => {
  const g = fresh();
  const { t, staff } = adminTokens(g);
  const r = call(g, 'admin.staff.resetPin', { id: staff[4].id }, t);
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(/^\d{4}$/.test(r.data.pin));
  const dump = sheetDump(g) + JSON.stringify(g._props);
  const row = g.findRow_('교직원', staff[4].id);
  assert.ok(row['개인번호해시'].length === 64);
  assert.ok(!dump.includes('"' + r.data.pin + '"'), '번호 원래 숫자가 시트·속성에 있으면 안 됨');
  assert.ok(!g.readRows_('기록').some((x) => JSON.stringify(x).includes(r.data.pin) && x['동작'] === '번호 다시 정함' && x['요약'].includes(r.data.pin)));
  // 예전 번호 1111은 이제 안 되고, 새 번호는 된다
  const { L } = loginAll(g);
  assert.strictEqual(call(g, 'verify', { staffId: staff[4].id, pin: '1111' }, { login: L }).code === 'BADPIN' || r.data.pin === '1111', true);
  assert.strictEqual(call(g, 'verify', { staffId: staff[4].id, pin: r.data.pin }, { login: L }).ok, true);
});

test('번호를 다시 정하면 그분의 예전 본인 확인(기억하기 포함)이 풀린다', () => {
  const g = fresh();
  const { L, staff, t } = adminTokens(g);
  const I = call(g, 'verify', { staffId: staff[5].id, pin: '1111', remember: true }, { login: L }).data.identity;
  assert.strictEqual(call(g, 'session', {}, { login: L, identity: I }).data.me.name, '놀부');
  g.__clock.offset = 5;
  call(g, 'admin.staff.resetPin', { id: staff[5].id }, t);
  assert.strictEqual(call(g, 'session', {}, { login: L, identity: I }).data.me, null);
});

test('번호 없는 분 모두 만들기: 사용 중이면서 번호 없는 분만', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  call(g, 'admin.staff.save', { fields: { '이름': '전우치' } }, t);
  const b = call(g, 'admin.staff.save', { fields: { '이름': '박씨부인' } }, t).data;
  call(g, 'admin.staff.setActive', { id: b['교직원ID'], active: false }, t);
  const r = call(g, 'admin.staff.issueMissing', {}, t);
  assert.deepStrictEqual(r.data.map((x) => x.name), ['전우치']);
  assert.strictEqual(call(g, 'admin.staff.issueMissing', {}, t).data.length, 0);
});

test('사용 안 함으로 바꾸면 이름 목록에서 빠지고 본인 확인도 풀린다', () => {
  const g = fresh();
  const { L, staff, t } = adminTokens(g);
  const I = call(g, 'verify', { staffId: staff[6].id, pin: '1111' }, { login: L }).data.identity;
  call(g, 'admin.staff.setActive', { id: staff[6].id, active: false }, t);
  const names = call(g, 'staffPicker', {}, { login: L }).data.map((x) => x.name);
  assert.ok(!names.includes('장화'));
  assert.strictEqual(call(g, 'session', {}, { login: L, identity: I }).data.me, null);
  assert.strictEqual(call(g, 'verify', { staffId: staff[6].id, pin: '1111' }, { login: L }).ok, false);
});

test('잠금 풀기: 관리자가 풀면 바로 다시 할 수 있다', () => {
  const g = fresh();
  const { L, staff, t } = adminTokens(g);
  for (let i = 0; i < 5; i++) call(g, 'verify', { staffId: staff[7].id, pin: '9999' }, { login: L });
  const list = call(g, 'admin.staff.list', {}, t).data.staff;
  assert.strictEqual(list.find((x) => x['교직원ID'] === staff[7].id).locked, true);
  call(g, 'admin.staff.unlock', { id: staff[7].id }, t);
  assert.strictEqual(call(g, 'verify', { staffId: staff[7].id, pin: '1111' }, { login: L }).ok, true);
});

test('화면으로 가는 교직원 정보에 해시·솔트가 없다', () => {
  const g = fresh();
  const { L, t } = adminTokens(g);
  const a = JSON.stringify(call(g, 'admin.staff.list', {}, t));
  const b = JSON.stringify(call(g, 'staffPicker', {}, { login: L }));
  for (const s of [a, b]) {
    assert.ok(!s.includes('개인번호해시') && !s.includes('솔트'), '숨김 칸이 나감');
  }
});

test('분류 이름 바꾸기: 한 곳에서 바꾸면 교직원 목록의 부서 이름도 바뀐다', () => {
  const g = fresh();
  const { L, t } = adminTokens(g);
  const cats = call(g, 'admin.cat.list', {}, t).data;
  const dept = cats.find((c) => c.kind === '부서').items.find((x) => x['이름'] === '정보부');
  const r = call(g, 'admin.cat.save', { id: dept['분류ID'], name: '정보과학부' }, t);
  assert.strictEqual(r.ok, true, r.error);
  const picker = call(g, 'staffPicker', {}, { login: L }).data;
  assert.strictEqual(picker.find((x) => x.name === '심청').dept, '정보과학부');
  const log = g.readRows_('기록').pop();
  assert.ok(log['요약'].includes('정보부 → 정보과학부'));
  // 같은 이름 중복 막기
  assert.strictEqual(call(g, 'admin.cat.save', { kind: '부서', name: '연구부' }, t).ok, false);
});

test('설정 저장: 범위를 벗어나면 거절, 바꾸면 기록에 남는다', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '잠금 횟수': '99' } }, t).ok, false);
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '1학기 시작일': '2026-13-01' } }, t).ok, false);
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '1학기 시작일': '2026-03-02', '1학기 끝일': '2026-03-01' } }, t).ok, false);
  const ok = call(g, 'admin.settings.save', { values: { '1학기 시작일': '2026-03-02', '기존 시트 바로가기': JSON.stringify([{ name: '특별실 시간표', url: 'https://docs.google.com/x' }]) } }, t);
  assert.strictEqual(ok.ok, true, ok.error);
  assert.strictEqual(g.setting_('1학기 시작일'), '2026-03-02', '날짜가 글자 그대로 남아야 함');
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '기존 시트 바로가기': JSON.stringify([{ name: 'x', url: 'javascript:alert(1)' }]) } }, t).ok, false);
  assert.ok(g.readRows_('기록').some((r) => r['탭'] === '설정' && r['대상ID'] === '1학기 시작일'));
});

test('시트에 수식으로 읽힐 글자는 글자로 저장된다', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  const r = call(g, 'admin.staff.save', { fields: { '이름': '=HYPERLINK("x")', '담당 업무': '+1+2' } }, t);
  assert.strictEqual(r.data['이름'], '=HYPERLINK("x")');
  const row = g.findRow_('교직원', r.data['교직원ID']);
  assert.strictEqual(row['이름'], '=HYPERLINK("x")');
  assert.strictEqual(row['담당 업무'], '+1+2');
});

test('지우기는 숨김 표시이고 되살릴 수 있다(기록 포함)', () => {
  const g = fresh();
  const actor = { id: 'T1', name: '시험' };
  const e = g.insertRow_('일정', { '시작일': '2026-10-15', '행사명': '시험 행사' }, actor, '');
  g.softDelete_('일정', e['일정ID'], actor, '');
  assert.strictEqual(g.liveRows_('일정').length, 0);
  assert.strictEqual(g.readRows_('일정').length, 1, '행은 남아 있어야 함');
  g.restoreRow_('일정', e['일정ID'], actor, '');
  assert.strictEqual(g.liveRows_('일정').length, 1);
  assert.strictEqual(g.liveRows_('일정')[0]['시작일'], '2026-10-15');
  const acts = plain(g.readRows_('기록').filter((r) => r['대상ID'] === e['일정ID']).map((r) => r['동작']));
  assert.deepStrictEqual(acts, ['추가', '삭제', '되살리기']);
});

test('관리자 화면에서 비밀번호 바꾸기', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  assert.strictEqual(call(g, 'admin.pw.admin', { current: 'x', newPw: 'abcdefg', newPw2: 'abcdefg' }, t).ok, false);
  assert.strictEqual(call(g, 'admin.pw.admin', { current: ADMIN, newPw: 'abcdefg', newPw2: 'abcdefh' }, t).ok, false);
  assert.strictEqual(call(g, 'admin.pw.admin', { current: ADMIN, newPw: 'abcdefg', newPw2: 'abcdefg' }, t).ok, true);
  // 관리자 비밀번호가 바뀌면 지금 관리자 표도 풀린다
  assert.strictEqual(call(g, 'admin.staff.list', {}, t).code, 'ADMIN');
  assert.strictEqual(call(g, 'admin.pw.common', { newPw: 'zzzzzzz', newPw2: 'zzzzzzz' }, t).code, 'ADMIN');
});

test('비밀번호·개인 번호 원래 글자가 시트·속성·코드에 없다', () => {
  const g = fresh();
  const dump = sheetDump(g) + JSON.stringify(g._props);
  for (const s of [COMMON, ADMIN]) assert.ok(!dump.includes(s), s + ' 가 저장됨');
  const props = Object.keys(g._props);
  assert.ok(props.includes('COMMON_PW_HASH') && props.includes('ADMIN_PW_HASH') && props.includes('PIN_PEPPER'));
  for (const f of GAS_FILES) {
    const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
    assert.ok(!src.includes(COMMON) && !src.includes(ADMIN), f + ' 에 비밀번호가 있음');
  }
});

test('시트 메뉴 기능은 웹앱에서 부를 수 없다', () => {
  const g = fresh();
  assert.throws(() => g.setPasswordFromSheet('common', 'hacked-123'), /메뉴에서만/);
  assert.throws(() => g.menuSetup(), /메뉴에서만/);
  assert.throws(() => g.menuSeedTestData(), /메뉴에서만/);
  assert.strictEqual(call(g, 'login', { password: 'hacked-123' }).ok, false);
  // 시트 화면에서는 된다
  const h = fresh(true);
  assert.strictEqual(h.setPasswordFromSheet('common', 'sheet-pass-9'), 'ok');
  assert.strictEqual(call(h, 'login', { password: 'sheet-pass-9' }).ok, true);
});

test('가짜 데이터는 사람이 이미 있는 시트에는 넣지 않는다', () => {
  const g = fresh();
  assert.throws(() => g.seedTestData_(), /이미 사람이/);
});

test('무작위 개인 번호: 4자리, 쉬운 번호 없음, 고르게 나온다', () => {
  const g = loadGas();
  const seen = new Set();
  const firstDigit = new Array(10).fill(0);
  for (let i = 0; i < 3000; i++) {
    const p = g.newPin_();
    assert.ok(/^\d{4}$/.test(p));
    assert.ok(!['0000', '1234', '1111'].includes(p));
    seen.add(p);
    firstDigit[Number(p[0])]++;
  }
  assert.ok(seen.size > 2500);
  for (const n of firstDigit) assert.ok(n > 200 && n < 400, '첫 자리가 고르지 않음: ' + firstDigit);
});

test('알 수 없는 요청·이상한 값에도 서버가 멈추지 않는다', () => {
  const g = fresh();
  assert.strictEqual(JSON.parse(g.api('not json')).ok, false);
  assert.strictEqual(call(g, 'nope').ok, false);
  const { L } = loginAll(g);
  assert.strictEqual(call(g, 'verify', { staffId: 'T0000', pin: 'abcd' }, { login: L }).code, 'BADPIN');
  assert.strictEqual(call(g, 'verify', { staffId: 'T0000', pin: '1234' }, { login: L }).code, 'NOTFOUND');
});

console.log(results.join('\n'));
console.log('\n' + passed + '/' + results.length + ' 통과');
