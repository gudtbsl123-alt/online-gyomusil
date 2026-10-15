/**
 * Schedule.gs — 일정(학사일정·월별 계획·홈)과 수업일수 계산
 *
 * 한 번 넣은 행사는 '일정' 탭 한 곳에만 저장되고, 달력·연간 학사일정·월별 계획·홈이 모두 같은 줄을 읽는다.
 * 구분: 행사 / 교육활동 / 휴업일 / 공휴일  (휴업일·공휴일은 수업일수에서 빠진다)
 * 대상 학년: '전체' 또는 '1,2,교직원' 처럼 쉼표로 이어 쓴다.
 * 고치기·지우기: 처음 넣은 사람, 역할이 '관리'인 분, 관리자 화면을 연 분만.
 */

function schedKinds_() {
  return ['행사', '교육활동', '휴업일', '공휴일'];
}

function schedTargets_() {
  return ['1', '2', '3', '4', '5', '6', '교직원'];
}

// ---------------------------------------------------------------- 날짜 도구 (모두 'yyyy-MM-dd' 글자)

function ymdToUtc_(s) {
  var p = String(s).split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function utcToYmd_(t) {
  var d = new Date(t);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function addDays_(s, n) {
  return utcToYmd_(ymdToUtc_(s) + n * 86400000);
}

/** 0=일 … 6=토 */
function weekday_(s) {
  return new Date(ymdToUtc_(s)).getUTCDay();
}

function todayYmd_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

/** 그 주 월요일 */
function mondayOf_(s) {
  var w = weekday_(s);
  return addDays_(s, w === 0 ? -6 : 1 - w);
}

function lastDayOfMonth_(y, m) {
  return utcToYmd_(Date.UTC(y, m, 0)); // m은 1~12
}

/** 학년도 Y = Y년 3월 1일 ~ Y+1년 2월 말일 */
function schoolYearRange_(y) {
  return { from: y + '-03-01', to: lastDayOfMonth_(y + 1, 2) };
}

function eventEnd_(e) {
  return e['끝일'] && e['끝일'] >= e['시작일'] ? e['끝일'] : e['시작일'];
}

/** 시간 칸 정렬: 종일 → 시각(08:40) → 교시 → 그 밖 */
function timeKey_(t) {
  t = String(t || '').trim();
  if (!t || t === '종일') return -1;
  var m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  var k = /^(\d)교시/.exec(t);
  if (k) return 9 * 60 + (Number(k[1]) - 1) * 50; // 정렬용 대략값(1교시 9:00부터 50분 간격)
  return 24 * 60;
}

function sortEvents_(list) {
  return list.sort(function (a, b) {
    if (a['시작일'] !== b['시작일']) return a['시작일'] < b['시작일'] ? -1 : 1;
    var ta = timeKey_(a['시간']), tb = timeKey_(b['시간']);
    if (ta !== tb) return ta - tb;
    return String(a['행사명']).localeCompare(String(b['행사명']), 'ko');
  });
}

// ---------------------------------------------------------------- 권한

/**
 * 관리 권한(다른 분 것 고치기·지우기, 결과 보기, 학사일정 올리기 등)
 * - 관리자 화면이 열린 기기(관리자 비밀번호)는 늘 관리
 * - 역할 '관리'는 '이름+개인 번호' 방식일 때만 관리. '이름만' 방식에서는 누구나 그 이름을 고를 수 있어서
 *   관리자 비밀번호 없이는 관리 권한을 주지 않는다(2026-10-15 교사 결정)
 */
function canManage_(ctx) {
  if (ctx.tokens && ctx.tokens.admin && checkAdmin_(ctx.tokens.admin)) return true;
  return !!(ctx.identity && ctx.identity['역할'] === '관리' && pinMode_());
}

function canEditEvent_(e, ctx) {
  if (canManage_(ctx)) return true;
  return !!(ctx.identity && e['입력자ID'] && e['입력자ID'] === ctx.identity['교직원ID']);
}

// ---------------------------------------------------------------- 읽기

/** 화면에 보낼 일정 한 줄 */
function eventView_(e, ctx, depts, names) {
  return {
    id: e['일정ID'],
    start: e['시작일'],
    end: eventEnd_(e),
    time: e['시간'],
    title: e['행사명'],
    target: e['대상 학년'],
    deptId: e['담당 부서ID'],
    dept: depts[e['담당 부서ID']] || '',
    place: e['장소'],
    kind: e['구분'] || '행사',
    important: e['중요'] === '예',
    memo: e['메모'],
    byId: e['입력자ID'],
    by: names[e['입력자ID']] || '',
    at: e['입력 시각'],
    editedAt: e['수정 시각'],
    canEdit: canEditEvent_(e, ctx)
  };
}

function staffNames_() {
  var m = {};
  readRows_('교직원').forEach(function (r) { m[r['교직원ID']] = r['이름']; });
  return m;
}

/** from~to 와 겹치는 일정 */
function eventsBetween_(from, to, ctx) {
  var depts = categoryNames_('부서');
  var names = staffNames_();
  var list = liveRows_('일정').filter(function (e) {
    return e['시작일'] && e['시작일'] <= to && eventEnd_(e) >= from;
  });
  return sortEvents_(list).map(function (e) { return eventView_(e, ctx, depts, names); });
}

function checkYmd_(s, label) {
  if (!isDate_(String(s || ''))) throw userError_(label + josa_(label, '을', '를') + ' 날짜로 골라 주세요.');
  return String(s);
}

/** 달력·월별 계획: 한 달(앞뒤 주 포함) */
function apiSchedMonth_(args, actor, ctx) {
  var y = Number(args.year), m = Number(args.month);
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12)) throw userError_('달을 다시 골라 주세요.');
  var first = y + '-' + ('0' + m).slice(-2) + '-01';
  var last = lastDayOfMonth_(y, m);
  var from = mondayOf_(first), to = addDays_(mondayOf_(last), 6);
  var sy = m >= 3 ? y : y - 1; // 이 달이 속한 학년도
  return {
    today: todayYmd_(),
    from: from,
    to: to,
    events: eventsBetween_(from, to, ctx),
    focus: focusOf_(sy, m),
    monthDays: instructionalDays_(first, last),
    canManage: canManage_(ctx),
    depts: deptOptions_(),
    schoolYear: sy
  };
}

/** 연간 학사일정 + 수업일수 */
function apiSchedYear_(args, actor, ctx) {
  var y = Number(args.year) || Number(setting_('학년도'));
  if (!(y >= 2000 && y <= 2100)) throw userError_('학년도를 다시 골라 주세요.');
  var r = schoolYearRange_(y);
  return {
    year: y,
    today: todayYmd_(),
    events: eventsBetween_(r.from, r.to, ctx),
    days: semesterDays_(y),
    canManage: canManage_(ctx)
  };
}

/** 홈: 오늘·이번 주·내일 */
function apiHome_(args, actor, ctx) {
  var today = todayYmd_();
  var mon = mondayOf_(today);
  var tomorrow = addDays_(today, 1);
  var to = addDays_(mon, 6) > tomorrow ? addDays_(mon, 6) : tomorrow;
  var links = [];
  try { links = JSON.parse(setting_('기존 시트 바로가기') || '[]'); } catch (e) { links = []; }
  var m = Number(today.slice(5, 7)), y = Number(today.slice(0, 4));
  return {
    today: today,
    monday: mon,
    tomorrow: tomorrow,
    events: eventsBetween_(mon < today ? mon : today, to, ctx),
    links: links,
    focus: focusOf_(m >= 3 ? y : y - 1, m),
    canManage: canManage_(ctx),
    todos: todoList_(ctx),
    library: homeLibrary_(ctx),
    notices: homeNotices_(ctx)
  };
}

// ---------------------------------------------------------------- 쓰기

function cleanEvent_(f) {
  var start = checkYmd_(f.start, '날짜');
  var end = f.end ? checkYmd_(f.end, '끝나는 날') : '';
  if (end && end < start) throw userError_('끝나는 날이 시작하는 날보다 앞에 있어요.');
  if (end && ymdToUtc_(end) - ymdToUtc_(start) > 366 * 86400000) throw userError_('한 행사는 1년 안으로 넣어 주세요.');
  if (end === start) end = '';
  var kind = String(f.kind || '행사');
  if (schedKinds_().indexOf(kind) < 0) throw userError_('구분을 다시 골라 주세요.');
  var target = cleanTarget_(f.target);
  var deptId = cleanText_(f.deptId, 20, '담당 부서');
  if (deptId && !categoryNames_('부서')[deptId]) throw userError_('담당 부서를 다시 골라 주세요.');
  return {
    '시작일': start,
    '끝일': end,
    '시간': cleanText_(f.time, 20, '시간'),
    '행사명': cleanText_(f.title, 60, '행사 이름', true),
    '대상 학년': target,
    '담당 부서ID': deptId,
    '장소': cleanText_(f.place, 40, '장소'),
    '구분': kind,
    '메모': cleanText_(f.memo, 300, '메모'),
    '중요': f.important ? '예' : ''
  };
}

/** ['전체'] 또는 ['1','3','교직원'] → 글자 */
function cleanTarget_(t) {
  var list = Array.isArray(t) ? t : String(t || '').split(',');
  list = list.map(function (x) { return String(x).trim(); }).filter(Boolean);
  if (list.indexOf('전체') >= 0) return '전체';
  var ok = schedTargets_();
  list = ok.filter(function (x) { return list.indexOf(x) >= 0; });
  var grades = list.filter(function (x) { return x !== '교직원'; });
  if (grades.length === 6) return '전체' + (list.indexOf('교직원') >= 0 ? ',교직원' : '');
  return list.join(',');
}

function eventSummary_(r) {
  var d = r['시작일'] + (r['끝일'] ? '~' + r['끝일'] : '');
  return d + ' ' + r['행사명'] + (r['구분'] && r['구분'] !== '행사' ? ' (' + r['구분'] + ')' : '') + (r['중요'] === '예' ? ' [중요]' : '');
}

function apiSchedSave_(args, actor, ctx) {
  var rec = cleanEvent_(args.fields || {});
  ensureCols_('일정'); // '중요' 칸이 없는 예전 시트도 그대로 쓸 수 있게
  if ((rec['구분'] === '휴업일' || rec['구분'] === '공휴일') && !canManage_(ctx)) {
    throw userError_('휴업일·공휴일은 수업일수에 영향을 줘서 연구부장·부담당만 넣을 수 있어요.');
  }
  var depts = categoryNames_('부서'), names = staffNames_();
  if (args.id) {
    var row = findRow_('일정', String(args.id));
    if (!row || row['삭제 여부']) throw userError_('이 일정을 찾지 못했어요. 이미 지워졌을 수 있어요.');
    if (!canEditEvent_(row, ctx)) throw userError_('처음 넣은 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
    if ((row['구분'] === '휴업일' || row['구분'] === '공휴일') && !canManage_(ctx)) {
      throw userError_('휴업일·공휴일은 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
    }
    updateRow_('일정', row['일정ID'], rec, actor, '일정 고침: ' + eventSummary_(rec));
    return eventView_(findRow_('일정', row['일정ID']), ctx, depts, names);
  }
  var added = insertRow_('일정', rec, actor, '일정 추가: ' + eventSummary_(rec));
  return eventView_(findRow_('일정', added['일정ID']), ctx, depts, names);
}

function apiSchedDelete_(args, actor, ctx) {
  var row = findRow_('일정', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('이 일정을 찾지 못했어요. 이미 지워졌을 수 있어요.');
  if (!canEditEvent_(row, ctx)) throw userError_('처음 넣은 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  if ((row['구분'] === '휴업일' || row['구분'] === '공휴일') && !canManage_(ctx)) {
    throw userError_('휴업일·공휴일은 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  }
  softDelete_('일정', row['일정ID'], actor, '일정 지움: ' + eventSummary_(row));
  return { done: true };
}

// ---------------------------------------------------------------- 월별 중점지도

function focusOf_(schoolYear, month) {
  var rows = liveRows_('월별중점').filter(function (r) {
    return String(r['학년도']) === String(schoolYear) && String(Number(r['월'])) === String(month);
  });
  var r = rows[rows.length - 1];
  return { year: schoolYear, month: month, text: r ? r['중점지도 내용'] : '', id: r ? r['중점ID'] : '' };
}

function apiFocusSave_(args, actor, ctx) {
  if (!canManage_(ctx)) throw userError_('중점지도는 연구부장·부담당이 넣어요.', 'FORBIDDEN');
  var y = Number(args.year), m = Number(args.month);
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12)) throw userError_('달을 다시 골라 주세요.');
  var text = cleanText_(args.text, 500, '중점지도 내용');
  var cur = focusOf_(y, m);
  if (cur.id) {
    updateRow_('월별중점', cur.id, { '중점지도 내용': text }, actor, y + '학년도 ' + m + '월 중점지도 고침');
  } else if (text) {
    insertRow_('월별중점', { '학년도': String(y), '월': String(m), '중점지도 내용': text }, actor, y + '학년도 ' + m + '월 중점지도 넣음');
  }
  return focusOf_(y, m);
}

// ---------------------------------------------------------------- 수업일수

/**
 * from~to 사이 수업일수 = 평일(월~금) − 휴업일·공휴일이 걸린 평일(겹치면 한 번만)
 * 학기 기간 밖의 날은 세지 않는다. 학기 기간이 없으면 null.
 */
function instructionalDays_(from, to) {
  var sems = semesters_();
  if (!sems.length) return null;
  var off = offDays_(from, to);
  var weekdays = 0, removed = 0;
  for (var d = from; d <= to; d = addDays_(d, 1)) {
    var w = weekday_(d);
    if (w === 0 || w === 6) continue;
    if (!sems.some(function (s) { return d >= s.from && d <= s.to; })) continue;
    weekdays++;
    if (off[d]) removed++;
  }
  return { weekdays: weekdays, off: removed, days: weekdays - removed };
}

/** 설정의 학기 기간(들어 있는 것만) */
function semesters_() {
  var out = [];
  [['1학기', '1학기 시작일', '1학기 끝일'], ['2학기', '2학기 시작일', '2학기 끝일']].forEach(function (s) {
    var a = setting_(s[1]), b = setting_(s[2]);
    if (isDate_(a) && isDate_(b) && a <= b) out.push({ name: s[0], from: a, to: b });
  });
  return out;
}

/**
 * 휴업일·공휴일이 걸린 날 → [이름들]
 * extra(올리기 미리보기용): { add: [더할 일정 행], skip: {빼고 셀 일정ID: true} }
 */
function offDays_(from, to, extra) {
  var m = {};
  var rows = liveRows_('일정');
  if (extra) rows = rows.filter(function (e) { return !(extra.skip || {})[e['일정ID']]; }).concat(extra.add || []);
  rows.forEach(function (e) {
    if (e['구분'] !== '휴업일' && e['구분'] !== '공휴일') return;
    var a = e['시작일'] > from ? e['시작일'] : from;
    var b = eventEnd_(e) < to ? eventEnd_(e) : to;
    for (var d = a; d <= b; d = addDays_(d, 1)) (m[d] = m[d] || []).push(e['행사명']);
  });
  return m;
}

/** 학기별 수업일수와 계산 근거 (extra는 offDays_와 같음) */
function semesterDays_(year, extra) {
  var r = schoolYearRange_(year);
  var sems = semesters_().filter(function (s) { return s.to >= r.from && s.from <= r.to; });
  var total = 0;
  var list = sems.map(function (s) {
    var weekdays = 0;
    var removed = [];
    var off = offDays_(s.from, s.to, extra);
    for (var d = s.from; d <= s.to; d = addDays_(d, 1)) {
      var w = weekday_(d);
      if (w === 0 || w === 6) continue;
      weekdays++;
      if (off[d]) removed.push({ date: d, names: off[d] });
    }
    total += weekdays - removed.length;
    return { name: s.name, from: s.from, to: s.to, weekdays: weekdays, removed: removed, days: weekdays - removed.length };
  });
  return { semesters: list, total: total, missing: sems.length < 2 };
}

// ---------------------------------------------------------------- 휴지통 (관리자)

function adminTrashList_() {
  var depts = categoryNames_('부서'), names = staffNames_();
  return sortEvents_(readRows_('일정').filter(function (e) { return e['삭제 여부']; })).reverse().slice(0, 200).map(function (e) {
    var v = eventView_(e, { identity: null, tokens: {} }, depts, names);
    v.deletedBy = names[e['수정자ID']] || '';
    v.deletedAt = e['수정 시각'];
    return v;
  });
}

function adminTrashRestore_(args, actor) {
  var row = findRow_('일정', String(args.id || ''));
  if (!row || !row['삭제 여부']) throw userError_('되살릴 일정을 찾지 못했어요.');
  restoreRow_('일정', row['일정ID'], actor, '일정 되살림: ' + eventSummary_(row));
  return { done: true };
}

// ---------------------------------------------------------------- 테스트용 가짜 일정

/** 오늘을 기준으로 이번 달·다음 달에 가짜 일정을 넣는다(테스트 시트 전용) */
function seedTestSchedule_() {
  if (liveRows_('일정').length) throw userError_('일정 탭에 이미 일정이 있어요. 가짜 일정은 빈 테스트 시트에만 넣을 수 있어요.');
  var d = {};
  liveRows_('분류').forEach(function (c) { if (c['종류'] === '부서') d[c['이름']] = c['분류ID']; });
  var dept = function (n) { return d[n] || ''; };
  var actor = { id: '', name: '테스트 데이터' };
  var mon = mondayOf_(todayYmd_());
  var at = function (n) { return addDays_(mon, n); };
  var list = [
    [0, '', '08:40', '교직원 협의회', '교직원', '교무부', '교무실', '행사'],
    [0, '', '5교시', '안전점검의 날 대피 훈련', '전체', '인성안전부', '운동장', '행사', '예'],
    [0, '', '15:00', '학년별 교육과정 협의', '교직원', '연구부', '학년 협의실', '행사'],
    [1, '', '종일', '3·4학년 현장체험학습', '3,4', '연구부', '', '행사'],
    [1, '', '', '학생자치회의', '5,6', '인성안전부', '', '교육활동'],
    [2, '', '5교시', '동료장학 수업 공개', '교직원', '연구부', '', '행사'],
    [3, '', '16:00', '학교운영위원회', '교직원', '교무부', '회의실', '행사'],
    [4, '', '15:00', '교직원 체육대회', '교직원', '교무부', '체육관', '행사'],
    [7, '', '', '테스트 공휴일', '전체', '', '', '공휴일'],
    [8, '', '', '독서 골든벨', '3,4,5,6', '교무부', '도서실', '교육활동'],
    [9, '', '', '정보화기기 점검', '전체', '정보부', '', '행사'],
    [11, '', '', '테스트 재량휴업일', '전체', '', '', '휴업일'],
    [14, 18, '', '독도교육주간', '전체', '인성안전부', '', '교육활동'],
    [16, '', '', '환경 정화 활동', '1,2', '인성안전부', '', '교육활동'],
    [21, '', '', '학교폭력 예방교육', '전체', '인성안전부', '강당', '교육활동', '예'],
    [28, '', '', '교육과정 협의회', '교직원', '연구부', '', '행사']
  ];
  ensureCols_('일정');
  withLock_(function () {
    list.forEach(function (x) {
      insertRow_('일정', {
        '시작일': at(x[0]), '끝일': x[1] === '' ? '' : at(x[1]), '시간': x[2], '행사명': x[3], '대상 학년': x[4],
        '담당 부서ID': dept(x[5]), '장소': x[6], '구분': x[7], '중요': x[8] || ''
      }, actor, '가짜 일정');
    });
    var t = todayYmd_(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    insertRow_('월별중점', { '학년도': String(m >= 3 ? y : y - 1), '월': String(m), '중점지도 내용': '학생 안전지도와 학교폭력 예방교육\n자전거로 오는 학생은 헬멧 쓰기' }, actor, '가짜 중점지도');
  });
  return list.length;
}

// ---------------------------------------------------------------- 학사일정 한 번에 올리기 (연구부장·부담당)
//
// 1) 화면이 엑셀·CSV 파일이나 붙여 넣은 표를 칸 목록(grid)으로 보낸다 → 2) 여기서 머리글을 찾아 줄마다 읽고 확인한다
// 3) 미리보기에서 고치거나 뺀 줄(rows)을 다시 보낸다 → 4) 올리기: 한 묶음ID로 넣고, '방금 올린 것 되돌리기'를 할 수 있다
// - 부서가 직접 넣은 행사(묶음ID 없음)는 지우거나 바꾸지 않는다. 같은 행사가 있으면 건너뛴다
// - 전에 올린 같은 행사는 '건너뛰기' 또는 '바꾸기'(전 것은 숨김 삭제, 되돌리기로 다시 살아남)

function requireManage_(ctx) {
  if (!canManage_(ctx)) throw userError_('학사일정 올리기는 연구부장·부담당만 할 수 있어요.', 'FORBIDDEN');
}

/** 머리글 이름 → 칸 */
function uploadHeads_() {
  return {
    start: ['시작일', '날짜', '일자', '시작 날짜', '시작'],
    end: ['끝일', '끝나는 날', '종료일', '끝 날짜', '마치는 날'],
    time: ['시간', '교시', '시각'],
    title: ['행사명', '행사', '행사 이름', '내용', '제목', '교육활동'],
    target: ['대상', '대상 학년', '학년'],
    dept: ['담당 부서', '부서', '담당'],
    place: ['장소'],
    kind: ['구분', '종류'],
    memo: ['메모', '비고'],
    important: ['중요']
  };
}

function uploadCols_() {
  return ['start', 'end', 'time', 'title', 'target', 'dept', 'place', 'kind', 'memo', 'important'];
}

function normHead_(s) {
  return String(s || '').replace(/[\s*()]/g, '').replace(/\(.*\)/, '');
}

/** 칸 목록 → 줄 목록. 앞 5줄 안에서 머리글을 찾고, 없으면 양식 순서로 읽는다 */
function gridToRows_(grid) {
  var heads = uploadHeads_();
  var map = null, startAt = 0;
  for (var i = 0; i < Math.min(5, grid.length) && !map; i++) {
    var m = {};
    (grid[i] || []).forEach(function (cell, j) {
      var h = normHead_(cell);
      Object.keys(heads).forEach(function (k) {
        if (m[k] === undefined && heads[k].some(function (a) { return normHead_(a) === h; })) m[k] = j;
      });
    });
    if (m.title !== undefined && m.start !== undefined) { map = m; startAt = i + 1; }
  }
  if (!map) {
    map = {};
    uploadCols_().forEach(function (k, j) { map[k] = j; });
  }
  var rows = [];
  for (var r = startAt; r < grid.length; r++) {
    var line = grid[r] || [];
    if (!line.some(function (c) { return String(c || '').trim(); })) continue;
    var o = {};
    uploadCols_().forEach(function (k) { o[k] = map[k] === undefined ? '' : String(line[map[k]] === undefined || line[map[k]] === null ? '' : line[map[k]]).trim(); });
    rows.push(o);
  }
  return rows;
}

/**
 * 날짜 글자 → 'yyyy-MM-dd'. 연도가 없으면 학년도로 채운다(3~12월 = 학년도, 1·2월 = 다음 해)
 * 읽는 모양: 2026-03-02, 2026.3.2., 2026/3/2, 2026년 3월 2일, 3/2, 3.2.(월), 3월 2일, 엑셀 날짜 숫자(46083)
 * 돌려주는 값: { ymd } 또는 { err }
 */
function parseDay_(v, schoolYear) {
  var s = String(v || '').trim().replace(/\([^)]*\)/g, '').replace(/\s*(월|화|수|목|금|토|일)요일\s*$/, '').trim().replace(/\.$/, '');
  if (!s) return { err: '' };
  var y, m, d, hit;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    var t = Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000;
    return { ymd: utcToYmd_(t) };
  }
  if ((hit = /^(\d{4})\s*[-.\/년]\s*(\d{1,2})\s*[-.\/월]\s*(\d{1,2})\s*일?$/.exec(s))) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
  else if ((hit = /^(\d{1,2})\s*[-.\/월]\s*(\d{1,2})\s*일?$/.exec(s))) { m = +hit[1]; d = +hit[2]; y = m >= 3 ? schoolYear : schoolYear + 1; }
  else return { err: '날짜를 읽지 못했어요' };
  var ymd = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  if (!isDate_(ymd)) return { err: '없는 날짜예요(' + m + '월 ' + d + '일)' };
  return { ymd: ymd };
}

/** '3·4학년', '3~6', '전교', '교직원' → '3,4' 같은 저장 글자 */
function parseTargetText_(v) {
  var s = String(v || '').trim();
  if (!s || /전체|전교|전학년/.test(s)) return /교직원|교원|교사/.test(s) ? '전체,교직원' : '전체';
  var list = [];
  s.replace(/([1-6])\s*[~\-–]\s*([1-6])/g, function (all, a, b) {
    for (var g = +a; g <= +b; g++) list.push(String(g));
    return '';
  }).replace(/[1-6]/g, function (g) { list.push(g); return ''; });
  if (/교직원|교원|교사/.test(s)) list.push('교직원');
  return cleanTarget_(list) || '';
}

function parseKind_(v) {
  var s = String(v || '').replace(/\s/g, '');
  if (!s) return '';
  if (/공휴/.test(s)) return '공휴일';
  if (/휴업|휴교|재량/.test(s)) return '휴업일';
  if (/교육활동|활동|교육/.test(s)) return '교육활동';
  if (/행사/.test(s)) return '행사';
  return null;
}

function titleKey_(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

/** 마지막으로 올린 묶음(되돌리기용) */
function lastUpload_() {
  var s = PropertiesService.getScriptProperties().getProperty('LAST_UPLOAD');
  return s ? safeParse_(s, null) : null;
}

/**
 * 줄마다 읽고 확인한다.
 * 줄 상태: ok(그대로 올림) / warn(확인 필요, 올릴 수는 있음) / error(올릴 수 없음)
 * dup: '' | 'dept'(부서가 넣은 같은 행사 → 늘 건너뜀) | 'upload'(전에 올린 같은 행사 → 건너뛰기·바꾸기) | 'file'(파일 안에 같은 줄)
 */
function uploadCheck_(rows) {
  var sy = Number(setting_('학년도')) || Number(todayYmd_().slice(0, 4));
  var deptIds = {};
  catOptions_('부서').forEach(function (d) { deptIds[normHead_(d.name)] = d.id; deptIds[normHead_(d.name).replace(/부$/, '')] = deptIds[normHead_(d.name).replace(/부$/, '')] || d.id; });
  var deptNames = categoryNames_('부서');
  var existing = {};
  liveRows_('일정').forEach(function (e) { (existing[e['시작일'] + '|' + titleKey_(e['행사명'])] = existing[e['시작일'] + '|' + titleKey_(e['행사명'])] || []).push(e); });
  var seen = {};
  return rows.map(function (raw, i) {
    var msgs = [], status = 'ok', dup = '';
    var warn = function (t) { msgs.push(t); if (status === 'ok') status = 'warn'; };
    var fail = function (t) { msgs.push(t); status = 'error'; };
    var title = String(raw.title || '').trim();
    var a = parseDay_(raw.start, sy);
    var b = raw.end ? parseDay_(raw.end, sy) : { ymd: '' };
    if (!a.ymd) fail(a.err || '날짜가 비어 있어요');
    if (raw.end && !b.ymd) fail('끝나는 날: ' + (b.err || '읽지 못했어요'));
    if (!title) fail('행사명이 비어 있어요');
    var kind = parseKind_(raw.kind);
    if (kind === '') { kind = '행사'; warn("구분이 비어 있어서 '행사'로 넣어요"); }
    else if (kind === null) { kind = '행사'; warn("구분 '" + raw.kind + "'" + josa_(String(raw.kind), '을', '를') + " 몰라서 '행사'로 넣어요"); }
    var deptId = '';
    if (String(raw.dept || '').trim()) {
      deptId = deptIds[normHead_(raw.dept)] || deptIds[normHead_(raw.dept).replace(/부$/, '')] || '';
      if (!deptId) warn("부서 '" + raw.dept + "'" + josa_(String(raw.dept), '이', '가') + ' 분류에 없어서 비워 두고 넣어요');
    }
    var target = parseTargetText_(raw.target);
    if (String(raw.target || '').trim() && !target) { target = '전체'; warn("대상 '" + raw.target + "'" + josa_(String(raw.target), '을', '를') + " 읽지 못해서 '전체'로 넣어요"); }
    var important = /^(예|o|y|yes|중요|●|○|v|✓|✔|1|true)$/i.test(String(raw.important || '').trim());
    if (/^0?\.\d+$/.test(String(raw.time || '').trim())) { // 엑셀 시각 칸(하루의 몇 분의 몇) → 09:00
      var mins = Math.round(Number(raw.time) * 1440);
      raw.time = ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + mins % 60).slice(-2);
    }
    var f = { start: a.ymd || '', end: b.ymd || '', time: raw.time, title: title, target: target || '전체', deptId: deptId, place: raw.place, kind: kind, memo: raw.memo, important: important };
    var rec = null;
    if (status !== 'error') {
      try { rec = cleanEvent_(f); } catch (e) { if (!e.userMessage) throw e; fail(e.userMessage); }
    }
    var example = /^\(?예시\)?/.test(title);
    if (example) warn('예시 줄이에요. 지우지 않았다면 빼고 올려요');
    if (rec) {
      var key = rec['시작일'] + '|' + titleKey_(rec['행사명']);
      var same = existing[key] || [];
      if (seen[key]) { dup = 'file'; warn('위의 ' + (seen[key] + 1) + '번째 줄과 같아요'); }
      else if (same.some(function (e) { return !e['올린 묶음ID']; })) { dup = 'dept'; warn('부서가 넣은 같은 행사가 있어서 건너뛰어요'); }
      else if (same.length) { dup = 'upload'; warn('전에 올린 같은 행사가 있어요'); }
      seen[key] = seen[key] === undefined ? i : seen[key];
    }
    var include = status !== 'error' && dup !== 'dept' && dup !== 'file' && !example;
    if (raw.include === false) include = false;
    else if (raw.include === true && status !== 'error' && dup !== 'dept') include = true;
    return {
      n: i + 1,
      raw: (function () { var o = {}; uploadCols_().forEach(function (k) { o[k] = raw[k] === undefined || raw[k] === null ? '' : String(raw[k]); }); return o; })(),
      start: f.start, end: f.end, title: title, target: f.target, dept: deptNames[deptId] || '', deptId: deptId, kind: kind, important: important,
      time: String(raw.time || ''), place: String(raw.place || ''), memo: String(raw.memo || ''),
      status: status, msgs: msgs, dup: dup, include: include,
      dupIds: rec ? (existing[rec['시작일'] + '|' + titleKey_(rec['행사명'])] || []).filter(function (e) { return e['올린 묶음ID']; }).map(function (e) { return e['일정ID']; }) : []
    };
  });
}

/** 올릴 줄과 바꿀(숨길) 전 행사 */
function uploadPlan_(checked, mode) {
  var add = [], replace = [], skipped = 0;
  checked.forEach(function (r) {
    if (!r.include || r.status === 'error' || r.dup === 'dept') { skipped++; return; }
    if (r.dup === 'upload') {
      if (mode !== 'replace') { skipped++; return; }
      replace = replace.concat(r.dupIds);
    }
    add.push(r);
  });
  return { add: add, replace: replace, skipped: skipped };
}

function uploadRec_(r, batch) {
  var rec = cleanEvent_({ start: r.start, end: r.end, time: r.time, title: r.title, target: r.target, deptId: r.deptId, place: r.place, kind: r.kind, memo: r.memo, important: r.important });
  rec['올린 묶음ID'] = batch;
  return rec;
}

/**
 * args = { grid } (처음 읽을 때) 또는 { rows } (미리보기에서 고친 뒤), mode: 'skip' | 'replace'
 */
function apiUploadCheck_(args, actor, ctx) {
  requireManage_(ctx);
  var rows = args.grid ? gridToRows_(args.grid) : (args.rows || []);
  if (rows.length > 1000) throw userError_('한 번에 1000줄까지 올릴 수 있어요. 나눠서 올려 주세요.');
  var checked = uploadCheck_(rows);
  var plan = uploadPlan_(checked, args.mode);
  var sy = Number(setting_('학년도')) || Number(todayYmd_().slice(0, 4));
  var skip = {};
  plan.replace.forEach(function (id) { skip[id] = true; });
  var addOff = plan.add.filter(function (r) { return r.kind === '휴업일' || r.kind === '공휴일'; })
    .map(function (r) { return { '시작일': r.start, '끝일': r.end, '구분': r.kind, '행사명': r.title }; });
  return {
    rows: checked,
    counts: {
      total: checked.length,
      warn: checked.filter(function (r) { return r.status === 'warn'; }).length,
      error: checked.filter(function (r) { return r.status === 'error'; }).length,
      dupUpload: checked.filter(function (r) { return r.dup === 'upload'; }).length,
      add: plan.add.length,
      replace: plan.replace.length
    },
    days: { now: semesterDays_(sy), after: semesterDays_(sy, { add: addOff, skip: skip }) },
    last: lastUpload_()
  };
}

function apiUploadSave_(args, actor, ctx) {
  requireManage_(ctx);
  var rows = args.rows || [];
  if (rows.length > 1000) throw userError_('한 번에 1000줄까지 올릴 수 있어요. 나눠서 올려 주세요.');
  var mode = args.mode === 'replace' ? 'replace' : 'skip';
  return withLock_(function () {
    ensureCols_('일정');
    var plan = uploadPlan_(uploadCheck_(rows), mode);
    if (!plan.add.length) throw userError_('올릴 행사가 없어요. 미리보기에서 넣을 줄을 골라 주세요.');
    var batch = 'B' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMddHHmmss');
    var recs = plan.add.map(function (r) { return uploadRec_(r, batch); });
    if (plan.replace.length) updateRowsSame_('일정', plan.replace, { '삭제 여부': '삭제' }, actor, '학사일정 올리기(' + batch + '): 전에 올린 같은 행사 ' + plan.replace.length + '개를 바꿈', '삭제');
    insertRows_('일정', recs, actor, '학사일정 올리기(' + batch + '): 행사 ' + recs.length + '개');
    var info = { batch: batch, count: recs.length, replaced: plan.replace, at: nowText_(), by: actor.name || '' };
    PropertiesService.getScriptProperties().setProperty('LAST_UPLOAD', JSON.stringify(info));
    return { batch: batch, added: recs.length, replaced: plan.replace.length, skipped: plan.skipped, last: info };
  });
}

/** 방금(마지막으로) 올린 묶음만 되돌린다: 올린 행사는 숨김 삭제, 바꿨던 전 행사는 되살림 */
function apiUploadUndo_(args, actor, ctx) {
  requireManage_(ctx);
  return withLock_(function () {
    var last = lastUpload_();
    if (!last || last.batch !== args.batch || last.undone) throw userError_('방금 올린 것만 되돌릴 수 있어요. 화면을 새로 고쳐 주세요.');
    var ids = liveRows_('일정').filter(function (e) { return e['올린 묶음ID'] === last.batch; }).map(function (e) { return e['일정ID']; });
    var removed = updateRowsSame_('일정', ids, { '삭제 여부': '삭제' }, actor, '학사일정 올리기 되돌림(' + last.batch + '): ' + ids.length + '개 숨김', '삭제');
    var restored = updateRowsSame_('일정', last.replaced || [], { '삭제 여부': '' }, actor, '학사일정 올리기 되돌림(' + last.batch + '): 바꿨던 행사 되살림', '되살리기');
    last.undone = true;
    PropertiesService.getScriptProperties().setProperty('LAST_UPLOAD', JSON.stringify(last));
    return { removed: removed, restored: restored };
  });
}

function apiUploadInfo_(args, actor, ctx) {
  requireManage_(ctx);
  return { last: lastUpload_(), depts: deptOptions_(), year: setting_('학년도') };
}
