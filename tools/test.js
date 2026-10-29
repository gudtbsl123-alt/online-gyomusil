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

test('처음 설정: 탭 19개와 머리글, 설정 기본값을 만든다', () => {
  const g = loadGas();
  const r = g.setupAll_();
  assert.strictEqual(r.created.length, 19); // 회의·회의내용(2026-10-22a)
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
  assert.strictEqual(g.seedTestSchedule_(), 18); // 회의·근무 예시 2개(2026-10-19a)
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
  const list = call(g, 'lib.list', { archive: 1 }, me).data; // 보관함까지(보관함은 열 때만 받는다, 판 2026-10-19a)
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
  assert.strictEqual(call(g, 'lib.list', { archive: 1 }, who('심청')).data.items.length, 2);
  assert.strictEqual(call(g, 'lib.list', {}, who('심청')).data.items.length, 1, '보관함 자료는 보관함을 열 때만');
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
  assert.ok(call(g, 'search', { q: '체육대회' }, who('심청')).data.surveys.items.length >= 1, '조사');
  assert.strictEqual(s('체육대회').surveys.total, 0, '이름을 고르기 전에는 조사를 찾지 않음(대상인지 알 수 없어서)');
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
  const items = plain(g.apiLibList_({ archive: 1 }, {}, { identity: null, tokens: {} }).items);
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

test('올리기: 관리자만, 머리글 없는 표는 양식 순서로 읽는다', () => {
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
  const client = { app: b.App, styles: b.Styles, index: b.Index, table: b.TableUi };
  let r = call(g, 'admin.check', { client }, t).data;
  const by = (label) => r.items.find((x) => x.label === label);
  for (const f of ['Code.gs', 'Db.gs', 'Survey.gs', 'Help.gs', 'App.html', 'Styles.html', 'Index.html', 'TableUi.html', '기능 연결', '탭과 칸', '공통 비밀번호']) assert.strictEqual(by(f).state, 'ok', f);
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
  assert.strictEqual(by('TableUi.html').state, 'bad', '새 파일 TableUi를 아직 안 만들었으면');
  assert.match(by('TableUi.html').fix || by('TableUi.html').detail, /TableUi/);
  // 시트에서 직접 비운 줄(손으로 고치면 시트가 onEdit를 불러 서버 기억을 버린다)
  const sh = g._ss.getSheetByName('교직원');
  sh.data[3] = sh.data[3].map(() => '');
  g.onEdit({ range: sh.getRange(4, 1) });
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
  for (const f of ['Code', 'Db', 'Auth', 'Admin', 'Schedule', 'Survey', 'Library', 'Help', 'Setup', 'Table']) assert.strictEqual(g['fileMark_' + f + '_'](), b[f], f);
  const read = (f) => fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
  assert.strictEqual(/var APP_FILE_BUILD = '([^']+)'/.exec(read('App.html'))[1], b.App);
  assert.strictEqual(/--gy-build:"([^"]+)"/.exec(read('Styles.html'))[1], b.Styles);
  assert.strictEqual(/<meta name="gy-build" content="([^"]+)">/.exec(read('Index.html'))[1], b.Index);
  assert.strictEqual(/window\.__gyTableUiBuild = '([^']+)'/.exec(read('TableUi.html'))[1], b.TableUi);
  assert.ok(Object.keys(b).every((f) => b[f] <= g.APP_BUILD_), 'APP_BUILD_는 가장 최근 판');
});

test('교표: Styles.html의 교표 그림(--gy-emblem)이 잘리지 않은 PNG이고, 메뉴·위 막대·로그인 화면과 여는 그림이 책 대신 교표를 쓴다', () => {
  const read = (f) => fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
  const m = /--gy-emblem:url\("data:image\/png;base64,([A-Za-z0-9+/=]+)"\)/.exec(read('Styles.html'));
  assert.ok(m, '--gy-emblem 한 줄');
  const png = Buffer.from(m[1], 'base64');
  assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG 머리');
  assert.strictEqual(png.subarray(png.length - 8, png.length - 4).toString('latin1'), 'IEND', 'PNG 끝까지 있음(잘리지 않음)');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  assert.ok(w === h && w >= 96, '정사각형 96px 이상: ' + w + '×' + h);
  const app = read('App.html');
  assert.strictEqual((app.match(/class="brand-mark emblem"/g) || []).length, 3, '메뉴·위 막대·로그인 화면');
  assert.ok(!/icon\('book'/.test(app), '책 로고가 남지 않음');
  const idx = read('Index.html');
  assert.ok(/\.gi-logo\{[^}]*var\(--gy-emblem\)/.test(idx) && !/BOOK/.test(idx), '여는 그림의 로고도 교표');
});

test('여는 그림 인사: 응원 문장 20개 중 하나를 열 때마다 고르고, 바로 전 문장은 다시 나오지 않는다(이름이 와도 같은 문장)', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(GAS_DIR, 'Index.html'), 'utf8');
  const head = 'window.__gyIntroU = (function () {', tail = 'return U;\n})();';
  const a = src.indexOf(head), b = src.indexOf(tail, a);
  assert.ok(a > 0 && b > a, '인트로 도구 묶음');
  const code = src.slice(a, b + tail.length);
  const store = {};
  const sb = { window: {}, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  vm.createContext(sb);
  // 늘 같은 결과가 나오게 정해진 난수(mulberry32)를 쓴다
  vm.runInContext('var __s = 7; Math.random = function () { __s = (__s + 0x6D2B79F5) | 0; var t = Math.imul(__s ^ (__s >>> 15), 1 | __s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };', sb);
  let prev = null;
  const seen = new Set();
  for (let k = 0; k < 300; k++) { // 열 때마다 새로 읽힌다
    vm.runInContext(code, sb);
    const U = sb.window.__gyIntroU;
    const g = U.hello('');
    assert.strictEqual(U.hello('성춘향'), '성춘향 선생님, ' + g, '이름이 와도 같은 문장');
    assert.notStrictEqual(g, prev, '바로 전 문장이 또 나옴: ' + g);
    prev = g;
    seen.add(g);
  }
  const H = sb.window.__gyIntroU.HELLOS;
  assert.strictEqual(H.length, 20);
  assert.strictEqual(new Set(H).size, 20, '겹치는 문장 없음');
  assert.strictEqual(seen.size, 20, '20개가 모두 나온다');
  assert.ok(H.every((x) => x.length <= 17 && !/수고|아침|오후|저녁|반가워요/.test(x)), '짧고, 시간에 매이지 않고, 홈 제목(오늘도 반가워요)과 겹치지 않는 문장');
  store['gy.helloLast'] = '엉뚱한 값';
  vm.runInContext(code, sb);
  assert.ok(H.indexOf(sb.window.__gyIntroU.hello('')) >= 0, '기억한 값이 이상해도 20개 중에서 고른다');
});

test('화면 디자인: 장도·종이색은 시안과 같은 변수 이름을 모두 갖고(밝게·어둡게) 글자 대비가 4.5:1 이상, 고르는 곳은 메뉴 아래·휴대폰 전체 메뉴', () => {
  const read = (f) => fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
  const css = read('Styles.html');
  const block = (sel) => {
    const i = css.indexOf(sel + '{');
    assert.ok(i >= 0, sel);
    const o = {};
    css.slice(i + sel.length + 1, css.indexOf('}', i)).split(';').forEach((kv) => { const j = kv.indexOf(':'); if (j > 0) o[kv.slice(0, j).trim()] = kv.slice(j + 1).trim(); });
    return o;
  };
  const lum = (h) => {
    const m = /^#([0-9a-f]{6})$/i.exec(h);
    assert.ok(m, '색 ' + h);
    const c = [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const names = Object.keys(block(':root,:root[data-theme="light"]')).sort();
  for (const d of ['jangdo', 'paper']) {
    for (const [mode, sel] of [['밝게', ':root[data-design="' + d + '"]'], ['어둡게', ':root[data-design="' + d + '"][data-theme="dark"]']]) {
      const t = block(sel);
      assert.deepStrictEqual(Object.keys(t).sort(), names, d + ' ' + mode + ': 시안과 같은 변수 이름');
      for (const [a, b] of [['--c-t1', '--c-card'], ['--c-t2', '--c-card'], ['--c-t3', '--c-card'], ['--c-t3', '--c-bg'], ['--c-t3', '--c-card2'], ['--accent', '--c-card'], ['--c-onAccent', '--accent'], ['--c-okFg', '--c-okBg'], ['--c-warnFg', '--c-warnBg'], ['--c-red', '--c-card']]) {
        const c = cr(t[a], t[b]);
        assert.ok(c >= 4.5, d + ' ' + mode + ' ' + a + '/' + b + ' 대비 ' + c.toFixed(2));
      }
    }
  }
  // 장도 밝게의 남색 메뉴·위 막대: 글자와 초록 점이 남색 바탕에서 잘 보이게
  const side = block(':root[data-design="jangdo"]:not([data-theme="dark"]) .side,:root[data-design="jangdo"]:not([data-theme="dark"]) .topbar');
  for (const a of ['--c-t1', '--c-t2', '--c-t3', '--accent', '--c-okFg']) assert.ok(cr(side[a], side['--c-sub']) >= 4.5, '남색 메뉴 ' + a + ' 대비 ' + cr(side[a], side['--c-sub']).toFixed(2));
  assert.strictEqual((read('App.html').match(/designSeg\(\) \+/g) || []).length, 2, '메뉴 아래·휴대폰 전체 메뉴');
  assert.ok(/getItem\('gy\.design'\)|g\('gy\.design'\)/.test(read('Index.html')), '처음 그릴 때 고른 디자인을 먼저 정함(깜빡이지 않게)');
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
  assert.strictEqual(r.data.items[0].sheet.reads, 13, '홈은 탭 13개(비상 시 이것부터의 도움말 탭, 회의록 할 일의 회의 탭 포함. 7일 안에 내 부서 칸이 있는 회의가 있을 때만 회의내용도, 2026-10-28a)');
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
  const at = g.PropertiesService.getScriptProperties().getProperty('SHEET_EDIT_AT');
  [undefined, {}, { range: null }, { range: { getSheet: 'x' } }].forEach((ev) => g.onEdit(ev)); // 웹앱에서 이 이름으로 부른 것(시트에서 고친 칸이 없음)
  assert.ok(!title().includes('손으로 고친 제목 3'), '웹앱에서 부른 onEdit는 서버 기억을 버리지 않는다');
  assert.strictEqual(g.PropertiesService.getScriptProperties().getProperty('SHEET_EDIT_AT'), at, '알아챈 시각도 그대로');
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
  g.onEdit({ range: sh.getRange(2, 1) });
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

// ---------------------------------------------------------------- 함께 쓰는 표(Table.gs)

const TB_COLS = [
  { id: 'c1', name: '층', lock: true, merge: true, w: 70 },
  { id: 'c2', name: '각 실', lock: true },
  { id: 'c3', name: '입력완료', type: 'pick', options: ['완료', '미완료'] },
  { id: 'c4', name: '배출이 어려운 가구', w: 300 }
];
/** 예시 표(4줄). 만든 분: by */
function tbMake(g, by, extra) {
  const rows = [
    { cells: { c1: '1층', c2: '교장실', c3: '미완료' }, colors: { c1: '#f4cccc', c2: '#FFFFFF' } },
    { cells: { c1: '1층', c2: '보건실', c3: '완료', c4: '의자 8개' } },
    { cells: { c1: '2층', c2: '3-1', c3: ' 완 료 ', c4: '=SUM(A1)' } },
    { cells: { c1: '2층', c2: '0101', c3: '모름' } }
  ];
  const req = { fields: { title: '폐기 물품 조사', deadline: '' }, cols: TB_COLS, rows };
  const r = call(g, 'table.create', Object.assign(req, extra || {}), by);
  assert.ok(r.ok, r.error);
  return r.data.id;
}
function tbGet(g, id, by) {
  const r = call(g, 'table.get', { id }, by);
  assert.ok(r.ok, r.error);
  return r.data;
}
/** 화면이 알던 그 칸의 판(고친 적이 없으면 0) */
function tbBase(d, i, c) {
  const st = d.rows[i].stamps[c];
  return st ? st[0] : 0;
}

test('함께 쓰는 표: 탭이 없던 시트에서도 목록이 열리고, 이름을 고른 누구나 만들면 탭이 생기며 붙여 넣은 글·바탕색·열이 그대로 남는다', () => {
  const g = freshName();
  const { who, L } = ids(g);
  g._ss.sheets = g._ss.sheets.filter((x) => x.name !== '함께표' && x.name !== '함께표줄'); // 이 기능 전에 설치한 시트
  let ls = call(g, 'table.list', {}, { login: L });
  assert.ok(ls.ok, ls.error);
  assert.deepStrictEqual(plain(ls.data.tables), []);
  assert.strictEqual(ls.data.canCreate, false, '이름을 고르기 전에는 보기만');
  assert.strictEqual(call(g, 'table.create', { fields: { title: 'x' }, cols: TB_COLS }, { login: L }).code, 'IDENTITY');
  const a = who('흥부');
  assert.strictEqual(call(g, 'table.list', {}, a).data.canCreate, true);
  const id = tbMake(g, a);
  assert.ok(g._ss.getSheetByName('함께표') && g._ss.getSheetByName('함께표줄'), '탭이 생김');
  assert.deepStrictEqual(plain(g.headOf_('함께표줄')), plain(g.tabs_()['함께표줄']));
  const d = tbGet(g, id, who('심청'));
  assert.deepStrictEqual(d.table.cols.map((c) => c.id), ['c1', 'c2', 'c3', 'c4']);
  assert.strictEqual(d.table.cols[0].merge, true);
  assert.strictEqual(d.table.cols[0].w, 70);
  assert.deepStrictEqual(plain(d.table.cols[2].options), ['완료', '미완료']);
  assert.strictEqual(d.rows.length, 4);
  assert.strictEqual(d.rows[2].cells.c3, '완료', '고르기 열은 띄어쓰기만 다른 값을 정해 둔 값으로 맞춘다');
  assert.strictEqual(d.rows[3].cells.c3, '모름', '정해 둔 값이 아니어도 붙여 넣은 값은 남는다');
  assert.strictEqual(d.rows[2].cells.c4, '=SUM(A1)', '수식이 되지 않고 글자 그대로');
  assert.strictEqual(d.rows[3].cells.c2, '0101', '앞자리 0이 지켜진다');
  assert.strictEqual(d.rows[2].cells.c2, '3-1');
  assert.deepStrictEqual(plain(d.rows[0].colors), { c1: '#F4CCCC' }, '흰 바탕은 담지 않는다');
  assert.ok(d.rows.every((r) => r.n >= 2), '줄마다 시트 행 번호(고칠 때 돌려보내는 짐작값)');
  assert.strictEqual(d.table.canEdit, false, '심청은 만든 분이 아님');
  assert.strictEqual(d.table.canWrite, true);
  ls = call(g, 'table.list', {}, a).data;
  assert.strictEqual(ls.tables.length, 1);
  assert.strictEqual(ls.tables[0].mine, true);
  assert.strictEqual(ls.tables[0].by, '흥부');
  assert.strictEqual(ls.tables[0].summary.rows, 4);
  assert.deepStrictEqual(plain(ls.tables[0].summary.pick.counts), { '완료': 2, '미완료': 1 });
  assert.strictEqual(ls.tables[0].summary.pick.other, 1);
  const log = g.readRows_('기록').filter((x) => x['탭'] === '함께표' || x['탭'] === '함께표줄');
  assert.deepStrictEqual(plain(log.map((x) => x['동작'])), ['추가', '추가']);
  assert.strictEqual(log[0]['이름'], '흥부');
});

test('함께 쓰는 표: 칸은 누구나 고치고, 잠근 열은 만든 분·관리(관리자 화면)·그 줄을 더한 분만, 기록에 바뀌기 전·후가 남는다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const owner = who('흥부'), b = who('심청'), c = who('장화');
  const id = tbMake(g, owner);
  const d = tbGet(g, id, b);
  const r0 = d.rows[0];
  const r = call(g, 'table.cell', { id, row: r0.id, n: r0.n, col: 'c4', value: '  책상 2개 ', base: 0 }, b);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.row.cells.c4, '책상 2개', '앞뒤 빈칸은 뺀다');
  assert.strictEqual(r.data.row.by, '심청');
  assert.strictEqual(r.data.row.stamps.c4[1], '심청');
  assert.ok(r.data.ver > d.table.ver, '판이 오른다');
  assert.strictEqual(call(g, 'table.cell', { id, row: r0.id, col: 'c2', value: '교감실', base: 0 }, b).code, 'LOCKED');
  assert.strictEqual(call(g, 'table.cell', { id, row: r0.id, col: 'c2', value: '교감실', base: 0 }, who('홍길동')).code, 'LOCKED',
    '역할이 관리여도 이름만 방식에서는 관리자 화면을 연 기기에서만');
  const bs = call(g, 'table.cell', { id, row: r0.id, col: 'c2', value: '교감실', base: 0 }, boss('홍길동'));
  assert.ok(bs.ok && !bs.data.conflict, bs.error);
  assert.ok(call(g, 'table.cell', { id, row: r0.id, col: 'c2', value: '교장실', base: bs.data.row.stamps.c2[0] }, owner).ok, '만든 분');
  // 장화가 더한 줄: 그 줄의 잠근 칸은 장화도 고친다
  const add = call(g, 'table.row.add', { id, cells: { c1: '3층', c2: '과학실' } }, c);
  assert.ok(add.ok, add.error);
  assert.strictEqual(add.data.row.cells.c1, '3층', '내가 더한 줄은 잠근 칸도 채운다');
  assert.ok(call(g, 'table.cell', { id, row: add.data.row.id, col: 'c2', value: '과학실 2', base: add.data.row.stamps.c2[0] }, c).ok);
  assert.strictEqual(call(g, 'table.cell', { id, row: add.data.row.id, col: 'c2', value: '음악실', base: 0 }, b).code, 'LOCKED');
  assert.strictEqual(call(g, 'table.cell', { id, row: r0.id, col: 'c9', value: 'x', base: 0 }, b).code, 'STALE', '없는 열');
  assert.match(call(g, 'table.cell', { id, row: r0.id, col: 'c4', value: 'x'.repeat(2001), base: tbBase(d, 0, 'c4') }, b).error, /2000자까지/);
  const log = g.readRows_('기록').filter((x) => x['대상ID'] === r0.id);
  assert.strictEqual(log[0]['이름'], '심청');
  assert.strictEqual(log[0]['동작'], '수정');
  assert.match(log[0]['요약'], /폐기 물품 조사.*1층 교장실.*배출이 어려운 가구/);
  assert.deepStrictEqual(JSON.parse(log[0]['바뀌기 전']), { '배출이 어려운 가구': '' });
  assert.deepStrictEqual(JSON.parse(log[0]['바뀐 뒤']), { '배출이 어려운 가구': '책상 2개' });
  assert.deepStrictEqual(JSON.parse(log[1]['바뀐 뒤']), { '각 실': '교감실' });
});

test('함께 쓰는 표: 같은 칸을 그사이 다른 분이 고쳤으면 덮어쓰지 않고 묻고(먼저 고친 값·분·시각), 내 값으로 바꾸기를 고르면 바뀐다', () => {
  const g = freshName();
  const { who } = ids(g);
  const a = who('심청'), b = who('장화');
  const id = tbMake(g, who('흥부'));
  const da = tbGet(g, id, a), db = tbGet(g, id, b); // 두 분이 같은 때 연 화면
  const row = da.rows[1];
  assert.ok(!call(g, 'table.cell', { id, row: row.id, n: row.n, col: 'c4', value: '의자 8개, 책상', base: tbBase(da, 1, 'c4') }, a).data.conflict);
  const late = call(g, 'table.cell', { id, row: row.id, n: row.n, col: 'c4', value: '의자 9개', base: tbBase(db, 1, 'c4') }, b);
  assert.ok(late.ok, late.error);
  assert.ok(late.data.conflict, '덮어쓰지 않고 묻는다');
  assert.strictEqual(late.data.conflict.value, '의자 8개, 책상');
  assert.strictEqual(late.data.conflict.by, '심청');
  assert.match(late.data.conflict.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.strictEqual(late.data.row.cells.c4, '의자 8개, 책상', '먼저 고친 값 두기를 고르면 쓸 줄');
  assert.strictEqual(tbGet(g, id, a).rows[1].cells.c4, '의자 8개, 책상', '먼저 고친 값이 그대로');
  // 같은 줄의 다른 칸은 묻지 않고 둘 다 남는다
  assert.ok(!call(g, 'table.cell', { id, row: row.id, col: 'c3', value: '미완료', base: tbBase(db, 1, 'c3') }, b).data.conflict);
  const mine = call(g, 'table.cell', { id, row: row.id, col: 'c4', value: '의자 9개', base: late.data.conflict.base }, b);
  assert.ok(mine.ok && !mine.data.conflict, '내 값으로 바꾸기');
  const d = tbGet(g, id, a);
  assert.strictEqual(d.rows[1].cells.c4, '의자 9개');
  assert.strictEqual(d.rows[1].cells.c3, '미완료');
  assert.ok(!call(g, 'table.cell', { id, row: row.id, col: 'c4', value: '의자 9개', base: 0 }, a).data.conflict, '이미 같은 값이면 묻지 않는다');
});

test('함께 쓰는 표: 10초마다 새로 받기는 바뀐 줄만 받고, 바뀐 것이 없으면 판만, 지운 표는 없다고 알린다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMake(g, owner);
  const d = tbGet(g, id, a), dv = d.table.dver;
  let p = call(g, 'table.poll', { id, since: d.table.ver, dsince: dv }, a).data;
  assert.strictEqual(p.same, true);
  assert.strictEqual(p.ver, d.table.ver);
  assert.ok(!p.rows);
  assert.ok(!p.doc, '시트 목록이 그대로면 보내지 않는다');
  assert.ok(call(g, 'table.cell', { id, row: d.rows[2].id, col: 'c4', value: '창틀', base: tbBase(d, 2, 'c4') }, owner).ok);
  p = call(g, 'table.poll', { id, since: d.table.ver, dsince: dv }, a).data;
  assert.strictEqual(p.rows.length, 1, '바뀐 줄만');
  assert.strictEqual(p.rows[0].id, d.rows[2].id);
  assert.strictEqual(p.rows[0].cells.c4, '창틀');
  assert.strictEqual(p.rows[0].by, '흥부');
  assert.strictEqual(p.table.cols.length, 4);
  const v1 = p.ver;
  assert.ok(call(g, 'table.row.delete', { id, row: d.rows[3].id }, owner).ok);
  p = call(g, 'table.poll', { id, since: v1, dsince: dv }, a).data;
  assert.deepStrictEqual(p.rows.map((r) => [r.id, r.del]), [[d.rows[3].id, true]], '뺀 줄도 알린다');
  assert.ok(call(g, 'table.setOpen', { id, open: false }, owner).ok);
  p = call(g, 'table.poll', { id, since: p.ver, dsince: dv }, a).data;
  assert.strictEqual(p.table.closed, true, '마감도 새로 받는다(문서 판)');
  assert.ok(p.dver > dv);
  assert.deepStrictEqual(p.doc.sheets.map((x) => x.name), ['시트1']);
  assert.deepStrictEqual(plain(p.rows), []);
  assert.ok(call(g, 'table.delete', { id }, owner).ok);
  assert.strictEqual(call(g, 'table.poll', { id, since: p.ver, dsince: p.dver }, a).data.gone, true);
});

test('함께 쓰는 표: 줄 더하기는 누구나(아래에 더하면 그 자리에), 줄 빼기는 만든 분·관리·그 줄을 더한 분만', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const owner = who('흥부'), a = who('심청'), b = who('장화');
  const id = tbMake(g, owner);
  let d = tbGet(g, id, a);
  assert.ok(call(g, 'table.row.add', { id, cells: { c2: '과학실' } }, a).ok);
  const mid = call(g, 'table.row.add', { id, after: d.rows[0].id, cells: { c1: '1층', c2: '교감실' } }, b);
  assert.ok(mid.ok, mid.error);
  assert.ok(call(g, 'table.row.add', { id, after: d.rows[0].id, cells: { c1: '1층', c2: '상담실' } }, b).ok);
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.rows.map((r) => r.cells.c2), ['교장실', '상담실', '교감실', '보건실', '3-1', '0101', '과학실']);
  assert.strictEqual(d.rows[2].by, '장화', '나중에 더한 줄은 더한 분이 보인다');
  assert.strictEqual(d.rows[0].by, '', '표를 만들 때 넣은 줄은 고친 분이 없다');
  const science = d.rows[6], counsel = d.rows[1];
  assert.strictEqual(call(g, 'table.row.delete', { id, row: science.id, n: science.n }, b).code, 'FORBIDDEN', '다른 분이 더한 줄');
  assert.strictEqual(call(g, 'table.row.delete', { id, row: d.rows[0].id }, a).code, 'FORBIDDEN', '만든 분이 넣은 줄');
  assert.ok(call(g, 'table.row.delete', { id, row: science.id, n: science.n }, a).ok, '내가 더한 줄');
  assert.ok(call(g, 'table.row.delete', { id, row: counsel.id }, owner).ok, '만든 분');
  assert.ok(call(g, 'table.row.delete', { id, row: d.rows[0].id }, boss('성춘향')).ok, '관리');
  assert.ok(call(g, 'table.row.delete', { id, row: d.rows[0].id }, owner).ok, '두 번 눌러도 괜찮다');
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.rows.map((r) => r.cells.c2), ['교감실', '보건실', '3-1', '0101']);
  const del = g.readRows_('기록').filter((x) => x['탭'] === '함께표줄' && x['동작'] === '삭제');
  assert.strictEqual(del.length, 3);
  assert.deepStrictEqual(JSON.parse(del[0]['바뀌기 전']), { '각 실': '과학실' });
  // 줄은 500개까지
  const many = Array.from({ length: 500 }, (_, i) => ({ cells: { c2: '실 ' + (i + 1) } }));
  const big = call(g, 'table.create', { fields: { title: '큰 표' }, cols: TB_COLS, rows: many }, owner);
  assert.ok(big.ok, big.error);
  assert.match(call(g, 'table.row.add', { id: big.data.id }, a).error, /500개까지/);
  assert.match(call(g, 'table.create', { fields: { title: '너무 큰 표' }, cols: TB_COLS, rows: many.concat([{ cells: {} }]) }, owner).error, /500개까지/);
});

test('함께 쓰는 표: 마감하면 만든 분·관리만 고치고, 마감 날짜가 지나면 날짜를 늦춰야 다시 열린다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMake(g, owner);
  let d = tbGet(g, id, a);
  const r1 = d.rows[1];
  assert.strictEqual(call(g, 'table.setOpen', { id, open: false }, a).code, 'FORBIDDEN');
  assert.ok(call(g, 'table.setOpen', { id, open: false }, owner).ok);
  d = tbGet(g, id, a);
  assert.strictEqual(d.table.closed, true);
  assert.strictEqual(d.table.closedByHand, true);
  assert.strictEqual(d.table.canWrite, false);
  assert.strictEqual(call(g, 'table.cell', { id, row: r1.id, col: 'c4', value: 'x', base: 0 }, a).code, 'CLOSED');
  assert.strictEqual(call(g, 'table.row.add', { id }, a).code, 'CLOSED');
  assert.strictEqual(call(g, 'table.cells', { id, cells: [{ row: r1.id, col: 'c4', value: 'x', base: 0 }] }, a).code, 'CLOSED');
  assert.ok(call(g, 'table.cell', { id, row: r1.id, col: 'c4', value: '만든 분은 고침', base: tbBase(d, 1, 'c4') }, owner).ok);
  assert.ok(call(g, 'table.setOpen', { id, open: true }, boss('성춘향')).ok, '관리도 다시 연다');
  assert.ok(call(g, 'table.save', { id, fields: { title: '폐기 물품 조사', deadline: '2020-03-02' } }, owner).ok);
  d = tbGet(g, id, a);
  assert.strictEqual(d.table.closed, true, '마감 날짜가 지남');
  assert.strictEqual(d.table.closedByHand, false);
  assert.match(call(g, 'table.setOpen', { id, open: true }, owner).error, /마감 날짜가 지났어요/);
  assert.ok(call(g, 'table.save', { id, fields: { title: '폐기 물품 조사', deadline: g.tbToday_() } }, owner).ok);
  d = tbGet(g, id, a);
  assert.strictEqual(d.table.closed, false, '마감 날짜 당일까지는 열려 있다');
  assert.ok(call(g, 'table.cell', { id, row: r1.id, col: 'c4', value: '심청이 고침', base: tbBase(d, 1, 'c4') }, a).ok);
  assert.strictEqual(call(g, 'table.save', { id, fields: { title: '남의 표' } }, a).code, 'FORBIDDEN');
  assert.match(call(g, 'table.save', { id, fields: { title: '' } }, owner).error, /표 이름을 적어 주세요/);
  const id2 = tbMake(g, owner, { fields: { title: '닫힌 표' } });
  assert.ok(call(g, 'table.setOpen', { id: id2, open: false }, owner).ok);
  assert.deepStrictEqual(call(g, 'table.list', {}, a).data.tables.map((x) => [x.title, x.closed]), [['폐기 물품 조사', false], ['닫힌 표', true]], '열린 표가 먼저');
});

test('함께 쓰는 표: 열을 빼도 칸의 값과 열 ID는 남고(다시 쓰지 않음), 새 열은 새 ID, 열 고치기는 만든 분·관리만', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMake(g, owner);
  let d = tbGet(g, id, a);
  const v0 = d.table.ver;
  const cols = plain(d.table.cols);
  assert.strictEqual(call(g, 'table.cols', { id, cols }, a).code, 'FORBIDDEN');
  assert.ok(call(g, 'table.cols', { id, cols: [cols[0], cols[2], cols[3], { name: '사진' }] }, owner).ok);
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.table.cols.map((c) => c.id), ['c1', 'c3', 'c4', 'c5']);
  assert.strictEqual(d.rows[0].cells.c2, '교장실', '뺀 열의 값은 시트에 그대로');
  assert.ok(call(g, 'table.cols', { id, cols: plain(d.table.cols).concat([{ id: 'c2', name: '옛 ID를 다시' }]) }, owner).ok);
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.table.cols.map((c) => c.id), ['c1', 'c3', 'c4', 'c5', 'c6'], '뺀 열의 ID는 다시 쓰지 않는다(옛 값이 되살아나지 않게)');
  const all = JSON.parse(g.readRows_('함께표')[0]['열']);
  assert.ok(all.find((c) => c.id === 'c2' && c.del), '뺀 열은 del로 남는다');
  assert.match(call(g, 'table.cols', { id, cols: [{ id: 'c1', name: '층', type: 'pick', options: [] }] }, owner).error, /고를 값/);
  assert.match(call(g, 'table.cols', { id, cols: [] }, owner).error, /열이 하나도 없어요/);
  const p = call(g, 'table.poll', { id, since: v0, dsince: d.table.dver }, a).data;
  assert.deepStrictEqual(p.table.cols.map((c) => c.name), ['층', '입력완료', '배출이 어려운 가구', '사진', '옛 ID를 다시'], '열이 바뀐 것도 새로 받는다');
});

test('함께 쓰는 표: 여러 칸 붙여 넣기는 한 번에(잠근 칸은 건너뛰고, 그사이 고친 칸은 알려 주고, 모자란 줄은 끝에 더함), 기록은 한 줄', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청'), b = who('장화');
  const id = tbMake(g, owner);
  const d = tbGet(g, id, a);
  assert.ok(call(g, 'table.cell', { id, row: d.rows[1].id, col: 'c4', value: '장화가 먼저', base: tbBase(d, 1, 'c4') }, b).ok);
  const logN = g.readRows_('기록').length;
  const at = (i, col, value) => ({ row: d.rows[i].id, n: d.rows[i].n, col, value, base: tbBase(d, i, col) });
  const r = call(g, 'table.cells', {
    id,
    cells: [at(0, 'c3', '완료'), at(0, 'c4', '책상'), at(1, 'c3', '미완료'), at(1, 'c4', '심청 값'), at(0, 'c2', '잠근 칸')],
    add: [{ cells: { c2: '새 실', c3: '완료' } }, { cells: { c4: '두 번째' } }]
  }, a);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.skipLocked, 1);
  assert.deepStrictEqual(plain(r.data.conflicts).map((x) => [x.row, x.col, x.mine, x.value, x.by]), [[d.rows[1].id, 'c4', '심청 값', '장화가 먼저', '장화']]);
  assert.ok(r.data.conflicts[0].base > 0, '내 값으로 바꾸기를 고르면 이 판으로 다시 보낸다');
  assert.strictEqual(r.data.changed, 6, '고친 칸 3 + 더한 줄에 채운 칸 3');
  assert.strictEqual(r.data.rows.length, 4, '바뀐 줄 2 + 더한 줄 2');
  const e = tbGet(g, id, a);
  assert.strictEqual(e.rows[0].cells.c3, '완료');
  assert.strictEqual(e.rows[0].cells.c4, '책상');
  assert.strictEqual(e.rows[0].cells.c2, '교장실', '잠근 칸은 그대로');
  assert.strictEqual(e.rows[1].cells.c4, '장화가 먼저', '그사이 고친 칸은 덮어쓰지 않음');
  assert.strictEqual(e.rows[1].cells.c3, '미완료');
  assert.strictEqual(e.rows.length, 6);
  assert.strictEqual(e.rows[4].cells.c2, '새 실', '내가 더한 줄이라 잠근 칸도 채운다');
  assert.strictEqual(e.rows[5].cells.c4, '두 번째');
  const logs = g.readRows_('기록').slice(logN);
  assert.strictEqual(logs.length, 1, '기록은 한 줄');
  assert.match(logs[0]['요약'], /여러 칸: 6칸, 줄 2개 더함/);
  assert.strictEqual(JSON.parse(logs[0]['바뀐 뒤'])['1층 교장실 · 배출이 어려운 가구'], '책상');
  assert.match(call(g, 'table.cells', { id, cells: Array.from({ length: 5001 }, () => ({ row: 'x', col: 'c1', value: '' })) }, a).error, /5000칸까지/);
  assert.strictEqual(call(g, 'table.cells', { id, cells: [at(0, 'c4', 'x')] }, { login: a.login }).code, 'IDENTITY');
  // 더하는 줄은 채운 칸 수만큼 센다(2026-10-28a): 2열 × 200줄 = 400칸은 된다(예전에는 200줄 × 30칸으로 세어 막혔다)
  const add200 = Array.from({ length: 200 }, (_, k) => ({ cells: { c3: '미완료', c4: '물품 ' + k } }));
  const big2 = call(g, 'table.cells', { id, cells: [], add: add200 }, a);
  assert.strictEqual(big2.ok, true, big2.error);
  assert.strictEqual(tbGet(g, id, a).rows.length, 206);
  assert.match(call(g, 'table.cells', { id, cells: [], add: Array.from({ length: 170 }, () => ({ cells: { c1: '1', c2: '2', c3: '완료', c4: 'x', c5: 'y', c6: 'z', c7: 'a', c8: 'b', c9: 'c', c10: 'd', c11: 'e', c12: 'f', c13: 'g', c14: 'h', c15: 'i', c16: 'j', c17: 'k', c18: 'l', c19: 'm', c20: 'n', c21: 'o', c22: 'p', c23: 'q', c24: 'r', c25: 's', c26: 't', c27: 'u', c28: 'v', c29: 'w', c30: 'x' } })) }, a).error, /5000칸까지/, '채운 칸이 5000을 넘으면 막는다');
});

test('함께 쓰는 표: 지우기는 만든 분·관리만, 지우면 목록에서 사라지고 관리자 › 휴지통에서 되살린다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMake(g, owner);
  assert.strictEqual(call(g, 'table.delete', { id }, a).code, 'FORBIDDEN');
  assert.ok(call(g, 'table.delete', { id }, owner).ok);
  assert.strictEqual(call(g, 'table.delete', { id }, owner).code, 'NOTFOUND', '이미 지운 표');
  assert.strictEqual(call(g, 'table.list', {}, a).data.tables.length, 0);
  assert.strictEqual(call(g, 'table.get', { id }, a).code, 'NOTFOUND');
  assert.strictEqual(call(g, 'admin.trash.tables', {}, a).code, 'ADMIN');
  const bs = boss();
  const tr = call(g, 'admin.trash.tables', {}, bs).data;
  assert.strictEqual(tr.length, 1);
  assert.strictEqual(tr[0].title, '폐기 물품 조사');
  assert.strictEqual(tr[0].deletedBy, '흥부');
  assert.ok(call(g, 'admin.trash.restoreTable', { id }, bs).ok);
  assert.strictEqual(call(g, 'table.list', {}, a).data.tables.length, 1);
  assert.strictEqual(tbGet(g, id, a).rows.length, 4, '줄도 그대로');
  const log = g.readRows_('기록').filter((x) => x['대상ID'] === id).map((x) => x['동작']);
  assert.deepStrictEqual(plain(log), ['추가', '삭제', '되살리기']);
});

test('함께 쓰는 표: 칸·줄을 고칠 때는 잠금 안에서 탭 전체가 아니라 그 줄만 읽고 쓴다(시트를 손으로 정렬해 행 번호가 틀려도 맞는 줄을 고친다)', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  tbMake(g, owner, { fields: { title: '먼저 만든 표' } });
  const id = tbMake(g, owner);
  const d = tbGet(g, id, a);
  const sh = g._ss.getSheetByName('함께표줄');
  const getRange = sh.getRange, getDataRange = sh.getDataRange;
  let multi = 0, full = 0;
  sh.getRange = function (r, c, nr, nc) { if ((nr || 1) > 1) multi++; return getRange.call(this, r, c, nr, nc); };
  sh.getDataRange = function () { full++; return getDataRange.call(this); };
  const r = call(g, 'table.cell', { id, row: d.rows[2].id, n: d.rows[2].n, col: 'c4', value: '한 줄만', base: tbBase(d, 2, 'c4') }, a);
  assert.ok(r.ok, r.error);
  assert.strictEqual(full, 0, '탭 전체를 읽지 않음');
  assert.strictEqual(multi, 0, '여러 줄 범위를 읽거나 쓰지 않음');
  sh.getRange = getRange;
  sh.getDataRange = getDataRange;
  const i2 = d.rows[2].n - 1, i3 = d.rows[3].n - 1; // 손으로 정렬해 두 줄이 자리를 바꿈
  const tmp = sh.data[i2]; sh.data[i2] = sh.data[i3]; sh.data[i3] = tmp;
  assert.ok(call(g, 'table.cell', { id, row: d.rows[2].id, n: d.rows[2].n, col: 'c4', value: '옮겨도 맞는 줄', base: r.data.row.stamps.c4[0] }, a).ok);
  const e = tbGet(g, id, a);
  assert.strictEqual(e.rows.find((x) => x.id === d.rows[2].id).cells.c4, '옮겨도 맞는 줄');
  assert.strictEqual(e.rows.find((x) => x.id === d.rows[3].id).cells.c4 || '', '', '다른 줄은 그대로');
  assert.strictEqual(e.rows.find((x) => x.id === d.rows[2].id).n, d.rows[3].n, '새 행 번호를 알려 준다');
});

test('화면 파일: App.html·Index.html·TableUi.html 스크립트가 문법에 맞고, 줄 바꿈으로 읽히는 숨은 글자(U+2028 등)가 없다', () => {
  for (const f of ['App.html', 'Index.html', 'TableUi.html']) {
    const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
    assert.ok(!/[\u2028\u2029]/.test(src), f + ': U+2028·U+2029가 있으면 정규식이 깨진다(\\u2028로 적기)');
    const scripts = src.match(/<script>([\s\S]*?)<\/script>/g) || [];
    assert.ok(scripts.length, f + ' 스크립트');
    scripts.forEach((sc, i) => { new Function(sc.replace(/^<script>|<\/script>$/g, '')); }); // 문법 오류면 여기서 멈춘다
  }
});

test('함께 쓰는 표: 아래에 더한 줄은 위 줄의 합친 칸 값과 바탕색을 이어 받는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부');
  const id = tbMake(g, owner);
  const d = tbGet(g, id, owner);
  const r = call(g, 'table.row.add', { id, after: d.rows[0].id, cells: { c1: '1층' }, colors: { c1: '#f4cccc', c2: '#FFFFFF', c3: 'red' } }, who('심청'));
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(plain(r.data.row.colors), { c1: '#F4CCCC' }, '흰색·이상한 값은 담지 않는다');
  assert.strictEqual(tbGet(g, id, owner).rows[1].colors.c1, '#F4CCCC');
});

test('점검: 함께표 탭은 아직 없어도 문제로 보지 않는다(처음 만들 때 저절로 생김)', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  g._ss.sheets = g._ss.sheets.filter((x) => x.name !== '함께표' && x.name !== '함께표줄');
  const b = g.fileBuilds_();
  const r = call(g, 'admin.check', { client: { app: b.App, styles: b.Styles, index: b.Index } }, t).data;
  const by = (label) => r.items.find((x) => x.label === label);
  assert.strictEqual(by('함께표 탭').state, 'ok');
  assert.match(by('함께표 탭').detail, /저절로/);
  assert.ok(!r.items.some((x) => x.state === 'bad' && x.group === '시트'));
  assert.ok(r.items.some((x) => /Table/.test(x.label) && x.state === 'ok'), 'Table.gs 판 확인');
});

// ---------------------------------------------------------------- 함께 쓰는 표 2판(시트 여러 개·서식, 판 2026-10-18a)

/** 시트 여러 개짜리 표: 첫 시트 '폐기 물품'(tbMake와 같은 4줄) */
function tbMakeDoc(g, by) {
  const id = tbMake(g, by, { fields: { title: '2학기 업무 협의', deadline: '', sheet: '폐기 물품' } });
  return id;
}

test('함께 쓰는 표 2: 시트 더하기·이름·옮기기·사본·지우기는 만든 분·관리만, 목록·열기·새로 받기에 시트가 보인다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMakeDoc(g, owner);
  let d = tbGet(g, id, a);
  assert.strictEqual(d.table.name, '폐기 물품');
  assert.strictEqual(d.table.doc, id);
  assert.deepStrictEqual(d.doc.sheets.map((x) => x.name), ['폐기 물품']);
  const cols = [{ id: 'c1', name: '교시', lock: true }, { id: 'c2', name: '월' }];
  assert.strictEqual(call(g, 'table.sheet.add', { id, name: '시간표', cols, rows: [] }, a).code, 'FORBIDDEN', '시트는 만든 분·관리만');
  const s2 = call(g, 'table.sheet.add', { id, name: '시간표', desc: '과학실(예시)', cols, rows: [{ cells: { c1: '1교시', c2: '3-1' } }] }, owner);
  assert.ok(s2.ok, s2.error);
  assert.match(call(g, 'table.sheet.add', { id, name: ' 시간표 ', cols }, owner).error, /이미 있어요/, '이름은 겹치지 않게');
  assert.match(call(g, 'table.sheet.add', { id, name: '', cols }, owner).error, /시트 이름을 적어 주세요/);
  const s3 = call(g, 'table.sheet.add', { id, name: '상담 주간', cols }, boss('성춘향'));
  assert.ok(s3.ok, '관리도 더한다');
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.doc.sheets.map((x) => x.name), ['폐기 물품', '시간표', '상담 주간']);
  assert.strictEqual(d.table.id, id, '시트를 고르지 않으면 첫 시트');
  const t2 = tbGet(g, s2.data.id, a);
  assert.strictEqual(t2.table.id, s2.data.id, '시트의 ID로도 열린다');
  assert.strictEqual(t2.table.doc, id);
  assert.strictEqual(t2.table.title, '2학기 업무 협의');
  assert.strictEqual(t2.table.desc, '과학실(예시)');
  assert.strictEqual(t2.rows[0].cells.c1, '1교시');
  assert.strictEqual(t2.table.canEdit, false);
  assert.strictEqual(t2.table.canWrite, true);
  const t3 = call(g, 'table.get', { id, sheet: s3.data.id }, a).data;
  assert.strictEqual(t3.table.name, '상담 주간');
  // 목록: 표 하나에 시트 3개
  const ls = call(g, 'table.list', {}, a).data;
  assert.strictEqual(ls.tables.length, 1, '시트는 목록에 따로 보이지 않는다');
  assert.deepStrictEqual(ls.tables[0].sheets.map((x) => [x.name, x.summary.rows]), [['폐기 물품', 4], ['시간표', 1], ['상담 주간', 0]]);
  // 칸 고치기는 시트마다(다른 시트의 줄은 이 시트로 고칠 수 없다)
  assert.strictEqual(call(g, 'table.cell', { id, row: t2.rows[0].id, col: 'c2', value: 'x', base: 0 }, a).code, 'STALE');
  const c = call(g, 'table.cell', { id: s2.data.id, row: t2.rows[0].id, n: t2.rows[0].n, col: 'c2', value: '3-2', base: 0 }, a);
  assert.ok(c.ok, c.error);
  assert.match(g.readRows_('기록').filter((x) => x['대상ID'] === t2.rows[0].id).pop()['요약'], /2학기 업무 협의 › 시간표/);
  // 새로 받기: 다른 분이 시트를 더하거나 이름을 바꾸면 시트 목록이 온다
  let p = call(g, 'table.poll', { id: s2.data.id, since: c.data.ver, dsince: t2.table.dver }, a).data;
  assert.ok(p.same && !p.doc, '시트 목록이 그대로면 판만');
  const dv = p.dver;
  assert.strictEqual(call(g, 'table.sheet.save', { id: s2.data.id, name: '특별실 시간표', desc: '' }, a).code, 'FORBIDDEN');
  assert.ok(call(g, 'table.sheet.save', { id: s2.data.id, name: '특별실 시간표', desc: '바꾼 설명' }, owner).ok);
  p = call(g, 'table.poll', { id: s2.data.id, since: c.data.ver, dsince: dv }, a).data;
  assert.deepStrictEqual(p.doc.sheets.map((x) => x.name), ['폐기 물품', '특별실 시간표', '상담 주간']);
  assert.strictEqual(p.table.desc, '바꾼 설명');
  // 옮기기
  assert.ok(call(g, 'table.sheet.move', { id: s3.data.id, dir: -1 }, owner).ok);
  assert.deepStrictEqual(tbGet(g, id, a).doc.sheets.map((x) => x.name), ['폐기 물품', '상담 주간', '특별실 시간표']);
  assert.ok(call(g, 'table.sheet.move', { id, dir: -1 }, owner).ok, '맨 앞에서 더 앞으로는 그대로');
  assert.strictEqual(call(g, 'table.sheet.move', { id, dir: 1 }, a).code, 'FORBIDDEN');
  // 사본: 열·줄·서식 그대로, 바로 오른쪽에
  const cp = call(g, 'table.sheet.copy', { id: s2.data.id }, owner);
  assert.ok(cp.ok, cp.error);
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.doc.sheets.map((x) => x.name), ['폐기 물품', '상담 주간', '특별실 시간표', '특별실 시간표 사본']);
  const cpd = tbGet(g, cp.data.id, a);
  assert.strictEqual(cpd.rows[0].cells.c2, '3-2');
  assert.notStrictEqual(cpd.rows[0].id, t2.rows[0].id, '줄ID는 새로');
  // 지우기: 첫 시트도 지울 수 있고(표는 그대로), 마지막 하나는 못 지운다
  assert.ok(call(g, 'table.sheet.delete', { id }, owner).ok, '첫 시트 지우기');
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.doc.sheets.map((x) => x.name), ['상담 주간', '특별실 시간표', '특별실 시간표 사본']);
  assert.strictEqual(d.table.title, '2학기 업무 협의', '표 정보는 그대로');
  assert.strictEqual(d.table.name, '상담 주간', '첫 시트가 지워졌으면 다음 시트가 열린다');
  p = call(g, 'table.poll', { id, since: 0, dsince: 0 }, a).data;
  assert.strictEqual(p.sheetGone, true, '보던 시트가 지워졌다고 알린다');
  assert.strictEqual(call(g, 'table.cell', { id, row: tbGet(g, s2.data.id, a).rows[0].id, col: 'c2', value: 'x', base: 0 }, a).code, 'NOTFOUND', '지운 시트는 못 고친다');
  assert.ok(call(g, 'table.sheet.delete', { id: s3.data.id }, owner).ok);
  assert.ok(call(g, 'table.sheet.delete', { id: cp.data.id }, owner).ok);
  assert.match(call(g, 'table.sheet.delete', { id: s2.data.id }, owner).error, /하나뿐/);
  assert.strictEqual(call(g, 'table.list', {}, a).data.tables[0].sheets.length, 1);
  // 휴지통: 지운 시트가 보이고 되살린다(이름이 겹치면 '(되살림)')
  const bs = boss();
  const tr = call(g, 'admin.trash.tables', {}, bs).data;
  assert.deepStrictEqual(tr.map((x) => [x.kind, x.sheet]).sort(), [['sheet', '상담 주간'], ['sheet', '특별실 시간표 사본'], ['sheet', '폐기 물품']]);
  assert.ok(call(g, 'table.sheet.save', { id: s2.data.id, name: '폐기 물품', desc: '' }, owner).ok);
  assert.ok(call(g, 'admin.trash.restoreTable', { id, kind: 'sheet' }, bs).ok);
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.doc.sheets.map((x) => x.name), ['폐기 물품 (되살림)', '폐기 물품']);
  assert.strictEqual(tbGet(g, id, a).table.id, id);
  assert.strictEqual(tbGet(g, id, a).rows.length, 4, '되살린 시트의 줄도 그대로');
});

test('함께 쓰는 표 2: 예전 표(시트 칸이 없던 탭)도 시트1로 열리고, 시트를 더하면 칸이 저절로 붙는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  // 2026-10-17h 모양의 탭: 새 칸이 없다
  const old1 = ['표ID', '제목', '부서ID', '설명', '마감', '상태', '열', '판', '입력자ID', '입력 시각', '수정자ID', '수정 시각', '삭제 여부'];
  const old2 = ['줄ID', '표ID', '순서', '칸', '색', '칸 고친 때', '판', '입력자ID', '입력 시각', '수정자ID', '수정 시각', '삭제 여부'];
  g._ss.sheets = g._ss.sheets.filter((x) => x.name !== '함께표' && x.name !== '함께표줄');
  const s1 = g._ss.insertSheet('함께표'); s1.getRange(1, 1, 1, old1.length).setValues([old1]);
  const s2 = g._ss.insertSheet('함께표줄'); s2.getRange(1, 1, 1, old2.length).setValues([old2]);
  const st = owner.identity;
  const me = g.readRows_('교직원').find((x) => x['이름'] === '흥부')['교직원ID'];
  s1.appendRow(['K0000OLD', "'옛 표", '', "'옛 설명", '', '', JSON.stringify([{ id: 'c1', name: '이름', type: 'text', options: [], lock: false, merge: false, w: 0 }]), "'3", me, "'2026-10-17 09:00", '', '', '']);
  s2.appendRow(['L0000OLD', 'K0000OLD', "'1", JSON.stringify({ c1: '홍길동' }), '', '', "'1", me, "'2026-10-17 09:00", '', '', '']);
  g.dirty_();
  let d = tbGet(g, 'K0000OLD', a);
  assert.strictEqual(d.table.name, '시트1');
  assert.strictEqual(d.table.desc, '옛 설명');
  assert.strictEqual(d.rows[0].cells.c1, '홍길동');
  assert.deepStrictEqual(plain(d.rows[0].fmt), {});
  const c = call(g, 'table.cell', { id: 'K0000OLD', row: 'L0000OLD', col: 'c1', value: '성춘향', base: 0 }, a);
  assert.ok(c.ok, c.error);
  assert.ok(call(g, 'table.sheet.add', { id: 'K0000OLD', name: '시트2', cols: [{ id: 'c1', name: '값' }] }, owner).ok);
  assert.ok(g.headOf_('함께표').indexOf('문서 판') >= 0 && g.headOf_('함께표줄').indexOf('서식') >= 0, '새 칸이 붙음');
  d = tbGet(g, 'K0000OLD', a);
  assert.deepStrictEqual(d.doc.sheets.map((x) => x.name), ['시트1', '시트2']);
  assert.strictEqual(d.rows[0].cells.c1, '성춘향', '있던 값은 그대로');
  assert.ok(call(g, 'table.sheet.save', { id: 'K0000OLD', name: '시트1', desc: '옛 설명' }, owner).ok);
  assert.strictEqual(g.readRows_('함께표').find((x) => x['표ID'] === 'K0000OLD')['시트 이름'], '', '예전 표의 시트1은 비워 둔 그대로');
  void st;
});

test('함께 쓰는 표 2: 서식은 그 칸을 고칠 수 있는 누구나(잠근 칸·잠근 열을 덮는 합치기는 건너뜀), 서식 지우기는 합친 칸을 남긴다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMakeDoc(g, owner);
  const d = tbGet(g, id, a);
  const at = (i, col, extra) => Object.assign({ row: d.rows[i].id, n: d.rows[i].n, col }, extra);
  const logN = g.readRows_('기록').length;
  const r = call(g, 'table.cells', { id, cells: [
    at(0, 'c4', { f: { b: 1, fc: '#cc0000', ff: 'batang', fs: 14, ha: 'c', bd: '0020', bad: 'x' }, fill: '#fce5cd' }),
    at(0, 'c2', { f: { b: 1 } }), // 잠근 열
    at(1, 'c3', { f: { i: 1, u: 1, s: 1, va: 't', wr: 'c', ff: 'comic', fs: 99, fc: 'red' } }),
    at(1, 'c4', { f: { m: [d.rows[2].id, 'c4'] } }),
    at(2, 'c3', { f: { m: [d.rows[2].id, 'c4'] } }),
    at(3, 'c2', { f: { m: [d.rows[3].id, 'c4'] } }) // 잠근 열에서 시작
  ] }, a);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.skipLocked, 2);
  assert.strictEqual(r.data.formatted, 4);
  assert.strictEqual(r.data.changed, 0);
  let e = tbGet(g, id, a);
  assert.deepStrictEqual(plain(e.rows[0].fmt.c4), { ff: 'batang', fs: 14, fc: '#CC0000', b: 1, ha: 'c', bd: '0020' }, '모르는 서식은 버린다');
  assert.strictEqual(e.rows[0].colors.c4, '#FCE5CD');
  assert.ok(!e.rows[0].fmt.c2, '잠근 열은 만든 분·관리만');
  assert.deepStrictEqual(plain(e.rows[1].fmt.c3), { i: 1, u: 1, s: 1, va: 't', wr: 'c' }, '알맞지 않은 글꼴·크기·색은 뺀다');
  assert.deepStrictEqual(plain(e.rows[1].fmt.c4), { m: [d.rows[2].id, 'c4'] });
  assert.ok(e.rows[2].fmt.c3 && e.rows[2].fmt.c3.m, '합치기');
  assert.strictEqual(e.rows[0].by, '', '서식만 바꾸면 마지막 고친 분은 그대로');
  const logs = g.readRows_('기록').slice(logN);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0]['요약'], /서식 4칸/);
  // 만든 분은 잠근 열도
  assert.strictEqual(call(g, 'table.cells', { id, cells: [at(0, 'c2', { f: { b: 1 } }), at(3, 'c2', { f: { m: [d.rows[3].id, 'c3'] } })] }, owner).data.formatted, 2);
  // 서식 바꾸기(null이면 그 서식을 뺀다)·서식 지우기(합친 칸은 그대로)·채우기 색 지우기
  assert.ok(call(g, 'table.cells', { id, cells: [at(0, 'c4', { f: { b: null, fs: null } }), at(1, 'c4', { clear: 1 }), at(1, 'c3', { clear: 1 })] }, a).ok);
  e = tbGet(g, id, a);
  assert.deepStrictEqual(plain(e.rows[0].fmt.c4), { ff: 'batang', fc: '#CC0000', ha: 'c', bd: '0020' });
  assert.deepStrictEqual(plain(e.rows[1].fmt.c4), { m: [d.rows[2].id, 'c4'] }, '합친 칸은 남는다');
  assert.ok(!e.rows[1].fmt.c3);
  assert.ok(call(g, 'table.cells', { id, cells: [at(0, 'c4', { fill: '' }), at(1, 'c4', { f: { m: null } })] }, a).ok);
  e = tbGet(g, id, a);
  assert.ok(!e.rows[0].colors.c4);
  assert.ok(!e.rows[1].fmt.c4, '합치기 풀기');
  // 서식 지우기와 채우기 색을 함께 보내면(되돌리기·다시 하기·붙여 넣기) 그 채우기 색으로
  assert.ok(call(g, 'table.cells', { id, cells: [at(0, 'c4', { clear: 1, f: { b: 1 }, fill: '#FFF2CC' })] }, a).ok);
  e = tbGet(g, id, a);
  assert.strictEqual(e.rows[0].colors.c4, '#FFF2CC');
  assert.deepStrictEqual(plain(e.rows[0].fmt.c4), { b: 1 });
  assert.ok(call(g, 'table.cells', { id, cells: [at(0, 'c4', { clear: 1 })] }, a).ok);
  e = tbGet(g, id, a);
  assert.ok(!e.rows[0].colors.c4 && !e.rows[0].fmt.c4, '서식 지우기만 보내면 채우기 색도 지운다');
  // 값과 서식을 한 번에(붙여 넣기)
  const r2 = call(g, 'table.cells', { id, cells: [at(1, 'c4', { value: '빨간 글', base: tbBase(d, 1, 'c4'), f: { fc: '#FF0000' } })] }, a);
  assert.strictEqual(r2.data.changed, 1);
  assert.strictEqual(r2.data.formatted, 1);
  e = tbGet(g, id, a);
  assert.strictEqual(e.rows[1].cells.c4, '빨간 글');
  assert.strictEqual(e.rows[1].fmt.c4.fc, '#FF0000');
  assert.strictEqual(e.rows[1].by, '심청');
  // 마감한 표는 만든 분만
  assert.ok(call(g, 'table.setOpen', { id, open: false }, owner).ok);
  assert.strictEqual(call(g, 'table.cells', { id, cells: [at(0, 'c4', { f: { b: 1 } })] }, a).code, 'CLOSED');
});

test('함께 쓰는 표 2: 열 너비·줄 높이·보기(왼쪽 열 고정·줄 간격)는 고칠 수 있는 누구나, 모든 분 화면에 함께', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMakeDoc(g, owner);
  const d = tbGet(g, id, a);
  assert.deepStrictEqual(plain(d.table.view), { fr: 0, gap: 'n' });
  const w = call(g, 'table.colw', { id, w: { c4: 344, c2: 10, c9: 100 } }, a);
  assert.ok(w.ok, w.error);
  let e = tbGet(g, id, owner);
  assert.strictEqual(e.table.cols[3].w, 344);
  assert.strictEqual(e.table.cols[1].w, 0, '너무 좁은 너비는 기본으로');
  assert.ok(e.table.ver > d.table.ver, '판이 올라 다른 분 화면도 새로 받는다');
  const h = call(g, 'table.rowh', { id, rows: [{ row: d.rows[1].id, n: d.rows[1].n, h: 86 }, { row: d.rows[2].id, h: 5000 }] }, a);
  assert.ok(h.ok, h.error);
  assert.strictEqual(h.data.rows.length, 1, '바뀐 줄만(너무 큰 높이는 글에 맞춤 = 처음과 같음)');
  e = tbGet(g, id, owner);
  assert.strictEqual(e.rows[1].h, 86);
  assert.strictEqual(e.rows[2].h, 0);
  const v = call(g, 'table.view', { id, view: { fr: 2, gap: 'w' } }, a);
  assert.ok(v.ok, v.error);
  assert.deepStrictEqual(plain(tbGet(g, id, owner).table.view), { fr: 2, gap: 'w' });
  assert.deepStrictEqual(plain(call(g, 'table.view', { id, view: { fr: 9, gap: 'x' } }, a).data.view), { fr: 0, gap: 'n' }, '알맞지 않으면 기본');
  assert.strictEqual(call(g, 'table.colw', { id, w: { c4: 200 } }, { login: a.login }).code, 'IDENTITY');
  assert.ok(call(g, 'table.setOpen', { id, open: false }, owner).ok);
  assert.strictEqual(call(g, 'table.colw', { id, w: { c4: 200 } }, a).code, 'CLOSED');
  assert.strictEqual(call(g, 'table.view', { id, view: { fr: 1 } }, a).code, 'CLOSED');
  assert.ok(call(g, 'table.colw', { id, w: { c4: 200 } }, owner).ok, '만든 분은 마감한 표도');
  const logs = g.readRows_('기록').filter((x) => /열 너비|줄 높이|보기 바꿈/.test(x['요약']));
  assert.ok(logs.length >= 4, '기록에 남는다');
});

test('함께 쓰는 표 2: 합친 칸은 만들 때(붙여 넣기)·줄을 더하고 뺄 때 깨지지 않는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const cols = [{ id: 'c1', name: '층', w: 70 }, { id: 'c2', name: '각 실' }, { id: 'c3', name: '메모' }];
  const rows = [
    { cells: { c1: '1층', c2: '교장실' }, ms: { c1: [3, 1] }, fmt: { c1: { b: 1 } } },
    { cells: { c2: '보건실' } },
    { cells: { c2: '도서관' } },
    { cells: { c1: '알림', c2: '' }, ms: { c1: [1, 3] } } // 가로로 세 칸
  ];
  const id = call(g, 'table.create', { fields: { title: '합친 칸', sheet: '1층' }, cols, rows }, owner).data.id;
  let d = tbGet(g, id, a);
  const R = d.rows.map((r) => r.id);
  assert.deepStrictEqual(plain(d.rows[0].fmt.c1), { b: 1, m: [R[2], 'c1'] }, '붙여 넣은 합친 칸이 진짜 줄ID로');
  assert.deepStrictEqual(plain(d.rows[3].fmt.c1), { m: [R[3], 'c3'] });
  // 합친 칸 맨 아래 줄 아래에 더하면 그 합친 칸에 들어간다
  const add = call(g, 'table.row.add', { id, after: R[2], cells: { c2: '급식실' }, fmt: { c2: { i: 1, m: [R[2], 'c2'] } } }, a);
  assert.ok(add.ok, add.error);
  assert.deepStrictEqual(plain(add.data.row.fmt), { c2: { i: 1 } }, '위 줄 서식은 이어 받되 합친 칸은 빼고');
  assert.deepStrictEqual(add.data.rows.map((r) => r.id), [R[0]], '합친 칸의 첫 줄도 함께 돌려준다');
  d = tbGet(g, id, a);
  assert.deepStrictEqual(d.rows.map((r) => r.cells.c2 || ''), ['교장실', '보건실', '도서관', '급식실', '']);
  assert.deepStrictEqual(plain(d.rows[0].fmt.c1.m), [add.data.row.id, 'c1'], '맨 아래가 새 줄로');
  // 가운데에 더하면 그대로 안에
  assert.ok(call(g, 'table.row.add', { id, after: R[0], cells: { c2: '교감실' } }, a).ok);
  assert.deepStrictEqual(plain(tbGet(g, id, a).rows[0].fmt.c1.m), [add.data.row.id, 'c1']);
  // 맨 아래 줄을 빼면 끝이 위 줄로
  assert.ok(call(g, 'table.row.delete', { id, row: add.data.row.id }, a).ok, '내가 더한 줄');
  d = tbGet(g, id, a);
  assert.deepStrictEqual(plain(d.rows[0].fmt.c1.m), [R[2], 'c1']);
  // 첫 줄을 빼면 합친 칸(값·서식)이 다음 줄로
  const del = call(g, 'table.row.delete', { id, row: R[0] }, owner);
  assert.ok(del.ok, del.error);
  d = tbGet(g, id, a);
  assert.strictEqual(d.rows[0].cells.c2, '교감실');
  assert.strictEqual(d.rows[0].cells.c1, '1층', '값이 다음 줄로');
  assert.deepStrictEqual(plain(d.rows[0].fmt.c1), { b: 1, m: [R[2], 'c1'] });
  // 붙여 넣은 줄이 표 끝에 넘쳐도 합친 칸이 새 줄을 가리킨다('+0')
  const last = d.rows[d.rows.length - 1];
  const r = call(g, 'table.cells', { id, cells: [{ row: last.id, n: last.n, col: 'c3', value: '이어서', base: 0, f: { m: ['+1', 'c3'] } }],
    add: [{ cells: { c2: '새 줄 1' } }, { cells: { c2: '새 줄 2' }, ms: { c2: [1, 2] } }] }, owner);
  assert.ok(r.ok, r.error);
  d = tbGet(g, id, a);
  const n2 = d.rows[d.rows.length - 1];
  assert.deepStrictEqual(plain(d.rows.find((x) => x.id === last.id).fmt.c3.m), [n2.id, 'c3']);
  assert.deepStrictEqual(plain(n2.fmt.c2.m), [n2.id, 'c3']);
});

test('함께 쓰는 표 2: 찾기는 시트마다 찾은 칸 수를 알려 주고, 합친 칸에 덮여 안 보이는 칸은 세지 않는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMakeDoc(g, owner);
  const s2 = call(g, 'table.sheet.add', { id, name: '두 번째', cols: [{ id: 'c1', name: '가' }, { id: 'c2', name: '나' }],
    rows: [{ cells: { c1: 'TV 거치대', c2: 'tv 숨은 값' }, ms: { c1: [1, 2] } }, { cells: { c1: '책상' } }] }, owner).data.id;
  const f = call(g, 'table.find', { id, q: ' TV ' }, a);
  assert.ok(f.ok, f.error);
  assert.strictEqual(f.data.counts[id], 0);
  assert.strictEqual(f.data.counts[s2], 1, '대소문자는 가리지 않고, 덮인 칸은 세지 않는다');
  assert.strictEqual(call(g, 'table.find', { id, q: '1층' }, a).data.counts[id], 1, '같은 값 위아래 합침 열은 한 번만');
  assert.deepStrictEqual(plain(call(g, 'table.find', { id, q: '' }, a).data.counts), {});
});

// ---------------------------------------------------------------- 취합 시트: 시트 양식(판 2026-10-18b)

const TPL_COLS = [
  { id: 'c1', name: '층', lock: true, w: 80 }, { id: 'c2', name: '실', lock: true },
  { id: 'c3', name: '점검', type: 'pick', options: ['완료', '미완료'], w: 120 }, { id: 'c4', name: '내용', w: 300 }
];
/** 서식·합친 칸·줄 높이·보기가 있는 시트(만든 분 by). 돌려주는 값: { doc, sheet } */
function tplSheet(g, by) {
  const doc = tbMakeDoc(g, by);
  const rows = [
    { cells: { c1: '1층', c2: '교장실', c3: '완료', c4: '의자' }, colors: { c1: '#F4CCCC' }, fmt: { c1: { b: 1, ha: 'c' }, c4: { fc: '#CC0000', bd: '0020' } }, ms: { c1: [2, 1] }, h: 60 },
    { cells: { c1: '1층', c2: '보건실', c3: '미완료' }, colors: { c1: '#F4CCCC' } },
    { cells: { c2: '교무실', c3: '숨은 값' }, ms: { c2: [1, 2] } }
  ];
  const r = call(g, 'table.sheet.add', { id: doc, name: '실별', cols: TPL_COLS, rows, view: { fr: 2, gap: 'w' } }, by);
  assert.ok(r.ok, r.error);
  return { doc, sheet: r.data.id };
}

test('시트 양식: 기본 양식 10개가 늘 있고, 학년·반별 제출 확인은 교직원 소속으로 학년·반·담임을 채운다(사용 안 함은 빼고, 소속이 없으면 빈 줄)', () => {
  const g = freshName();
  const { who, boss, L } = ids(g);
  let ls = call(g, 'table.tpl.list', {}, { login: L });
  assert.ok(ls.ok, ls.error);
  assert.deepStrictEqual(ls.data.builtin.map((x) => x.name), ['학년·반별 제출 확인', '실별 점검', '교시×요일 시간표', '날짜·시간 신청', '업무 협의 안건',
    '방학 근무 신청', '연수 이수 확인', '대피 훈련 인원 확인', '학급별 안전교육 시수', '위험 요소 신고·조치']);
  assert.deepStrictEqual(plain(ls.data.saved), []);
  assert.strictEqual(ls.data.canSave, false, '이름을 고르기 전에는 쓰기만');
  assert.ok(!g._ss.getSheetByName('시트양식') || g.readRows_('시트양식').length === 0, '목록만 보면 양식이 생기지 않는다');
  assert.deepStrictEqual(plain(ls.data.builtin[0].cols), ['학년', '반', '담임', '제출', '비고']);
  assert.deepStrictEqual(plain(ls.data.builtin[4].cols), ['번호', '안건', '담당 부서', '담당자', '협의 결과', '완료']);
  const a = who('심청');
  assert.strictEqual(call(g, 'table.tpl.list', {}, a).data.canSave, true);
  // 가짜 교직원: 1-1 홍련, 2-1 장화, 3-1 홍길동, 3-2 성춘향, 4-1 이몽룡, 5-1 심청, 6-2 흥부(6-1은 소속이 없어 담임 비움), 놀부는 과학 전담
  let b1 = call(g, 'table.tpl.get', { id: 'B1' }, { login: L }).data;
  const line = (r) => [r.cells.c1, r.cells.c2, r.cells.c3 || ''].join(' ');
  assert.deepStrictEqual(b1.rows.map(line), ['1학년 1반 홍련', '2학년 1반 장화', '3학년 1반 홍길동', '3학년 2반 성춘향', '4학년 1반 이몽룡', '5학년 1반 심청', '6학년 1반 ', '6학년 2반 흥부']);
  assert.deepStrictEqual(plain(b1.rows[2].ms), { c1: [2, 1] }, '학년 칸은 학년마다 위아래로 합침');
  assert.deepStrictEqual(plain(b1.rows[2].fmt.c1), { b: 1, ha: 'c' });
  assert.strictEqual(b1.rows[0].ms, undefined, '반이 하나면 합치지 않음');
  assert.strictEqual(b1.cols[3].type, 'pick');
  assert.deepStrictEqual(plain(b1.cols[3].options), ['제출', '미제출']);
  assert.deepStrictEqual(b1.cols.filter((c) => c.lock).map((c) => c.name), ['학년', '반', '담임']);
  assert.strictEqual(call(g, 'table.tpl.list', {}, a).data.builtin[0].rows, 8);
  const b3 = call(g, 'table.tpl.get', { id: 'B3' }, a).data;
  assert.deepStrictEqual(b3.rows.map((r) => r.cells.c1), ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시']);
  assert.deepStrictEqual(b3.cols.map((c) => c.name), ['교시', '월', '화', '수', '목', '금']);
  const b2 = call(g, 'table.tpl.get', { id: 'B2' }, a).data;
  assert.strictEqual(b2.rows.length, 10);
  assert.ok(b2.rows.every((r) => !r.cells), '실별 점검은 빈 줄 10개(틀만)');
  assert.strictEqual(call(g, 'table.tpl.list', {}, a).data.builtin[1].blank, true);
  // 사용 안 함인 분은 빼고, 소속에 학년·반이 하나도 없으면 빈 줄
  const actor = { id: '', name: '시험' };
  const staffId = (n) => g.readRows_('교직원').find((x) => x['이름'] === n)['교직원ID'];
  g.updateRow_('교직원', staffId('흥부'), { '사용 여부': '사용 안 함' }, actor, '시험');
  b1 = call(g, 'table.tpl.get', { id: 'B1' }, a).data;
  assert.ok(!b1.rows.some((r) => r.cells.c1 === '6학년'), '6학년은 사용 중인 분 소속이 없어 빠진다');
  g.readRows_('교직원').forEach((x) => g.updateRow_('교직원', x['교직원ID'], { '소속': '교과 전담' }, actor, '시험'));
  b1 = call(g, 'table.tpl.get', { id: 'B1' }, a).data;
  assert.strictEqual(b1.rows.length, 10);
  assert.ok(b1.rows.every((r) => !r.cells), '짐작해 채우지 않는다');
  assert.strictEqual(call(g, 'table.tpl.list', {}, a).data.builtin[0].blank, true);
  // 기본 양식은 고치거나 지울 수 없다
  assert.match(call(g, 'table.tpl.update', { id: 'B1', name: '바꿈' }, boss()).error, /기본 양식은 고칠 수 없어요/);
  assert.match(call(g, 'table.tpl.delete', { id: 'B2' }, boss()).error, /기본 양식은 지울 수 없어요/);
  assert.strictEqual(call(g, 'table.tpl.get', { id: 'Y12345678' }, a).code, 'NOTFOUND');
});

test('시트 양식: 이름을 고른 누구나 시트를 양식으로 저장하고(줄 내용까지·잠근 열 글만·열 모양만), 모든 분이 쓴다', () => {
  const g = freshName();
  const { who, boss, L } = ids(g);
  const owner = who('흥부'), a = who('심청'), b = who('장화');
  const { doc, sheet } = tplSheet(g, owner);
  // 열을 하나 빼고 더해서 열 ID가 c1·c3·c4·c5가 된 시트도 양식에서는 c1부터 다시 매긴다
  const d0 = tbGet(g, sheet, owner);
  assert.ok(call(g, 'table.cols', { id: sheet, cols: plain(d0.table.cols).filter((c) => c.id !== 'c4').concat([{ name: '사진', w: 90 }]) }, owner).ok);
  assert.deepStrictEqual(tbGet(g, sheet, owner).table.cols.map((c) => c.id), ['c1', 'c2', 'c3', 'c5']);
  assert.strictEqual(call(g, 'table.tpl.save', { sheet, name: '실별 양식' }, { login: L }).code, 'IDENTITY');
  const s1 = call(g, 'table.tpl.save', { sheet, name: '  실별   양식 ', desc: '층·실(예시)' }, a);
  assert.ok(s1.ok, s1.error);
  assert.strictEqual(s1.data.name, '실별 양식', '띄어쓰기는 하나로');
  assert.ok(/^Y[0-9A-F]{8}$/.test(s1.data.id), s1.data.id);
  assert.ok(g._ss.getSheetByName('시트양식'), '처음 저장할 때 탭이 생긴다');
  assert.deepStrictEqual(plain(g.headOf_('시트양식')), plain(g.tabs_()['시트양식']));
  const t1 = call(g, 'table.tpl.get', { id: s1.data.id }, b).data;
  assert.deepStrictEqual(t1.cols.map((c) => [c.id, c.name]), [['c1', '층'], ['c2', '실'], ['c3', '점검'], ['c4', '사진']]);
  assert.deepStrictEqual(t1.cols.map((c) => !!c.lock), [true, true, false, false]);
  assert.strictEqual(t1.cols[0].w, 80);
  assert.deepStrictEqual(plain(t1.cols[2].options), ['완료', '미완료']);
  assert.deepStrictEqual(plain(t1.view), { fr: 2, gap: 'w' }, '보기도 담는다');
  assert.strictEqual(t1.rows.length, 3);
  assert.deepStrictEqual(plain(t1.rows[0].cells), { c1: '1층', c2: '교장실', c3: '완료' }, '뺀 열의 값은 담지 않는다');
  assert.deepStrictEqual(plain(t1.rows[0].colors), { c1: '#F4CCCC' });
  assert.deepStrictEqual(plain(t1.rows[0].fmt), { c1: { b: 1, ha: 'c' } });
  assert.deepStrictEqual(plain(t1.rows[0].ms), { c1: [2, 1] }, '합친 칸은 아래로 줄 수·오른쪽으로 열 수로');
  assert.strictEqual(t1.rows[0].h, 60);
  assert.deepStrictEqual(plain(t1.rows[2].ms), { c2: [1, 2] });
  assert.deepStrictEqual(plain(t1.rows[2].cells), { c2: '교무실', c3: '숨은 값' }, '합친 칸에 덮인 값도 그대로(합치기를 풀면 보이게)');
  let ls = call(g, 'table.tpl.list', {}, b).data;
  assert.deepStrictEqual(plain(ls.saved.map((x) => [x.name, x.by, x.rows, x.canEdit])), [['실별 양식', '심청', 3, false]]);
  assert.deepStrictEqual(plain(ls.saved[0].cols), ['층', '실', '점검', '사진']);
  assert.strictEqual(call(g, 'table.tpl.list', {}, a).data.saved[0].canEdit, true, '저장한 분');
  assert.strictEqual(call(g, 'table.tpl.list', {}, boss()).data.saved[0].canEdit, true, '관리(관리자 화면)');
  // 이름은 기본 양식·우리 학교 양식과 겹치지 않게
  assert.match(call(g, 'table.tpl.save', { sheet, name: '실별 양식' }, b).error, /이미 있어요/);
  assert.match(call(g, 'table.tpl.save', { sheet, name: '실별 점검' }, b).error, /이미 있어요/, '기본 양식 이름');
  assert.match(call(g, 'table.tpl.save', { sheet, name: ' ' }, b).error, /양식 이름을 적어 주세요/);
  assert.match(call(g, 'table.tpl.save', { sheet, name: '가'.repeat(41) }, b).error, /40자까지/);
  // 잠근 열 글만: 잠그지 않은 열의 글은 비우고 서식·색·합친 칸은 그대로
  const s2 = call(g, 'table.tpl.save', { sheet, name: '실별 틀', what: 'lock' }, b);
  assert.ok(s2.ok, s2.error);
  const t2 = call(g, 'table.tpl.get', { id: s2.data.id }, a).data;
  assert.deepStrictEqual(t2.rows.map((r) => plain(r.cells || {})), [{ c1: '1층', c2: '교장실' }, { c1: '1층', c2: '보건실' }, { c2: '교무실' }]);
  assert.deepStrictEqual(plain(t2.rows[0].ms), { c1: [2, 1] });
  assert.deepStrictEqual(plain(t2.rows[1].colors), { c1: '#F4CCCC' });
  // 열 모양만: 줄 없이(쓸 때 빈 줄 10개)
  const s3 = call(g, 'table.tpl.save', { sheet, name: '실별 열만', what: 'cols' }, b);
  assert.ok(s3.ok, s3.error);
  const t3 = call(g, 'table.tpl.get', { id: s3.data.id }, a).data;
  assert.strictEqual(t3.rows.length, 10);
  assert.ok(t3.rows.every((r) => !r.cells && !r.fmt));
  ls = call(g, 'table.tpl.list', {}, a).data;
  assert.deepStrictEqual(ls.saved.map((x) => x.name), ['실별 양식', '실별 열만', '실별 틀'], '이름순');
  assert.deepStrictEqual(ls.saved.map((x) => x.blank), [false, true, false]);
  // 양식으로 만든 표(화면이 받은 양식을 그대로 보낸다): 열·서식·합친 칸·줄 높이·보기가 그대로
  const made = call(g, 'table.create', { fields: { title: '3학년 점검' }, cols: t1.cols, rows: t1.rows, view: t1.view, tpl: t1.name }, b);
  assert.ok(made.ok, made.error);
  const d = tbGet(g, made.data.id, b);
  assert.deepStrictEqual(d.table.cols.map((c) => c.name), ['층', '실', '점검', '사진']);
  assert.deepStrictEqual(plain(d.table.view), { fr: 2, gap: 'w' });
  assert.strictEqual(d.rows[0].h, 60);
  assert.deepStrictEqual(plain(d.rows[0].fmt.c1.m), [d.rows[1].id, 'c1']);
  assert.deepStrictEqual(plain(d.rows[2].fmt.c2.m), [d.rows[2].id, 'c3']);
  assert.strictEqual(d.table.canEdit, true, '양식으로 만든 표는 만든 분(장화)의 표');
  const log = g.readRows_('기록').filter((x) => x['탭'] === '함께표' && /양식: 실별 양식/.test(x['요약']));
  assert.strictEqual(log.length, 1, '만든 기록에 양식 이름');
  const tl = g.readRows_('기록').filter((x) => x['탭'] === '시트양식');
  assert.deepStrictEqual(plain(tl.map((x) => x['동작'])), ['추가', '추가', '추가']);
  assert.match(tl[0]['요약'], /시트 양식 저장: 실별 양식 \(취합 시트 "2학기 업무 협의 › 실별", 줄 3개\)/);
  assert.match(tl[1]['요약'], /잠근 열 글만/);
  // 지운 시트는 저장할 수 없다
  assert.ok(call(g, 'table.sheet.delete', { id: sheet }, owner).ok);
  assert.strictEqual(call(g, 'table.tpl.save', { sheet, name: '지운 시트' }, a).code, 'NOTFOUND');
  assert.ok(doc);
});

test('시트 양식: 줄 내용이 너무 많으면 열 모양만으로 저장하라고 알리고, 양식 수는 200개까지', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const doc = tbMakeDoc(g, owner);
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ cells: { c1: '긴 글 ' + i, c2: '가'.repeat(1900) } });
  const big = call(g, 'table.sheet.add', { id: doc, name: '긴 시트', cols: [{ id: 'c1', name: '가' }, { id: 'c2', name: '나' }], rows }, owner).data.id;
  assert.match(call(g, 'table.tpl.save', { sheet: big, name: '긴 양식' }, a).error, /열 모양만/);
  assert.ok(call(g, 'table.tpl.save', { sheet: big, name: '긴 양식', what: 'cols' }, a).ok, '열 모양만은 된다');
  g.TB_TPL_MAX_ = 2;
  assert.ok(call(g, 'table.tpl.save', { sheet: big, name: '둘째', what: 'cols' }, a).ok);
  assert.match(call(g, 'table.tpl.save', { sheet: big, name: '셋째', what: 'cols' }, a).error, /2개까지/);
});

test('시트 양식: 이름·설명 고치기·지우기는 저장한 분과 관리만, 지운 양식은 휴지통에서 되살리고 같은 이름이 있으면 (되살림)을 붙인다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const owner = who('흥부'), a = who('심청'), b = who('장화');
  const { sheet } = tplSheet(g, owner);
  const id = call(g, 'table.tpl.save', { sheet, name: '점검 양식', desc: '처음 설명' }, a).data.id;
  assert.strictEqual(call(g, 'table.tpl.update', { id, name: '남의 양식' }, b).code, 'FORBIDDEN');
  assert.ok(call(g, 'table.tpl.update', { id, name: '실별 점검표', desc: '고친 설명' }, a).ok);
  assert.match(call(g, 'table.tpl.update', { id, name: '날짜·시간 신청' }, a).error, /이미 있어요/, '기본 양식 이름');
  assert.ok(call(g, 'table.tpl.update', { id, name: '실별 점검표 2', desc: '' }, boss()).ok, '관리(관리자 화면)');
  let ls = call(g, 'table.tpl.list', {}, a).data;
  assert.deepStrictEqual(plain(ls.saved.map((x) => [x.name, x.desc])), [['실별 점검표 2', '']]);
  assert.strictEqual(call(g, 'table.tpl.delete', { id }, b).code, 'FORBIDDEN');
  assert.ok(call(g, 'table.tpl.delete', { id }, a).ok);
  assert.ok(call(g, 'table.tpl.delete', { id }, a).ok, '두 번 눌러도 괜찮다');
  assert.deepStrictEqual(plain(call(g, 'table.tpl.list', {}, a).data.saved), []);
  assert.strictEqual(call(g, 'table.tpl.get', { id }, a).code, 'NOTFOUND');
  const trash = call(g, 'admin.trash.tables', {}, boss()).data;
  const item = trash.find((x) => x.kind === 'tpl');
  assert.deepStrictEqual(plain([item.id, item.title, item.by, item.deletedBy]), [id, '실별 점검표 2', '심청', '심청']);
  assert.ok(call(g, 'table.tpl.save', { sheet, name: '실별 점검표 2' }, b).ok, '지운 양식의 이름은 다시 쓸 수 있다');
  assert.ok(call(g, 'admin.trash.restoreTable', { id, kind: 'tpl' }, boss()).ok);
  ls = call(g, 'table.tpl.list', {}, a).data;
  assert.deepStrictEqual(ls.saved.map((x) => x.name), ['실별 점검표 2', '실별 점검표 2 (되살림)']);
  assert.ok(!call(g, 'admin.trash.tables', {}, boss()).data.some((x) => x.kind === 'tpl'));
  assert.match(call(g, 'admin.trash.restoreTable', { id, kind: 'tpl' }, boss()).error, /되살릴 양식을 찾지 못했어요/);
  const tl = g.readRows_('기록').filter((x) => x['탭'] === '시트양식');
  assert.deepStrictEqual(plain(tl.map((x) => x['동작'])), ['추가', '수정', '수정', '삭제', '추가', '되살리기']);
  assert.strictEqual(tl[1]['이름'], '심청');
});

test('시트 양식: 목록·꺼내기는 서버 기억에서 한 번에 꺼내고(두 번째부터 시트를 읽지 않음), 저장하면 새로 읽는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const { sheet } = tplSheet(g, owner);
  const id = call(g, 'table.tpl.save', { sheet, name: '점검' }, a).data.id;
  [['table.tpl.list', {}], ['table.tpl.get', { id }], ['table.tpl.get', { id: 'B1' }]].forEach(([act, args]) => {
    assert.ok(call(g, act, args, a).ok, act);
    const r = call(g, act, args, a);
    assert.ok(r.ok, act);
    assert.strictEqual(g.PERF_.reads, 0, act + ': 시트를 읽지 않음');
    assert.strictEqual(g.PERF_.memoCalls, 1, act + ': 서버 기억은 한 번만');
  });
  assert.ok(call(g, 'table.tpl.update', { id, name: '점검 2' }, a).ok);
  assert.deepStrictEqual(call(g, 'table.tpl.list', {}, a).data.saved.map((x) => x.name), ['점검 2'], '저장한 뒤에는 새 이름');
});

// ---------------------------------------------------------------- 전체 보완(판 2026-10-19a): 서버 파일 공통

test('서버 파일: 웹앱에서는 모든 .gs 파일이 이름을 함께 쓰므로, 함수·변수 이름이 두 파일(또는 한 파일 안)에서 겹치지 않는다', () => {
  const seen = {}, dup = [];
  GAS_FILES.forEach((f) => {
    const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
    (src.match(/^(?:function|var) ([A-Za-z0-9_$]+)/gm) || []).forEach((m) => {
      const name = m.replace(/^(?:function|var) /, '');
      if (seen[name]) dup.push(name + ' (' + seen[name] + ', ' + f + ')'); else seen[name] = f;
    });
  });
  assert.deepStrictEqual(dup, []);
});

// ---------------------------------------------------------------- 전체 보완(판 2026-10-19a): 일정·홈·학생 수·학기

test('일정 보완: 끌어 옮기기는 날짜만 바꾸고, 그사이 다른 분이 고쳤으면 옮기지 않는다 · 고치기도 덮어쓰지 않고 묻는다(그래도 저장은 내 내용으로)', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const a = who('성춘향'), b = boss('홍길동');
  const tick = () => { g.__clock.offset += 2000; }; // 저장 시각은 초 단위라 2초씩 띄운다
  const add = call(g, 'sched.save', { fields: ev({ start: '2026-10-20', title: '공개수업', time: '5교시', place: '3-2 교실' }) }, a).data;
  const base0 = add.editedAt || add.at;
  tick();
  const fixed = call(g, 'sched.save', { id: add.id, fields: ev({ start: '2026-10-20', title: '공개수업', time: '6교시', place: '시청각실' }), base: base0 }, b);
  assert.ok(fixed.ok, fixed.error);
  tick();
  const mv1 = call(g, 'sched.move', { id: add.id, start: '2026-10-22', end: '', base: base0 }, a); // 옛 달력에서 끌어 옮기기
  assert.strictEqual(mv1.code, 'CONFLICT');
  assert.match(mv1.error, /홍길동 선생님이 이 일정을 고쳤어요/);
  const mv2 = call(g, 'sched.move', { id: add.id, start: '2026-10-22', end: '', base: fixed.data.editedAt }, a);
  assert.ok(mv2.ok, mv2.error);
  assert.deepStrictEqual([mv2.data.start, mv2.data.time, mv2.data.place], ['2026-10-22', '6교시', '시청각실'], '날짜만 바뀌고 부장이 고친 시간·장소는 그대로');
  tick();
  const old = mv2.data.editedAt;
  assert.ok(call(g, 'sched.save', { id: add.id, fields: ev({ start: '2026-10-22', title: '공개수업', time: '7교시' }), base: old }, b).ok);
  tick();
  const c = call(g, 'sched.save', { id: add.id, fields: ev({ start: '2026-10-22', title: '공개수업(변경)' }), base: old }, a);
  assert.strictEqual(c.code, 'CONFLICT');
  assert.match(c.error, /그래도 저장/);
  const f = call(g, 'sched.save', { id: add.id, fields: ev({ start: '2026-10-22', title: '공개수업(변경)' }), base: old, force: true }, a);
  assert.ok(f.ok, f.error);
  assert.strictEqual(f.data.title, '공개수업(변경)');
  assert.ok(call(g, 'sched.save', { id: add.id, fields: ev({ start: '2026-10-23', title: '공개수업(변경)' }) }, a).ok, 'base 없이 보내는 예전 화면은 그대로');
  assert.ok(g.readRows_('기록').some((r) => /일정 옮김/.test(r['요약'])));
  assert.strictEqual(call(g, 'sched.move', { id: add.id, start: '2026-10-25', end: '2026-10-24' }, a).ok, false, '끝나는 날이 앞이면 막는다');
  assert.strictEqual(call(g, 'sched.move', { id: add.id, start: '2026-10-25' }, who('심청')).code, 'FORBIDDEN', '다른 분 일정은 못 옮긴다');
});

test('일정 보완: 내가 넣은 휴업일·공휴일도 관리자 화면이 없으면 고치기·끌기가 보이지 않고, 옮기면 막는다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const h = call(g, 'sched.save', { fields: ev({ start: '2026-10-21', title: '재량휴업일', kind: '휴업일', target: ['전체'] }) }, boss('홍길동')).data;
  assert.strictEqual(h.canEdit, true, '관리자 화면을 연 기기');
  const me = who('홍길동');
  const m = call(g, 'sched.month', { year: 2026, month: 10 }, me).data;
  assert.strictEqual(m.events.find((e) => e.id === h.id).canEdit, false, '같은 분이라도 관리자 화면 없이는');
  assert.strictEqual(call(g, 'sched.move', { id: h.id, start: '2026-10-22' }, me).code, 'FORBIDDEN');
});

test('일정 보완: 관리자 화면이 닫힌(2시간 지난) 기기에서 관리 일을 하면 ADMIN으로 알린다(관리자에게 "관리자만"이라고 하지 않게)', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const b = boss('홍길동');
  assert.ok(call(g, 'focus.save', { year: 2026, month: 10, text: '안전' }, b).ok);
  g.__clock.offset += 2 * 3600 * 1000 + 5000;
  const r = call(g, 'sched.upload.check', { grid: [['시작일', '행사명'], ['2026-10-21', '행사']] }, b);
  assert.strictEqual(r.code, 'ADMIN');
  assert.match(r.error, /관리자 화면이 닫혔어요/);
  assert.strictEqual(call(g, 'focus.save', { year: 2026, month: 10, text: 'x' }, b).code, 'ADMIN');
  assert.strictEqual(call(g, 'focus.save', { year: 2026, month: 10, text: 'x' }, who('심청')).code, 'FORBIDDEN', '관리자 화면을 연 적이 없으면 그대로');
});

test('일정 보완: 시간 "아침"은 08:40·1교시 앞에 온다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  ['15:00', '아침', '1교시', '08:40', '방과후', '종일'].forEach((t, i) => call(g, 'sched.save', { fields: ev({ start: '2026-10-21', title: '행사' + i, time: t }) }, me));
  const m = call(g, 'sched.month', { year: 2026, month: 10 }, me).data.events.filter((e) => e.start === '2026-10-21');
  assert.deepStrictEqual(m.map((e) => e.time), ['종일', '아침', '08:40', '1교시', '15:00', '방과후']);
});

test('홈 보완: 금요일의 미리 보기는 월요일, 토·일에는 다음 주 일정을 보여 준다', () => {
  const g = freshName();
  for (let k = 0; k < 7 && g.weekday_(g.todayYmd_()) !== 5; k++) g.__clock.offset += 86400000; // 오늘을 금요일로
  const fri = g.todayYmd_(), mon = g.addDays_(fri, 3);
  let h = call(g, 'home', {}, ids(g).who('심청')).data;
  assert.deepStrictEqual([h.tomorrow, h.nextLabel, h.weekNext, h.monday], [mon, '월요일', false, g.mondayOf_(fri)]);
  g.__clock.offset += 86400000; // 토요일
  h = call(g, 'home', {}, ids(g).who('심청')).data;
  assert.deepStrictEqual([h.tomorrow, h.nextLabel, h.weekNext, h.monday], [mon, '월요일', true, mon], '토요일은 다음 주');
  g.__clock.offset += 86400000; // 일요일
  h = call(g, 'home', {}, ids(g).who('심청')).data;
  assert.deepStrictEqual([h.tomorrow, h.nextLabel, h.weekNext, h.monday], [mon, '내일', true, mon]);
  assert.ok(h.events.some((e) => e.start >= mon) || h.events.length === 0);
  g.__clock.offset += 86400000; // 월요일
  h = call(g, 'home', {}, ids(g).who('심청')).data;
  assert.deepStrictEqual([h.nextLabel, h.weekNext, h.monday], ['내일', false, mon]);
});

test('학사일정 올리기 보완: 한 칸에 적은 기간을 나누고, 날짜 칸을 합친 표의 빈 날짜는 위 줄 날짜로(확인 필요), 미리보기 수업일수는 올리는 줄들의 학년도로', () => {
  const g = freshName();
  const { boss } = ids(g);
  const b = boss();
  const dn = (ymd) => '일월화수목금토'.charAt(g.weekday_(ymd));
  const grid = [['날짜', '행사명', '구분'],
    ['3.2.~3.6.', '입학 주간', '행사'],
    ['7.24.(' + dn('2026-07-24') + ')~8.16.(' + dn('2026-08-16') + ')', '여름방학', '휴업일'],
    ['5.4.~5.', '연휴', '휴업일'],
    ['10.12.(' + dn('2026-10-12') + ')', '안전점검의 날', '행사'],
    ['', '교직원 연수', '행사']];
  const r = call(g, 'sched.upload.check', { grid }, b).data;
  const row = (t) => r.rows.find((x) => x.title === t);
  assert.deepStrictEqual([row('입학 주간').start, row('입학 주간').end], ['2026-03-02', '2026-03-06']);
  assert.deepStrictEqual([row('여름방학').start, row('여름방학').end, row('여름방학').status], ['2026-07-24', '2026-08-16', 'ok']);
  assert.deepStrictEqual([row('연휴').start, row('연휴').end], ['2026-05-04', '2026-05-05'], '끝에 날만 적으면 같은 달');
  assert.strictEqual(row('교직원 연수').start, '2026-10-12');
  assert.strictEqual(row('교직원 연수').status, 'warn');
  assert.ok(row('교직원 연수').msgs.some((m) => /위 줄 날짜/.test(m)));
  assert.strictEqual(r.days.year, 2026);
  const next = call(g, 'sched.upload.check', { grid: [['시작일', '행사명', '구분'], ['2027-03-02', '입학식', '행사'], ['2027-05-05', '어린이날', '공휴일']] }, b).data;
  assert.strictEqual(next.days.year, 2027, '새 학년도 일정을 미리 올리면 그 학년도로 센다');
  assert.strictEqual(call(g, 'sched.upload.check', { grid: [['시작일', '행사명'], ['', '첫 줄인데 날짜 없음']] }, b).data.rows[0].status, 'error', '위 줄이 없으면 그대로 올릴 수 없음');
});

test('학생 수 보완: 다른 학년을 함께 고치면 둘 다 저장되고, 같은 학년을 둘이 고쳤을 때만 묻는다(저장하지 않고 지금 숫자를 알려 줌)', () => {
  const g = freshName();
  const { who } = ids(g);
  const today = g.todayYmd_();
  const cls = (n) => { const o = {}; for (let k = 1; k <= 6; k++) o[k] = [[n, n]]; return o; };
  assert.ok(call(g, 'students.save', { date: today, classes: cls(10) }, who('심청')).ok);
  const st = call(g, 'home', {}, who('심청')).data.students;
  const bases = { classes: st.classes, grades: st.grades };
  const copy = () => JSON.parse(JSON.stringify(st.classes));
  const c4 = copy(); c4['4'] = [[11, 12]];
  const c5 = copy(); c5['5'] = [[13, 14]];
  const r4 = call(g, 'students.save', { date: today, classes: c4, base: st.at, bases }, who('흥부'));
  assert.ok(r4.ok && !r4.data.conflict, r4.error);
  g.__clock.offset += 2000;
  const r5 = call(g, 'students.save', { date: today, classes: c5, base: st.at, bases }, who('성춘향'));
  assert.ok(r5.ok && !r5.data.conflict, '다른 학년이면 막지 않는다');
  let now = call(g, 'home', {}, who('심청')).data.students;
  assert.deepStrictEqual(plain([now.classes['4'], now.classes['5'], now.grades[3], now.grades[4], now.total]), [[[11, 12]], [[13, 14]], 23, 27, 4 * 20 + 23 + 27]);
  const c4b = copy(); c4b['4'] = [[9, 9]];
  const r = call(g, 'students.save', { date: today, classes: c4b, base: st.at, bases }, who('장화'));
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(plain(r.data.conflict.grades), [4]);
  assert.strictEqual(r.data.conflict.by, '성춘향');
  assert.deepStrictEqual(plain(r.data.current.classes['4']), [[11, 12]]);
  now = call(g, 'home', {}, who('심청')).data.students;
  assert.deepStrictEqual(plain(now.classes['4']), [[11, 12]], '같은 학년이면 저장하지 않는다');
  const again = call(g, 'students.save', { date: today, classes: c4b, base: r.data.current.at, bases: { classes: r.data.current.classes, grades: r.data.current.grades } }, who('장화'));
  assert.ok(again.ok && !again.data.conflict, '바뀐 숫자를 보고 다시 저장하면 내 숫자로');
  assert.deepStrictEqual(plain(again.data.classes['4']), [[9, 9]]);
  assert.strictEqual(call(g, 'students.save', { date: today, classes: c4, base: st.at }, who('장화')).code, 'CONFLICT', '예전 화면(학년마다 견주지 않음)은 그대로');
});

test('학기 기간 보완: 학년도마다 따로 두어 다음 학년도 기간을 넣어도 지금 학년도 수업일수는 그대로 · 겹치거나 학년도 밖이면 막고, 학년도는 설정에서 바꾸지 않는다', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  assert.ok(call(g, 'admin.settings.save', { values: { '1학기 시작일': '2026-03-02', '1학기 끝일': '2026-07-24', '2학기 시작일': '2026-08-17', '2학기 끝일': '2027-02-12' } }, t).ok);
  const y0 = call(g, 'sched.year', { year: 2026 }, t).data.days;
  assert.strictEqual(y0.semesters.length, 2, '학기 탭이 없으면 예전 설정 값');
  const s = call(g, 'admin.settings.save', { values: {}, semesters: [{ year: 2027, s1from: '2027-03-02', s1to: '2027-07-23', s2from: '2027-08-16', s2to: '2028-02-11' }] }, t);
  assert.ok(s.ok, s.error);
  assert.deepStrictEqual(plain(call(g, 'sched.year', { year: 2026 }, t).data.days), plain(y0), '지금 학년도 수업일수는 그대로');
  assert.deepStrictEqual(call(g, 'sched.year', { year: 2027 }, t).data.days.semesters.map((x) => x.from), ['2027-03-02', '2027-08-16']);
  assert.deepStrictEqual(s.data.find((x) => x.key === '학기 기간').value.map((v) => [v.year, v.src]), [[2026, 'old'], [2027, 'tab']]);
  assert.match(call(g, 'admin.settings.save', { values: {}, semesters: [{ year: 2027, s1from: '2027-03-02', s1to: '2027-08-31', s2from: '2027-08-16', s2to: '2028-02-11' }] }, t).error, /1학기 끝일은 2학기 시작일보다 앞이어야/);
  assert.match(call(g, 'admin.settings.save', { values: {}, semesters: [{ year: 2027, s1from: '2026-03-02', s1to: '2027-07-23' }] }, t).error, /2027-03-01부터/);
  assert.match(call(g, 'admin.settings.save', { values: {}, semesters: [{ year: 2027, s1from: '2027-03-02' }] }, t).error, /함께 넣어/);
  assert.match(call(g, 'admin.settings.save', { values: { '1학기 끝일': '2026-08-31' } }, t).error, /2학기 시작일보다 앞이어야/, '예전 설정 칸도 겹치면 막는다');
  assert.match(call(g, 'admin.settings.save', { values: { '학년도': '2027' } }, t).error, /새 학년도에서 바꿔요/);
  assert.ok(call(g, 'admin.settings.save', { values: { '학년도': '2026' } }, t).ok, '같은 값은 괜찮다');
  const m = call(g, 'sched.month', { year: 2027, month: 4 }, t).data;
  assert.ok(m.monthDays && m.monthDays.days > 0, '다음 학년도 달도 수업일수를 센다');
  assert.ok(g.readRows_('기록').some((r) => r['탭'] === '학기' && /2027학년도 학기 기간 넣음/.test(r['요약'])));
});

// ---------------------------------------------------------------- 전체 보완(판 2026-10-19a): 취합 시트

test('취합 시트 보완: 가로로만 합친 줄 아래에 더한 줄은 덮이지 않고, 세로로 합친 칸만 새 줄까지 늘어난다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const cols = [{ id: 'c1', name: '구분' }, { id: 'c2', name: '내용' }, { id: 'c3', name: '메모' }];
  const rows = [
    { cells: { c1: '1학기 행사' }, ms: { c1: [1, 3] } }, // 가로로 세 칸(제목 줄)
    { cells: { c1: '3월', c2: '입학식' }, ms: { c1: [2, 1] } }, // 세로로 두 줄
    { cells: { c2: '학부모 총회' } }
  ];
  const id = call(g, 'table.create', { fields: { title: '행사', sheet: '1학기' }, cols, rows }, owner).data.id;
  let d = tbGet(g, id, a);
  const R = d.rows.map((r) => r.id);
  const add1 = call(g, 'table.row.add', { id, after: R[0] }, a);
  assert.ok(add1.ok, add1.error);
  d = tbGet(g, id, a);
  assert.deepStrictEqual(plain(d.rows[0].fmt.c1.m), [R[0], 'c3'], '가로로 합친 칸은 그대로(새 줄을 덮지 않음)');
  assert.strictEqual(d.rows[1].id, add1.data.row.id, '새 줄은 제목 줄 바로 아래');
  assert.deepStrictEqual(plain(add1.data.rows), [], '바뀐 다른 줄 없음');
  const add2 = call(g, 'table.row.add', { id, after: R[2] }, a);
  assert.ok(add2.ok, add2.error);
  d = tbGet(g, id, a);
  assert.deepStrictEqual(plain(d.rows.find((x) => x.id === R[1]).fmt.c1.m), [add2.data.row.id, 'c1'], '세로로 합친 칸은 새 줄까지');
});

test('취합 시트 보완: 같은 줄 아래에 잇달아 25번 더해도 늘 바로 아래에 들어가고(순서를 다시 매김), 보던 화면도 새 순서를 받는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMake(g, owner);
  const d0 = tbGet(g, id, a);
  const head = d0.rows[0].id, tail = d0.rows[1].id;
  let after = head, renumbered = 0;
  const added = [];
  for (let k = 0; k < 25; k++) {
    const r = call(g, 'table.row.add', { id, after, cells: { c4: '더한 ' + (k + 1) } }, owner);
    assert.ok(r.ok, r.error);
    if (r.data.rows.length) renumbered++;
    added.push(r.data.row.id);
    after = r.data.row.id;
  }
  assert.ok(renumbered >= 1, '순서를 다시 매긴 적이 있다');
  const d = tbGet(g, id, a);
  assert.deepStrictEqual(d.rows.map((r) => r.id).slice(0, 27), [head].concat(added).concat([tail]), '더한 차례 그대로, 원래 둘째 줄은 그 뒤');
  // 처음부터 보던 화면: 새로 받은 줄을 얹으면 새로 연 것과 같은 차례
  const p = call(g, 'table.poll', { id, since: d0.table.ver, dsince: d0.table.dver }, a);
  assert.ok(p.ok, p.error);
  const m = new Map(d0.rows.map((r) => [r.id, r]));
  p.data.rows.forEach((r) => m.set(r.id, r));
  assert.deepStrictEqual(Array.from(m.values()).sort((x, y) => x.order - y.order).map((r) => r.id), d.rows.map((r) => r.id));
});

test('취합 시트 보완: 60줄에 한꺼번에 서식을 넣어도 시트는 붙은 행끼리 한 번에 읽고 쓴다(잠금을 오래 쥐지 않게)', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부');
  const cols = [{ id: 'c1', name: '번호' }, { id: 'c2', name: '내용' }];
  const rows = Array.from({ length: 60 }, (_, i) => ({ cells: { c1: String(i + 1), c2: '내용 ' + (i + 1) } }));
  const id = call(g, 'table.create', { fields: { title: '큰 표', sheet: '시트1' }, cols, rows }, owner).data.id;
  const d = tbGet(g, id, owner);
  const sh = g._ss.sheets.find((x) => x.name === '함께표줄');
  const proto = Object.getPrototypeOf(sh.getRange(1, 1));
  const gv = proto.getValues, sv = proto.setValues;
  let reads = 0, writes = 0, r, h;
  proto.getValues = function () { if (this.s === sh) reads++; return gv.apply(this, arguments); };
  proto.setValues = function () { if (this.s === sh) writes++; return sv.apply(this, arguments); };
  try {
    r = call(g, 'table.cells', { id, cells: d.rows.flatMap((x) => ['c1', 'c2'].map((c) => ({ row: x.id, n: x.n, col: c, f: { bd: '1111' } }))) }, owner);
    assert.ok(r.ok, r.error);
    assert.ok(reads <= 3, '읽기 ' + reads + '번');
    assert.ok(writes <= 2, '쓰기 ' + writes + '번');
    reads = 0; writes = 0;
    h = call(g, 'table.rowh', { id, rows: d.rows.map((x) => ({ row: x.id, n: x.n, h: 40 })) }, owner);
    assert.ok(h.ok, h.error);
    assert.ok(reads <= 3 && writes <= 2, '줄 높이: 읽기 ' + reads + '번, 쓰기 ' + writes + '번');
  } finally { proto.getValues = gv; proto.setValues = sv; }
  assert.strictEqual(r.data.formatted, 120);
  const back = tbGet(g, id, owner);
  assert.ok(back.rows.every((x) => x.fmt.c1.bd === '1111' && x.fmt.c2.bd === '1111' && x.h === 40));
  assert.strictEqual(call(g, 'table.cells', { id, cells: Array.from({ length: 5001 }, () => ({ row: d.rows[0].id, col: 'c1', f: { b: 1 } })) }, owner).error,
    '한 번에 5000칸까지 바꿀 수 있어요. 나눠서 해 주세요.');
});

test('취합 시트 보완: 10초 새로 받기는 서버 기억에 적어 둔 바뀐 줄만 읽고(큰 줄 탭을 다 읽지 않음), 적은 것이 없거나 빈 데가 있으면 탭에서 찾아 같은 답을 준다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const id = tbMake(g, owner);
  const d0 = tbGet(g, id, a);
  const [r0, r1, r2] = d0.rows;
  assert.ok(call(g, 'table.cell', { id, row: r0.id, n: r0.n, col: 'c4', value: '책상 2개', base: tbBase(d0, 0, 'c4') }, owner).ok);
  assert.ok(call(g, 'table.cells', { id, cells: [{ row: r1.id, n: r1.n, col: 'c4', value: '의자 9개', base: tbBase(d0, 1, 'c4') }, { row: r2.id, n: r2.n, col: 'c3', f: { b: 1 } }] }, owner).ok);
  const add = call(g, 'table.row.add', { id, after: r0.id, cells: { c4: '새 줄' } }, owner);
  assert.ok(add.ok, add.error);
  assert.ok(call(g, 'table.row.delete', { id, row: add.data.row.id }, owner).ok);
  assert.ok(call(g, 'table.rowh', { id, rows: [{ row: r2.id, n: r2.n, h: 60 }] }, owner).ok);
  assert.ok(call(g, 'table.colw', { id, w: { c4: 320 } }, owner).ok);
  assert.ok(call(g, 'table.view', { id, view: { fr: 1, gap: 's' } }, owner).ok);
  const seen = [], orig = g.tbRows_;
  g.tbRows_ = function (tab) { seen.push(tab); return orig.apply(this, arguments); };
  let p;
  try { p = call(g, 'table.poll', { id, since: d0.table.ver, dsince: d0.table.dver }, a); } finally { g.tbRows_ = orig; }
  assert.ok(p.ok, p.error);
  assert.ok(seen.indexOf('함께표줄') < 0, '큰 줄 탭은 읽지 않음: ' + seen.join(','));
  assert.strictEqual(p.data.rows.length, 4, '고친 3줄 + 더했다 뺀 줄');
  assert.ok(p.data.rows.some((r) => r.del && r.id === add.data.row.id));
  assert.strictEqual(p.data.table.view.fr, 1);
  assert.strictEqual(p.data.table.cols.find((c) => c.id === 'c4').w, 320);
  // 적어 둔 것이 없으면(서버 기억이 지워짐) 탭에서 찾는다: 같은 답
  const key = (rows) => plain(rows).map((r) => JSON.stringify(r)).sort();
  Object.keys(g._cache._store).filter((k) => k.indexOf('gy:tbc:') === 0).forEach((k) => delete g._cache._store[k]);
  const q = call(g, 'table.poll', { id, since: d0.table.ver, dsince: d0.table.dver }, a);
  assert.deepStrictEqual(key(q.data.rows), key(p.data.rows));
  // 적지 않고 판만 오른 것(빈 데)이 있으면 탭에서 찾는다
  const t = g.findRow_('함께표', id);
  g.withLock_(() => g.updateRow_('함께표', id, { '판': String(Number(t['판']) + 1) }, { id: '', name: '시험' }, '시험'));
  const v1 = q.data.ver;
  assert.ok(call(g, 'table.cell', { id, row: r0.id, n: r0.n, col: 'c4', value: '책상 3개', base: p.data.rows.find((r) => r.id === r0.id).stamps.c4[0] }, owner).ok);
  const z = call(g, 'table.poll', { id, since: v1, dsince: q.data.dver }, a);
  assert.deepStrictEqual(z.data.rows.map((r) => r.cells.c4), ['책상 3개']);
});

test('취합 시트 보완: 여러 가지로 고치는 동안 10초마다 새로 받은 화면은 늘 표를 새로 연 것과 같다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부'), a = who('심청');
  const cols = [{ id: 'c1', name: '번호' }, { id: 'c2', name: '내용' }];
  const id = call(g, 'table.create', { fields: { title: '함께 고치기', sheet: '시트1' }, cols, rows: Array.from({ length: 12 }, (_, i) => ({ cells: { c1: String(i + 1) } })) }, owner).data.id;
  const view = tbGet(g, id, a);
  const rows = new Map(view.rows.map((r) => [r.id, r]));
  let ver = view.table.ver, seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let step = 0; step < 40; step++) {
    const cur = tbGet(g, id, owner).rows;
    const pick = cur[rnd(cur.length)], k = rnd(5);
    let res;
    if (k === 0) res = call(g, 'table.cell', { id, row: pick.id, n: pick.n, col: 'c2', value: '값 ' + step, base: (pick.stamps.c2 || [0])[0] }, owner);
    else if (k === 1) res = call(g, 'table.cells', { id, cells: cur.slice(0, 10).map((x) => ({ row: x.id, n: x.n, col: 'c1', f: { b: step % 2 ? 1 : null } })) }, owner);
    else if (k === 2) res = call(g, 'table.row.add', { id, after: pick.id, cells: { c2: '더함 ' + step } }, owner);
    else if (k === 3 && cur.length > 5) res = call(g, 'table.row.delete', { id, row: pick.id }, owner);
    else res = call(g, 'table.rowh', { id, rows: cur.slice(0, 9).map((x) => ({ row: x.id, n: x.n, h: 30 + step })) }, owner);
    assert.ok(res.ok, res.error);
    const p = call(g, 'table.poll', { id, since: ver, dsince: view.table.dver }, a);
    assert.ok(p.ok, p.error);
    if (!p.data.same) {
      p.data.rows.forEach((r) => { if (r.del) rows.delete(r.id); else rows.set(r.id, r); });
      ver = p.data.ver;
    }
    const fresh = tbGet(g, id, a).rows;
    const mine = Array.from(rows.values()).sort((x, y) => x.order - y.order);
    assert.deepStrictEqual(mine.map((r) => r.id), fresh.map((r) => r.id), step + '번째: 줄 차례');
    assert.deepStrictEqual(plain(mine.map((r) => [r.cells, r.fmt, r.h])), plain(fresh.map((r) => [r.cells, r.fmt, r.h])), step + '번째: 내용');
  }
});


// ================================================================ 전체 보완 묶음 3: 조사·공지·자료·교직원(판 2026-10-19a)

test('조사 보완: 소속의 학년 읽기 — "3·4학년 전담"·"5, 6학년"·"3~6학년"은 모두 세고, "2026학년도"·"학년도"는 학년이 아니다', () => {
  const g = freshName();
  const cases = {
    '3학년 2반': ['3'], '3·4학년 전담': ['3', '4'], '5,6학년': ['5', '6'], '5, 6학년 영어': ['5', '6'], '3~6학년': ['3', '4', '5', '6'],
    '3학년·4학년 전담': ['3', '4'], '2026학년도 3학년 2반': ['3'], '교무부': [], '과학 전담': [], '4학년도': [], '12학년': [], '3 학년 1 반': ['3'], '1-2학년': ['1', '2']
  };
  Object.keys(cases).forEach((k) => assert.deepStrictEqual(plain(g.gradesOf_({ '소속': k })), cases[k], k));
});

test('조사 보완: 학년 대상 조사는 "3·4학년 전담"처럼 두 학년이 적힌 분을 두 학년 모두에 센다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const add = call(g, 'admin.staff.save', { fields: { '이름': '임꺽정', '직위': '교사', '소속': '3·4학년 전담' } }, boss());
  assert.ok(add.ok, add.error);
  const owner = who('이몽룡');
  const who2 = ids(g).who; // 새로 넣은 분까지 명단을 다시 받는다
  const four = call(g, 'survey.save', { fields: sv(g, { target: { type: 'grade', grades: ['4'] } }) }, owner).data.id;
  const three = call(g, 'survey.save', { fields: sv(g, { title: '3학년 협의', target: { type: 'grade', grades: ['3'] } }) }, owner).data.id;
  const names = (id) => call(g, 'survey.get', { id }, owner).data.notDone.map((p) => p.name).sort();
  assert.deepStrictEqual(names(four), ['이몽룡', '임꺽정'].sort());
  assert.deepStrictEqual(names(three), ['성춘향', '임꺽정', '홍길동'].sort());
  // 대상에 들었으니 낼 수 있다
  const lim = who2('임꺽정');
  const q = call(g, 'survey.get', { id: four }, lim).data;
  assert.strictEqual(q.card.inTarget, true);
  assert.ok(call(g, 'survey.respond', { id: four, answers: { [q.questions[0].id]: '피구' } }, lim).ok);
});

test('조사 보완: 홈 검색에는 그분이 대상이 아닌 조사가 보이지 않는다(만든 분·관리에게는 보임, 이름을 고르기 전에는 조사 없음)', () => {
  const g = freshName();
  const { who, boss, staff, L } = ids(g);
  const others = staff.filter((p) => p.name !== '심청').map((p) => p.id);
  const owner = who('이몽룡');
  const made = call(g, 'survey.save', { fields: sv(g, { title: '심청 선생님 축하 모금', target: { type: 'people', ids: others } }) }, owner);
  assert.ok(made.ok, made.error);
  const titles = (tok) => call(g, 'search', { q: '축하 모금' }, tok).data.surveys.items.map((c) => c.title);
  assert.deepStrictEqual(titles(who('심청')), []);
  assert.strictEqual(call(g, 'search', { q: '축하 모금' }, who('심청')).data.surveys.total, 0);
  assert.deepStrictEqual(titles(who('흥부')), ['심청 선생님 축하 모금']);
  assert.deepStrictEqual(titles(owner), ['심청 선생님 축하 모금']);
  // 만든 분이 대상에서 빠져 있어도 만든 분에게는 보인다
  const mine = call(g, 'survey.save', { fields: sv(g, { title: '모금 확인(만든 분 빼고)', target: { type: 'people', ids: [staff.find((p) => p.name === '흥부').id] } }) }, who('장화'));
  assert.ok(mine.ok, mine.error);
  assert.deepStrictEqual(call(g, 'search', { q: '모금 확인' }, who('장화')).data.surveys.items.map((c) => c.title), ['모금 확인(만든 분 빼고)']);
  const sim = boss('심청'); // 관리자 화면을 연 기기는 모두
  assert.deepStrictEqual(titles(sim), ['심청 선생님 축하 모금']);
  assert.deepStrictEqual(call(g, 'search', { q: '축하 모금' }, { login: L }).data.surveys.items, []);
});

test('교직원 보완: 한 명씩 넣을 때도 내선에 휴대폰 번호는 넣을 수 없다(학교 전화·내선은 그대로)', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  ['010-1234-5678', '01012345678', '010 1234 5678', '011-123-4567'].forEach((v, i) => {
    const r = call(g, 'admin.staff.save', { fields: { '이름': '임꺽정' + i, '내선': v } }, t);
    assert.strictEqual(r.ok, false, v);
    assert.ok(/휴대폰 번호/.test(r.error), r.error);
  });
  ['1234', '0108', '032-123-4567'].forEach((v, i) => assert.ok(call(g, 'admin.staff.save', { fields: { '이름': '전우치' + i, '내선': v } }, t).ok, v));
});

test('자료실 보완: 파일 크기 한도는 설정에서 20MB까지(시트를 손으로 고쳐도 20MB), 자료실 화면에 그 값이 간다', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  const list = call(g, 'admin.settings.get', {}, t).data;
  const def = list.find((x) => x.key === '파일 크기 한도');
  assert.strictEqual(def.max, 20);
  assert.ok(/확인 필요/.test(def.note));
  const save = (v) => call(g, 'admin.settings.save', { values: { '파일 크기 한도': v } }, t);
  assert.strictEqual(save('25').ok, false);
  assert.ok(save('15').ok);
  assert.strictEqual(call(g, 'lib.list', {}, t).data.maxMb, 15);
  g.putSetting_('파일 크기 한도', '30', { id: '', name: '시험' });
  assert.strictEqual(g.fileLimitMb_(), 20);
});

test('조사 보완: 지난 조사는 이번 학년도 것만 먼저 보내고, "이전 학년도 보기"(pastAll)를 누르면 모두', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('이몽룡');
  const sy = Number(g.setting_('학년도'));
  const a = call(g, 'survey.save', { fields: sv(g, { title: '올해 끝낸 조사' }) }, owner).data.id;
  const b = call(g, 'survey.save', { fields: sv(g, { title: '작년 조사' }) }, owner).data.id;
  assert.ok(call(g, 'survey.setOpen', { id: a, open: false }, owner).ok);
  g.withLock_(() => g.updateRow_('조사', b, { '마감 일시': (sy - 1) + '-12-01 17:00' }, { id: '', name: '시험' }, '시험'));
  const l = call(g, 'survey.list', {}, owner).data;
  assert.deepStrictEqual(l.past.map((c) => c.title), ['올해 끝낸 조사']);
  assert.strictEqual(l.pastOlder, 1);
  assert.strictEqual(l.pastAll, false);
  const all = call(g, 'survey.list', { pastAll: 1 }, owner).data;
  assert.deepStrictEqual(all.past.map((c) => c.title).sort(), ['올해 끝낸 조사', '작년 조사'].sort());
  assert.strictEqual(all.pastOlder, 0);
  assert.strictEqual(all.pastAll, true);
  // 검색은 지난 학년도 조사도 찾는다
  assert.strictEqual(call(g, 'search', { q: '작년 조사' }, owner).data.surveys.total, 1);
});

test('공지 보완: 지난 공지는 이번 학년도 것만 먼저 보내고, older를 주면 모두(지금 공지는 늘 모두)', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('성춘향');
  const sy = Number(g.setting_('학년도'));
  const put = (title, until) => assert.ok(call(g, 'notice.save', { fields: { '제목': title, '게시 끝일': until } }, me).ok);
  put('지금 공지', g.addDays_(g.todayYmd_(), 3));
  put('끝일 없는 공지', '');
  put('올해 지난 공지', sy + '-03-05');
  put('작년 공지', (sy - 1) + '-12-20');
  const l = call(g, 'notice.list', {}, me).data;
  const tl = (x) => x.items.map((n) => n.title).sort();
  assert.deepStrictEqual(tl(l), ['끝일 없는 공지', '올해 지난 공지', '지금 공지'].sort());
  assert.strictEqual(l.olderCount, 1);
  const all = call(g, 'notice.list', { older: 1 }, me).data;
  assert.deepStrictEqual(tl(all), ['끝일 없는 공지', '올해 지난 공지', '작년 공지', '지금 공지'].sort());
  assert.strictEqual(all.olderCount, 0);
});

test('자료실 보완: 보관함 자료는 보관함을 열 때(archive)만 보내고, 학년도별 개수는 늘 보낸다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('성춘향');
  g.seedTestLibrary_();
  const l = call(g, 'lib.list', {}, me).data;
  assert.ok(l.items.length > 0);
  assert.ok(l.items.every((i) => !i.archived), '지금 학년도 자료만');
  assert.strictEqual(l.archive, false);
  const archived = g.liveRows_('자료').filter((r) => r['보관 여부'] === '보관' || (r['학년도'] && r['학년도'] !== String(g.setting_('학년도'))));
  assert.ok(archived.length > 0, '가짜 자료에 보관함 자료가 있어야 함');
  assert.strictEqual(l.archiveYears.reduce((n, y) => n + y.count, 0), archived.length);
  const all = call(g, 'lib.list', { archive: 1 }, me).data;
  assert.strictEqual(all.archive, true);
  assert.strictEqual(all.items.filter((i) => i.archived).length, archived.length);
  assert.strictEqual(all.items.length, l.items.length + archived.length);
  assert.deepStrictEqual(plain(all.archiveYears), plain(l.archiveYears));
});

test('자료실 보완: 홈 "자주 찾는 자료"는 6개까지 보내고 고른 수(libraryTotal)를 함께 보낸다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const b = boss('홍길동');
  for (let i = 1; i <= 8; i++) {
    const r = call(g, 'lib.save', { fields: { '제목': '홈 자료 ' + i, mode: 'link', link: 'https://example.com/' + i, home: true } }, b);
    assert.ok(r.ok, r.error);
  }
  const h = call(g, 'home', {}, who('심청')).data;
  assert.strictEqual(h.library.length, 6);
  assert.strictEqual(h.libraryTotal, 8);
});

// ================================================================ 전체 보완 묶음 4: 서버·관리·화면 공통(판 2026-10-19a)

test('서버 보완: 웹앱에서 onEdit를 불러도(시트에서 고친 칸 없음) 서버 기억을 비우지 않는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('심청');
  call(g, 'notice.list', {}, me);
  const before = JSON.stringify(g._cache._store['gy:ep']);
  g.onEdit(); g.onEdit({}); g.onEdit({ range: { getSheet: true } });
  assert.strictEqual(JSON.stringify(g._cache._store['gy:ep']), before);
});

test('서버 보완: 스크립트 속성은 요청마다 읽지 않는다(서버 기억 10분, 없으면 한 번에 모두) · 비밀번호를 바꾸면 다음 요청부터 바로 예전 로그인이 풀린다', () => {
  const g = fresh();
  const { t } = adminTokens(g);
  const real = g.PropertiesService;
  let one = 0, all = 0;
  g.PropertiesService = { getScriptProperties() { const p = real.getScriptProperties(); return Object.assign({}, p, { getProperty(k) { one++; return p.getProperty(k); }, getProperties() { all++; return p.getProperties(); } }); } };
  const count = (fn) => { one = 0; all = 0; const r = fn(); return { one, all, r }; };
  try {
    call(g, 'home', {}, t); // 기억을 채운다
    const warm = count(() => call(g, 'sched.month', { year: 2026, month: 10 }, t));
    assert.ok(warm.r.ok, warm.r.error);
    assert.strictEqual(warm.one + warm.all, 0, '기억이 있으면 속성을 읽지 않음: ' + JSON.stringify([warm.one, warm.all]));
    delete g._cache._store['gy:props'];
    const cold = count(() => call(g, 'sched.month', { year: 2026, month: 10 }, t));
    assert.ok(cold.r.ok);
    assert.deepStrictEqual([cold.one, cold.all], [0, 1], '기억이 없으면 getProperties 한 번');
    // 공통 비밀번호를 바꾸면 기억도 버려 예전 로그인 표가 바로 풀린다
    const ch = call(g, 'admin.pw.common', { newPw: 'new-common-9', newPw2: 'new-common-9' }, t);
    assert.ok(ch.ok, ch.error);
    assert.strictEqual(call(g, 'home', {}, t).code, 'LOGIN');
    assert.ok(call(g, 'login', { password: 'new-common-9' }).ok);
    assert.strictEqual(call(g, 'login', { password: COMMON }).ok, false);
  } finally { g.PropertiesService = real; }
  // 서버 기억에도 원래 비밀번호 글자는 없다
  const dump = JSON.stringify(g._cache._store);
  assert.ok(!dump.includes('new-common-9') && !dump.includes(ADMIN));
});

// ================================================================ 전체 보완 묶음 5: 새 기능(판 2026-10-19a)

test('일정 새 구분: 회의는 누구나, 근무(관리자 근무)는 관리만 넣고·고치고·옮기고·지운다', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const me = who('심청'), b = boss('홍길동');
  const t = g.todayYmd_();
  assert.deepStrictEqual(plain(g.schedKinds_()), ['행사', '교육활동', '회의', '휴업일', '공휴일', '근무']);
  const meet = call(g, 'sched.save', { fields: { start: t, title: '학년 협의회', kind: '회의' } }, me);
  assert.ok(meet.ok, meet.error);
  assert.strictEqual(meet.data.kind, '회의');
  assert.strictEqual(meet.data.canEdit, true);
  const no = call(g, 'sched.save', { fields: { start: t, title: '교장 출장', kind: '근무' } }, me);
  assert.strictEqual(no.code, 'FORBIDDEN');
  assert.match(no.error, /근무는 관리자만/);
  const duty = call(g, 'sched.save', { fields: { start: t, title: '교장 출장', kind: '근무', time: '오후' } }, b);
  assert.ok(duty.ok, duty.error);
  // 관리자 화면이 없는 기기에서는 내가 넣은 근무도 고칠 수 없다(처음 넣은 분이어도)
  const view = call(g, 'sched.month', { year: +t.slice(0, 4), month: +t.slice(5, 7) }, who('홍길동')).data.events.find((e) => e.id === duty.data.id);
  assert.strictEqual(view.canEdit, false);
  assert.strictEqual(call(g, 'sched.delete', { id: duty.data.id }, who('홍길동')).code, 'FORBIDDEN');
  assert.strictEqual(call(g, 'sched.move', { id: duty.data.id, start: g.addDays_(t, 1), base: duty.data.at }, who('홍길동')).code, 'FORBIDDEN');
  assert.ok(call(g, 'sched.delete', { id: duty.data.id }, b).ok);
  // 학사일정 올리기도 '회의'·'근무' 구분을 알아본다
  assert.strictEqual(g.parseKind_('회의'), '회의');
  assert.strictEqual(g.parseKind_('관리자 근무'), '근무');
});

test('반복 일정: 고른 날짜마다 한 줄씩 같은 묶음으로 넣고(60개까지·1년 안), 여러 날 행사는 기간 그대로, 묶음 수가 보이고, 모두 지우기는 처음 넣은 분·관리만', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const me = who('심청');
  const t = g.todayYmd_();
  const dates = [0, 7, 14, 21].map((n) => g.addDays_(t, n));
  const r = call(g, 'sched.saveRepeat', { fields: { start: t, end: g.addDays_(t, 1), title: '방과후 협의', kind: '회의', time: '15:00' }, dates: dates.concat([dates[1], 'bad']) }, me);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.count, 4, '겹친 날짜·틀린 날짜는 뺀다');
  const rows = g.liveRows_('일정').filter((e) => e['반복 묶음ID'] === r.data.group);
  assert.deepStrictEqual(plain(rows.map((e) => e['시작일']).sort()), dates);
  assert.ok(rows.every((e) => e['끝일'] === g.addDays_(e['시작일'], 1) && e['구분'] === '회의' && e['시간'] === '15:00'));
  const ev = call(g, 'sched.range', { from: t, to: g.addDays_(t, 30) }, me).data.events.filter((e) => e.repeat === r.data.group);
  assert.strictEqual(ev.length, 4);
  assert.ok(ev.every((e) => e.repeatN === 4));
  // 다른 분은 모두 지우기 못 함, 처음 넣은 분은 한 번에(기록 한 줄)
  assert.strictEqual(call(g, 'sched.deleteRepeat', { id: rows[0]['일정ID'] }, who('흥부')).code, 'FORBIDDEN');
  const before = g.readRows_('기록').length;
  const d = call(g, 'sched.deleteRepeat', { id: rows[2]['일정ID'] }, me);
  assert.ok(d.ok, d.error);
  assert.strictEqual(d.data.count, 4);
  assert.strictEqual(g.liveRows_('일정').filter((e) => e['반복 묶음ID'] === r.data.group).length, 0);
  assert.strictEqual(g.readRows_('기록').length - before, 1);
  // 한도
  const many = Array.from({ length: 61 }, (_, i) => g.addDays_(t, i));
  assert.match(call(g, 'sched.saveRepeat', { fields: { start: t, title: '많이' }, dates: many }, me).error, /60개까지/);
  assert.match(call(g, 'sched.saveRepeat', { fields: { start: t, title: '하나' }, dates: [t] }, me).error, /두 개 이상/);
  assert.match(call(g, 'sched.saveRepeat', { fields: { start: t, title: '길게' }, dates: [t, g.addDays_(t, 400)] }, me).error, /1년 안/);
  assert.strictEqual(call(g, 'sched.saveRepeat', { fields: { start: t, title: '근무', kind: '근무' }, dates: dates }, me).code, 'FORBIDDEN');
  assert.ok(call(g, 'sched.saveRepeat', { fields: { start: t, title: '방학 근무', kind: '근무' }, dates: dates }, boss('홍길동')).ok);
  // 반복이 아닌 일정은 모두 지우기가 없다
  const one = call(g, 'sched.save', { fields: { start: t, title: '하루 행사' } }, me).data;
  assert.match(call(g, 'sched.deleteRepeat', { id: one.id }, me).error, /반복 일정이 아니에요/);
});

test('주간 안내·반복 미리보기용 기간 일정(sched.range): 그 기간과 겹치는 일정, 400일까지', () => {
  const g = freshName();
  const { who } = ids(g);
  g.seedTestSchedule_();
  const me = who('심청');
  const mon = g.mondayOf_(g.todayYmd_());
  const r = call(g, 'sched.range', { from: mon, to: g.addDays_(mon, 6) }, me);
  assert.ok(r.ok, r.error);
  assert.ok(r.data.events.some((e) => e.kind === '회의' && e.title === '부장 회의'));
  assert.ok(r.data.events.some((e) => e.kind === '근무'));
  assert.ok(r.data.events.every((e) => e.start <= g.addDays_(mon, 6) && e.end >= mon));
  assert.match(call(g, 'sched.range', { from: mon, to: g.addDays_(mon, 401) }, me).error, /400일/);
  assert.strictEqual(call(g, 'sched.range', { from: mon, to: mon }, {}).code, 'LOGIN');
});

test('지난 조사 가져오기: 조사 보기에 직접 쓴 안내 문구인지(messengerCustom)를 함께 보낸다', () => {
  const g = freshName();
  const { who } = ids(g);
  const me = who('이몽룡');
  const a = call(g, 'survey.save', { fields: sv(g) }, me).data.id;
  const b = call(g, 'survey.save', { fields: sv(g, { title: '문구 있는 조사', messenger: '직접 쓴 안내예요' }) }, me).data.id;
  assert.strictEqual(call(g, 'survey.get', { id: a }, me).data.messengerCustom, false);
  const d = call(g, 'survey.get', { id: b }, me).data;
  assert.strictEqual(d.messengerCustom, true);
  assert.strictEqual(d.messenger, '직접 쓴 안내예요');
});

test('안전·생활교육 안내 만들기: 관리만, 분류와 빈 글 2개(여기에 적어 주세요), 두 번 눌러도 하나씩 · 홈 비상 시 이것부터는 관리가 켠 글 3개까지', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const me = who('심청'), b = boss('홍길동');
  assert.strictEqual(call(g, 'help.seedSafety', {}, me).code, 'ADMIN');
  const r = call(g, 'help.seedSafety', {}, b);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.made, 2);
  assert.strictEqual(call(g, 'help.seedSafety', {}, b).data.made, 0, '두 번 눌러도 그대로');
  const list = call(g, 'help.list', {}, me).data;
  const kind = list.kinds.find((k) => k.name === '안전·생활교육');
  assert.ok(kind && kind.active);
  const posts = list.items.filter((i) => i.kindId === kind.id);
  assert.deepStrictEqual(plain(posts.map((i) => i.title)), ['대피 경로·집결지', '학교폭력 사안 처리 순서']);
  assert.ok(posts.every((i) => i.body === '여기에 적어 주세요'), '내용은 지어내지 않는다');
  // 홈에 보이기: 관리만 켤 수 있고(다른 분 값은 무시) 3개까지
  const save = (tok, i, home, extra) => call(g, 'help.save', { id: i.id, fields: Object.assign({ '분류ID': i.kindId, '제목': i.title, '내용': i.body, '순서': i.order, home }, extra || {}) }, tok);
  assert.strictEqual(save(me, posts[0], true).code, 'FORBIDDEN', '다른 분 글은 못 고침');
  const mine = call(g, 'help.save', { fields: { '분류ID': kind.id, '제목': '내 안내', '내용': '학교에서 정한 대로', home: true } }, me).data;
  assert.strictEqual(mine.home, false, '관리가 아니면 홈에 보이기를 켤 수 없다');
  assert.ok(save(b, posts[0], true).ok);
  assert.ok(save(b, posts[1], true).ok);
  const extra = call(g, 'help.save', { fields: { '분류ID': kind.id, '제목': '집결지 지도', '내용': '여기에 적어 주세요', home: true } }, b);
  assert.ok(extra.ok, extra.error);
  const four = call(g, 'help.save', { fields: { '분류ID': kind.id, '제목': '넷째 글', '내용': 'x', home: true } }, b);
  assert.match(four.error, /3개까지/);
  const h = call(g, 'home', {}, me).data;
  assert.deepStrictEqual(plain(h.emergency.map((x) => x.title)), ['대피 경로·집결지', '학교폭력 사안 처리 순서', '집결지 지도']);
  assert.ok(call(g, 'help.save', { id: posts[0].id, fields: { '분류ID': kind.id, '제목': posts[0].title, '내용': '1층은 운동장으로', '순서': '1', home: false } }, b).ok);
  assert.strictEqual(call(g, 'home', {}, me).data.emergency.length, 2);
});

test('새 학년도 준비 점검: 학년도 숫자가 남은 자료 제목·학년·반 꼴이 아닌 소속·다음 학년도 학기·공휴일·학생 수·공통 비밀번호를 살핀다(관리만, 아무것도 바꾸지 않음)', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  const cur = Number(g.setting_('학년도'));
  call(g, 'lib.save', { fields: { '제목': cur + ' 학교폭력 예방 계획', mode: 'link', link: 'https://example.com/a' } }, who('심청'));
  call(g, 'lib.save', { fields: { '제목': '상담 기록 양식', mode: 'link', link: 'https://example.com/b' } }, who('심청'));
  assert.strictEqual(call(g, 'admin.year.check', {}, who('심청')).code, 'ADMIN');
  const before = g.readRows_('기록').length;
  const r = call(g, 'admin.year.check', {}, t);
  assert.ok(r.ok, r.error);
  const by = (k) => r.data.items.find((x) => x.key === k);
  assert.deepStrictEqual(plain(r.data.items.map((x) => x.key)), ['lib', 'group', 'sem', 'off', 'stu', 'pw']);
  assert.strictEqual(by('lib').state, 'warn');
  assert.match(by('lib').detail, new RegExp(cur + ' 학교폭력 예방 계획'));
  assert.ok(!/상담 기록 양식/.test(by('lib').detail));
  assert.strictEqual(by('group').state, 'info');
  assert.match(by('group').detail, /놀부\(과학 전담\)/);
  assert.strictEqual(by('sem').state, 'warn');
  assert.strictEqual(by('off').state, 'warn');
  assert.strictEqual(by('pw').state, 'info');
  assert.match(by('pw').detail, /바꾼 기록이 없어요/);
  assert.strictEqual(g.readRows_('기록').length, before, '점검은 아무것도 바꾸지 않는다');
  // 다음 학년도 학기 기간·공휴일을 넣으면 됨으로
  const n = cur + 1;
  assert.ok(call(g, 'admin.settings.save', { values: {}, semesters: [{ year: n, s1from: n + '-03-02', s1to: n + '-07-20', s2from: n + '-08-17', s2to: (n + 1) + '-02-12' }] }, t).ok);
  assert.ok(call(g, 'sched.save', { fields: { start: n + '-05-05', title: '어린이날', kind: '공휴일' } }, Object.assign({}, t)).ok);
  assert.ok(call(g, 'admin.pw.common', { newPw: 'new-common-7', newPw2: 'new-common-7' }, t).ok);
  const { t: t2 } = (() => { const L = call(g, 'login', { password: 'new-common-7' }).data.login; const A = call(g, 'adminLogin', { password: ADMIN }, { login: L }).data.admin; return { t: { login: L, admin: A } }; })();
  const r2 = call(g, 'admin.year.check', {}, t2).data;
  const by2 = (k) => r2.items.find((x) => x.key === k);
  assert.strictEqual(by2('sem').state, 'ok');
  assert.strictEqual(by2('off').state, 'ok');
  assert.match(by2('pw').detail, /마지막으로 바꾼 때/);
});

// ---------------------------------------------------------------- 묶음 5-3: 취합 시트 찾기·숫자 열·기본 양식 10개·할 일 열(47·49·50·51)

test('취합 시트 숫자 열: 열 종류 숫자가 남고 값은 그대로(숫자가 아닌 값도 지우지 않음) · 할 일 열은 글 열 하나만 · 양식으로 저장해도 남는다', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부');
  const cols = [{ id: 'c1', name: '반', lock: true }, { id: 'c2', name: '담임', todo: true }, { id: 'c3', name: '인원', type: 'num', todo: true }, { id: 'c4', name: '메모', todo: true }];
  const r = call(g, 'table.create', { fields: { title: '인원 조사' }, cols, rows: [{ cells: { c1: '1반', c2: '심청', c3: '25' } }, { cells: { c1: '2반', c2: '홍길동', c3: '스물' } }] }, owner);
  assert.ok(r.ok, r.error);
  const d = tbGet(g, r.data.id, owner);
  assert.deepStrictEqual(d.table.cols.map((c) => c.type), ['text', 'text', 'num', 'text']);
  assert.deepStrictEqual(d.table.cols.filter((c) => c.todo).map((c) => c.name), ['담임'], '할 일 열은 글 열 하나만(앞의 것), 숫자 열은 안 됨');
  assert.strictEqual(d.rows[1].cells.c3, '스물', '숫자가 아닌 값도 지우지 않는다');
  // 열 고치기로 할 일 열을 옮기고, 숫자 열을 글 열로
  const c2 = call(g, 'table.cols', { id: d.table.id, cols: [{ id: 'c1', name: '반', lock: true }, { id: 'c2', name: '담임' }, { id: 'c3', name: '인원', type: 'text' }, { id: 'c4', name: '메모', todo: true }] }, owner);
  assert.ok(c2.ok, c2.error);
  const d2 = tbGet(g, r.data.id, owner);
  assert.deepStrictEqual(d2.table.cols.filter((c) => c.todo).map((c) => c.name), ['메모']);
  assert.strictEqual(d2.table.cols[2].type, 'text');
  assert.ok(call(g, 'table.cols', { id: d.table.id, cols: plain(d.table.cols) }, owner).ok);
  const tid = call(g, 'table.tpl.save', { sheet: d.table.id, name: '인원 양식', what: 'cols' }, owner);
  assert.ok(tid.ok, tid.error);
  const tp = call(g, 'table.tpl.get', { id: tid.data.id }, owner).data;
  assert.deepStrictEqual(tp.cols.map((c) => c.type), ['text', 'text', 'num', 'text'], '양식에도 숫자 열');
  assert.deepStrictEqual(tp.cols.filter((c) => c.todo).map((c) => c.name), ['담임'], '양식에도 할 일 열');
});

test('할 일 열 이름 나누기·끝난 줄: 쉼표·가운뎃점·빗금·줄 바꿈·선생님 · 고르기 열이 있으면 맨 앞 값, 없으면 숫자 열, 숫자 열도 없으면 글 열(덮인 칸은 찬 것)', () => {
  const g = freshName();
  assert.deepStrictEqual(plain(g.tbTodoNames_('홍길동, 성춘향 선생님/심청·흥부\n놀부 선생님, 홍길동')), ['홍길동', '성춘향', '심청', '흥부', '놀부']);
  assert.deepStrictEqual(plain(g.tbTodoNames_('')), []);
  const pick = [{ id: 'c1', name: '담임', type: 'text', todo: true }, { id: 'c2', name: '제출', type: 'pick', options: ['제출', '미제출'] }, { id: 'c3', name: '비고', type: 'text' }];
  assert.strictEqual(g.tbRowDone_(pick, { c1: '심청', c3: '메모' }, {}), false);
  assert.strictEqual(g.tbRowDone_(pick, { c1: '심청', c2: '미제출' }, {}), false);
  assert.strictEqual(g.tbRowDone_(pick, { c1: '심청', c2: '제출' }, {}), true);
  const num = [{ id: 'c1', name: '담임', type: 'text', todo: true, lock: true }, { id: 'c2', name: '재적', type: 'num' }, { id: 'c3', name: '대피', type: 'num' }, { id: 'c4', name: '비고', type: 'text' }];
  assert.strictEqual(g.tbRowDone_(num, { c1: '심청', c2: '25' }, {}), false);
  assert.strictEqual(g.tbRowDone_(num, { c1: '심청', c2: '25', c3: '24' }, {}), true, '비고는 비어도 끝');
  const text = [{ id: 'c1', name: '이름', type: 'text', todo: true, lock: true }, { id: 'c2', name: '내용', type: 'text' }, { id: 'c3', name: '잠긴 칸', type: 'text', lock: true }];
  assert.strictEqual(g.tbRowDone_(text, { c1: '심청' }, {}), false);
  assert.strictEqual(g.tbRowDone_(text, { c1: '심청', c2: '썼어요' }, {}), true, '잠긴 칸은 안 봄');
  assert.strictEqual(g.tbRowDone_(text, { c1: '심청' }, { c2: 1 }), true, '합친 칸에 덮인 칸은 찬 것으로');
});

test('할 일 열: 내 이름이 있고 끝나지 않은 줄이 홈 내가 할 일에 뜬다(서버 기억 10분, 표·열·마감을 바꾸면 바로) · 덮인 칸은 덮은 칸의 이름 · 두 번째 홈은 서버 기억 한 번', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const owner = who('흥부'), sim = who('심청'), hong = who('홍길동');
  const cols = [{ id: 'c1', name: '반', lock: true }, { id: 'c2', name: '담임', lock: true, todo: true }, { id: 'c3', name: '제출', type: 'pick', options: ['제출', '미제출'] }];
  const rows = [
    { cells: { c1: '1반', c2: '심청' } },
    { cells: { c1: '2반', c2: '심청 선생님, 홍길동' } },
    { cells: { c1: '3반', c2: '홍길동', c3: '제출' } },
    { cells: { c1: '4반', c2: '성춘향' }, ms: { c2: [2, 1] } }, // 담임 칸을 위아래로 합침
    { cells: { c1: '5반' } }
  ];
  const id = call(g, 'table.create', { fields: { title: '동의서 제출', deadline: '' }, cols, rows }, owner).data.id;
  let h = call(g, 'home', {}, sim).data;
  assert.deepStrictEqual(plain(h.tableTodos).map((x) => [x.title, x.n, x.sheetName]), [['동의서 제출', 2, '']]);
  assert.strictEqual(h.tableTodos[0].doc, id);
  assert.ok(h.tableTodos[0].at > 0, '목록을 만든 때');
  assert.strictEqual(call(g, 'home', {}, hong).data.tableTodos[0].n, 1, '홍길동은 2반만(3반은 제출)');
  assert.strictEqual(call(g, 'home', {}, who('성춘향')).data.tableTodos[0].n, 2, '덮인 칸(5반)은 덮은 칸의 이름');
  assert.deepStrictEqual(plain(call(g, 'home', {}, owner).data.tableTodos), [], '이름이 없는 분');
  assert.deepStrictEqual(plain(call(g, 'home', {}, { login: sim.login }).data.tableTodos), [], '이름을 고르기 전');
  // 두 번째부터는 서버 기억을 한 번만 다녀온다(할 일 목록도 함께 꺼냄)
  call(g, 'home', {}, sim);
  assert.strictEqual(g.PERF_.reads, 0);
  assert.strictEqual(g.PERF_.memoCalls, 1, '할 일 목록도 한 번에 꺼낸다');
  // 칸을 고쳐도 홈은 늦어도 10분 안에 바뀐다
  const d = tbGet(g, id, sim);
  assert.ok(call(g, 'table.cell', { id: d.table.id, row: d.rows[0].id, col: 'c3', value: '제출', base: 0 }, sim).ok);
  assert.strictEqual(call(g, 'home', {}, sim).data.tableTodos[0].n, 2, '바로는 그대로(서버 기억)');
  g.__clock.offset += 11 * 60 * 1000;
  assert.strictEqual(call(g, 'home', {}, sim).data.tableTodos[0].n, 1, '10분이 지나면 새로');
  // 관리자 '시트 새로 읽기'를 하면 바로 새로
  assert.ok(call(g, 'table.cell', { id: d.table.id, row: d.rows[1].id, col: 'c3', value: '제출', base: 0 }, hong).ok);
  assert.strictEqual(call(g, 'home', {}, sim).data.tableTodos[0].n, 1);
  assert.ok(call(g, 'admin.cache.clear', {}, boss()).ok);
  assert.deepStrictEqual(plain(call(g, 'home', {}, sim).data.tableTodos), [], '모두 끝남');
  // 마감·지우기는 바로 빠지고, 다시 열면 바로 돌아온다
  assert.strictEqual(call(g, 'home', {}, hong).data.tableTodos.length, 0, '홍길동도 끝');
  assert.strictEqual(call(g, 'home', {}, who('성춘향')).data.tableTodos[0].n, 2);
  assert.ok(call(g, 'table.setOpen', { id, open: false }, owner).ok);
  assert.deepStrictEqual(plain(call(g, 'home', {}, who('성춘향')).data.tableTodos), [], '마감한 표는 빠진다');
  assert.ok(call(g, 'table.setOpen', { id, open: true }, owner).ok);
  assert.strictEqual(call(g, 'home', {}, who('성춘향')).data.tableTodos.length, 1);
  // 열을 고쳐 할 일 열을 끄면 바로 빠진다
  const d2 = tbGet(g, id, owner);
  assert.ok(call(g, 'table.cols', { id: d2.table.id, cols: plain(d2.table.cols).map((c) => Object.assign(c, { todo: false })) }, owner).ok);
  assert.deepStrictEqual(plain(call(g, 'home', {}, who('성춘향')).data.tableTodos), []);
  assert.ok(call(g, 'table.cols', { id: d2.table.id, cols: plain(d2.table.cols) }, owner).ok);
  assert.strictEqual(call(g, 'home', {}, who('성춘향')).data.tableTodos.length, 1);
  // 시트가 둘이면 시트 이름도
  const s2 = call(g, 'table.sheet.add', { id, name: '2차', cols, rows: [{ cells: { c1: '1반', c2: '성춘향' } }] }, owner);
  assert.ok(s2.ok, s2.error);
  const two = plain(call(g, 'home', {}, who('성춘향')).data.tableTodos).map((x) => [x.sheetName, x.n]).sort();
  assert.deepStrictEqual(two, [['2차', 1], ['시트1', 2]]);
  assert.ok(call(g, 'table.delete', { id }, owner).ok);
  assert.deepStrictEqual(plain(call(g, 'home', {}, who('성춘향')).data.tableTodos), [], '지운 표는 빠진다');
});

test('기본 양식 B6~B10: 방학 근무 신청(학기 기간·공휴일로 방학 중 평일, 지난 날 빼고) · 연수 이수 확인(교직원) · 대피 훈련(재적은 학생 수 현황) · 안전교육 7대 영역 숫자 열 · 위험 요소', () => {
  const g = freshName();
  const { who, boss } = ids(g);
  const sy = g.curSchoolYear_();
  g.__clock.offset += Date.parse(sy + '-07-01T03:00:00Z') - Date.parse(g.todayYmd_() + 'T03:00:00Z'); // 오늘을 1학기 끝 무렵으로
  assert.strictEqual(g.todayYmd_(), sy + '-07-01');
  let { t } = adminTokens(g);
  let a = who('심청');
  // 학기 기간이 없으면 빈 줄 10개(짐작해 채우지 않는다)
  let b6 = call(g, 'table.tpl.get', { id: 'B6' }, a).data;
  assert.strictEqual(b6.rows.length, 10);
  assert.ok(b6.rows.every((r) => !r.cells));
  assert.strictEqual(call(g, 'table.tpl.list', {}, a).data.builtin[5].blank, true);
  const s = call(g, 'admin.settings.save', { values: {}, semesters: [{ year: sy, s1from: sy + '-03-02', s1to: sy + '-07-24', s2from: sy + '-08-17', s2to: (sy + 1) + '-01-08' }] }, t);
  assert.ok(s.ok, s.error);
  // 여름방학 평일 하나와 겨울방학 이틀을 공휴일로(시험용 날짜)
  const weekdays = (from, to) => { const out = []; for (let d = from; d <= to; d = g.addDays_(d, 1)) { const w = g.weekday_(d); if (w !== 0 && w !== 6) out.push(d); } return out; };
  const summer = weekdays(sy + '-07-25', sy + '-08-16'), winter = weekdays((sy + 1) + '-01-09', g.schoolYearRange_(sy).to);
  const hol1 = summer[3], hol2 = winter[5];
  assert.ok(call(g, 'sched.save', { fields: { start: hol1, title: '시험 공휴일', kind: '공휴일' } }, boss()).ok);
  assert.ok(call(g, 'sched.save', { fields: { start: hol2, end: g.addDays_(hol2, 1), title: '시험 연휴', kind: '공휴일' } }, boss()).ok);
  assert.ok(call(g, 'sched.save', { fields: { start: winter[0], title: '방학식 다음 날 행사', kind: '행사' } }, boss()).ok);
  b6 = call(g, 'table.tpl.get', { id: 'B6' }, a).data;
  const want = summer.filter((d) => d !== hol1).concat(winter.filter((d) => d !== hol2 && d !== g.addDays_(hol2, 1)));
  const label = (d) => Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일 (' + '일월화수목금토'.charAt(g.weekday_(d)) + ')';
  assert.deepStrictEqual(b6.rows.map((r) => r.cells.c2), want.map(label), '토·일·공휴일 빼고(행사는 그대로)');
  assert.strictEqual(b6.rows[0].cells.c1, '여름방학');
  assert.deepStrictEqual(plain(b6.rows[0].ms), { c1: [summer.length - 1, 1] }, '방학 칸은 위아래로 합침');
  const w0 = summer.length - 1;
  assert.strictEqual(b6.rows[w0].cells.c1, '겨울방학');
  assert.deepStrictEqual(b6.cols.map((c) => c.name), ['방학', '날짜', '근무자', '비고']);
  assert.strictEqual(call(g, 'table.tpl.list', {}, a).data.builtin[5].rows, want.length);
  // 여름방학이 지나면 겨울방학만, 지난 날은 넣지 않는다
  g.__clock.offset += Date.parse((sy + 1) + '-01-12T03:00:00Z') - Date.parse(g.todayYmd_() + 'T03:00:00Z');
  a = who('심청'); // 시계를 옮겨 본인 확인을 새로
  b6 = call(g, 'table.tpl.get', { id: 'B6' }, a).data;
  assert.strictEqual(b6.rows[0].cells.c1, '겨울방학');
  assert.deepStrictEqual(b6.rows.map((r) => r.cells.c2), winter.filter((d) => d >= (sy + 1) + '-01-12' && d !== hol2 && d !== g.addDays_(hol2, 1)).map(label));
  // 연수 이수 확인: 사용 중인 교직원 순서대로 이름·소속
  const b7 = call(g, 'table.tpl.get', { id: 'B7' }, a).data;
  assert.deepStrictEqual(b7.rows.map((r) => r.cells.c1 + '/' + (r.cells.c2 || '')), ['홍길동/3학년 1반', '성춘향/3학년 2반', '이몽룡/4학년 1반', '심청/5학년 1반', '흥부/6학년 2반', '놀부/과학 전담', '장화/2학년 1반', '홍련/1학년 1반']);
  assert.deepStrictEqual(b7.cols.map((c) => [c.name, c.type, !!c.lock, !!c.todo]), [['이름', 'text', true, true], ['소속', 'text', true, false], ['이수', 'pick', false, false], ['이수일', 'text', false, false], ['비고', 'text', false, false]]);
  // 대피 훈련: 재적은 학생 수 현황(반별), 그 반 숫자가 없으면 비움
  let b8 = call(g, 'table.tpl.get', { id: 'B8' }, a).data;
  assert.ok(b8.rows.every((r) => r.cells.c4 === undefined), '학생 수가 없으면 비움');
  const today = g.todayYmd_();
  const sv8 = call(g, 'students.save', { date: today, classes: { 1: [[12, 13]], 2: [], 3: [[10, 11], [9, 9]], 4: [[13, 14]], 5: [[15, 15]], 6: [[11, 12]] } }, a);
  assert.ok(sv8.ok, sv8.error);
  b8 = call(g, 'table.tpl.get', { id: 'B8' }, a).data;
  const line = (r) => [r.cells.c1, r.cells.c2, r.cells.c3 || '', r.cells.c4 || ''].join(' ');
  assert.deepStrictEqual(b8.rows.map(line), ['1학년 1반 홍련 25', '2학년 1반 장화 ', '3학년 1반 홍길동 21', '3학년 2반 성춘향 18', '4학년 1반 이몽룡 27', '5학년 1반 심청 30', '6학년 1반  23', '6학년 2반 흥부 ']);
  assert.deepStrictEqual(b8.cols.map((c) => [c.name, c.type]), [['학년', 'text'], ['반', 'text'], ['담임', 'text'], ['재적', 'num'], ['대피 인원', 'num'], ['비고', 'text']]);
  assert.strictEqual(b8.cols[2].todo, true, '담임 열이 할 일 열');
  // 안전교육 시수: 7대 영역 숫자 열(기준 시수는 넣지 않음)
  const b9 = call(g, 'table.tpl.get', { id: 'B9' }, a).data;
  assert.deepStrictEqual(b9.cols.filter((c) => c.type === 'num').map((c) => c.name), ['생활안전', '교통안전', '폭력예방·신변보호', '약물·사이버중독 예방', '재난안전', '직업안전', '응급처치']);
  assert.strictEqual(b9.rows.length, 8);
  assert.ok(b9.rows.every((r) => Object.keys(r.cells).every((k) => ['c1', 'c2', 'c3'].includes(k))), '시수는 비워 둔다');
  // 위험 요소: 빈 줄 10개, 조치 고르기(맨 앞 완료)
  const b10 = call(g, 'table.tpl.get', { id: 'B10' }, a).data;
  assert.strictEqual(b10.rows.length, 10);
  assert.deepStrictEqual(plain(b10.cols.find((c) => c.type === 'pick').options), ['완료', '조치 중', '접수']);
  // 기본 양식으로 만든 표에 할 일 열이 그대로 들어간다
  const mk = call(g, 'table.create', { fields: { title: '대피 훈련' }, cols: plain(b8.cols), rows: plain(b8.rows) }, a);
  assert.ok(mk.ok, mk.error);
  const h = plain(call(g, 'home', {}, who('홍길동')).data.tableTodos);
  assert.deepStrictEqual(h.map((x) => [x.title, x.n]), [['대피 훈련', 1]], '대피 인원을 적기 전에는 할 일');
});

test('홈 검색: 취합 시트 이름·시트 이름·설명·부서로 찾고(진행 중인 표 먼저), 지운 표는 빼고, 이름이 맞는 시트를 함께 알려 준다 · 목록 카드에 부서ID', () => {
  const g = freshName();
  const { who } = ids(g);
  const owner = who('흥부');
  const dept = cats(g, '부서').find((x) => x.name === '인성안전부');
  const cols = [{ id: 'c1', name: '이름' }];
  const a = call(g, 'table.create', { fields: { title: '안전 점검표', deptId: dept.id }, cols }, owner).data.id;
  const b = call(g, 'table.create', { fields: { title: '방과후 신청' }, cols }, owner).data.id;
  assert.ok(call(g, 'table.sheet.add', { id: b, name: '안전 교육 날짜', desc: '', cols }, owner).ok);
  const c = call(g, 'table.create', { fields: { title: '지난 안전 조사' }, cols }, owner).data.id;
  assert.ok(call(g, 'table.setOpen', { id: c, open: false }, owner).ok);
  const del = call(g, 'table.create', { fields: { title: '지운 안전 표' }, cols }, owner).data.id;
  assert.ok(call(g, 'table.delete', { id: del }, owner).ok);
  const r = call(g, 'search', { q: '안전' }, who('심청')).data;
  assert.deepStrictEqual(plain(r.tables.items).map((x) => [x.title, x.closed, x.sheetName]), [['방과후 신청', false, '안전 교육 날짜'], ['안전 점검표', false, ''], ['지난 안전 조사', true, '']]);
  assert.strictEqual(r.tables.total, 3);
  assert.ok(r.tables.items[0].sheet, '맞는 시트의 ID');
  assert.strictEqual(call(g, 'search', { q: '인성안전부' }, who('심청')).data.tables.items[0].id, a, '부서 이름으로도');
  assert.deepStrictEqual(plain(call(g, 'search', { q: '' }, who('심청')).data.tables), { total: 0, items: [] });
  const ls = call(g, 'table.list', {}, who('심청')).data;
  assert.strictEqual(ls.tables.find((x) => x.id === a).deptId, dept.id);
});

test('바탕화면 바로가기: 웹앱 주소는 /exec 주소만 보내고(모르면 빈 값, 화면이 주소창 주소를 받는다), 로그인한 분만', () => {
  const g = freshName();
  const { L } = ids(g);
  assert.strictEqual(call(g, 'shortcut.url', {}, {}).code, 'LOGIN');
  assert.deepStrictEqual(plain(call(g, 'shortcut.url', {}, { login: L }).data), { url: '' }, '주소를 모르면 빈 값');
  g.ScriptApp.getService = () => ({ getUrl: () => 'https://script.google.com/macros/s/AKfy-x_1/exec' });
  assert.strictEqual(call(g, 'shortcut.url', {}, { login: L }).data.url, 'https://script.google.com/macros/s/AKfy-x_1/exec');
  g.ScriptApp.getService = () => ({ getUrl: () => 'https://script.google.com/a/macros/school.kr/s/AKfy-x_1/exec' });
  assert.strictEqual(call(g, 'shortcut.url', {}, { login: L }).data.url, 'https://script.google.com/a/macros/school.kr/s/AKfy-x_1/exec', '학교 도메인 주소도');
  g.ScriptApp.getService = () => ({ getUrl: () => 'https://script.google.com/macros/s/AKfy-x_1/dev' });
  assert.strictEqual(call(g, 'shortcut.url', {}, { login: L }).data.url, '', '/dev(편집자만 열리는 주소)는 보내지 않는다');
  g.ScriptApp.getService = () => { throw new Error('권한 없음'); };
  assert.strictEqual(call(g, 'shortcut.url', {}, { login: L }).data.url, '');
});

test('취합 시트 화면 파일(45): 기본은 열 때 받기(첫 화면에 넣지 않음), 설정 처음에 함께면 예전처럼 · ui.table·점검은 서버 파일의 판', () => {
  const g = freshName();
  const { L } = ids(g);
  const { t } = adminTokens(g);
  const src = fs.readFileSync(path.join(GAS_DIR, 'TableUi.html'), 'utf8');
  let has = true;
  g.HtmlService = { createHtmlOutputFromFile: (n) => { if (n !== 'TableUi' || !has) throw new Error('없는 파일'); return { getContent: () => src }; } };
  assert.strictEqual(g.tableUiTag_(), '<script>window.__gyTableUiLazy = true;</script>', '기본은 열 때 받기');
  const r = call(g, 'ui.table', {}, { login: L });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.html, src);
  assert.strictEqual(call(g, 'ui.table', {}, {}).code, 'LOGIN');
  // 점검: 화면이 아직 받지 않았으면('lazy') 서버 파일의 판으로
  const b = g.fileBuilds_();
  const client = { app: b.App, styles: b.Styles, index: b.Index, table: 'lazy' };
  const by = (x, label) => x.items.find((y) => y.label === label);
  assert.strictEqual(by(call(g, 'admin.check', { client }, t).data, 'TableUi.html').state, 'ok');
  has = false;
  assert.deepStrictEqual(plain(call(g, 'ui.table', {}, { login: L }).data), { missing: true }, '파일이 없으면 화면이 그 화면만 안내');
  assert.strictEqual(by(call(g, 'admin.check', { client }, t).data, 'TableUi.html').state, 'bad');
  const old = src.replace(/window\.__gyTableUiBuild = '[^']+';/, '');
  g.HtmlService = { createHtmlOutputFromFile: () => ({ getContent: () => old }) };
  assert.strictEqual(by(call(g, 'admin.check', { client }, t).data, 'TableUi.html').state, 'warn', '판 표시가 없는 예전 파일');
  // 설정: 처음에 함께 ↔ 열 때 받기(스크립트 속성 TABLE_UI_INLINE, 웹앱을 열 때 시트를 열지 않고 읽는다)
  const get = () => call(g, 'admin.settings.get', {}, t).data.find((x) => x.key === '취합 시트 화면 파일');
  assert.strictEqual(get().value, '열 때 받기');
  assert.ok(call(g, 'admin.settings.save', { values: { '취합 시트 화면 파일': '처음에 함께' } }, t).ok);
  assert.strictEqual(g.PropertiesService.getScriptProperties().getProperty('TABLE_UI_INLINE'), '1');
  assert.strictEqual(get().value, '처음에 함께');
  g.HtmlService = { createHtmlOutputFromFile: () => ({ getContent: () => src }) };
  assert.strictEqual(g.tableUiTag_(), src, '처음에 함께면 파일 내용 그대로');
  assert.ok(g.readRows_('기록').some((x) => x['대상ID'] === '취합 시트 화면 파일'), '바꾼 것은 기록에');
  assert.ok(call(g, 'admin.settings.save', { values: { '취합 시트 화면 파일': '열 때 받기' } }, t).ok);
  assert.strictEqual(g.tableUiTag_(), '<script>window.__gyTableUiLazy = true;</script>');
  assert.strictEqual(call(g, 'admin.settings.save', { values: { '취합 시트 화면 파일': '아무거나' } }, t).ok, false);
  assert.ok(fs.readFileSync(path.join(GAS_DIR, 'Index.html'), 'utf8').includes("<?!= typeof tableUiTag_ === 'function' ? tableUiTag_() : include('TableUi'); ?>"), 'Index는 Code.gs가 예전 것이어도 예전처럼 연다');
});

// ---------------------------------------------------------------- 자동 등록 파일(.bat, 판 2026-10-20a)
// 이 작업 환경에는 윈도우가 없어 실제로 돌려 볼 수 없으므로, 파일 모양(한글 담는 방식·줄바꿈·명령·자리 이름·주소 검사)을 글자로 확인한다

test('자동 등록 파일(.bat): 한글은 CP949·줄은 CRLF, 하는 일은 바로가기 만들기·지우기뿐, 주소는 cmd가 특별하게 읽는 글자가 없는 https만', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(GAS_DIR, 'App.html'), 'utf8');
  const head = 'var BAT = (function () {', tail = '})(); // BAT 끝';
  const a = src.indexOf(head), b = src.indexOf(tail, a);
  assert.ok(a > 0 && b > a, '등록 파일 묶음');
  const sb = { TextDecoder };
  vm.createContext(sb);
  vm.runInContext(src.slice(a, b + tail.length) + '\nthis.BAT = BAT;', sb);
  const B = sb.BAT;
  assert.strictEqual(B.FILE, '온라인 교무실 등록.bat');
  // 주소: 붙여 넣은 글이 cmd 명령이 되지 않게
  const good = ['https://script.google.com/macros/s/AKfycbx-Ab_12.c~d/exec', 'https://script.google.com/a/macros/jangdo.es.kr/s/AKfy123/exec'];
  const bad = ['', 'http://script.google.com/macros/s/a/exec', 'https://script.google.com/macros/s/a b/exec', 'https://x/exec&calc', 'https://x/%TEMP%', 'https://x/"a"',
    'https://x/a)b', 'https://x/a(b', 'https://x/a^b', 'https://x/a!b', 'https://x/exec?x=1', 'https://x/a=b', 'https://x/a|b', 'https://x/a<b', 'https://x/a>b', "https://x/a'b",
    'https://x/a\nb', 'https://x/a$&b', 'javascript:alert(1)', 'https://x/' + 'a'.repeat(400)];
  good.forEach((u) => assert.ok(B.urlOk(u), u));
  bad.forEach((u) => assert.ok(!B.urlOk(u), JSON.stringify(u)));
  assert.throws(() => B.bytes('https://x/a&b'), '맞지 않는 주소로는 만들지 않는다');
  const url = good[0];
  const buf = Buffer.from(B.bytes(url));
  const txt = B.text(url);
  // 한글: CP949(Node의 euc-kr 풀기 = 웹 표준 euc-kr = CP949)로 담겨 다시 풀면 같고, UTF-8·BOM이 아니다
  assert.strictEqual(new TextDecoder('euc-kr').decode(buf), txt);
  assert.notStrictEqual(buf.subarray(0, 3).toString('hex'), 'efbbbf', 'BOM 없음');
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(buf), 'UTF-8로 담지 않음');
  assert.ok(buf.includes(Buffer.from([0xbf, 0xc2, 0xb6, 0xf3, 0xc0, 0xce])), "'온라인'이 CP949 바이트(BFC2 B6F3 C0CE)로");
  // 줄: CRLF, 줄 끝 빈칸 없음, 맨 앞 두 줄은 영문(chcp 949 앞)
  assert.ok(txt.endsWith('\r\n') && !/[^\r]\n/.test(txt) && !/\r[^\n]/.test(txt), 'CRLF');
  const L = txt.slice(0, -2).split('\r\n');
  assert.deepStrictEqual(L.slice(0, 2), ['@echo off', 'chcp 949 >nul']);
  L.forEach((l, i) => assert.ok(!/ $/.test(l), (i + 1) + '번째 줄 끝에 빈칸'));
  // 주소는 set 한 줄에만, 그 밖의 바깥 주소는 없다
  assert.deepStrictEqual(L.filter((l) => l.includes(url)), ['set "URL=' + url + '"']);
  assert.ok(!L.some((l) => /https?:\/\/[a-z]/i.test(l) && !l.includes(url)), '다른 바깥 주소 없음');
  // 명령: 정해 둔 것만. 지우기는 시작프로그램의 그 바로가기만, 쓰기는 바탕화면·시작프로그램의 그 바로가기만, 레지스트리는 읽기만
  const forbid = /powershell|bitsadmin|certutil|curl|wget|mshta|wscript|cscript|rundll32|schtasks|attrib|icacls|takeown|regedit|\breg\s+(add|delete|import|copy)|\brd\b|\brmdir\b|\bformat\b|\bcopy\b|\bmove\b|\bxcopy\b|\bsetx\b/i;
  const cmds = new Set(['@echo', 'chcp', 'title', 'rem', 'setlocal', 'set', 'for', 'if', 'echo', 'echo(', 'choice', 'goto', 'start', 'del', 'pause', 'endlocal']);
  const ifLine = /^if (?:\/i )?(?:not )?(?:defined [A-Z]+|exist "[^"]+"|"[^"]*"=="[^"]*") (echo .*|goto [a-z]+|set "[^"]*"|call set "[^"]*")$/;
  const echoText = (s) => !/[\^&|<>()]/.test(s) && !/%/.test(s.replace(/%(NAME|URL)%/g, ''));
  let inBlock = false, blocks = 0;
  L.forEach((l) => {
    assert.ok(!forbid.test(l), '쓰지 않는 명령: ' + l);
    if (!l || /^:[a-z]+$/.test(l)) return;
    if (l === '(') { assert.ok(!inBlock, '괄호 안에 괄호'); inBlock = true; return; }
    if (l.startsWith(')')) {
      assert.ok(inBlock, '여는 괄호 없이 닫음');
      assert.ok(/^\)>"%(DESK|STARTUP)%\\%NAME%\.url"$/.test(l), '쓰는 곳: ' + l);
      inBlock = false; blocks++;
      return;
    }
    if (inBlock) { assert.ok(/^echo (\[InternetShortcut\]|URL=%URL%)$/.test(l), '괄호 안은 바로가기 두 줄만: ' + l); return; }
    const w = l.split(' ')[0].toLowerCase();
    assert.ok(cmds.has(w), '모르는 명령: ' + l);
    if (w === 'rem') assert.ok(!/[%^&|<>()]/.test(l), 'rem 줄에 특수 글자: ' + l);
    if (w === 'echo') assert.ok(echoText(l.slice(5)), 'echo 줄에 특수 글자: ' + l);
    if (w === 'if') {
      const m = ifLine.exec(l);
      assert.ok(m, 'if 줄 모양: ' + l);
      if (/^echo /.test(m[1])) assert.ok(echoText(m[1].slice(5)), 'echo 글에 특수 글자: ' + l);
    }
    if (w === 'del') assert.strictEqual(l, 'del "%STARTUP%\\%NAME%.url" 2>nul', '지우는 것은 시작프로그램의 그 바로가기만');
    if (w === 'start') assert.strictEqual(l, 'start "" "%DESK%\\%NAME%.url"', '여는 것은 방금 만든 바로가기');
    if (w === 'for') assert.strictEqual(l, 'for /f "tokens=1,2,*" %%a in (\'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop 2^>nul\') do if /i "%%a"=="Desktop" set "DESK=%%c"', '바탕화면 위치는 레지스트리에서 읽기만');
    assert.ok(!/[<>|]/.test(l.replace(/2\^?>nul|>nul/g, '')), '정해 둔 곳 말고는 쓰지 않음: ' + l);
  });
  assert.ok(!inBlock && blocks === 2, '바로가기 쓰기 두 곳(바탕화면·시작프로그램)');
  assert.ok(L.includes('set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"'), '시작프로그램 폴더(사용자 것, 관리자 권한 없이)');
  assert.ok(L.includes('choice /c 123 /n /m "  번호를 누르세요 [1, 2, 3]: "'));
  // 자리 이름(goto): 모두 있고, 모두 쓰이고, 겹치지 않는다
  const labels = L.filter((l) => /^:[a-z]+$/.test(l)).map((l) => l.slice(1));
  const gotos = [].concat(...L.map((l) => (l.match(/goto [a-z]+/g) || []).map((g) => g.slice(5))));
  gotos.forEach((g) => assert.ok(labels.includes(g), '없는 자리로 감: ' + g));
  labels.forEach((x) => assert.ok(gotos.includes(x), '쓰지 않는 자리: ' + x));
  assert.strictEqual(new Set(labels).size, labels.length, '같은 자리 이름이 두 번');
  // 바로가기 내용은 '바로가기 파일 받기'와 같다
  assert.ok(src.includes("'[InternetShortcut]\\r\\nURL=' + u + '\\r\\n'"), '바로가기 파일 받기의 내용');
  // 안내 글: 파일 이름·번호·주소·조심할 점
  const g = B.guide(url);
  assert.ok(g.includes(B.FILE) && g.includes(url) && /3번: 저절로 열기 끄기/.test(g) && /보낸 사람을 모르는 실행 파일/.test(g) && /바로가기 파일 받기/.test(g), g);
  // 화면 연결: 운영 안내서 '들어오기'의 단추와 누르기 처리
  assert.ok(src.includes('data-action="bat-file"') && src.includes("case 'bat-file': batFile(t); break;"));
});

test("낱말: 화면·알림 글은 '관리자'(예전 '연구부장·부담당'이 남지 않는다, 교사 요청 2026-10-21b)", () => {
  for (const f of fs.readdirSync(GAS_DIR)) {
    const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
    assert.ok(!/부담당/.test(src), f + "에 '부담당'이 남음");
  }
  const app = fs.readFileSync(path.join(GAS_DIR, 'App.html'), 'utf8');
  assert.ok(app.includes('<span class="nav-label">관리</span>'), "메뉴 묶음 이름은 '관리'(바로 아래 메뉴가 '관리자')");
  assert.ok(app.includes('<h2 class="guide-h">관리자</h2>'), "운영 안내서의 관리 부분 제목");
});

// ---------------------------------------------------------------- 회의록(Meeting.gs, 판 2026-10-22a)

/** 새 회의(만든 분: by). rows는 목록의 칸 후보 그대로 */
function mtMake(g, by, extra) {
  const ls = call(g, 'meet.list', {}, by);
  assert.ok(ls.ok, ls.error);
  const kind = (extra && extra.kindName) || '부장회의';
  const k = ls.data.kinds.find((x) => x.name === kind);
  const req = Object.assign({ kindId: k.id, title: '2학기 부장회의 (1)', date: g.todayYmd_(), time: '15:00', place: '교무실', rows: ls.data.rowsDefault }, extra || {});
  delete req.kindName;
  const r = call(g, 'meet.save', req, by);
  assert.ok(r.ok, r.error);
  return r.data.id;
}
function mtGet(g, id, by) {
  const r = call(g, 'meet.get', { id }, by);
  assert.ok(r.ok, r.error);
  return r.data.meeting;
}

test('회의록: 탭이 없던 시트에서도 목록이 열리고(기본 종류 2개·맨 위 칸·부서 칸 후보), 첫 회의를 만들면 탭과 회의 종류가 생긴다', () => {
  const g = freshName();
  const { L, who } = ids(g);
  g._ss.sheets = g._ss.sheets.filter((x) => x.name !== '회의' && x.name !== '회의내용'); // 이 기능 전에 설치한 시트
  const ls = call(g, 'meet.list', {}, { login: L });
  assert.ok(ls.ok, ls.error);
  assert.deepStrictEqual(plain(ls.data.items), []);
  assert.deepStrictEqual(ls.data.kinds.map((k) => k.name), ['부장회의', '교직원회의']);
  assert.ok(ls.data.kinds.every((k) => k.virtual), '아직 분류에 넣지 않은 기본 종류');
  assert.deepStrictEqual(ls.data.rowsDefault.map((x) => x.n), ['교장 선생님', '교감 선생님', '교무부', '연구부', '정보부', '인성안전부']);
  assert.ok(!ls.data.rowsDefault.some((x) => /행정/.test(x.n)), '행정실 칸은 넣지 않는다');
  // 이름을 고르지 않으면 만들 수 없다
  assert.strictEqual(call(g, 'meet.save', { kindId: '_k1', title: 'x', date: g.todayYmd_(), rows: ls.data.rowsDefault }, { login: L }).code, 'IDENTITY');
  const id = mtMake(g, who('이몽룡'));
  assert.ok(g._ss.getSheetByName('회의') && g._ss.getSheetByName('회의내용'), '탭이 저절로 생김');
  const kinds = g.liveRows_('분류').filter((r) => r['종류'] === '회의 종류').map((r) => r['이름']);
  assert.deepStrictEqual(plain(kinds), ['부장회의', '교직원회의']);
  const ls2 = call(g, 'meet.list', {}, { login: L }).data;
  assert.strictEqual(ls2.items.length, 1);
  assert.strictEqual(ls2.items[0].id, id);
  assert.strictEqual(ls2.items[0].kind, '부장회의');
  assert.strictEqual(ls2.items[0].total, 6);
  assert.strictEqual(ls2.items[0].filled, 0);
  assert.ok(ls2.kinds.every((k) => !k.virtual), '이제 분류의 진짜 종류');
  // 다른 화면이 들고 있던 옛 가짜 종류(_k2)로 만들어도 같은 이름의 진짜 종류로
  const id2 = call(g, 'meet.save', { kindId: '_k2', title: '10월 교직원회의', date: g.todayYmd_(), rows: ls.data.rowsDefault.slice(2) }, who('성춘향'));
  assert.ok(id2.ok, id2.error);
  assert.strictEqual(call(g, 'meet.list', {}, { login: L }).data.items.find((x) => x.id === id2.data.id).kind, '교직원회의');
  assert.strictEqual(g.liveRows_('분류').filter((r) => r['종류'] === '회의 종류').length, 2, '종류가 또 늘지 않음');
  // 잘못된 값
  const bad = (x, re) => { const r = call(g, 'meet.save', Object.assign({ kindId: ls2.kinds[0].id, title: 't', date: g.todayYmd_(), rows: ls.data.rowsDefault }, x), who('성춘향')); assert.ok(!r.ok && re.test(r.error), r.error); };
  bad({ title: '' }, /제목/);
  bad({ date: '2026-13-01' }, /날짜/);
  bad({ time: '3시' }, /15:00/);
  bad({ kindId: 'C없음' }, /종류/);
  bad({ rows: [] }, /칸/);
});

test('회의록: 누구나 모든 칸을 쓰고(쓴 분이 남음), 같은 칸을 그사이 다른 분이 고쳤으면 덮어쓰지 않고 묻는다(내 것으로 바꾸기 가능)', () => {
  const g = freshName();
  const { L, who } = ids(g);
  const id = mtMake(g, who('이몽룡'));
  let m = mtGet(g, id, { login: L });
  const gyomu = m.rows.find((x) => x.name === '교무부');
  assert.strictEqual(gyomu.ver, 0);
  assert.strictEqual(gyomu.content, '');
  // 만든 분이 아닌 성춘향도 교무부 칸을 쓴다(교사 선택 '누구나 모든 칸')
  let r = call(g, 'meet.row', { id, k: gyomu.k, content: '1. 학부모 상담 주간\r\n2. 출결 서류', base: 0 }, who('성춘향'));
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.data.piece.by, '성춘향');
  assert.strictEqual(r.data.piece.ver, 1);
  assert.strictEqual(r.data.piece.content, '1. 학부모 상담 주간\n2. 출결 서류', '줄 바꿈은 \\n으로');
  // 심청은 성춘향이 쓰기 전 화면(판 0)에서 저장 → 덮어쓰지 않고 지금 내용을 돌려준다
  r = call(g, 'meet.row', { id, k: gyomu.k, content: '심청이 쓴 것', base: 0 }, who('심청'));
  assert.ok(r.ok, r.error);
  assert.ok(r.data.conflict && !r.data.piece);
  assert.strictEqual(r.data.conflict.by, '성춘향');
  assert.strictEqual(mtGet(g, id, { login: L }).rows.find((x) => x.k === gyomu.k).content, '1. 학부모 상담 주간\n2. 출결 서류');
  // '내 내용으로 바꾸기'(force)
  r = call(g, 'meet.row', { id, k: gyomu.k, content: '심청이 쓴 것', base: 0, force: true }, who('심청'));
  assert.ok(r.ok && r.data.piece.ver === 2 && r.data.piece.by === '심청', JSON.stringify(r));
  m = mtGet(g, id, { login: L });
  assert.strictEqual(m.rows.find((x) => x.k === gyomu.k).by, '심청');
  assert.strictEqual(m.filled, 1);
  assert.strictEqual(call(g, 'meet.list', {}, { login: L }).data.items[0].filled, 1);
  // 내용을 비우면 안 쓴 칸으로
  r = call(g, 'meet.row', { id, k: gyomu.k, content: '   ', base: 2 }, who('이몽룡'));
  assert.ok(r.ok, r.error);
  m = mtGet(g, id, { login: L });
  assert.strictEqual(m.rows.find((x) => x.k === gyomu.k).by, '', '비운 칸은 쓴 분을 보이지 않는다');
  assert.strictEqual(m.filled, 0);
  // 맨 위 칸(교장 선생님)도 누구나
  const top = m.rows.find((x) => x.top);
  assert.ok(call(g, 'meet.row', { id, k: top.k, content: '전달 사항 없음', base: 0 }, who('흥부')).ok);
  // 없는 칸·이름을 고르지 않음·너무 긴 글
  assert.strictEqual(call(g, 'meet.row', { id, k: 'C없음', content: 'x', base: 0 }, who('흥부')).code, 'NOTFOUND');
  assert.strictEqual(call(g, 'meet.row', { id, k: gyomu.k, content: 'x', base: 3 }, { login: L }).code, 'IDENTITY');
  assert.match(call(g, 'meet.row', { id, k: gyomu.k, content: 'x'.repeat(5001), base: 3 }, who('흥부')).error, /5000자/);
  // 기록 탭에 바뀌기 전·후
  const log = g.readRows_('기록').filter((x) => x['탭'] === '회의내용');
  assert.ok(log.some((x) => /회의록 칸: 2학기 부장회의 \(1\) › 교무부/.test(x['요약']) && /심청이 쓴 것/.test(x['바뀐 뒤'])), '기록에 칸 이름과 바뀐 내용');
});

test('회의록: 기타 안건은 누구나 더하고 고치며(판 확인), 빼기는 더한 분·회의를 만든 분·관리만', () => {
  const g = freshName();
  const { L, who, boss } = ids(g);
  const id = mtMake(g, who('이몽룡'));
  const a1 = call(g, 'meet.etc.add', { id, content: '체육대회 우천 시 계획' }, who('성춘향'));
  const a2 = call(g, 'meet.etc.add', { id, content: '교실 냉난방기 점검' }, who('흥부'));
  assert.ok(a1.ok && a2.ok, a1.error || a2.error);
  assert.match(call(g, 'meet.etc.add', { id, content: '  ' }, who('흥부')).error, /안건을 적어/);
  let m = mtGet(g, id, { login: L });
  assert.deepStrictEqual(m.etcItems.map((x) => x.content), ['체육대회 우천 시 계획', '교실 냉난방기 점검']);
  assert.strictEqual(m.etc, 2);
  // 심청이 성춘향의 안건을 고친다(누구나), 옛 판이면 묻는다
  let r = call(g, 'meet.etc.save', { eid: a1.data.piece.id, content: '체육대회 우천 시 강당 사용', base: 1 }, who('심청'));
  assert.ok(r.ok && r.data.piece.ver === 2, JSON.stringify(r));
  r = call(g, 'meet.etc.save', { eid: a1.data.piece.id, content: '옛 화면에서 고침', base: 1 }, who('흥부'));
  assert.ok(r.ok && r.data.conflict && r.data.conflict.by === '심청', JSON.stringify(r));
  // 빼기: 다른 분은 못 빼고, 더한 분·만든 분·관리는 뺀다
  const del = (eid, by) => call(g, 'meet.etc.delete', { eid }, by);
  assert.strictEqual(del(a1.data.piece.id, who('심청')).code, 'FORBIDDEN');
  m = mtGet(g, id, who('심청'));
  assert.deepStrictEqual(m.etcItems.map((x) => x.canDelete), [false, false], '다른 분 화면에는 빼기 단추가 없다');
  assert.deepStrictEqual(mtGet(g, id, who('성춘향')).etcItems.map((x) => x.canDelete), [true, false]);
  assert.ok(del(a1.data.piece.id, who('이몽룡')).ok, '회의를 만든 분');
  assert.ok(del(a2.data.piece.id, who('흥부')).ok, '더한 분');
  assert.strictEqual(mtGet(g, id, { login: L }).etcItems.length, 0);
  // 관리(관리자 화면을 연 기기)도 뺀다
  const a3 = call(g, 'meet.etc.add', { id, content: '관리가 뺄 안건' }, who('흥부')).data.piece.id;
  assert.ok(del(a3, boss('심청')).ok);
  // 다시 더하면 순서가 이어진다(뺀 안건 뒤로)
  const a4 = call(g, 'meet.etc.add', { id, content: '새 안건' }, who('흥부')).data.piece.id;
  const row = g.readRows_('회의내용').find((x) => x['내용ID'] === a4);
  assert.strictEqual(row['순서'], '4');
});

test('회의록: 회의 정보는 만든 분·관리만 고치고, 내용이 있는 칸은 뺄 수 없으며, 지난 회의의 칸 이름은 그대로 · 지운 회의는 휴지통에서 되살린다', () => {
  const g = freshName();
  const { L, who, boss } = ids(g);
  const id = mtMake(g, who('이몽룡'));
  let m = mtGet(g, id, { login: L });
  const gyomu = m.rows.find((x) => x.name === '교무부'), info = m.rows.find((x) => x.name === '정보부');
  assert.ok(call(g, 'meet.row', { id, k: gyomu.k, content: '전달 사항', base: 0 }, who('성춘향')).ok);
  const rowsOf = (mm) => mm.rows.map((x) => ({ k: x.k, n: x.name, t: x.top ? 1 : 0 }));
  const save = (patch, by) => call(g, 'meet.save', Object.assign({ id, kindId: m.kindId, title: m.title, date: m.date, time: m.time, place: m.place, rows: rowsOf(m) }, patch), by);
  assert.strictEqual(save({ title: '바꿈' }, who('심청')).code, 'FORBIDDEN');
  assert.strictEqual(m.canEdit, false, '로그인만 한 화면');
  assert.strictEqual(mtGet(g, id, who('이몽룡')).canEdit, true);
  // 내용이 있는 교무부 칸은 뺄 수 없다
  const r1 = save({ rows: rowsOf(m).filter((x) => x.k !== gyomu.k) }, who('이몽룡'));
  assert.ok(!r1.ok && /교무부/.test(r1.error) && /뺄 수 없어요/.test(r1.error), r1.error);
  // 빈 정보부 칸은 빼고, 새 맨 위 칸을 더한다(새 키)
  const r2 = save({ title: '2학기 부장회의 (1) 고침', rows: rowsOf(m).filter((x) => x.k !== info.k).concat([{ k: '', n: '협의 사항', t: 1 }]) }, who('이몽룡'));
  assert.ok(r2.ok, r2.error);
  m = mtGet(g, id, { login: L });
  assert.ok(!m.rows.some((x) => x.name === '정보부'));
  const added = m.rows.find((x) => x.name === '협의 사항');
  assert.ok(added && added.top && added.k === 't3', JSON.stringify(added));
  assert.strictEqual(m.rows.find((x) => x.k === gyomu.k).content, '전달 사항', '남은 칸의 내용은 그대로');
  // 부서 이름을 바꾸면: 지난 회의는 그대로, 새 회의는 새 이름
  const t = adminTokens(g).t;
  const gid = g.liveRows_('분류').find((r) => r['종류'] === '부서' && r['이름'] === '교무부')['분류ID'];
  assert.ok(call(g, 'admin.cat.save', { id: gid, name: '교무기획부' }, t).ok);
  assert.strictEqual(mtGet(g, id, { login: L }).rows.find((x) => x.k === gid).name, '교무부');
  assert.ok(call(g, 'meet.list', {}, { login: L }).data.rowsDefault.some((x) => x.n === '교무기획부'));
  // 지우기: 다른 분 못 함, 관리는 됨 → 목록에서 빠지고 휴지통에서 되살림
  assert.strictEqual(call(g, 'meet.delete', { id }, who('심청')).code, 'FORBIDDEN');
  assert.ok(call(g, 'meet.delete', { id }, boss('심청')).ok);
  assert.strictEqual(call(g, 'meet.list', {}, { login: L }).data.items.length, 0);
  assert.strictEqual(call(g, 'meet.get', { id }, { login: L }).code, 'NOTFOUND');
  const tr = call(g, 'admin.trash.meetings', {}, t);
  assert.ok(tr.ok, tr.error);
  assert.strictEqual(tr.data.items.length, 1);
  assert.strictEqual(tr.data.items[0].title, '2학기 부장회의 (1) 고침');
  assert.ok(call(g, 'admin.trash.restoreMeeting', { id }, t).ok);
  assert.strictEqual(call(g, 'meet.list', {}, { login: L }).data.items.length, 1);
  assert.strictEqual(mtGet(g, id, { login: L }).rows.find((x) => x.k === gyomu.k).content, '전달 사항', '되살리면 내용도 그대로');
  // 수정 기록: '회의록'으로 거르면 회의·회의내용만
  const lg = call(g, 'admin.log.list', { tab: '회의록' }, t);
  const logs = lg.data.items || lg.data;
  assert.ok(lg.ok && logs.length >= 4 && logs.every((x) => x.tab === '회의' || x.tab === '회의내용'), JSON.stringify(logs.slice(0, 2)));
});

test('회의록: 학기 나누기(학기 기간이 있으면 2학기 시작일로, 없으면 3~8월 1학기)·회의 종류 이름을 분류에서 바꾸면 모두 바뀐다·맨 위 칸 설정(비우면 부서 칸만)', () => {
  const g = freshName();
  const { L, who } = ids(g);
  const a = { id: '', name: '시험' };
  g.putSetting_('1학기 시작일', '2026-03-02', a); g.putSetting_('1학기 끝일', '2026-07-24', a);
  g.putSetting_('2학기 시작일', '2026-08-17', a); g.putSetting_('2학기 끝일', '2027-01-08', a);
  const mk = (date) => mtMake(g, who('이몽룡'), { date, title: date });
  mk('2026-07-01'); mk('2026-08-20'); mk('2027-01-05'); mk('2025-09-01');
  const ls = call(g, 'meet.list', {}, { login: L }).data;
  const term = (d) => ls.items.find((x) => x.date === d).term;
  assert.strictEqual(term('2026-07-01'), '2026-1');
  assert.strictEqual(term('2026-08-20'), '2026-2');
  assert.strictEqual(term('2027-01-05'), '2026-2', '1월은 그 학년도 2학기');
  assert.strictEqual(term('2025-09-01'), '2025-2', '학기 기간이 없는 학년도는 달로');
  assert.deepStrictEqual(ls.items.map((x) => x.date), ['2027-01-05', '2026-08-20', '2026-07-01', '2025-09-01'], '새 회의 먼저');
  assert.deepStrictEqual(ls.terms.map((x) => x.label), ['2026학년도 2학기', '2026학년도 1학기', '2025학년도 2학기']);
  // 종류 이름 바꾸기(관리자 › 분류)
  const t = adminTokens(g).t;
  const kid = ls.kinds.find((k) => k.name === '부장회의').id;
  assert.ok(call(g, 'admin.cat.save', { id: kid, name: '부장 협의회' }, t).ok);
  assert.ok(call(g, 'meet.list', {}, { login: L }).data.items.every((x) => x.kind === '부장 협의회'));
  // 관리자 › 분류에 '회의 종류'가 있고 새 종류를 더할 수 있다
  assert.ok(g.categoryKinds_().includes('회의 종류'));
  assert.ok(call(g, 'admin.cat.save', { kind: '회의 종류', name: '학년 협의회' }, t).ok);
  assert.ok(call(g, 'meet.list', {}, { login: L }).data.kinds.some((k) => k.name === '학년 협의회'));
  // 맨 위 칸 설정: 40자 넘게 적을 수 있고(100자까지), 비우면 부서 칸만
  assert.ok(call(g, 'admin.settings.save', { values: { '회의록 맨 위 칸': '교장 선생님, 교감 선생님, 교무 협의, 학년 대표 협의, 기타 전달 사항 모음' } }, t).ok);
  assert.deepStrictEqual(call(g, 'meet.list', {}, { login: L }).data.rowsDefault.filter((x) => x.t).map((x) => x.n), ['교장 선생님', '교감 선생님', '교무 협의', '학년 대표 협의', '기타 전달 사항 모음']);
  assert.ok(call(g, 'admin.settings.save', { values: { '회의록 맨 위 칸': '' } }, t).ok);
  assert.ok(!call(g, 'meet.list', {}, { login: L }).data.rowsDefault.some((x) => x.t));
  assert.ok(!call(g, 'admin.settings.save', { values: { '학교명': '' } }, t).ok, '다른 글 설정은 여전히 비울 수 없다');
});

test('회의록(2026-10-28a): 일정에도 넣기 → 회의를 고치면 일정도 함께, 지우면 함께 지우고 되살리면 함께 · 홈 할 일(내 부서 칸, 부서 전원) · 홈 검색 · 칸 추가', () => {
  const g = freshName();
  const { L, who, boss } = ids(g);
  const ls = call(g, 'meet.list', {}, who('이몽룡')).data;
  const gyomu = ls.rowsDefault.find((x) => x.n === '교무부');
  const member = g.liveRows_('교직원').find((x) => x['부서ID'] === gyomu.k && x['사용 여부'] !== '사용 안 함');
  assert.ok(member, '교무부 가짜 교직원이 있어야 함');
  // 일정에도 넣기 + 이 회의에만 쓸 칸(1학년)
  const rows = ls.rowsDefault.concat([{ k: '', n: '1학년', t: 1 }]);
  let r = call(g, 'meet.save', { kindId: ls.kinds[0].id, title: '부장회의 (1)', date: g.addDays_(g.todayYmd_(), 2), time: '15:00', place: '교무실', rows, addSched: true }, who('이몽룡'));
  assert.ok(r.ok, r.error);
  const id = r.data.id;
  assert.ok(r.data.sched, '일정ID를 돌려준다');
  let ev = g.findRow_('일정', r.data.sched);
  assert.strictEqual(ev['구분'], '회의');
  assert.strictEqual(ev['회의ID'], id);
  assert.strictEqual(ev['대상 학년'], '교직원');
  assert.strictEqual(ev['행사명'], '부장회의 (1)');
  let m = mtGet(g, id, { login: L });
  assert.strictEqual(m.schedId, r.data.sched);
  assert.ok(m.rows.some((x) => x.name === '1학년' && x.top), '직접 추가한 칸');
  // 일정 화면에도 회의ID가 보인다(회의록 열기)
  const mon = call(g, 'sched.month', { year: Number(ev['시작일'].slice(0, 4)), month: Number(ev['시작일'].slice(5, 7)) }, { login: L }).data;
  assert.strictEqual(mon.events.find((e) => e.id === ev['일정ID']).meetId, id);
  // 고치면 일정도 함께(날짜·시간·장소·제목)
  r = call(g, 'meet.save', { id, kindId: ls.kinds[0].id, title: '부장회의 (1) 바뀜', date: g.addDays_(g.todayYmd_(), 3), time: '16:00', place: '도서실', rows: m.rows.map((x) => ({ k: x.k, n: x.name, t: x.top ? 1 : 0 })) }, who('이몽룡'));
  assert.ok(r.ok, r.error);
  ev = g.findRow_('일정', ev['일정ID']);
  assert.deepStrictEqual([ev['행사명'], ev['시작일'], ev['시간'], ev['장소']], ['부장회의 (1) 바뀜', g.addDays_(g.todayYmd_(), 3), '16:00', '도서실']);
  // 홈 할 일: 교무부 선생님에게 '교무부 칸 아직 안 씀', 다른 부서는 없음
  const memberTok = { login: L, identity: call(g, 'verify', { staffId: member['교직원ID'] }, { login: L }).data.identity };
  let home = call(g, 'home', {}, memberTok).data;
  assert.ok(home.meetTodos.some((x) => x.id === id && x.k === gyomu.k && x.name === '교무부'), JSON.stringify(home.meetTodos));
  const other = g.liveRows_('교직원').find((x) => x['부서ID'] && x['부서ID'] !== gyomu.k && x['사용 여부'] !== '사용 안 함');
  home = call(g, 'home', {}, { login: L, identity: call(g, 'verify', { staffId: other['교직원ID'] }, { login: L }).data.identity }).data;
  assert.ok(!home.meetTodos.some((x) => x.id === id && x.k === gyomu.k), '다른 부서에는 교무부 칸 알림이 없다');
  // 한 분이 쓰면 모두에게서 사라짐
  assert.ok(call(g, 'meet.row', { id, k: gyomu.k, content: '우천 시 체육관 사용', base: 0 }, who('성춘향')).ok);
  home = call(g, 'home', {}, memberTok).data;
  assert.ok(!home.meetTodos.some((x) => x.id === id), '쓴 뒤에는 알림이 없다');
  // 검색: 칸 내용으로 찾는다
  const sr = call(g, 'search', { q: '체육관' }, { login: L }).data;
  assert.ok(sr.meetings.items.some((x) => x.id === id), JSON.stringify(sr.meetings));
  // 지우면 일정도 함께 지우고, 관리자 휴지통에서 되살리면 함께
  assert.ok(call(g, 'meet.delete', { id }, who('이몽룡')).ok);
  assert.ok(g.findRow_('일정', ev['일정ID'])['삭제 여부'], '이어진 일정도 지운다');
  assert.ok(call(g, 'admin.trash.restoreMeeting', { id }, boss()).ok);
  assert.ok(!g.findRow_('일정', ev['일정ID'])['삭제 여부'], '되살리면 일정도');
  // 일정에 넣지 않은 회의는 일정 없음
  const id2 = mtMake(g, who('이몽룡'));
  assert.strictEqual(mtGet(g, id2, { login: L }).schedId, '');
});

test('회의록: 점검(Meeting.gs 판·탭이 아직 없어도 괜찮음)·예시 데이터(가짜 교직원 이름만)', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  g._ss.sheets = g._ss.sheets.filter((x) => x.name !== '회의' && x.name !== '회의내용');
  const b = g.fileBuilds_();
  const r = call(g, 'admin.check', { client: { app: b.App, styles: b.Styles, index: b.Index } }, t).data;
  assert.ok(r.items.some((x) => x.label === 'Meeting.gs' && x.state === 'ok'), 'Meeting.gs 판 확인');
  const tab = r.items.find((x) => x.label === '회의 탭');
  assert.ok(tab && tab.state === 'ok' && /저절로/.test(tab.detail), JSON.stringify(tab));
  assert.ok(!r.items.some((x) => x.state === 'bad' && (x.group === '시트' || /Meeting/.test(x.label))), JSON.stringify(r.items.filter((x) => x.state === 'bad')));
  // 예시 회의 2개, 쓴 분은 가짜 교직원(옛이야기 인물)
  assert.strictEqual(g.seedTestMeetings_(), 2);
  assert.throws(() => g.seedTestMeetings_(), /이미 회의가/);
  const { L } = loginAll(g);
  const ls = call(g, 'meet.list', {}, { login: L }).data;
  assert.strictEqual(ls.items.length, 2);
  assert.ok(ls.items.every((x) => /\(예시\)/.test(x.title)));
  const m = mtGet(g, ls.items[0].id, { login: L });
  const by = m.rows.map((x) => x.by).filter(Boolean).concat(m.etcItems.map((x) => x.by));
  assert.ok(by.length >= 3 && by.every((n) => ['홍길동', '성춘향', '이몽룡', '심청', '흥부', '놀부', '장화', '홍련'].includes(n)), by.join(','));
});

test('화면 READS(읽기 목록)가 서버의 읽기 요청과 같다(빠지면 읽기를 저장으로 보고 화면 기억을 모두 지움, 2026-10-28a)', () => {
  const app = fs.readFileSync(path.join(GAS_DIR, 'App.html'), 'utf8');
  const m = /var READS = \{([\s\S]*?)\};/.exec(app);
  assert.ok(m, 'READS');
  const reads = new Set([...m[1].matchAll(/'?([\w.]+)'?\s*:\s*1/g)].map((x) => x[1]));
  const g = freshName();
  const routes = Object.keys(plain(Object.fromEntries(Object.keys(g.routes_()).map((k) => [k, 1]))));
  const TOP = new Set(['start', 'ping', 'boot', 'batch', 'session', 'staffPicker', 'home', 'search']);
  const LAST = new Set(['list', 'get', 'poll', 'find', 'csv', 'check', 'preview', 'info', 'range', 'month', 'year', 'url', 'table', 'speed', 'importCheck', 'surveys', 'library', 'tables', 'meetings', 'history']);
  const isRead = (k) => TOP.has(k) || (k.indexOf('.') > 0 && LAST.has(k.split('.').pop()));
  for (const k of routes) {
    if (isRead(k)) assert.ok(reads.has(k), '읽기인데 READS에 없음: ' + k);
    else assert.ok(!reads.has(k), '쓰기인데 READS에 있음: ' + k);
  }
  for (const k of reads) assert.ok(routes.includes(k), 'READS에만 있는 이름: ' + k);
});

test('일정(2026-10-28a): 대상을 안 고르면 전체 · 다시 올리기에서 파일에 없는 전에 올린 행사 숨기기·되돌리기 · 바뀐 내용 보기', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  const { who } = ids(g);
  // 대상 없이 넣으면 '전체'
  const e0 = call(g, 'sched.save', { fields: { start: '2026-11-12', title: '대상 없는 행사', kind: '행사', target: [] } }, who('심청'));
  assert.strictEqual(e0.ok, true, e0.error);
  assert.strictEqual(g.findRow_('일정', e0.data.id)['대상 학년'], '전체');
  // 다시 올리기: 첫 파일 3개 → 둘째 파일은 하나 이름이 바뀌고 하나 빠짐
  const dept = call(g, 'sched.save', { fields: { start: '2026-11-10', title: '부서 행사', kind: '행사' } }, who('심청')).data;
  const grid1 = [HEAD, ['2026-11-09', '', '', '학예회', '전체', '', '', '행사'], ['2026-11-11', '', '', '독서 주간', '전체', '', '', '행사'], ['2026-11-13', '', '', '체육 대회', '전체', '', '', '행사'], ['2026-12-20', '', '', '범위 밖 행사', '전체', '', '', '행사']];
  const c1 = call(g, 'sched.upload.check', { grid: grid1 }, t).data;
  assert.strictEqual(c1.counts.gone, 0);
  const s1 = call(g, 'sched.upload.save', { rows: c1.rows.map((r) => r.raw), mode: 'skip' }, t).data;
  assert.strictEqual(s1.added, 4);
  g.__clock.offset += 2000;
  const grid2 = [HEAD, ['2026-11-09', '', '', '학예회', '전체', '', '', '행사'], ['2026-11-12', '', '', '독서 주간 행사', '전체', '', '', '행사'], ['2026-11-13', '', '', '새 행사', '전체', '', '', '행사']];
  const c2 = call(g, 'sched.upload.check', { grid: grid2 }, t).data;
  assert.deepStrictEqual(plain(c2.gone.map((x) => x.title)), ['독서 주간', '체육 대회'], '파일 날짜 범위(11/9~11/13) 안의 전에 올린 행사만, 부서 행사·범위 밖은 빼고');
  const before = c2.days.after.total;
  const c2b = call(g, 'sched.upload.check', { grid: grid2, hideGone: true }, t).data;
  assert.strictEqual(c2b.counts.gone, 2);
  assert.ok(c2b.days.after.total >= before);
  const s2 = call(g, 'sched.upload.save', { rows: c2.rows.map((r) => r.raw), mode: 'skip', hideGone: true }, t);
  assert.strictEqual(s2.ok, true, s2.error);
  assert.strictEqual(s2.data.hidden, 2);
  let month = call(g, 'sched.month', { year: 2026, month: 11 }, t).data.events.map((e) => e.title);
  assert.ok(!month.includes('독서 주간') && !month.includes('체육 대회'), '숨김');
  assert.ok(month.includes('부서 행사') && month.includes('독서 주간 행사') && month.includes('새 행사'));
  assert.ok(call(g, 'sched.month', { year: 2026, month: 12 }, t).data.events.some((e) => e.title === '범위 밖 행사'));
  const u = call(g, 'sched.upload.undo', { batch: s2.data.batch }, t).data;
  assert.deepStrictEqual(plain(u), { removed: 2, restored: 2 });
  month = call(g, 'sched.month', { year: 2026, month: 11 }, t).data.events.map((e) => e.title);
  assert.ok(month.includes('독서 주간') && month.includes('체육 대회') && !month.includes('새 행사'), '되돌리면 숨긴 것도 다시');
  assert.ok(month.includes('부서 행사'), dept.id);
  // 숨기지 않고 올리면 그대로
  g.__clock.offset += 2000;
  const s3 = call(g, 'sched.upload.save', { rows: c2.rows.map((r) => r.raw), mode: 'skip' }, t).data;
  assert.strictEqual(s3.hidden, 0);
  // 바뀐 내용 보기
  g.__clock.offset += 2000;
  const ev = call(g, 'sched.month', { year: 2026, month: 11 }, who('심청')).data.events.filter((e) => e.id === e0.data.id)[0];
  const ed = call(g, 'sched.save', { id: e0.data.id, base: ev.editedAt || ev.at, fields: { start: '2026-11-13', title: '대상 있는 행사', kind: '행사', target: ['3'], place: '강당' } }, who('심청'));
  assert.strictEqual(ed.ok, true, ed.error);
  const h = call(g, 'sched.history', { id: e0.data.id }, who('홍길동'));
  assert.strictEqual(h.ok, true, h.error);
  const ch = plain(h.data.list.filter((x) => x.changes.length)[0].changes);
  const names = ch.map((c) => c[0]);
  ['날짜', '이름', '대상', '장소'].forEach((n) => assert.ok(names.includes(n), n + ' ' + JSON.stringify(ch)));
  assert.deepStrictEqual(ch.filter((c) => c[0] === '날짜')[0], ['날짜', '2026-11-12', '2026-11-13']);
  assert.strictEqual(h.data.list[0].by, '심청');
  assert.deepStrictEqual(plain(call(g, 'sched.history', { id: 'E없음' }, who('홍길동')).data), { list: [] });
});

test('공지에 자료실 자료 붙이기(2026-10-28a): 붙인 자료 이름이 보이고, 없는 자료는 막고, 자료를 지우면 빈칸 · 자료에 넣은 날(added)', () => {
  const g = freshName();
  const { who } = ids(g);
  const lib = call(g, 'lib.save', { id: '', fields: { '제목': '안전 점검표 양식', mode: 'link', link: 'https://example.com/a' } }, who('심청'));
  assert.strictEqual(lib.ok, true, lib.error);
  assert.strictEqual(lib.data.added, g.todayYmd_());
  const n = call(g, 'notice.save', { id: '', fields: { '제목': '점검표 내 주세요', '자료ID': lib.data.id } }, who('심청'));
  assert.strictEqual(n.ok, true, n.error);
  assert.strictEqual(n.data.libId, lib.data.id);
  assert.strictEqual(n.data.libTitle, '안전 점검표 양식');
  const list = call(g, 'notice.list', {}, who('홍길동')).data;
  const it = (list.items || list.notices || list).filter ? (list.items || list.notices || list).filter((x) => x.id === n.data.id)[0] : null;
  assert.ok(it && it.libTitle === '안전 점검표 양식', JSON.stringify(list).slice(0, 200));
  assert.match(call(g, 'notice.save', { id: '', fields: { '제목': 'x', '자료ID': 'D없는자료' } }, who('심청')).error, /붙인 자료를 찾지 못했어요/);
  call(g, 'lib.delete', { id: lib.data.id }, who('심청'));
  const list2 = call(g, 'notice.list', {}, who('홍길동')).data;
  const it2 = (list2.items || list2.notices || list2).filter((x) => x.id === n.data.id)[0];
  assert.strictEqual(it2.libId, '', '지운 자료는 빈칸');
});

test('관리자·서버(2026-10-28a): 긴 기록도 JSON이 깨지지 않음 · 수정 기록 찾기·날짜·거슬러 찾기 · 관리자 표 늘리기 · 빈 열 지우기 · 서버 오류 기록 · 마지막 백업', () => {
  const g = freshName();
  const { t } = adminTokens(g);
  // 1) 4만 9천 자가 넘는 기록도 JSON 그대로(앞 항목만 남기고 '…'에 남은 수)
  const big = {};
  for (let i = 0; i < 400; i++) big['칸' + i] = 'ㄱ'.repeat(200);
  g.withLock_(() => g.writeLog_({ id: '', name: '시험' }, '함께표', 'K1', '수정', '여러 칸', big, big));
  let res = call(g, 'admin.log.list', { tab: '취합 시트' }, t).data;
  const it = res.items.filter((x) => x.target === 'K1')[0];
  assert.ok(it && it.after && it.after['…'] && /줄였어요/.test(it.after['…']), '바뀐 뒤가 JSON으로 읽힘');
  // 2) 기록을 6천 줄 넘게 쌓아도 거르면 거슬러 찾는다
  g.withLock_(() => g.writeLog_({ id: '', name: '시험' }, '설정', '', '수정', '아주 오래된 설정 기록', null, null));
  const sh = g._ss.sheets.find((x) => x.name === '기록');
  const filler = sh.data[sh.data.length - 1].slice();
  filler[3] = '함께표'; filler[6] = '칸 고침';
  for (let i = 0; i < 6000; i++) sh.data.push(filler.slice());
  g.dirty_('기록');
  res = call(g, 'admin.log.list', { q: '아주 오래된' }, t).data;
  assert.strictEqual(res.items.length, 1, JSON.stringify(res).slice(0, 200));
  assert.ok(res.scanned > 5000 && res.total > 6000);
  res = call(g, 'admin.log.list', {}, t).data;
  assert.strictEqual(res.items.length, 200);
  assert.strictEqual(res.scanned, 5000, '거르지 않으면 끝 5000줄만 본다');
  res = call(g, 'admin.log.list', { from: '2001-01-01', to: '2001-12-31' }, t).data;
  assert.strictEqual(res.items.length, 0);
  // 3) 관리자 표: 남은 시간이 1시간보다 적으면 새 표
  let r = JSON.parse(g.api(JSON.stringify({ action: 'admin.check', args: {}, tokens: t })));
  assert.ok(r.ok && !r.renewAdmin, '방금 받은 표는 늘리지 않음');
  g.__clock.offset += 90 * 60000;
  r = JSON.parse(g.api(JSON.stringify({ action: 'admin.check', args: {}, tokens: t })));
  assert.ok(r.ok && r.renewAdmin, '1시간 30분 뒤에는 새 표');
  g.__clock.offset += 60 * 60000; // 처음 표는 2시간이 지나 끝남
  assert.strictEqual(JSON.parse(g.api(JSON.stringify({ action: 'admin.check', args: {}, tokens: t }))).code, 'ADMIN');
  const t2 = Object.assign({}, t, { admin: r.renewAdmin });
  assert.strictEqual(JSON.parse(g.api(JSON.stringify({ action: 'admin.check', args: {}, tokens: t2 }))).ok, true, '늘린 표로는 된다');
  // 4) 점검: 칸 수·기록 탭·서버 오류, 빈 열 지우기
  const chk = call(g, 'admin.check', {}, t2).data;
  const by = (l) => chk.items.filter((x) => x.label === l)[0];
  assert.ok(by('전체 칸 수') && /1,000만 칸/.test(by('전체 칸 수').detail));
  assert.ok(by('기록 탭') && by('최근 6시간'));
  assert.ok(chk.spare > 0, '새 탭은 26열이라 빈 열이 있음');
  const trim = call(g, 'admin.sheet.trim', {}, t2);
  assert.strictEqual(trim.ok, true, trim.error);
  assert.ok(trim.data.cut > 0);
  assert.strictEqual(call(g, 'admin.check', {}, t2).data.spare, 0);
  assert.ok(g._ss.sheets.find((x) => x.name === '교직원').getMaxColumns() >= g.tabs_()['교직원'].length, '머리글 열은 남김');
  g.errRemember_('home', '홍길동', 'TypeError: x is not a function');
  const e2 = call(g, 'admin.check', {}, t2).data;
  assert.strictEqual(e2.items.filter((x) => x.label === '최근 6시간')[0].state, 'warn');
  assert.match(e2.errors[0].detail, /TypeError/);
  // 5) 설정: 마지막 백업
  const sets = call(g, 'admin.settings.get', {}, t2).data;
  assert.ok(sets.some((x) => x.key === '마지막 백업'));
  // 6) 공통 비밀번호를 바꾸면 바꾼 때를 적어 둔다
  call(g, 'admin.pw.common', { newPw: 'new-common-1', newPw2: 'new-common-1' }, t2);
  assert.ok(g.PropertiesService.getScriptProperties().getProperty('COMMON_PW_AT'));
});

console.log(results.join('\n'));
console.log('\n' + passed + '/' + results.length + ' 통과');
