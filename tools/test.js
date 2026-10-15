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

/** 처음 설정 + 비밀번호 + 가짜 교직원(번호 1111)까지 마친 환경. 개인 번호 방식(기억 30일)으로 시험한다 */
function fresh(withUi) {
  const g = freshName(withUi);
  g.putSetting_('본인 확인 방식', '이름+개인 번호', { id: '', name: '시험' });
  g.putSetting_('기기 기억 일수', '30', { id: '', name: '시험' });
  return g;
}

/** 기본값 그대로('이름만', 기억 365일) */
function freshName(withUi) {
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
  assert.strictEqual(g.setting_('기기 기억 일수'), '365');
  assert.strictEqual(g.setting_('본인 확인 방식'), '이름만');
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


// ================================================================ 2단계: 일정과 홈

/** 이름으로 본인 확인 표 받기 */
function idOf(g, L, staff, name) {
  const p = staff.find((x) => x.name === name);
  return call(g, 'verify', { staffId: p.id, pin: '1111' }, { login: L }).data.identity;
}

function ev(fields) {
  return Object.assign({ start: '2026-10-20', title: '시험 행사', kind: '행사', target: ['3', '4'] }, fields);
}

test('일정 넣기: 한 번 넣으면 달력·연간 학사일정·홈에 함께 보인다', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const I = idOf(g, L, staff, '이몽룡');
  const today = g.todayYmd_();
  const r = call(g, 'sched.save', { fields: ev({ start: today, title: '오늘 협의회', time: '15:00' }) }, { login: L, identity: I });
  assert.strictEqual(r.ok, true, r.error);
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const month = call(g, 'sched.month', { year: y, month: m }, { login: L }).data;
  assert.ok(month.events.some((e) => e.title === '오늘 협의회'));
  const year = call(g, 'sched.year', { year: m >= 3 ? y : y - 1 }, { login: L }).data;
  assert.ok(year.events.some((e) => e.title === '오늘 협의회'));
  const home = call(g, 'home', {}, { login: L }).data;
  assert.ok(home.events.some((e) => e.title === '오늘 협의회' && e.start === home.today));
  assert.strictEqual(home.events.find((e) => e.title === '오늘 협의회').by, '이몽룡');
});

test('일정 넣기는 본인 확인이 있어야 한다', () => {
  const g = fresh();
  const { L } = loginAll(g);
  assert.strictEqual(call(g, 'sched.save', { fields: ev() }, { login: L }).code, 'IDENTITY');
});

test('고치기·지우기: 처음 넣은 사람과 관리 역할만', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const mine = idOf(g, L, staff, '이몽룡');
  const other = idOf(g, L, staff, '심청');
  const boss = idOf(g, L, staff, '홍길동');
  const e = call(g, 'sched.save', { fields: ev() }, { login: L, identity: mine }).data;
  assert.strictEqual(e.canEdit, true);
  const seenByOther = call(g, 'sched.month', { year: 2026, month: 10 }, { login: L, identity: other }).data.events.find((x) => x.id === e.id);
  assert.strictEqual(seenByOther.canEdit, false);
  assert.strictEqual(call(g, 'sched.save', { id: e.id, fields: ev({ title: '남이 고침' }) }, { login: L, identity: other }).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'sched.delete', { id: e.id }, { login: L, identity: other }).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'sched.save', { id: e.id, fields: ev({ title: '내가 고침' }) }, { login: L, identity: mine }).data.title, '내가 고침');
  assert.strictEqual(call(g, 'sched.save', { id: e.id, fields: ev({ title: '부장이 고침' }) }, { login: L, identity: boss }).data.title, '부장이 고침');
  // 관리자 화면을 연 사람도 된다
  const A = call(g, 'adminLogin', { password: ADMIN }, { login: L }).data.admin;
  assert.strictEqual(call(g, 'sched.delete', { id: e.id }, { login: L, identity: other, admin: A }).ok, true);
});

test('휴업일·공휴일은 관리 역할(또는 관리자)만 넣을 수 있다', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const plain = idOf(g, L, staff, '이몽룡');
  const boss = idOf(g, L, staff, '홍길동');
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ kind: '공휴일' }) }, { login: L, identity: plain }).ok, false);
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ kind: '휴업일' }) }, { login: L, identity: boss }).ok, true);
});

test('일정 값 확인: 날짜·이름·끝나는 날·학년', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const t = { login: L, identity: idOf(g, L, staff, '홍길동') };
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ start: '2026-02-30' }) }, t).ok, false);
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ title: '' }) }, t).ok, false);
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ end: '2026-10-01' }) }, t).ok, false);
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ kind: '아무거나' }) }, t).ok, false);
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ target: ['1', '2', '3', '4', '5', '6'] }) }, t).data.target, '전체');
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ target: ['전체', '3'] }) }, t).data.target, '전체');
  assert.strictEqual(call(g, 'sched.save', { fields: ev({ target: ['2', '교직원', '9', 'x'] }) }, t).data.target, '2,교직원');
  const multi = call(g, 'sched.save', { fields: ev({ start: '2026-10-19', end: '2026-10-23' }) }, t).data;
  assert.strictEqual(multi.end, '2026-10-23');
  // 여러 날 일정은 겹치는 달에 모두 보인다
  const nov = call(g, 'sched.save', { fields: ev({ start: '2026-10-29', end: '2026-11-03', title: '걸친 행사' }) }, t).data;
  assert.ok(call(g, 'sched.month', { year: 2026, month: 11 }, t).data.events.some((e) => e.id === nov.id));
  // 날짜가 시트에 글자 그대로 남는다
  assert.strictEqual(g.findRow_('일정', multi.id)['시작일'], '2026-10-19');
});

test('수업일수: 학기 평일 − 휴업일·공휴일(평일만, 겹치면 한 번)', () => {
  const g = fresh();
  g.putSetting_('1학기 시작일', '2026-03-02', { id: '', name: '시험' }); // 시험용 값
  g.putSetting_('1학기 끝일', '2026-03-31', { id: '', name: '시험' });
  const { L, staff } = loginAll(g);
  const t = { login: L, identity: idOf(g, L, staff, '홍길동') };
  call(g, 'sched.save', { fields: ev({ start: '2026-03-03', kind: '공휴일', title: '화요일 공휴일' }) }, t);
  call(g, 'sched.save', { fields: ev({ start: '2026-03-07', kind: '공휴일', title: '토요일 공휴일' }) }, t);
  call(g, 'sched.save', { fields: ev({ start: '2026-03-05', end: '2026-03-09', kind: '휴업일', title: '재량휴업' }) }, t);
  call(g, 'sched.save', { fields: ev({ start: '2026-03-05', kind: '공휴일', title: '겹친 날' }) }, t);
  call(g, 'sched.save', { fields: ev({ start: '2026-03-10', kind: '행사', title: '보통 행사' }) }, t);
  const y = call(g, 'sched.year', { year: 2026 }, t).data.days;
  const s1 = y.semesters[0];
  assert.strictEqual(s1.weekdays, 22, '3/2~3/31 평일 22일');
  assert.deepStrictEqual(plain(s1.removed.map((x) => x.date)), ['2026-03-03', '2026-03-05', '2026-03-06', '2026-03-09']);
  assert.strictEqual(s1.days, 18);
  assert.strictEqual(y.missing, true, '2학기 기간이 없음을 알려야 함');
  const march = call(g, 'sched.month', { year: 2026, month: 3 }, t).data.monthDays;
  assert.strictEqual(march.days, 18);
  // 지운 휴업일은 수업일수에서 다시 돌아온다
  const holiday = call(g, 'sched.year', { year: 2026 }, t).data.events.find((e) => e.title === '화요일 공휴일');
  call(g, 'sched.delete', { id: holiday.id }, t);
  assert.strictEqual(call(g, 'sched.year', { year: 2026 }, t).data.days.semesters[0].days, 19);
});

test('학기 기간이 없으면 수업일수는 비워 둔다(지어내지 않음)', () => {
  const g = fresh();
  const { L } = loginAll(g);
  assert.strictEqual(call(g, 'sched.month', { year: 2026, month: 10 }, { login: L }).data.monthDays, null);
  assert.strictEqual(call(g, 'sched.year', { year: 2026 }, { login: L }).data.days.semesters.length, 0);
});

test('지운 일정은 휴지통에 남고 되살릴 수 있다(기록 포함)', () => {
  const g = fresh();
  const { L, staff, t } = adminTokens(g);
  const e = call(g, 'sched.save', { fields: ev({ title: '지울 행사' }) }, t).data;
  call(g, 'sched.delete', { id: e.id }, t);
  assert.ok(!call(g, 'sched.month', { year: 2026, month: 10 }, t).data.events.some((x) => x.id === e.id));
  const trash = call(g, 'admin.trash.list', {}, t).data;
  assert.strictEqual(trash[0].title, '지울 행사');
  assert.strictEqual(trash[0].deletedBy, '홍길동');
  assert.strictEqual(call(g, 'admin.trash.restore', { id: e.id }, t).ok, true);
  assert.ok(call(g, 'sched.month', { year: 2026, month: 10 }, t).data.events.some((x) => x.id === e.id));
  const acts = plain(g.readRows_('기록').filter((r) => r['대상ID'] === e.id).map((r) => r['동작']));
  assert.deepStrictEqual(acts, ['추가', '삭제', '되살리기']);
  assert.strictEqual(call(g, 'admin.trash.list', {}, { login: L }).code, 'ADMIN');
  void staff;
});

test('월별 중점지도: 관리 역할만 넣고, 그 달에 보인다', () => {
  const g = fresh();
  const { L, staff } = loginAll(g);
  const plainI = idOf(g, L, staff, '이몽룡');
  const boss = idOf(g, L, staff, '홍길동');
  assert.strictEqual(call(g, 'focus.save', { year: 2026, month: 10, text: 'x' }, { login: L, identity: plainI }).code, 'FORBIDDEN');
  call(g, 'focus.save', { year: 2026, month: 10, text: '안전 지도' }, { login: L, identity: boss });
  call(g, 'focus.save', { year: 2026, month: 10, text: '안전 지도\n헬멧 쓰기' }, { login: L, identity: boss });
  assert.strictEqual(call(g, 'sched.month', { year: 2026, month: 10 }, { login: L }).data.focus.text, '안전 지도\n헬멧 쓰기');
  assert.strictEqual(g.liveRows_('월별중점').length, 1, '고치면 줄이 늘지 않음');
  // 2027년 1월은 2026학년도
  call(g, 'focus.save', { year: 2026, month: 1, text: '겨울방학 안전' }, { login: L, identity: boss });
  assert.strictEqual(call(g, 'sched.month', { year: 2027, month: 1 }, { login: L }).data.focus.text, '겨울방학 안전');
});

test('홈: 기존 시트 바로가기와 이번 주 월요일을 준다', () => {
  const g = fresh();
  g.putSetting_('기존 시트 바로가기', JSON.stringify([{ name: '특별실 시간표', url: 'https://docs.google.com/x' }]), { id: '', name: '시험' });
  const { L } = loginAll(g);
  const h = call(g, 'home', {}, { login: L }).data;
  assert.strictEqual(h.links[0].name, '특별실 시간표');
  assert.strictEqual(g.weekday_(h.monday), 1);
  assert.ok(h.monday <= h.today);
});

test('테스트용 가짜 일정: 빈 시트에만, 홈·달력에 보인다', () => {
  const g = fresh();
  assert.strictEqual(g.seedTestSchedule_(), 16);
  assert.throws(() => g.seedTestSchedule_(), /이미 일정이/);
  const { L } = loginAll(g);
  const h = call(g, 'home', {}, { login: L }).data;
  assert.ok(h.events.length >= 8);
  assert.ok(h.focus.text.includes('헬멧'));
});

test('날짜 도구: 요일·월요일·말일', () => {
  const g = loadGas();
  assert.strictEqual(g.weekday_('2026-10-15'), 4);
  assert.strictEqual(g.mondayOf_('2026-10-18'), '2026-10-12');
  assert.strictEqual(g.mondayOf_('2026-10-12'), '2026-10-12');
  assert.strictEqual(g.lastDayOfMonth_(2028, 2), '2028-02-29');
  assert.strictEqual(g.addDays_('2026-12-31', 1), '2027-01-01');
  assert.deepStrictEqual(plain(g.schoolYearRange_(2026)), { from: '2026-03-01', to: '2027-02-28' });
});


// ================================================================ 본인 확인 방식: 이름만 (기본값)

test('이름만: 번호 없이 이름을 고르면 본인 확인이 되고, 기록에 고른 이름이 남는다', () => {
  const g = freshName();
  const { L, staff } = loginAll(g);
  const start = call(g, 'start').data;
  assert.strictEqual(start.pinMode, false);
  assert.strictEqual(start.rememberDays, 365);
  const r = call(g, 'verify', { staffId: staff[2].id, remember: true }, { login: L });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.data.me.name, '이몽룡');
  const t = { login: r.data.login, identity: r.data.identity };
  const e = call(g, 'sched.save', { fields: { start: '2026-10-20', title: '이름만 행사' } }, t).data;
  assert.strictEqual(e.by, '이몽룡');
  assert.strictEqual(g.readRows_('기록').pop()['이름'], '이몽룡');
});

test('이름만: 공통 비밀번호는 기억하기 없이도 1년 유지된다', () => {
  const g = freshName();
  const L = call(g, 'login', { password: COMMON }).data.login;
  g.__clock.offset = 364 * 24 * 3600 * 1000;
  assert.strictEqual(call(g, 'staffPicker', {}, { login: L }).ok, true);
  g.__clock.offset = 366 * 24 * 3600 * 1000;
  assert.strictEqual(call(g, 'staffPicker', {}, { login: L }).code, 'LOGIN');
});

test('이름만: 기억하기를 켜면 고른 이름도 1년, 끄면 12시간', () => {
  const g = freshName();
  const { L, staff } = loginAll(g);
  const long = call(g, 'verify', { staffId: staff[0].id, remember: true }, { login: L }).data;
  const short = call(g, 'verify', { staffId: staff[1].id }, { login: L }).data;
  g.__clock.offset = 13 * 3600 * 1000;
  assert.strictEqual(call(g, 'session', {}, { login: long.login, identity: short.identity }).data.me, null);
  assert.strictEqual(call(g, 'session', {}, { login: long.login, identity: long.identity }).data.me.name, '홍길동');
  g.__clock.offset = 300 * 24 * 3600 * 1000;
  assert.strictEqual(call(g, 'session', {}, { login: long.login, identity: long.identity }).data.me.name, '홍길동');
});

test('이름만: 사용 안 함인 분은 고를 수 없다', () => {
  const g = freshName();
  const { L, staff, t } = adminTokens(g);
  call(g, 'admin.staff.setActive', { id: staff[6].id, active: false }, t);
  assert.strictEqual(call(g, 'verify', { staffId: staff[6].id }, { login: L }).code, 'NOTFOUND');
});

test('확인 방식을 바꾸면 예전 본인 확인은 풀린다(양쪽 모두)', () => {
  const g = freshName();
  const { L, staff } = loginAll(g);
  const nameId = call(g, 'verify', { staffId: staff[0].id, remember: true }, { login: L }).data.identity;
  g.putSetting_('본인 확인 방식', '이름+개인 번호', { id: '', name: '시험' });
  assert.strictEqual(call(g, 'session', {}, { login: L, identity: nameId }).data.me, null, '이름만 표로 번호 방식에 들어오면 안 됨');
  assert.strictEqual(call(g, 'verify', { staffId: staff[0].id }, { login: L }).code, 'BADPIN', '번호 방식에서는 번호가 필요');
  const pinId = call(g, 'verify', { staffId: staff[0].id, pin: '1111' }, { login: L }).data.identity;
  g.putSetting_('본인 확인 방식', '이름만', { id: '', name: '시험' });
  assert.strictEqual(call(g, 'session', {}, { login: L, identity: pinId }).data.me, null);
});

test('설정: 본인 확인 방식은 두 가지 중에서만, 기억 기간은 400일까지', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '본인 확인 방식': '아무거나' } }, t).ok, false);
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '기기 기억 일수': '500' } }, t).ok, false);
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '기기 기억 일수': '365' } }, t).ok, true);
  assert.strictEqual(call(g, 'admin.staff.list', {}, t).data.pinMode, false);
});

console.log(results.join('\n'));
console.log('\n' + passed + '/' + results.length + ' 통과');
