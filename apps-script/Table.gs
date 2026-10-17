/**
 * Table.gs — 함께 쓰는 표(구글 시트처럼 여러 선생님이 한 표를 함께 채운다)
 *
 * - 표('함께표' 탭): 제목·부서·설명·마감(날짜)·상태('마감'이면 손으로 마감함)·열(JSON)·판
 * - 줄('함께표줄' 탭): 표ID·순서·칸(JSON {열ID: 값})·색(JSON {열ID: '#RRGGBB'}, 붙여 넣을 때 가져온 바탕색)·칸 고친 때(JSON)·판
 * - 열(JSON): [{ id, name, type: 'text'|'pick', options, lock, merge, w, del }]
 *   pick: 고르기(정해 둔 값 중 하나, 맨 앞 값을 '끝난 것'으로 센다) · lock: 잠근 열 · merge: 위아래 같은 값을 한 칸처럼 보이기
 *   w: 열 너비(px) · del: 뺀 열(값은 시트에 그대로 두고 화면에서만 뺀다. 열 ID를 다시 쓰지 않으려고 남겨 둔다)
 * - 판: 표에서 무엇이든 바뀔 때마다 1씩 는다. 줄마다 마지막으로 바뀐 판을 적어 두어, 화면은 10초마다 '내 판 다음'만 받아 간다
 * - 칸 고친 때(JSON {열ID: [판, 이름, 시각]}): 화면이 알던 판(base)과 다르면 그사이 다른 분이 고친 것 → 덮어쓰지 않고 묻는다
 * - 권한(교사 결정): 보기는 로그인한 누구나. 표 만들기·칸 고치기·줄 더하기는 이름을 고른 교직원 누구나
 *   잠근 열은 만든 분·관리(그 줄을 더한 분은 그 줄의 잠근 칸도), 줄 빼기는 만든 분·관리·그 줄을 더한 분
 *   열·표 고치기·마감·지우기는 만든 분·관리. 마감한 표(손으로 마감했거나 마감 날짜가 지남)는 만든 분·관리만 고친다
 * - 칸을 고칠 때마다 기록 탭에 바뀌기 전·후가 남는다. 지운 표는 관리자 › 휴지통에서 되살린다
 * - 여럿이 동시에 고쳐도 빠르게: 칸·줄을 고칠 때는 잠금 안에서 탭 전체가 아니라 그 줄만 읽고 쓴다
 *   (줄의 행 번호는 잠금 밖에서 서버 기억으로 먼저 찾아 두고, 잠금 안에서 그 줄이 맞는지 다시 본다)
 */

function fileMark_Table_() { return '2026-10-17h'; } // 판 표시(관리자 › 점검)

var TB_MAX_ROWS_ = 500;     // 한 표의 줄
var TB_MAX_COLS_ = 30;      // 한 표의 열
var TB_MAX_CELL_ = 2000;    // 한 칸 글자 수
var TB_MAX_OPTIONS_ = 12;   // 고르기 열의 값 수
var TB_MAX_CELLS_ = 5000;   // 한 번에 붙여 넣는 칸 수
var TB_MAX_ROW_JSON_ = 45000; // 한 줄의 칸(JSON) 글자 수(시트 한 칸은 5만 자까지)

// ---------------------------------------------------------------- 도구

function tbParse_(s, fallback) {
  try { var v = JSON.parse(s); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}
function tbToday_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function tbNowMin_() { return nowText_().slice(0, 16); }

/** 탭이 아직 없으면(처음 표를 만들 때 생긴다) 빈 목록 */
function tbRows_(tab) {
  try {
    return readRows_(tab);
  } catch (e) {
    if (e && e.code === 'SETUP') return [];
    throw e;
  }
}

function tbFind_(id) {
  return tbRows_('함께표').filter(function (t) { return t['표ID'] === id && !t['삭제 여부']; })[0] || null;
}

/** 만든 분이나 관리(역할 '관리' 또는 관리자 화면) */
function tbOwner_(t, ctx) {
  return canManage_(ctx) || !!(ctx.identity && t['입력자ID'] && t['입력자ID'] === ctx.identity['교직원ID']);
}

/** 마감: 손으로 마감했거나 마감 날짜가 지났으면(마감 날짜 당일까지는 열려 있다) */
function tbClosed_(t) {
  return t['상태'] === '마감' || !!(t['마감'] && t['마감'] < tbToday_());
}

function tbAllCols_(t) {
  var list = tbParse_(t['열'], []);
  return Array.isArray(list) ? list.filter(function (c) { return c && c.id; }) : [];
}
function tbCols_(t) {
  return tbAllCols_(t).filter(function (c) { return !c.del; });
}

/**
 * 열 정의 다듬기. prevAll: 지금 열(뺀 열 포함). 새 열은 지금까지 쓴 적 없는 ID를 받는다.
 * 돌려주는 값: 보이는 열 목록(뺀 열은 넣지 않음)
 */
function tbCleanCols_(list, prevAll) {
  if (!Array.isArray(list) || !list.length) throw userError_('열이 하나도 없어요.');
  if (list.length > TB_MAX_COLS_) throw userError_('열은 ' + TB_MAX_COLS_ + '개까지 만들 수 있어요.');
  var used = {}, n = 0, known = {}, first = !(prevAll && prevAll.length);
  (prevAll || []).forEach(function (c) {
    used[c.id] = true;
    if (!c.del) known[c.id] = true;
    var k = Number(String(c.id).slice(1));
    if (k > n) n = k;
  });
  // 이어 쓸 ID: 처음 만들 때는 화면이 붙인 c1, c2…, 고칠 때는 지금 있는 열의 ID만(뺀 열의 ID는 다시 쓰지 않는다)
  var keep = {};
  list.forEach(function (c) {
    var id = String((c && c.id) || '');
    if (/^c\d{1,4}$/.test(id) && !keep[id] && (first || known[id])) keep[id] = 1;
  });
  Object.keys(keep).forEach(function (id) { used[id] = true; var k = Number(id.slice(1)); if (k > n) n = k; });
  var seen = {};
  return list.map(function (c, i) {
    c = c || {};
    var id = String(c.id || '');
    if (!keep[id] || seen[id]) { do { n++; id = 'c' + n; } while (used[id]); used[id] = true; }
    seen[id] = true;
    var name = cleanText_(c.name, 40, (i + 1) + '번째 열 이름') || ('열 ' + (i + 1));
    var type = c.type === 'pick' ? 'pick' : 'text';
    var options = [];
    if (type === 'pick') {
      (Array.isArray(c.options) ? c.options : []).forEach(function (o) {
        var s = String(o === null || o === undefined ? '' : o).trim().slice(0, 20);
        if (s && options.indexOf(s) < 0) options.push(s);
      });
      if (!options.length) throw userError_("'" + name + "' 열에서 고를 값을 적어 주세요.");
      if (options.length > TB_MAX_OPTIONS_) throw userError_("'" + name + "' 열에서 고를 값은 " + TB_MAX_OPTIONS_ + '개까지예요.');
    }
    var w = Math.round(Number(c.w) || 0);
    return { id: id, name: name, type: type, options: options, lock: !!c.lock, merge: !!c.merge, w: w >= 60 && w <= 480 ? w : 0 };
  });
}

/** 칸 값 다듬기. 고르기 열은 띄어쓰기만 다른 값을 정해 둔 값으로 맞춘다(그 밖의 값도 받는다: 붙여 넣은 값이 사라지지 않게) */
function tbCleanValue_(col, v) {
  var s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  if (s.length > TB_MAX_CELL_) throw userError_("'" + col.name + "' 칸은 " + TB_MAX_CELL_ + '자까지 적을 수 있어요.');
  if (col.type === 'pick' && s) {
    var flat = s.replace(/\s/g, '');
    for (var i = 0; i < col.options.length; i++) if (col.options[i].replace(/\s/g, '') === flat) return col.options[i];
  }
  return s;
}

function tbCleanColor_(v) {
  var s = String(v || '').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(s) ? s.toUpperCase() : '';
}

/** 표 이름·부서·설명·마감 */
function tbCleanMeta_(f) {
  var title = cleanText_(f.title, 80, '표 이름', true);
  var deptId = cleanText_(f.deptId, 20, '담당 부서');
  if (deptId && !categoryNames_('부서')[deptId]) throw userError_('담당 부서를 다시 골라 주세요.');
  var deadline = String(f.deadline || '');
  if (deadline && !isDate_(deadline)) throw userError_('마감 날짜를 다시 골라 주세요.');
  return { '제목': title, '부서ID': deptId, '설명': cleanText_(f.desc, 500, '설명'), '마감': deadline };
}

/** 기록에 남길 때 그 줄을 알아보는 이름: 앞쪽 세 열에서 값이 있는 두 칸(예: '1층 교장실') */
function tbRowLabel_(cols, cells) {
  var out = [];
  for (var i = 0; i < Math.min(3, cols.length) && out.length < 2; i++) {
    var v = String(cells[cols[i].id] || '').replace(/\s+/g, ' ').trim();
    if (v) out.push(v.slice(0, 20));
  }
  return out.length ? out.join(' ') : '빈 줄';
}

// ---------------------------------------------------------------- 화면으로 보낼 모양

function tbView_(t, ctx, names, depts) {
  var owner = tbOwner_(t, ctx), closed = tbClosed_(t);
  return {
    id: t['표ID'], title: t['제목'], deptId: t['부서ID'] || '', dept: depts[t['부서ID']] || '', desc: t['설명'] || '',
    deadline: t['마감'] || '', closedByHand: t['상태'] === '마감', closed: closed,
    cols: tbCols_(t), ver: Number(t['판']) || 0,
    by: names[t['입력자ID']] || '', byId: t['입력자ID'] || '', at: String(t['입력 시각'] || '').slice(0, 16),
    canEdit: owner, canWrite: !!ctx.identity && (!closed || owner), manage: canManage_(ctx),
    me: ctx.identity ? ctx.identity['교직원ID'] : ''
  };
}

/** 줄. by·at: 마지막으로 고친 분(표를 만든 뒤 고친 적이 없으면, 나중에 더한 줄은 더한 분) */
function tbRowView_(r, names, creatorId) {
  var edited = !!r['수정자ID'];
  var byId = edited ? r['수정자ID'] : (r['입력자ID'] !== creatorId ? r['입력자ID'] : '');
  var at = edited ? r['수정 시각'] : (byId ? r['입력 시각'] : '');
  return {
    id: r['줄ID'], order: Number(r['순서']) || 0, cells: tbParse_(r['칸'], {}), colors: tbParse_(r['색'], {}),
    stamps: tbParse_(r['칸 고친 때'], {}), ver: Number(r['판']) || 0, del: !!r['삭제 여부'],
    addedById: r['입력자ID'] || '', by: byId ? names[byId] || '' : '', at: String(at || '').slice(0, 16),
    n: r._row || 0 // 시트의 행 번호(화면이 고칠 때 돌려보내는 짐작값, 서버가 그 줄이 맞는지 다시 본다)
  };
}

function tbSortRows_(list) {
  return list.sort(function (a, b) {
    var x = Number(a['순서']) || 0, y = Number(b['순서']) || 0;
    if (x !== y) return x - y;
    var p = String(a['입력 시각'] || ''), q = String(b['입력 시각'] || '');
    return p < q ? -1 : p > q ? 1 : (a['줄ID'] < b['줄ID'] ? -1 : 1);
  });
}

/** 목록에 보일 요약: 줄 수와 첫 고르기 열의 값별 수 */
function tbSummary_(cols, rows) {
  var out = { rows: rows.length };
  var pick = cols.filter(function (c) { return c.type === 'pick'; })[0];
  if (!pick) return out;
  var counts = {}, empty = 0, other = 0;
  pick.options.forEach(function (o) { counts[o] = 0; });
  rows.forEach(function (r) {
    var v = String(tbParse_(r['칸'], {})[pick.id] || '');
    if (!v) empty++;
    else if (counts[v] !== undefined) counts[v]++;
    else other++;
  });
  out.pick = { name: pick.name, options: pick.options, counts: counts, empty: empty, other: other };
  return out;
}

// ---------------------------------------------------------------- 읽기

function apiTableList_(args, actor, ctx) {
  var names = staffNames_(), depts = categoryNames_('부서');
  var tables = tbRows_('함께표').filter(function (t) { return !t['삭제 여부']; });
  var rowsBy = {};
  if (tables.length) {
    tbRows_('함께표줄').forEach(function (r) {
      if (!r['삭제 여부']) (rowsBy[r['표ID']] = rowsBy[r['표ID']] || []).push(r);
    });
  }
  var me = ctx.identity ? ctx.identity['교직원ID'] : '';
  var cards = tables.map(function (t) {
    var rows = rowsBy[t['표ID']] || [];
    var last = null;
    rows.forEach(function (r) {
      var at = String(r['수정 시각'] || ''), who = r['수정자ID'];
      if (!at && r['입력자ID'] !== t['입력자ID']) { at = String(r['입력 시각'] || ''); who = r['입력자ID']; } // 나중에 더한 줄
      if (at && who && (!last || at > last.at)) last = { at: at, id: who };
    });
    var v = tbView_(t, ctx, names, depts);
    return {
      id: v.id, title: v.title, dept: v.dept, deadline: v.deadline, closed: v.closed, by: v.by, at: v.at,
      mine: !!me && t['입력자ID'] === me, cols: v.cols.length,
      last: last ? { by: names[last.id] || '', at: last.at.slice(0, 16) } : null, summary: tbSummary_(v.cols, rows)
    };
  });
  cards.sort(function (a, b) {
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    var da = a.deadline || '9999', db = b.deadline || '9999';
    if (!a.closed && da !== db) return da < db ? -1 : 1;
    var la = a.last ? a.last.at : a.at, lb = b.last ? b.last.at : b.at;
    return la < lb ? 1 : la > lb ? -1 : 0;
  });
  return { tables: cards, canCreate: !!ctx.identity, today: tbToday_() };
}

function apiTableGet_(args, actor, ctx) {
  var t = tbFind_(String(args.id || ''));
  if (!t) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  var rows = tbSortRows_(tbRows_('함께표줄').filter(function (r) { return r['표ID'] === t['표ID'] && !r['삭제 여부']; }));
  return {
    table: tbView_(t, ctx, names, categoryNames_('부서')),
    rows: rows.map(function (r) { return tbRowView_(r, names, t['입력자ID']); }),
    depts: deptOptions_().filter(function (d) { return d.active; })
  };
}

/**
 * 새로 받기(화면이 표를 보는 동안 10초마다, 뒤에서): since(화면이 가진 판)보다 뒤에 바뀐 줄만.
 * 바뀐 것이 없으면 '함께표' 탭(작다)만 보고 바로 돌아간다
 */
function apiTablePoll_(args, actor, ctx) {
  var id = String(args.id || ''), since = Number(args.since) || 0;
  var t = tbRows_('함께표').filter(function (x) { return x['표ID'] === id; })[0];
  if (!t || t['삭제 여부']) return { gone: true };
  var ver = Number(t['판']) || 0;
  if (ver <= since) return { ver: ver, same: true };
  var names = staffNames_();
  var rows = tbRows_('함께표줄').filter(function (r) { return r['표ID'] === id && (Number(r['판']) || 0) > since; });
  return {
    ver: ver, table: tbView_(t, ctx, names, categoryNames_('부서')),
    rows: tbSortRows_(rows).map(function (r) { return tbRowView_(r, names, t['입력자ID']); })
  };
}

// ---------------------------------------------------------------- 잠금 안에서 한 줄만 읽고 쓰기

/** 잠금 안: 머리글(1행)만 */
function tbHead_(tab) {
  var sh = sheet_(tab);
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(cellText_);
}

/** 잠금 안: ID로 한 줄만 읽는다. hint(잠금 밖에서 본 행 번호)가 맞으면 그 줄만, 아니면(시트를 손으로 정렬 등) 탭 전체에서 찾는다 */
function tbReadRow_(tab, id, hint, head) {
  var sh = sheet_(tab), k = head.indexOf(tabs_()[tab][0]);
  var make = function (line, n) {
    var o = { _row: n, _raw: line };
    head.forEach(function (h, j) { if (h) o[h] = cellText_(line[j]); });
    return o;
  };
  if (k < 0) throw userError_('"' + tab + '" 탭의 머리글이 바뀌었어요. 관리자 › 점검을 봐 주세요.');
  if (hint >= 2 && hint <= sh.getLastRow()) {
    var line = sh.getRange(hint, 1, 1, head.length).getValues()[0];
    if (cellText_(line[k]) === id) return make(line, hint);
  }
  var rows = readRows_(tab), key = tabs_()[tab][0];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][key] === id) return make(sh.getRange(rows[i]._row, 1, 1, head.length).getValues()[0], rows[i]._row);
  }
  return null;
}

/** 잠금 안: 한 줄을 그 자리에 쓴다(머리글 없는 칸은 손대지 않는다) */
function tbWriteRow_(tab, row, head) {
  sheet_(tab).getRange(row._row, 1, 1, head.length).setValues([head.map(function (h, j) {
    return h ? cellWrite_(row[h] === undefined ? '' : row[h]) : (row._raw ? row._raw[j] : '');
  })]);
  dirty_(tab);
}

/** 잠금 안: 표의 판을 하나 올린다(기록 없이, 화면이 새로 받을 때 쓰는 숫자). 바뀐 판을 돌려준다 */
function tbBump_(t, head) {
  var ver = (Number(t['판']) || 0) + 1, c = head.indexOf('판');
  if (c < 0) throw userError_("'함께표' 탭에 '판' 칸이 없어요. 관리자 › 점검을 봐 주세요.");
  sheet_('함께표').getRange(t._row, c + 1).setValue(cellWrite_(String(ver)));
  t['판'] = String(ver);
  dirty_('함께표');
  return ver;
}

/**
 * 잠금 밖: 표와 줄의 행 번호, 표의 줄 수·순서를 서버 기억으로 먼저 찾아 둔다.
 * given: 화면이 보낸 줄의 행 번호({줄ID: 행 번호}). 다 있으면 큰 '함께표줄' 탭을 읽지 않는다(잠금 안에서 그 줄이 맞는지 다시 본다)
 */
function tbHints_(id, rowIds, withRows, given) {
  var t = tbRows_('함께표').filter(function (x) { return x['표ID'] === id; })[0];
  var out = { t: t ? t._row : 0, found: !!(t && !t['삭제 여부']), rows: {}, count: 0, maxOrder: 0, ids: {}, orders: [] };
  if (!out.found) return out;
  var want = {}, missing = false;
  (rowIds || []).forEach(function (r) {
    var n = given ? Math.floor(Number(given[r]) || 0) : 0;
    if (n >= 2) out.rows[r] = n;
    else { want[r] = true; missing = true; }
  });
  if (!withRows && !missing) return out;
  tbRows_('함께표줄').forEach(function (r) {
    out.ids[r['줄ID']] = true;
    if (want[r['줄ID']]) out.rows[r['줄ID']] = r._row;
    if (r['표ID'] === id && !r['삭제 여부']) {
      out.count++;
      out.maxOrder = Math.max(out.maxOrder, Number(r['순서']) || 0);
      out.orders.push({ id: r['줄ID'], o: Number(r['순서']) || 0 });
    }
  });
  return out;
}

/** 칸을 고칠 수 있는지(안 되면 오류) */
function tbCheckCell_(t, col, row, ctx) {
  var owner = tbOwner_(t, ctx);
  if (!owner && tbClosed_(t)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
  var mineRow = !!(row && ctx.identity && row['입력자ID'] === ctx.identity['교직원ID']);
  if (col.lock && !owner && !mineRow) throw userError_("'" + col.name + "' 열은 잠겨 있어요. 만든 분과 연구부장·부담당만 고칠 수 있어요.", 'LOCKED');
}

/** 잠금 안: 고친 칸을 줄에 넣는다 */
function tbPutRow_(r, cells, stamps, ver, actor) {
  var json = JSON.stringify(cells);
  if (json.length > TB_MAX_ROW_JSON_) throw userError_('한 줄에 글이 너무 많아요. 칸의 글을 조금 줄여 주세요.');
  r['칸'] = json;
  r['칸 고친 때'] = JSON.stringify(stamps);
  r['판'] = String(ver);
  r['수정자ID'] = actor.id || '';
  r['수정 시각'] = nowText_();
}

/**
 * 잠금 안: 줄들을 시트 끝에 더한다(화면에서는 순서대로: 보통 표 끝, order를 주면 그 순서 자리).
 * 잠근 열도 채울 수 있다(내가 더한 줄). 돌려주는 값: { rows: [줄 모양], cells: 채운 칸 수 }
 */
function tbAppendRows_(t, cols, adds, actor, hint, bump, names, order) {
  if (hint.count + adds.length > TB_MAX_ROWS_) throw userError_('줄은 ' + TB_MAX_ROWS_ + '개까지예요. 더 넣으려면 표를 나눠 주세요.');
  var head = tbHead_('함께표줄'), sh = sheet_('함께표줄');
  var ver = bump(), now = nowText_(), min = tbNowMin_(), filled = 0, start = sh.getLastRow() + 1;
  var recs = adds.map(function (a, i) {
    var src = (a && a.cells) || {}, cells = {}, stamps = {};
    cols.forEach(function (c) {
      var v = tbCleanValue_(c, src[c.id]);
      if (!v) return;
      cells[c.id] = v;
      stamps[c.id] = [ver, actor.name || '', min];
      filled++;
    });
    var id;
    do { id = 'L' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (hint.ids[id]);
    hint.ids[id] = true;
    var json = JSON.stringify(cells);
    if (json.length > TB_MAX_ROW_JSON_) throw userError_('한 줄에 글이 너무 많아요. 칸의 글을 조금 줄여 주세요.');
    return {
      '줄ID': id, '표ID': t['표ID'], '순서': String(order !== undefined && adds.length === 1 ? order : hint.maxOrder + i + 1), '칸': json, '색': '',
      '칸 고친 때': JSON.stringify(stamps), '판': String(ver), '입력자ID': actor.id || '', '입력 시각': now, '수정자ID': '', '수정 시각': '', '삭제 여부': '',
      _row: start + i
    };
  });
  growRows_(sh, start + recs.length - 1);
  sh.getRange(start, 1, recs.length, head.length).setValues(recs.map(function (rec) {
    return head.map(function (h) { return cellWrite_(h && rec[h] !== undefined ? rec[h] : ''); });
  }));
  dirty_('함께표줄');
  hint.count += recs.length;
  hint.maxOrder += recs.length;
  return { rows: recs.map(function (rec) { return tbRowView_(rec, names, t['입력자ID']); }), cells: filled };
}

// ---------------------------------------------------------------- 쓰기

/** 새 표: args.fields(이름·부서·설명·마감), args.cols(열), args.rows([{ cells: {열ID: 값}, colors: {열ID: '#RRGGBB'} }]) */
function apiTableCreate_(args, actor, ctx) {
  var meta = tbCleanMeta_(args.fields || {});
  var cols = tbCleanCols_(args.cols, []);
  var rows = Array.isArray(args.rows) ? args.rows : [];
  if (rows.length > TB_MAX_ROWS_) throw userError_('줄은 ' + TB_MAX_ROWS_ + '개까지 넣을 수 있어요. 나눠서 만들어 주세요.');
  var recs = rows.map(function (r) {
    var src = (r && r.cells) || {}, paint = (r && r.colors) || {}, cells = {}, colors = {};
    cols.forEach(function (c) {
      var v = tbCleanValue_(c, src[c.id]);
      if (v) cells[c.id] = v;
      var bg = tbCleanColor_(paint[c.id]);
      if (bg && bg !== '#FFFFFF') colors[c.id] = bg;
    });
    var json = JSON.stringify(cells);
    if (json.length > TB_MAX_ROW_JSON_) throw userError_('한 줄에 글이 너무 많아요. 칸의 글을 조금 줄여 주세요.');
    return { '칸': json, '색': Object.keys(colors).length ? JSON.stringify(colors) : '', '칸 고친 때': '', '판': '1' };
  });
  ensureTab_('함께표');
  ensureTab_('함께표줄');
  return withLock_(function () {
    var rec = { '상태': '', '열': JSON.stringify(cols), '판': '1' };
    Object.keys(meta).forEach(function (k) { rec[k] = meta[k]; });
    var t = insertRow_('함께표', rec, actor, '함께 쓰는 표 만듦: ' + meta['제목']);
    recs.forEach(function (r, i) { r['표ID'] = t['표ID']; r['순서'] = String(i + 1); });
    if (recs.length) insertRows_('함께표줄', recs, actor, '함께 쓰는 표 "' + meta['제목'] + '" 줄 ' + recs.length + '개 넣음');
    return { id: t['표ID'] };
  });
}

/** 칸 하나 고치기. args = { id, row, col, value, base(화면이 알던 그 칸의 판) } → 그사이 다른 분이 고쳤으면 { conflict } */
function apiTableCell_(args, actor, ctx) {
  var id = String(args.id || ''), rowId = String(args.row || ''), colId = String(args.col || '');
  var given = {};
  given[rowId] = args.n;
  var hint = tbHints_(id, [rowId], false, given);
  if (!hint.found) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  return withLock_(function () {
    var th = tbHead_('함께표'), t = tbReadRow_('함께표', id, hint.t, th);
    if (!t || t['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    var cols = tbCols_(t), col = cols.filter(function (c) { return c.id === colId; })[0];
    if (!col) throw userError_('그사이 열이 바뀌었어요. 표를 새로 불러올게요.', 'STALE');
    var rh = tbHead_('함께표줄'), r = tbReadRow_('함께표줄', rowId, hint.rows[rowId], rh);
    if (!r || r['삭제 여부'] || r['표ID'] !== id) throw userError_('그사이 이 줄이 지워졌어요. 표를 새로 불러올게요.', 'STALE');
    tbCheckCell_(t, col, r, ctx);
    var value = tbCleanValue_(col, args.value);
    var cells = tbParse_(r['칸'], {}), stamps = tbParse_(r['칸 고친 때'], {});
    var cur = cells[colId] === undefined || cells[colId] === null ? '' : String(cells[colId]);
    var st = Array.isArray(stamps[colId]) ? stamps[colId] : [0, '', ''];
    if (cur === value) return { ver: Number(t['판']) || 0, row: tbRowView_(r, names, t['입력자ID']) };
    if (args.base !== undefined && args.base !== null && Number(args.base) !== (Number(st[0]) || 0)) {
      return { conflict: { value: cur, by: st[1] || '', at: st[2] || '', base: Number(st[0]) || 0 }, ver: Number(t['판']) || 0, row: tbRowView_(r, names, t['입력자ID']) };
    }
    var ver = tbBump_(t, th);
    cells[colId] = value;
    stamps[colId] = [ver, actor.name || '', tbNowMin_()];
    tbPutRow_(r, cells, stamps, ver, actor);
    tbWriteRow_('함께표줄', r, rh);
    var before = {}, after = {};
    before[col.name] = cur;
    after[col.name] = value;
    writeLog_(actor, '함께표줄', rowId, '수정', '함께 쓰는 표 "' + t['제목'] + '" · ' + tbRowLabel_(cols, cells) + ' · ' + col.name + ' 고침', before, after);
    return { ver: ver, row: tbRowView_(r, names, t['입력자ID']) };
  });
}

/**
 * 여러 칸 한 번에(구글 시트에서 복사한 칸 붙여 넣기·줄 고치기 창). args.cells = [{ row, col, value, base }], args.add = [{ cells }](끝에 줄 더하기)
 * 잠근 열은 고칠 수 있는 분만 바뀌고, 그사이 다른 분이 고친 칸은 건너뛰고 알려 준다. 기록은 한 줄로
 */
function apiTableCells_(args, actor, ctx) {
  var id = String(args.id || '');
  var list = Array.isArray(args.cells) ? args.cells : [], adds = Array.isArray(args.add) ? args.add : [];
  if (list.length + adds.length * TB_MAX_COLS_ > TB_MAX_CELLS_) throw userError_('한 번에 ' + TB_MAX_CELLS_ + '칸까지 붙여 넣을 수 있어요. 나눠서 붙여 넣어 주세요.');
  var rowIds = [], given = {};
  list.forEach(function (x) {
    var r = String((x && x.row) || '');
    if (r && rowIds.indexOf(r) < 0) { rowIds.push(r); given[r] = x.n; }
  });
  var hint = tbHints_(id, rowIds, adds.length > 0, given);
  if (!hint.found) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  return withLock_(function () {
    var th = tbHead_('함께표'), t = tbReadRow_('함께표', id, hint.t, th);
    if (!t || t['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    var owner = tbOwner_(t, ctx);
    if (!owner && tbClosed_(t)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
    var cols = tbCols_(t), colOf = {};
    cols.forEach(function (c) { colOf[c.id] = c; });
    var rh = tbHead_('함께표줄');
    var byRow = {}, order = [];
    list.forEach(function (x) {
      if (!x || !colOf[String(x.col)]) return;
      var r = String(x.row || '');
      if (!byRow[r]) { byRow[r] = []; order.push(r); }
      byRow[r].push(x);
    });
    var ver = 0, changed = 0, skipLocked = 0, conflicts = [], before = {}, after = {}, out = [];
    var bump = function () { if (!ver) ver = tbBump_(t, th); return ver; };
    order.forEach(function (rowId) {
      var r = tbReadRow_('함께표줄', rowId, hint.rows[rowId], rh);
      if (!r || r['삭제 여부'] || r['표ID'] !== id) return;
      var mineRow = !!(ctx.identity && r['입력자ID'] === ctx.identity['교직원ID']);
      var cells = tbParse_(r['칸'], {}), stamps = tbParse_(r['칸 고친 때'], {}), touched = false;
      byRow[rowId].forEach(function (x) {
        var col = colOf[String(x.col)];
        if (col.lock && !owner && !mineRow) { skipLocked++; return; }
        var value = tbCleanValue_(col, x.value);
        var cur = cells[col.id] === undefined || cells[col.id] === null ? '' : String(cells[col.id]);
        if (cur === value) return;
        var st = Array.isArray(stamps[col.id]) ? stamps[col.id] : [0, '', ''];
        if (x.base !== undefined && x.base !== null && Number(x.base) !== (Number(st[0]) || 0)) { conflicts.push({ row: rowId, col: col.id }); return; }
        var v = bump();
        cells[col.id] = value;
        stamps[col.id] = [v, actor.name || '', tbNowMin_()];
        var label = tbRowLabel_(cols, cells) + ' · ' + col.name;
        before[label] = cur;
        after[label] = value;
        changed++;
        touched = true;
      });
      if (!touched) return;
      tbPutRow_(r, cells, stamps, ver, actor);
      tbWriteRow_('함께표줄', r, rh);
      out.push(tbRowView_(r, names, t['입력자ID']));
    });
    if (adds.length) {
      var added = tbAppendRows_(t, cols, adds, actor, hint, bump, names);
      out = out.concat(added.rows);
      changed += added.cells;
    }
    if (changed || adds.length) {
      writeLog_(actor, '함께표줄', '', adds.length && !list.length ? '추가' : '수정',
        '함께 쓰는 표 "' + t['제목'] + '" 여러 칸: ' + changed + '칸' + (adds.length ? ', 줄 ' + adds.length + '개 더함' : ''), before, after);
    }
    return { ver: Number(t['판']) || 0, changed: changed, skipLocked: skipLocked, conflicts: conflicts, rows: out };
  });
}

/** 줄 더하기(누구나, 교사 결정). 표 끝에, 또는 args.after(줄ID) 바로 아래에 더한다 */
function apiTableRowAdd_(args, actor, ctx) {
  var id = String(args.id || ''), hint = tbHints_(id, [], true);
  if (!hint.found) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  // 아래에 더하기: 그 줄과 다음 줄 순서의 가운데(순서는 숫자라 1.5처럼 사이에 넣을 수 있다)
  var order;
  var below = hint.orders.filter(function (x) { return x.id === String(args.after || ''); })[0];
  if (below) {
    var next = null;
    hint.orders.forEach(function (x) { if (x.o > below.o && (next === null || x.o < next)) next = x.o; });
    order = next === null ? below.o + 1 : Math.round((below.o + next) / 2 * 1e6) / 1e6;
    if (next !== null && !(order > below.o && order < next)) order = undefined; // 사이가 너무 좁으면 끝에
  }
  return withLock_(function () {
    var th = tbHead_('함께표'), t = tbReadRow_('함께표', id, hint.t, th);
    if (!t || t['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    if (!tbOwner_(t, ctx) && tbClosed_(t)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
    var cols = tbCols_(t);
    var res = tbAppendRows_(t, cols, [{ cells: args.cells || {} }], actor, hint, function () { return tbBump_(t, th); }, names, order);
    var after = {};
    cols.forEach(function (c) { if (res.rows[0].cells[c.id]) after[c.name] = res.rows[0].cells[c.id]; });
    writeLog_(actor, '함께표줄', res.rows[0].id, '추가', '함께 쓰는 표 "' + t['제목'] + '" 줄 더함', null, after);
    return { ver: Number(t['판']) || 0, row: res.rows[0] };
  });
}

/** 줄 빼기: 만든 분·관리·그 줄을 더한 분 */
function apiTableRowDelete_(args, actor, ctx) {
  var id = String(args.id || ''), rowId = String(args.row || ''), given = {};
  given[rowId] = args.n;
  var hint = tbHints_(id, [rowId], false, given);
  if (!hint.found) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  return withLock_(function () {
    var th = tbHead_('함께표'), t = tbReadRow_('함께표', id, hint.t, th);
    if (!t || t['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    var rh = tbHead_('함께표줄'), r = tbReadRow_('함께표줄', rowId, hint.rows[rowId], rh);
    if (!r || r['표ID'] !== id) throw userError_('이 줄을 찾지 못했어요. 표를 새로 불러올게요.', 'STALE');
    if (r['삭제 여부']) return { ver: Number(t['판']) || 0, row: tbRowView_(r, names, t['입력자ID']) };
    var owner = tbOwner_(t, ctx), mineRow = !!(ctx.identity && r['입력자ID'] === ctx.identity['교직원ID']);
    if (!owner && !mineRow) throw userError_('줄은 만든 분과 연구부장·부담당, 그 줄을 더한 분만 뺄 수 있어요.', 'FORBIDDEN');
    if (!owner && tbClosed_(t)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
    var ver = tbBump_(t, th), cols = tbCols_(t), cells = tbParse_(r['칸'], {});
    r['삭제 여부'] = '삭제';
    r['판'] = String(ver);
    r['수정자ID'] = actor.id || '';
    r['수정 시각'] = nowText_();
    tbWriteRow_('함께표줄', r, rh);
    var before = {};
    cols.forEach(function (c) { if (cells[c.id]) before[c.name] = cells[c.id]; });
    writeLog_(actor, '함께표줄', rowId, '삭제', '함께 쓰는 표 "' + t['제목'] + '" 줄 뺌: ' + tbRowLabel_(cols, cells), before, null);
    return { ver: ver, row: tbRowView_(r, names, t['입력자ID']) };
  });
}

/** 열 고치기(이름·종류·고를 값·잠금·위아래 합치기·너비·순서·더하기·빼기): 만든 분·관리 */
function apiTableCols_(args, actor, ctx) {
  var t0 = tbFind_(String(args.id || ''));
  if (!t0) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(t0, ctx)) throw userError_('열은 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
  return withLock_(function () {
    var t = findRow_('함께표', t0['표ID']);
    if (!t || t['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    var all = tbAllCols_(t), next = tbCleanCols_(args.cols, all);
    var keep = {};
    next.forEach(function (c) { keep[c.id] = true; });
    // 뺀 열은 del로 남겨 둔다(ID를 다시 쓰지 않고, 시트의 값도 그대로)
    var gone = all.filter(function (c) { return !keep[c.id]; }).map(function (c) {
      return { id: c.id, name: c.name, type: c.type, options: c.options || [], lock: !!c.lock, merge: !!c.merge, w: c.w || 0, del: true };
    });
    var json = JSON.stringify(next.concat(gone));
    if (json.length > 40000) throw userError_('열 설정이 너무 길어요. 고를 값이나 열 이름을 줄여 주세요.');
    var ver = (Number(t['판']) || 0) + 1;
    updateRow_('함께표', t['표ID'], { '열': json, '판': String(ver) }, actor, '함께 쓰는 표 "' + t['제목'] + '" 열 고침');
    return { ver: ver };
  });
}

/** 표 이름·부서·설명·마감 고치기: 만든 분·관리 */
function apiTableSave_(args, actor, ctx) {
  var t0 = tbFind_(String(args.id || ''));
  if (!t0) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(t0, ctx)) throw userError_('만든 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
  var rec = tbCleanMeta_(args.fields || {});
  return withLock_(function () {
    var t = findRow_('함께표', t0['표ID']);
    if (!t || t['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    rec['판'] = String((Number(t['판']) || 0) + 1);
    updateRow_('함께표', t['표ID'], rec, actor, '함께 쓰는 표 고침: ' + rec['제목']);
    return { ver: Number(rec['판']) };
  });
}

/** 지금 마감 / 다시 열기: 만든 분·관리 */
function apiTableSetOpen_(args, actor, ctx) {
  var t0 = tbFind_(String(args.id || ''));
  if (!t0) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(t0, ctx)) throw userError_('만든 분과 연구부장·부담당만 바꿀 수 있어요.', 'FORBIDDEN');
  return withLock_(function () {
    var t = findRow_('함께표', t0['표ID']);
    if (!t || t['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    if (args.open && t['마감'] && t['마감'] < tbToday_()) throw userError_('마감 날짜가 지났어요. "표 고치기"에서 마감을 늦추거나 지운 뒤 다시 열어 주세요.');
    var ver = (Number(t['판']) || 0) + 1;
    updateRow_('함께표', t['표ID'], { '상태': args.open ? '' : '마감', '판': String(ver) }, actor, '함께 쓰는 표 ' + (args.open ? '다시 엶: ' : '마감함: ') + t['제목']);
    return { ver: ver };
  });
}

/** 표 지우기(숨김, 관리자 › 휴지통에서 되살림): 만든 분·관리 */
function apiTableDelete_(args, actor, ctx) {
  var t0 = tbFind_(String(args.id || ''));
  if (!t0) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(t0, ctx)) throw userError_('만든 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  return withLock_(function () {
    var t = findRow_('함께표', t0['표ID']);
    if (!t || t['삭제 여부']) return { done: true };
    updateRow_('함께표', t['표ID'], { '삭제 여부': '삭제', '판': String((Number(t['판']) || 0) + 1) }, actor, '함께 쓰는 표 지움: ' + t['제목'], '삭제');
    return { done: true };
  });
}

// ---------------------------------------------------------------- 휴지통(관리자)

function adminTableTrash_() {
  var names = staffNames_();
  var del = tbRows_('함께표').filter(function (t) { return t['삭제 여부']; });
  del.sort(function (a, b) { var x = String(a['수정 시각'] || ''), y = String(b['수정 시각'] || ''); return x < y ? 1 : x > y ? -1 : 0; }); // 최근에 지운 것부터
  return del.slice(0, 100).map(function (t) {
    return { id: t['표ID'], title: t['제목'], by: names[t['입력자ID']] || '', deletedBy: names[t['수정자ID']] || '', deletedAt: t['수정 시각'] };
  });
}

function adminTableRestore_(args, actor) {
  return withLock_(function () {
    var t = findRow_('함께표', String(args.id || ''));
    if (!t || !t['삭제 여부']) throw userError_('되살릴 표를 찾지 못했어요.');
    updateRow_('함께표', t['표ID'], { '삭제 여부': '', '판': String((Number(t['판']) || 0) + 1) }, actor, '함께 쓰는 표 되살림: ' + t['제목'], '되살리기');
    return { done: true };
  });
}

// ---------------------------------------------------------------- 테스트용 가짜 표(미리보기·시험)

/** 가짜 표 2개(예시). 실제 교직원 이름은 쓰지 않는다(가짜 교직원 이름만) */
function seedTestTables_() {
  var staff = liveRows_('교직원');
  var pick = function (name) { return staff.filter(function (s) { return s['이름'] === name; })[0]; };
  var maker = pick('흥부') || staff[0];
  if (!maker) return 0;
  var ctx = { identity: maker, tokens: {}, admin: false };
  var actor = { id: maker['교직원ID'], name: maker['이름'] };
  var dept = function (n) {
    var d = liveRows_('분류').filter(function (r) { return r['종류'] === '부서' && r['이름'] === n; })[0];
    return d ? d['분류ID'] : '';
  };
  var d7 = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), tz_(), 'yyyy-MM-dd');
  var cols1 = [
    { id: 'c1', name: '층', lock: true, merge: true, w: 70 }, { id: 'c2', name: '각 실', lock: true, w: 120 },
    { id: 'c3', name: '관리자', lock: true, w: 100 }, { id: 'c4', name: '입력완료', type: 'pick', options: ['완료', '미완료'], w: 110 },
    { id: 'c5', name: '배출이 어려운 가구', w: 320 }
  ];
  var floors = { '1층': '#F4CCCC', '2층': '#FFF2CC', '3층': '#CFE2F3' };
  var list1 = [
    ['1층', '교장실', '홍길동', '미완료', ''], ['1층', '보건실', '성춘향', '완료', '의자 8개(플라스틱 및 스텐)'], ['1층', '도서관', '심청', '완료', ''],
    ['2층', '교무실', '이몽룡', '완료', ''], ['2층', '방송실', '장화', '완료', '방송 업체 협의 중'], ['2층', '1-1', '홍련', '완료', 'tv 거치대'],
    ['2층', '컴퓨터실', '놀부', '미완료', ''], ['3층', '3-1', '홍길동', '완료', 'tv 거치대'], ['3층', '3-2', '성춘향', '미완료', ''],
    ['3층', '과학실', '놀부', '미완료', '실험대 2개']
  ];
  var rows1 = list1.map(function (x) {
    var cells = {}, colors = {};
    x.forEach(function (v, i) { if (v) cells['c' + (i + 1)] = v; });
    ['c1', 'c2', 'c3'].forEach(function (c) { colors[c] = floors[x[0]]; });
    return { cells: cells, colors: colors };
  });
  apiTableCreate_({ fields: { title: '2026 폐기 물품 조사(예시)', deptId: dept('인성안전부'), deadline: d7, desc: '버리기 어려운 가구를 실마다 적어 주세요(예시)' }, cols: cols1, rows: rows1 }, actor, ctx);
  var cols2 = [{ id: 'c1', name: '교시', lock: true, w: 70 }].concat(['월', '화', '수', '목', '금'].map(function (d, i) { return { id: 'c' + (i + 2), name: d, w: 110 }; }));
  var rows2 = ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'].map(function (p, i) {
    var cells = { c1: p };
    if (i === 0) { cells.c2 = '3-1 과학'; cells.c4 = '5-1 과학'; }
    if (i === 2) cells.c3 = '6-2 과학';
    return { cells: cells };
  });
  var c2 = pick('놀부') || maker;
  apiTableCreate_({ fields: { title: '전담 특별실(과학실) 배정 시간표(예시)', deptId: dept('연구부'), deadline: '', desc: '' }, cols: cols2, rows: rows2 },
    { id: c2['교직원ID'], name: c2['이름'] }, { identity: c2, tokens: {}, admin: false });
  return 2;
}
