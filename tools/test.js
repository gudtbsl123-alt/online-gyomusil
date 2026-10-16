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

test('처음 설정: 탭 13개와 머리글, 설정 기본값을 만든다', () => {
  const g = loadGas();
  const r = g.setupAll_();
  assert.strictEqual(r.created.length, 13);
  const names = g._ss.sheets.map((s) => s.name);
  for (const t of Object.keys(g.tabs_())) assert.ok(names.includes(t), t);
  assert.deepStrictEqual(plain(g.headOf_('교직원')), plain(g.tabs_()['교직원']));
  assert.strictEqual(g.setting_('잠금 횟수'), '5');
  assert.strictEqual(g.setting_('잠금 분'), '10');
  assert.strictEqual(g.setting_('기기 기억 일수'), '365');
  assert.strictEqual(g.setting_('본인 확인 방식'), '이름만');
  assert.strictEqual(g.setting_('백업 남길 개수'), '30');
});

test('처음 설정을 다시 누르면 설정 값은 그대로, 설명 칸만 지금 안내로 바뀐다', () => {
  const g = fresh();
  const sh = g._ss.getSheetByName('설정');
  const row = sh.data.findIndex((l) => l[0] === '기존 시트 바로가기');
  sh.data[row][2] = '2단계 홈 화면에 보여요';
  g.setupAll_();
  assert.strictEqual(sh.data[row][2], '홈 화면 아래에 보여요');
  assert.strictEqual(g.setting_('기기 기억 일수'), '30', '값은 그대로');
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
  assert.strictEqual(list.data.depts.length, 4);
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


test('중요 일정: 누구나 표시하고, 모든 화면 데이터에 important로 온다', () => {
  const g = freshName();
  const { L, staff } = loginAll(g);
  const I = call(g, 'verify', { staffId: staff[2].id }, { login: L }).data.identity;
  const t = { login: L, identity: I };
  const e = call(g, 'sched.save', { fields: { start: '2026-10-20', title: '중요 행사', important: true } }, t).data;
  assert.strictEqual(e.important, true);
  assert.strictEqual(g.findRow_('일정', e.id)['중요'], '예');
  assert.strictEqual(call(g, 'sched.month', { year: 2026, month: 10 }, t).data.events.find((x) => x.id === e.id).important, true);
  assert.strictEqual(call(g, 'sched.year', { year: 2026 }, t).data.events.find((x) => x.id === e.id).important, true);
  const off = call(g, 'sched.save', { id: e.id, fields: { start: '2026-10-20', title: '중요 행사' } }, t).data;
  assert.strictEqual(off.important, false);
  const log = g.readRows_('기록').pop();
  assert.deepStrictEqual(JSON.parse(log['바뀌기 전']), { '중요': '예' });
});

test('중요 칸이 없는 예전 시트도 저장할 때 칸이 자동으로 생긴다', () => {
  const g = freshName();
  const sh = g._ss.getSheetByName('일정');
  const idx = sh.data[0].indexOf('중요');
  sh.data[0].splice(idx, 1); // 예전 시트처럼 '중요' 칸 없앰
  const { L, staff } = loginAll(g);
  const I = call(g, 'verify', { staffId: staff[0].id }, { login: L }).data.identity;
  const e = call(g, 'sched.save', { fields: { start: '2026-10-21', title: '예전 시트', important: true } }, { login: L, identity: I }).data;
  assert.strictEqual(e.important, true);
  assert.ok(g.headOf_('일정').includes('중요'));
});


// ================================================================ 3단계: 조사·신청

function sv(g, extra) {
  return Object.assign({
    title: '체육대회 참가 신청',
    deadline: g.addDays_(g.todayYmd_(), 3) + ' 17:00',
    target: { type: 'all' },
    questions: [
      { type: 'one', title: '종목', required: true, options: ['피구', '배드민턴', '응원'] },
      { type: 'many', title: '도울 일', options: '사진\n정리\n준비물' },
      { type: 'short', title: '하고 싶은 말' },
      { type: 'number', title: '인원', required: false },
      { type: 'date', title: '희망 날짜' }
    ]
  }, extra || {});
}

function ids(g) {
  const { L, staff } = loginAll(g);
  const who = (name) => ({ login: L, identity: call(g, 'verify', { staffId: staff.find((x) => x.name === name).id }, { login: L }).data.identity });
  /** 이름만 방식에서 관리 일을 하려면 관리자 화면(관리자 비밀번호)이 열려 있어야 한다 */
  const boss = (name) => Object.assign(who(name || '홍길동'), { admin: call(g, 'adminLogin', { password: ADMIN }, { login: L }).data.admin });
  return { L, staff, who, boss };
}

test('조사 만들기 → 응답하면 제출 현황 숫자가 바로 바뀐다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const made = call(g, 'survey.save', { fields: sv(g) }, owner);
  assert.strictEqual(made.ok, true, made.error);
  const id = made.data.id;
  let d = call(g, 'survey.get', { id }, owner).data;
  assert.strictEqual(d.card.targetCount, 8);
  assert.strictEqual(d.card.doneCount, 0);
  assert.strictEqual(d.notDone.length, 8);
  assert.ok(d.messenger.includes('체육대회 참가 신청을'));
  const r = call(g, 'survey.respond', { id, answers: { [d.questions[0].id]: '피구', [d.questions[1].id]: ['정리', '사진'], [d.questions[3].id]: '3' } }, who('심청'));
  assert.strictEqual(r.ok, true, r.error);
  d = call(g, 'survey.get', { id }, owner).data;
  assert.strictEqual(d.card.doneCount, 1);
  assert.strictEqual(d.notDone.length, 7);
  assert.ok(!d.notDone.some((p) => p.name === '심청'));
  const one = d.summary[0].counts.find((c) => c.option === '피구');
  assert.strictEqual(one.count, 1);
  assert.deepStrictEqual(plain(d.responses[0].answers[d.questions[1].id]), ['사진', '정리'], '보기 순서대로 정리');
  assert.strictEqual(d.summary[3].sum, 3);
});

test('같은 사람이 두 번 내면 새 응답이 아니라 고치기가 된다', () => {
  const g = freshName();
  const { who } = ids(g);
  const id = call(g, 'survey.save', { fields: sv(g) }, who('홍길동')).data.id;
  const q = call(g, 'survey.get', { id }, who('홍길동')).data.questions[0].id;
  const me = who('흥부');
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [q]: '피구' } }, me).data.edited, false);
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [q]: '응원' }, note: '고쳤어요' }, me).data.edited, true);
  assert.strictEqual(g.liveRows_('응답').length, 1);
  const mine = call(g, 'survey.get', { id }, me).data.myAnswer;
  assert.strictEqual(mine.answers[q], '응원');
  assert.strictEqual(mine.note, '고쳤어요');
  assert.ok(g.readRows_('기록').some((r) => r['요약'].includes('응답 고침')));
});

test('응답 확인: 꼭 답할 질문·보기·숫자·날짜를 지킨다', () => {
  const g = freshName();
  const { who } = ids(g);
  const id = call(g, 'survey.save', { fields: sv(g) }, who('홍길동')).data.id;
  const qs = call(g, 'survey.get', { id }, who('홍길동')).data.questions;
  const me = who('놀부');
  assert.ok(call(g, 'survey.respond', { id, answers: {} }, me).error.includes('1번 질문에 답해'));
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [qs[0].id]: '축구' } }, me).ok, false);
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [qs[0].id]: '피구', [qs[1].id]: ['없는 보기'] } }, me).ok, false);
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [qs[0].id]: '피구', [qs[3].id]: '세 명' } }, me).ok, false);
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [qs[0].id]: '피구', [qs[4].id]: '2026-02-30' } }, me).ok, false);
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [qs[0].id]: '피구', [qs[3].id]: '1,200' } }, me).ok, true);
});

test('응답은 본인 확인이 있어야 하고, 대상이 아니면 낼 수 없다', () => {
  const g = freshName();
  const { L, who } = ids(g);
  const dept = call(g, 'admin.cat.list', {}, adminTokens(g).t).data.find((c) => c.kind === '부서').items.find((x) => x['이름'] === '연구부');
  const id = call(g, 'survey.save', { fields: sv(g, { target: { type: 'dept', ids: [dept['분류ID']] } }) }, who('홍길동')).data.id;
  const d = call(g, 'survey.get', { id }, who('홍길동')).data;
  assert.strictEqual(d.card.targetCount, 2, '연구부 2명');
  assert.strictEqual(call(g, 'survey.respond', { id, answers: {} }, { login: L }).code, 'IDENTITY');
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [d.questions[0].id]: '피구' } }, who('심청')).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [d.questions[0].id]: '피구' } }, who('성춘향')).ok, true);
});

test('대상: 학년(소속의 n학년)·직접 고르기', () => {
  const g = freshName();
  const { staff, who } = ids(g);
  const a = call(g, 'survey.save', { fields: sv(g, { target: { type: 'grade', grades: ['3'] } }) }, who('홍길동')).data.id;
  assert.strictEqual(call(g, 'survey.get', { id: a }, who('홍길동')).data.card.targetCount, 2, '3학년 1반·2반');
  const pick = staff.filter((x) => ['심청', '놀부', '흥부'].includes(x.name)).map((x) => x.id);
  const b = call(g, 'survey.save', { fields: sv(g, { target: { type: 'people', ids: pick.concat(['T없는사람']) } }) }, who('홍길동')).data.id;
  assert.strictEqual(call(g, 'survey.get', { id: b }, who('홍길동')).data.card.targetCount, 3);
  assert.strictEqual(call(g, 'survey.save', { fields: sv(g, { target: { type: 'grade', grades: [] } }) }, who('홍길동')).ok, false);
});

test('다시 알리기: 안 낸 분 홈의 내가 할 일 맨 위에 올라간다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('홍길동');
  const early = call(g, 'survey.save', { fields: sv(g, { title: '먼저 마감', deadline: g.addDays_(g.todayYmd_(), 1) + ' 09:00' }) }, owner).data.id;
  const late = call(g, 'survey.save', { fields: sv(g, { title: '나중 마감', deadline: g.addDays_(g.todayYmd_(), 9) + ' 09:00' }) }, owner).data.id;
  const q = call(g, 'survey.get', { id: late }, owner).data.questions[0].id;
  call(g, 'survey.respond', { id: late, answers: { [q]: '피구' } }, who('심청'));
  let home = call(g, 'home', {}, who('이몽룡')).data;
  assert.deepStrictEqual(plain(home.todos.map((x) => x.title)), ['먼저 마감', '나중 마감'], '처음엔 마감 순');
  const r = call(g, 'survey.remind', { id: late }, owner);
  assert.strictEqual(r.data.count, 7, '안 낸 7명');
  home = call(g, 'home', {}, who('이몽룡')).data;
  assert.strictEqual(home.todos[0].title, '나중 마감');
  assert.strictEqual(home.todos[0].reminded, true);
  // 이미 낸 사람에게는 할 일로 남지 않는다
  assert.ok(!call(g, 'home', {}, who('심청')).data.todos.some((x) => x.id === late));
  assert.strictEqual(call(g, 'session', {}, who('이몽룡')).data.todoCount, 2);
  // 남이 만든 조사는 알릴 수 없다
  assert.strictEqual(call(g, 'survey.remind', { id: early }, who('이몽룡')).code, 'FORBIDDEN');
  assert.strictEqual(g.liveRows_('알림').length, 7);
});

test('결과 보기: 기본은 만든 사람·관리 역할만, 결과 공개를 켜면 대상 모두', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const closedId = call(g, 'survey.save', { fields: sv(g) }, who('이몽룡')).data.id;
  const other = call(g, 'survey.get', { id: closedId }, who('심청')).data;
  assert.strictEqual(other.canSeeResults, false);
  assert.strictEqual(other.responses, undefined, '남의 답이 나가면 안 됨');
  assert.strictEqual(call(g, 'survey.csv', { id: closedId }, who('심청')).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'survey.get', { id: closedId }, boss('홍길동')).data.canSeeResults, true, '관리 역할');
  const openId = call(g, 'survey.save', { fields: sv(g, { showResults: true }) }, who('이몽룡')).data.id;
  const seen = call(g, 'survey.get', { id: openId }, who('심청')).data;
  assert.strictEqual(seen.canSeeResults, true);
  assert.strictEqual(seen.notDone.length, 0, '안 낸 사람 명단은 만든 사람만');
});

test('마감이 지나거나 끝내면 응답을 받지 않고, 다시 열 수 있다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const id = call(g, 'survey.save', { fields: sv(g) }, owner).data.id;
  const q = call(g, 'survey.get', { id }, owner).data.questions[0].id;
  call(g, 'survey.setOpen', { id, open: false }, owner);
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [q]: '피구' } }, who('심청')).code, 'CLOSED');
  assert.ok(call(g, 'survey.list', {}, owner).data.past.some((c) => c.id === id));
  call(g, 'survey.setOpen', { id, open: true }, owner);
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [q]: '피구' } }, who('심청')).ok, true);
  g.__clock.offset = 5 * 24 * 3600 * 1000; // 마감(3일 뒤) 지남
  assert.strictEqual(call(g, 'survey.respond', { id, answers: { [q]: '응원' } }, who('심청')).code, 'CLOSED');
  assert.strictEqual(call(g, 'survey.setOpen', { id, open: true }, owner).ok, false, '마감이 지나면 마감을 늦춰야 함');
});

test('응답이 있으면 질문은 못 고치고 제목·마감은 고칠 수 있다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const id = call(g, 'survey.save', { fields: sv(g) }, owner).data.id;
  const d = call(g, 'survey.get', { id }, owner).data;
  call(g, 'survey.respond', { id, answers: { [d.questions[0].id]: '피구' } }, who('심청'));
  const keep = { title: '새 제목', deadline: g.addDays_(g.todayYmd_(), 5) + ' 12:00', target: d.target, questions: d.questions };
  assert.strictEqual(call(g, 'survey.save', { id, fields: keep }, owner).ok, true);
  const changed = JSON.parse(JSON.stringify(d.questions));
  changed[0].options = ['축구', '야구'];
  assert.strictEqual(call(g, 'survey.save', { id, fields: Object.assign({}, keep, { questions: changed }) }, owner).code, 'LOCKED');
  assert.strictEqual(call(g, 'survey.save', { id, fields: keep }, who('심청')).code, 'FORBIDDEN');
});

test('조사 만들기 값 확인', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('이몽룡');
  assert.strictEqual(call(g, 'survey.save', { fields: sv(g, { title: '' }) }, me).ok, false);
  assert.strictEqual(call(g, 'survey.save', { fields: sv(g, { questions: [] }) }, me).ok, false);
  assert.strictEqual(call(g, 'survey.save', { fields: sv(g, { questions: [{ type: 'one', title: '보기 하나', options: ['하나'] }] }) }, me).ok, false);
  assert.strictEqual(call(g, 'survey.save', { fields: sv(g, { questions: [{ type: 'xx', title: 'x' }] }) }, me).ok, false);
  assert.strictEqual(call(g, 'survey.save', { fields: sv(g, { deadline: g.addDays_(g.todayYmd_(), -1) + ' 10:00' }) }, me).ok, false);
  assert.strictEqual(call(g, 'survey.save', { fields: sv(g, { deadline: '내일' }) }, me).ok, false);
});

test('CSV: 머리글·답·엑셀 수식 막기', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const id = call(g, 'survey.save', { fields: sv(g) }, owner).data.id;
  const qs = call(g, 'survey.get', { id }, owner).data.questions;
  call(g, 'survey.respond', { id, answers: { [qs[0].id]: '피구', [qs[2].id]: '=1+1' } }, who('심청'));
  const c = call(g, 'survey.csv', { id }, owner).data;
  assert.ok(c.filename.endsWith('응답.csv'));
  const lines = c.csv.split('\r\n');
  assert.ok(lines[0].startsWith('"이름","소속","낸 시각","1. 종목"'));
  assert.ok(lines[1].includes('"심청"') && lines[1].includes('"\'=1+1"'));
});

test('조사 지우기·휴지통 되살리기', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  const id = call(g, 'survey.save', { fields: sv(g) }, who('이몽룡')).data.id;
  assert.strictEqual(call(g, 'survey.delete', { id }, who('심청')).code, 'FORBIDDEN');
  call(g, 'survey.delete', { id }, who('이몽룡'));
  assert.ok(!call(g, 'survey.list', {}, who('이몽룡')).data.mine.some((c) => c.id === id));
  assert.strictEqual(call(g, 'admin.trash.surveys', {}, t).data[0].id, id);
  call(g, 'admin.trash.restoreSurvey', { id }, t);
  assert.ok(call(g, 'survey.list', {}, who('이몽룡')).data.mine.some((c) => c.id === id));
});

test('목록: 응답할 것·내가 만든 조사·지난 조사', () => {
  const g = freshName();
  const { L, who } = ids(g);
  g.seedTestSurveys_();
  const list = call(g, 'survey.list', {}, who('이몽룡')).data;
  assert.strictEqual(list.toAnswer.length, 2);
  assert.ok(list.toAnswer.every((c) => c.qCount > 0));
  const mineOwner = call(g, 'survey.list', {}, who('홍길동')).data.mine;
  assert.strictEqual(mineOwner.length, 2);
  assert.strictEqual(call(g, 'survey.list', {}, { login: L }).data.needIdentity, true);
  assert.throws(() => g.seedTestSurveys_(), /이미 조사가/);
});


// ================================================================ 4단계: 자료실·교직원·도움말·검색

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const cats = (g, kind) => plain(g.catOptions_(kind));

function libFields(g, extra) {
  return Object.assign({ '제목': '학년 협의록 양식', '설명': '협의 때 쓰는 양식', '부서ID': cats(g, '부서')[1].id, '분류ID': cats(g, '자료 분류')[1].id, '담당': '홍길동', mode: 'link', link: 'https://example.com/a' }, extra || {});
}

test('자료: 누구나 넣고, 처음 넣은 분·관리만 고치고 지운다', () => {
  const g = freshName();
  const { L, who, boss } = ids(g);
  assert.strictEqual(call(g, 'lib.save', { fields: libFields(g) }, { login: L }).code, 'IDENTITY');
  const r = call(g, 'lib.save', { fields: libFields(g) }, who('심청'));
  assert.strictEqual(r.ok, true, r.error);
  const it = r.data;
  assert.strictEqual(it.year, '2026');
  assert.strictEqual(it.dept, '연구부');
  assert.strictEqual(it.kind, '양식');
  assert.strictEqual(it.canEdit, true);
  assert.strictEqual(call(g, 'lib.save', { id: it.id, fields: libFields(g, { '제목': '남이 고침' }) }, who('흥부')).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'lib.delete', { id: it.id }, who('흥부')).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'lib.save', { id: it.id, fields: libFields(g, { '제목': '관리가 고침' }) }, boss('홍길동')).ok, true, '역할 관리');
  const list = call(g, 'lib.list', {}, who('흥부')).data;
  assert.strictEqual(list.items[0].title, '관리가 고침');
  assert.strictEqual(list.items[0].canEdit, false);
  assert.strictEqual(call(g, 'lib.delete', { id: it.id }, who('심청')).ok, true);
  assert.strictEqual(call(g, 'lib.list', {}, who('심청')).data.items.length, 0);
  const log = g.readRows_('기록').filter((x) => x['탭'] === '자료').map((x) => x['동작']);
  assert.deepStrictEqual(plain(log), ['추가', '수정', '삭제']);
});

test('자료 값 확인: 제목·https 링크·부서·분류', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  assert.match(call(g, 'lib.save', { fields: libFields(g, { '제목': '' }) }, me).error, /제목을/);
  assert.match(call(g, 'lib.save', { fields: libFields(g, { link: 'http://a.b' }) }, me).error, /https:\/\//);
  assert.match(call(g, 'lib.save', { fields: libFields(g, { link: 'javascript:alert(1)' }) }, me).error, /https:\/\//);
  assert.match(call(g, 'lib.save', { fields: libFields(g, { '부서ID': 'C없음' }) }, me).error, /부서를/);
  assert.match(call(g, 'lib.save', { fields: libFields(g, { '분류ID': cats(g, '부서')[0].id }) }, me).error, /자료 분류를/);
  assert.match(call(g, 'lib.save', { fields: libFields(g, { mode: 'file' }) }, me).error, /파일을 골라/);
});

test('파일 올리기: 비공개 자료 폴더에 만들고, 웹앱으로만 내려받는다', () => {
  const g = freshName();
  const { L, who } = ids(g);
  const file = { name: '../협의록:양식.hwp', type: 'application/x-hwp', data: b64('가짜 파일 내용') };
  const r = call(g, 'lib.save', { fields: libFields(g, { mode: 'file' }), file }, who('심청'));
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.data.hasFile, true);
  assert.strictEqual(r.data.fileName, '.. 협의록 양식.hwp', '경로·특수 글자는 빈칸으로');
  assert.strictEqual(r.data.fileSize, Buffer.byteLength('가짜 파일 내용'));
  assert.strictEqual(r.data.link, '');
  assert.ok(!('fileId' in r.data) && !JSON.stringify(r.data).includes('Fmock'), '드라이브 파일ID는 화면에 보내지 않음');
  const folderId = g.setting_('자료 폴더ID');
  assert.ok(folderId, '자료 폴더ID가 설정에 남음');
  const row = g.findRow_('자료', r.data.id);
  assert.strictEqual(g.DriveApp._store.files[row['파일ID']]._folder, folderId);
  const got = call(g, 'file.get', { tab: '자료', id: r.data.id }, { login: L });
  assert.strictEqual(got.ok, true, got.error);
  assert.strictEqual(Buffer.from(got.data.data, 'base64').toString('utf8'), '가짜 파일 내용');
  assert.strictEqual(got.data.type, 'application/x-hwp');
  assert.strictEqual(call(g, 'file.get', { tab: '자료', id: r.data.id }, {}).code, 'LOGIN');
  assert.strictEqual(call(g, 'file.get', { tab: '자료', id: row['파일ID'] }, { login: L }).code, 'NOTFOUND', '파일ID로 직접은 못 받음');
  // 링크로 바꿔도 드라이브 파일은 지우지 않는다
  call(g, 'lib.save', { id: r.data.id, fields: libFields(g) }, who('심청'));
  assert.strictEqual(g.DriveApp._store.files[row['파일ID']].isTrashed(), false);
  assert.strictEqual(call(g, 'file.get', { tab: '자료', id: r.data.id }, { login: L }).code, 'NOTFOUND');
});

test('파일 크기 한도: 설정값(MB)을 넘으면 받지 않는다', () => {
  const g = freshName();
  const { who } = ids(g);
  g.putSetting_('파일 크기 한도', '1', { id: '', name: '시험' });
  const big = Buffer.alloc(1024 * 1024 + 10, 65).toString('base64');
  const r = call(g, 'lib.save', { fields: libFields(g, { mode: 'file' }), file: { name: 'big.pdf', type: 'application/pdf', data: big } }, who('심청'));
  assert.match(r.error, /1MB까지/);
  assert.strictEqual(Object.keys(g.DriveApp._store.files).length, 0, '드라이브에 남지 않음');
  assert.match(call(g, 'lib.save', { fields: libFields(g, { mode: 'file' }), file: { name: 'a', data: '' } }, who('심청')).error, /읽지 못했/);
});

test('홈 자주 찾는 자료: 관리가 고른 것만, 일반 교직원의 표시는 무시', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const a = call(g, 'lib.save', { fields: libFields(g, { '제목': '가', home: true }) }, who('심청')).data;
  assert.strictEqual(a.home, false);
  const b = call(g, 'lib.save', { fields: libFields(g, { '제목': '나', home: true }) }, boss('홍길동')).data;
  assert.strictEqual(b.home, true);
  const home = call(g, 'home', {}, who('심청')).data;
  assert.deepStrictEqual(plain(home.library.map((x) => x.title)), ['나']);
});

test('공통 자료: 누구나 표시하고 순서 번호를 정한다. 새 학년도로 옮겨도 그대로', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  const me = who('심청');
  const a = call(g, 'lib.save', { fields: libFields(g, { '제목': '가정통신문 양식', common: true, commonOrder: '2' }) }, me);
  assert.strictEqual(a.ok, true, a.error);
  assert.strictEqual(a.data.common, true, '일반 교직원도 공통 표시');
  assert.strictEqual(a.data.commonOrder, '2');
  assert.strictEqual(a.data.dept, '연구부', '담당 부서는 그대로');
  assert.match(call(g, 'lib.save', { fields: libFields(g, { common: true, commonOrder: '첫째' }) }, me).error, /숫자로/);
  const b = call(g, 'lib.save', { fields: libFields(g, { '제목': '그냥 자료', common: false, commonOrder: '1' }) }, me).data;
  assert.strictEqual(b.common, false);
  assert.strictEqual(b.commonOrder, '', '공통이 아니면 순서는 비움');
  // 공통 표시를 빼면 순서도 비운다
  const c = call(g, 'lib.save', { id: a.data.id, fields: libFields(g, { '제목': '가정통신문 양식', common: false }) }, me).data;
  assert.strictEqual(c.common, false);
  assert.strictEqual(g.findRow_('자료', a.data.id)['공통 순서'], '');
  // 예전 화면처럼 공통 칸을 안 보내면 그대로 둔다
  call(g, 'lib.save', { id: a.data.id, fields: libFields(g, { '제목': '가정통신문 양식', common: true, commonOrder: '1' }) }, me);
  const kept = call(g, 'lib.save', { id: a.data.id, fields: libFields(g, { '제목': '가정통신문 양식(고침)' }) }, me).data;
  assert.strictEqual(kept.common, true);
  call(g, 'admin.year.start', { year: '2027', keep: [a.data.id] }, t);
  const moved = call(g, 'lib.list', {}, me).data.items.filter((x) => !x.archived);
  assert.strictEqual(moved.length, 1);
  assert.strictEqual(moved[0].common, true);
  assert.strictEqual(moved[0].commonOrder, '1');
});

test('새 학년도 넘기기: 지난 자료는 보관함으로, 고른 자료만 새 학년도로', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  const me = who('심청');
  const a = call(g, 'lib.save', { fields: libFields(g, { '제목': '가져갈 자료' }) }, me).data;
  const file = { name: '양식.hwp', type: 'application/x-hwp', data: b64('양식') };
  const b = call(g, 'lib.save', { fields: libFields(g, { '제목': '가져갈 파일', mode: 'file' }), file }, me).data;
  const c = call(g, 'lib.save', { fields: libFields(g, { '제목': '두고 갈 자료' }) }, me).data;
  const pv = call(g, 'admin.year.preview', {}, t).data;
  assert.strictEqual(pv.year, '2026');
  assert.strictEqual(pv.next, '2027');
  assert.strictEqual(pv.items.length, 3);
  assert.match(call(g, 'admin.year.start', { year: '2026', keep: [] }, t).error, /2026/);
  assert.strictEqual(call(g, 'admin.year.start', { year: '2027', keep: [] }, me).code, 'ADMIN');
  const r = call(g, 'admin.year.start', { year: '2027', keep: [a.id, b.id] }, t);
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(plain(r.data), { year: '2027', archived: 3, copied: 2 });
  assert.strictEqual(g.setting_('학년도'), '2027');
  const list = call(g, 'lib.list', {}, me).data;
  assert.strictEqual(list.year, '2027');
  const now = list.items.filter((x) => !x.archived), old = list.items.filter((x) => x.archived);
  assert.deepStrictEqual(plain(now.map((x) => x.title).sort()), ['가져갈 자료', '가져갈 파일']);
  assert.ok(now.every((x) => x.year === '2027' && x.canEdit), '처음 넣은 분이 계속 고칠 수 있음');
  assert.strictEqual(old.length, 3);
  assert.ok(old.every((x) => x.year === '2026'));
  // 옮긴 파일은 같은 파일을 가리켜 내려받을 수 있다
  const nb = now.find((x) => x.title === '가져갈 파일');
  assert.strictEqual(Buffer.from(call(g, 'file.get', { tab: '자료', id: nb.id }, me).data.data, 'base64').toString(), '양식');
  // 보관함 자료는 고칠 수 없다
  assert.match(call(g, 'lib.save', { id: c.id, fields: libFields(g) }, me).error, /보관함/);
  // 기록: 보관 한 줄 + 옮겨 적기 한 줄 + 학년도 설정
  const log = g.readRows_('기록');
  assert.ok(log.some((x) => x['동작'] === '보관' && x['바뀐 뒤'].includes(c.id)));
  assert.ok(log.some((x) => x['탭'] === '설정' && x['대상ID'] === '학년도'));
});

test('보관함에서 꺼내기: 관리만, 지금 학년도로 옮겨 적는다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who, boss } = ids(g);
  const a = call(g, 'lib.save', { fields: libFields(g, { '제목': '작년 자료' }) }, who('심청')).data;
  call(g, 'admin.year.start', { year: '2027', keep: [] }, t);
  assert.strictEqual(call(g, 'lib.unarchive', { id: a.id }, who('심청')).code, 'FORBIDDEN');
  const r = call(g, 'lib.unarchive', { id: a.id }, boss('홍길동'));
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.data.year, '2027');
  assert.strictEqual(r.data.archived, false);
  assert.strictEqual(call(g, 'lib.list', {}, who('심청')).data.items.length, 2);
});

test('자료·도움말 휴지통: 지운 것을 되살린다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  const a = call(g, 'lib.save', { fields: libFields(g) }, who('심청')).data;
  call(g, 'lib.delete', { id: a.id }, who('심청'));
  const h = call(g, 'help.save', { fields: { '분류ID': cats(g, '도움말 분류')[0].id, '제목': '안내', '내용': '학교에서 적는 글' } }, who('심청')).data;
  call(g, 'help.delete', { id: h.id }, who('심청'));
  const trash = call(g, 'admin.trash.library', {}, t).data;
  assert.strictEqual(trash.length, 2);
  call(g, 'admin.trash.restoreLibrary', { tab: '자료', id: a.id }, t);
  call(g, 'admin.trash.restoreLibrary', { tab: '도움말', id: h.id }, t);
  assert.strictEqual(call(g, 'lib.list', {}, who('심청')).data.items.length, 1);
  assert.strictEqual(call(g, 'help.list', {}, who('심청')).data.items.length, 1);
});

test('도움말: 누구나 쓰고, 처음 쓴 분·관리만 고친다. 파일도 붙인다', () => {
  const g = freshName();
  const { L, who, boss } = ids(g);
  const k = cats(g, '도움말 분류');
  assert.match(call(g, 'help.save', { fields: { '제목': '분류 없음', '내용': 'x' } }, who('심청')).error, /분류를/);
  assert.match(call(g, 'help.save', { fields: { '분류ID': k[0].id, '제목': '빈 글' } }, who('심청')).error, /내용을 적거나/);
  const h = call(g, 'help.save', { fields: { '분류ID': k[1].id, '제목': '학교 규칙', '내용': '' }, file: { name: '규칙.pdf', type: 'application/pdf', data: b64('pdf') } }, who('심청'));
  assert.strictEqual(h.ok, true, h.error);
  assert.strictEqual(h.data.hasFile, true);
  assert.strictEqual(h.data.kind, '학교 규칙·제규정');
  assert.strictEqual(Buffer.from(call(g, 'file.get', { tab: '도움말', id: h.data.id }, { login: L }).data.data, 'base64').toString(), 'pdf');
  assert.strictEqual(call(g, 'help.save', { id: h.data.id, fields: { '분류ID': k[1].id, '제목': '남이' , '내용': 'x' } }, who('흥부')).code, 'FORBIDDEN');
  call(g, 'help.save', { fields: { '분류ID': k[0].id, '제목': '나중 글', '내용': 'b', '순서': '2' } }, who('흥부'));
  call(g, 'help.save', { fields: { '분류ID': k[0].id, '제목': '먼저 글', '내용': 'a', '순서': '1' } }, who('흥부'));
  const list = call(g, 'help.list', {}, { login: L }).data;
  assert.deepStrictEqual(plain(list.items.map((x) => x.title)), ['먼저 글', '나중 글', '학교 규칙'], '분류 순서 → 순서 → 제목');
  // 파일 빼기
  const r = call(g, 'help.save', { id: h.data.id, fields: { '분류ID': k[1].id, '제목': '학교 규칙', '내용': '파일은 뺐어요', removeFile: true } }, boss('홍길동'));
  assert.strictEqual(r.data.hasFile, false);
});

test('교직원 명단: 사용 중인 분만, 비밀 칸·역할 없이', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { L, staff } = ids(g);
  call(g, 'admin.staff.setActive', { id: staff.find((x) => x.name === '놀부').id, active: false }, t);
  const d = call(g, 'staff.list', {}, { login: L }).data;
  assert.strictEqual(d.staff.length, 7);
  assert.ok(!d.staff.some((x) => x.name === '놀부'));
  const hong = d.staff.find((x) => x.name === '홍길동');
  assert.deepStrictEqual(Object.keys(hong).sort(), ['dept', 'deptId', 'duty', 'ext', 'group', 'id', 'name', 'position'].sort());
  assert.strictEqual(hong.ext, '101');
  assert.strictEqual(hong.dept, '연구부');
  assert.strictEqual(call(g, 'staff.list', {}, {}).code, 'LOGIN');
});

test('홈 검색: 자료·일정·교직원·도움말·조사를 한 번에 찾는다', () => {
  const g = freshName();
  const { L, who } = ids(g);
  g.seedTestSchedule_();
  g.seedTestSurveys_();
  g.seedTestLibrary_();
  const s = (q) => call(g, 'search', { q }, { login: L }).data;
  assert.ok(s('학적').library.items.some((x) => x.title.includes('학적')), '자료 제목');
  assert.ok(s('협의록').library.items.some((x) => x.hasFile), '파일 자료');
  assert.ok(s('체육대회').events.items.some((x) => x.title === '교직원 체육대회'), '일정');
  assert.ok(s('체육대회').surveys.items.length >= 1, '조사');
  assert.deepStrictEqual(plain(s('홍길동').staff.items.map((x) => x.name)), ['홍길동'], '교직원 이름');
  assert.ok(s('정보부').staff.total === 2, '부서로 교직원');
  assert.ok(s('101').staff.items[0].name === '홍길동', '내선');
  assert.ok(s('근무 상신').help.items.length === 1, '도움말 두 낱말');
  assert.ok(s('근무상신').help.items.length === 1, '띄어쓰기 무시');
  const old = s('업무 분장').library.items[0];
  assert.strictEqual(old.archived, true, '보관함 자료도 찾되 표시');
  const none = s('없는낱말xyz');
  assert.strictEqual(none.library.total + none.events.total + none.staff.total + none.help.total + none.surveys.total, 0);
  assert.strictEqual(s('  ').library.total, 0);
  assert.strictEqual(call(g, 'search', { q: '학적' }, {}).code, 'LOGIN');
  assert.ok(!JSON.stringify(s('홍길동')).includes('개인번호해시'));
  assert.strictEqual(who('심청').login, L);
});

test('가짜 자료·도움말: 빈 시트에만, 파일 3개·공통 3개·보관함 1개', () => {
  const g = freshName();
  const n = g.seedTestLibrary_();
  assert.strictEqual(n, 10);
  const items = plain(g.apiLibList_({}, {}, { identity: null, tokens: {} }).items);
  assert.strictEqual(items.filter((x) => x.hasFile).length, 3);
  assert.deepStrictEqual(items.filter((x) => x.common).map((x) => x.commonOrder).sort(), ['1', '2', '3']);
  assert.strictEqual(items.filter((x) => x.archived).length, 1);
  assert.throws(() => g.seedTestLibrary_(), /이미 내용이/);
  const help = g.readRows_('도움말');
  assert.ok(help.every((h) => h['제목'].includes('(예시)')), '도움말은 예시로만');
});


// ================================================================ 5단계: 학사일정 올리기·공지

const HEAD = ['시작일', '끝일', '시간', '행사명', '대상', '담당 부서', '장소', '구분', '메모', '중요'];

test('올리기: 날짜 모양 여러 가지를 읽고, 없는 날짜는 막는다', () => {
  const g = freshName();
  const d = (s) => { const o = plain(g.parseDay_(s, 2026)); return o.err !== undefined ? o : { ymd: o.ymd }; };
  assert.deepStrictEqual(d('2026-03-02'), { ymd: '2026-03-02' });
  assert.deepStrictEqual(d('2026. 3. 2.'), { ymd: '2026-03-02' });
  assert.deepStrictEqual(d('2026년 3월 2일'), { ymd: '2026-03-02' });
  assert.deepStrictEqual(d('3.2.(월)'), { ymd: '2026-03-02' });
  assert.deepStrictEqual(d('3월 2일 월요일'), { ymd: '2026-03-02' });
  assert.deepStrictEqual(d('1/5'), { ymd: '2027-01-05' }, '1·2월은 다음 해');
  assert.deepStrictEqual(d('46083'), { ymd: '2026-03-02' }, '엑셀 날짜 숫자');
  assert.match(d('10월 32일').err, /없는 날짜/);
  assert.match(d('2027-02-29').err, /없는 날짜/);
  assert.match(d('다음 주').err, /읽지 못했/);
  assert.strictEqual(g.parseTargetText_('3·4학년'), '3,4');
  assert.strictEqual(g.parseTargetText_('3~6학년'), '3,4,5,6');
  assert.strictEqual(g.parseTargetText_('전교'), '전체');
  assert.strictEqual(g.parseTargetText_('교직원'), '교직원');
  assert.strictEqual(g.parseTargetText_('1~6학년'), '전체');
});

test('올리기: 머리글을 찾아 줄을 읽고, 확인 필요·오류를 표시한다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  g.seedTestSchedule_();
  g.putSetting_('2학기 시작일', '2026-08-17', { id: '', name: '시험' });
  g.putSetting_('2학기 끝일', '2027-01-08', { id: '', name: '시험' });
  const mon = g.mondayOf_(g.todayYmd_());
  const grid = [
    ['2026학년도 학사일정'],
    HEAD,
    ['2026-10-32', '', '', '학교 밖 체험 안전교육', '전체', '인성안전부', '', '행사'],
    [mon, '', '', '교직원 협의회', '교직원', '교무부', '', '행사'],
    ['2026-11-02', '', '', '진로체험의 날', '5·6학년', '교무', '', ''],
    ['2026-11-03', '2026-11-04', '', '테스트 재량휴업', '전체', '', '', '재량휴업일'],
    ['2026-11-05', '', '', '독서 행사', '3~4', '도서부', '', '행사', '', 'O'],
    ['2026-11-05', '', '', '독서 행사', '3~4', '', '', '행사'],
    ['(예시) 학교운영위원회', '', '', '', '', '', '', ''],
    ['', '', '', '', ''],
    ['2026-11-09', '', '', '', '전체']
  ];
  const r = call(g, 'sched.upload.check', { grid }, t);
  assert.strictEqual(r.ok, true, r.error);
  const rows = r.data.rows;
  assert.strictEqual(rows.length, 8, '빈 줄은 빼고, 머리글 위 제목 줄도 건너뜀');
  assert.strictEqual(rows[0].status, 'error');
  assert.match(rows[0].msgs[0], /없는 날짜/);
  assert.strictEqual(rows[1].dup, 'dept', '부서가 넣은 행사와 같음');
  assert.strictEqual(rows[1].include, false);
  assert.strictEqual(rows[2].dept, '교무부', "'교무'도 교무부로");
  assert.strictEqual(rows[2].target, '5,6');
  assert.ok(rows[2].msgs.some((m) => /구분이 비어/.test(m)));
  assert.strictEqual(rows[2].include, true);
  assert.strictEqual(rows[3].kind, '휴업일');
  assert.strictEqual(rows[3].end, '2026-11-04');
  assert.ok(rows[4].msgs.some((m) => /도서부/.test(m)), '모르는 부서');
  assert.strictEqual(rows[4].important, true);
  assert.strictEqual(rows[5].dup, 'file');
  assert.strictEqual(rows[5].include, false);
  assert.strictEqual(rows[6].status, 'error', '예시 줄(날짜 없음)');
  assert.ok(rows[7].msgs.some((m) => /행사명이 비어/.test(m)));
  assert.strictEqual(r.data.counts.add, 3);
  // 수업일수 미리보기: 휴업일 이틀(평일)이 빠진다
  assert.strictEqual(r.data.days.now.total - r.data.days.after.total, 2);
});

test('올리기: 연구부장·부담당만, 머리글 없는 표는 양식 순서로 읽는다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const grid = [['2026-11-02', '', '5교시', '동아리 발표회', '전체', '연구부', '강당', '행사', '', '']];
  assert.strictEqual(call(g, 'sched.upload.check', { grid }, who('심청')).code, 'FORBIDDEN');
  const r = call(g, 'sched.upload.check', { grid }, boss('홍길동')).data;
  assert.strictEqual(r.rows[0].title, '동아리 발표회');
  assert.strictEqual(r.rows[0].time, '5교시');
  assert.strictEqual(r.rows[0].status, 'ok');
});

test('올리기 → 달력에 보이고, 다시 올리면 건너뛰기·바꾸기, 되돌리면 원래대로', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  const dept = call(g, 'sched.save', { fields: { start: '2026-11-10', title: '부서 행사', kind: '행사' } }, who('심청')).data;
  const grid = [HEAD, ['2026-11-09', '', '', '학예회', '전체', '교무부', '강당', '행사'], ['2026-11-10', '', '', '부서 행사', '전체', '', '', '행사'], ['2026-11-11', '', '', '재량휴업', '전체', '', '', '휴업일']];
  const first = call(g, 'sched.upload.check', { grid }, t).data;
  const s1 = call(g, 'sched.upload.save', { rows: first.rows.map((r) => r.raw), mode: 'skip' }, t);
  assert.strictEqual(s1.ok, true, s1.error);
  assert.strictEqual(s1.data.added, 2);
  assert.strictEqual(s1.data.skipped, 1, '부서가 넣은 행사는 건너뜀');
  let month = call(g, 'sched.month', { year: 2026, month: 11 }, t).data.events;
  assert.ok(month.some((e) => e.title === '학예회' && e.place === '강당'));
  assert.ok(month.some((e) => e.id === dept.id), '부서 행사 그대로');
  const batch1 = s1.data.batch;
  assert.ok(g.readRows_('일정').filter((e) => e['올린 묶음ID'] === batch1).length === 2);
  // 다시 올리기: 같은 행사 → 건너뛰기
  const again = call(g, 'sched.upload.check', { grid }, t).data;
  assert.strictEqual(again.counts.dupUpload, 2);
  assert.match(call(g, 'sched.upload.save', { rows: again.rows.map((r) => r.raw), mode: 'skip' }, t).error, /올릴 행사가 없어요/);
  // 장소를 고쳐서 바꾸기
  const grid2 = grid.map((l) => l.slice());
  grid2[1][6] = '체육관';
  g.__clock.offset += 2000;
  const rows2 = call(g, 'sched.upload.check', { grid: grid2, mode: 'replace' }, t).data;
  assert.strictEqual(rows2.counts.replace, 2);
  const s2 = call(g, 'sched.upload.save', { rows: rows2.rows.map((r) => r.raw), mode: 'replace' }, t).data;
  assert.strictEqual(s2.replaced, 2);
  month = call(g, 'sched.month', { year: 2026, month: 11 }, t).data.events;
  assert.deepStrictEqual(plain(month.filter((e) => e.title === '학예회').map((e) => e.place)), ['체육관'], '전 것은 숨기고 새것만');
  // 되돌리기: 방금 올린 것만
  assert.match(call(g, 'sched.upload.undo', { batch: batch1 }, t).error, /방금 올린 것만/);
  const u = call(g, 'sched.upload.undo', { batch: s2.batch }, t).data;
  assert.deepStrictEqual(plain(u), { removed: 2, restored: 2 });
  month = call(g, 'sched.month', { year: 2026, month: 11 }, t).data.events;
  assert.deepStrictEqual(plain(month.filter((e) => e.title === '학예회').map((e) => e.place)), ['강당'], '바꿨던 전 행사가 되살아남');
  assert.ok(month.some((e) => e.id === dept.id));
  assert.match(call(g, 'sched.upload.undo', { batch: s2.batch }, t).error, /방금 올린 것만/, '두 번 되돌리기 안 됨');
  assert.ok(g.readRows_('기록').some((x) => /학사일정 올리기 되돌림/.test(x['요약'])));
});

test('올리기: 미리보기에서 뺀 줄은 올리지 않는다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const grid = [HEAD, ['2026-11-09', '', '', '가 행사', '', '', '', '행사'], ['2026-11-10', '', '', '나 행사', '', '', '', '행사']];
  const rows = call(g, 'sched.upload.check', { grid }, t).data.rows.map((r) => r.raw);
  rows[1].include = false;
  const s = call(g, 'sched.upload.save', { rows, mode: 'skip' }, t).data;
  assert.strictEqual(s.added, 1);
  assert.ok(!call(g, 'sched.month', { year: 2026, month: 11 }, t).data.events.some((e) => e.title === '나 행사'));
});

test('공지: 누구나 쓰고, 쓴 분·관리만 고치고, 고정은 관리만, 끝일이 지나면 홈에서 내려간다', () => {
  const g = freshName();
  const { L, who, boss } = ids(g);
  const today = g.todayYmd_();
  assert.strictEqual(call(g, 'notice.save', { fields: { '제목': 'x' } }, { login: L }).code, 'IDENTITY');
  const a = call(g, 'notice.save', { fields: { '제목': '체육대회 안내', '내용': '금요일 5교시', '게시 끝일': g.addDays_(today, 3), pinned: true } }, who('심청'));
  assert.strictEqual(a.ok, true, a.error);
  assert.strictEqual(a.data.pinned, false, '일반 교직원은 고정 못 함');
  assert.strictEqual(a.data.active, true);
  const b = call(g, 'notice.save', { fields: { '제목': '연수 안내', pinned: true } }, boss('홍길동')).data;
  assert.strictEqual(b.pinned, true);
  const old = call(g, 'notice.save', { fields: { '제목': '지난 안내', '게시 끝일': g.addDays_(today, -1) } }, who('심청')).data;
  assert.strictEqual(old.active, false);
  assert.strictEqual(call(g, 'notice.save', { id: a.data.id, fields: { '제목': '남이 고침' } }, who('흥부')).code, 'FORBIDDEN');
  assert.match(call(g, 'notice.save', { fields: { '제목': 'y', '링크': 'http://x' } }, who('심청')).error, /https/);
  assert.match(call(g, 'notice.save', { fields: { '제목': 'y', '게시 끝일': '내일' } }, who('심청')).error, /날짜/);
  const home = call(g, 'home', {}, who('흥부')).data.notices;
  assert.deepStrictEqual(plain(home.items.map((n) => n.title)), ['연수 안내', '체육대회 안내'], '고정 먼저, 지난 공지는 빠짐');
  const list = call(g, 'notice.list', {}, who('흥부')).data.items;
  assert.strictEqual(list[list.length - 1].title, '지난 안내');
  assert.ok(call(g, 'search', { q: '체육대회' }, { login: L }).data.notices.total === 1);
  call(g, 'notice.delete', { id: a.data.id }, who('심청'));
  assert.strictEqual(call(g, 'home', {}, who('흥부')).data.notices.total, 1);
  const { t } = adminTokens(g);
  assert.ok(call(g, 'admin.trash.library', {}, t).data.some((x) => x.tab === '공지'));
  call(g, 'admin.trash.restoreLibrary', { tab: '공지', id: a.data.id }, t);
  assert.strictEqual(call(g, 'home', {}, who('흥부')).data.notices.total, 2);
  assert.strictEqual(g.seedTestNotices_ && 1, 1);
});


// ================================================================ 마지막 점검에서 고친 것

test('매일 백업: 진짜 시간 트리거만 백업하고, 웹앱에서 부르면 아무것도 하지 않는다', () => {
  const g = freshName();
  let made = 0;
  g.backupNow_ = () => { made++; return {}; };
  g.ScriptApp = { getProjectTriggers: () => [{ getHandlerFunction: () => 'dailyBackup', getUniqueId: () => '777' }] };
  g.dailyBackup();
  g.dailyBackup({});
  g.dailyBackup({ triggerUid: '123' });
  assert.strictEqual(made, 0, '트리거가 아니면 백업하지 않음');
  g.dailyBackup({ triggerUid: '777' });
  assert.strictEqual(made, 1);
});

test('시트에 쓰는 글자는 모두 앞에 \' 를 붙여 날짜·숫자로 바뀌지 않는다', () => {
  const g = freshName();
  for (const v of ['3-1', '1e3', '0101', '=1+1', '홍길동', '₩1,000']) assert.strictEqual(g.cellWrite_(v), "'" + v);
  assert.strictEqual(g.cellWrite_(''), '');
  const { who } = ids(g);
  const e = call(g, 'sched.save', { fields: { start: '2026-11-03', title: '반 모임', place: '3-1' } }, who('심청')).data;
  assert.strictEqual(e.place, '3-1');
});

test('학사일정 바꾸기·되돌리기로 숨긴 일정도 휴지통에 누가 숨겼는지 보인다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const grid = [HEAD, ['2026-11-09', '', '', '학예회', '전체', '', '강당', '행사']];
  const rows = call(g, 'sched.upload.check', { grid }, t).data.rows.map((r) => r.raw);
  const s = call(g, 'sched.upload.save', { rows, mode: 'skip' }, t).data;
  call(g, 'sched.upload.undo', { batch: s.batch }, t);
  const tr = call(g, 'admin.trash.list', {}, t).data.find((e) => e.title === '학예회');
  assert.ok(tr.deletedBy, '숨긴 사람이 남음');
  assert.ok(tr.deletedAt);
});

test('머리글 없는 칸에 선생님이 적어 둔 글은 고칠 때 지워지지 않는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const e = call(g, 'sched.save', { fields: { start: '2026-11-03', title: '반 모임' } }, who('심청')).data;
  const sh = g._ss.getSheetByName('일정');
  const r = sh.data.findIndex((l) => l[0] === e.id);
  const col = sh.data[0].length + 1; // 머리글 없는 칸
  sh.put(r + 1, col, '손으로 적은 메모');
  sh.put(1, col, ''); // 머리글은 비어 있음
  call(g, 'sched.save', { id: e.id, fields: { start: '2026-11-03', title: '반 모임(고침)' } }, who('심청'));
  assert.strictEqual(sh.data[r][col - 1], '손으로 적은 메모');
});

test("관리 권한: 이름만 방식에서는 역할 '관리'라도 관리자 화면이 열려야 하고, 개인 번호 방식에서는 역할만으로 된다", () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const id = call(g, 'survey.save', { fields: sv(g) }, who('심청')).data.id;
  assert.strictEqual(call(g, 'survey.get', { id }, who('홍길동')).data.canSeeResults, false, '이름만 고른 관리 역할은 결과 못 봄');
  assert.strictEqual(call(g, 'survey.delete', { id }, who('홍길동')).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'sched.upload.check', { grid: [] }, who('홍길동')).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'survey.get', { id }, boss('홍길동')).data.canSeeResults, true, '관리자 화면을 열면 됨');
  const p = fresh();
  const pi = adminTokens(p);
  const hong = call(p, 'verify', { staffId: pi.staff.find((x) => x.name === '홍길동').id, pin: '1111' }, { login: pi.L }).data.identity;
  const sim = call(p, 'verify', { staffId: pi.staff.find((x) => x.name === '심청').id, pin: '1111' }, { login: pi.L }).data.identity;
  const id2 = call(p, 'survey.save', { fields: sv(p) }, { login: pi.L, identity: sim }).data.id;
  assert.strictEqual(call(p, 'survey.get', { id: id2 }, { login: pi.L, identity: hong }).data.canSeeResults, true, '개인 번호 방식에서는 역할만으로 관리');
});


// ================================================================ 최종 점검 뒤 보완: 점검 탭·속도·명단 한 번에 넣기·새 공지

test('파일 하나가 빠져도 그 기능만 멈추고, 홈·세션은 열리며, 원인 한 줄을 돌려준다', () => {
  const g = freshName();
  const { who } = ids(g);
  g.apiHelpList_ = undefined; // Help.gs가 빠진 상황
  g.homeNotices_ = undefined;
  g.latestNoticeAt_ = undefined;
  const r = call(g, 'help.list', {}, who('심청'));
  assert.strictEqual(r.code, 'MISSING');
  assert.match(r.error, /apiHelpList_/);
  assert.strictEqual(call(g, 'session', {}, who('심청')).ok, true, '세션은 열림');
  const home = call(g, 'home', {}, who('심청'));
  assert.strictEqual(home.ok, true, '홈도 열림');
  assert.strictEqual(home.data.notices.total, 0);
  g.apiStaffDir_ = undefined; // 함수 안에서 부르는 다른 파일 함수가 없을 때
  const s = call(g, 'staff.list', {}, who('심청'));
  assert.strictEqual(s.code, 'ERROR');
  assert.match(s.detail, /apiStaffDir_/, '원인 한 줄');
});

test('점검: 최신이면 문제 없음, 빠진 파일·예전 화면 파일·빈 학기·꺼진 백업을 알려 준다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const b = g.fileBuilds_();
  const client = { app: b.App, styles: b.Styles, index: b.Index };
  let r = call(g, 'admin.check', { client }, t).data;
  const by = (label) => r.items.find((x) => x.label === label);
  for (const f of ['Code.gs', 'Db.gs', 'Survey.gs', 'Help.gs', 'App.html', 'Styles.html', 'Index.html', '기능 연결', '탭과 칸', '공통 비밀번호']) assert.strictEqual(by(f).state, 'ok', f);
  assert.strictEqual(by('학기 기간').state, 'warn');
  assert.strictEqual(by('매일 자동 백업').state, 'warn', '트리거 없음');
  assert.strictEqual(call(g, 'admin.check', { client }, ids(g).who('심청')).code, 'ADMIN');
  g.fileMark_Help_ = undefined;
  g.apiHelpList_ = undefined;
  r = call(g, 'admin.check', { client: { app: '2020-01-01', styles: g.APP_BUILD_ } }, t).data;
  assert.strictEqual(by('Help.gs').state, 'bad');
  assert.strictEqual(by('기능 연결').state, 'bad');
  assert.match(by('기능 연결').detail, /apiHelpList_/);
  assert.strictEqual(by('App.html').state, 'warn');
  assert.strictEqual(by('Index.html').state, 'warn', '판 표시가 없으면');
  // 시트에서 직접 비운 줄(손으로 고치면 시트가 onEdit를 불러 서버 기억을 버린다)
  const sh = g._ss.getSheetByName('교직원');
  sh.data[3] = sh.data[3].map(() => '');
  g.onEdit({});
  r = call(g, 'admin.check', { client }, t).data;
  assert.strictEqual(by('교직원 탭 빈 줄').state, 'warn');
});

test('속도: 한 요청 안에서 같은 탭을 두 번 읽지 않는다(쓰면 다시 읽는다)', () => {
  const g = freshName();
  const { who } = ids(g);
  g.seedTestSchedule_();
  const me = who('심청');
  g._ss.sheets.forEach((x) => { x.reads = 0; });
  call(g, 'home', {}, me);
  const tabsRead = g._ss.sheets.filter((x) => x.reads).length;
  const total = g._ss.sheets.reduce((n, x) => n + (x.reads || 0), 0);
  assert.strictEqual(total, tabsRead, '탭마다 한 번씩만');
  const e = call(g, 'sched.save', { fields: { start: '2026-10-21', title: '방금 넣은 행사' } }, me).data;
  assert.strictEqual(e.title, '방금 넣은 행사', '쓴 뒤 다시 읽어 최신 값');
  assert.ok(call(g, 'sched.month', { year: 2026, month: 10 }, me).data.events.some((x) => x.id === e.id));
});

test('교직원 명단 한 번에 넣기: 머리글 찾기, 휴대폰 번호 막기, 같은 분 건너뛰기, 기록 한 줄', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const grid = [
    ['2026학년도 교직원 현황'],
    ['순번', '성명', '직위', '소속', '부서', '담당 업무', '내선번호'],
    ['1', '전우치', '교사', '2학년 2반', '교무', '생활기록부', '109'],
    ['2', '박씨', '수석교사', '', '연구부', '수업 컨설팅', '010-1234-5678'],
    ['3', '홍길동', '교사', '3학년 1반', '연구부', '', '101'],
    ['4', '', '교사', '4학년 2반', '', '', ''],
    ['5', '임꺽정', '교사', '5학년 2반', '체육부', '', '1 1 0'],
    ['6', '전우치', '교사', '2학년 2반', '', '', '']
  ];
  assert.strictEqual(call(g, 'admin.staff.importCheck', { grid }, ids(g).who('심청')).code, 'ADMIN');
  const r = call(g, 'admin.staff.importCheck', { grid }, t);
  assert.strictEqual(r.ok, true, r.error);
  const rows = r.data.rows;
  assert.strictEqual(rows.length, 6);
  assert.strictEqual(rows[0].dept, '교무부', "'교무'도 교무부로");
  assert.strictEqual(rows[0].order, '1');
  assert.strictEqual(rows[1].ext, '', '휴대폰 번호는 넣지 않음');
  assert.ok(rows[1].msgs.some((m) => /휴대폰/.test(m)));
  assert.strictEqual(rows[2].dup, 'exists');
  assert.strictEqual(rows[3].status, 'error');
  assert.ok(rows[4].msgs.some((m) => /체육부/.test(m)));
  assert.strictEqual(rows[4].ext, '110', '띄어쓰기는 빼고 숫자만');
  assert.strictEqual(rows[5].dup, 'file');
  assert.strictEqual(r.data.counts.add, 3);
  const before = g.readRows_('기록').length;
  const s = call(g, 'admin.staff.import', { rows: rows.map((x) => Object.assign({}, x.raw, { include: x.include })) }, t).data;
  assert.deepStrictEqual(plain(s), { added: 3, skipped: 3 });
  assert.strictEqual(g.readRows_('기록').length, before + 1, '기록은 한 줄');
  const dir = call(g, 'staff.list', {}, { login: t.login }).data.staff;
  assert.ok(dir.some((p) => p.name === '임꺽정' && p.ext === '110'));
  assert.ok(!JSON.stringify(dir).includes('010-1234'));
});

test('새 공지 표시: 세션에 지금 걸린 공지 중 가장 최근 시각이 온다', () => {
  const g = freshName();
  const { who } = ids(g);
  assert.strictEqual(call(g, 'session', {}, who('심청')).data.noticeLatest, '');
  const n = call(g, 'notice.save', { fields: { '제목': '새 안내' } }, who('심청')).data;
  assert.strictEqual(call(g, 'session', {}, who('흥부')).data.noticeLatest, n.at);
});

// ---------------------------------------------------------------- 학생 수 현황 (홈)

test('판 표시: 파일마다 판 표의 판과 같다(고친 파일만 판을 올림)', () => {
  const g = freshName();
  const b = g.fileBuilds_();
  for (const f of ['Code', 'Db', 'Auth', 'Admin', 'Schedule', 'Survey', 'Library', 'Help', 'Setup']) assert.strictEqual(g['fileMark_' + f + '_'](), b[f], f);
  const read = (f) => fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
  assert.strictEqual(/var APP_FILE_BUILD = '([^']+)'/.exec(read('App.html'))[1], b.App);
  assert.strictEqual(/--gy-build:"([^"]+)"/.exec(read('Styles.html'))[1], b.Styles);
  assert.strictEqual(/<meta name="gy-build" content="([^"]+)">/.exec(read('Index.html'))[1], b.Index);
  assert.ok(Object.keys(b).every((f) => b[f] <= g.APP_BUILD_), 'APP_BUILD_는 가장 최근 판');
});

test('학생 수: 탭이 없던 시트에서도 홈이 열리고, 처음 넣으면 탭이 생긴다', () => {
  const g = freshName();
  const { who } = ids(g);
  g._ss.sheets = g._ss.sheets.filter((x) => x.name !== '학생수'); // 이 기능 전에 설치한 시트
  let h = call(g, 'home', {}, who('심청'));
  assert.ok(h.ok, h.error);
  assert.strictEqual(h.data.students.id, '');
  assert.strictEqual(h.data.students.total, null);
  const today = g.todayYmd_();
  const r = call(g, 'students.save', { date: today, grades: [60, 61, 62, 63, 64, 65] }, who('심청'));
  assert.ok(r.ok, r.error);
  assert.ok(g._ss.getSheetByName('학생수'), '탭이 생김');
  assert.deepStrictEqual(plain(g.headOf_('학생수')), plain(g.tabs_()['학생수']));
  assert.strictEqual(r.data.total, 375, '전체는 학년별을 더한 값');
  h = call(g, 'home', {}, who('흥부')).data;
  assert.deepStrictEqual(plain(h.students.grades), [60, 61, 62, 63, 64, 65]);
  assert.strictEqual(h.students.date, today);
  assert.strictEqual(h.students.by, '심청');
});

test('학생 수: 이름을 고른 교직원 누구나 고치고, 학년도마다 한 줄, 기록에 바뀌기 전·후가 남는다', () => {
  const g = freshName();
  const { L, who } = ids(g);
  const today = g.todayYmd_();
  assert.strictEqual(call(g, 'students.save', { date: today, grades: [1, 2, 3, 4, 5, 6] }, { login: L }).code, 'IDENTITY', '이름을 고르지 않으면 못 고침');
  assert.strictEqual(call(g, 'students.save', { date: today, grades: [1, 2, 3, 4, 5, 6] }, {}).code, 'LOGIN');
  assert.ok(call(g, 'students.save', { date: today, grades: [10, 20, 30, 40, 50, 60] }, who('심청')).ok);
  const r = call(g, 'students.save', { date: today, grades: ['10', '20', '30', ' 41 ', '50', '060'] }, who('흥부')).data;
  assert.deepStrictEqual(plain(r.grades), [10, 20, 30, 41, 50, 60], '띄어쓰기·앞자리 0은 정리');
  assert.strictEqual(r.total, 211);
  assert.strictEqual(r.by, '흥부');
  assert.strictEqual(g.liveRows_('학생수').length, 1, '같은 학년도는 한 줄을 고침');
  const log = g.readRows_('기록').filter((x) => x['탭'] === '학생수');
  assert.strictEqual(log.length, 2);
  assert.strictEqual(log[0]['동작'], '추가');
  assert.strictEqual(log[1]['동작'], '수정');
  assert.strictEqual(log[1]['이름'], '흥부');
  assert.deepStrictEqual(JSON.parse(log[1]['바뀌기 전']), { '4학년': '40' });
  assert.deepStrictEqual(JSON.parse(log[1]['바뀐 뒤']), { '4학년': '41' });
  const before = g.readRows_('기록').length;
  call(g, 'students.save', { date: today, grades: [10, 20, 30, 41, 50, 60] }, who('흥부'));
  assert.strictEqual(g.readRows_('기록').length, before, '바뀐 것이 없으면 기록하지 않음');
});

test('학생 수: 숫자가 아니거나 범위를 벗어나면 저장하지 않는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  const today = g.todayYmd_();
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const from = (m >= 3 ? y : y - 1) + '-03-01';
  const bad = [
    [{ date: today, grades: [1, 2, 3, 4, 5] }, /모두/],
    [{ date: today, grades: [1, 'x', 3, 4, 5, 6] }, /2학년/],
    [{ date: today, grades: [1, 2, 3, 4, 5, 1000] }, /6학년/],
    [{ date: today, grades: [1, 2, -3, 4, 5, 6] }, /3학년/],
    [{ date: today, grades: [1, 2, 3, '', 5, 6] }, /4학년/],
    [{ date: today, grades: [1.5, 2, 3, 4, 5, 6] }, /1학년/],
    [{ date: '', grades: [1, 2, 3, 4, 5, 6] }, /기준일/],
    [{ date: g.addDays_(today, 1), grades: [1, 2, 3, 4, 5, 6] }, /오늘까지/],
    [{ date: g.addDays_(from, -1), grades: [1, 2, 3, 4, 5, 6] }, /이번 학년도/],
    [{ date: today }, /모두/]
  ];
  for (const [args, re] of bad) {
    const r = call(g, 'students.save', args, me);
    assert.strictEqual(r.ok, false, JSON.stringify(args));
    assert.match(r.error, re, JSON.stringify(args));
  }
  assert.strictEqual(g.liveRows_('학생수').length, 0);
  assert.ok(call(g, 'students.save', { date: from, grades: [0, 0, 0, 0, 0, 999] }, me).ok, '학년도 첫날·0명·999명은 괜찮음');
});

test('학생 수: 새 학년도가 되면 비어 있고, 지난 학년도 숫자는 시트에 그대로 남는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const today = g.todayYmd_();
  call(g, 'students.save', { date: today, grades: [10, 20, 30, 40, 50, 60] }, who('심청'));
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const nextYear = (m >= 3 ? y + 1 : y) + '-03-02';
  g.__clock.offset = Date.parse(nextYear + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z');
  assert.strictEqual(g.todayYmd_(), nextYear);
  const h = call(g, 'home', {}, ids(g).who('흥부')).data;
  assert.strictEqual(h.students.year, Number(nextYear.slice(0, 4)));
  assert.strictEqual(h.students.id, '');
  assert.strictEqual(g.liveRows_('학생수').length, 1);
});

test('학생 수 반별: 반마다 남·여를 넣으면 학년·전체·남녀 합계가 맞고, 반별 칸에 남는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const today = g.todayYmd_();
  const classes = { 1: [[12, 13], [11, 14]], 2: [[10, 10]], 3: [[14, 15], [16, 10], [11, 12]], 4: [[13, 14]], 5: [], 6: [[0, 0]] };
  const r = call(g, 'students.save', { date: today, classes }, who('심청'));
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(plain(r.data.grades), [50, 20, 78, 27, 0, 0]);
  assert.strictEqual(r.data.total, 175);
  assert.strictEqual(r.data.boys, 87);
  assert.strictEqual(r.data.girls, 88);
  assert.deepStrictEqual(plain(r.data.classes['3']), [[14, 15], [16, 10], [11, 12]]);
  assert.deepStrictEqual(plain(r.data.classes['5']), []);
  const row = g.liveRows_('학생수')[0];
  assert.strictEqual(row['3학년'], '78');
  assert.deepStrictEqual(JSON.parse(row['반별'])['1'], [[12, 13], [11, 14]]);
  const h = call(g, 'home', {}, who('흥부')).data;
  assert.strictEqual(h.students.boys, 87);
  // 숫자를 글자로 보내도(화면 입력 그대로) 된다
  assert.ok(call(g, 'students.save', { date: today, classes: { 1: [['12', '13']], 2: [], 3: [], 4: [], 5: [], 6: [] } }, who('심청')).ok);
});

test('학생 수 반별: 숫자가 아니거나 한도를 넘으면 몇 학년 몇 반인지 알려 주고 저장하지 않는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  const today = g.todayYmd_();
  const base = () => ({ 1: [[1, 1]], 2: [[1, 1]], 3: [[1, 1], [2, 2]], 4: [[1, 1]], 5: [[1, 1]], 6: [[1, 1]] });
  const cases = [
    [(c) => { c[3][1] = [2, 'x']; }, /3학년 2반 여학생/],
    [(c) => { c[1][0] = ['', 1]; }, /1학년 1반 남학생/],
    [(c) => { c[6][0] = [100, 1]; }, /6학년 1반 남학생 수를 0부터 99까지/],
    [(c) => { c[2][0] = [-1, 1]; }, /2학년 1반 남학생/],
    [(c) => { c[4][0] = [1.5, 1]; }, /4학년 1반 남학생/],
    [(c) => { c[5][0] = [1]; }, /5학년 1반 여학생/],
    [(c) => { c[1] = Array.from({ length: 21 }, () => [1, 1]); }, /1학년 반은 20개까지/],
    [(c) => { c[2] = 'abc'; }, /2학년 반은 20개까지/]
  ];
  for (const [bad, re] of cases) {
    const c = base();
    bad(c);
    const r = call(g, 'students.save', { date: today, classes: c }, me);
    assert.strictEqual(r.ok, false, String(re));
    assert.match(r.error, re);
  }
  assert.strictEqual(g.liveRows_('학생수').length, 0);
});

test('학생 수 반별: 학년 합계만 넣는 예전 화면으로 저장하면 반별은 비워서 합계와 어긋나지 않게', () => {
  const g = freshName();
  const { who } = ids(g);
  const today = g.todayYmd_();
  call(g, 'students.save', { date: today, classes: { 1: [[12, 13]], 2: [], 3: [], 4: [], 5: [], 6: [] } }, who('심청'));
  const r = call(g, 'students.save', { date: today, grades: [30, 20, 20, 20, 20, 20] }, who('심청')).data;
  assert.strictEqual(r.classes, null);
  assert.strictEqual(r.boys, null);
  assert.strictEqual(r.total, 130);
  assert.strictEqual(g.liveRows_('학생수')[0]['반별'], '');
});

test('학생 수 반별: 반별 칸이 없는 예전 학생수 탭이면 처음 저장할 때 칸을 더한다', () => {
  const g = freshName();
  const { who } = ids(g);
  const sh = g._ss.getSheetByName('학생수');
  const head = g.tabs_()['학생수'].filter((h) => h !== '반별');
  sh.data = [head.slice()]; // 지난 판으로 만든 탭(반별 칸 없음)
  const today = g.todayYmd_();
  const r = call(g, 'students.save', { date: today, classes: { 1: [[5, 6]], 2: [], 3: [], 4: [], 5: [], 6: [] } }, who('심청'));
  assert.ok(r.ok, r.error);
  assert.ok(g.headOf_('학생수').includes('반별'));
  assert.deepStrictEqual(plain(r.data.classes['1']), [[5, 6]]);
});

test('학생 수 반별: 넣기 창의 처음 반 수는 교직원 소속(○학년 ○반)에서만 가져온다', () => {
  const g = freshName();
  const { who } = ids(g);
  const h = call(g, 'home', {}, who('심청')).data;
  // 가짜 명단: 3학년 1·2반, 4학년 1반, 5학년 1반, 6학년 2반, 2학년 1반, 1학년 1반
  assert.deepStrictEqual(plain(h.students.hints), { 1: 1, 2: 1, 3: 2, 4: 1, 5: 1, 6: 2 });
});

// ---------------------------------------------------------------- 속도: 왕복 줄이기

test('속도: ping은 로그인 없이 시트를 읽지 않고 답한다', () => {
  const g = freshName();
  g._ss.sheets.forEach((x) => { x.reads = 0; });
  const r = call(g, 'ping', {});
  assert.ok(r.ok);
  assert.ok(r.data.at > 0);
  assert.strictEqual(g._ss.sheets.reduce((n, x) => n + (x.reads || 0), 0), 0);
});

test('속도: boot 한 번으로 시작 정보·로그인 상태·홈을 받는다(로그인이 없으면 LOGIN)', () => {
  const g = freshName();
  const { who } = ids(g);
  g.seedTestSchedule_();
  const me = who('심청');
  const b = call(g, 'boot', { home: true }, me);
  assert.ok(b.ok, b.error);
  assert.strictEqual(b.data.start.ready, true);
  assert.strictEqual(b.data.session.me.name, '심청');
  assert.ok(Array.isArray(b.data.home.events));
  assert.deepStrictEqual(plain(b.data.home), plain(call(g, 'home', {}, me).data), '홈과 같은 내용');
  assert.strictEqual(call(g, 'boot', {}, me).data.home, undefined, '홈을 바로 그리지 않을 때는 홈 없이');
  assert.strictEqual(call(g, 'boot', {}, {}).code, 'LOGIN');
  assert.strictEqual(call(g, 'boot', {}, { login: 'x.y' }).code, 'LOGIN');
});

test('속도: 저장하면서 이어 읽을 화면(then)을 같은 요청으로 받는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  const today = g.todayYmd_();
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const r = JSON.parse(g.api(JSON.stringify({ action: 'sched.save', args: { fields: { start: today, title: '이어 읽기 시험' } }, tokens: me,
    then: [['sched.month', { year: y, month: m }], ['home', {}]] })));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.then.length, 2);
  assert.ok(r.then[0].data.events.some((e) => e.title === '이어 읽기 시험'), '방금 넣은 일정이 달력에');
  assert.ok(r.then[1].data.events.some((e) => e.title === '이어 읽기 시험'), '홈에도');
  // 쓰기·관리자 요청은 이어서 부를 수 없다(읽기만), 모르는 이름도 null
  const r2 = JSON.parse(g.api(JSON.stringify({ action: 'notice.save', args: { fields: { '제목': '공지 시험' } }, tokens: me,
    then: [['sched.save', { fields: { start: today, title: '몰래 넣기' } }], ['admin.settings.get', {}], ['notice.list', {}]] })));
  assert.ok(r2.ok, r2.error);
  assert.strictEqual(r2.then[0], null);
  assert.strictEqual(r2.then[1], null);
  assert.ok(r2.then[2].data.items.some((n) => n.title === '공지 시험'));
  const r3 = JSON.parse(g.api(JSON.stringify({ action: 'notice.list', args: {}, tokens: me, then: [['없는 요청', {}], 'x', ['home', {}], ['home', {}]] })));
  assert.strictEqual(r3.then.length, 3, '이어 읽기는 3개까지');
  assert.strictEqual(r3.then[0], null);
  assert.strictEqual(r3.then[1], null);
  assert.ok(r3.then[2].data.events);
  assert.ok(!g.liveRows_('일정').some((e) => e['행사명'] === '몰래 넣기'), '이어 읽기로는 저장되지 않음');
  // then이 없으면 예전처럼
  assert.strictEqual(JSON.parse(g.api(JSON.stringify({ action: 'notice.list', args: {}, tokens: me }))).then, undefined);
});

test('속도 재기(관리자): 화면마다 서버 처리·시트 열기·탭 읽기를 잰다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  assert.strictEqual(call(g, 'admin.speed', {}, ids(g).who('심청')).code, 'ADMIN');
  const r = call(g, 'admin.speed', {}, t);
  assert.ok(r.ok, r.error);
  const labels = r.data.items.map((x) => x.label);
  assert.deepStrictEqual(labels, ['홈', '일정(달력)', '조사·신청', '자료실', '공지', '도움말', '교직원']);
  for (const x of r.data.items) {
    assert.ok(!x.error, x.label + ' ' + x.error);
    assert.ok(x.sheet.reads >= 1, x.label + ' 시트에서 읽기 ' + x.sheet.reads);
    assert.strictEqual(x.sheet.hits, 0, x.label + ' 시트에서 잴 때는 기억을 쓰지 않음');
    assert.strictEqual(x.memo.reads, 0, x.label + ' 기억에서 잴 때는 시트를 읽지 않음');
    assert.strictEqual(x.memo.hits, x.sheet.reads, x.label + ' 같은 탭을 기억에서');
  }
  assert.strictEqual(r.data.items[0].sheet.reads, 11, '홈은 탭 11개');
  assert.strictEqual(r.data.memoOn, true);
});

// ---------------------------------------------------------------- 서버 기억(CacheService)

/** 요청 하나가 시트 탭을 몇 번 읽었는지 */
function sheetReads(g, fn) {
  g._ss.sheets.forEach((x) => { x.reads = 0; });
  const out = fn();
  return { out, reads: g._ss.sheets.reduce((n, x) => n + (x.reads || 0), 0), tabs: g._ss.sheets.filter((x) => x.reads).map((x) => x.name) };
}

test('서버 기억: 두 번째로 여는 화면은 시트를 읽지 않고 같은 내용을 준다', () => {
  const g = freshName();
  const { who } = ids(g);
  g.seedTestSchedule_();
  g.seedTestNotices_();
  const me = who('심청');
  const a = sheetReads(g, () => call(g, 'home', {}, me));
  const b = sheetReads(g, () => call(g, 'home', {}, me));
  assert.ok(a.reads > 0, '처음은 시트에서 ' + a.reads);
  assert.strictEqual(b.reads, 0, '두 번째는 시트를 읽지 않음: ' + b.tabs.join(','));
  assert.deepStrictEqual(plain(b.out), plain(a.out));
  const t = g.todayYmd_();
  const m1 = call(g, 'sched.month', { year: +t.slice(0, 4), month: +t.slice(5, 7) }, me);
  const m2 = sheetReads(g, () => call(g, 'sched.month', { year: +t.slice(0, 4), month: +t.slice(5, 7) }, me));
  assert.strictEqual(m2.reads, 0);
  assert.deepStrictEqual(plain(m2.out), plain(m1));
});

test('서버 기억: 웹앱으로 저장하면 시트에 확정한 뒤 그 탭 기억을 버려 바로 반영된다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  const t = g.todayYmd_();
  const ym = { year: +t.slice(0, 4), month: +t.slice(5, 7) };
  call(g, 'sched.month', ym, me);
  let flushes = 0;
  const f0 = g.SpreadsheetApp.flush;
  g.SpreadsheetApp.flush = function () { flushes++; return f0.apply(this, arguments); };
  call(g, 'sched.save', { fields: { start: t, title: '기억 시험 행사' } }, me);
  assert.ok(flushes > 0, '저장할 때 시트에 확정(flush)한 뒤 기억을 바꿈');
  const after = sheetReads(g, () => call(g, 'sched.month', ym, me));
  assert.ok(after.out.data.events.some((e) => e.title === '기억 시험 행사'), '방금 넣은 일정이 보임');
  assert.ok(after.tabs.every((x) => x === '일정'), '다시 읽더라도 바뀐 탭(일정)뿐: ' + after.tabs.join(','));
  // 다른 선생님의 요청에서도 바로
  assert.ok(call(g, 'home', {}, who('흥부')).data.events.some((e) => e.title === '기억 시험 행사'));
});

test('서버 기억: 시트를 손으로 고치면 onEdit로 그 탭만 바로, 줄 지우기처럼 onEdit가 없으면 뒤에서 보내는 요청이 10분 뒤 맞춘다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  g.seedTestNotices_();
  const title = (bg) => JSON.parse(g.api(JSON.stringify({ action: 'notice.list', args: {}, tokens: me, bg: bg ? 1 : undefined }))).data.items.map((n) => n.title);
  const before = title();
  const sh = g._ss.getSheetByName('공지');
  const col = sh.data[0].indexOf('제목');
  const edit = (txt) => { sh.data[1][col] = txt; };
  edit('손으로 고친 제목 1');
  assert.deepStrictEqual(title(), before, 'onEdit가 없으면 아직 옛 기억');
  assert.deepStrictEqual(title(true), before, '뒤에서 보내는 요청도 10분 안이면 기억 그대로');
  g.__clock.offset += 11 * 60 * 1000;
  assert.deepStrictEqual(title(), before, '기다리는 요청은 10분이 지나도 기억을 그대로 써서 빠르다(판이 맞으면)');
  assert.ok(title(true).includes('손으로 고친 제목 1'), '뒤에서 보내는 요청은 10분 넘은 기억을 시트와 다시 맞춘다');
  assert.ok(title().includes('손으로 고친 제목 1'), '맞춘 뒤로는 기다리는 요청에도 보인다');
  // 손으로 고친 칸: onEdit가 그 탭의 판만 바꾼다
  call(g, 'home', {}, me);
  edit('손으로 고친 제목 2');
  g.onEdit({ range: sh.getRange(2, col + 1) });
  const r2 = sheetReads(g, () => title());
  assert.ok(r2.out.includes('손으로 고친 제목 2'), 'onEdit가 불리면 바로');
  assert.deepStrictEqual(r2.tabs, ['공지'], '고친 탭만 다시 읽는다: ' + r2.tabs.join(','));
  assert.ok(Number(g.PropertiesService.getScriptProperties().getProperty('SHEET_EDIT_AT')) > 0, '점검 화면이 볼 수 있게 알아챈 시각을 남긴다');
  edit('손으로 고친 제목 3');
  g.onEdit({ range: null });
  assert.ok(title().includes('손으로 고친 제목 3'), '어느 탭인지 모르면 모두 버린다');
  edit('손으로 고친 제목 4');
  const { t } = adminTokens(g);
  assert.strictEqual(call(g, 'admin.cache.clear', {}, who('심청')).code, 'ADMIN');
  assert.strictEqual(call(g, 'admin.cache.clear', {}, t).data.done, true);
  assert.ok(title().includes('손으로 고친 제목 4'), '시트 새로 읽기를 누르면 바로');
  assert.ok(g.readRows_('기록').some((r) => r['동작'] === '기억 비움'));
});

test('서버 기억: 저장(잠금 안)은 늘 시트에서 읽어 손으로 고친 값을 옛 기억으로 덮어쓰지 않는다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  call(g, 'admin.staff.list', {}, t); // 교직원 탭을 기억에 넣는다
  const sh = g._ss.getSheetByName('교직원');
  const head = sh.data[0].map(String);
  const idx = sh.data.findIndex((r) => String(r[head.indexOf('이름')]).replace(/^'/, '') === '심청');
  const id = String(sh.data[idx][head.indexOf('교직원ID')]).replace(/^'/, '');
  sh.data[idx][head.indexOf('담당 업무')] = '손으로 고친 업무'; // onEdit 없이(기억은 옛 값)
  const r = call(g, 'admin.staff.setActive', { id, active: false }, t);
  assert.ok(r.ok, r.error);
  assert.strictEqual(String(sh.data[idx][head.indexOf('담당 업무')]).replace(/^'/, ''), '손으로 고친 업무', '손으로 고친 값이 남음');
  assert.strictEqual(String(sh.data[idx][head.indexOf('사용 여부')]).replace(/^'/, ''), '사용 안 함');
});

/** 잘 줄어들지 않는 글(무작위 한글 음절, 시작값이 같으면 같은 글) */
function noise(n, seed) {
  let a = (seed || 1) >>> 0, out = '';
  for (let i = 0; i < n; i++) {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out += String.fromCharCode(0xAC00 + (((t ^ (t >>> 14)) >>> 0) % 11172));
  }
  return out;
}

test('서버 기억: 큰 탭은 줄여서(gzip) 여러 칸에 나눠 담고, 아주 크면 담지 않고 시트에서 읽는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  for (let i = 0; i < 60; i++) call(g, 'notice.save', { fields: { '제목': '긴 공지 ' + i, '내용': noise(2000, i + 1) } }, me);
  const a = call(g, 'notice.list', {}, me).data;
  const keys = Object.keys(g._cache._store).filter((k) => k.indexOf('gy:d:공지:') === 0);
  assert.ok(keys.length >= 2, '여러 칸에 나눠 담음: ' + keys.length);
  assert.strictEqual(JSON.parse(g._cache._store['gy:d:공지:0'].v.split('\n')[0]).z, 1, '줄여서 담음');
  const b = sheetReads(g, () => call(g, 'notice.list', {}, me).data);
  assert.ok(!b.tabs.includes('공지'), '공지 탭은 기억에서');
  assert.deepStrictEqual(plain(b.out), plain(a));
  // 한 칸이라도 사라지면 시트에서 다시
  delete g._cache._store[keys.sort()[keys.length - 1]];
  const c = sheetReads(g, () => call(g, 'notice.list', {}, me).data);
  assert.ok(c.tabs.includes('공지'));
  assert.deepStrictEqual(plain(c.out), plain(a));
  // 아주 큰 탭(20칸 넘음)은 담지 않는다: 시트에 손으로 큰 줄을 넣은 것처럼
  const sh = g._ss.getSheetByName('공지');
  const head = sh.data[0].map(String);
  for (let i = 0; i < 25; i++) {
    const row = head.map(() => '');
    row[head.indexOf('공지ID')] = 'GHUGE' + i;
    row[head.indexOf('제목')] = '아주 긴 공지 ' + i;
    row[head.indexOf('내용')] = noise(45000, 100 + i);
    row[head.indexOf('입력 시각')] = g.nowText_();
    sh.data.push(row);
  }
  g.onEdit({});
  call(g, 'notice.list', {}, me);
  const d = sheetReads(g, () => call(g, 'notice.list', {}, me).data);
  assert.ok(d.tabs.includes('공지'), '너무 크면 늘 시트에서');
  assert.ok(d.out.items.length >= 85);
});

test('서버 기억: 기억을 쓸 수 없어도(없거나 오류) 시트에서 읽어 그대로 돌아간다', () => {
  const g = loadGas({ noCache: true });
  g.setupAll_();
  g.setPassword_('common', COMMON);
  g.setPassword_('admin', ADMIN);
  g.seedTestData_('1111');
  const { who } = ids(g);
  const me = who('심청');
  const t = g.todayYmd_();
  assert.ok(call(g, 'sched.save', { fields: { start: t, title: '기억 없이' } }, me).ok);
  assert.ok(call(g, 'home', {}, me).data.events.some((e) => e.title === '기억 없이'));
  const g2 = freshName();
  const me2 = ids(g2).who('심청');
  g2.CacheService.getScriptCache = () => ({ get() { throw new Error('x'); }, getAll() { throw new Error('x'); }, put() { throw new Error('x'); }, putAll() { throw new Error('x'); } });
  assert.ok(call(g2, 'sched.save', { fields: { start: t, title: '기억 오류' } }, me2).ok);
  assert.ok(call(g2, 'home', {}, me2).data.events.some((e) => e.title === '기억 오류'));
});

test('미리 받기(batch): 읽기 화면을 한 번에 8개까지, 쓰기·관리자 요청은 안 된다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  const t = g.todayYmd_();
  const reads = [['home', {}], ['sched.month', { year: +t.slice(0, 4), month: +t.slice(5, 7) }], ['survey.list', {}], ['lib.list', {}], ['notice.list', {}], ['help.list', {}], ['staff.list', {}]];
  const r = call(g, 'batch', { reads }, me);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.length, 7);
  r.data.forEach((x, i) => { assert.ok(x && x.data, reads[i][0]); assert.deepStrictEqual(plain(x.data), plain(call(g, reads[i][0], reads[i][1], me).data), reads[i][0]); });
  const bad = call(g, 'batch', { reads: [['sched.save', { fields: { start: t, title: '몰래' } }], ['admin.settings.get', {}]] }, me).data;
  assert.deepStrictEqual(plain(bad), [null, null]);
  assert.ok(!g.liveRows_('일정').some((e) => e['행사명'] === '몰래'));
  assert.strictEqual(call(g, 'batch', { reads: Array.from({ length: 12 }, () => ['home', {}]) }, me).data.length, 8);
  assert.strictEqual(call(g, 'batch', { reads }, {}).code, 'LOGIN');
});

test('점검: 학생수 탭은 아직 없어도 문제로 보지 않는다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  g._ss.sheets = g._ss.sheets.filter((x) => x.name !== '학생수');
  const b = g.fileBuilds_();
  const r = call(g, 'admin.check', { client: { app: b.App, styles: b.Styles, index: b.Index } }, t).data;
  const by = (label) => r.items.find((x) => x.label === label);
  assert.strictEqual(by('학생수 탭').state, 'ok');
  assert.match(by('학생수 탭').detail, /저절로/);
  assert.strictEqual(by('탭과 칸').state, 'ok');
  assert.ok(!r.items.some((x) => x.state === 'bad' && x.group === '시트'));
});

// ================================================================ 보완판 5: 관리 권한 한 번만, 서버 기억 한 번에 꺼내기

test('서버 기억: 요청마다 읽을 탭을 한 번에 꺼낸다(두 번째부터 서버 기억을 한 번만 다녀오고, 목록에 빠진 탭이 없다)', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  g.seedTestSchedule_();
  g.seedTestNotices_();
  const me = who('심청');
  const made = call(g, 'survey.save', { fields: sv(g) }, me);
  assert.ok(made.ok, made.error);
  assert.ok(call(g, 'lib.save', { fields: libFields(g) }, me).ok);
  assert.ok(call(g, 'help.save', { fields: { '분류ID': cats(g, '도움말 분류')[0].id, '제목': '안내', '내용': '글' } }, me).ok);
  const t = g.todayYmd_(), y = +t.slice(0, 4), m = +t.slice(5, 7);
  const reads = [['home', {}], ['sched.month', { year: y, month: m }], ['survey.list', {}], ['lib.list', {}], ['notice.list', {}], ['help.list', {}], ['staff.list', {}]];
  const list = [['start', {}, {}], ['staffPicker', {}, { login: me.login }], ['session', {}, me], ['boot', { home: true }, me], ['home', {}, me],
    ['sched.month', { year: y, month: m }, me], ['sched.year', { year: m >= 3 ? y : y - 1 }, me], ['survey.list', {}, me], ['survey.get', { id: made.data.id }, me],
    ['lib.list', {}, me], ['notice.list', {}, me], ['help.list', {}, me], ['staff.list', {}, me], ['search', { q: '안전' }, me], ['batch', { reads }, me],
    ['home', {}, boss()], ['sched.month', { year: y, month: m }, boss()]];
  list.forEach(([a, args, tk]) => {
    assert.ok(call(g, a, args, tk).ok, a);
    const r = call(g, a, args, tk);
    assert.ok(r.ok, a);
    assert.strictEqual(g.PERF_.reads, 0, a + ': 시트를 읽지 않음');
    assert.strictEqual(g.PERF_.memoCalls, 1, a + ': 서버 기억은 한 번만 다녀옴(' + g.PERF_.memoCalls + '번)');
  });
  assert.strictEqual(call(g, 'ping', {}, {}).ok, true);
  assert.strictEqual(g.PERF_.memoCalls, 0, 'ping은 서버 기억도 부르지 않는다');
});

test('관리자 화면을 연 기기: 관리 권한은 요청마다 한 번만 따진다(일정이 많아도 스크립트 속성을 더 읽지 않는다)', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const b = boss();
  const me = who('심청');
  const t = g.todayYmd_(), y = +t.slice(0, 4), m = +t.slice(5, 7);
  const ym = t.slice(0, 8);
  for (let i = 0; i < 30; i++) assert.ok(call(g, 'sched.save', { fields: { start: ym + String(1 + (i % 28)).padStart(2, '0'), title: '많은 행사 ' + i } }, i % 2 ? me : b).ok);
  const real = g.PropertiesService;
  let n = 0;
  g.PropertiesService = { getScriptProperties() { const p = real.getScriptProperties(); return Object.assign({}, p, { getProperty(k) { n++; return p.getProperty(k); } }); } };
  const count = (tk) => { n = 0; const r = call(g, 'sched.month', { year: y, month: m }, tk); return { n, r }; };
  const a = count(b), c = count(me);
  g.PropertiesService = real;
  assert.ok(a.n <= 6, '관리자 화면을 연 기기: 스크립트 속성 ' + a.n + '번');
  assert.ok(c.n <= 6, '보통 기기: ' + c.n + '번');
  const mine = a.r.data.events.filter((e) => /^많은 행사/.test(e.title));
  assert.strictEqual(mine.length, 30);
  assert.ok(mine.every((e) => e.canEdit), '관리자 화면을 연 기기는 모두 고칠 수 있음');
  const other = c.r.data.events.filter((e) => /^많은 행사/.test(e.title));
  assert.strictEqual(other.filter((e) => e.canEdit).length, 15, '보통 기기는 자기가 넣은 것만');
});

test('서버 기억: 여러 칸 중 다른 판의 칸이 섞이면 쓰지 않고 시트에서 읽는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  for (let i = 0; i < 40; i++) call(g, 'notice.save', { fields: { '제목': '긴 공지 ' + i, '내용': noise(2000, i + 1) } }, me);
  const a = call(g, 'notice.list', {}, me).data;
  const store = g._cache._store;
  const keys = Object.keys(store).filter((k) => k.indexOf('gy:d:공지:') === 0).sort();
  assert.ok(keys.length >= 2);
  // 둘째 칸을 다른 판이 담은 것처럼 바꾼다(그사이 다른 요청이 새로 담은 경우)
  const k1 = 'gy:d:공지:1';
  const nl = store[k1].v.indexOf('\n');
  store[k1].v = store[k1].v.slice(0, nl - 3) + 'zzz' + store[k1].v.slice(nl);
  const b = sheetReads(g, () => call(g, 'notice.list', {}, me).data);
  assert.ok(b.tabs.includes('공지'), '섞인 기억은 쓰지 않고 시트에서');
  assert.deepStrictEqual(plain(b.out), plain(a));
});

test('이어 읽기: 미리 꺼낸 기억이 있어도 저장한 뒤 이어 읽은 화면과 다음 화면은 새 내용이다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  const t = g.todayYmd_(), ym = { year: +t.slice(0, 4), month: +t.slice(5, 7) };
  call(g, 'home', {}, me);
  call(g, 'sched.month', ym, me);
  const r = JSON.parse(g.api(JSON.stringify({ action: 'sched.save', args: { fields: { start: t, title: '이어 읽기 새 행사' } }, tokens: me, then: [['home', {}], ['sched.month', ym]] })));
  assert.ok(r.ok, r.error);
  assert.ok(r.then[0].data.events.some((e) => e.title === '이어 읽기 새 행사'), '이어 읽은 홈');
  assert.ok(r.then[1].data.events.some((e) => e.title === '이어 읽기 새 행사'), '이어 읽은 달력');
  assert.ok(call(g, 'sched.month', ym, who('흥부')).data.events.some((e) => e.title === '이어 읽기 새 행사'), '다른 선생님의 다음 요청');
  const bg = JSON.parse(g.api(JSON.stringify({ action: 'batch', args: { reads: [['home', {}]] }, tokens: me, bg: 1 })));
  assert.ok(bg.data[0].data.events.some((e) => e.title === '이어 읽기 새 행사'), '뒤에서 받은 것도');
});

test('점검: 판 표시만 없는 예전 파일은 예전 판(문제 아님), 정말 빠진 파일은 문제, 저절로 생기는 칸은 정상', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  g.fileMark_Auth_ = undefined;                        // 판 표시를 넣기 전 파일(기능은 있음)
  g.fileMark_Help_ = undefined; g.apiHelpList_ = undefined; // 정말 빠진 파일
  const sh = g._ss.getSheetByName('학생수');       // 반별 칸이 없던 때 만든 탭
  if (sh) sh.data.forEach((row) => row.splice(sh.data[0].indexOf('반별'), 1));
  else {
    const head = g.tabs_()['학생수'].filter((h) => h !== '반별');
    g._ss.insertSheet('학생수').getRange(1, 1, 1, head.length).setValues([head]);
  }
  g.memoClearAll_();
  const b = g.fileBuilds_();
  const r = call(g, 'admin.check', { client: { app: b.App, styles: b.Styles, index: b.Index } }, t).data;
  const by = (label) => r.items.find((x) => x.label === label);
  assert.strictEqual(by('Auth.gs').state, 'warn');
  assert.match(by('Auth.gs').detail, /예전 파일/);
  assert.strictEqual(by('Help.gs').state, 'bad');
  assert.strictEqual(by('학생수 탭').state, 'ok');
  assert.match(by('학생수 탭').detail, /반별.*저절로/);
  assert.ok(!r.items.some((x) => x.group === '시트' && x.state !== 'ok'), '시트 묶음에 확인 필요 없음');
  assert.match(by('서버 기억').detail, /아직 없어요/);
  g.onEdit({ range: g._ss.getSheetByName('공지').getRange(1, 1) });
  const r2 = call(g, 'admin.check', { client: { app: b.App, styles: b.Styles, index: b.Index } }, t).data;
  assert.match(r2.items.find((x) => x.label === '서버 기억').detail, /바로 알아채요/);
});

test('속도 재기: 서버 기억에서 읽을 때도 실제 요청처럼 한 번에 꺼내 잰다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  g.seedTestSchedule_();
  const r = call(g, 'admin.speed', {}, t);
  assert.ok(r.ok, r.error);
  r.data.items.forEach((x) => {
    assert.ok(!x.error, x.label + ': ' + x.error);
    assert.strictEqual(x.memo.reads, 0, x.label + ': 시트를 읽지 않음');
    assert.strictEqual(x.memo.memoCalls, 1, x.label + ': 서버 기억 ' + x.memo.memoCalls + '번');
  });
});

// ================================================================ 최종 검토(보완판 5)에서 고친 것

test('보안: 로그인이 필요 없는 요청에 then을 붙여도 로그인 화면 내용을 읽지 못한다', () => {
  const g = freshName();
  const { who } = ids(g);
  for (const action of ['ping', 'start', 'login']) {
    const r = JSON.parse(g.api(JSON.stringify({ action, args: {}, tokens: { login: 'x.y' }, then: [['staff.list', {}], ['home', {}]] })));
    assert.ok(!r.then || r.then.every((x) => x === null), action + ': ' + String(JSON.stringify(r.then)).slice(0, 80));
  }
  const ok = JSON.parse(g.api(JSON.stringify({ action: 'notice.list', args: {}, tokens: who('심청'), then: [['staff.list', {}]] })));
  assert.ok(ok.then[0] && ok.then[0].data, '로그인한 요청은 그대로 이어 읽는다');
});

test('시트 줄 수: 새 탭(1000줄)을 넘겨 여러 줄을 한 번에 넣어도 된다', () => {
  const g = freshName();
  const sh = g._ss.getSheetByName('알림');
  assert.strictEqual(sh.getMaxRows(), 1000);
  const rows = Array.from({ length: 1200 }, (_, i) => ({ '조사ID': 'S1', '대상 교직원ID': 'T' + i, '알린 시각': g.nowText_() }));
  const out = g.insertRows_('알림', rows, { id: '', name: '시험' }, '많이 넣기');
  assert.strictEqual(out.length, 1200);
  assert.strictEqual(g.liveRows_('알림').length, 1200);
  assert.ok(sh.getMaxRows() >= 1201);
});

test('일괄 숨기기·되살리기는 줄마다 시트를 부르지 않는다(붙은 줄은 한 번에)', () => {
  const g = freshName();
  const rows = Array.from({ length: 300 }, (_, i) => ({ '시작일': '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), '행사명': '많은 행사 ' + i, '구분': '행사' }));
  const made = g.insertRows_('일정', rows, { id: '', name: '시험' }, '많이');
  const sh = g._ss.getSheetByName('일정');
  let calls = 0;
  const gr = sh.getRange;
  sh.getRange = function () { calls++; return gr.apply(this, arguments); };
  const n = g.updateRowsSame_('일정', made.map((r) => r['일정ID']), { '삭제 여부': '삭제' }, { id: 'T1', name: '시험' }, '숨김', '삭제');
  sh.getRange = gr;
  assert.strictEqual(n, 300);
  assert.ok(calls <= 5, '시트 범위 부르기 ' + calls + '번');
  assert.strictEqual(g.liveRows_('일정').filter((r) => /^많은 행사/.test(r['행사명'])).length, 0);
  const all = g.readRows_('일정').filter((r) => /^많은 행사/.test(r['행사명']));
  assert.ok(all.every((r) => r['삭제 여부'] === '삭제' && r['수정자ID'] === 'T1' && r['수정 시각']), '숨긴 사람·시각이 남는다');
  assert.ok(all.every((r) => r['행사명'] && r['시작일']), '다른 칸은 그대로');
});

test('칸 위치: 시트 맨 앞이나 설정 탭 가운데에 칸을 끼워 넣어도 이름으로 찾아 쓴다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  const sh = g._ss.getSheetByName('일정');
  sh.data.forEach((row, i) => row.unshift(i ? '' : '번호'));
  g.onEdit({ range: sh.getRange(1, 1) });
  const t = g.todayYmd_();
  const r = call(g, 'sched.save', { fields: { start: t, title: '칸 끼운 뒤 행사' } }, me);
  assert.ok(r.ok, r.error);
  const head = sh.data[0].map(String);
  const line = sh.data.find((x) => String(x[head.indexOf('행사명')]) === '칸 끼운 뒤 행사');
  assert.match(String(line[head.indexOf('일정ID')]), /^E/, 'ID는 일정ID 칸에');
  assert.strictEqual(String(line[0]), '', '끼워 넣은 칸은 비워 둔다');
  assert.ok(call(g, 'home', {}, me).data.events.some((e) => e.title === '칸 끼운 뒤 행사'));
  const set = g._ss.getSheetByName('설정');
  set.data.forEach((row, i) => row.splice(1, 0, i ? '' : '메모'));
  g.putSetting_('학교명', '장도초(시험)', { id: '', name: '시험' });
  const sh2 = set.data[0].map(String);
  const row = set.data.find((x) => String(x[sh2.indexOf('키')]) === '학교명');
  assert.strictEqual(String(row[sh2.indexOf('값')]), '장도초(시험)');
  assert.strictEqual(String(row[sh2.indexOf('메모')]), '');
});

test('서버 기억: 이모지 같은 두 글자 문자를 칸 경계에서 반으로 자르지 않는다', () => {
  const g = freshName();
  const text = 'a'.repeat(29999 - 3) + '😀' + 'b'.repeat(500); // JSON 앞 3글자 [[" 다음, 30000번째 글자 경계에 이모지가 걸친다
  const vals = [[text]];
  g.memoStore_('공지', vals, { ep: 'E', v: 'V' });
  const store = g._cache._store;
  const c0 = store['gy:d:공지:0'].v;
  const last = c0.charCodeAt(c0.length - 1);
  assert.ok(!(last >= 0xD800 && last <= 0xDBFF), '첫 칸이 이모지 앞쪽 반으로 끝나지 않음');
  g.MEMO_EP_ = 'E';
  store['gy:v:공지'] = { v: 'V', exp: Date.now() + 60000 };
  const look = g.memoLookup_('공지');
  assert.strictEqual(look.vals[0][0], text);
});

test('처음 설정: 시트에서 설정 줄을 손으로 지운 직후에도 서버 기억이 아닌 시트를 보고 다시 넣는다', () => {
  const g = freshName();
  g.setting_('학교명');
  call(g, 'start', {}, {});
  const set = g._ss.getSheetByName('설정');
  const k = set.data[0].map(String).indexOf('키');
  const idx = set.data.findIndex((x) => String(x[k]) === '학년도');
  set.data.splice(idx, 1); // onChange만 오고 onEdit는 오지 않는 줄 지우기
  g.setupAll_();
  assert.ok(set.data.some((x) => String(x[k]) === '학년도'), '지운 키를 다시 넣음');
});

test('보안: 공통 비밀번호를 학교 전체에서 15분에 20번 틀리면 새 로그인을 잠시 막고(맞는 비밀번호도), 기록·점검에 남긴다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  for (let i = 0; i < 20; i++) assert.strictEqual(call(g, 'login', { password: 'wrong-' + i }).code, 'BADPW', '틀림 ' + i);
  const blocked = call(g, 'login', { password: COMMON });
  assert.strictEqual(blocked.code, 'LOCKED');
  assert.match(blocked.error, /로그인된 기기는 그대로/);
  assert.ok(call(g, 'home', {}, { login: t.login }).ok, '이미 로그인된 기기는 그대로 쓴다');
  assert.ok(g.readRows_('기록').some((r) => r['동작'] === '잠김' && /공통 비밀번호/.test(r['요약'])));
  const b = g.fileBuilds_();
  const chk = call(g, 'admin.check', { client: { app: b.App, styles: b.Styles, index: b.Index } }, t).data.items.find((x) => x.label === '로그인 시도');
  assert.strictEqual(chk.state, 'warn');
  g.__clock.offset += 16 * 60 * 1000;
  assert.ok(call(g, 'login', { password: COMMON }).ok, '15분이 지나면 다시 된다');
});

test('보안: 관리자 비밀번호 잠김 기록에 고른 이름이 남고, 비밀번호 바꾸기의 지금 비밀번호도 틀린 횟수를 센다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  for (let i = 0; i < 5; i++) call(g, 'adminLogin', { password: 'x' + i }, me);
  const row = g.readRows_('기록').filter((r) => r['동작'] === '잠김').pop();
  assert.strictEqual(row['이름'], '심청');
  g.__clock.offset += 11 * 60 * 1000;
  const A = call(g, 'adminLogin', { password: ADMIN }, me).data.admin;
  const t2 = Object.assign({}, me, { admin: A });
  for (let i = 0; i < 4; i++) assert.strictEqual(call(g, 'admin.pw.admin', { current: 'y' + i, newPw: 'new-admin-1', newPw2: 'new-admin-1' }, t2).code, 'BADPW');
  assert.strictEqual(call(g, 'admin.pw.admin', { current: 'y9', newPw: 'new-admin-1', newPw2: 'new-admin-1' }, t2).code, 'LOCKED');
  assert.strictEqual(call(g, 'adminLogin', { password: ADMIN }, me).code, 'LOCKED', '맞춰 보기가 잠금으로 이어진다');
});

test('보안: 사용 안 함으로 바꾸면 그 분의 기억된 본인 확인이 끊기고, 다시 사용으로 바꿔도 옛 기기는 이름을 다시 고른다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who, staff } = ids(g);
  const me = who('놀부');
  assert.ok(call(g, 'home', {}, me).ok);
  const id = staff.find((x) => x.name === '놀부').id;
  assert.ok(call(g, 'admin.staff.setActive', { id, active: false }, t).ok);
  assert.ok(call(g, 'admin.staff.setActive', { id, active: true }, t).ok);
  assert.strictEqual(call(g, 'sched.save', { fields: { start: g.todayYmd_(), title: '옛 표로 저장' } }, me).code, 'IDENTITY');
  assert.ok(call(g, 'sched.save', { fields: { start: g.todayYmd_(), title: '새로 고른 뒤 저장' } }, who('놀부')).ok);
});

test('학생 수: 창을 연 뒤 다른 분이 먼저 저장했으면 덮어쓰지 않고 알려 준다', () => {
  const g = freshName();
  const { who } = ids(g);
  const a = who('심청'), b = who('흥부');
  const t = g.todayYmd_();
  const cls = (n) => ({ 1: [[n, 10]], 2: [[10, 10]], 3: [[10, 10]], 4: [[10, 10]], 5: [[10, 10]], 6: [[10, 10]] });
  const first = call(g, 'students.save', { date: t, classes: cls(10), base: '' }, a);
  assert.ok(first.ok, first.error);
  const base = call(g, 'home', {}, a).data.students.at;
  g.__clock.offset += 2000;
  assert.ok(call(g, 'students.save', { date: t, classes: cls(11), base }, a).ok, 'A가 1학년을 고침');
  const late = call(g, 'students.save', { date: t, classes: cls(10), base }, b);
  assert.strictEqual(late.code, 'CONFLICT', 'B는 A보다 먼저 연 창이라 덮어쓰지 않음');
  assert.strictEqual(call(g, 'home', {}, a).data.students.classes['1'][0][0], 11, 'A가 넣은 숫자가 남음');
  const fresh = call(g, 'home', {}, b).data.students.at;
  assert.ok(call(g, 'students.save', { date: t, classes: cls(12), base: fresh }, b).ok, '다시 연 창에서는 저장됨');
});

test('올리기: 연도 없는 날짜는 적힌 요일로 다음 해를 알아채고, 요일이 틀리면 확인 필요로, 대상 전교직원은 교직원만', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  g.putSetting_('학년도', '2026', { id: '', name: '시험' });
  const grid = [['날짜', '행사명', '구분', '대상'], ['3. 2.(화)', '입학식', '행사', '전교생'], ['5. 5.(수)', '어린이날', '공휴일', ''], ['2. 11.(금)', '졸업식', '행사', '6학년'],
    ['3. 3.(금)', '요일 틀린 줄', '행사', ''], ['3. 4.', '교직원 연수', '교육활동', '전교직원'], ['3. 5.', '모두 함께', '행사', '전교생·교직원']];
  const r = call(g, 'sched.upload.check', { grid }, t).data;
  const by = (title) => r.rows.find((x) => x.title === title);
  assert.strictEqual(by('입학식').start, '2027-03-02');
  assert.strictEqual(by('입학식').status, 'warn');
  assert.match(by('입학식').msgs.join(' '), /요일\(화\)에 맞춰 2027년/);
  assert.strictEqual(by('어린이날').start, '2027-05-05');
  assert.strictEqual(by('졸업식').start, '2028-02-11');
  assert.strictEqual(by('요일 틀린 줄').start, '2026-03-03');
  assert.match(by('요일 틀린 줄').msgs.join(' '), /요일이 맞지 않아요/);
  assert.strictEqual(by('교직원 연수').target, '교직원');
  assert.strictEqual(by('모두 함께').target, '전체,교직원');
  const sv = call(g, 'sched.upload.save', { rows: r.rows.map((x) => Object.assign({}, x.raw, { include: true })), mode: 'skip' }, t);
  assert.ok(sv.ok, sv.error);
  const ev = g.liveRows_('일정');
  assert.strictEqual(ev.find((e) => e['행사명'] === '교직원 연수')['대상 학년'], '교직원');
  assert.strictEqual(ev.find((e) => e['행사명'] === '모두 함께')['대상 학년'], '전체,교직원');
});

test('일정: 전체와 교직원을 함께 고르면 둘 다 남는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const r = call(g, 'sched.save', { fields: { start: g.todayYmd_(), title: '모두와 교직원', target: ['전체', '1', '2', '3', '4', '5', '6', '교직원'] } }, who('심청'));
  assert.ok(r.ok, r.error);
  assert.strictEqual(g.liveRows_('일정').find((e) => e['행사명'] === '모두와 교직원')['대상 학년'], '전체,교직원');
});

test('올리기: 전에 올린 행사 800개를 바꾸고 되돌려도 되돌리기 정보가 속성 한 칸 한도(9KB)에 걸리지 않는다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const grid = [['날짜', '행사명', '구분']].concat(Array.from({ length: 800 }, (_, i) => [g.addDays_('2026-03-02', i % 300), '행사 ' + i, '행사']));
  const r1 = call(g, 'sched.upload.check', { grid }, t).data;
  assert.ok(call(g, 'sched.upload.save', { rows: r1.rows.map((x) => Object.assign({}, x.raw, { include: true })), mode: 'skip' }, t).ok);
  const r2 = call(g, 'sched.upload.check', { grid, mode: 'replace' }, t).data;
  const sv = call(g, 'sched.upload.save', { rows: r2.rows.map((x) => Object.assign({}, x.raw, { include: true })), mode: 'replace' }, t);
  assert.ok(sv.ok, sv.error);
  assert.strictEqual(sv.data.replaced, 800);
  assert.strictEqual(g.lastUpload_().replaced.length, 800);
  const un = call(g, 'sched.upload.undo', { batch: sv.data.batch }, t);
  assert.ok(un.ok, un.error);
  assert.strictEqual(un.data.restored, 800);
  assert.strictEqual(g.liveRows_('일정').filter((e) => /^행사 \d+$/.test(e['행사명'])).length, 800, '처음 올린 800개가 다시 보인다');
});

test('조사: 지금 끝낸 조사는 글만 고쳐도 다시 열리지 않고, 마감을 늦추면 다시 열린다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const f = sv(g);
  const id = call(g, 'survey.save', { fields: f }, owner).data.id;
  call(g, 'survey.setOpen', { id, open: false }, owner);
  const closed = () => call(g, 'survey.get', { id }, owner).data.card.closed;
  assert.strictEqual(closed(), true);
  assert.ok(call(g, 'survey.save', { id, fields: Object.assign({}, f, { title: '글만 고침', reopen: true }) }, owner).ok);
  assert.strictEqual(closed(), true, '글만 고치면 끝난 그대로');
  assert.ok(!call(g, 'home', {}, who('심청')).data.todos.some((x) => x.title === '글만 고침'), '안 낸 분 할 일에 다시 나오지 않음');
  const later = g.addDays_(g.todayYmd_(), 5) + ' 17:00';
  assert.ok(call(g, 'survey.save', { id, fields: Object.assign({}, f, { title: '글만 고침', deadline: later, reopen: true }) }, owner).ok);
  assert.strictEqual(closed(), false, '마감을 늦추면 다시 열림');
});

test('조사: 안내 문구를 고치지 않았으면 제목·마감을 바꿀 때 문구도 따라 바뀌고, 직접 쓴 문구는 그대로', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const f = sv(g);
  const id = call(g, 'survey.save', { fields: f }, owner).data.id;
  const d1 = call(g, 'survey.get', { id }, owner).data;
  const later = g.addDays_(g.todayYmd_(), 6) + ' 17:00';
  assert.ok(call(g, 'survey.save', { id, fields: Object.assign({}, f, { deadline: later, messenger: d1.messenger }) }, owner).ok);
  const d2 = call(g, 'survey.get', { id }, owner).data;
  assert.notStrictEqual(d2.messenger, d1.messenger, '자동 문구는 새 마감으로');
  assert.ok(d2.messenger.includes(d2.card.deadlineText), d2.messenger + ' / ' + d2.card.deadlineText);
  assert.ok(call(g, 'survey.save', { id, fields: Object.assign({}, f, { deadline: later, messenger: '직접 쓴 안내예요' }) }, owner).ok);
  assert.strictEqual(call(g, 'survey.get', { id }, owner).data.messenger, '직접 쓴 안내예요');
});

test('조사: 다시 알린 횟수는 누른 번수로 센다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const id = call(g, 'survey.save', { fields: sv(g) }, owner).data.id;
  assert.ok(call(g, 'survey.remind', { id }, owner).ok);
  assert.strictEqual(call(g, 'survey.get', { id }, owner).data.remindedCount, 1);
  g.__clock.offset += 61 * 1000;
  assert.ok(call(g, 'survey.remind', { id }, owner).ok);
  assert.strictEqual(call(g, 'survey.get', { id }, owner).data.remindedCount, 2);
});

test('조사 CSV: 음수 같은 숫자 답은 숫자 그대로, =·+로 시작하는 글은 수식이 되지 않게', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const f = sv(g, { questions: [{ type: 'number', title: '온도' }, { type: 'short', title: '메모' }] });
  const id = call(g, 'survey.save', { fields: f }, owner).data.id;
  const q = call(g, 'survey.get', { id }, owner).data.questions;
  assert.ok(call(g, 'survey.respond', { id, answers: { [q[0].id]: '-3', [q[1].id]: '=1+1' } }, who('심청')).ok);
  const csv = call(g, 'survey.csv', { id }, owner).data.csv;
  assert.ok(csv.includes('"-3"'), csv);
  assert.ok(csv.includes(`"'=1+1"`), csv);
});

test('휴지통: 최근에 지운 일정이 맨 위에 보인다(한꺼번에 많이 숨긴 뒤에도)', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  const rows = Array.from({ length: 210 }, (_, i) => ({ '시작일': '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), '행사명': '많은 행사 ' + i, '구분': '행사' }));
  const made = g.insertRows_('일정', rows, { id: '', name: '시험' }, '많이');
  g.updateRowsSame_('일정', made.map((r) => r['일정ID']), { '삭제 여부': '삭제' }, { id: '', name: '시험' }, '숨김', '삭제');
  g.__clock.offset += 2000;
  const me = who('심청');
  const ev = call(g, 'sched.save', { fields: { start: '2026-03-10', title: '실수로 지운 행사' } }, me).data;
  assert.ok(call(g, 'sched.delete', { id: ev.id }, me).ok);
  const trash = call(g, 'admin.trash.list', {}, t).data;
  assert.strictEqual(trash[0].title, '실수로 지운 행사');
});

test('달력: 학기 기간이 없는 학년도의 달은 수업일수 0일이 아니라 없음으로', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  g.putSetting_('1학기 시작일', '2026-03-02', { id: '', name: '시험' }); g.putSetting_('1학기 끝일', '2026-07-24', { id: '', name: '시험' });
  g.putSetting_('2학기 시작일', '2026-08-17', { id: '', name: '시험' }); g.putSetting_('2학기 끝일', '2027-02-12', { id: '', name: '시험' });
  assert.ok(call(g, 'sched.month', { year: 2026, month: 10 }, me).data.monthDays.days > 0);
  assert.strictEqual(call(g, 'sched.month', { year: 2027, month: 3 }, me).data.monthDays, null);
  assert.strictEqual(call(g, 'sched.month', { year: 2026, month: 8 }, me).data.monthDays !== null, true, '방학이 걸친 달은 그대로 셈');
});

test('자료: 보관함에서 꺼내기를 두 번 눌러도 한 개만 생긴다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const me = who('심청');
  const it = call(g, 'lib.save', { fields: libFields(g) }, me).data;
  const b = boss();
  const yr = call(g, 'admin.year.start', { year: 2027, keep: [] }, b);
  assert.ok(yr.ok, yr.error);
  const a1 = call(g, 'lib.unarchive', { id: it.id }, b);
  const a2 = call(g, 'lib.unarchive', { id: it.id }, b);
  assert.ok(a1.ok && a2.ok, (a1.error || '') + (a2.error || ''));
  assert.strictEqual(a1.data.id, a2.data.id);
  assert.strictEqual(g.liveRows_('자료').filter((r) => r['원본 자료ID'] === it.id).length, 1);
});

test('올리기: 이름을 고르지 않은 관리자 화면에서 올리면 기록에 관리자(본인 확인 전)으로 남는다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const admin = { login: t.login, admin: t.admin };
  const r = call(g, 'sched.upload.check', { grid: [['날짜', '행사명'], ['2026-10-20', '관리자 올림']] }, admin).data;
  assert.ok(call(g, 'sched.upload.save', { rows: r.rows.map((x) => Object.assign({}, x.raw, { include: true })), mode: 'skip' }, admin).ok);
  const log = g.readRows_('기록').filter((x) => /학사일정 올리기/.test(x['요약'])).pop();
  assert.strictEqual(log['이름'], '관리자(본인 확인 전)');
  assert.strictEqual(g.lastUpload_().by, '관리자(본인 확인 전)');
});

console.log(results.join('\n'));
console.log('\n' + passed + '/' + results.length + ' 통과');
