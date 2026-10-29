/**
 * Admin.gs — 설정·분류·교직원 표·수정 기록 (관리자 화면)
 */

function fileMark_Admin_() { return '2026-10-28a'; } // 판 표시(관리자 › 점검)

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
    { key: '잠금 횟수', def: '5', type: 'int', min: 3, max: 10, label: '관리자 비밀번호·개인 번호를 몇 번 틀리면 잠글까요', unit: '번', note: '관리자 비밀번호와(이름+개인 번호 방식이면) 개인 번호에 써요' },
    { key: '잠금 분', def: '10', type: 'int', min: 1, max: 120, label: '잠그는 시간', unit: '분', note: '관리자 비밀번호와(이름+개인 번호 방식이면) 개인 번호에 써요' },
    { key: '백업 남길 개수', def: '30', type: 'int', min: 3, max: 365, label: '매일 백업을 몇 개까지 남길까요', unit: '개' },
    { key: '기존 시트 바로가기', def: '[]', type: 'links', label: "홈의 '아직 기존 시트에서 하는 일' 바로가기", note: '홈 화면 아래에 보여요' },
    { key: '파일 크기 한도', def: '10', type: 'int', min: 1, max: 20, label: '자료실에 올릴 수 있는 파일 크기', unit: 'MB', note: '확인 필요: 학교 PC·휴대폰에서 실제로 올려 보기 전까지는 20MB까지만 골라요. 더 큰 파일은 드라이브 링크로 넣어요' }, // 최대는 Library.gs fileLimitMb_와 같게
    // 값은 스크립트 속성 TABLE_UI_INLINE에 둔다(웹앱을 열 때 시트를 열지 않고 읽으려고, Code.gs tableUiTag_). 설정 탭에는 기록용으로 함께 적는다
    { key: '취합 시트 화면 파일', def: '열 때 받기', type: 'choice', options: ['열 때 받기', '처음에 함께'], label: '취합 시트 화면 파일',
      note: "'열 때 받기'는 웹앱 첫 화면이 가벼워지고 취합 시트를 처음 열 때 화면 파일을 받아요. 취합 시트가 열리지 않으면 '처음에 함께'로 바꿔 예전처럼 써요(확인 필요). 바꾼 뒤에는 웹앱을 새로 고쳐 주세요" },
    { key: '회의록 맨 위 칸', def: '교장 선생님, 교감 선생님', type: 'text', max: 100, optional: true, label: '회의록 맨 위 칸', note: '회의를 만들 때 부서 칸 위에 나오는 칸이에요. 쉼표로 나눠 적어요(비우면 부서 칸만). 이미 만든 회의는 그대로예요' },
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
      var col = headOf_('설정').indexOf('값') + 1; // 칸 위치는 머리글 이름으로(누가 칸을 끼워 넣어도)
      if (col < 1) throw userError_("설정 탭에 '값' 칸이 없어요. 전용 시트 메뉴 '1. 처음 설정'을 눌러 주세요.", 'SETUP');
      sh.getRange(row._row, col).setValue(cellWrite_(value));
    } else {
      var def = settingDefs_().filter(function (d) { return d.key === key; })[0];
      sh.appendRow(rowByHead_('설정', { '키': key, '값': value, '설명': def ? (def.note || def.label) : '' }));
    }
    dirty_('설정');
    writeLog_(actor, '설정', key, '수정', key + ' 바꿈', { '값': before }, { '값': String(value) });
  });
  SETTINGS_CACHE_ = null;
}

function adminSettingsGet_() {
  var m = settingsMap_();
  var list = settingDefs_().map(function (d) {
    var v = d.key === '취합 시트 화면 파일' ? (tableUiInline_() ? '처음에 함께' : '열 때 받기') : m[d.key]; // 스크립트 속성이 진짜 값
    return { key: d.key, label: d.label, type: d.type, note: d.note || '', unit: d.unit || '', min: d.min, max: d.max, options: d.options, value: v };
  });
  // 학기 기간: 학년도마다 따로('학기' 탭, 2026-10-19 교사 결정). 지금 학년도와 다음 학년도를 함께 보여 준다
  var sy = Number(m['학년도']) || schoolYearOf_(todayYmd_());
  list.push({ key: '학기 기간', label: '학기 기간', type: 'semesters', value: [semesterView_(sy), semesterView_(sy + 1)] });
  // 마지막 백업 시각(손 백업도 폴더가 생겨 '폴더가 있으면 켜짐'으로 보면 틀리므로 마지막 백업 때로 본다, 2026-10-28a)
  list.push({ key: '마지막 백업', label: '마지막 백업', type: 'readonly', value: Number(PropertiesService.getScriptProperties().getProperty('LAST_BACKUP_AT') || 0) });
  return list;
}

function adminSettingsSave_(args, actor) {
  var values = args.values || {};
  var defs = settingDefs_();
  var clean = {};
  if ('학년도' in values && String(values['학년도']).trim() !== String(setting_('학년도'))) {
    // 학년도만 바꾸면 자료실 자료가 모두 보관함으로 간다 → 자료를 옮겨 적는 '새 학년도'에서만 바꾼다
    throw userError_("학년도는 관리자 › 새 학년도에서 바꿔요(지금 학년도 자료를 보관하고 고른 자료를 옮겨 적는 일과 함께 해요).");
  }
  defs.forEach(function (d) {
    if (!(d.key in values) || d.type === 'readonly') return;
    var v = values[d.key] === null || values[d.key] === undefined ? '' : String(values[d.key]).trim();
    if (d.type === 'text') v = cleanText_(v, d.max || 40, d.label, !d.optional); // optional: 비워도 됨(회의록 맨 위 칸)
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
  if (e1 && s2 && e1 >= s2) throw userError_('1학기 끝일은 2학기 시작일보다 앞이어야 해요(겹치면 수업일수를 두 번 세요).');
  if (args.semesters) saveSemesters_(args.semesters, actor); // 학년도마다 학기 기간(먼저 확인하고 저장한다)
  Object.keys(clean).forEach(function (k) { putSetting_(k, clean[k], actor); });
  if ('취합 시트 화면 파일' in clean && (clean['취합 시트 화면 파일'] === '처음에 함께') !== tableUiInline_()) {
    props_().setProperty('TABLE_UI_INLINE', clean['취합 시트 화면 파일'] === '처음에 함께' ? '1' : '');
  }
  return adminSettingsGet_();
}

/** 취합 시트 화면 파일을 처음에 함께 넣는지(스크립트 속성 TABLE_UI_INLINE, Code.gs tableUiTag_) */
function tableUiInline_() {
  try { return props_().getProperty('TABLE_UI_INLINE') === '1'; } catch (e) { return false; }
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
  return ['부서', '자료 분류', '도움말 분류', '회의 종류']; // 회의 종류: 회의록(2026-10-22a), 처음에는 부장회의·교직원회의
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

/** 휴대폰 번호 같은지(010-1234-5678·01012345678 등). 내선은 모두에게 보이니 개인 연락처가 들어가지 않게 */
function looksPhone_(s) {
  var d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 && /^0?1[016789]/.test(d);
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
  if (looksPhone_(rec['내선'])) throw userError_('휴대폰 번호 같아요. 내선 칸은 모든 선생님께 보여서 학교 내선만 적어 주세요.');
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
  var patch = { '사용 여부': v };
  if (!args.active) patch['번호 바꾼 날'] = String(Date.now()); // 이 분의 기억된 본인 확인을 끊는다(다시 사용으로 바꿔도 옛 기기는 이름을 다시 골라야)
  updateRow_('교직원', row['교직원ID'], patch, actor, row['이름'] + ' 선생님 ' + v);
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

/** 수정 기록 거르기: 화면 이름 하나가 탭 여러 개인 것(취합 시트 = 표 + 줄) */
var LOG_TAB_GROUPS_ = { '취합 시트': ['함께표', '함께표줄'], '회의록': ['회의', '회의내용'] };

/**
 * 수정 기록(최근 것부터 200개). args = { tab, q(찾는 말), from, to(날짜) }
 * 기록은 계속 늘어서 끝에서 5000줄씩 거슬러 읽는다. 거르기·찾기가 있으면 4만 줄까지 거슬러 찾는다(취합 시트를 많이 고쳐도 설정·교직원 기록을 찾게, 2026-10-28a)
 */
function adminLogList_(args) {
  var tab = String(args.tab || ''), q = String(args.q || '').replace(/\s+/g, ' ').trim().toLowerCase();
  var from = isDate_(args.from) ? String(args.from) : '', to = isDate_(args.to) ? String(args.to) : '';
  var want = LOG_TAB_GROUPS_[tab] || (tab ? [tab] : null);
  var total = Math.max(0, sheet_('기록').getLastRow() - 1), CHUNK = 5000, MAX = want || q || from || to ? 40000 : CHUNK;
  var out = [], scanned = 0, done = false;
  while (!done && out.length < 200 && scanned < total && scanned < MAX) {
    var rows = tailRows_('기록', CHUNK, scanned);
    scanned += CHUNK;
    for (var i = rows.length - 1; i >= 0 && out.length < 200; i--) {
      var r = rows[i], day = String(r['시각'] || '').slice(0, 10);
      if (from && day && day < from) { done = true; break; } // 기록은 시각 차례로 쌓이므로 더 앞은 볼 필요가 없다
      if (to && day > to) continue;
      if (want && want.indexOf(r['탭']) < 0) continue;
      if (q && [r['요약'], r['이름'], r['대상ID'], r['동작'], r['바뀌기 전'], r['바뀐 뒤']].join(' ').toLowerCase().indexOf(q) < 0) continue;
      out.push({
        time: r['시각'], who: r['이름'], tab: r['탭'], target: r['대상ID'], action: r['동작'], summary: r['요약'],
        before: safeJson_(r['바뀌기 전']), after: safeJson_(r['바뀐 뒤'])
      });
    }
  }
  return { items: out, scanned: Math.min(scanned, total), total: total, more: !done && out.length < 200 && scanned < total };
}

function safeJson_(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------------------------------------------------------------- 비밀번호 바꾸기 (관리자 화면)

function adminChangeCommonPw_(args, actor) {
  if (args.newPw !== args.newPw2) throw userError_('새 비밀번호 두 칸이 서로 달라요.');
  setPassword_('common', args.newPw);
  PropertiesService.getScriptProperties().setProperty('COMMON_PW_AT', nowText_()); // 마지막으로 바꾼 때(새 학년도 준비 점검, 기록이 많아도 찾게)
  withLock_(function () { writeLog_(actor, '설정', '', '비밀번호 바꿈', '공통 비밀번호를 바꿈(모든 기기 다시 로그인)', null, null); });
  return { done: true };
}

function adminChangeAdminPw_(args, actor) {
  checkAdminPwCounted_(args.current, actor); // 틀린 횟수를 세어 여러 번 틀리면 잠근다(관리자 들어가기와 같이)
  if (args.newPw !== args.newPw2) throw userError_('새 비밀번호 두 칸이 서로 달라요.');
  setPassword_('admin', args.newPw);
  withLock_(function () { writeLog_(actor, '설정', '', '비밀번호 바꿈', '관리자 비밀번호를 바꿈', null, null); });
  return { done: true };
}

// ---------------------------------------------------------------- 점검 (관리자): 파일·시트·비밀번호·백업·설정을 한 번에

/**
 * args.client = { app, styles, index, table } : 화면 파일의 판 표시(화면이 보낸다. table: 취합 시트 화면 TableUi.html,
 *   'lazy'면 화면 파일을 아직 받지 않은 것(열 때 받기, 2026-10-19a) → 서버에 있는 파일의 판으로 본다)
 * 돌려주는 값: { build, at, items: [{ group, label, state: 'ok'|'warn'|'bad', detail, fix }] }
 */
function adminCheck_(args) {
  var items = [];
  var add = function (group, label, state, detail, fix) { items.push({ group: group, label: label, state: state, detail: detail || '', fix: fix || '' }); };
  var paste = function (f) { return "설치안내 표의 '" + f + "' 파일을 Copy raw file로 다시 붙여 넣고, 배포 관리 → 새 버전으로 배포해 주세요"; };

  // 1) 코드 파일(빠진 파일·예전 파일). 파일마다 있어야 할 판은 Code.gs의 fileBuilds_() 표에 있다
  var buildsFn = globalFn_('fileBuilds_');
  var builds = buildsFn ? buildsFn() : {};
  var want = function (f) { return builds[f] || APP_BUILD_; };
  // 판 표시가 없어도 이 파일의 함수가 있으면 판 표시를 넣기 전(2026-10-15)의 예전 파일이다
  var probe = { 'Code': 'api', 'Db': 'sheetValues_', 'Auth': 'checkLogin_', 'Admin': 'adminCheck_', 'Schedule': 'apiSchedMonth_',
    'Survey': 'apiSurveyList_', 'Library': 'apiLibList_', 'Help': 'apiHelpList_', 'Setup': 'setupAll_', 'Table': 'apiTableList_', 'Meeting': 'apiMeetList_' };
  ['Code', 'Db', 'Auth', 'Admin', 'Schedule', 'Survey', 'Library', 'Help', 'Setup', 'Table', 'Meeting'].forEach(function (f) {
    var mark = globalFn_('fileMark_' + f + '_');
    if (!mark && globalFn_(probe[f])) add('코드 파일', f + '.gs', 'warn', '판 표시가 없는 예전 파일이에요(기능은 돌아가요)', paste(f));
    else if (!mark && f === 'Meeting') add('코드 파일', 'Meeting.gs', 'bad', '파일이 없어요(회의록)', "Apps Script 편집기에서 + → 스크립트로 'Meeting' 파일을 새로 만들고, 설치안내 표의 'Meeting' 파일을 Copy raw file로 붙여 넣어 주세요");
    else if (!mark) add('코드 파일', f + '.gs', 'bad', '파일이 없거나 내용이 비어 있어요', paste(f));
    else if (f === 'Code' && !buildsFn) add('코드 파일', 'Code.gs', 'warn', '예전 판이에요(' + mark() + ')', paste(f));
    else if (mark() !== want(f)) add('코드 파일', f + '.gs', 'warn', '예전 판이에요(' + mark() + ')', paste(f));
    else add('코드 파일', f + '.gs', 'ok', '최신 판 ' + mark());
  });
  var c = (args && args.client) || {};
  var tableBuild = c.table, tableOld = false;
  if (tableBuild === 'lazy') { // 서버의 파일을 직접 본다: 없으면 null, 판 표시가 없는 예전 파일이면 ''
    var fb = globalFn_('tableUiFileBuild_'), b0 = fb ? fb() : null;
    tableBuild = b0 || '';
    tableOld = b0 === '';
  }
  [['App.html', c.app], ['Styles.html', c.styles], ['Index.html', c.index], ['TableUi.html', tableBuild]].forEach(function (x) {
    var f = x[0].replace('.html', '');
    if (!x[1] && f === 'TableUi' && !tableOld) add('코드 파일', x[0], 'bad', '파일이 없어요(취합 시트 화면)', "Apps Script 편집기에서 + → HTML로 'TableUi' 파일을 새로 만들고, 설치안내 표의 'TableUi' 파일을 Copy raw file로 붙여 넣어 주세요");
    else if (!x[1]) add('코드 파일', x[0], 'warn', '판 표시를 찾지 못했어요(예전 파일일 수 있어요)', paste(f));
    else if (x[1] !== want(f)) add('코드 파일', x[0], 'warn', '예전 판이에요(' + x[1] + ')', paste(f));
    else add('코드 파일', x[0], 'ok', '최신 판 ' + x[1]);
  });
  var routes = routes_(), missing = [], n = 0;
  Object.keys(routes).forEach(function (k) {
    if (typeof routes[k].fn !== 'string') return;
    n++;
    if (!globalFn_(routes[k].fn)) missing.push(routes[k].fn);
  });
  if (missing.length) add('코드 파일', '기능 연결', 'bad', '찾지 못한 기능 ' + missing.length + '개: ' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' …' : ''), '위에서 문제로 나온 파일을 다시 붙여 넣어 주세요');
  else add('코드 파일', '기능 연결', 'ok', '기능 ' + n + '개가 모두 연결됐어요');

  // 2) 시트 탭·칸 (나중에 더한 탭·칸 중 처음 쓸 때 저절로 생기는 것은 없어도 괜찮다)
  var tabs = tabs_(), bad = 0;
  var autoTabs = { '학생수': '학생 수를 처음 넣을 때 저절로 생겨요', '함께표': '취합 시트를 처음 만들 때 저절로 생겨요', '함께표줄': '취합 시트를 처음 만들 때 저절로 생겨요',
    '시트양식': '취합 시트의 양식을 처음 저장할 때 저절로 생겨요', '학기': '학기 기간을 처음 넣을 때 저절로 생겨요(그 전에는 예전 설정 값을 써요)',
    '회의': '회의록을 처음 만들 때 저절로 생겨요', '회의내용': '회의록을 처음 만들 때 저절로 생겨요' }, notYet = 0;
  var autoCols = { // 저장할 때 ensureCols_가 붙이는 칸
    '학생수': { cols: ['반별'], when: '학생 수를 저장할 때' },
    '일정': { cols: ['중요'], when: '일정을 저장할 때' },
    '자료': { cols: ['파일 이름', '파일 크기', '홈에 보이기', '원본 자료ID', '공통', '공통 순서'], when: '자료를 저장할 때' },
    '도움말': { cols: ['파일ID', '파일 이름', '파일 크기'], when: '도움말을 저장할 때' },
    '조사': { cols: ['설명', '결과 공개'], when: '조사를 저장할 때' },
    '함께표': { cols: ['문서ID', '시트 이름', '시트 순서', '보기', '시트 지움', '문서 판'], when: '취합 시트를 저장할 때' },
    '함께표줄': { cols: ['서식', '높이'], when: '취합 시트에 서식을 넣을 때' }
  };
  Object.keys(tabs).forEach(function (tab) {
    var head;
    try { head = headRowOnly_(tab); } catch (e) {
      if (autoTabs[tab]) { notYet++; add('시트', tab + ' 탭', 'ok', '아직 없어요 · ' + autoTabs[tab]); return; }
      bad++;
      add('시트', tab + ' 탭', 'bad', '탭이 없어요', "전용 시트 메뉴 '온라인 교무실 → 1. 처음 설정'을 눌러 주세요");
      return;
    }
    var miss = tabs[tab].filter(function (h) { return head.indexOf(h) < 0; });
    var auto = autoCols[tab] ? miss.filter(function (h) { return autoCols[tab].cols.indexOf(h) >= 0; }) : [];
    var rest = miss.filter(function (h) { return auto.indexOf(h) < 0; });
    if (rest.length) { bad++; add('시트', tab + ' 탭', 'warn', '칸이 없어요: ' + rest.join(', '), "전용 시트 메뉴 '1. 처음 설정'을 한 번 더 눌러 주세요(있는 데이터는 그대로예요)"); }
    else if (auto.length) {
      add('시트', tab + ' 탭', 'ok', auto.map(function (h) { return "'" + h + "'"; }).join('·') + ' 칸은 ' + autoCols[tab].when + ' 저절로 생겨요');
    }
  });
  if (!bad) add('시트', '탭과 칸', 'ok', '탭 ' + (Object.keys(tabs).length - notYet) + '개와 칸이 모두 있어요');
  try {
    var vals = sheetValues_('교직원');
    var blank = 0;
    for (var i = 1; i < vals.length; i++) if (!vals[i].some(function (v) { return String(v) !== ''; })) blank++;
    if (blank) add('시트', '교직원 탭 빈 줄', 'warn', '시트에서 직접 비운 줄이 ' + blank + '개 있어요. 앱은 건너뛰지만 기록에는 남지 않았어요', "앞으로는 줄을 지우지 말고 웹앱 교직원 표에서 '사용 안 함'으로 바꿔 주세요");
  } catch (e) { /* 탭이 없으면 위에서 알렸다 */ }

  // 3) 비밀번호
  add('비밀번호', '공통 비밀번호', hasPassword_('common') ? 'ok' : 'bad', hasPassword_('common') ? '정해져 있어요' : '아직 없어요', "전용 시트 메뉴 '2. 공통 비밀번호 정하기'");
  add('비밀번호', '관리자 비밀번호', hasPassword_('admin') ? 'ok' : 'bad', hasPassword_('admin') ? '정해져 있어요' : '아직 없어요', "전용 시트 메뉴 '3. 관리자 비밀번호 정하기'");
  var lf = globalFn_('loginFails_') ? loginFails_() : { n: 0 };
  var lfMax = typeof LOGIN_FAIL_MAX_ === 'number' ? LOGIN_FAIL_MAX_ : 20;
  add('비밀번호', '로그인 시도', lf.n >= lfMax ? 'warn' : 'ok',
    lf.n ? '최근 15분 동안 공통 비밀번호를 ' + lf.n + '번 틀렸어요' + (lf.n >= lfMax ? ' · 새 로그인을 잠시 막았어요(로그인된 기기는 그대로)' : '') : '최근 15분 동안 틀린 로그인이 없어요',
    lf.n >= lfMax ? '모르는 사람이 비밀번호를 맞춰 보는 중일 수 있어요. 공통 비밀번호를 더 길게 바꾸는 것을 생각해 주세요(관리자 › 비밀번호)' : '');

  // 4) 매일 백업
  var trig = null;
  try { trig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; }); } catch (e) { trig = null; }
  var last = Number(PropertiesService.getScriptProperties().getProperty('LAST_BACKUP_AT') || 0);
  var lastText = last ? Utilities.formatDate(new Date(last), tz_(), 'yyyy-MM-dd HH:mm') : '없음';
  if (trig === null) add('백업', '매일 자동 백업', 'warn', '켜져 있는지 확인하지 못했어요 · 마지막 백업 ' + lastText, "전용 시트 메뉴 '4. 매일 자동 백업 켜기'를 한 번 눌러 두면 확실해요");
  else if (!trig) add('백업', '매일 자동 백업', 'warn', '꺼져 있어요 · 마지막 백업 ' + lastText, "전용 시트 메뉴 '4. 매일 자동 백업 켜기'");
  else if (!last || Date.now() - last > 2 * 86400000) add('백업', '매일 자동 백업', 'warn', '켜져 있지만 마지막 백업이 ' + lastText + '예요', "백업 폴더를 확인하고, 이상하면 '4. 매일 자동 백업 켜기'를 다시 눌러 주세요");
  else add('백업', '매일 자동 백업', 'ok', '켜져 있어요 · 마지막 백업 ' + lastText);

  // 5) 속도: 서버 기억(CacheService). 시트를 손으로 고친 것을 onEdit가 알아챘는지(마지막 시각)도 보여 준다
  var memoOk = false;
  try {
    var cache = memoCache_();
    if (cache) { cache.put('gy:check', '1', 60); memoOk = cache.get('gy:check') === '1'; }
  } catch (e) { memoOk = false; }
  var editAt = Number(PropertiesService.getScriptProperties().getProperty('SHEET_EDIT_AT') || 0);
  var editText = editAt ? '바로 알아채요(마지막 ' + Utilities.formatDate(new Date(editAt), tz_(), 'M월 d일 HH:mm') + ')'
    : '아직 없어요(시트에서 칸 하나를 고쳤다 되돌린 뒤 다시 점검하면, 바로 알아채는지 여기 보여요)';
  add('속도', '서버 기억', memoOk ? 'ok' : 'warn', memoOk ? '켜져 있어요 · 시트를 손으로 고친 것: ' + editText : '쓸 수 없어서 늘 시트에서 읽어요(느릴 수 있어요)',
    memoOk ? '' : '잠시 뒤 다시 점검해 주세요. 계속 이러면 알려 주세요');

  // 6) 설정
  var semYear = Number(setting_('학년도')) || schoolYearOf_(todayYmd_());
  var semOk = semesters_(semYear).length === 2;
  add('설정', '학기 기간', semOk ? 'ok' : 'warn', semOk ? semYear + '학년도 1·2학기 기간이 들어 있어요' : semYear + '학년도에 비어 있는 학기가 있어 수업일수를 다 세지 못해요', '관리자 › 설정 › 학기 기간에 1·2학기 시작일·끝일을 넣어 주세요');
  var days = rememberDays_();
  add('설정', '기기 기억 기간', days >= 365 ? 'ok' : 'warn', days + '일', days >= 365 ? '' : "정한 값은 365일이에요. 관리자 › 설정에서 바꿔 주세요");
  add('설정', '본인 확인 방식', 'ok', pinMode_() ? '이름+개인 번호' : "이름만 (관리 일은 관리자 화면을 연 기기에서만)");

  // 7) 교직원·분류
  var staff = activeStaff_();
  var depts = categoryNames_('부서');
  var noDept = staff.filter(function (r) { return !depts[r['부서ID']]; }).length;
  add('교직원', '사용 중인 교직원', staff.length ? 'ok' : 'bad', staff.length + '명', staff.length ? '' : '관리자 › 교직원 표에서 넣거나 "명단 한 번에 넣기"를 써 주세요');
  if (noDept) add('교직원', '부서 없는 분', 'warn', noDept + '명', '교직원 표에서 부서를 골라 주세요(내 담당·조사 대상에 쓰여요)');

  // 8) 시트 크기(구글 시트 한 파일의 칸 수 한도: 구글 안내 기준 1,000만 칸, 확인 필요) · 기록 탭
  var sz = sheetSizes_(), pct = Math.round(sz.total / SHEET_CELL_LIMIT_ * 1000) / 10, spare = 0;
  sz.list.forEach(function (x) { spare += Math.max(0, x.cols - Math.max(x.lastCol, x.head)) * x.rows; });
  add('시트', '전체 칸 수', pct >= 70 ? 'warn' : 'ok', numKo_(sz.total) + '칸 · 한도 1,000만 칸의 ' + pct + '%' + (spare ? ' · 빈 열 ' + numKo_(spare) + '칸' : ''),
    pct >= 70 ? "점검 화면 아래 '빈 열 지우기'를 누르고, 그래도 크면 지난 학년도 응답·기록을 다른 시트로 옮겨 주세요(확인 필요)" : '');
  var lg = sz.list.filter(function (x) { return x.name === '기록'; })[0];
  if (lg) add('시트', '기록 탭', lg.last > 200000 ? 'warn' : 'ok', numKo_(Math.max(0, lg.last - 1)) + '줄', lg.last > 200000 ? '기록이 아주 많아요. 오래된 기록은 시트 사본에 옮겨 두면 가벼워져요(확인 필요)' : '');
  // 9) 최근 서버 오류(예상 못 한 오류만, 6시간 안)
  var errs = [];
  try { errs = JSON.parse(CacheService.getScriptCache().get('gy:errs') || '[]'); } catch (e) { errs = []; }
  add('서버 오류', '최근 6시간', errs.length ? 'warn' : 'ok', errs.length ? errs.length + '번 · ' + errs.slice(0, 5).map(function (x) { return x.at.slice(11, 16) + ' ' + x.action + (x.who ? '(' + x.who + ')' : '') + ' ' + x.detail; }).join(' / ') : '없어요',
    errs.length ? '같은 오류가 되풀이되면 그 줄을 복사해 관리하는 분께 알려 주세요' : '');
  return { build: APP_BUILD_, at: nowText_(), items: items, errors: errs, spare: spare };
}

// ---------------------------------------------------------------- 속도 재기 (관리자 › 점검)

/**
 * 자주 여는 화면을 서버 안에서 불러 보며 시간을 잰다(쓰지는 않는다).
 * 화면마다 두 번: 시트에서 읽을 때(서버 기억을 쓰지 않음)와 서버 기억에서 읽을 때.
 * 서버를 다녀오는 왕복 시간은 화면이 'ping'으로 따로 잰다
 */
function adminSpeed_(args, actor, ctx) {
  var t = todayYmd_();
  var list = [ // [이름, 요청, 처리 함수, args]
    ['홈', 'home', 'apiHome_', {}],
    ['일정(달력)', 'sched.month', 'apiSchedMonth_', { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) }],
    ['조사·신청', 'survey.list', 'apiSurveyList_', {}],
    ['자료실', 'lib.list', 'apiLibList_', {}],
    ['공지', 'notice.list', 'apiNoticeList_', {}],
    ['도움말', 'help.list', 'apiHelpList_', {}],
    ['교직원', 'staff.list', 'apiStaffDir_', {}]
  ];
  var preload = globalFn_('memoPreload_'), tabsOf = globalFn_('routeTabs_');
  var once = function (fn, x, bypass) {
    SETTINGS_CACHE_ = null;
    DB_SS_ = null;
    dbReset_(); // 화면마다 처음부터(앞 화면이 읽어 둔 탭을 쓰지 않게)
    delete ctx.manage; // 관리 권한도 요청마다 처음 따지는 것처럼
    PERF_ = newPerf_();
    MEMO_BYPASS_ = bypass;
    var t0 = Date.now();
    try {
      if (!bypass && preload && tabsOf) preload(tabsOf(x[1], x[3])); // 실제 요청처럼 읽을 탭을 한 번에 꺼낸다
      fn(x[3], actor, ctx);
    } finally {
      MEMO_BYPASS_ = false;
    }
    var ms = Date.now() - t0;
    return { ms: ms, openMs: PERF_.openMs, reads: PERF_.reads, readMs: PERF_.readMs, hits: PERF_.hits, memoMs: PERF_.memoMs,
      memoCalls: PERF_.memoCalls || 0, otherMs: Math.max(0, ms - PERF_.openMs - PERF_.readMs - PERF_.memoMs) };
  };
  var items = list.map(function (x) {
    var fn = globalFn_(x[2]);
    if (!fn) return { label: x[0], error: '코드 파일이 빠졌어요' };
    try {
      once(fn, x, false); // 기억이 비어 있으면 채워 둔다
      return { label: x[0], sheet: once(fn, x, true), memo: once(fn, x, false) };
    } catch (e) {
      return { label: x[0], error: String(e && e.message || e).slice(0, 120) };
    }
  });
  return { at: nowText_(), items: items, memoOn: !!memoCache_() };
}

/** 관리자 › 점검 '시트 새로 읽기': 서버 기억을 모두 버린다(시트를 손으로 고친 뒤 바로 보이게) */
var SHEET_CELL_LIMIT_ = 10000000; // 구글 시트 한 파일의 칸 수 한도(구글 안내 기준, 확인 필요)
function numKo_(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
/** 탭마다 줄·열 수(빈 줄·열 포함)와 글이 있는 끝 */
function sheetSizes_() {
  var total = 0, list = [];
  ss_().getSheets().forEach(function (sh) {
    var r = sh.getMaxRows(), c = sh.getMaxColumns(), name = sh.getName(), head = (tabs_()[name] || []).length;
    total += r * c;
    list.push({ name: name, rows: r, cols: c, last: sh.getLastRow(), lastCol: sh.getLastColumn(), head: head });
  });
  return { total: total, list: list };
}
/** 빈 열 지우기: 온라인 교무실 탭에서 머리글·글이 없는 오른쪽 열만 지운다(새 탭은 26열로 생겨 기록 탭 등에 빈 열이 많다) */
function adminSheetTrim_(args, actor) {
  var cut = 0, tabs = tabs_();
  withLock_(function () {
    ss_().getSheets().forEach(function (sh) {
      var name = sh.getName();
      if (!tabs[name]) return; // 손으로 만든 탭은 건드리지 않는다
      var keep = Math.max(sh.getLastColumn(), tabs[name].length, 1), c = sh.getMaxColumns();
      if (c > keep) { sh.deleteColumns(keep + 1, c - keep); cut += (c - keep) * sh.getMaxRows(); }
    });
    writeLog_(actor, '설정', '', '정리', '빈 열 지우기: ' + numKo_(cut) + '칸', null, null);
  });
  return { cut: cut };
}

function adminCacheClear_(args, actor) {
  var ok = memoClearAll_();
  withLock_(function () { writeLog_(actor, '설정', '', '기억 비움', '서버 기억을 비움(시트에서 새로 읽기)', null, null); });
  return { done: ok };
}

// ---------------------------------------------------------------- 교직원 명단 한 번에 넣기 (관리자)

function staffImportHeads_() {
  return {
    name: ['이름', '성명'], position: ['직위', '직급', '직'], group: ['소속', '학년반', '학년·반', '담임'],
    dept: ['부서', '담당 부서', '소속 부서'], duty: ['담당 업무', '업무', '담당업무', '맡은 일'],
    ext: ['내선', '내선번호', '내선 번호'], role: ['역할'], order: ['순서', '번호', '순번']
  };
}

/** 칸 목록 → 줄 목록(앞 5줄 안에서 머리글을 찾고, 없으면 cols 순서로) */
function gridRowsBy_(grid, heads, cols, must) {
  var map = null, startAt = 0;
  for (var i = 0; i < Math.min(5, grid.length) && !map; i++) {
    var m = {};
    (grid[i] || []).forEach(function (cell, j) {
      var h = normHead_(cell);
      Object.keys(heads).forEach(function (k) {
        if (m[k] === undefined && heads[k].some(function (a) { return normHead_(a) === h; })) m[k] = j;
      });
    });
    if (must.every(function (k) { return m[k] !== undefined; })) { map = m; startAt = i + 1; }
  }
  if (!map) { map = {}; cols.forEach(function (k, j) { map[k] = j; }); }
  var rows = [];
  for (var r = startAt; r < grid.length; r++) {
    var line = grid[r] || [];
    if (!line.some(function (c) { return String(c || '').trim(); })) continue;
    var o = {};
    cols.forEach(function (k) { o[k] = map[k] === undefined ? '' : String(line[map[k]] === undefined || line[map[k]] === null ? '' : line[map[k]]).trim(); });
    rows.push(o);
  }
  return rows;
}

function staffImportCheck_(rows) {
  var deptIds = {};
  catOptions_('부서').forEach(function (d) { var k = normHead_(d.name); deptIds[k] = d.id; deptIds[k.replace(/부$/, '')] = deptIds[k.replace(/부$/, '')] || d.id; });
  var names = categoryNames_('부서');
  var have = {};
  liveRows_('교직원').forEach(function (r) { have[r['이름'] + '|' + r['소속']] = true; });
  var seen = {};
  return rows.map(function (raw, i) {
    var msgs = [], status = 'ok', dup = '';
    var warn = function (t) { msgs.push(t); if (status === 'ok') status = 'warn'; };
    var fail = function (t) { msgs.push(t); status = 'error'; };
    var name = String(raw.name || '').trim();
    if (!name) fail('이름이 비어 있어요');
    else if (name.length > 20) fail('이름이 너무 길어요(20자까지)');
    var ext = String(raw.ext || '').replace(/\s/g, '');
    if (looksPhone_(ext)) { warn('휴대폰 번호 같아서 넣지 않아요(내선만 넣어요)'); ext = ''; }
    else if (ext && (!/^[0-9\-]+$/.test(ext) || ext.length > 15)) { warn("내선 '" + raw.ext + "'" + josa_(String(raw.ext), '은', '는') + ' 숫자가 아니라 비워 두고 넣어요'); ext = ''; }
    var deptId = '';
    if (String(raw.dept || '').trim()) {
      deptId = deptIds[normHead_(raw.dept)] || deptIds[normHead_(raw.dept).replace(/부$/, '')] || '';
      if (!deptId) warn("부서 '" + raw.dept + "'" + josa_(String(raw.dept), '이', '가') + ' 분류에 없어서 비워 두고 넣어요');
    }
    var order = String(raw.order || '').trim();
    if (order && !/^\d{1,4}$/.test(order)) { warn('순서는 숫자만 넣어요'); order = ''; }
    var group = String(raw.group || '').trim().slice(0, 30);
    var key = name + '|' + group;
    if (name && have[key]) { dup = 'exists'; warn('이미 같은 이름·소속이 있어서 건너뛰어요'); }
    else if (name && seen[key] !== undefined) { dup = 'file'; warn('위의 ' + (seen[key] + 1) + '번째 줄과 같아요'); }
    if (name && seen[key] === undefined) seen[key] = i;
    var include = status !== 'error' && !dup;
    if (raw.include === false) include = false;
    return {
      n: i + 1, raw: raw, name: name, position: String(raw.position || '').trim().slice(0, 20), group: group,
      deptId: deptId, dept: names[deptId] || '', duty: String(raw.duty || '').trim().slice(0, 200), ext: ext,
      role: /관리/.test(String(raw.role || '')) ? '관리' : '일반', order: order,
      status: status, msgs: msgs, dup: dup, include: include
    };
  });
}

/** args = { grid } 또는 { rows } */
function adminStaffImportCheck_(args) {
  var cols = ['name', 'position', 'group', 'dept', 'duty', 'ext', 'role', 'order'];
  var rows = args.grid ? gridRowsBy_(args.grid, staffImportHeads_(), cols, ['name']) : (args.rows || []);
  if (rows.length > 300) throw userError_('한 번에 300명까지 넣을 수 있어요.');
  var checked = staffImportCheck_(rows);
  return {
    rows: checked,
    counts: {
      total: checked.length,
      add: checked.filter(function (r) { return r.include; }).length,
      warn: checked.filter(function (r) { return r.status === 'warn'; }).length,
      error: checked.filter(function (r) { return r.status === 'error'; }).length
    }
  };
}

function adminStaffImport_(args, actor) {
  var rows = args.rows || [];
  if (rows.length > 300) throw userError_('한 번에 300명까지 넣을 수 있어요.');
  return withLock_(function () {
    var checked = staffImportCheck_(rows);
    var recs = checked.filter(function (r) { return r.include; }).map(function (r) {
      return { '이름': r.name, '직위': r.position, '소속': r.group, '부서ID': r.deptId, '담당 업무': r.duty, '내선': r.ext, '역할': r.role, '순서': r.order, '사용 여부': '사용', '틀린 횟수': '0' };
    });
    if (!recs.length) throw userError_('넣을 분이 없어요. 미리보기에서 넣을 줄을 골라 주세요.');
    insertRows_('교직원', recs, actor, '교직원 명단 한 번에 넣기: ' + recs.length + '명');
    return { added: recs.length, skipped: checked.length - recs.length };
  });
}
