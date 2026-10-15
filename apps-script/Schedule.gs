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

/** 일정을 고치거나 지울 수 있는지: 처음 넣은 사람 / 역할 '관리' / 관리자 화면 열림 */
function canManage_(ctx) {
  if (ctx.tokens && ctx.tokens.admin && checkAdmin_(ctx.tokens.admin)) return true;
  return !!(ctx.identity && ctx.identity['역할'] === '관리');
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
    library: homeLibrary_(ctx)
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

/** 휴업일·공휴일이 걸린 날 → [이름들] */
function offDays_(from, to) {
  var m = {};
  liveRows_('일정').forEach(function (e) {
    if (e['구분'] !== '휴업일' && e['구분'] !== '공휴일') return;
    var a = e['시작일'] > from ? e['시작일'] : from;
    var b = eventEnd_(e) < to ? eventEnd_(e) : to;
    for (var d = a; d <= b; d = addDays_(d, 1)) (m[d] = m[d] || []).push(e['행사명']);
  });
  return m;
}

/** 학기별 수업일수와 계산 근거 */
function semesterDays_(year) {
  var r = schoolYearRange_(year);
  var sems = semesters_().filter(function (s) { return s.to >= r.from && s.from <= r.to; });
  var total = 0;
  var list = sems.map(function (s) {
    var weekdays = 0;
    var removed = [];
    var off = offDays_(s.from, s.to);
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
