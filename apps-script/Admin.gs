/**
 * Admin.gs — 설정·분류·교직원 표·수정 기록 (관리자 화면)
 */

function fileMark_Admin_() { return '2026-10-16b'; } // 판 표시(관리자 › 점검)

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
    dirty_('설정');
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

// ---------------------------------------------------------------- 점검 (관리자): 파일·시트·비밀번호·백업·설정을 한 번에

/**
 * args.client = { app, styles, index } : 화면 파일의 판 표시(화면이 보낸다)
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
  ['Code', 'Db', 'Auth', 'Admin', 'Schedule', 'Survey', 'Library', 'Help', 'Setup'].forEach(function (f) {
    var mark = globalFn_('fileMark_' + f + '_');
    if (!mark) add('코드 파일', f + '.gs', 'bad', '파일이 없거나 내용이 비어 있어요', paste(f));
    else if (f === 'Code' && !buildsFn) add('코드 파일', 'Code.gs', 'warn', '예전 판이에요(' + mark() + ')', paste(f));
    else if (mark() !== want(f)) add('코드 파일', f + '.gs', 'warn', '예전 판이에요(' + mark() + ')', paste(f));
    else add('코드 파일', f + '.gs', 'ok', '최신 판 ' + mark());
  });
  var c = (args && args.client) || {};
  [['App.html', c.app], ['Styles.html', c.styles], ['Index.html', c.index]].forEach(function (x) {
    var f = x[0].replace('.html', '');
    if (!x[1]) add('코드 파일', x[0], 'warn', '판 표시를 찾지 못했어요(예전 파일일 수 있어요)', paste(f));
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

  // 2) 시트 탭·칸 (나중에 더한 탭 중 처음 쓸 때 저절로 생기는 탭은 없어도 괜찮다)
  var tabs = tabs_(), bad = 0;
  var autoTabs = { '학생수': '학생 수를 처음 넣을 때 저절로 생겨요' }, notYet = 0;
  Object.keys(tabs).forEach(function (tab) {
    var head;
    try { head = headOf_(tab); } catch (e) {
      if (autoTabs[tab]) { notYet++; add('시트', tab + ' 탭', 'ok', '아직 없어요 · ' + autoTabs[tab]); return; }
      bad++;
      add('시트', tab + ' 탭', 'bad', '탭이 없어요', "전용 시트 메뉴 '온라인 교무실 → 1. 처음 설정'을 눌러 주세요");
      return;
    }
    var miss = tabs[tab].filter(function (h) { return head.indexOf(h) < 0; });
    if (miss.length) { bad++; add('시트', tab + ' 탭', 'warn', '칸이 없어요: ' + miss.join(', '), "전용 시트 메뉴 '1. 처음 설정'을 한 번 더 눌러 주세요(있는 데이터는 그대로예요)"); }
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

  // 4) 매일 백업
  var trig = null;
  try { trig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; }); } catch (e) { trig = null; }
  var last = Number(PropertiesService.getScriptProperties().getProperty('LAST_BACKUP_AT') || 0);
  var lastText = last ? Utilities.formatDate(new Date(last), tz_(), 'yyyy-MM-dd HH:mm') : '없음';
  if (trig === null) add('백업', '매일 자동 백업', 'warn', '켜져 있는지 확인하지 못했어요 · 마지막 백업 ' + lastText, "전용 시트 메뉴 '4. 매일 자동 백업 켜기'를 한 번 눌러 두면 확실해요");
  else if (!trig) add('백업', '매일 자동 백업', 'warn', '꺼져 있어요 · 마지막 백업 ' + lastText, "전용 시트 메뉴 '4. 매일 자동 백업 켜기'");
  else if (!last || Date.now() - last > 2 * 86400000) add('백업', '매일 자동 백업', 'warn', '켜져 있지만 마지막 백업이 ' + lastText + '예요', "백업 폴더를 확인하고, 이상하면 '4. 매일 자동 백업 켜기'를 다시 눌러 주세요");
  else add('백업', '매일 자동 백업', 'ok', '켜져 있어요 · 마지막 백업 ' + lastText);

  // 5) 설정
  var semOk = semesters_().length === 2;
  add('설정', '학기 기간', semOk ? 'ok' : 'warn', semOk ? '1·2학기 기간이 들어 있어요' : '비어 있는 학기가 있어 수업일수를 다 세지 못해요', '관리자 › 설정에서 1·2학기 시작일·끝일을 넣어 주세요');
  var days = rememberDays_();
  add('설정', '기기 기억 기간', days >= 365 ? 'ok' : 'warn', days + '일', days >= 365 ? '' : "정한 값은 365일이에요. 관리자 › 설정에서 바꿔 주세요");
  add('설정', '본인 확인 방식', 'ok', pinMode_() ? '이름+개인 번호' : "이름만 (관리 일은 관리자 화면을 연 기기에서만)");

  // 6) 교직원·분류
  var staff = activeStaff_();
  var depts = categoryNames_('부서');
  var noDept = staff.filter(function (r) { return !depts[r['부서ID']]; }).length;
  add('교직원', '사용 중인 교직원', staff.length ? 'ok' : 'bad', staff.length + '명', staff.length ? '' : '관리자 › 교직원 표에서 넣거나 "명단 한 번에 넣기"를 써 주세요');
  if (noDept) add('교직원', '부서 없는 분', 'warn', noDept + '명', '교직원 표에서 부서를 골라 주세요(내 담당·조사 대상에 쓰여요)');

  return { build: APP_BUILD_, at: nowText_(), items: items };
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
    if (ext && (/^0?1[016789]/.test(ext.replace(/-/g, '')) && ext.replace(/\D/g, '').length >= 10)) { warn('휴대폰 번호 같아서 넣지 않아요(내선만 넣어요)'); ext = ''; }
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
