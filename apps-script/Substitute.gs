/**
 * Substitute.gs — 보결(판 2026-11-10a 교사 요청)
 *
 * - 보결 하나 = '보결' 탭 한 줄(날짜·학급 하나). 교시마다 과목·할 일·들어갈 선생님·자료(파일·링크)는 '교시' 칸(JSON)에 담는다
 *   교시 = [{ p: 1~6, s: 과목, t: 할 일, w: 들어갈 교직원ID, f: [{ x: 파일 번호, id: 드라이브 파일ID, n: 이름, z: 크기 }], l: [{ u: https 주소, n: 이름 }] }]
 * - 보기(교사 결정): 로그인한 선생님 모두. 올리기: 이름을 고른 교직원 누구나
 * - 고치기·지우기·들어갈 선생님 정하기(교사 결정 '올린 분이 정함'): 올린 분과 관리(역할 '관리' 또는 관리자 화면을 연 기기)
 * - 교감 선생님(교사 결정): 교직원 표의 '직위'에 '교감'이 있는 분. 보결 화면을 열면 날짜별 표가 먼저, 홈 '내가 할 일'에 오늘·다가오는 보결 요약
 * - 들어갈 선생님은 홈 '내가 할 일'에 오늘부터 7일 안의 보결이 보인다(날짜가 지나면 사라짐)
 * - 일정·달력과는 잇지 않는다(교사 결정 '보결 화면 안에서만')
 * - 파일은 자료실과 같은 드라이브 폴더(공유하지 않음)에 두고 웹앱을 거쳐서만 내려받는다. 파일ID는 화면에 보내지 않는다
 *   올리기 창에서 고른 파일은 하나씩 먼저 올리고(sub.upload) 받은 표(6시간)로 저장할 때 붙인다. 표는 올린 분만 쓸 수 있다
 * - 같은 날·같은 학급 보결은 하나만. 지운 보결은 관리자 › 휴지통에서 되살린다. 모든 바꿈은 기록 탭에. 탭은 처음 올릴 때 저절로 생긴다
 * - 같은 보결을 두 분이 함께 고치면 '판'으로 알아채고 묻는다(덮어쓰지 않음)
 */

function fileMark_Substitute_() { return '2026-11-10a'; } // 판 표시(관리자 › 점검)

var SUB_PERIODS_ = 6;          // 1~6교시
var SUB_FILES_ = 5;            // 교시마다 파일 5개까지
var SUB_LINKS_ = 3;            // 교시마다 링크 3개까지
var SUB_UP_TTL_ = 21600;       // 먼저 올린 파일 표: 6시간
var SUB_UP_KEY_ = 'gy:up:';
var SUB_TODO_DAYS_ = 7;

/** 탭이 아직 없으면 빈 목록 */
function subRows_(withDeleted) {
  try { return withDeleted ? readRows_('보결') : liveRows_('보결'); } catch (e) { if (e && e.code === 'SETUP') return []; throw e; }
}

function subParse_(s) {
  try { var v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

/** 교감 선생님: 직위에 '교감'이 있는 분(교사 결정 '직위로 알아보기') */
function isVice_(staffRow) {
  return !!(staffRow && /교감/.test(String(staffRow['직위'] || '')));
}

function canEditSub_(r, ctx) { return canEditOwned_(r, ctx); } // 올린 분·관리(Library.gs)

/** 사용 중인 교직원(들어갈 선생님 고르기) */
function subStaff_() {
  return sortStaff_(liveRows_('교직원').filter(function (r) { return r['사용 여부'] !== '사용 안 함'; })).map(function (r) {
    return { id: r['교직원ID'], name: r['이름'], group: r['소속'] || '', position: r['직위'] || '' };
  });
}

/** 학급 고르기: 교직원 소속('4학년 1반')에서. 담임 = 그 소속인 분(여럿이면 앞 분). 짐작해 만들지 않는다 */
function subClasses_() {
  var seen = {}, out = [];
  sortStaff_(liveRows_('교직원').filter(function (r) { return r['사용 여부'] !== '사용 안 함'; })).forEach(function (r) {
    var m = /([1-6])\s*학년\s*(\d{1,2})\s*반/.exec(r['소속'] || '');
    if (!m) return;
    var name = m[1] + '학년 ' + Number(m[2]) + '반';
    if (seen[name]) return;
    seen[name] = true;
    out.push({ name: name, teacher: r['이름'], g: Number(m[1]), c: Number(m[2]) });
  });
  return out.sort(function (a, b) { return a.g - b.g || a.c - b.c; }).map(function (x) { return { name: x.name, teacher: x.teacher }; });
}

/** 보결 한 줄 → 화면 값(파일ID는 보내지 않는다) */
function subView_(r, ctx, names) {
  var me = ctx.identity && ctx.identity['교직원ID'];
  var ps = subParse_(r['교시']).map(function (x) {
    return {
      p: Number(x.p) || 0, s: x.s || '', t: x.t || '', w: x.w || '', wName: x.w ? names[x.w] || '' : '',
      files: (x.f || []).map(function (f) { return { x: f.x, n: f.n, z: Number(f.z) || 0 }; }),
      links: (x.l || []).map(function (l) { return { u: l.u, n: l.n || '' }; })
    };
  }).sort(function (a, b) { return a.p - b.p; });
  return {
    id: r['보결ID'], date: r['날짜'], cls: r['학급'], teacher: r['담임'], note: r['공통 안내'], ver: Number(r['판']) || 1,
    by: names[r['입력자ID']] || '', at: r['입력 시각'], editBy: names[r['수정자ID']] || '', editAt: r['수정 시각'],
    canEdit: canEditSub_(r, ctx), periods: ps,
    unassigned: ps.filter(function (x) { return !x.w; }).length,
    mine: !!(me && ps.some(function (x) { return x.w === me; })),
    byMe: !!(me && r['입력자ID'] === me)
  };
}

/**
 * 보결 목록: 지난 학년도부터(새 학년도에도 3월 첫 주 보결을 볼 수 있게). 날짜·학급 순
 * 화면이 다가오는 보결·지난 보결·날짜별 표를 모두 이것으로 그린다
 */
function apiSubList_(args, actor, ctx) {
  var names = staffNames_(), from = String(curSchoolYear_() - 1);
  var items = subRows_().filter(function (r) { return String(r['학년도'] || '') >= from; })
    .map(function (r) { return subView_(r, ctx, names); })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.cls.localeCompare(b.cls, 'ko', { numeric: true }); });
  var me = ctx.identity;
  return {
    items: items, today: todayYmd_(), staff: subStaff_(), classes: subClasses_(),
    canWrite: !!me, canManage: canManage_(ctx), isVice: isVice_(me), me: me ? me['교직원ID'] : '',
    fileLimit: fileLimitMb_()
  };
}

// ---------------------------------------------------------------- 파일

/** 올리기 창에서 고른 파일 하나를 먼저 올린다. 돌려주는 표(token)를 저장할 때 붙인다(6시간, 올린 분만) */
function apiSubUpload_(args, actor, ctx) {
  var cache = CacheService.getScriptCache();
  if (!cache) throw userError_('지금은 파일을 올릴 수 없어요. 잠시 뒤에 다시 해 주세요.');
  var up = saveUpload_(args && args.file); // 크기 한도·빈 파일은 자료실과 같게(Library.gs)
  var token = Utilities.getUuid().replace(/-/g, '');
  cache.put(SUB_UP_KEY_ + token, JSON.stringify({ id: up.id, n: up.name, z: up.size, by: ctx.identity['교직원ID'] }), SUB_UP_TTL_);
  return { token: token, name: up.name, size: up.size };
}

/** 보결 자료 내려받기(로그인한 누구나). args = { id(보결), x(파일 번호) } */
function apiSubFile_(args, actor, ctx) {
  var r = findSub_(args && args.id), x = String(args.x || ''), hit = null;
  subParse_(r['교시']).forEach(function (p) { (p.f || []).forEach(function (f) { if (f.x === x) hit = f; }); });
  if (!hit || !hit.id) throw userError_('파일을 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  var blob;
  try { blob = DriveApp.getFileById(hit.id).getBlob(); } catch (e) { throw userError_('드라이브에서 파일을 찾지 못했어요. 관리자에게 알려 주세요.', 'NOTFOUND'); }
  return { name: hit.n || blob.getName() || '파일', type: blob.getContentType() || 'application/octet-stream', data: Utilities.base64Encode(blob.getBytes()) };
}

// ---------------------------------------------------------------- 쓰기

function findSub_(id) {
  var r = id ? subRows_().filter(function (x) { return x['보결ID'] === String(id); })[0] : null;
  if (!r) throw userError_('보결을 찾지 못했어요. 다른 분이 지웠을 수 있어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
  return r;
}

function subSummary_(date, cls) {
  return Number(date.slice(5, 7)) + '월 ' + Number(date.slice(8, 10)) + '일 ' + cls;
}

/**
 * 보결 올리기·고치기. args = { id?, base?(본 판), force?, date, cls, teacher, note,
 *   periods: [{ p, s, t, w, files: [{ x } | { token }], links: [{ u, n }] }] }
 */
function apiSubSave_(args, actor, ctx) {
  var date = String(args.date || '').trim();
  if (!isDate_(date)) throw userError_('날짜를 골라 주세요.');
  var cls = cleanText_(args.cls, 20, '학급', true);
  var teacher = cleanText_(args.teacher, 20, '담임');
  var note = cleanText_(String(args.note === null || args.note === undefined ? '' : args.note).replace(/\r\n?/g, '\n'), 1000, '공통 안내');
  var want = Array.isArray(args.periods) ? args.periods : [];
  if (!want.length) throw userError_('보결 교시를 하나 이상 골라 주세요.');
  var staffOk = {};
  subStaff_().forEach(function (s) { staffOk[s.id] = true; });
  var seenP = {}, me = ctx.identity['교직원ID'];
  var clean = want.map(function (x) {
    var p = Number(x && x.p);
    if (!(p >= 1 && p <= SUB_PERIODS_ && Math.floor(p) === p)) throw userError_('교시는 1~' + SUB_PERIODS_ + '교시 중에서 골라 주세요.');
    if (seenP[p]) throw userError_(p + '교시가 두 번 들어 있어요.');
    seenP[p] = true;
    var w = String(x.w || '');
    if (w && !staffOk[w]) throw userError_(p + '교시 들어갈 선생님을 다시 골라 주세요.');
    var files = Array.isArray(x.files) ? x.files : [], links = Array.isArray(x.links) ? x.links : [];
    if (files.length > SUB_FILES_) throw userError_('파일은 교시마다 ' + SUB_FILES_ + '개까지 붙일 수 있어요.');
    if (links.length > SUB_LINKS_) throw userError_('링크는 교시마다 ' + SUB_LINKS_ + '개까지 붙일 수 있어요.');
    return {
      p: p, s: cleanText_(x.s, 20, p + '교시 과목'),
      t: cleanText_(String(x.t === null || x.t === undefined ? '' : x.t).replace(/\r\n?/g, '\n'), 1000, p + '교시 할 일'),
      w: w, files: files,
      l: links.map(function (l) { return { u: cleanUrl_(l && l.u, p + '교시 링크', true), n: cleanText_(l && l.n, 40, '링크 이름') }; })
    };
  }).sort(function (a, b) { return a.p - b.p; });
  var cache = CacheService.getScriptCache();
  return withLock_(function () {
    ensureTab_('보결');
    var old = args.id ? findSub_(args.id) : null;
    if (old && !canEditSub_(old, ctx)) throw userError_('보결을 올린 분과 관리자만 고칠 수 있어요.', 'FORBIDDEN');
    if (old && !args.force && (Number(old['판']) || 1) !== Number(args.base || 0)) {
      var who = staffNames_()[old['수정자ID'] || old['입력자ID']] || '다른 선생님';
      throw userError_('그사이 ' + who + ' 선생님이 이 보결을 고쳤어요. 쓰던 내용은 창에 그대로 있어요.', 'CONFLICT');
    }
    var dup = subRows_().filter(function (r) { return r['날짜'] === date && r['학급'] === cls && (!old || r['보결ID'] !== old['보결ID']); })[0];
    if (dup) throw userError_(subSummary_(date, cls) + ' 보결이 이미 있어요. 목록에서 그 보결을 열어 고쳐 주세요.', 'DUP');
    // 파일: 있던 것은 번호(x)로 그대로, 새로 올린 것은 표(token)로 찾는다
    var oldFiles = {}, maxX = 0;
    if (old) subParse_(old['교시']).forEach(function (p) {
      (p.f || []).forEach(function (f) { oldFiles[f.x] = f; var n = Number(String(f.x).slice(1)) || 0; if (n > maxX) maxX = n; });
    });
    var usedX = {};
    var periods = clean.map(function (x) {
      var f = x.files.map(function (it) {
        if (it && it.x) {
          var o = oldFiles[String(it.x)];
          if (!o || usedX[o.x]) throw userError_('붙여 둔 파일을 찾지 못했어요. 창을 닫고 다시 열어 주세요.');
          usedX[o.x] = true;
          return o;
        }
        var raw = it && it.token && cache ? cache.get(SUB_UP_KEY_ + String(it.token).replace(/[^0-9a-f]/gi, '')) : null;
        var up = null;
        try { up = raw ? JSON.parse(raw) : null; } catch (e) { up = null; }
        if (!up || up.by !== me) throw userError_('올린 파일을 찾지 못했어요(6시간이 지났을 수 있어요). 파일을 빼고 다시 붙여 주세요.');
        maxX++;
        return { x: 'f' + maxX, id: up.id, n: up.n, z: up.z };
      });
      var o = { p: x.p, s: x.s, t: x.t };
      if (x.w) o.w = x.w;
      if (f.length) o.f = f;
      if (x.l.length) o.l = x.l;
      return o;
    });
    var rec = { '학년도': String(schoolYearOf_(date)), '날짜': date, '학급': cls, '담임': teacher, '공통 안내': note, '교시': JSON.stringify(periods) };
    var summary = subSummary_(date, cls) + ' (' + periods.map(function (x) { return x.p; }).join('·') + '교시)';
    var saved;
    if (old) {
      rec['판'] = String((Number(old['판']) || 1) + 1);
      saved = updateRow_('보결', old['보결ID'], rec, actor, '보결 고침: ' + summary);
    } else {
      rec['판'] = '1';
      saved = insertRow_('보결', rec, actor, '보결 올림: ' + summary);
    }
    return { id: saved['보결ID'] };
  });
}

function apiSubDelete_(args, actor, ctx) {
  return withLock_(function () {
    var r = findSub_(args && args.id);
    if (!canEditSub_(r, ctx)) throw userError_('보결을 올린 분과 관리자만 지울 수 있어요.', 'FORBIDDEN');
    softDelete_('보결', r['보결ID'], actor, '보결 지움: ' + subSummary_(r['날짜'], r['학급']));
    return { done: true };
  });
}

// ---------------------------------------------------------------- 홈 '내가 할 일'

/** 들어갈 선생님: 오늘부터 7일 안에 내가 들어갈 교시(날짜·교시 순) */
function subTodosFor_(ctx) {
  var me = ctx && ctx.identity && ctx.identity['교직원ID'];
  if (!me) return [];
  var today = todayYmd_(), until = addDays_(today, SUB_TODO_DAYS_), names = null, out = [];
  subRows_().forEach(function (r) {
    if (r['날짜'] < today || r['날짜'] > until) return;
    subParse_(r['교시']).forEach(function (p) {
      if (p.w !== me) return;
      names = names || staffNames_();
      out.push({ id: r['보결ID'], date: r['날짜'], p: Number(p.p) || 0, cls: r['학급'], s: p.s || '', files: (p.f || []).length + (p.l || []).length, by: names[r['입력자ID']] || '' });
    });
  });
  return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.p - b.p; });
}

/** 교감 선생님: 오늘 보결 학급·시간·안 정한 교시, 7일 안의 안 정한 교시(없으면 null) */
function subViceFor_(ctx) {
  if (!isVice_(ctx && ctx.identity)) return null;
  var today = todayYmd_(), until = addDays_(today, SUB_TODO_DAYS_);
  var o = { today: today, classes: 0, hours: 0, unassigned: 0, soonClasses: 0, soonUnassigned: 0, firstDate: '' };
  subRows_().forEach(function (r) {
    if (r['날짜'] < today || r['날짜'] > until) return;
    var ps = subParse_(r['교시']), un = ps.filter(function (p) { return !p.w; }).length;
    if (r['날짜'] === today) { o.classes++; o.hours += ps.length; o.unassigned += un; }
    else { o.soonClasses++; o.soonUnassigned += un; if (!o.firstDate || r['날짜'] < o.firstDate) o.firstDate = r['날짜']; }
  });
  return o.classes || o.soonClasses ? o : null;
}

// ---------------------------------------------------------------- 휴지통(관리자)

function adminSubTrash_() {
  var names = staffNames_();
  return { items: subRows_(true).filter(function (r) { return r['삭제 여부']; }).map(function (r) {
    var ps = subParse_(r['교시']);
    return { tab: '보결', id: r['보결ID'], title: subSummary_(r['날짜'], r['학급']) + ' 보결', sub: ps.map(function (p) { return p.p + '교시' + (p.s ? ' ' + p.s : ''); }).join(', '),
      by: names[r['입력자ID']] || '', deletedBy: names[r['수정자ID']] || '', deletedAt: r['수정 시각'] };
  }).sort(function (a, b) { return a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0; }).slice(0, 200) };
}

function adminSubRestore_(args, actor) {
  return withLock_(function () {
    var r = subRows_(true).filter(function (x) { return x['보결ID'] === String(args.id || ''); })[0];
    if (!r || !r['삭제 여부']) throw userError_('되살릴 보결을 찾지 못했어요.');
    var dup = subRows_().filter(function (x) { return x['날짜'] === r['날짜'] && x['학급'] === r['학급']; })[0];
    if (dup) throw userError_(subSummary_(r['날짜'], r['학급']) + ' 보결이 이미 다시 올라와 있어요. 그 보결을 고쳐 주세요.');
    restoreRow_('보결', r['보결ID'], actor, '보결 되살림: ' + subSummary_(r['날짜'], r['학급']));
    return { done: true };
  });
}

// ---------------------------------------------------------------- 시험·미리보기용 예시

/** 예시 보결 3개(오늘·내일·지난주). 이름은 가짜 교직원(옛이야기 인물), 내용은 '(예시)' */
function seedTestSubs_() {
  if (subRows_().length) throw userError_('보결 탭에 이미 보결이 있어요. 예시 보결은 빈 테스트 시트에만 넣을 수 있어요.');
  var staff = {}, t = todayYmd_();
  liveRows_('교직원').forEach(function (s) { staff[s['이름']] = s; });
  var id = function (n) { return staff[n] ? staff[n]['교직원ID'] : ''; };
  var who = function (n) { var s = staff[n]; return s ? { id: s['교직원ID'], name: s['이름'] } : { id: '', name: '테스트 데이터' }; };
  var file = function (name, text) {
    var up = saveUpload_({ name: name, type: 'text/plain', data: Utilities.base64Encode(Utilities.newBlob(text).getBytes()) });
    return { id: up.id, n: up.name, z: up.size };
  };
  var n = 0;
  withLock_(function () {
    ensureTab_('보결');
    var put = function (date, cls, teacher, note, ps, by) {
      var x = 0;
      ps.forEach(function (p) { (p.f || []).forEach(function (f) { x++; f.x = 'f' + x; }); });
      insertRow_('보결', { '학년도': String(schoolYearOf_(date)), '날짜': date, '학급': cls, '담임': teacher, '공통 안내': note, '교시': JSON.stringify(ps), '판': '1' }, who(by), '예시 보결');
      n++;
    };
    put(t, '4학년 1반', '이몽룡', '(예시) 아침 활동은 독서예요. 급식은 4교시 뒤 12:10이에요.', [
      { p: 1, s: '국어', t: '(예시) 교과서 64~67쪽 읽고 느낌 나누기', w: id('홍길동'), f: [file('국어_활동지(예시).txt', '(예시) 국어 활동지')] },
      { p: 2, s: '수학', t: '(예시) 익힘책 42~43쪽', w: id('성춘향'), f: [file('수학_익힘책_답(예시).txt', '(예시) 답')] },
      { p: 3, s: '과학', t: '(예시) 영상 시청 뒤 공책 정리' },
      { p: 4, s: '사회', t: '(예시) 모둠 조사 이어 하기', w: id('심청') }
    ], '이몽룡');
    put(addDays_(t, 1), '5학년 1반', '심청', '', [
      { p: 3, s: '체육', t: '(예시) 강당에서 피구', w: id('놀부') },
      { p: 5, s: '미술', t: '(예시) 가을 풍경 그리기 마무리', w: id('성춘향') }
    ], '심청');
    put(addDays_(t, -7), '2학년 1반', '장화', '', [{ p: 5, s: '통합', t: '(예시) 가을 노래 부르기', w: id('흥부') }], '장화');
  });
  return n;
}
