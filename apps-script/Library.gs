/**
 * Library.gs — 자료실(자료 카드, 파일 올리기·내려받기)과 새 학년도 넘기기
 *
 * - 자료 한 줄 = 링크 하나 또는 올린 파일 하나. 학년도마다 따로 두고, 지난 학년도 자료는 '보관 여부' = 보관
 * - 올린 파일은 웹앱 주인 드라이브의 '온라인 교무실 자료' 폴더에 둔다.
 *   폴더·파일은 아무와도 공유하지 않고, 웹앱(공통 비밀번호 로그인)을 거쳐서만 내려받는다.
 * - 넣기: 이름을 고른 교직원 누구나. 고치기·지우기: 처음 넣은 분과 관리(역할 '관리' 또는 관리자 화면)
 * - 공통 자료: 넣는 누구나 '공통'으로 표시할 수 있다. 자료실 맨 위 '공통 자료' 칸에 '공통 순서' 번호 → 제목 순으로 보인다
 * - 새 학년도 넘기기(관리자): 지금 학년도 자료를 모두 보관함으로 보내고, 고른 자료만 새 학년도로 옮겨 적는다.
 *   옮긴 자료는 같은 파일을 가리키고(파일을 복사하지 않음), 처음 넣은 분이 계속 고칠 수 있다.
 * - 파일은 지우지 않는다. 자료를 지우거나 파일을 바꿔도 드라이브 파일은 그대로 남고, 기록 탭에 파일ID가 남는다.
 */

function fileMark_Library_() { return '2026-10-28a'; } // 판 표시(관리자 › 점검)

// ---------------------------------------------------------------- 도구

/** 분류 목록(종류별, 순서대로) */
function catOptions_(kind) {
  return liveRows_('분류').filter(function (r) { return r['종류'] === kind; })
    .sort(function (a, b) { return (Number(a['순서']) || 999) - (Number(b['순서']) || 999) || a['이름'].localeCompare(b['이름'], 'ko'); })
    .map(function (r) { return { id: r['분류ID'], name: r['이름'], active: r['사용 여부'] !== '사용 안 함' }; });
}

/** 처음 넣은 분 / 관리 */
function canEditOwned_(row, ctx) {
  if (canManage_(ctx)) return true;
  return !!(ctx.identity && row['입력자ID'] && row['입력자ID'] === ctx.identity['교직원ID']);
}

function libYear_() {
  return String(setting_('학년도') || '');
}

/** 파일 크기 한도(MB). 시트를 손으로 고쳐도 20MB까지(실제로 올려 보기 전까지, 확인 필요. Admin.gs 설정 최대와 같게) */
function fileLimitMb_() {
  return Math.min(20, Math.max(1, Number(setting_('파일 크기 한도')) || 10));
}

/** 링크: https:// 로 시작하는 주소만 */
function cleanUrl_(v, label, required) {
  var url = cleanText_(v, 1000, label, required);
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw userError_(label + josa_(label, '은', '는') + ' https:// 로 시작하는 주소를 넣어 주세요.');
  return url;
}

/** 분류ID가 그 종류에 있는지(빈 값은 그대로) */
function checkCat_(id, kind, label) {
  id = cleanText_(id, 20, label);
  if (id && !categoryNames_(kind)[id]) throw userError_(label + josa_(label, '을', '를') + ' 다시 골라 주세요.');
  return id;
}

// ---------------------------------------------------------------- 파일 (드라이브)

/** 자료 파일 폴더. 없거나 휴지통에 있으면 새로 만든다. 공유하지 않는다. */
function filesFolder_() {
  var id = setting_('자료 폴더ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* 폴더가 없어졌으면 새로 만든다 */ }
  }
  var folder = DriveApp.createFolder('온라인 교무실 자료');
  putSetting_('자료 폴더ID', folder.getId(), { id: '', name: '자동' });
  return folder;
}

function cleanFileName_(v) {
  var s = String(v || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = '파일';
  if (s.length > 100) {
    var dot = s.lastIndexOf('.');
    var ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, 100 - ext.length) + ext;
  }
  return s;
}

/**
 * 화면에서 보낸 파일 { name, type, data(base64) } 을 자료 폴더에 만든다.
 * 돌려주는 값: { id, name, size }
 */
function saveUpload_(file) {
  var name = cleanFileName_(file && file.name);
  var b64 = String((file && file.data) || '');
  if (!b64) throw userError_('파일을 읽지 못했어요. 다시 골라 주세요.');
  var limit = fileLimitMb_();
  // base64는 원래 크기의 약 4/3. 너무 큰 것은 풀기 전에 막는다
  if (b64.length > Math.ceil(limit * 1024 * 1024 / 3) * 4 + 8) {
    throw userError_('파일이 너무 커요. ' + limit + 'MB까지 올릴 수 있어요. 더 큰 파일은 드라이브에 올리고 링크로 넣어 주세요.');
  }
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { throw userError_('파일을 읽지 못했어요. 다시 골라 주세요.'); }
  if (!bytes.length) throw userError_('빈 파일이에요. 다른 파일을 골라 주세요.');
  if (bytes.length > limit * 1024 * 1024) {
    throw userError_('파일이 너무 커요. ' + limit + 'MB까지 올릴 수 있어요. 더 큰 파일은 드라이브에 올리고 링크로 넣어 주세요.');
  }
  var type = /^[\w.+-]+\/[\w.+-]+$/.test(String(file.type || '')) ? String(file.type) : 'application/octet-stream';
  var made = filesFolder_().createFile(Utilities.newBlob(bytes, type, name));
  return { id: made.getId(), name: name, size: bytes.length };
}

/**
 * 파일 내려받기. 자료·도움말 표에 적힌 파일만 준다(다른 드라이브 파일은 못 받는다).
 * args = { tab: '자료' | '도움말', id }
 */
function apiFileGet_(args, actor, ctx) {
  var tab = args.tab === '도움말' ? '도움말' : '자료';
  var row = findRow_(tab, String(args.id || ''));
  if (!row || row['삭제 여부'] || !row['파일ID']) throw userError_('파일을 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  var blob;
  try {
    blob = DriveApp.getFileById(row['파일ID']).getBlob();
  } catch (e) {
    throw userError_('드라이브에서 파일을 찾지 못했어요. 관리자에게 알려 주세요.', 'NOTFOUND');
  }
  return {
    name: row['파일 이름'] || blob.getName() || '파일',
    type: blob.getContentType() || 'application/octet-stream',
    data: Utilities.base64Encode(blob.getBytes())
  };
}

// ---------------------------------------------------------------- 자료 읽기

function libCache_() {
  return { depts: categoryNames_('부서'), kinds: categoryNames_('자료 분류'), names: staffNames_(), year: libYear_() };
}

/** 화면에 보낼 자료 한 줄(파일ID는 보내지 않는다) */
function libView_(r, ctx, c) {
  return {
    id: r['자료ID'],
    year: r['학년도'] || c.year,
    deptId: r['부서ID'],
    dept: c.depts[r['부서ID']] || '',
    kindId: r['분류ID'],
    kind: c.kinds[r['분류ID']] || '',
    title: r['제목'],
    desc: r['설명'],
    link: r['링크'],
    hasFile: !!r['파일ID'],
    fileName: r['파일 이름'],
    fileSize: Number(r['파일 크기']) || 0,
    owner: r['담당'],
    by: c.names[r['입력자ID']] || '',
    byId: r['입력자ID'],
    updated: (r['수정 시각'] || r['입력 시각'] || '').slice(0, 10),
    added: String(r['입력 시각'] || '').slice(0, 10), // 처음 넣은 날(7일 안이면 '새 자료', 2026-10-28a)
    archived: r['보관 여부'] === '보관' || (!!r['학년도'] && r['학년도'] !== c.year),
    home: r['홈에 보이기'] === '예',
    common: r['공통'] === '예',
    commonOrder: r['공통'] === '예' ? r['공통 순서'] || '' : '',
    canEdit: canEditOwned_(r, ctx)
  };
}

function apiLibList_(args, actor, ctx) {
  var c = libCache_(), archive = !!(args && args.archive);
  var all = liveRows_('자료').map(function (r) { return libView_(r, ctx, c); });
  // 보관함(지난 학년도 자료)은 열 때만 보낸다(args.archive). 학년도별 개수는 늘 보낸다
  var years = {};
  all.forEach(function (v) { if (v.archived) years[v.year] = (years[v.year] || 0) + 1; });
  var items = (archive ? all : all.filter(function (v) { return !v.archived; }))
    .sort(function (a, b) { return a.title.localeCompare(b.title, 'ko'); });
  return {
    year: c.year,
    items: items,
    archive: archive,
    archiveYears: Object.keys(years).sort().reverse().map(function (y) { return { year: y, count: years[y] }; }),
    depts: deptOptions_(),
    kinds: catOptions_('자료 분류'),
    canManage: canManage_(ctx),
    maxMb: fileLimitMb_()
  };
}

/** 홈 '자주 찾는 자료': 지금 학년도 자료 중 '홈에 보이기'(관리가 고름) 모두. 홈(apiHome_)이 6개까지 보여 주고 나머지 수를 알린다 */
function homeLibrary_(ctx) {
  var c = libCache_();
  return liveRows_('자료').filter(function (r) { return r['홈에 보이기'] === '예'; })
    .map(function (r) { return libView_(r, ctx, c); })
    .filter(function (v) { return !v.archived; })
    .sort(function (a, b) { return a.title.localeCompare(b.title, 'ko'); });
}

// ---------------------------------------------------------------- 자료 넣기·고치기·지우기

function libSummary_(r) {
  return (r['제목'] || '') + (r['학년도'] ? ' (' + r['학년도'] + ')' : '');
}

/**
 * args = { id?, fields: { 제목, 설명, 부서ID, 분류ID, 담당, mode: 'link'|'file', link, home }, file?: { name, type, data } }
 */
function apiLibSave_(args, actor, ctx) {
  var f = args.fields || {};
  var rec = {
    '제목': cleanText_(f['제목'], 60, '제목', true),
    '설명': cleanText_(f['설명'], 500, '설명'),
    '부서ID': checkCat_(f['부서ID'], '부서', '부서'),
    '분류ID': checkCat_(f['분류ID'], '자료 분류', '자료 분류'),
    '담당': cleanText_(f['담당'], 20, '담당'),
    '공통': f.common ? '예' : '',
    '공통 순서': f.common ? cleanText_(f.commonOrder, 3, '공통 순서') : ''
  };
  if (rec['공통 순서'] && !/^\d+$/.test(rec['공통 순서'])) throw userError_('공통 순서는 숫자로 적어 주세요.');
  if (f.common === undefined) { delete rec['공통']; delete rec['공통 순서']; } // 예전 화면에서 보낸 요청은 공통 표시를 건드리지 않음
  var row = null;
  if (args.id) {
    row = findRow_('자료', String(args.id));
    if (!row || row['삭제 여부']) throw userError_('자료를 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    if (!canEditOwned_(row, ctx)) throw userError_('처음 넣은 분과 관리자만 고칠 수 있어요.', 'FORBIDDEN');
    if (libView_(row, ctx, libCache_()).archived) throw userError_('보관함 자료는 고칠 수 없어요. 관리자가 지금 학년도로 꺼내면 고칠 수 있어요.');
  }
  if (f.mode === 'file') {
    if (!args.file && !(row && row['파일ID'])) throw userError_('올릴 파일을 골라 주세요.');
    rec['링크'] = '';
  } else {
    rec['링크'] = cleanUrl_(f.link, '링크', true);
    rec['파일ID'] = '';
    rec['파일 이름'] = '';
    rec['파일 크기'] = '';
  }
  if (canManage_(ctx) && f.home !== undefined) rec['홈에 보이기'] = f.home ? '예' : '';
  ensureCols_('자료');
  // 값 확인을 모두 마친 뒤에 파일을 만든다(확인에서 걸리면 드라이브에 남지 않게)
  if (f.mode === 'file' && args.file) {
    var up = saveUpload_(args.file);
    rec['파일ID'] = up.id;
    rec['파일 이름'] = up.name;
    rec['파일 크기'] = String(up.size);
  }
  var saved;
  if (row) {
    saved = updateRow_('자료', row['자료ID'], rec, actor, '자료 고침: ' + libSummary_(rec));
  } else {
    rec['학년도'] = libYear_();
    rec['보관 여부'] = '';
    saved = insertRow_('자료', rec, actor, '자료 추가: ' + libSummary_(rec));
  }
  return libView_(findRow_('자료', saved['자료ID']), ctx, libCache_());
}

function apiLibDelete_(args, actor, ctx) {
  var row = findRow_('자료', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('자료를 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  if (!canEditOwned_(row, ctx)) throw userError_('처음 넣은 분과 관리자만 지울 수 있어요.', 'FORBIDDEN');
  softDelete_('자료', row['자료ID'], actor, '자료 지움: ' + libSummary_(row));
  return { done: true };
}

/** 보관함 자료를 지금 학년도로 다시 꺼내기(관리) */
function apiLibUnarchive_(args, actor, ctx) {
  if (!canManage_(ctx)) throw manageDenied_(ctx, '보관 풀기는 관리자가 해요.');
  var row = findRow_('자료', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('자료를 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  var cur = libYear_();
  var c = libCache_();
  if (!libView_(row, ctx, c).archived) throw userError_('이미 지금 학년도 자료예요.');
  // 지난 학년도 줄은 그대로 두고, 지금 학년도로 옮겨 적는다(새 학년도 넘기기와 같은 방식).
  // 이미 꺼낸 것이 있으면(두 번 누르거나 두 분이 함께 누름) 새로 만들지 않고 그것을 돌려준다
  var id = withLock_(function () {
    var dup = liveRows_('자료').filter(function (r) { return r['원본 자료ID'] === row['자료ID'] && String(r['학년도']) === String(cur) && r['보관 여부'] !== '보관'; })[0];
    if (dup) return dup['자료ID'];
    var added = insertRows_('자료', [libCopyObj_(row, cur)], actor, '보관함에서 꺼냄: ' + libSummary_(row) + ' → ' + cur, true);
    return added[0]['자료ID'];
  });
  return libView_(findRow_('자료', id), ctx, libCache_());
}

function libCopyObj_(row, year) {
  var o = {};
  ['분류ID', '부서ID', '제목', '설명', '링크', '파일ID', '담당', '파일 이름', '파일 크기', '홈에 보이기', '공통', '공통 순서', '입력자ID', '입력 시각', '수정자ID', '수정 시각'].forEach(function (h) {
    o[h] = row[h] || '';
  });
  o['학년도'] = year;
  o['보관 여부'] = '';
  o['원본 자료ID'] = row['자료ID'];
  return o;
}

// ---------------------------------------------------------------- 휴지통 (관리자)

function adminLibTrash_() {
  var c = libCache_(), names = c.names;
  var lib = readRows_('자료').filter(function (r) { return r['삭제 여부']; }).map(function (r) {
    var v = libView_(r, { identity: null, tokens: {} }, c);
    return { tab: '자료', id: v.id, title: v.title, sub: [v.year + '학년도', v.dept, v.kind].filter(Boolean).join(' · '), by: v.by, deletedBy: names[r['수정자ID']] || '', deletedAt: r['수정 시각'] };
  });
  var helpNames = categoryNames_('도움말 분류');
  var help = readRows_('도움말').filter(function (r) { return r['삭제 여부']; }).map(function (r) {
    return { tab: '도움말', id: r['항목ID'], title: r['제목'], sub: helpNames[r['분류ID']] || '', by: names[r['입력자ID']] || '', deletedBy: names[r['수정자ID']] || '', deletedAt: r['수정 시각'] };
  });
  var depts = categoryNames_('부서');
  var notices = readRows_('공지').filter(function (r) { return r['삭제 여부']; }).map(function (r) {
    return { tab: '공지', id: r['공지ID'], title: r['제목'], sub: depts[r['부서ID']] || '', by: names[r['입력자ID']] || '', deletedBy: names[r['수정자ID']] || '', deletedAt: r['수정 시각'] };
  });
  return lib.concat(help).concat(notices).sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0; }).slice(0, 200);
}

function adminLibRestore_(args, actor) {
  var tab = args.tab === '도움말' || args.tab === '공지' ? args.tab : '자료';
  var row = findRow_(tab, String(args.id || ''));
  if (!row || !row['삭제 여부']) throw userError_('되살릴 항목을 찾지 못했어요.');
  restoreRow_(tab, row[tabs_()[tab][0]], actor, tab + ' 되살림: ' + row['제목']);
  return { done: true };
}

// ---------------------------------------------------------------- 새 학년도 넘기기 (관리자)

/** 넘기기 전에 볼 것: 지금 학년도와 자료 목록 */
function adminYearPreview_() {
  var c = libCache_();
  var ctx = { identity: null, tokens: {} };
  var items = liveRows_('자료').map(function (r) { return libView_(r, ctx, c); })
    .filter(function (v) { return !v.archived; })
    .sort(function (a, b) { return (a.dept || '힣').localeCompare(b.dept || '힣', 'ko') || a.title.localeCompare(b.title, 'ko'); });
  var y = Number(c.year) || Number(todayYmd_().slice(0, 4));
  return { year: c.year, next: String(y + 1), items: items };
}

/**
 * 새 학년도 준비 점검(관리자 › 새 학년도 맨 위, 2026-10-19a). 넘기기 전에 살펴볼 것만 알려 주고 아무것도 바꾸지 않는다.
 * state: ok(됨) · warn(해 두면 좋음) · info(알아 두기)
 */
function adminYearCheck_() {
  var cur = Number(libYear_()) || schoolYearOf_(todayYmd_()), next = cur + 1, items = [];
  var c = libCache_(), ctx = { identity: null, tokens: {} };
  // 1) 자료 제목에 지금·지난 학년도 숫자: 옮겨 적으면 제목이 그대로 간다
  var stale = liveRows_('자료').map(function (r) { return libView_(r, ctx, c); }).filter(function (v) {
    return !v.archived && (v.title.indexOf(String(cur)) >= 0 || v.title.indexOf(String(cur - 1)) >= 0);
  });
  items.push({ key: 'lib', state: stale.length ? 'warn' : 'ok', label: '자료 제목의 학년도 숫자',
    detail: stale.length ? '새 학년도로 옮겨 적으면 제목이 그대로 가요. 넘긴 뒤 고쳐 주세요: ' + stale.slice(0, 8).map(function (v) { return v.title; }).join(', ') + (stale.length > 8 ? ' 외 ' + (stale.length - 8) + '개' : '')
      : '지금 학년도 자료 제목에 ' + cur + '·' + (cur - 1) + ' 숫자가 없어요.' });
  // 2) 소속 꼴: 학년 대상 조사·학년·반별 양식·학생 수 칸은 '3학년 2반' 꼴로 알아본다
  var odd = sortStaff_(activeStaff_()).filter(function (r) { return !/^[1-6]학년 \d{1,2}반$/.test(String(r['소속'] || '').trim()); });
  items.push({ key: 'group', state: odd.length ? 'info' : 'ok', label: "교직원 소속 꼴('3학년 2반')",
    detail: odd.length ? "학년·반 꼴이 아닌 분 " + odd.length + '명: ' + odd.slice(0, 10).map(function (r) { return r['이름'] + '(' + (r['소속'] || '비어 있음') + ')'; }).join(', ') + (odd.length > 10 ? ' 외 ' + (odd.length - 10) + '명' : '') +
      ". 전담·부장 등은 그대로 두어도 돼요. 담임이면 '3학년 2반'처럼 적어야 학년 대상 조사·학년·반별 양식에 들어가요."
      : "모두 '○학년 ○반' 꼴이에요." });
  // 3) 새 학년도 학기 기간
  var sems = semesters_(next);
  items.push({ key: 'sem', state: sems.length >= 2 ? 'ok' : 'warn', label: next + '학년도 학기 기간',
    detail: sems.length >= 2 ? '1·2학기 기간이 들어 있어요.' : "관리자 › 설정 › 학기 기간에 " + next + "학년도 기간을 넣어 주세요(수업일수 계산에 써요)." });
  // 4) 새 학년도 공휴일·휴업일
  var r = schoolYearRange_(next);
  var offs = liveRows_('일정').filter(function (e) { return isOffKind_(e['구분']) && e['시작일'] >= r.from && e['시작일'] <= r.to; }).length;
  items.push({ key: 'off', state: offs ? 'ok' : 'warn', label: next + '학년도 공휴일·휴업일',
    detail: offs ? offs + '개 들어 있어요.' : '아직 없어요. 학사일정 올리기나 일정 › 행사 추가로 넣어 주세요(날짜는 학교 학사일정을 보고 넣어요).' });
  // 5) 새 학년도 학생 수(3월 1일 뒤에 넣는다)
  var st = studentsOf_(next);
  items.push({ key: 'stu', state: st.id ? 'ok' : 'info', label: next + '학년도 학생 수',
    detail: st.id ? '들어 있어요.' : '3월 1일 뒤에 홈의 학생 수 현황에서 반마다 넣어 주세요.' });
  // 6) 공통 비밀번호: 새 학년도에 바꾸고 메신저로 알리기(마지막으로 바꾼 날은 기록에서)
  var last = String(PropertiesService.getScriptProperties().getProperty('COMMON_PW_AT') || ''); // 2026-10-28a부터 바꿀 때 적어 둔다
  if (!last) tailRows_('기록', 5000).forEach(function (x) { if (x['동작'] === '비밀번호 바꿈' && /공통 비밀번호/.test(x['요약'] || '') && x['시각'] > last) last = x['시각']; });
  items.push({ key: 'pw', state: 'info', label: '공통 비밀번호 바꾸기',
    detail: (last ? '마지막으로 바꾼 때: ' + last.slice(0, 10) + '. ' : '웹앱에서 바꾼 기록이 없어요. ') + '새 학년도에는 관리자 › 비밀번호에서 바꾸고, 새 비밀번호를 메신저로 알려 주세요(모든 기기가 다시 로그인해요).' });
  return { year: String(cur), next: String(next), items: items };
}

/**
 * args = { year: '2027', keep: [자료ID…] }
 * 1) 지금 학년도 자료를 모두 '보관'으로 표시 → 보관함
 * 2) keep에 든 자료만 새 학년도로 옮겨 적기(처음 넣은 분·수정일 그대로)
 * 3) 설정 '학년도'를 새 학년도로
 */
function adminYearStart_(args, actor) {
  var next = String(args.year || '').trim();
  var cur = libYear_();
  if (!/^20\d\d$/.test(next)) throw userError_('새 학년도는 2027처럼 네 자리로 적어 주세요.');
  if (cur && Number(next) <= Number(cur)) throw userError_('새 학년도는 지금 학년도(' + cur + ')보다 뒤여야 해요.');
  var keep = {};
  (args.keep || []).forEach(function (id) { keep[String(id)] = true; });
  return withLock_(function () {
    ensureCols_('자료');
    var c = libCache_();
    var ctx = { identity: null, tokens: {} };
    var rows = liveRows_('자료').filter(function (r) { return !libView_(r, ctx, c).archived; });
    var ids = rows.map(function (r) { return r['자료ID']; });
    var copies = rows.filter(function (r) { return keep[r['자료ID']]; }).map(function (r) { return libCopyObj_(r, next); });
    // 학년도가 비어 있던 줄은 지금 학년도로 적어 둔다(보관함에서 학년도별로 보이게)
    var blank = rows.filter(function (r) { return !r['학년도']; }).map(function (r) { return r['자료ID']; });
    if (blank.length && cur) updateRowsSame_('자료', blank, { '학년도': cur }, actor, '학년도 빈 자료에 ' + cur + ' 적음', '수정');
    var archived = updateRowsSame_('자료', ids, { '보관 여부': '보관' }, actor, (cur || '지난') + '학년도 자료 ' + ids.length + '개 보관함으로', '보관');
    insertRows_('자료', copies, actor, next + '학년도로 자료 ' + copies.length + '개 옮겨 적음', true);
    putSetting_('학년도', next, actor);
    return { year: next, archived: archived, copied: copies.length };
  });
}

// ---------------------------------------------------------------- 테스트용 가짜 자료·도움말

/** 가짜 자료 10개(공통 3개, 1개는 지난 학년도 보관함)와 예시 도움말 3개. 도움말 내용은 학교 규정을 지어내지 않고 '여기에 적어 주세요'로 둔다. */
function seedTestLibrary_() {
  if (liveRows_('자료').length || liveRows_('도움말').length) throw userError_('자료·도움말 탭에 이미 내용이 있어요. 가짜 자료는 빈 테스트 시트에만 넣을 수 있어요.');
  var cat = {};
  liveRows_('분류').forEach(function (c) { cat[c['종류'] + '/' + c['이름']] = c['분류ID']; });
  var actor = { id: '', name: '테스트 데이터' };
  var year = libYear_();
  var fakeFile = function (name, text) {
    return saveUpload_({ name: name, type: 'text/plain', data: Utilities.base64Encode(Utilities.newBlob(text).getBytes()) });
  };
  ensureCols_('자료');
  ensureCols_('도움말');
  var lib = [
    ['교무부', '업무 자료', '학적 업무 안내(가짜)', '전입·전출 처리 순서를 모은 가짜 자료예요.', '이몽룡', 'link', '예'],
    ['연구부', '연수 자료', '학년초 연수 자료(가짜)', '새 학년 준비 연수 때 쓰는 가짜 자료예요.', '홍길동', 'link', '예'],
    ['연구부', '양식', '교육과정 협의록 양식(가짜)', '학년 협의 때 적는 양식이에요. 내려받아 쓰세요.', '성춘향', 'file', ''],
    ['정보부', '업무 자료', '태블릿·노트북 관리 안내(가짜)', '기기 대여·반납 순서(가짜).', '심청', 'link', ''],
    ['인성안전부', '양식', '안전점검의 날 점검표(가짜)', '', '흥부', 'file', '예'],
    ['인성안전부', '연수 자료', '학교폭력 예방교육 자료(가짜)', '교직원 연수용 가짜 자료예요.', '흥부', 'link', ''],
    ['교무부', '양식', '가정통신문 양식(가짜)', '학교 이름이 들어간 기본 가정통신문 양식(가짜).', '이몽룡', 'file', '', '1'],
    ['교무부', '양식', '표준 기안문 예시(가짜)', '기안문을 쓸 때 참고하는 가짜 예시예요.', '이몽룡', 'link', '', '2'],
    ['교무부', '양식', '출결 관련 양식(가짜)', '결석계·체험학습 신청서 등(가짜).', '장화', 'link', '', '3']
  ];
  withLock_(function () {
    lib.forEach(function (x, i) {
      var rec = {
        '학년도': year, '부서ID': cat['부서/' + x[0]] || '', '분류ID': cat['자료 분류/' + x[1]] || '',
        '제목': x[2], '설명': x[3], '담당': x[4], '홈에 보이기': x[6], '보관 여부': '',
        '공통': x[7] ? '예' : '', '공통 순서': x[7] || ''
      };
      if (x[5] === 'file') {
        var up = fakeFile(x[2] + '.txt', '테스트용 가짜 파일이에요: ' + x[2]);
        rec['파일ID'] = up.id; rec['파일 이름'] = up.name; rec['파일 크기'] = String(up.size);
      } else {
        rec['링크'] = 'https://example.com/gajja-' + (i + 1);
      }
      insertRow_('자료', rec, actor, '가짜 자료');
    });
    insertRow_('자료', {
      '학년도': String(Number(year) - 1), '부서ID': cat['부서/교무부'] || '', '분류ID': cat['자료 분류/업무 자료'] || '',
      '제목': '지난 학년도 업무 분장(가짜)', '설명': '보관함에서 보이는 가짜 자료예요.', '담당': '이몽룡', '링크': 'https://example.com/gajja-old', '보관 여부': '보관'
    }, actor, '가짜 자료(보관함)');
    var note = '이 글은 화면을 보여 드리려는 예시예요.\n학교에서 정한 내용(순서·기한·서식)을 여기에 적어 주세요.';
    insertRow_('도움말', { '분류ID': cat['도움말 분류/복무·인사'] || '', '제목': '방학 중 근무 상신 안내(예시)', '내용': note, '순서': '1' }, actor, '예시 도움말');
    insertRow_('도움말', { '분류ID': cat['도움말 분류/복무·인사'] || '', '제목': '공무외 국외여행·자율연수 안내(예시)', '내용': note, '링크': 'https://example.com/gajja-help', '순서': '2' }, actor, '예시 도움말');
    var up2 = fakeFile('학교 규칙(예시).txt', '테스트용 가짜 파일이에요. 실제 학교 규칙 파일을 올려 주세요.');
    insertRow_('도움말', { '분류ID': cat['도움말 분류/학교 규칙·제규정'] || '', '제목': '학교 규칙 및 제규정(예시)', '내용': '학교 규칙 파일을 올려 두는 자리예요(예시).', '파일ID': up2.id, '파일 이름': up2.name, '파일 크기': String(up2.size), '순서': '1' }, actor, '예시 도움말');
  });
  return lib.length + 1;
}
