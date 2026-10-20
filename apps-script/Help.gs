/**
 * Help.gs — 도움말, 교직원 명단, 홈 검색
 *
 * - 도움말: 분류(복무·인사, 학교 규칙·제규정 등 '도움말 분류')별 안내 글. 내용은 학교에서 넣는다(앱이 규정을 지어내지 않음)
 *   넣기: 이름을 고른 교직원 누구나. 고치기·지우기: 처음 넣은 분과 관리
 * - 교직원 명단: 사용 중인 분의 직위·소속·부서·담당 업무·내선(개인 연락처는 없음)
 * - 검색: 자료·일정·교직원·도움말·조사·공지를 한 번에 찾는다
 * - 공지: 홈 공지 카드(아래)
 */

function fileMark_Help_() { return '2026-10-16'; } // 판 표시(관리자 › 점검)

// ---------------------------------------------------------------- 도움말

function helpView_(r, ctx, kinds, names) {
  return {
    id: r['항목ID'],
    kindId: r['분류ID'],
    kind: kinds[r['분류ID']] || '',
    title: r['제목'],
    body: r['내용'],
    link: r['링크'],
    hasFile: !!r['파일ID'],
    fileName: r['파일 이름'],
    fileSize: Number(r['파일 크기']) || 0,
    order: r['순서'],
    by: names[r['입력자ID']] || '',
    updated: (r['수정 시각'] || r['입력 시각'] || '').slice(0, 10),
    home: r['홈에 보이기'] === '예',
    canEdit: canEditOwned_(r, ctx)
  };
}

function sortHelp_(list, kindOrder) {
  return list.sort(function (a, b) {
    return (kindOrder[a.kindId] === undefined ? 999 : kindOrder[a.kindId]) - (kindOrder[b.kindId] === undefined ? 999 : kindOrder[b.kindId]) ||
      (Number(a.order) || 999) - (Number(b.order) || 999) || a.title.localeCompare(b.title, 'ko');
  });
}

function apiHelpList_(args, actor, ctx) {
  var kinds = catOptions_('도움말 분류');
  var kindNames = categoryNames_('도움말 분류'), names = staffNames_();
  var order = {};
  kinds.forEach(function (k, i) { order[k.id] = i; });
  var items = liveRows_('도움말').map(function (r) { return helpView_(r, ctx, kindNames, names); });
  return { items: sortHelp_(items, order), kinds: kinds, canManage: canManage_(ctx), maxMb: fileLimitMb_() };
}

/**
 * args = { id?, fields: { 분류ID, 제목, 내용, 링크, 순서, mode: 'none'|'file' }, file?: { name, type, data } }
 */
function apiHelpSave_(args, actor, ctx) {
  var f = args.fields || {};
  var rec = {
    '분류ID': checkCat_(f['분류ID'], '도움말 분류', '분류'),
    '제목': cleanText_(f['제목'], 60, '제목', true),
    '내용': cleanText_(f['내용'], 5000, '내용'),
    '링크': cleanUrl_(f['링크'], '링크'),
    '순서': cleanText_(f['순서'], 3, '순서')
  };
  if (rec['순서'] && !/^\d+$/.test(rec['순서'])) throw userError_('순서는 숫자로 적어 주세요.');
  if (!rec['분류ID']) throw userError_('분류를 골라 주세요.');
  var row = null;
  if (args.id) {
    row = findRow_('도움말', String(args.id));
    if (!row || row['삭제 여부']) throw userError_('도움말을 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    if (!canEditOwned_(row, ctx)) throw userError_('처음 넣은 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
  }
  // 홈 '비상 시 이것부터'에 보이기: 관리만, 3개까지(2026-10-19a)
  if (canManage_(ctx) && f.home !== undefined) {
    rec['홈에 보이기'] = f.home ? '예' : '';
    if (f.home && (!row || row['홈에 보이기'] !== '예')) {
      var on = liveRows_('도움말').filter(function (r) { return r['홈에 보이기'] === '예'; }).length;
      if (on >= HOME_HELP_MAX_) throw userError_("홈 '비상 시 이것부터'에는 " + HOME_HELP_MAX_ + '개까지 보여요. 다른 글의 \'홈에 보이기\'를 끄고 다시 해 주세요.');
    }
  }
  if (f.removeFile) {
    rec['파일ID'] = '';
    rec['파일 이름'] = '';
    rec['파일 크기'] = '';
  }
  var keepsFile = !f.removeFile && row && row['파일ID'];
  if (!rec['내용'] && !rec['링크'] && !args.file && !keepsFile) throw userError_('내용을 적거나 링크·파일을 넣어 주세요.');
  ensureCols_('도움말');
  if (args.file) {
    var up = saveUpload_(args.file);
    rec['파일ID'] = up.id;
    rec['파일 이름'] = up.name;
    rec['파일 크기'] = String(up.size);
  }
  var saved = row
    ? updateRow_('도움말', row['항목ID'], rec, actor, '도움말 고침: ' + rec['제목'])
    : insertRow_('도움말', rec, actor, '도움말 추가: ' + rec['제목']);
  return helpView_(findRow_('도움말', saved['항목ID']), ctx, categoryNames_('도움말 분류'), staffNames_());
}

// ---------------------------------------------------------------- 안전·생활교육 안내 + 홈 '비상 시 이것부터' (2026-10-19a)
// 관리가 '안전·생활교육 안내 만들기'를 누르면 도움말 분류와 빈 글 2개가 생긴다. 내용은 학교에서 적는다(지어내지 않음, '여기에 적어 주세요')
var SAFETY_KIND_ = '안전·생활교육';
var SAFETY_POSTS_ = ['대피 경로·집결지', '학교폭력 사안 처리 순서'];
var HOME_HELP_MAX_ = 3;

function apiHelpSeedSafety_(args, actor, ctx) {
  return withLock_(function () {
    var cat = liveRows_('분류').filter(function (r) { return r['종류'] === '도움말 분류' && r['이름'] === SAFETY_KIND_; })[0];
    if (!cat) cat = insertRow_('분류', { '종류': '도움말 분류', '이름': SAFETY_KIND_, '순서': '', '사용 여부': '사용' }, actor, '도움말 분류 "' + SAFETY_KIND_ + '" 추가(안전·생활교육 안내 만들기)');
    else if (cat['사용 여부'] === '사용 안 함') updateRow_('분류', cat['분류ID'], { '사용 여부': '사용' }, actor, '도움말 분류 "' + SAFETY_KIND_ + '" 다시 사용');
    var kindId = cat['분류ID'], have = {}, made = 0;
    liveRows_('도움말').forEach(function (r) { if (r['분류ID'] === kindId) have[r['제목']] = true; });
    ensureCols_('도움말');
    SAFETY_POSTS_.forEach(function (title, i) {
      if (have[title]) return;
      insertRow_('도움말', { '분류ID': kindId, '제목': title, '내용': '여기에 적어 주세요', '순서': String(i + 1) }, actor, '도움말 추가: ' + title + '(안전·생활교육 안내 만들기)');
      made++;
    });
    return { kindId: kindId, kind: SAFETY_KIND_, made: made };
  });
}

/** 홈 '비상 시 이것부터': '홈에 보이기'를 켠 도움말 3개까지(분류 순서 → 순서 → 제목) */
function homeHelp_(ctx) {
  var rows = liveRows_('도움말').filter(function (r) { return r['홈에 보이기'] === '예'; });
  if (!rows.length) return [];
  var order = {}, kindNames = categoryNames_('도움말 분류'), names = staffNames_();
  catOptions_('도움말 분류').forEach(function (k, i) { order[k.id] = i; });
  return sortHelp_(rows.map(function (r) { return helpView_(r, ctx, kindNames, names); }), order).slice(0, HOME_HELP_MAX_).map(function (h) {
    return { id: h.id, title: h.title, kind: h.kind, body: String(h.body || '').slice(0, 160), hasFile: h.hasFile, link: h.link };
  });
}

function apiHelpDelete_(args, actor, ctx) {
  var row = findRow_('도움말', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('도움말을 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  if (!canEditOwned_(row, ctx)) throw userError_('처음 넣은 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  softDelete_('도움말', row['항목ID'], actor, '도움말 지움: ' + row['제목']);
  return { done: true };
}

// ---------------------------------------------------------------- 교직원 명단

function staffDirView_(r, depts) {
  return {
    id: r['교직원ID'],
    name: r['이름'],
    position: r['직위'],
    group: r['소속'],
    deptId: r['부서ID'],
    dept: depts[r['부서ID']] || '',
    duty: r['담당 업무'],
    ext: r['내선']
  };
}

function apiStaffDir_() {
  var depts = categoryNames_('부서');
  return {
    staff: sortStaff_(activeStaff_()).map(function (r) { return staffDirView_(r, depts); }),
    depts: deptOptions_()
  };
}

// ---------------------------------------------------------------- 홈 검색

/** 낱말을 모두 품고 있으면 맞음(띄어쓰기·대소문자 무시) */
function searchTerms_(q) {
  return String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function matchAll_(terms, fields) {
  var hay = fields.join(' ').toLowerCase();
  var flat = hay.replace(/\s+/g, '');
  return terms.every(function (t) { return hay.indexOf(t) >= 0 || flat.indexOf(t) >= 0; });
}

/**
 * args = { q }
 * 돌려주는 값: { q, library, events, staff, help, surveys } 각 { total, items(앞 몇 개) }
 */
function apiSearch_(args, actor, ctx) {
  var q = String(args.q || '').trim().slice(0, 40);
  var terms = searchTerms_(q);
  var empty = { total: 0, items: [] };
  if (!terms.length) return { q: q, library: empty, events: empty, staff: empty, help: empty, surveys: empty, notices: empty };
  var depts = categoryNames_('부서');
  var names = staffNames_();
  function pack(list, n) { return { total: list.length, items: list.slice(0, n) }; }

  // 자료: 지금 학년도 먼저, 보관함은 뒤에
  var c = libCache_();
  var lib = liveRows_('자료').map(function (r) { return libView_(r, ctx, c); }).filter(function (v) {
    return matchAll_(terms, [v.title, v.desc, v.dept, v.kind, v.owner, v.fileName, v.year]);
  }).sort(function (a, b) {
    return (a.archived - b.archived) || (b.year > a.year ? 1 : b.year < a.year ? -1 : 0) || a.title.localeCompare(b.title, 'ko');
  });

  // 일정: 오늘부터 다가오는 것 먼저(가까운 순), 지난 것은 뒤에(최근 순)
  var today = todayYmd_();
  var evs = sortEvents_(liveRows_('일정').filter(function (e) {
    return e['시작일'] && matchAll_(terms, [e['행사명'], e['장소'], e['메모'], depts[e['담당 부서ID']] || '', e['구분']]);
  })).map(function (e) { return eventView_(e, ctx, depts, names); });
  var next = evs.filter(function (e) { return e.end >= today; });
  var past = evs.filter(function (e) { return e.end < today; }).reverse();

  var staff = sortStaff_(activeStaff_()).filter(function (r) {
    return matchAll_(terms, [r['이름'], r['직위'], r['소속'], depts[r['부서ID']] || '', r['담당 업무'], r['내선']]);
  }).map(function (r) { return staffDirView_(r, depts); });

  var helpKinds = categoryNames_('도움말 분류');
  var help = liveRows_('도움말').map(function (r) { return helpView_(r, ctx, helpKinds, names); }).filter(function (h) {
    return matchAll_(terms, [h.title, h.body, h.kind, h.fileName]);
  });

  // 조사: 조사 화면에 보이는 것만(대상이거나, 만든 분이거나, 관리). 대상이 아닌 분께 제목이 보이지 않게
  var cache = surveyCache_(), meId = ctx.identity ? ctx.identity['교직원ID'] : '', manage = canManage_(ctx);
  var surveys = (meId || manage ? liveRows_('조사') : []).filter(function (s) {
    return matchAll_(terms, [s['제목'], s['설명'], depts[s['부서ID']] || '']);
  }).map(function (s) { return surveyCard_(s, ctx, cache); }).filter(function (c) {
    return c.inTarget || (meId && c.byId === meId) || manage;
  }).sort(function (a, b) {
    return (a.closed - b.closed) || (a.deadline < b.deadline ? 1 : a.deadline > b.deadline ? -1 : 0);
  });

  return {
    q: q,
    today: today,
    library: pack(lib, 6),
    events: pack(next.concat(past), 6),
    staff: pack(staff, 6),
    help: pack(help, 6),
    surveys: pack(surveys, 4),
    notices: pack(noticeViews_(ctx).filter(function (n) { return matchAll_(terms, [n.title, n.body, n.dept]); }), 4)
  };
}

// ---------------------------------------------------------------- 공지 (홈 공지 카드)
// - 쓰기: 이름을 고른 교직원 누구나. 고치기·지우기: 쓴 분과 관리. '맨 위 고정'은 관리만
// - '게시 끝일'이 지나면 홈에서 내려가고, 공지 화면의 '지난 공지'에 남는다

function noticeView_(r, ctx, depts, names, today) {
  return {
    id: r['공지ID'],
    title: r['제목'],
    body: r['내용'],
    link: r['링크'],
    deptId: r['부서ID'],
    dept: depts[r['부서ID']] || '',
    until: r['게시 끝일'],
    pinned: r['고정'] === '예',
    active: !r['게시 끝일'] || r['게시 끝일'] >= today,
    by: names[r['입력자ID']] || '',
    at: r['입력 시각'],
    updated: r['수정 시각'],
    canEdit: canEditOwned_(r, ctx)
  };
}

function noticeViews_(ctx) {
  var depts = categoryNames_('부서'), names = staffNames_(), today = todayYmd_();
  return liveRows_('공지').map(function (r) { return noticeView_(r, ctx, depts, names, today); }).sort(function (a, b) {
    return (b.active - a.active) || (b.active && a.active ? b.pinned - a.pinned : 0) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  });
}

function apiNoticeList_(args, actor, ctx) {
  var all = noticeViews_(ctx), sy = curSchoolYear_(), older = !!(args && args.older);
  // 지난 공지는 이번 학년도(게시 끝일로) 것만 먼저 보낸다. '이전 학년도 보기'(args.older)를 누르면 모두
  var items = older ? all : all.filter(function (n) { return n.active || schoolYearOf_(n.until) >= sy; });
  return { items: items, olderCount: all.length - items.length, older: older, canManage: canManage_(ctx), depts: deptOptions_(), today: todayYmd_() };
}

/** 지금 걸린 공지 중 가장 최근에 올라온 시각(화면의 '새 공지' 점 표시용, 기기마다 본 시각과 비교) */
function latestNoticeAt_() {
  var t = todayYmd_(), last = '';
  liveRows_('공지').forEach(function (r) {
    if (r['게시 끝일'] && r['게시 끝일'] < t) return;
    if (r['입력 시각'] > last) last = r['입력 시각'];
  });
  return last;
}

/** 홈: 지금 걸린 공지(고정 먼저, 새것 먼저) 4개까지 */
function homeNotices_(ctx) {
  var list = noticeViews_(ctx).filter(function (n) { return n.active; });
  return { items: list.slice(0, 4), total: list.length };
}

/** args = { id?, fields: { 제목, 내용, 링크, 부서ID, 게시 끝일, pinned } } */
function apiNoticeSave_(args, actor, ctx) {
  var f = args.fields || {};
  var rec = {
    '제목': cleanText_(f['제목'], 60, '제목', true),
    '내용': cleanText_(f['내용'], 2000, '내용'),
    '링크': cleanUrl_(f['링크'], '링크'),
    '부서ID': checkCat_(f['부서ID'], '부서', '부서'),
    '게시 끝일': String(f['게시 끝일'] || '').trim()
  };
  if (rec['게시 끝일'] && !isDate_(rec['게시 끝일'])) throw userError_('게시 끝일을 날짜로 골라 주세요.');
  if (canManage_(ctx) && f.pinned !== undefined) rec['고정'] = f.pinned ? '예' : '';
  var row = null;
  if (args.id) {
    row = findRow_('공지', String(args.id));
    if (!row || row['삭제 여부']) throw userError_('공지를 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    if (!canEditOwned_(row, ctx)) throw userError_('쓴 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
  }
  var saved = row
    ? updateRow_('공지', row['공지ID'], rec, actor, '공지 고침: ' + rec['제목'])
    : insertRow_('공지', rec, actor, '공지 추가: ' + rec['제목']);
  return noticeView_(findRow_('공지', saved['공지ID']), ctx, categoryNames_('부서'), staffNames_(), todayYmd_());
}

function apiNoticeDelete_(args, actor, ctx) {
  var row = findRow_('공지', String(args.id || ''));
  if (!row || row['삭제 여부']) throw userError_('공지를 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  if (!canEditOwned_(row, ctx)) throw userError_('쓴 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  softDelete_('공지', row['공지ID'], actor, '공지 지움: ' + row['제목']);
  return { done: true };
}

/** 테스트용 가짜 공지 3개(하나는 지난 공지) */
function seedTestNotices_() {
  if (liveRows_('공지').length) throw userError_('공지 탭에 이미 공지가 있어요. 가짜 공지는 빈 테스트 시트에만 넣을 수 있어요.');
  var d = {};
  liveRows_('분류').forEach(function (c) { if (c['종류'] === '부서') d[c['이름']] = c['분류ID']; });
  var t = todayYmd_(), actor = { id: '', name: '테스트 데이터' };
  withLock_(function () {
    insertRow_('공지', { '제목': '온라인 교무실을 시험 중이에요(가짜 공지)', '내용': '불편한 점은 연구부로 알려 주세요.', '부서ID': d['연구부'] || '', '게시 끝일': addDays_(t, 14), '고정': '예' }, actor, '가짜 공지');
    insertRow_('공지', { '제목': '교실 안전점검표 제출 안내(가짜)', '내용': '이번 주 금요일까지 자료실의 점검표를 내 주세요.', '부서ID': d['인성안전부'] || '', '게시 끝일': addDays_(t, 7) }, actor, '가짜 공지');
    insertRow_('공지', { '제목': '지난 공지 예시(가짜)', '내용': '게시 끝일이 지나서 홈에서 내려간 공지예요.', '부서ID': d['교무부'] || '', '게시 끝일': addDays_(t, -3) }, actor, '가짜 공지');
  });
  return 3;
}
