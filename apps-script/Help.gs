/**
 * Help.gs — 도움말, 교직원 명단, 홈 검색
 *
 * - 도움말: 분류(복무·인사, 학교 규칙·제규정 등 '도움말 분류')별 안내 글. 내용은 학교에서 넣는다(앱이 규정을 지어내지 않음)
 *   넣기: 이름을 고른 교직원 누구나. 고치기·지우기: 처음 넣은 분과 관리
 * - 교직원 명단: 사용 중인 분의 직위·소속·부서·담당 업무·내선(개인 연락처는 없음)
 * - 검색: 자료·일정·교직원·도움말·조사를 한 번에 찾는다
 */

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
  if (!terms.length) return { q: q, library: empty, events: empty, staff: empty, help: empty, surveys: empty };
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

  var cache = surveyCache_();
  var surveys = liveRows_('조사').filter(function (s) {
    return matchAll_(terms, [s['제목'], s['설명'], depts[s['부서ID']] || '']);
  }).map(function (s) { return surveyCard_(s, ctx, cache); }).sort(function (a, b) {
    return (a.closed - b.closed) || (a.deadline < b.deadline ? 1 : a.deadline > b.deadline ? -1 : 0);
  });

  return {
    q: q,
    today: today,
    library: pack(lib, 6),
    events: pack(next.concat(past), 6),
    staff: pack(staff, 6),
    help: pack(help, 6),
    surveys: pack(surveys, 4)
  };
}
