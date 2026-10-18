/**
 * Table.gs — 함께 쓰는 표(구글 시트처럼 여러 선생님이 한 표를 함께 채운다)
 *
 * - 표 하나에 시트(탭)가 여러 개다(판 2026-10-18a, 교사 요청). '함께표' 탭의 한 줄이 시트 하나다
 *   · 첫 시트 줄(문서ID가 비어 있음)이 표 전체도 맡는다: 제목·부서·마감·상태·만든 분(입력자ID)·표 지움(삭제 여부)·문서 판
 *   · 다른 시트 줄은 문서ID에 첫 시트 줄의 표ID를 적는다. 시트 이름·시트 순서·설명·열·판·보기는 시트마다 따로
 *   · 첫 시트를 지우면 '시트 지움'에 표시한다(표 전체 정보는 그 줄에 그대로 남는다). 다른 시트를 지우면 '삭제 여부'
 *   · 예전 표(2026-10-17h)는 첫 시트 줄 하나뿐인 표로 그대로 열린다(시트 이름이 비어 있으면 '시트1')
 * - 줄('함께표줄' 탭): 표ID(그 시트의 표ID)·순서·칸(JSON {열ID: 값})·색(JSON {열ID: '#RRGGBB'}, 채우기 색)·칸 고친 때·판·서식·높이
 *   · 서식(JSON {열ID: { ff 글꼴, fs 크기(pt), fc 글자 색, b 굵게, i 기울임, u 밑줄, s 가운데 줄, ha 가로 맞춤 l·c·r, va 세로 맞춤 t·m·b,
 *     wr 'c'(한 줄로 자르기), bd 테두리 '위·오른쪽·아래·왼쪽'(0 없음·1 얇게·2 굵게), m 합친 칸 [맨 아래 줄ID, 맨 오른쪽 열ID] }})
 *   · 합친 칸은 왼쪽 위 칸에만 적는다. 덮인 칸의 값은 지우지 않고 숨겨 둔다(합치기를 풀면 다시 보인다)
 *   · 줄을 빼거나 합친 칸 바로 아래에 줄을 더하면 서버가 합친 칸의 끝을 맞춘다(합친 칸이 깨지지 않게)
 *   · 높이: 줄 높이(px, 비어 있으면 글에 맞춤)
 * - 열(JSON): [{ id, name, type: 'text'|'pick', options, lock, merge, w, del }]
 *   pick: 고르기(정해 둔 값 중 하나, 맨 앞 값을 '끝난 것'으로 센다) · lock: 잠근 열 · merge: 위아래 같은 값을 한 칸처럼(예전 표·열 고치기)
 *   w: 열 너비(px) · del: 뺀 열(값은 시트에 그대로 두고 화면에서만 뺀다. 열 ID를 다시 쓰지 않으려고 남겨 둔다)
 * - 보기(JSON {fr: 왼쪽에 고정할 열 수, gap: 's'|'n'|'w' 줄 간격}): 이 시트를 보는 모든 선생님 화면에 함께 바뀐다(교사 결정)
 * - 판: 시트에서 무엇이든 바뀔 때마다 1씩 는다. 줄마다 마지막으로 바뀐 판을 적어 두어, 화면은 10초마다 '내 판 다음'만 받아 간다
 *   문서 판: 시트를 더하거나 이름·순서를 바꾸거나 지울 때, 표 이름·마감을 바꿀 때 는다(시트 탭·표 머리를 새로 받게)
 * - 칸 고친 때(JSON {열ID: [판, 이름, 시각]}): 화면이 알던 판(base)과 다르면 그사이 다른 분이 고친 것 → 덮어쓰지 않고 묻는다
 * - 권한(교사 결정): 보기는 로그인한 누구나. 표 만들기·칸 고치기·줄 더하기는 이름을 고른 교직원 누구나
 *   서식(글꼴·크기·색·테두리·합치기·맞춤)은 그 칸을 고칠 수 있는 분 누구나, 열 너비·줄 높이·보기(왼쪽 열 고정·줄 간격)는 고칠 수 있는 분 누구나
 *   잠근 열은 만든 분·관리(그 줄을 더한 분은 그 줄의 잠근 칸도), 줄 빼기는 만든 분·관리·그 줄을 더한 분
 *   시트 더하기·이름·설명·열·사본·옮기기·지우기, 표 이름·마감·지우기는 만든 분·관리. 마감한 표는 만든 분·관리만 고친다
 * - 칸을 고칠 때마다 기록 탭에 바뀌기 전·후가 남는다. 지운 표·시트는 관리자 › 휴지통에서 되살린다
 * - 여럿이 동시에 고쳐도 빠르게: 칸·줄을 고칠 때는 잠금 안에서 탭 전체가 아니라 그 줄만 읽고 쓴다
 *   (줄의 행 번호는 잠금 밖에서 서버 기억으로 먼저 찾아 두고, 잠금 안에서 그 줄이 맞는지 다시 본다)
 */

function fileMark_Table_() { return '2026-10-18a'; } // 판 표시(관리자 › 점검)

var TB_MAX_ROWS_ = 500;       // 한 시트의 줄
var TB_MAX_COLS_ = 30;        // 한 시트의 열
var TB_MAX_CELL_ = 2000;      // 한 칸 글자 수
var TB_MAX_OPTIONS_ = 12;     // 고르기 열의 값 수
var TB_MAX_CELLS_ = 5000;     // 한 번에 붙여 넣는 칸 수
var TB_MAX_ROW_JSON_ = 45000; // 한 줄의 칸(JSON) 글자 수(시트 한 칸은 5만 자까지)
var TB_MAX_FMT_JSON_ = 45000; // 한 줄의 서식(JSON) 글자 수
var TB_MAX_SHEETS_ = 100;     // 한 표의 시트
var TB_FONTS_ = { malgun: 1, gulim: 1, dotum: 1, batang: 1, gungsuh: 1 }; // 맑은 고딕·굴림·돋움·바탕·궁서(없으면 기본 글꼴)
var TB_FMT_KEYS_ = ['ff', 'fs', 'fc', 'b', 'i', 'u', 's', 'ha', 'va', 'wr', 'bd', 'm'];

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

/** 서식·시트에 쓰는 칸(2026-10-18a에 더함)이 시트에 없으면 머리글 끝에 붙인다 */
function tbEnsureCols_() {
  ensureTab_('함께표');
  ensureTab_('함께표줄');
  ensureCols_('함께표');
  ensureCols_('함께표줄');
}

// ---------------------------------------------------------------- 표와 시트

function tbById_(all, id) {
  for (var i = 0; i < all.length; i++) if (all[i]['표ID'] === id) return all[i];
  return null;
}
/** 첫 시트 줄(표 전체를 맡는 줄)인지 */
function tbIsMain_(t) { return !t['문서ID']; }
function tbMainOf_(all, t) { return tbIsMain_(t) ? t : tbById_(all, t['문서ID']); }
/** 시트가 지워졌는지(첫 시트는 '시트 지움', 다른 시트는 '삭제 여부') */
function tbSheetGone_(t) { return tbIsMain_(t) ? !!t['시트 지움'] : !!t['삭제 여부']; }
function tbSheetName_(t) { return String(t['시트 이름'] || '').trim() || (tbIsMain_(t) ? '시트1' : '시트'); }
function tbSheetOrder_(t) { return Number(t['시트 순서']) || 0; }

/** 표의 지우지 않은 시트(시트 순서대로) */
function tbSheetsOf_(all, docId) {
  return all.filter(function (x) {
    return x['표ID'] === docId ? !tbSheetGone_(x) : (x['문서ID'] === docId && !x['삭제 여부']);
  }).sort(function (a, b) {
    var x = tbSheetOrder_(a), y = tbSheetOrder_(b);
    if (x !== y) return x - y;
    if (tbIsMain_(a) !== tbIsMain_(b)) return tbIsMain_(a) ? -1 : 1;
    var p = String(a['입력 시각'] || ''), q = String(b['입력 시각'] || '');
    return p < q ? -1 : p > q ? 1 : (a['표ID'] < b['표ID'] ? -1 : 1);
  });
}

/** 기록에 남길 이름: 함께 쓰는 표 "표 이름 › 시트 이름" */
function tbLabel_(main, t) {
  return '함께 쓰는 표 "' + main['제목'] + (t ? ' › ' + tbSheetName_(t) : '') + '"';
}

/** 만든 분이나 관리(역할 '관리' 또는 관리자 화면) */
function tbOwner_(t, ctx) {
  return canManage_(ctx) || !!(ctx.identity && t['입력자ID'] && t['입력자ID'] === ctx.identity['교직원ID']);
}

/** 마감: 손으로 마감했거나 마감 날짜가 지났으면(마감 날짜 당일까지는 열려 있다) */
function tbClosed_(t) {
  return t['상태'] === '마감' || !!(t['마감'] && t['마감'] < tbToday_());
}

/** 이 시트에 무언가 쓸 수 있는지(이름을 고른 분, 마감한 표는 만든 분·관리) */
function tbCheckWrite_(main, ctx) {
  if (!ctx.identity) throw userError_('이름을 고르면 고칠 수 있어요.', 'IDENTITY');
  if (!tbOwner_(main, ctx) && tbClosed_(main)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
}

function tbAllCols_(t) {
  var list = tbParse_(t['열'], []);
  return Array.isArray(list) ? list.filter(function (c) { return c && c.id; }) : [];
}
function tbCols_(t) {
  return tbAllCols_(t).filter(function (c) { return !c.del; });
}

/** 보기: 왼쪽에 고정할 열 수(0~5)·줄 간격(s 좁게·n 보통·w 넓게) */
function tbCleanView_(v) {
  v = v || {};
  var fr = Math.floor(Number(v.fr) || 0);
  return { fr: fr >= 0 && fr <= 5 ? fr : 0, gap: /^[snw]$/.test(String(v.gap || '')) ? String(v.gap) : 'n' };
}
function tbViewOf_(t) { return tbCleanView_(tbParse_(t['보기'], {})); }
function tbViewJson_(v) { return v.fr || v.gap !== 'n' ? JSON.stringify(v) : ''; }

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
    return { id: id, name: name, type: type, options: options, lock: !!c.lock, merge: !!c.merge, w: tbCleanWidth_(c.w) };
  });
}
/** 열 너비(px): 40~900, 그 밖이면 0(기본 너비) */
function tbCleanWidth_(w) {
  w = Math.round(Number(w) || 0);
  return w >= 40 && w <= 900 ? w : 0;
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

// ---------------------------------------------------------------- 서식

/** 서식 값 하나 다듬기. 알맞지 않으면 undefined(그 서식을 뺀다) */
function tbCleanFmtVal_(k, v) {
  if (v === null || v === undefined) return undefined;
  var s = String(v);
  switch (k) {
    case 'ff': return TB_FONTS_[s] ? s : undefined;
    case 'fs': var n = Math.round(Number(v) * 2) / 2; return n >= 6 && n <= 48 ? n : undefined;
    case 'fc': return tbCleanColor_(s) || undefined;
    case 'b': case 'i': case 'u': case 's': return v ? 1 : undefined;
    case 'ha': return /^[lcr]$/.test(s) ? s : undefined;
    case 'va': return /^[tmb]$/.test(s) ? s : undefined;
    case 'wr': return s === 'c' ? 'c' : undefined;
    case 'bd': return /^[012]{4}$/.test(s) && s !== '0000' ? s : undefined;
    case 'm':
      return Array.isArray(v) && v.length === 2 && /^(L[0-9A-F]{8}|\+\d{1,3})$/.test(String(v[0])) && /^c\d{1,4}$/.test(String(v[1]))
        ? [String(v[0]), String(v[1])] : undefined;
  }
  return undefined;
}
/** 한 칸의 서식 전체 다듬기(새로 넣는 줄). 빈 서식은 null */
function tbCleanFmt_(f) {
  if (!f || typeof f !== 'object') return null;
  var out = {}, n = 0;
  TB_FMT_KEYS_.forEach(function (k) {
    var v = tbCleanFmtVal_(k, f[k]);
    if (v !== undefined) { out[k] = v; n++; }
  });
  return n ? out : null;
}
/** 지금 서식에 바꿀 것(patch)을 얹는다. patch의 값이 null이면 그 서식을 뺀다. clear: 서식 지우기(합친 칸은 그대로) */
function tbPatchFmt_(cur, patch, clear) {
  var out = {};
  if (cur && typeof cur === 'object') Object.keys(cur).forEach(function (k) { if (!clear || k === 'm') out[k] = cur[k]; });
  if (patch && typeof patch === 'object') Object.keys(patch).forEach(function (k) {
    if (TB_FMT_KEYS_.indexOf(k) < 0) return;
    var v = tbCleanFmtVal_(k, patch[k]);
    if (v === undefined) delete out[k]; else out[k] = v;
  });
  return Object.keys(out).length ? out : null;
}
/** 합친 칸이 잠근 열을 덮는지(잠근 열을 덮는 합치기는 만든 분·관리만) */
function tbSpanLocked_(cols, from, to) {
  var a = -1, b = -1;
  cols.forEach(function (c, j) { if (c.id === from) a = j; if (c.id === to) b = j; });
  if (a < 0) return false;
  if (b < a) b = a;
  for (var j = a; j <= b; j++) if (cols[j].lock) return true;
  return false;
}
/** 줄에 서식·채우기 색을 넣는다 */
function tbPutFmt_(r, fmt, colors) {
  var fj = Object.keys(fmt).length ? JSON.stringify(fmt) : '';
  if (fj.length > TB_MAX_FMT_JSON_) throw userError_('한 줄에 서식이 너무 많아요. 서식을 조금 지워 주세요.');
  r['서식'] = fj;
  r['색'] = Object.keys(colors).length ? JSON.stringify(colors) : '';
}
/** 줄 높이(px): 20~600, 그 밖이면 0(글에 맞춤) */
function tbCleanHeight_(h) {
  h = Math.round(Number(h) || 0);
  return h >= 20 && h <= 600 ? h : 0;
}

/**
 * 합친 칸에 덮여 화면에 안 보이는 칸 {'줄ID|열ID': 1} (찾기에서 세지 않게). rows: 순서대로 정렬한 줄.
 * 예전 표의 '위아래 같은 값 합침' 열은 이어지는 같은 값의 둘째 칸부터
 */
function tbCovered_(cols, rows) {
  var ci = {}, ri = {}, out = {};
  cols.forEach(function (c, j) { ci[c.id] = j; });
  rows.forEach(function (r, i) { ri[r['줄ID']] = i; });
  rows.forEach(function (r, i) {
    var f = tbParse_(r['서식'], {});
    Object.keys(f).forEach(function (cid) {
      var m = f[cid] && f[cid].m, j = ci[cid];
      if (!Array.isArray(m) || j === undefined || out[r['줄ID'] + '|' + cid]) return;
      var i2 = ri[m[0]] !== undefined ? Math.max(i, ri[m[0]]) : i, j2 = ci[m[1]] !== undefined ? Math.max(j, ci[m[1]]) : j;
      for (var a = i; a <= i2; a++) for (var b = j; b <= j2; b++) if (a !== i || b !== j) out[rows[a]['줄ID'] + '|' + cols[b].id] = 1;
    });
  });
  cols.forEach(function (c) {
    if (!c.merge) return;
    var prev = null;
    rows.forEach(function (r) {
      var v = String(tbParse_(r['칸'], {})[c.id] || '').trim(), key = r['줄ID'] + '|' + c.id;
      if (v && v === prev && !out[key]) out[key] = 1;
      prev = out[key] ? prev : v;
    });
  });
  return out;
}

/** 표 이름·부서·설명(첫 시트)·마감 */
function tbCleanMeta_(f) {
  var title = cleanText_(f.title, 80, '표 이름', true);
  var deptId = cleanText_(f.deptId, 20, '담당 부서');
  if (deptId && !categoryNames_('부서')[deptId]) throw userError_('담당 부서를 다시 골라 주세요.');
  var deadline = String(f.deadline || '');
  if (deadline && !isDate_(deadline)) throw userError_('마감 날짜를 다시 골라 주세요.');
  return { '제목': title, '부서ID': deptId, '설명': cleanText_(f.desc, 500, '설명'), '마감': deadline };
}

/** 시트 이름 다듬기: 표 안에서 겹치지 않게 */
function tbCleanSheetName_(v, sheets, exceptId) {
  var name = cleanText_(v, 40, '시트 이름', true).replace(/\s+/g, ' ');
  var key = name.toLowerCase();
  if (sheets.some(function (s) { return s['표ID'] !== exceptId && tbSheetName_(s).toLowerCase() === key; })) {
    throw userError_("'" + name + "' 시트가 이미 있어요. 다른 이름을 적어 주세요.");
  }
  return name;
}
/** 겹치지 않는 시트 이름(사본·되살리기): '폐기 물품 사본', '폐기 물품 사본 2' … */
function tbFreeSheetName_(base, sheets) {
  var taken = {};
  sheets.forEach(function (s) { taken[tbSheetName_(s).toLowerCase()] = 1; });
  base = String(base).slice(0, 36);
  if (!taken[base.toLowerCase()]) return base;
  for (var k = 2; k < 200; k++) { var n = base + ' ' + k; if (!taken[n.toLowerCase()]) return n; }
  return base + ' ' + Date.now() % 1000;
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

/** 시트 하나(표 전체 정보도 함께: 표 이름·마감·권한은 첫 시트 줄에서) */
function tbView_(main, t, ctx, names, depts) {
  var owner = tbOwner_(main, ctx), closed = tbClosed_(main);
  return {
    id: t['표ID'], doc: main['표ID'], name: tbSheetName_(t), title: main['제목'], deptId: main['부서ID'] || '', dept: depts[main['부서ID']] || '',
    desc: t['설명'] || '', deadline: main['마감'] || '', closedByHand: main['상태'] === '마감', closed: closed,
    cols: tbCols_(t), ver: Number(t['판']) || 0, dver: Number(main['문서 판']) || 0, view: tbViewOf_(t),
    by: names[main['입력자ID']] || '', byId: main['입력자ID'] || '', at: String(main['입력 시각'] || '').slice(0, 16),
    canEdit: owner, canWrite: !!ctx.identity && (!closed || owner), manage: canManage_(ctx),
    me: ctx.identity ? ctx.identity['교직원ID'] : ''
  };
}

/** 표의 시트 목록(시트 탭·모든 시트 목록): 이름과 줄 수·첫 고르기 열의 값별 수 */
function tbDocView_(main, sheets, rowsBy) {
  return {
    id: main['표ID'], dver: Number(main['문서 판']) || 0,
    sheets: sheets.map(function (s) { return { id: s['표ID'], name: tbSheetName_(s), summary: tbSummary_(tbCols_(s), rowsBy[s['표ID']] || []) }; })
  };
}
/** 시트마다 지우지 않은 줄 */
function tbRowsBy_(sheets) {
  var want = {}, out = {};
  sheets.forEach(function (s) { want[s['표ID']] = true; out[s['표ID']] = []; });
  if (sheets.length) tbRows_('함께표줄').forEach(function (r) { if (want[r['표ID']] && !r['삭제 여부']) out[r['표ID']].push(r); });
  return out;
}

/** 줄. by·at: 마지막으로 고친 분(표를 만든 뒤 고친 적이 없으면, 나중에 더한 줄은 더한 분) */
function tbRowView_(r, names, creatorId) {
  var edited = !!r['수정자ID'];
  var byId = edited ? r['수정자ID'] : (r['입력자ID'] !== creatorId ? r['입력자ID'] : '');
  var at = edited ? r['수정 시각'] : (byId ? r['입력 시각'] : '');
  return {
    id: r['줄ID'], order: Number(r['순서']) || 0, cells: tbParse_(r['칸'], {}), colors: tbParse_(r['색'], {}),
    fmt: tbParse_(r['서식'], {}), h: Number(r['높이']) || 0,
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
  var all = tbRows_('함께표');
  var mains = all.filter(function (t) { return tbIsMain_(t) && !t['삭제 여부']; });
  var rowsBy = {};
  if (mains.length) {
    tbRows_('함께표줄').forEach(function (r) {
      if (!r['삭제 여부']) (rowsBy[r['표ID']] = rowsBy[r['표ID']] || []).push(r);
    });
  }
  var me = ctx.identity ? ctx.identity['교직원ID'] : '';
  var cards = mains.map(function (t) {
    var sheets = tbSheetsOf_(all, t['표ID']);
    var last = null;
    sheets.forEach(function (s) {
      (rowsBy[s['표ID']] || []).forEach(function (r) {
        var at = String(r['수정 시각'] || ''), who = r['수정자ID'];
        if (!at && r['입력자ID'] !== t['입력자ID']) { at = String(r['입력 시각'] || ''); who = r['입력자ID']; } // 나중에 더한 줄
        if (at && who && (!last || at > last.at)) last = { at: at, id: who };
      });
    });
    var v = tbView_(t, sheets[0] || t, ctx, names, depts);
    var list = sheets.map(function (s) { return { id: s['표ID'], name: tbSheetName_(s), summary: tbSummary_(tbCols_(s), rowsBy[s['표ID']] || []) }; });
    return {
      id: t['표ID'], title: v.title, dept: v.dept, deadline: v.deadline, closed: v.closed, by: v.by, at: v.at,
      mine: !!me && t['입력자ID'] === me, cols: v.cols.length,
      last: last ? { by: names[last.id] || '', at: last.at.slice(0, 16) } : null,
      summary: list.length ? list[0].summary : { rows: 0 }, sheets: list
    };
  });
  cards.sort(function (a, b) {
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    var da = a.deadline || '9999', db = b.deadline || '9999';
    if (!a.closed && da !== db) return da < db ? -1 : 1;
    var la = a.last ? a.last.at : a.at, lb = b.last ? b.last.at : b.at;
    return la < lb ? 1 : la > lb ? -1 : 0;
  });
  return { tables: cards, canCreate: !!ctx.identity, today: tbToday_(), depts: deptOptions_().filter(function (d) { return d.active; }) };
}

/**
 * 표 열기: args.id(표ID, 시트의 표ID도 된다), args.sheet(열 시트, 없거나 지워졌으면 첫 시트)
 * 돌려주는 값: { table: 시트(표 정보 포함), doc: { 시트 목록 }, rows, depts }
 */
function apiTableGet_(args, actor, ctx) {
  var all = tbRows_('함께표'), id = String(args.id || ''), t0 = tbById_(all, id);
  var main = t0 ? tbMainOf_(all, t0) : null;
  if (!main || main['삭제 여부']) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var sheets = tbSheetsOf_(all, main['표ID']);
  var want = String(args.sheet || '') || (t0 !== main ? t0['표ID'] : '');
  var t = sheets.filter(function (s) { return s['표ID'] === want; })[0] || sheets[0] || main;
  var names = staffNames_(), rowsBy = tbRowsBy_(sheets.indexOf(t) < 0 ? sheets.concat([t]) : sheets);
  return {
    table: tbView_(main, t, ctx, names, categoryNames_('부서')),
    doc: tbDocView_(main, sheets, rowsBy),
    rows: tbSortRows_(rowsBy[t['표ID']] || []).map(function (r) { return tbRowView_(r, names, main['입력자ID']); }),
    depts: deptOptions_().filter(function (d) { return d.active; })
  };
}

/**
 * 새로 받기(화면이 시트를 보는 동안 10초마다, 뒤에서). args = { id: 시트, since: 화면이 가진 시트 판, dsince: 문서 판 }
 * 시트가 바뀌었으면 since보다 뒤에 바뀐 줄만, 표(시트 탭·이름·마감)가 바뀌었으면 시트 목록도.
 * 바뀐 것이 없으면 '함께표' 탭(작다)만 보고 바로 돌아간다
 */
function apiTablePoll_(args, actor, ctx) {
  var id = String(args.id || ''), since = Number(args.since) || 0, dsince = Number(args.dsince) || 0;
  var all = tbRows_('함께표'), t = tbById_(all, id), main = t ? tbMainOf_(all, t) : null;
  if (!t || !main || main['삭제 여부']) return { gone: true };
  var ver = Number(t['판']) || 0, dver = Number(main['문서 판']) || 0, gone = tbSheetGone_(t);
  if (ver <= since && dver <= dsince && !gone) return { ver: ver, dver: dver, same: true };
  var names = staffNames_(), out = { ver: ver, dver: dver };
  if (dver > dsince || gone) {
    var sheets = tbSheetsOf_(all, main['표ID']);
    out.doc = tbDocView_(main, sheets, tbRowsBy_(sheets));
  }
  if (gone) { out.sheetGone = true; return out; }
  out.table = tbView_(main, t, ctx, names, categoryNames_('부서'));
  out.rows = ver > since ? tbSortRows_(tbRows_('함께표줄').filter(function (r) { return r['표ID'] === id && (Number(r['판']) || 0) > since; }))
    .map(function (r) { return tbRowView_(r, names, main['입력자ID']); }) : [];
  return out;
}

/** 찾기: 표의 시트마다 찾은 칸 수(합친 칸에 덮여 안 보이는 칸은 세지 않는다). args = { id, q } */
function apiTableFind_(args, actor, ctx) {
  var all = tbRows_('함께표'), t = tbById_(all, String(args.id || '')), main = t ? tbMainOf_(all, t) : null;
  if (!main || main['삭제 여부']) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var q = String(args.q || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 100), counts = {};
  var sheets = tbSheetsOf_(all, main['표ID']);
  if (!q) return { q: q, counts: counts };
  var rowsBy = tbRowsBy_(sheets);
  sheets.forEach(function (s) {
    var cols = tbCols_(s), rows = tbSortRows_(rowsBy[s['표ID']] || []), hidden = tbCovered_(cols, rows), n = 0;
    rows.forEach(function (r) {
      var cells = tbParse_(r['칸'], {});
      cols.forEach(function (c) {
        var v = cells[c.id];
        if (v && !hidden[r['줄ID'] + '|' + c.id] && String(v).toLowerCase().indexOf(q) >= 0) n++;
      });
    });
    counts[s['표ID']] = n;
  });
  return { q: q, counts: counts };
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

/** 잠금 안: 줄의 칸 하나만 쓴다(기록 없이: 판·순서 같은 숫자) */
function tbSetCell_(tab, row, head, key, value) {
  var c = head.indexOf(key);
  if (c < 0) return false;
  sheet_(tab).getRange(row._row, c + 1).setValue(cellWrite_(String(value)));
  row[key] = String(value);
  dirty_(tab);
  return true;
}

/** 잠금 안: 시트의 판을 하나 올린다(기록 없이, 화면이 새로 받을 때 쓰는 숫자). 바뀐 판을 돌려준다 */
function tbBump_(t, head) {
  var ver = (Number(t['판']) || 0) + 1;
  if (!tbSetCell_('함께표', t, head, '판', ver)) throw userError_("'함께표' 탭에 '판' 칸이 없어요. 관리자 › 점검을 봐 주세요.");
  return ver;
}
/** 잠금 안: 문서 판을 하나 올린다(시트 탭·표 머리를 새로 받게). '문서 판' 칸이 아직 없으면 그냥 넘어간다 */
function tbBumpDoc_(main, head) {
  var ver = (Number(main['문서 판']) || 0) + 1;
  tbSetCell_('함께표', main, head || tbHead_('함께표'), '문서 판', ver);
  return ver;
}

/** 잠금 안: 시트 줄과 첫 시트 줄(표 전체)을 읽는다 */
function tbLockPair_(id, hint) {
  var th = tbHead_('함께표'), t = tbReadRow_('함께표', id, hint.t, th);
  if (!t || tbSheetGone_(t)) throw userError_('이 시트가 지워졌어요. 표를 새로 불러올게요.', 'NOTFOUND');
  var main = tbIsMain_(t) ? t : tbReadRow_('함께표', t['문서ID'], hint.d, th);
  if (!main || main['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
  return { th: th, t: t, main: main };
}

/**
 * 잠금 밖: 시트와 줄의 행 번호, 시트의 줄 수·순서·합친 칸을 서버 기억으로 먼저 찾아 둔다.
 * given: 화면이 보낸 줄의 행 번호({줄ID: 행 번호}). 다 있으면 큰 '함께표줄' 탭을 읽지 않는다(잠금 안에서 그 줄이 맞는지 다시 본다)
 */
function tbHints_(id, rowIds, withRows, given) {
  var all = tbRows_('함께표'), t = tbById_(all, id), main = t ? tbMainOf_(all, t) : null;
  var out = {
    t: t ? t._row : 0, d: main ? main._row : 0, found: !!(t && main && !main['삭제 여부'] && !tbSheetGone_(t)),
    rows: {}, count: 0, maxOrder: 0, ids: {}, orders: [], merges: []
  };
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
      var o = Number(r['순서']) || 0;
      out.count++;
      out.maxOrder = Math.max(out.maxOrder, o);
      out.orders.push({ id: r['줄ID'], o: o, n: r._row, at: String(r['입력 시각'] || '') });
      var f = tbParse_(r['서식'], {});
      Object.keys(f).forEach(function (cid) {
        var m = f[cid] && f[cid].m;
        if (Array.isArray(m)) out.merges.push({ row: r['줄ID'], n: r._row, col: cid, bottom: String(m[0]), right: String(m[1]) });
      });
    }
  });
  out.orders.sort(function (a, b) { return a.o !== b.o ? a.o - b.o : (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1)); });
  return out;
}

/** 칸을 고칠 수 있는지(안 되면 오류) */
function tbCheckCell_(main, col, row, ctx) {
  var owner = tbOwner_(main, ctx);
  if (!owner && tbClosed_(main)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
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

/** 줄ID 하나 만들기(ids: 이미 쓴 ID, 만든 것도 넣는다) */
function tbNewRowId_(ids) {
  var id;
  do { id = 'L' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (ids[id]);
  ids[id] = true;
  return id;
}

/**
 * 붙여 넣은 줄 하나(칸·채우기 색·서식·높이) 다듬기. 서식의 합친 칸은 place로 진짜 줄ID로 바꾼다.
 * ms: 붙여 넣은 합친 칸 {열ID: [아래로 줄 수, 오른쪽으로 열 수]}(새로 넣는 줄끼리), ids: 새 줄들의 ID(차례대로), k: 이 줄의 차례
 */
function tbBuildRow_(cols, a, ids, k, place, stampOf) {
  var src = (a && a.cells) || {}, paint = (a && a.colors) || {}, fin = (a && a.fmt) || {}, ms = (a && a.ms) || {};
  var cells = {}, colors = {}, fmt = {}, stamps = {}, filled = 0;
  cols.forEach(function (c, j) {
    var v = tbCleanValue_(c, src[c.id]);
    if (v) {
      cells[c.id] = v;
      filled++;
      if (stampOf) stamps[c.id] = stampOf();
    }
    var bg = tbCleanColor_(paint[c.id]);
    if (bg && bg !== '#FFFFFF') colors[c.id] = bg;
    var f = tbCleanFmt_(fin[c.id]);
    if (f && f.m) { f.m = place ? place(f.m) : null; if (!f.m) delete f.m; }
    var span = ms[c.id];
    if (Array.isArray(span) && ids) {
      var rs = Math.max(1, Math.floor(Number(span[0]) || 1)), cs = Math.max(1, Math.floor(Number(span[1]) || 1));
      if (rs > 1 || cs > 1) {
        f = f || {};
        f.m = [ids[Math.min(k + rs - 1, ids.length - 1)], cols[Math.min(j + cs - 1, cols.length - 1)].id];
      }
    }
    if (f && Object.keys(f).length) fmt[c.id] = f;
  });
  var json = JSON.stringify(cells);
  if (json.length > TB_MAX_ROW_JSON_) throw userError_('한 줄에 글이 너무 많아요. 칸의 글을 조금 줄여 주세요.');
  var fj = Object.keys(fmt).length ? JSON.stringify(fmt) : '';
  if (fj.length > TB_MAX_FMT_JSON_) throw userError_('한 줄에 서식이 너무 많아요. 서식을 조금 지워 주세요.');
  return {
    cells: cells, filled: filled, stamps: stamps, json: json, fmt: fj,
    colors: Object.keys(colors).length ? JSON.stringify(colors) : '', h: tbCleanHeight_(a && a.h)
  };
}

/**
 * 잠금 안: 줄들을 시트 끝에 더한다(화면에서는 순서대로: 보통 표 끝, order를 주면 그 순서 자리).
 * 잠근 열도 채울 수 있다(내가 더한 줄). ids: 미리 정한 새 줄ID, place: 서식의 '+k'(새 줄)를 진짜 ID로
 * 돌려주는 값: { rows: [줄 모양], cells: 채운 칸 수 }
 */
function tbAppendRows_(t, cols, adds, actor, hint, bump, names, order, main, ids, place) {
  if (hint.count + adds.length > TB_MAX_ROWS_) throw userError_('줄은 ' + TB_MAX_ROWS_ + '개까지예요. 더 넣으려면 시트를 나눠 주세요.');
  var head = tbHead_('함께표줄'), sh = sheet_('함께표줄');
  var ver = bump(), now = nowText_(), min = tbNowMin_(), filled = 0, start = sh.getLastRow() + 1;
  ids = ids || adds.map(function () { return tbNewRowId_(hint.ids); });
  var recs = adds.map(function (a, i) {
    var b = tbBuildRow_(cols, a, ids, i, place, function () { return [ver, actor.name || '', min]; });
    filled += b.filled;
    return {
      '줄ID': ids[i], '표ID': t['표ID'], '순서': String(order !== undefined && adds.length === 1 ? order : hint.maxOrder + i + 1), '칸': b.json,
      '색': b.colors, '서식': b.fmt, '높이': b.h ? String(b.h) : '',
      '칸 고친 때': JSON.stringify(b.stamps), '판': String(ver), '입력자ID': actor.id || '', '입력 시각': now, '수정자ID': '', '수정 시각': '', '삭제 여부': '',
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
  return { rows: recs.map(function (rec) { return tbRowView_(rec, names, (main || t)['입력자ID']); }), cells: filled };
}

/** 잠금 안: 새 시트의 줄을 한 번에 넣는다(만들기·시트 더하기·사본). rows = [{ cells, colors, fmt, h, ms }] */
function tbInsertSheetRows_(sheetId, cols, rows, actor, summary) {
  if (!rows.length) return 0;
  var used = {};
  tbRows_('함께표줄').forEach(function (r) { used[r['줄ID']] = true; });
  var ids = rows.map(function () { return tbNewRowId_(used); });
  var recs = rows.map(function (a, i) {
    var b = tbBuildRow_(cols, a, ids, i, function (m) { return /^L/.test(m[0]) ? m : null; }, null);
    return { '줄ID': ids[i], '표ID': sheetId, '순서': String(i + 1), '칸': b.json, '색': b.colors, '서식': b.fmt, '높이': b.h ? String(b.h) : '', '칸 고친 때': '', '판': '1' };
  });
  insertRows_('함께표줄', recs, actor, summary, false, true);
  return recs.length;
}

// ---------------------------------------------------------------- 쓰기: 표

/**
 * 새 표: args.fields(이름·부서·설명·마감·첫 시트 이름 sheet), args.cols(열),
 * args.rows([{ cells: {열ID: 값}, colors: {열ID: '#RRGGBB'}, fmt: {열ID: 서식}, ms: {열ID: [줄 수, 열 수]}(합친 칸) }]), args.view
 */
function apiTableCreate_(args, actor, ctx) {
  var f = args.fields || {};
  var meta = tbCleanMeta_(f);
  var sheetName = cleanText_(f.sheet, 40, '시트 이름').replace(/\s+/g, ' ');
  var cols = tbCleanCols_(args.cols, []);
  var rows = Array.isArray(args.rows) ? args.rows : [];
  if (rows.length > TB_MAX_ROWS_) throw userError_('줄은 ' + TB_MAX_ROWS_ + '개까지 넣을 수 있어요. 나눠서 만들어 주세요.');
  rows.forEach(function (r) { tbBuildRow_(cols, r, null, 0, null, null); }); // 잠그기 전에 글자 수를 먼저 본다
  var view = tbCleanView_(args.view);
  tbEnsureCols_();
  return withLock_(function () {
    var rec = { '상태': '', '열': JSON.stringify(cols), '판': '1', '시트 이름': sheetName, '시트 순서': '1', '보기': tbViewJson_(view), '문서 판': '1' };
    Object.keys(meta).forEach(function (k) { rec[k] = meta[k]; });
    var t = insertRow_('함께표', rec, actor, '함께 쓰는 표 만듦: ' + meta['제목']);
    tbInsertSheetRows_(t['표ID'], cols, rows, actor, '함께 쓰는 표 "' + meta['제목'] + '" 줄 ' + rows.length + '개 넣음');
    return { id: t['표ID'] };
  });
}

/** 표 이름·부서·마감 고치기: 만든 분·관리(시트 설명은 시트 메뉴에서) */
function apiTableSave_(args, actor, ctx) {
  var all = tbRows_('함께표'), t0 = tbById_(all, String(args.id || '')), m0 = t0 ? tbMainOf_(all, t0) : null;
  if (!m0 || m0['삭제 여부']) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(m0, ctx)) throw userError_('만든 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
  var meta = tbCleanMeta_(args.fields || {}), rec = { '제목': meta['제목'], '부서ID': meta['부서ID'], '마감': meta['마감'] };
  tbEnsureCols_();
  return withLock_(function () {
    var main = findRow_('함께표', m0['표ID']);
    if (!main || main['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    rec['문서 판'] = String((Number(main['문서 판']) || 0) + 1);
    updateRow_('함께표', main['표ID'], rec, actor, '함께 쓰는 표 고침: ' + rec['제목']);
    return { dver: Number(rec['문서 판']) };
  });
}

/** 지금 마감 / 다시 열기: 만든 분·관리 */
function apiTableSetOpen_(args, actor, ctx) {
  var all = tbRows_('함께표'), t0 = tbById_(all, String(args.id || '')), m0 = t0 ? tbMainOf_(all, t0) : null;
  if (!m0 || m0['삭제 여부']) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(m0, ctx)) throw userError_('만든 분과 연구부장·부담당만 바꿀 수 있어요.', 'FORBIDDEN');
  tbEnsureCols_();
  return withLock_(function () {
    var main = findRow_('함께표', m0['표ID']);
    if (!main || main['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
    if (args.open && main['마감'] && main['마감'] < tbToday_()) throw userError_('마감 날짜가 지났어요. "표 고치기"에서 마감을 늦추거나 지운 뒤 다시 열어 주세요.');
    var dver = (Number(main['문서 판']) || 0) + 1;
    updateRow_('함께표', main['표ID'], { '상태': args.open ? '' : '마감', '문서 판': String(dver) }, actor, '함께 쓰는 표 ' + (args.open ? '다시 엶: ' : '마감함: ') + main['제목']);
    return { dver: dver };
  });
}

/** 표 지우기(시트 모두 숨김, 관리자 › 휴지통에서 되살림): 만든 분·관리 */
function apiTableDelete_(args, actor, ctx) {
  var all = tbRows_('함께표'), t0 = tbById_(all, String(args.id || '')), m0 = t0 ? tbMainOf_(all, t0) : null;
  if (!m0 || m0['삭제 여부']) throw userError_('이 표를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(m0, ctx)) throw userError_('만든 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  return withLock_(function () {
    var main = findRow_('함께표', m0['표ID']);
    if (!main || main['삭제 여부']) return { done: true };
    var patch = { '삭제 여부': '삭제' };
    if (headOf_('함께표').indexOf('문서 판') >= 0) patch['문서 판'] = String((Number(main['문서 판']) || 0) + 1);
    updateRow_('함께표', main['표ID'], patch, actor, '함께 쓰는 표 지움: ' + main['제목'], '삭제');
    return { done: true };
  });
}

// ---------------------------------------------------------------- 쓰기: 시트(만든 분·관리)

/** 잠금 안: 표와 그 시트들을 시트에서 새로 읽는다(시트 일은 드물어 작은 '함께표' 탭을 통째로 읽어도 된다) */
function tbDocFresh_(id, ctx, need) {
  var all = tbRows_('함께표'), t = tbById_(all, id), main = t ? tbMainOf_(all, t) : null;
  if (!main || main['삭제 여부']) throw userError_('이 표가 지워졌어요.', 'NOTFOUND');
  if (need === 'sheet' && (!t || tbSheetGone_(t))) throw userError_('이 시트가 지워졌어요. 표를 새로 불러올게요.', 'NOTFOUND');
  if (!tbOwner_(main, ctx)) throw userError_('시트는 만든 분과 연구부장·부담당만 더하고 고칠 수 있어요.', 'FORBIDDEN');
  return { all: all, t: t, main: main, sheets: tbSheetsOf_(all, main['표ID']) };
}
/** 잠금 안: 시트 순서를 list 차례(1, 2, 3…)로 다시 매긴다(바뀐 줄만 쓴다) */
function tbRenumber_(list, head) {
  list.forEach(function (s, i) { if (tbSheetOrder_(s) !== i + 1) tbSetCell_('함께표', s, head, '시트 순서', i + 1); });
}

/** 시트 더하기. args = { id: 표, name, desc, cols, rows(만들기와 같은 모양), view } */
function apiTableSheetAdd_(args, actor, ctx) {
  var cols = tbCleanCols_(args.cols, []);
  var rows = Array.isArray(args.rows) ? args.rows : [];
  if (rows.length > TB_MAX_ROWS_) throw userError_('줄은 ' + TB_MAX_ROWS_ + '개까지 넣을 수 있어요. 나눠서 만들어 주세요.');
  rows.forEach(function (r) { tbBuildRow_(cols, r, null, 0, null, null); });
  var desc = cleanText_(args.desc, 500, '설명'), view = tbCleanView_(args.view);
  tbEnsureCols_();
  return withLock_(function () {
    var D = tbDocFresh_(String(args.id || ''), ctx, 'doc');
    if (D.sheets.length >= TB_MAX_SHEETS_) throw userError_('시트는 한 표에 ' + TB_MAX_SHEETS_ + '개까지 만들 수 있어요. 새 표를 만들어 주세요.');
    var name = tbCleanSheetName_(args.name, D.sheets, '');
    var order = D.sheets.reduce(function (m, s) { return Math.max(m, tbSheetOrder_(s)); }, 0) + 1;
    var t = insertRow_('함께표', { '문서ID': D.main['표ID'], '시트 이름': name, '시트 순서': String(order), '설명': desc, '열': JSON.stringify(cols), '판': '1', '보기': tbViewJson_(view), '상태': '' },
      actor, tbLabel_(D.main) + ' 시트 더함: ' + name);
    tbInsertSheetRows_(t['표ID'], cols, rows, actor, tbLabel_(D.main) + ' › ' + name + ' 줄 ' + rows.length + '개 넣음');
    var head = tbHead_('함께표'), dver = tbBumpDoc_(D.main, head);
    return { id: t['표ID'], dver: dver };
  });
}

/** 시트 이름·설명 고치기. args = { id: 시트, name, desc } */
function apiTableSheetSave_(args, actor, ctx) {
  var desc = cleanText_(args.desc, 500, '설명');
  tbEnsureCols_();
  return withLock_(function () {
    var D = tbDocFresh_(String(args.id || ''), ctx, 'sheet'), t = D.t;
    var name = tbCleanSheetName_(args.name, D.sheets, t['표ID']);
    var nameKey = tbIsMain_(t) && name === '시트1' && !t['시트 이름'] ? '' : name; // 예전 표의 '시트1'은 그대로 비워 둔다
    updateRow_('함께표', t['표ID'], { '시트 이름': nameKey, '설명': desc, '판': String((Number(t['판']) || 0) + 1) }, actor, tbLabel_(D.main, t) + ' 시트 고침');
    var dver = tbBumpDoc_(D.main, tbHead_('함께표'));
    return { dver: dver };
  });
}

/** 시트 옮기기(왼쪽·오른쪽). args = { id: 시트, dir: -1|1 } */
function apiTableSheetMove_(args, actor, ctx) {
  tbEnsureCols_();
  return withLock_(function () {
    var D = tbDocFresh_(String(args.id || ''), ctx, 'sheet'), list = D.sheets.slice();
    var k = list.indexOf(D.t), j = k + (Number(args.dir) < 0 ? -1 : 1);
    if (k < 0 || j < 0 || j >= list.length) return { dver: Number(D.main['문서 판']) || 0 };
    list.splice(j, 0, list.splice(k, 1)[0]);
    var head = tbHead_('함께표');
    tbRenumber_(list, head);
    writeLog_(actor, '함께표', D.t['표ID'], '수정', tbLabel_(D.main, D.t) + ' 시트 옮김', null, { '시트 순서': list.map(tbSheetName_).join(', ').slice(0, 1000) });
    return { dver: tbBumpDoc_(D.main, head) };
  });
}

/** 시트 사본 만들기(열·서식·줄 모두, 바로 오른쪽에). args = { id: 시트 } */
function apiTableSheetCopy_(args, actor, ctx) {
  tbEnsureCols_();
  return withLock_(function () {
    var D = tbDocFresh_(String(args.id || ''), ctx, 'sheet'), src = D.t;
    if (D.sheets.length >= TB_MAX_SHEETS_) throw userError_('시트는 한 표에 ' + TB_MAX_SHEETS_ + '개까지 만들 수 있어요.');
    var cols = tbCols_(src), name = tbFreeSheetName_(tbSheetName_(src) + ' 사본', D.sheets);
    var t = insertRow_('함께표', { '문서ID': D.main['표ID'], '시트 이름': name, '시트 순서': String(tbSheetOrder_(src)), '설명': src['설명'] || '',
      '열': JSON.stringify(cols), '판': '1', '보기': src['보기'] || '', '상태': '' }, actor, tbLabel_(D.main, src) + ' 사본 만듦: ' + name);
    var rows = tbSortRows_(tbRows_('함께표줄').filter(function (r) { return r['표ID'] === src['표ID'] && !r['삭제 여부']; }));
    // 합친 칸이 가리키는 줄ID를 사본의 줄ID로 바꾼다: 옛 줄의 차례 → ms(아래로 줄 수, 오른쪽으로 열 수)
    var at = {}, ci = {};
    rows.forEach(function (r, i) { at[r['줄ID']] = i; });
    cols.forEach(function (c, j) { ci[c.id] = j; });
    var list = rows.map(function (r, i) {
      var fmt = tbParse_(r['서식'], {}), ms = {};
      Object.keys(fmt).forEach(function (cid) {
        var m = fmt[cid] && fmt[cid].m;
        if (!Array.isArray(m)) return;
        delete fmt[cid].m;
        if (at[m[0]] !== undefined && ci[cid] !== undefined) ms[cid] = [Math.max(1, at[m[0]] - i + 1), Math.max(1, (ci[m[1]] !== undefined ? ci[m[1]] : ci[cid]) - ci[cid] + 1)];
      });
      return { cells: tbParse_(r['칸'], {}), colors: tbParse_(r['색'], {}), fmt: fmt, ms: ms, h: r['높이'] };
    });
    tbInsertSheetRows_(t['표ID'], cols, list, actor, tbLabel_(D.main) + ' › ' + name + ' 줄 ' + list.length + '개 넣음');
    var all = tbRows_('함께표'), sheets = tbSheetsOf_(all, D.main['표ID']), mine = tbById_(all, t['표ID']);
    var order = sheets.filter(function (s) { return s !== mine; }), k = -1;
    order.forEach(function (s, i) { if (s['표ID'] === src['표ID']) k = i; });
    order.splice(k + 1, 0, mine);
    var head = tbHead_('함께표');
    tbRenumber_(order, head);
    return { id: t['표ID'], dver: tbBumpDoc_(tbById_(all, D.main['표ID']), head) };
  });
}

/** 시트 지우기(숨김, 휴지통에서 되살림). 시트가 하나뿐이면 지울 수 없다(표 지우기로). args = { id: 시트 } */
function apiTableSheetDelete_(args, actor, ctx) {
  tbEnsureCols_();
  return withLock_(function () {
    var D = tbDocFresh_(String(args.id || ''), ctx, 'sheet'), t = D.t;
    if (D.sheets.length <= 1) throw userError_('시트가 하나뿐이라 지울 수 없어요. 표 전체를 지우려면 "표 고치기 › 표 지우기"를 눌러 주세요.');
    updateRow_('함께표', t['표ID'], tbIsMain_(t) ? { '시트 지움': '지움' } : { '삭제 여부': '삭제' }, actor, tbLabel_(D.main, t) + ' 시트 지움', '삭제');
    var main = findRow_('함께표', D.main['표ID']);
    return { dver: tbBumpDoc_(main, tbHead_('함께표')) };
  });
}

// ---------------------------------------------------------------- 쓰기: 칸·줄

/** 칸 하나 고치기. args = { id: 시트, row, col, value, base(화면이 알던 그 칸의 판) } → 그사이 다른 분이 고쳤으면 { conflict } */
function apiTableCell_(args, actor, ctx) {
  var id = String(args.id || ''), rowId = String(args.row || ''), colId = String(args.col || '');
  var given = {};
  given[rowId] = args.n;
  var hint = tbHints_(id, [rowId], false, given);
  if (!hint.found) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  return withLock_(function () {
    var L = tbLockPair_(id, hint), t = L.t, main = L.main;
    var cols = tbCols_(t), col = cols.filter(function (c) { return c.id === colId; })[0];
    if (!col) throw userError_('그사이 열이 바뀌었어요. 표를 새로 불러올게요.', 'STALE');
    var rh = tbHead_('함께표줄'), r = tbReadRow_('함께표줄', rowId, hint.rows[rowId], rh);
    if (!r || r['삭제 여부'] || r['표ID'] !== id) throw userError_('그사이 이 줄이 지워졌어요. 표를 새로 불러올게요.', 'STALE');
    tbCheckCell_(main, col, r, ctx);
    var value = tbCleanValue_(col, args.value);
    var cells = tbParse_(r['칸'], {}), stamps = tbParse_(r['칸 고친 때'], {});
    var cur = cells[colId] === undefined || cells[colId] === null ? '' : String(cells[colId]);
    var st = Array.isArray(stamps[colId]) ? stamps[colId] : [0, '', ''];
    if (cur === value) return { ver: Number(t['판']) || 0, row: tbRowView_(r, names, main['입력자ID']) };
    if (args.base !== undefined && args.base !== null && Number(args.base) !== (Number(st[0]) || 0)) {
      return { conflict: { value: cur, by: st[1] || '', at: st[2] || '', base: Number(st[0]) || 0 }, ver: Number(t['판']) || 0, row: tbRowView_(r, names, main['입력자ID']) };
    }
    var ver = tbBump_(t, L.th);
    cells[colId] = value;
    stamps[colId] = [ver, actor.name || '', tbNowMin_()];
    tbPutRow_(r, cells, stamps, ver, actor);
    tbWriteRow_('함께표줄', r, rh);
    var before = {}, after = {};
    before[col.name] = cur;
    after[col.name] = value;
    writeLog_(actor, '함께표줄', rowId, '수정', tbLabel_(main, t) + ' · ' + tbRowLabel_(cols, cells) + ' · ' + col.name + ' 고침', before, after);
    return { ver: ver, row: tbRowView_(r, names, main['입력자ID']) };
  });
}

/**
 * 여러 칸 한 번에(붙여 넣기·서식 도구·줄 고치기 창).
 * args.cells = [{ row, n, col, value?(바꿀 값), base?, f?(서식 바꿀 것, 값이 null이면 그 서식을 뺀다), fill?('#RRGGBB'·''), clear?(서식 지우기) }]
 * args.add = [{ cells, colors, fmt, h, ms }](끝에 줄 더하기). 서식의 합친 칸 [줄ID, 열ID]의 줄ID는 '+0', '+1'…로 새 줄을 가리킬 수 있다
 * 잠근 열은 고칠 수 있는 분만 바뀌고, 그사이 다른 분이 고친 값은 건너뛰고 알려 준다(먼저 고친 값·분·시각·판, 내가 쓰려던 값). 기록은 한 줄로
 */
function apiTableCells_(args, actor, ctx) {
  var id = String(args.id || '');
  var list = Array.isArray(args.cells) ? args.cells : [], adds = Array.isArray(args.add) ? args.add : [];
  if (list.length + adds.length * TB_MAX_COLS_ > TB_MAX_CELLS_) throw userError_('한 번에 ' + TB_MAX_CELLS_ + '칸까지 붙여 넣을 수 있어요. 나눠서 붙여 넣어 주세요.');
  var hasFmt = list.some(function (x) { return x && (x.f || x.clear || x.fill !== undefined); }) || adds.some(function (a) { return a && (a.fmt || a.h || a.ms); });
  if (hasFmt) tbEnsureCols_();
  var rowIds = [], given = {};
  list.forEach(function (x) {
    var r = String((x && x.row) || '');
    if (r && rowIds.indexOf(r) < 0) { rowIds.push(r); given[r] = x.n; }
  });
  var hint = tbHints_(id, rowIds, adds.length > 0, given);
  if (!hint.found) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  return withLock_(function () {
    var L = tbLockPair_(id, hint), t = L.t, main = L.main;
    var owner = tbOwner_(main, ctx);
    if (!owner && tbClosed_(main)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
    var cols = tbCols_(t), colOf = {};
    cols.forEach(function (c) { colOf[c.id] = c; });
    var rh = tbHead_('함께표줄');
    var newIds = adds.map(function () { return tbNewRowId_(hint.ids); });
    var place = function (m) { // '+k'(k번째 새 줄) → 그 줄의 ID
      var s = String(m[0]);
      if (/^\+\d+$/.test(s)) s = newIds.length ? newIds[Math.min(Number(s.slice(1)), newIds.length - 1)] : '';
      return s ? [s, String(m[1])] : null;
    };
    var byRow = {}, order = [];
    list.forEach(function (x) {
      if (!x || !colOf[String(x.col)]) return;
      var r = String(x.row || '');
      if (!byRow[r]) { byRow[r] = []; order.push(r); }
      byRow[r].push(x);
    });
    var ver = 0, changed = 0, formatted = 0, skipLocked = 0, conflicts = [], before = {}, after = {}, out = [];
    var bump = function () { if (!ver) ver = tbBump_(t, L.th); return ver; };
    order.forEach(function (rowId) {
      var r = tbReadRow_('함께표줄', rowId, hint.rows[rowId], rh);
      if (!r || r['삭제 여부'] || r['표ID'] !== id) return;
      var mineRow = !!(ctx.identity && r['입력자ID'] === ctx.identity['교직원ID']);
      var cells = tbParse_(r['칸'], {}), stamps = tbParse_(r['칸 고친 때'], {}), fmt = tbParse_(r['서식'], {}), colors = tbParse_(r['색'], {});
      var touched = false, styled = false, clash = false;
      byRow[rowId].forEach(function (x) {
        var col = colOf[String(x.col)];
        if (col.lock && !owner && !mineRow) { skipLocked++; return; }
        if (x.value !== undefined && x.value !== null) {
          var value = tbCleanValue_(col, x.value);
          var cur = cells[col.id] === undefined || cells[col.id] === null ? '' : String(cells[col.id]);
          var st = Array.isArray(stamps[col.id]) ? stamps[col.id] : [0, '', ''];
          if (cur !== value) {
            if (x.base !== undefined && x.base !== null && Number(x.base) !== (Number(st[0]) || 0)) {
              conflicts.push({ row: rowId, col: col.id, mine: value, value: cur, by: st[1] || '', at: st[2] || '', base: Number(st[0]) || 0 });
              clash = true;
            } else {
              var v = bump();
              cells[col.id] = value;
              stamps[col.id] = [v, actor.name || '', tbNowMin_()];
              var label = tbRowLabel_(cols, cells) + ' · ' + col.name;
              before[label] = cur;
              after[label] = value;
              changed++;
              touched = true;
            }
          }
        }
        if (x.f || x.clear || x.fill !== undefined) {
          var patch = null;
          if (x.f && typeof x.f === 'object') {
            patch = {};
            Object.keys(x.f).forEach(function (k) { if (TB_FMT_KEYS_.indexOf(k) >= 0) patch[k] = x.f[k]; });
            if (patch.m) {
              patch.m = Array.isArray(patch.m) ? place(patch.m) : null;
              if (patch.m && !owner && tbSpanLocked_(cols, col.id, patch.m[1])) { delete patch.m; skipLocked++; } // 잠근 열을 덮는 합치기
            }
          }
          var nf = tbPatchFmt_(fmt[col.id], patch, !!x.clear);
          var nc = x.fill !== undefined ? tbCleanColor_(x.fill) : x.clear ? '' : (colors[col.id] || ''); // 채우기 색을 함께 보내면 그 색(되돌리기·붙여 넣기)
          if (nc === '#FFFFFF') nc = '';
          if (JSON.stringify(nf || null) === JSON.stringify(fmt[col.id] || null) && nc === (colors[col.id] || '')) return;
          if (nf) fmt[col.id] = nf; else delete fmt[col.id];
          if (nc) colors[col.id] = nc; else delete colors[col.id];
          formatted++;
          styled = true;
        }
      });
      if (!touched && !styled) { if (clash) out.push(tbRowView_(r, names, main['입력자ID'])); return; } // 묻는 창에 쓸 지금 값
      var v2 = bump();
      if (touched) tbPutRow_(r, cells, stamps, v2, actor); else r['판'] = String(v2); // 서식만 바꾸면 '마지막 고친 분'은 그대로
      if (styled) tbPutFmt_(r, fmt, colors);
      tbWriteRow_('함께표줄', r, rh);
      out.push(tbRowView_(r, names, main['입력자ID']));
    });
    if (adds.length) {
      var added = tbAppendRows_(t, cols, adds, actor, hint, bump, names, undefined, main, newIds, place);
      out = out.concat(added.rows);
      changed += added.cells;
    }
    if (changed || formatted || adds.length) {
      writeLog_(actor, '함께표줄', '', adds.length && !list.length ? '추가' : '수정',
        tbLabel_(main, t) + ' 여러 칸: ' + [changed ? changed + '칸' : '', formatted ? '서식 ' + formatted + '칸' : '', adds.length ? '줄 ' + adds.length + '개 더함' : ''].filter(Boolean).join(', '),
        changed ? before : null, changed ? after : (formatted ? { '서식 바꾼 칸': String(formatted) } : null));
    }
    return { ver: Number(t['판']) || 0, changed: changed, formatted: formatted, skipLocked: skipLocked, conflicts: conflicts, rows: out };
  });
}

/**
 * 줄 더하기(누구나, 교사 결정). 표 끝에, 또는 args.after(줄ID) 바로 아래에 더한다.
 * args.cells·colors·fmt: 처음 값·채우기 색·서식(위 줄에서 이어 받기, 합친 칸은 빼고). 합친 칸의 맨 아래 줄 아래에 더하면 그 합친 칸에 들어간다
 */
function apiTableRowAdd_(args, actor, ctx) {
  var id = String(args.id || '');
  if (args.fmt || args.h) tbEnsureCols_();
  var hint = tbHints_(id, [], true);
  if (!hint.found) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_(), afterId = String(args.after || '');
  // 아래에 더하기: 그 줄과 다음 줄 순서의 가운데(순서는 숫자라 1.5처럼 사이에 넣을 수 있다)
  var order;
  var below = hint.orders.filter(function (x) { return x.id === afterId; })[0];
  if (below) {
    var next = null;
    hint.orders.forEach(function (x) { if (x.o > below.o && (next === null || x.o < next)) next = x.o; });
    order = next === null ? below.o + 1 : Math.round((below.o + next) / 2 * 1e6) / 1e6;
    if (next !== null && !(order > below.o && order < next)) order = undefined; // 사이가 너무 좁으면 끝에
  }
  var grow = below && order !== undefined ? hint.merges.filter(function (m) { return m.bottom === afterId; }) : [];
  return withLock_(function () {
    var L = tbLockPair_(id, hint), t = L.t, main = L.main;
    if (!tbOwner_(main, ctx) && tbClosed_(main)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
    var cols = tbCols_(t), fmt = {};
    Object.keys(args.fmt || {}).forEach(function (cid) {
      var f = tbCleanFmt_(args.fmt[cid]);
      if (f) delete f.m;
      if (f && Object.keys(f).length) fmt[cid] = f;
    });
    var res = tbAppendRows_(t, cols, [{ cells: args.cells || {}, colors: args.colors || {}, fmt: fmt, h: args.h }], actor, hint,
      function () { return tbBump_(t, L.th); }, names, order, main);
    var nr = res.rows[0], extra = [];
    if (grow.length) { // 합친 칸 바로 아래에 더한 줄은 그 합친 칸에 넣는다(구글 시트에서 합친 칸 안에 줄을 넣은 것처럼)
      var rh = tbHead_('함께표줄'), seen = {};
      grow.forEach(function (m) {
        if (seen[m.row]) return;
        seen[m.row] = 1;
        var a = tbReadRow_('함께표줄', m.row, m.n, rh);
        if (!a || a['삭제 여부'] || a['표ID'] !== id) return;
        var f = tbParse_(a['서식'], {}), hit = false;
        Object.keys(f).forEach(function (cid) {
          if (f[cid] && Array.isArray(f[cid].m) && f[cid].m[0] === afterId) { f[cid].m = [nr.id, f[cid].m[1]]; hit = true; }
        });
        if (!hit) return;
        a['서식'] = JSON.stringify(f);
        a['판'] = String(Number(t['판']) || 0);
        tbWriteRow_('함께표줄', a, rh);
        extra.push(tbRowView_(a, names, main['입력자ID']));
      });
    }
    var after = {};
    cols.forEach(function (c) { if (nr.cells[c.id]) after[c.name] = nr.cells[c.id]; });
    writeLog_(actor, '함께표줄', nr.id, '추가', tbLabel_(main, t) + ' 줄 더함', null, after);
    return { ver: Number(t['판']) || 0, row: nr, rows: extra };
  });
}

/** 줄 빼기: 만든 분·관리·그 줄을 더한 분. 합친 칸의 첫 줄이면 합친 칸(값·서식)을 다음 줄로, 맨 아래 줄이면 끝을 위 줄로 옮긴다 */
function apiTableRowDelete_(args, actor, ctx) {
  var id = String(args.id || ''), rowId = String(args.row || ''), given = {};
  given[rowId] = args.n;
  var hint = tbHints_(id, [rowId], true, given);
  if (!hint.found) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  return withLock_(function () {
    var L = tbLockPair_(id, hint), t = L.t, main = L.main;
    var rh = tbHead_('함께표줄'), r = tbReadRow_('함께표줄', rowId, hint.rows[rowId], rh);
    if (!r || r['표ID'] !== id) throw userError_('이 줄을 찾지 못했어요. 표를 새로 불러올게요.', 'STALE');
    if (r['삭제 여부']) return { ver: Number(t['판']) || 0, row: tbRowView_(r, names, main['입력자ID']), rows: [] };
    var owner = tbOwner_(main, ctx), mineRow = !!(ctx.identity && r['입력자ID'] === ctx.identity['교직원ID']);
    if (!owner && !mineRow) throw userError_('줄은 만든 분과 연구부장·부담당, 그 줄을 더한 분만 뺄 수 있어요.', 'FORBIDDEN');
    if (!owner && tbClosed_(main)) throw userError_('마감한 표예요. 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'CLOSED');
    var ver = tbBump_(t, L.th), cols = tbCols_(t), cells = tbParse_(r['칸'], {}), fmt = tbParse_(r['서식'], {});
    r['삭제 여부'] = '삭제';
    r['판'] = String(ver);
    r['수정자ID'] = actor.id || '';
    r['수정 시각'] = nowText_();
    tbWriteRow_('함께표줄', r, rh);
    // 합친 칸 지키기
    var k = -1;
    hint.orders.forEach(function (x, i) { if (x.id === rowId) k = i; });
    var pos = {};
    hint.orders.forEach(function (x, i) { pos[x.id] = i; });
    var touched = {}, getRow = function (o) {
      if (!touched[o.id]) {
        var x = tbReadRow_('함께표줄', o.id, o.n, rh);
        touched[o.id] = x && !x['삭제 여부'] && x['표ID'] === id ? { r: x, cells: tbParse_(x['칸'], {}), fmt: tbParse_(x['서식'], {}) } : null;
      }
      return touched[o.id];
    };
    if (k >= 0) {
      var next = hint.orders[k + 1], prev = hint.orders[k - 1];
      Object.keys(fmt).forEach(function (cid) { // (1) 이 줄이 합친 칸의 첫 줄 → 다음 줄로(값·서식 그대로)
        var m = fmt[cid] && fmt[cid].m;
        if (!Array.isArray(m) || m[0] === rowId || pos[m[0]] === undefined || pos[m[0]] <= k || !next) return;
        var x = getRow(next);
        if (!x) return;
        var f = JSON.parse(JSON.stringify(fmt[cid]));
        if (m[0] === next.id && m[1] === cid) delete f.m; // 남은 것이 한 칸뿐
        if (Object.keys(f).length) x.fmt[cid] = f; else delete x.fmt[cid];
        if (cells[cid]) x.cells[cid] = cells[cid]; else delete x.cells[cid];
      });
      hint.merges.forEach(function (m) { // (2) 이 줄이 합친 칸의 맨 아래 줄 → 끝을 바로 위 줄로
        if (m.bottom !== rowId || m.row === rowId || !prev) return;
        var a = getRow({ id: m.row, n: m.n });
        var f = a && a.fmt[m.col];
        if (!f || !Array.isArray(f.m) || f.m[0] !== rowId) return;
        if (prev.id === m.row && f.m[1] === m.col) delete f.m; else f.m = [prev.id, f.m[1]];
        if (!Object.keys(f).length) delete a.fmt[m.col];
      });
    }
    var extra = [];
    Object.keys(touched).forEach(function (rid) {
      var x = touched[rid];
      if (!x) return;
      x.r['칸'] = JSON.stringify(x.cells);
      x.r['서식'] = Object.keys(x.fmt).length ? JSON.stringify(x.fmt) : '';
      x.r['판'] = String(ver);
      tbWriteRow_('함께표줄', x.r, rh);
      extra.push(tbRowView_(x.r, names, main['입력자ID']));
    });
    var before = {};
    cols.forEach(function (c) { if (cells[c.id]) before[c.name] = cells[c.id]; });
    writeLog_(actor, '함께표줄', rowId, '삭제', tbLabel_(main, t) + ' 줄 뺌: ' + tbRowLabel_(cols, cells), before, null);
    return { ver: ver, row: tbRowView_(r, names, main['입력자ID']), rows: extra };
  });
}

/** 열 고치기(이름·종류·고를 값·잠금·위아래 합치기·너비·순서·더하기·빼기): 만든 분·관리. args.id: 시트 */
function apiTableCols_(args, actor, ctx) {
  var all = tbRows_('함께표'), t0 = tbById_(all, String(args.id || '')), m0 = t0 ? tbMainOf_(all, t0) : null;
  if (!t0 || !m0 || m0['삭제 여부'] || tbSheetGone_(t0)) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  if (!tbOwner_(m0, ctx)) throw userError_('열은 만든 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
  return withLock_(function () {
    var t = findRow_('함께표', t0['표ID']);
    if (!t || tbSheetGone_(t)) throw userError_('이 시트가 지워졌어요.', 'NOTFOUND');
    var allCols = tbAllCols_(t), next = tbCleanCols_(args.cols, allCols);
    var keep = {};
    next.forEach(function (c) { keep[c.id] = true; });
    // 뺀 열은 del로 남겨 둔다(ID를 다시 쓰지 않고, 시트의 값도 그대로)
    var gone = allCols.filter(function (c) { return !keep[c.id]; }).map(function (c) {
      return { id: c.id, name: c.name, type: c.type, options: c.options || [], lock: !!c.lock, merge: !!c.merge, w: c.w || 0, del: true };
    });
    var json = JSON.stringify(next.concat(gone));
    if (json.length > 40000) throw userError_('열 설정이 너무 길어요. 고를 값이나 열 이름을 줄여 주세요.');
    var ver = (Number(t['판']) || 0) + 1;
    updateRow_('함께표', t['표ID'], { '열': json, '판': String(ver) }, actor, tbLabel_(m0, t) + ' 열 고침');
    return { ver: ver };
  });
}

/** 열 너비(누구나, 고칠 수 있는 분). args = { id: 시트, w: {열ID: px(0이면 기본)} } */
function apiTableColw_(args, actor, ctx) {
  var id = String(args.id || ''), w = args.w && typeof args.w === 'object' ? args.w : {};
  var hint = tbHints_(id, [], false);
  if (!hint.found) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  return withLock_(function () {
    var L = tbLockPair_(id, hint), t = L.t, main = L.main;
    tbCheckWrite_(main, ctx);
    var allCols = tbAllCols_(t), said = [];
    allCols.forEach(function (c) {
      if (c.del || !Object.prototype.hasOwnProperty.call(w, c.id)) return;
      var nw = tbCleanWidth_(w[c.id]);
      if ((c.w || 0) === nw) return;
      said.push(c.name + ' ' + (c.w || '기본') + '→' + (nw || '기본'));
      c.w = nw;
    });
    if (!said.length) return { ver: Number(t['판']) || 0, cols: tbCols_(t) };
    var ver = (Number(t['판']) || 0) + 1;
    t['열'] = JSON.stringify(allCols);
    t['판'] = String(ver);
    tbWriteRow_('함께표', t, L.th);
    writeLog_(actor, '함께표', t['표ID'], '수정', tbLabel_(main, t) + ' 열 너비 바꿈', null, { '열 너비': said.join(', ').slice(0, 2000) });
    return { ver: ver, cols: tbCols_(t) };
  });
}

/** 줄 높이(누구나, 고칠 수 있는 분). args = { id: 시트, rows: [{ row, n, h(px, 0이면 글에 맞춤) }] } */
function apiTableRowh_(args, actor, ctx) {
  var id = String(args.id || ''), list = Array.isArray(args.rows) ? args.rows.slice(0, TB_MAX_ROWS_) : [];
  tbEnsureCols_();
  var rowIds = [], given = {};
  list.forEach(function (x) { var r = String((x && x.row) || ''); if (r && rowIds.indexOf(r) < 0) { rowIds.push(r); given[r] = x.n; } });
  var hint = tbHints_(id, rowIds, false, given);
  if (!hint.found) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var names = staffNames_();
  return withLock_(function () {
    var L = tbLockPair_(id, hint), t = L.t, main = L.main;
    tbCheckWrite_(main, ctx);
    var rh = tbHead_('함께표줄'), ver = 0, out = [];
    list.forEach(function (x) {
      var r = tbReadRow_('함께표줄', String(x.row || ''), hint.rows[String(x.row || '')], rh);
      if (!r || r['삭제 여부'] || r['표ID'] !== id) return;
      var nh = tbCleanHeight_(x.h);
      if ((Number(r['높이']) || 0) === nh) return;
      if (!ver) ver = tbBump_(t, L.th);
      r['높이'] = nh ? String(nh) : '';
      r['판'] = String(ver);
      tbWriteRow_('함께표줄', r, rh);
      out.push(tbRowView_(r, names, main['입력자ID']));
    });
    if (out.length) writeLog_(actor, '함께표줄', '', '수정', tbLabel_(main, t) + ' 줄 높이 바꿈 ' + out.length + '줄', null, { '줄 높이': String(tbCleanHeight_((list[0] || {}).h) || '글에 맞춤') });
    return { ver: Number(t['판']) || 0, rows: out };
  });
}

/** 보기(왼쪽 열 고정·줄 간격, 누구나 고칠 수 있는 분). args = { id: 시트, view: { fr, gap } } */
function apiTableView_(args, actor, ctx) {
  var id = String(args.id || ''), view = tbCleanView_(args.view);
  tbEnsureCols_();
  var hint = tbHints_(id, [], false);
  if (!hint.found) throw userError_('이 시트를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  return withLock_(function () {
    var L = tbLockPair_(id, hint), t = L.t, main = L.main;
    tbCheckWrite_(main, ctx);
    var cur = tbViewOf_(t);
    if (cur.fr === view.fr && cur.gap === view.gap) return { ver: Number(t['판']) || 0, view: cur };
    var ver = (Number(t['판']) || 0) + 1;
    t['보기'] = tbViewJson_(view);
    t['판'] = String(ver);
    tbWriteRow_('함께표', t, L.th);
    writeLog_(actor, '함께표', t['표ID'], '수정', tbLabel_(main, t) + ' 보기 바꿈', null,
      { '왼쪽 열 고정': view.fr ? view.fr + '열' : '안 함', '줄 간격': { s: '좁게', n: '보통', w: '넓게' }[view.gap] });
    return { ver: ver, view: view };
  });
}

// ---------------------------------------------------------------- 휴지통(관리자)

/** 지운 표와 지운 시트(표는 그대로 있는 것) */
function adminTableTrash_() {
  var names = staffNames_(), all = tbRows_('함께표'), out = [];
  all.forEach(function (t) {
    var main = tbMainOf_(all, t);
    if (!main) return;
    var item = { id: t['표ID'], title: main['제목'], by: names[main['입력자ID']] || '', deletedBy: names[t['수정자ID']] || '', deletedAt: t['수정 시각'] };
    if (tbIsMain_(t) && t['삭제 여부']) { item.kind = 'doc'; out.push(item); }
    else if (!main['삭제 여부'] && tbSheetGone_(t)) { item.kind = 'sheet'; item.sheet = tbSheetName_(t); out.push(item); }
  });
  out.sort(function (a, b) { var x = String(a.deletedAt || ''), y = String(b.deletedAt || ''); return x < y ? 1 : x > y ? -1 : 0; }); // 최근에 지운 것부터
  return out.slice(0, 100);
}

/** 되살리기: 지운 표(시트 모두) 또는 지운 시트 하나. args = { id, kind: 'doc'|'sheet'(없으면 저절로) } */
function adminTableRestore_(args, actor) {
  tbEnsureCols_();
  return withLock_(function () {
    var all = tbRows_('함께표'), t = tbById_(all, String(args.id || '')), main = t ? tbMainOf_(all, t) : null;
    if (!t || !main) throw userError_('되살릴 표를 찾지 못했어요.');
    var head = tbHead_('함께표');
    if (tbIsMain_(t) && t['삭제 여부'] && args.kind !== 'sheet') {
      updateRow_('함께표', t['표ID'], { '삭제 여부': '' }, actor, '함께 쓰는 표 되살림: ' + t['제목'], '되살리기');
      tbBumpDoc_(findRow_('함께표', t['표ID']), head);
      return { done: true };
    }
    if (!tbSheetGone_(t)) throw userError_('되살릴 시트를 찾지 못했어요.');
    if (main['삭제 여부']) throw userError_('표 전체가 지워져 있어요. 표를 먼저 되살려 주세요.');
    var sheets = tbSheetsOf_(all, main['표ID']), name = tbSheetName_(t);
    var patch = tbIsMain_(t) ? { '시트 지움': '' } : { '삭제 여부': '' };
    if (sheets.some(function (s) { return tbSheetName_(s).toLowerCase() === name.toLowerCase(); })) patch['시트 이름'] = tbFreeSheetName_(name + ' (되살림)', sheets);
    updateRow_('함께표', t['표ID'], patch, actor, tbLabel_(main, t) + ' 시트 되살림', '되살리기');
    tbBumpDoc_(findRow_('함께표', main['표ID']), head);
    return { done: true };
  });
}

// ---------------------------------------------------------------- 테스트용 가짜 표(미리보기·시험)

/** 가짜 표 3개(예시). 실제 교직원 이름은 쓰지 않는다(가짜 교직원 이름만) */
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

  // 시트 여러 개 + 서식(글꼴·크기·색·테두리·합친 칸·줄 높이·왼쪽 열 고정)
  var cols3 = [
    { id: 'c1', name: '층', lock: true, w: 80 }, { id: 'c2', name: '각 실', lock: true, w: 118 }, { id: 'c3', name: '관리자', lock: true, w: 106 },
    { id: 'c4', name: '입력완료', type: 'pick', options: ['완료', '미완료'], w: 142 }, { id: 'c5', name: '배출이 어려운 가구', w: 270 }, { id: 'c6', name: '비고', w: 206 }
  ];
  var fills = { '1층': '#F4CCCC', '2층': '#FFF2CC', '3층': '#CFE2F3' }, starts = { 0: ['1층', 3], 3: ['2층', 4], 7: ['3층', 3] };
  var rows3 = list1.map(function (x, i) {
    var cells = { c2: x[1], c3: x[2], c4: x[3] }, colors = {}, fmt = {}, ms = {};
    if (x[4]) cells.c5 = x[4];
    ['c1', 'c2', 'c3'].forEach(function (c) { colors[c] = fills[x[0]]; });
    if (starts[i]) { cells.c1 = starts[i][0]; fmt.c1 = { b: 1, ha: 'c' }; ms.c1 = [starts[i][1], 1]; }
    if (i === 2 || i === 6) ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].forEach(function (c) { fmt[c] = fmt[c] || {}; fmt[c].bd = '0020'; }); // 층 묶음 아래 굵은 선
    if (i === 4) { fmt.c5 = { fc: '#CC0000', b: 1 }; cells.c6 = '교감 선생님 확인'; fmt.c6 = { i: 1, fc: '#666666' }; }
    if (i === 9) { colors.c5 = '#FCE5CD'; cells.c6 = '※ 학년말에 한 번 더 확인'; fmt.c6 = { ff: 'batang', fs: 12 }; }
    if (i === 2) { cells.c5 = '책장 4개(키가 커서 업체에 따로 물어봐야 해요)'; fmt.c5.va = 't'; }
    return { cells: cells, colors: colors, fmt: fmt, ms: ms, h: i === 2 ? 68 : 0 };
  });
  var c3 = pick('성춘향') || maker, a3 = { id: c3['교직원ID'], name: c3['이름'] }, x3 = { identity: c3, tokens: {}, admin: false };
  var doc = apiTableCreate_({ fields: { title: '2학기 업무 협의(예시)', deptId: dept('인성안전부'), deadline: d7, desc: '버리기 어려운 가구를 실마다 적어 주세요(예시)', sheet: '폐기 물품' },
    cols: cols3, rows: rows3, view: { fr: 2 } }, a3, x3);
  apiTableSheetAdd_({ id: doc.id, name: '특별실 시간표', cols: cols2, rows: rows2 }, a3, x3);
  var cols4 = [{ id: 'c1', name: '날짜', lock: true, w: 110 }, { id: 'c2', name: '시간', lock: true, w: 80 }, { id: 'c3', name: '학년 반', w: 90 },
    { id: 'c4', name: '담임', w: 90 }, { id: 'c5', name: '확인', type: 'pick', options: ['확인', '미확인'], w: 110 }];
  var rows4 = [['10/26 (월)', '14:00', '3-1', '홍길동', '확인'], ['', '15:00', '3-2', '성춘향', ''], ['', '16:00', '4-1', '이몽룡', '확인'],
    ['10/27 (화)', '14:00', '5-2', '심청', ''], ['', '15:30', '6-1', '흥부', '확인']].map(function (x, i) {
    var cells = {};
    x.forEach(function (v, j) { if (v) cells['c' + (j + 1)] = v; });
    return { cells: cells, colors: x[0] ? { c1: '#D9EAD3' } : {}, ms: i === 0 ? { c1: [3, 1] } : i === 3 ? { c1: [2, 1] } : {}, fmt: x[0] ? { c1: { b: 1, ha: 'c' } } : {} };
  });
  apiTableSheetAdd_({ id: doc.id, name: '상담 주간', desc: '상담 시간에 맞춰 담임 선생님이 \'확인\'을 골라 주세요(예시)', cols: cols4, rows: rows4 }, a3, x3);
  return 3;
}
