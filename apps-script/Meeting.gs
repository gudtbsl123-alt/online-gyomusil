/**
 * Meeting.gs — 회의록(공지 › 회의록, 판 2026-10-22a 교사 요청)
 *
 * - 회의 하나 = '회의' 탭 한 줄. 칸 목록(맨 위 칸·부서)은 만들 때의 이름 그대로 '칸'(JSON)에 담아 둔다
 *   → 나중에 부서 이름이 바뀌거나 부서가 늘어도 지난 회의록은 그대로
 * - 칸 내용 = '회의내용' 탭 한 줄(회의ID·칸). 기타 안건은 칸 '_etc'로 여러 줄(순서)
 * - 쓰기(교사 선택 '누구나 모든 칸'): 이름을 고른 교직원 누구나 모든 칸·기타 안건을 쓰고 고친다. 칸마다 마지막에 쓴 분이 남는다
 *   같은 칸을 그사이 다른 분이 고쳤으면 덮어쓰지 않고 묻는다(칸마다 '판')
 * - 회의 만들기: 이름을 고른 누구나. 회의 정보(종류·제목·날짜·시간·장소·칸) 고치기·회의 지우기: 만든 분과 관리
 * - 기타 안건 빼기: 더한 분·회의를 만든 분·관리. 내용이 있는 칸은 회의 정보에서 뺄 수 없다
 * - 회의 종류는 분류 '회의 종류'(처음에는 부장회의·교직원회의, 첫 회의를 만들 때 저절로 넣는다)
 * - 맨 위 칸은 설정 '회의록 맨 위 칸'(기본 '교장 선생님, 교감 선생님'). 행정실 칸은 넣지 않는다(사용자는 교사끼리)
 * - 지운 회의는 관리자 › 휴지통에서 되살린다. 모든 바꿈은 기록 탭에. 탭은 처음 회의를 만들 때 저절로 생긴다
 */

function fileMark_Meeting_() { return '2026-10-28a'; } // 판 표시(관리자 › 점검)

var MEET_ETC_ = '_etc'; // 기타 안건 칸
var MEET_KIND_DEFAULTS_ = ['부장회의', '교직원회의'];
var MEET_TOP_DEFAULT_ = '교장 선생님, 교감 선생님';
var MEET_MAX_ROWS_ = 40;

/** 탭이 아직 없으면 빈 목록 */
function meetRows_(tab, withDeleted) {
  try { return withDeleted ? readRows_(tab) : liveRows_(tab); } catch (e) { if (e && e.code === 'SETUP') return []; throw e; }
}

/** 회의 종류: 분류 '회의 종류'. 아직 없으면 기본 두 가지(id '_k1'·'_k2', 첫 회의를 만들 때 진짜로 넣는다) */
function meetKinds_() {
  var rows = liveRows_('분류').filter(function (r) { return r['종류'] === '회의 종류'; })
    .sort(function (a, b) { return (Number(a['순서']) || 999) - (Number(b['순서']) || 999) || a['이름'].localeCompare(b['이름'], 'ko'); });
  if (rows.length) return rows.map(function (r) { return { id: r['분류ID'], name: r['이름'], active: r['사용 여부'] !== '사용 안 함' }; });
  return MEET_KIND_DEFAULTS_.map(function (n, i) { return { id: '_k' + (i + 1), name: n, active: true, virtual: true }; });
}

/** 기본 종류를 분류에 넣는다(아직 하나도 없을 때만, 잠금 안). 돌려주는 값: 가짜 id → 진짜 id */
function ensureMeetKinds_(actor) {
  var map = {};
  if (liveRows_('분류').some(function (r) { return r['종류'] === '회의 종류'; })) return map;
  MEET_KIND_DEFAULTS_.forEach(function (n, i) {
    map['_k' + (i + 1)] = insertRow_('분류', { '종류': '회의 종류', '이름': n, '순서': String(i + 1), '사용 여부': '사용' }, actor, '회의 종류 처음 넣음: ' + n)['분류ID'];
  });
  return map;
}

/** 맨 위 칸 이름들(설정 '회의록 맨 위 칸', 쉼표·줄 바꿈으로 나눔). 설정 칸이 없는 예전 Admin.gs면 기본값 */
function meetTopNames_() {
  var known = settingDefs_().some(function (d) { return d.key === '회의록 맨 위 칸'; });
  var s = known ? String(setting_('회의록 맨 위 칸')) : MEET_TOP_DEFAULT_, seen = {};
  return s.split(/[,\n，]/).map(function (x) { return x.trim().slice(0, 20); })
    .filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; }).slice(0, 8);
}

/** 새 회의의 칸 후보: 맨 위 칸(k 비움, 저장할 때 정함) + 사용 중인 부서(분류 순서) */
function meetDefaultRows_() {
  return meetTopNames_().map(function (n) { return { k: '', n: n, t: 1 }; })
    .concat(deptOptions_().filter(function (d) { return d.active; }).map(function (d) { return { k: d.id, n: d.name }; }));
}

function meetParseRows_(s) {
  try { var v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

/** 날짜의 학기: { key: '2026-2', label: '2026학년도 2학기' }. 학기 기간이 있으면 2학기 시작일로 나누고, 없으면 3~8월 1학기 */
function meetTerm_(date, cache) {
  if (!isDate_(date)) return { key: '', label: '' };
  var sy = schoolYearOf_(date);
  if (!(sy in cache)) cache[sy] = semesters_(sy);
  var s2 = cache[sy].filter(function (s) { return s.name === '2학기'; })[0], n;
  if (s2) n = date >= s2.from ? 2 : 1;
  else { var m = Number(date.slice(5, 7)); n = m >= 3 && m <= 8 ? 1 : 2; }
  return { key: sy + '-' + n, label: sy + '학년도 ' + n + '학기' };
}

/** 내용 줄(칸·기타 안건) → 화면 값 */
function meetPieceView_(r, names) {
  var by = r['수정자ID'] || r['입력자ID'];
  return { id: r['내용ID'], k: r['칸'], content: r['내용'], by: names[by] || '', at: r['수정 시각'] || r['입력 시각'], ver: Number(r['판']) || 1, byId: r['입력자ID'] };
}

function canEditMeet_(r, ctx) { return canEditOwned_(r, ctx); } // 만든 분·관리(Library.gs)

/** 회의 한 줄 → 목록 카드 값. pieces = 그 회의의 내용 줄 */
function meetView_(r, ctx, kinds, names, pieces, termCache) {
  var rows = meetParseRows_(r['칸']), filled = {};
  pieces.forEach(function (p) { if (p['칸'] !== MEET_ETC_ && String(p['내용']).trim()) filled[p['칸']] = true; });
  var term = meetTerm_(r['날짜'], termCache);
  return {
    id: r['회의ID'], kindId: r['종류ID'], kind: kinds[r['종류ID']] || '', title: r['제목'], date: r['날짜'], time: r['시간'], place: r['장소'],
    year: r['학년도'], term: term.key, termLabel: term.label,
    total: rows.length, filled: rows.filter(function (x) { return filled[x.k]; }).length,
    etc: pieces.filter(function (p) { return p['칸'] === MEET_ETC_; }).length,
    by: names[r['입력자ID']] || '', at: r['입력 시각'], canEdit: canEditMeet_(r, ctx), schedId: r['일정ID'] || ''
  };
}

function meetKindNames_() {
  var m = categoryNames_('회의 종류');
  meetKinds_().forEach(function (k) { if (k.virtual) m[k.id] = k.name; });
  return m;
}

/** 회의 목록(새 회의 먼저): 학기 고르기·종류 단추·만들기 창에 쓸 것도 함께 */
function apiMeetList_(args, actor, ctx) {
  var kinds = meetKindNames_(), names = staffNames_(), termCache = {}, by = {};
  meetRows_('회의내용').forEach(function (p) { (by[p['회의ID']] = by[p['회의ID']] || []).push(p); });
  var items = meetRows_('회의').map(function (r) { return meetView_(r, ctx, kinds, names, by[r['회의ID']] || [], termCache); })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.time < b.time ? 1 : a.time > b.time ? -1 : (a.at < b.at ? 1 : -1); });
  var terms = [], seen = {};
  items.forEach(function (m) { if (m.term && !seen[m.term]) { seen[m.term] = true; terms.push({ key: m.term, label: m.termLabel }); } });
  terms.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
  // 새 회의 제목('2026학년도 2학기 부장회의 (5)')을 화면이 지을 때 쓰는 2학기 시작일(지금 학년도 앞뒤)
  var sy = curSchoolYear_(), sem2 = {};
  [sy - 1, sy, sy + 1].forEach(function (y) { var s = semesters_(y).filter(function (x) { return x.name === '2학기'; })[0]; if (s) sem2[y] = s.from; });
  return { items: items, terms: terms, kinds: meetKinds_(), rowsDefault: meetDefaultRows_(), sem2: sem2, canManage: canManage_(ctx), today: todayYmd_() };
}

/** 회의 하나: 칸마다 내용·쓴 분·판, 기타 안건 */
function apiMeetGet_(args, actor, ctx) {
  var r = findMeet_(args && args.id);
  var names = staffNames_(), kinds = meetKindNames_();
  var pieces = meetRows_('회의내용').filter(function (p) { return p['회의ID'] === r['회의ID']; });
  var byKey = {};
  pieces.forEach(function (p) { if (p['칸'] !== MEET_ETC_) byKey[p['칸']] = p; });
  var view = meetView_(r, ctx, kinds, names, pieces, {});
  view.rows = meetParseRows_(r['칸']).map(function (x) {
    var p = byKey[x.k];
    var v = p ? meetPieceView_(p, names) : { content: '', by: '', at: '', ver: 0 };
    return { k: x.k, name: x.n, top: !!x.t, content: v.content, by: String(v.content).trim() ? v.by : '', at: v.at, ver: v.ver };
  });
  var me = ctx.identity && ctx.identity['교직원ID'];
  view.etcItems = pieces.filter(function (p) { return p['칸'] === MEET_ETC_; })
    .sort(function (a, b) { return (Number(a['순서']) || 0) - (Number(b['순서']) || 0) || (a['입력 시각'] < b['입력 시각'] ? -1 : 1); })
    .map(function (p) {
      var v = meetPieceView_(p, names);
      v.canDelete = !!(me && (p['입력자ID'] === me)) || view.canEdit;
      return v;
    });
  return { meeting: view, canWrite: !!ctx.identity, kinds: meetKinds_(), rowsDefault: meetDefaultRows_() };
}

function findMeet_(id) {
  var r = id ? meetRows_('회의').filter(function (x) { return x['회의ID'] === String(id); })[0] : null;
  if (!r) throw userError_('회의를 찾지 못했어요. 다른 분이 지웠을 수 있어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  return r;
}

/**
 * 회의 만들기·고치기. args = { id?, kindId, title, date, time, place, rows: [{ k, n, t }] }
 * 칸: 부서 칸은 분류의 부서ID(이름은 처음 넣을 때의 이름을 담아 둔다), 맨 위 칸은 k가 비면 새로 정한다
 */
function apiMeetSave_(args, actor, ctx) {
  var title = cleanText_(args.title, 60, '제목', true);
  var date = String(args.date || '').trim();
  if (!isDate_(date)) throw userError_('회의 날짜를 골라 주세요.');
  var time = String(args.time || '').trim();
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw userError_('시간은 15:00처럼 적어 주세요.');
  var place = cleanText_(args.place, 40, '장소');
  var want = Array.isArray(args.rows) ? args.rows : [];
  if (!want.length) throw userError_('칸을 하나 이상 골라 주세요.');
  if (want.length > MEET_MAX_ROWS_) throw userError_('칸은 ' + MEET_MAX_ROWS_ + '개까지 넣을 수 있어요.');
  return withLock_(function () {
    ensureTab_('회의');
    ensureTab_('회의내용');
    var old = args.id ? findMeet_(args.id) : null;
    if (old && !canEditMeet_(old, ctx)) throw userError_('회의를 만든 분과 관리자만 회의 정보를 고칠 수 있어요.', 'FORBIDDEN');
    var kindId = String(args.kindId || '');
    if (/^_k\d$/.test(kindId)) { // 아직 분류에 없던 기본 종류: 넣고 진짜 ID로(그사이 다른 분이 넣었으면 같은 이름으로 찾는다)
      var nm = MEET_KIND_DEFAULTS_[Number(kindId.slice(2)) - 1], made = ensureMeetKinds_(actor);
      kindId = made[kindId] || (meetKinds_().filter(function (k) { return !k.virtual && k.name === nm; })[0] || {}).id || '';
    }
    if (!meetKinds_().some(function (k) { return !k.virtual && k.id === kindId; })) throw userError_('회의 종류를 골라 주세요.');
    var oldRows = old ? meetParseRows_(old['칸']) : [], oldBy = {};
    oldRows.forEach(function (x) { oldBy[x.k] = x; });
    var depts = categoryNames_('부서'), used = {}, topN = 0, rows = [];
    oldRows.forEach(function (x) { var m = /^t(\d+)$/.exec(x.k); if (m) topN = Math.max(topN, Number(m[1])); });
    want.forEach(function (x) {
      var k = String(x && x.k || '');
      if (k && oldBy[k]) { if (!used[k]) { used[k] = true; rows.push({ k: k, n: oldBy[k].n, t: oldBy[k].t ? 1 : undefined }); } return; }
      if (k && depts[k]) { if (!used[k]) { used[k] = true; rows.push({ k: k, n: depts[k] }); } return; }
      var n = !k && x && x.t ? cleanText_(x.n, 20, '칸 이름') : ''; // 새 맨 위 칸(교장 선생님 등)
      if (n) { topN++; rows.push({ k: 't' + topN, n: n, t: 1 }); }
    });
    if (!rows.length) throw userError_('칸을 하나 이상 골라 주세요.');
    if (old) { // 내용이 있는 칸은 뺄 수 없다
      var have = {};
      meetRows_('회의내용').forEach(function (p) { if (p['회의ID'] === old['회의ID'] && p['칸'] !== MEET_ETC_ && String(p['내용']).trim()) have[p['칸']] = true; });
      var lost = oldRows.filter(function (x) { return have[x.k] && !used[x.k]; });
      if (lost.length) throw userError_('내용이 있는 칸(' + lost.map(function (x) { return x.n; }).join(', ') + ')은 뺄 수 없어요. 내용을 지운 뒤에 빼 주세요.');
    }
    var rec = { '학년도': String(schoolYearOf_(date)), '종류ID': kindId, '제목': title, '날짜': date, '시간': time, '장소': place, '칸': JSON.stringify(rows.map(function (x) { return x.t ? { k: x.k, n: x.n, t: 1 } : { k: x.k, n: x.n }; })) };
    var saved = old ? updateRow_('회의', old['회의ID'], rec, actor, '회의록 고침: ' + title) : insertRow_('회의', rec, actor, '회의록 만듦: ' + title);
    var sched = meetSyncSched_(old, saved['회의ID'], rec, !!args.addSched, actor);
    return { id: saved['회의ID'], sched: sched };
  });
}

function apiMeetDelete_(args, actor, ctx) {
  return withLock_(function () {
    var r = findMeet_(args && args.id);
    if (!canEditMeet_(r, ctx)) throw userError_('회의를 만든 분과 관리자만 지울 수 있어요.', 'FORBIDDEN');
    softDelete_('회의', r['회의ID'], actor, '회의록 지움: ' + r['제목']);
    var ev = r['일정ID'] ? findRow_('일정', r['일정ID']) : null; // 함께 넣은 일정도 지운다(관리자 › 휴지통에서 회의록을 되살리면 함께 돌아옴)
    if (ev && !ev['삭제 여부']) softDelete_('일정', ev['일정ID'], actor, '회의록과 함께 일정 지움: ' + r['제목']);
    return { done: true };
  });
}

/**
 * 회의와 이어진 일정(구분 '회의', 대상 교직원, 2026-10-28a 교사 결정 '함께 바뀜'): 만들기·고치기 창의 '일정에도 넣기'면 넣고 회의에 일정ID를 적는다.
 * 이어진 일정이 있으면 회의를 고칠 때 그 일정의 날짜·시간·장소·이름도 함께 바꾼다(대상·부서·메모·중요는 일정 화면에서 고친 그대로). 잠금 안에서 부른다
 */
function meetSyncSched_(old, mid, rec, add, actor) {
  var eid = old && old['일정ID'], ev = eid ? findRow_('일정', eid) : null;
  var f = { '시작일': rec['날짜'], '끝일': '', '시간': rec['시간'], '행사명': rec['제목'], '장소': rec['장소'] };
  if (ev && !ev['삭제 여부']) {
    var same = Object.keys(f).every(function (k) { return String(ev[k] || '') === String(f[k] || ''); });
    if (!same) updateRow_('일정', eid, f, actor, '회의록과 함께 일정 고침: ' + rec['제목']);
    return eid;
  }
  if (!add) return '';
  ensureCols_('일정');
  ensureCols_('회의');
  f['대상 학년'] = '교직원'; f['구분'] = '회의'; f['담당 부서ID'] = ''; f['메모'] = ''; f['중요'] = ''; f['회의ID'] = mid;
  var e = insertRow_('일정', f, actor, '회의록과 함께 일정 추가: ' + rec['제목']);
  updateRow_('회의', mid, { '일정ID': e['일정ID'] }, actor, '회의록에 일정 이음: ' + rec['제목']);
  return e['일정ID'];
}

/** 홈 '내가 할 일': 오늘부터 7일 안의 회의 중 내 부서 칸이 아직 빈 것(교사 결정 '부서 전원', 한 분이 쓰면 모두에게서 사라짐) */
function meetTodosFor_(ctx) {
  var dept = ctx && ctx.identity && ctx.identity['부서ID'];
  if (!dept) return [];
  var today = todayYmd_(), until = addDays_(today, 7);
  var ms = meetRows_('회의').filter(function (m) {
    return m['날짜'] >= today && m['날짜'] <= until && meetParseRows_(m['칸']).some(function (x) { return x.k === dept; });
  });
  if (!ms.length) return [];
  var kinds = meetKindNames_(), filled = {};
  meetRows_('회의내용').forEach(function (p) { if (p['칸'] === dept && String(p['내용']).trim()) filled[p['회의ID']] = true; });
  return ms.filter(function (m) { return !filled[m['회의ID']]; })
    .sort(function (a, b) { return (a['날짜'] + a['시간']) < (b['날짜'] + b['시간']) ? -1 : 1; })
    .map(function (m) {
      var row = meetParseRows_(m['칸']).filter(function (x) { return x.k === dept; })[0];
      return { id: m['회의ID'], title: m['제목'], kind: kinds[m['종류ID']] || '', date: m['날짜'], time: m['시간'], k: dept, name: row.n };
    });
}

/** 홈 검색: 회의 제목·종류·장소·칸 이름·칸 내용·기타 안건(새 회의 먼저) */
function meetSearch_(terms, ctx) {
  var ms = meetRows_('회의');
  if (!ms.length) return [];
  var kinds = meetKindNames_(), texts = {};
  meetRows_('회의내용').forEach(function (p) { (texts[p['회의ID']] = texts[p['회의ID']] || []).push(p['내용']); });
  return ms.filter(function (m) {
    return matchAll_(terms, [m['제목'], kinds[m['종류ID']] || '', m['장소']].concat(meetParseRows_(m['칸']).map(function (x) { return x.n; })).concat(texts[m['회의ID']] || []));
  }).sort(function (a, b) { return a['날짜'] < b['날짜'] ? 1 : a['날짜'] > b['날짜'] ? -1 : 0; }).map(function (m) {
    return { id: m['회의ID'], title: m['제목'], kind: kinds[m['종류ID']] || '', date: m['날짜'], time: m['시간'], place: m['장소'] };
  });
}

function meetContent_(v) {
  return cleanText_(String(v === null || v === undefined ? '' : v).replace(/\r\n?/g, '\n'), 5000, '내용');
}

/** 내용 줄을 판으로 확인해 쓴다. 그사이 다른 분이 고쳤으면(force가 아니면) 쓰지 않고 지금 내용을 돌려준다 */
function meetWritePiece_(cur, rec, base, force, actor, summary) {
  var names = staffNames_();
  if (cur) {
    if (!force && (Number(cur['판']) || 1) !== Number(base || 0)) return { conflict: meetPieceView_(cur, names) };
    if (String(cur['내용']) === rec['내용']) return { piece: meetPieceView_(cur, names) };
    rec['판'] = String((Number(cur['판']) || 1) + 1);
    return { piece: meetPieceView_(updateRow_('회의내용', cur['내용ID'], rec, actor, summary), names) };
  }
  if (!force && Number(base || 0) !== 0) throw userError_('지운 안건이에요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  rec['판'] = '1';
  return { piece: meetPieceView_(insertRow_('회의내용', rec, actor, summary), names) };
}

/** 칸 쓰기·고치기(이름을 고른 누구나). args = { id(회의), k(칸), content, base(본 판, 처음이면 0), force } */
function apiMeetRow_(args, actor, ctx) {
  var content = meetContent_(args.content);
  return withLock_(function () {
    ensureTab_('회의내용');
    var m = findMeet_(args.id), k = String(args.k || '');
    var row = meetParseRows_(m['칸']).filter(function (x) { return x.k === k; })[0];
    if (!row) throw userError_('이 회의에 없는 칸이에요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    var cur = meetRows_('회의내용').filter(function (p) { return p['회의ID'] === m['회의ID'] && p['칸'] === k; })[0] || null;
    return meetWritePiece_(cur, { '회의ID': m['회의ID'], '칸': k, '내용': content }, args.base, !!args.force, actor, '회의록 칸: ' + m['제목'] + ' › ' + row.n);
  });
}

/** 기타 안건 더하기(누구나). args = { id(회의), content } */
function apiMeetEtcAdd_(args, actor, ctx) {
  var content = meetContent_(args.content);
  if (!content) throw userError_('안건을 적어 주세요.');
  return withLock_(function () {
    ensureTab_('회의내용');
    var m = findMeet_(args.id), n = 0;
    meetRows_('회의내용', true).forEach(function (p) { if (p['회의ID'] === m['회의ID'] && p['칸'] === MEET_ETC_) n = Math.max(n, Number(p['순서']) || 0); });
    var r = insertRow_('회의내용', { '회의ID': m['회의ID'], '칸': MEET_ETC_, '순서': String(n + 1), '내용': content, '판': '1' }, actor, '회의록 기타 안건 더함: ' + m['제목']);
    return { piece: meetPieceView_(r, staffNames_()) };
  });
}

/** 기타 안건 고치기(누구나, 판 확인). args = { eid, content, base, force } */
function apiMeetEtcSave_(args, actor, ctx) {
  var content = meetContent_(args.content);
  if (!content) throw userError_('안건을 적어 주세요. 안건을 없애려면 "빼기"를 눌러 주세요.');
  return withLock_(function () {
    var cur = meetRows_('회의내용').filter(function (p) { return p['내용ID'] === String(args.eid || '') && p['칸'] === MEET_ETC_; })[0];
    if (!cur) throw userError_('안건을 찾지 못했어요. 다른 분이 뺐을 수 있어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    var m = findMeet_(cur['회의ID']);
    return meetWritePiece_(cur, { '내용': content }, args.base, !!args.force, actor, '회의록 기타 안건 고침: ' + m['제목']);
  });
}

/** 기타 안건 빼기: 더한 분·회의를 만든 분·관리 */
function apiMeetEtcDelete_(args, actor, ctx) {
  return withLock_(function () {
    var cur = meetRows_('회의내용').filter(function (p) { return p['내용ID'] === String(args.eid || '') && p['칸'] === MEET_ETC_; })[0];
    if (!cur) throw userError_('안건을 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    var m = findMeet_(cur['회의ID']), me = ctx.identity && ctx.identity['교직원ID'];
    if (!(me && cur['입력자ID'] === me) && !canEditMeet_(m, ctx)) throw userError_('안건을 더한 분과 회의를 만든 분·관리자만 뺄 수 있어요.', 'FORBIDDEN');
    softDelete_('회의내용', cur['내용ID'], actor, '회의록 기타 안건 뺌: ' + m['제목']);
    return { done: true };
  });
}

// ---------------------------------------------------------------- 휴지통(관리자)

function adminMeetTrash_() {
  var names = staffNames_(), kinds = meetKindNames_();
  return { items: meetRows_('회의', true).filter(function (r) { return r['삭제 여부']; }).map(function (r) {
    return { tab: '회의', id: r['회의ID'], title: r['제목'], sub: [kinds[r['종류ID']] || '', r['날짜']].filter(Boolean).join(' · '), by: names[r['입력자ID']] || '', deletedBy: names[r['수정자ID']] || '', deletedAt: r['수정 시각'] };
  }).sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0; }).slice(0, 200) };
}

function adminMeetRestore_(args, actor) {
  var r = meetRows_('회의', true).filter(function (x) { return x['회의ID'] === String(args.id || ''); })[0];
  if (!r || !r['삭제 여부']) throw userError_('되살릴 회의록을 찾지 못했어요.');
  restoreRow_('회의', r['회의ID'], actor, '회의록 되살림: ' + r['제목']);
  var ev = r['일정ID'] ? findRow_('일정', r['일정ID']) : null;
  if (ev && ev['삭제 여부']) restoreRow_('일정', ev['일정ID'], actor, '회의록과 함께 일정 되살림: ' + r['제목']);
  return { done: true };
}

// ---------------------------------------------------------------- 시험·미리보기용 예시

/** 예시 회의 2개(오늘 앞뒤). 이름은 가짜 교직원(옛이야기 인물) */
function seedTestMeetings_() {
  if (meetRows_('회의').length) throw userError_('회의 탭에 이미 회의가 있어요. 예시 회의는 빈 테스트 시트에만 넣을 수 있어요.');
  var staff = {}, t = todayYmd_();
  liveRows_('교직원').forEach(function (s) { staff[s['이름']] = { id: s['교직원ID'], name: s['이름'] }; });
  var a0 = staff['홍길동'] || { id: '', name: '테스트 데이터' }, other = function (n) { return staff[n] || a0; };
  var made = [];
  withLock_(function () {
    ensureTab_('회의');
    ensureTab_('회의내용');
    var kinds = ensureMeetKinds_(a0), rows = meetDefaultRows_().map(function (x, i) { return x.t ? { k: 't' + (i + 1), n: x.n, t: 1 } : { k: x.k, n: x.n }; });
    var kid = function (n) { var hit = liveRows_('분류').filter(function (r) { return r['종류'] === '회의 종류' && r['이름'] === n; })[0]; return hit ? hit['분류ID'] : kinds['_k1']; };
    var mk = function (kind, title, date, place) {
      return insertRow_('회의', { '학년도': String(schoolYearOf_(date)), '종류ID': kid(kind), '제목': title, '날짜': date, '시간': '15:00', '장소': place, '칸': JSON.stringify(rows) }, a0, '예시 회의')['회의ID'];
    };
    var m1 = mk('부장회의', '(예시) 부장회의', addDays_(t, 1), '교무실');
    var m2 = mk('교직원회의', '(예시) 교직원회의', addDays_(t, -6), '과학실');
    var dept = function (n) { var r = rows.filter(function (x) { return x.n === n; })[0]; return r ? r.k : ''; };
    var put = function (m, k, text, who) { if (k) insertRow_('회의내용', { '회의ID': m, '칸': k, '내용': text, '판': '1' }, who, '예시 회의 내용'); };
    put(m1, dept('교무부'), '1. (예시) 학부모 상담 주간 안내\n2. (예시) 다음 주 금요일까지 출결 서류 제출', other('이몽룡'));
    put(m1, dept('연구부'), '전달 사항 없음', other('성춘향'));
    put(m1, dept('인성안전부'), '1. (예시) 교실 안전점검표를 이번 주에 내 주세요', other('흥부'));
    insertRow_('회의내용', { '회의ID': m1, '칸': MEET_ETC_, '순서': '1', '내용': '(예시) 체육대회 날 우천 시 계획', '판': '1' }, other('심청'), '예시 회의 내용');
    put(m2, dept('교무부'), '(예시) 2학기 행사 일정 안내', other('이몽룡'));
    made = [m1, m2];
  });
  return made.length;
}
