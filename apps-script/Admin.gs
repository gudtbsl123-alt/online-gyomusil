/**
 * Admin.gs — 설정·분류·교직원 표·수정 기록 (관리자 화면)
 */

// ---------------------------------------------------------------- 설정

/** 설정 탭의 키. (확인 필요)는 학교에서 정해 주셔야 하는 값이다. */
function settingDefs_() {
  return [
    { key: '학교명', def: '인천장도초등학교', type: 'text', label: '학교 이름' },
    { key: '학년도', def: '2026', type: 'year', label: '지금 학년도' },
    { key: '1학기 시작일', def: '', type: 'date', label: '1학기 시작일', note: '확인 필요 · 수업일수 계산에 써요' },
    { key: '1학기 끝일', def: '', type: 'date', label: '1학기 끝일', note: '확인 필요' },
    { key: '2학기 시작일', def: '', type: 'date', label: '2학기 시작일', note: '확인 필요' },
    { key: '2학기 끝일', def: '', type: 'date', label: '2학기 끝일', note: '확인 필요' },
    { key: '본인 확인 방식', def: '이름만', type: 'choice', options: ['이름만', '이름+개인 번호'], label: '본인 확인 방식', note: "'이름만'은 명단에서 이름만 골라요. 바꾸면 모든 기기에서 이름을 다시 골라야 해요" },
    { key: '기기 기억 일수', def: '365', type: 'int', min: 1, max: 400, label: '로그인·이름을 기기에 기억하는 기간', unit: '일' },
    { key: '잠금 횟수', def: '5', type: 'int', min: 3, max: 10, label: '개인 번호를 몇 번 틀리면 잠글까요', unit: '번', note: "'이름+개인 번호'일 때만 써요" },
    { key: '잠금 분', def: '10', type: 'int', min: 1, max: 120, label: '잠그는 시간', unit: '분', note: "'이름+개인 번호'일 때만 써요" },
    { key: '백업 남길 개수', def: '30', type: 'int', min: 3, max: 365, label: '매일 백업을 몇 개까지 남길까요', unit: '개' },
    { key: '기존 시트 바로가기', def: '[]', type: 'links', label: "홈의 '아직 기존 시트에서 하는 일' 바로가기", note: '홈 화면 아래에 보여요' },
    { key: '파일 크기 한도', def: '10', type: 'int', min: 1, max: 50, label: '자료실에 올릴 수 있는 파일 크기', unit: 'MB', note: '확인 필요: 학교 PC·휴대폰에서 실제로 올려 보고 정해요. 더 큰 파일은 드라이브 링크로 넣어요' },
    { key: '백업 폴더ID', def: '', type: 'readonly', label: '백업 폴더(자동)' },
    { key: '자료 폴더ID', def: '', type: 'readonly', label: '자료실 파일 폴더(자동, 공유하지 않음)' }
  ];
}

var SETTINGS_CACHE_ = null;

function settingsMap_() {
  if (SETTINGS_CACHE_) return SETTINGS_CACHE_;
  var m = {};
  settingDefs_().forEach(function (d) { m[d.key] = d.def; });
  try {
    readRows_('설정').forEach(function (r) { if (r['키']) m[r['키']] = r['값']; });
  } catch (e) {
    if (e.code !== 'SETUP') throw e;
  }
  SETTINGS_CACHE_ = m;
  return m;
}

function setting_(key) {
  var v = settingsMap_()[key];
  return v === undefined ? '' : v;
}

/** 설정 한 칸을 바꾸고 기록을 남긴다(잠금 안에서 부른다) */
function putSetting_(key, value, actor) {
  withLock_(function () {
    var rows = readRows_('설정');
    var row = null;
    rows.forEach(function (r) { if (r['키'] === key) row = r; });
    var sh = sheet_('설정');
    var before = row ? row['값'] : '';
    if (before === String(value)) return;
    if (row) {
      sh.getRange(row._row, 2).setValue(cellWrite_(value));
    } else {
      var def = settingDefs_().filter(function (d) { return d.key === key; })[0];
      sh.appendRow([key, value, def ? (def.note || def.label) : ''].map(cellWrite_));
    }
    writeLog_(actor, '설정', key, '수정', key + ' 바꿈', { '값': before }, { '값': String(value) });
  });
  SETTINGS_CACHE_ = null;
}

function adminSettingsGet_() {
  var m = settingsMap_();
  return settingDefs_().map(function (d) {
    return { key: d.key, label: d.label, type: d.type, note: d.note || '', unit: d.unit || '', min: d.min, max: d.max, options: d.options, value: m[d.key] };
  });
}

function adminSettingsSave_(args, actor) {
  var values = args.values || {};
  var defs = settingDefs_();
  var clean = {};
  defs.forEach(function (d) {
    if (!(d.key in values) || d.type === 'readonly') return;
    var v = values[d.key] === null || values[d.key] === undefined ? '' : String(values[d.key]).trim();
    if (d.type === 'text') v = cleanText_(v, 40, d.label, true);
    if (d.type === 'year') {
      if (!/^20\d\d$/.test(v)) throw userError_('학년도는 2026처럼 네 자리로 적어 주세요.');
    }
    if (d.type === 'date' && v && !isDate_(v)) throw userError_(d.label + josa_(d.label, '을', '를') + ' 날짜(예: 2026-03-02)로 골라 주세요.');
    if (d.type === 'int') {
      var n = Number(v);
      if (!/^\d+$/.test(v) || n < d.min || n > d.max) {
        throw userError_(d.label + ': ' + d.min + '~' + d.max + d.unit + ' 사이로 적어 주세요.');
      }
    }
    if (d.type === 'links') v = JSON.stringify(cleanLinks_(v));
    if (d.type === 'choice' && d.options.indexOf(v) < 0) throw userError_(d.label + josa_(d.label, '을', '를') + ' 다시 골라 주세요.');
    clean[d.key] = v;
  });
  var s1 = clean['1학기 시작일'] || setting_('1학기 시작일'), e1 = clean['1학기 끝일'] || setting_('1학기 끝일');
  var s2 = clean['2학기 시작일'] || setting_('2학기 시작일'), e2 = clean['2학기 끝일'] || setting_('2학기 끝일');
  if (s1 && e1 && s1 > e1) throw userError_('1학기 끝일이 시작일보다 앞에 있어요.');
  if (s2 && e2 && s2 > e2) throw userError_('2학기 끝일이 시작일보다 앞에 있어요.');
  Object.keys(clean).forEach(function (k) { putSetting_(k, clean[k], actor); });
  return adminSettingsGet_();
}

function isDate_(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  var d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}

function cleanLinks_(v) {
  var list;
  try { list = typeof v === 'string' ? JSON.parse(v || '[]') : v; } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  if (list.length > 12) throw userError_('바로가기는 12개까지 둘 수 있어요.');
  return list.filter(function (x) { return x && (x.name || x.url); }).map(function (x) {
    var name = cleanText_(x.name, 20, '바로가기 이름', true);
    var url = cleanText_(x.url, 500, '바로가기 주소', true);
    if (!/^https:\/\//.test(url)) throw userError_('바로가기 주소는 https:// 로 시작해야 해요.');
    return { name: name, url: url };
  });
}

// ---------------------------------------------------------------- 분류 (부서·자료 분류·도움말 분류)

function categoryKinds_() {
  return ['부서', '자료 분류', '도움말 분류'];
}

/** id → 이름 (사용 안 함 포함, 예전 자료에도 이름이 보이게) */
function categoryNames_(kind) {
  var m = {};
  try {
    readRows_('분류').forEach(function (r) {
      if (!kind || r['종류'] === kind) m[r['분류ID']] = r['이름'];
    });
  } catch (e) {
    if (e.code !== 'SETUP') throw e;
  }
  return m;
}

function adminCategoryList_() {
  var rows = liveRows_('분류');
  return categoryKinds_().map(function (kind) {
    return {
      kind: kind,
      items: rows.filter(function (r) { return r['종류'] === kind; })
        .sort(function (a, b) { return (Number(a['순서']) || 999) - (Number(b['순서']) || 999) || a['이름'].localeCompare(b['이름'], 'ko'); })
        .map(publicRow_)
    };
  });
}

function adminCategorySave_(args, actor) {
  var kind = String(args.kind || '');
  var name = cleanText_(args.name, 20, '분류 이름', true);
  var order = String(args.order === undefined || args.order === null ? '' : args.order).trim();
  if (order && !/^\d{1,3}$/.test(order)) throw userError_('순서는 숫자로 적어 주세요.');
  var rows = liveRows_('분류');
  if (args.id) {
    var row = rows.filter(function (r) { return r['분류ID'] === args.id; })[0];
    if (!row) throw userError_('분류를 찾지 못했어요. 화면을 새로 고쳐 주세요.');
    kind = row['종류'];
    if (rows.some(function (r) { return r['종류'] === kind && r['이름'] === name && r['분류ID'] !== args.id; })) {
      throw userError_('같은 이름의 ' + kind + '가 이미 있어요.');
    }
    var patch = { '이름': name };
    if (order) patch['순서'] = order;
    var summary = row['이름'] === name ? kind + ' "' + name + '" 고침' : kind + ' 이름 바꿈: ' + row['이름'] + ' → ' + name;
    return updateRow_('분류', args.id, patch, actor, summary);
  }
  if (categoryKinds_().indexOf(kind) < 0) throw userError_('분류 종류를 골라 주세요.');
  if (rows.some(function (r) { return r['종류'] === kind && r['이름'] === name; })) {
    throw userError_('같은 이름의 ' + kind + '가 이미 있어요.');
  }
  return insertRow_('분류', { '종류': kind, '이름': name, '순서': order, '사용 여부': '사용' }, actor, kind + ' "' + name + '" 추가');
}

function adminCategorySetActive_(args, actor) {
  var row = findRow_('분류', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('분류를 찾지 못했어요.');
  var v = args.active ? '사용' : '사용 안 함';
  return updateRow_('분류', row['분류ID'], { '사용 여부': v }, actor, row['종류'] + ' "' + row['이름'] + '" ' + v);
}

// ---------------------------------------------------------------- 교직원 표

function staffAdminView_(r, depts) {
  var o = publicRow_(r);
  o.hasPin = !!r['개인번호해시'];
  o.locked = (Number(r['잠금 해제 시각']) || 0) > Date.now();
  o.deptName = depts[r['부서ID']] || '';
  delete o['틀린 횟수'];
  delete o['잠금 해제 시각'];
  delete o['번호 바꾼 날'];
  return o;
}

function adminStaffList_() {
  var depts = categoryNames_('부서');
  return sortStaff_(liveRows_('교직원')).map(function (r) { return staffAdminView_(r, depts); });
}

function adminStaffSave_(args, actor) {
  var f = args.fields || {};
  var rec = {
    '이름': cleanText_(f['이름'], 20, '이름', true),
    '직위': cleanText_(f['직위'], 20, '직위'),
    '소속': cleanText_(f['소속'], 30, '소속'),
    '부서ID': cleanText_(f['부서ID'], 20, '부서'),
    '담당 업무': cleanText_(f['담당 업무'], 200, '담당 업무'),
    '내선': cleanText_(f['내선'], 15, '내선'),
    '역할': f['역할'] === '관리' ? '관리' : '일반',
    '순서': cleanText_(f['순서'], 4, '순서')
  };
  if (rec['내선'] && !/^[0-9\-]+$/.test(rec['내선'])) throw userError_('내선은 숫자와 - 만 적어 주세요. (개인 연락처는 넣지 않아요)');
  if (rec['순서'] && !/^\d+$/.test(rec['순서'])) throw userError_('순서는 숫자로 적어 주세요.');
  if (rec['부서ID'] && !categoryNames_('부서')[rec['부서ID']]) throw userError_('부서를 다시 골라 주세요.');
  var rows = liveRows_('교직원');
  var dup = rows.filter(function (r) {
    return r['이름'] === rec['이름'] && r['소속'] === rec['소속'] && r['교직원ID'] !== args.id;
  });
  if (dup.length) throw userError_('같은 이름과 소속의 교직원이 이미 있어요. 소속을 다르게 적어 구분해 주세요.');
  var depts = categoryNames_('부서');
  if (args.id) {
    var row = findRow_('교직원', args.id);
    if (!row || row['삭제 여부']) throw userError_('교직원을 찾지 못했어요. 화면을 새로 고쳐 주세요.');
    var saved = updateRow_('교직원', args.id, rec, actor, rec['이름'] + ' 선생님 정보 고침');
    return staffAdminView_(findRow_('교직원', saved['교직원ID']), depts);
  }
  rec['사용 여부'] = '사용';
  rec['틀린 횟수'] = '0';
  var added = insertRow_('교직원', rec, actor, rec['이름'] + ' 선생님 추가');
  return staffAdminView_(findRow_('교직원', added['교직원ID']), depts);
}

function adminStaffSetActive_(args, actor) {
  var row = findRow_('교직원', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('교직원을 찾지 못했어요.');
  var v = args.active ? '사용' : '사용 안 함';
  updateRow_('교직원', row['교직원ID'], { '사용 여부': v }, actor, row['이름'] + ' 선생님 ' + v);
  return staffAdminView_(findRow_('교직원', row['교직원ID']), categoryNames_('부서'));
}

function adminStaffResetPin_(args, actor) {
  return withLock_(function () {
    var row = findRow_('교직원', String(args.id || ''));
    if (!row || row['삭제 여부']) throw userError_('교직원을 찾지 못했어요.');
    if (row['사용 여부'] === '사용 안 함') throw userError_('사용 안 함인 분은 번호를 만들 수 없어요. 먼저 "다시 사용"으로 바꿔 주세요.');
    var pin = assignPin_(row, actor);
    return { name: row['이름'], group: row['소속'], position: row['직위'], pin: pin };
  });
}

/** 번호가 없는 사용 중인 분 모두에게 번호를 만든다. 종이로 나눠 줄 목록을 한 번만 돌려준다. */
function adminStaffIssueMissing_(args, actor) {
  return withLock_(function () {
    var list = [];
    sortStaff_(liveRows_('교직원')).forEach(function (row) {
      if (row['사용 여부'] === '사용 안 함' || row['개인번호해시']) return;
      list.push({ name: row['이름'], group: row['소속'], position: row['직위'], pin: assignPin_(row, actor) });
    });
    return list;
  });
}

function adminStaffUnlock_(args, actor) {
  return withLock_(function () {
    var row = findRow_('교직원', String(args.id || ''));
    if (!row || row['삭제 여부']) throw userError_('교직원을 찾지 못했어요.');
    setCellsNoLog_('교직원', row, { '틀린 횟수': '0', '잠금 해제 시각': '' });
    writeLog_(actor, '교직원', row['교직원ID'], '잠금 풀기', row['이름'] + ' 선생님 잠금 풀어 줌', null, null);
    return staffAdminView_(row, categoryNames_('부서'));
  });
}

// ---------------------------------------------------------------- 수정 기록

function adminLogList_(args) {
  var tab = String(args.tab || '');
  var rows = readRows_('기록');
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < 200; i--) {
    var r = rows[i];
    if (tab && r['탭'] !== tab) continue;
    out.push({
      time: r['시각'], who: r['이름'], tab: r['탭'], target: r['대상ID'], action: r['동작'], summary: r['요약'],
      before: safeJson_(r['바뀌기 전']), after: safeJson_(r['바뀐 뒤'])
    });
  }
  return out;
}

function safeJson_(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------------------------------------------------------------- 비밀번호 바꾸기 (관리자 화면)

function adminChangeCommonPw_(args, actor) {
  if (args.newPw !== args.newPw2) throw userError_('새 비밀번호 두 칸이 서로 달라요.');
  setPassword_('common', args.newPw);
  withLock_(function () { writeLog_(actor, '설정', '', '비밀번호 바꿈', '공통 비밀번호를 바꿈(모든 기기 다시 로그인)', null, null); });
  return { done: true };
}

function adminChangeAdminPw_(args, actor) {
  if (!checkPassword_('admin', args.current)) throw userError_('지금 관리자 비밀번호가 맞지 않아요.');
  if (args.newPw !== args.newPw2) throw userError_('새 비밀번호 두 칸이 서로 달라요.');
  setPassword_('admin', args.newPw);
  withLock_(function () { writeLog_(actor, '설정', '', '비밀번호 바꿈', '관리자 비밀번호를 바꿈', null, null); });
  return { done: true };
}
