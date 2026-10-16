/**
 * Survey.gs — 조사·신청
 *
 * - 조사: 제목·설명·담당 부서·대상·마감 일시·질문(JSON)·메신저 문구·결과 공개
 * - 대상(JSON): {"type":"all"} | {"type":"dept","ids":[부서ID]} | {"type":"grade","grades":["3"]} | {"type":"people","ids":[교직원ID]}
 * - 질문 종류: one(하나 고르기) many(여러 개) short(짧은 글) long(긴 글) number(숫자) date(날짜)
 * - 응답: 한 사람이 한 조사에 한 줄. 다시 내면 새 줄이 아니라 고치기.
 * - 다시 알리기: '알림' 탭에 안 낸 분마다 한 줄 → 그분 홈 '내가 할 일' 맨 위
 * - 결과(누가 뭐라고 답했는지): 만든 사람·관리자, 그리고 '결과 공개'를 켠 조사는 대상 교직원 모두
 */

function fileMark_Survey_() { return '2026-10-16e'; } // 판 표시(관리자 › 점검)

function qTypes_() {
  return { one: '하나 고르기', many: '여러 개 고르기', short: '짧은 글', long: '긴 글', number: '숫자', date: '날짜' };
}

// ---------------------------------------------------------------- 도구

function safeParse_(s, fallback) {
  try { var v = JSON.parse(s); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}

var NOW_MIN_MEMO_ = { at: 0, v: '' }; // 조사마다 날짜 형식을 부르지 않게 1초 동안 같은 값을 쓴다
function nowMin_() {
  var t = Date.now();
  if (t - NOW_MIN_MEMO_.at > 1000 || t < NOW_MIN_MEMO_.at) NOW_MIN_MEMO_ = { at: t, v: Utilities.formatDate(new Date(t), tz_(), 'yyyy-MM-dd HH:mm') };
  return NOW_MIN_MEMO_.v;
}

/** 끝났는지: 손으로 끝냈거나 마감이 지났으면 */
function surveyClosed_(s) {
  return s['상태'] === '끝남' || (s['마감 일시'] && s['마감 일시'] <= nowMin_());
}

function gradeOf_(staff) {
  var m = /(\d)\s*학년/.exec(staff['소속'] || '');
  return m ? m[1] : '';
}

function activeStaff_() {
  return liveRows_('교직원').filter(function (r) { return r['사용 여부'] !== '사용 안 함'; });
}

/** 대상에 드는 사용 중인 교직원 행 */
function targetStaff_(target, staff) {
  var t = target || { type: 'all' };
  return (staff || activeStaff_()).filter(function (r) {
    if (t.type === 'dept') return (t.ids || []).indexOf(r['부서ID']) >= 0;
    if (t.type === 'grade') return (t.grades || []).indexOf(gradeOf_(r)) >= 0;
    if (t.type === 'people') return (t.ids || []).indexOf(r['교직원ID']) >= 0;
    return true;
  });
}

function targetText_(t, depts, names) {
  t = t || { type: 'all' };
  if (t.type === 'dept') return (t.ids || []).map(function (id) { return depts[id] || '(지운 부서)'; }).join('·');
  if (t.type === 'grade') return (t.grades || []).map(function (g) { return g + '학년'; }).join('·');
  if (t.type === 'people') return (t.ids || []).length + '명 직접 고름';
  return '전체 교직원';
}

function canEditSurvey_(s, ctx) {
  if (canManage_(ctx)) return true;
  return !!(ctx.identity && s['입력자ID'] && s['입력자ID'] === ctx.identity['교직원ID']);
}

function liveResponses_(surveyId) {
  return liveRows_('응답').filter(function (r) { return r['조사ID'] === surveyId; });
}

/** 마감 글: 10월 14일(수) 17:00 */
function deadlineText_(d) {
  if (!d) return '';
  var day = d.slice(0, 10);
  return Number(day.slice(5, 7)) + '월 ' + Number(day.slice(8, 10)) + '일(' + '일월화수목금토'.charAt(weekday_(day)) + ') ' + d.slice(11, 16);
}

function defaultMessenger_(title, deptName, deadline) {
  return (deptName ? '[' + deptName + '] ' : '') + title + josa_(title, '을', '를') + ' ' + deadlineText_(deadline) + '까지 내 주세요.\n' +
    '온라인 교무실 › 조사·신청에서 바로 낼 수 있어요.';
}

// ---------------------------------------------------------------- 목록

/** 카드에 쓰는 조사 요약 */
function surveyCard_(s, ctx, cache) {
  var target = safeParse_(s['대상'], { type: 'all' });
  var tStaff = targetStaff_(target, cache.staff);
  var tIds = {};
  tStaff.forEach(function (r) { tIds[r['교직원ID']] = true; });
  var resp = cache.resp[s['조사ID']] || [];
  var done = resp.filter(function (r) { return tIds[r['교직원ID']]; }).length;
  var me = ctx.identity ? ctx.identity['교직원ID'] : '';
  var mine = resp.filter(function (r) { return r['교직원ID'] === me; })[0];
  var qs = safeParse_(s['질문'], []);
  var closed = surveyClosed_(s);
  return {
    id: s['조사ID'],
    title: s['제목'],
    dept: cache.depts[s['부서ID']] || '',
    deadline: s['마감 일시'],
    deadlineText: deadlineText_(s['마감 일시']),
    closed: closed,
    closedEarly: s['상태'] === '끝남',
    targetText: targetText_(target, cache.depts, cache.names),
    targetCount: tStaff.length,
    doneCount: done,
    inTarget: !!tIds[me],
    answered: !!mine,
    answeredAt: mine ? (mine['고친 시각'] || mine['낸 시각']) : '',
    qCount: qs.length,
    by: cache.names[s['입력자ID']] || '',
    byId: s['입력자ID'],
    createdAt: s['입력 시각'],
    canEdit: canEditSurvey_(s, ctx),
    showResults: s['결과 공개'] === '예',
    reminded: !!(me && cache.remind[s['조사ID'] + '/' + me])
  };
}

function surveyCache_() {
  var resp = {};
  liveRows_('응답').forEach(function (r) { (resp[r['조사ID']] = resp[r['조사ID']] || []).push(r); });
  var remind = {};
  liveRows_('알림').forEach(function (r) { remind[r['조사ID'] + '/' + r['대상 교직원ID']] = r['알린 시각'] || r['입력 시각']; });
  return { staff: activeStaff_(), resp: resp, remind: remind, depts: categoryNames_('부서'), names: staffNames_() };
}

/** 내가 낼 조사(열려 있고, 대상이고, 아직 안 냄). 다시 알림 받은 것 → 마감 가까운 순 */
function todoList_(ctx, cache) {
  if (!ctx.identity) return [];
  cache = cache || surveyCache_();
  return liveRows_('조사').map(function (s) { return surveyCard_(s, ctx, cache); })
    .filter(function (c) { return !c.closed && c.inTarget && !c.answered; })
    .sort(function (a, b) {
      if (a.reminded !== b.reminded) return a.reminded ? -1 : 1;
      return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
    });
}

function apiSurveyList_(args, actor, ctx) {
  var cache = surveyCache_();
  var cards = liveRows_('조사').map(function (s) { return surveyCard_(s, ctx, cache); });
  var me = ctx.identity ? ctx.identity['교직원ID'] : '';
  var manage = canManage_(ctx);
  var byDeadline = function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; };
  var toAnswer = cards.filter(function (c) { return !c.closed && c.inTarget; }).sort(function (a, b) {
    if (a.answered !== b.answered) return a.answered ? 1 : -1;
    if (a.reminded !== b.reminded) return a.reminded ? -1 : 1;
    return byDeadline(a, b);
  });
  var mine = cards.filter(function (c) { return !c.closed && (c.byId === me || manage); }).sort(byDeadline);
  var past = cards.filter(function (c) { return c.closed && (c.inTarget || c.byId === me || manage); })
    .sort(function (a, b) { return byDeadline(b, a); });
  return {
    needIdentity: !ctx.identity,
    canManage: manage,
    toAnswer: toAnswer,
    mine: mine,
    past: past,
    todoCount: toAnswer.filter(function (c) { return !c.answered; }).length,
    now: nowMin_(),
    today: todayYmd_()
  };
}

// ---------------------------------------------------------------- 한 조사 보기

function apiSurveyGet_(args, actor, ctx) {
  var s = findRow_('조사', String(args.id || ''));
  if (!s || s['삭제 여부']) throw userError_('이 조사를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
  var cache = surveyCache_();
  var card = surveyCard_(s, ctx, cache);
  var questions = safeParse_(s['질문'], []);
  var target = safeParse_(s['대상'], { type: 'all' });
  var resp = cache.resp[s['조사ID']] || [];
  var me = ctx.identity ? ctx.identity['교직원ID'] : '';
  var mine = resp.filter(function (r) { return r['교직원ID'] === me; })[0];
  var owner = card.canEdit;
  var out = {
    card: card,
    description: s['설명'],
    questions: questions,
    target: target,
    deptId: s['부서ID'],
    messenger: s['메신저 문구'] || defaultMessenger_(s['제목'], card.dept, s['마감 일시']),
    myAnswer: mine ? { answers: safeParse_(mine['답'], {}), note: mine['하고 싶은 말'], at: mine['고친 시각'] || mine['낸 시각'] } : null,
    owner: owner,
    canSeeResults: owner || (card.showResults && (card.inTarget || card.byId === me)),
    hasResponses: resp.length > 0
  };
  if (out.canSeeResults) {
    var tStaff = targetStaff_(target, cache.staff);
    var doneIds = {};
    resp.forEach(function (r) { doneIds[r['교직원ID']] = r; });
    var person = function (r) { return { id: r['교직원ID'], name: r['이름'], group: r['소속'], position: r['직위'] }; };
    out.notDone = owner ? sortStaff_(tStaff.filter(function (r) { return !doneIds[r['교직원ID']]; })).map(person) : [];
    var staffById = {};
    readRows_('교직원').forEach(function (r) { staffById[r['교직원ID']] = r; });
    out.responses = resp.map(function (r) {
      var st = staffById[r['교직원ID']] || {};
      return { name: st['이름'] || '(알 수 없음)', group: st['소속'] || '', answers: safeParse_(r['답'], {}), note: r['하고 싶은 말'], at: r['고친 시각'] || r['낸 시각'], edited: !!r['고친 시각'] };
    }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    out.summary = summarize_(questions, out.responses);
    var presses = {}; // 알림 줄은 사람마다 하나씩이라, 누른 횟수는 알린 시각으로 센다
    if (owner) liveRows_('알림').forEach(function (r) { if (r['조사ID'] === s['조사ID']) presses[r['알린 시각']] = 1; });
    out.remindedCount = Object.keys(presses).length;
  }
  if (owner) out.depts = deptOptions_();
  return out;
}

/** 질문별 요약: 고르기는 선택지별 개수, 숫자는 합계·평균, 날짜는 날짜별 개수, 글은 답 모음 */
function summarize_(questions, responses) {
  return questions.map(function (q) {
    var vals = responses.map(function (r) { return r.answers[q.id]; }).filter(function (v) {
      return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
    });
    var out = { id: q.id, type: q.type, title: q.title, answered: vals.length };
    if (q.type === 'one' || q.type === 'many') {
      var counts = {};
      (q.options || []).forEach(function (o) { counts[o] = 0; });
      vals.forEach(function (v) { [].concat(v).forEach(function (o) { counts[o] = (counts[o] || 0) + 1; }); });
      out.counts = Object.keys(counts).map(function (k) { return { option: k, count: counts[k] }; });
    } else if (q.type === 'number') {
      var nums = vals.map(Number).filter(function (n) { return !isNaN(n); });
      var sum = nums.reduce(function (a, b) { return a + b; }, 0);
      out.sum = Math.round(sum * 100) / 100;
      out.avg = nums.length ? Math.round(sum / nums.length * 100) / 100 : null;
    } else if (q.type === 'date') {
      var dc = {};
      vals.forEach(function (v) { dc[v] = (dc[v] || 0) + 1; });
      out.counts = Object.keys(dc).sort().map(function (k) { return { option: k, count: dc[k] }; });
    } else {
      out.texts = vals.slice(0, 300);
    }
    return out;
  });
}

// ---------------------------------------------------------------- 만들기·고치기

function cleanQuestions_(list) {
  if (!Array.isArray(list) || !list.length) throw userError_('질문을 하나 이상 넣어 주세요.');
  if (list.length > 30) throw userError_('질문은 30개까지 넣을 수 있어요.');
  var types = qTypes_();
  var seen = {};
  return list.map(function (q, i) {
    var type = String(q.type || '');
    if (!types[type]) throw userError_((i + 1) + '번 질문의 종류를 골라 주세요.');
    var title = cleanText_(q.title, 200, (i + 1) + '번 질문', true);
    var id = /^q[0-9a-z]{1,12}$/.test(String(q.id || '')) && !seen[q.id] ? q.id : 'q' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    seen[id] = true;
    var out = { id: id, type: type, title: title, required: !!q.required };
    if (type === 'one' || type === 'many') {
      var opts = (Array.isArray(q.options) ? q.options : String(q.options || '').split('\n'))
        .map(function (o) { return String(o).trim(); }).filter(Boolean);
      opts = opts.filter(function (o, k) { return opts.indexOf(o) === k; });
      if (opts.length < 2) throw userError_((i + 1) + '번 질문의 보기를 두 개 이상 적어 주세요.');
      if (opts.length > 30) throw userError_((i + 1) + '번 질문의 보기는 30개까지 적을 수 있어요.');
      opts.forEach(function (o) { if (o.length > 80) throw userError_((i + 1) + '번 질문의 보기는 80자까지 적을 수 있어요.'); });
      out.options = opts;
    }
    return out;
  });
}

function cleanTargetJson_(t) {
  t = t || {};
  var type = String(t.type || 'all');
  if (type === 'dept') {
    var depts = categoryNames_('부서');
    var ids = (t.ids || []).filter(function (id) { return depts[id]; });
    if (!ids.length) throw userError_('대상 부서를 하나 이상 골라 주세요.');
    return { type: 'dept', ids: ids };
  }
  if (type === 'grade') {
    var grades = (t.grades || []).map(String).filter(function (g) { return /^[1-6]$/.test(g); });
    if (!grades.length) throw userError_('대상 학년을 하나 이상 골라 주세요.');
    return { type: 'grade', grades: grades };
  }
  if (type === 'people') {
    var live = {};
    activeStaff_().forEach(function (r) { live[r['교직원ID']] = true; });
    var pids = (t.ids || []).filter(function (id) { return live[id]; });
    if (!pids.length) throw userError_('대상 교직원을 한 명 이상 골라 주세요.');
    return { type: 'people', ids: pids };
  }
  return { type: 'all' };
}

function apiSurveySave_(args, actor, ctx) {
  var f = args.fields || {};
  var title = cleanText_(f.title, 80, '조사 제목', true);
  var deptId = cleanText_(f.deptId, 20, '담당 부서');
  var depts = categoryNames_('부서');
  if (deptId && !depts[deptId]) throw userError_('담당 부서를 다시 골라 주세요.');
  var deadline = String(f.deadline || '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(deadline) || !isDate_(deadline.slice(0, 10))) throw userError_('마감 날짜와 시각을 골라 주세요.');
  var questions = cleanQuestions_(f.questions);
  var target = cleanTargetJson_(f.target);
  var messenger = cleanText_(f.messenger, 500, '메신저 문구');
  // 자동 문구는 저장하지 않고 읽을 때 만든다(제목·마감을 고치면 문구도 따라 바뀌게). 직접 고쳐 쓴 문구만 저장한다
  var plain = function (t) { return String(t || '').replace(/\s+/g, ' ').trim(); };
  if (plain(messenger) === plain(defaultMessenger_(title, depts[deptId] || '', deadline))) messenger = '';
  var rec = {
    '제목': title,
    '설명': cleanText_(f.description, 1000, '설명'),
    '부서ID': deptId,
    '대상': JSON.stringify(target),
    '마감 일시': deadline,
    '질문': JSON.stringify(questions),
    '메신저 문구': messenger,
    '결과 공개': f.showResults ? '예' : ''
  };
  ensureCols_('조사');
  if (args.id) {
    var s = findRow_('조사', String(args.id));
    if (!s || s['삭제 여부']) throw userError_('이 조사를 찾지 못했어요.', 'NOTFOUND');
    if (!canEditSurvey_(s, ctx)) throw userError_('만든 분과 연구부장·부담당만 고칠 수 있어요.', 'FORBIDDEN');
    if (liveResponses_(s['조사ID']).length && !sameQuestions_(safeParse_(s['질문'], []), questions)) {
      throw userError_('이미 낸 답이 있어서 질문은 고칠 수 없어요. 제목·마감·대상·안내 문구만 고칠 수 있어요.', 'LOCKED');
    }
    if (plain(messenger) === plain(defaultMessenger_(s['제목'], depts[s['부서ID']] || '', s['마감 일시']))) rec['메신저 문구'] = ''; // 예전 자동 문구 그대로면 자동으로
    // '지금 끝내기'로 끝낸 조사는 마감을 전보다 늦췄을 때만 다시 연다(글만 고쳐 저장하면 끝난 그대로)
    if (s['상태'] === '끝남' && f.reopen && deadline > nowMin_() && deadline > String(s['마감 일시'] || '')) rec['상태'] = '진행 중';
    updateRow_('조사', s['조사ID'], rec, actor, '조사 고침: ' + title);
    return { id: s['조사ID'] };
  }
  if (deadline <= nowMin_()) throw userError_('마감은 지금보다 뒤로 정해 주세요.');
  rec['상태'] = '진행 중';
  var added = insertRow_('조사', rec, actor, '조사 만듦: ' + title);
  return { id: added['조사ID'] };
}

function sameQuestions_(a, b) {
  var key = function (list) {
    return JSON.stringify(list.map(function (q) { return [q.id, q.type, q.title, q.required, q.options || []]; }));
  };
  return key(a) === key(b);
}

/** 지금 끝내기 / 다시 열기 */
function apiSurveySetOpen_(args, actor, ctx) {
  var s = findRow_('조사', String(args.id || ''));
  if (!s || s['삭제 여부']) throw userError_('이 조사를 찾지 못했어요.', 'NOTFOUND');
  if (!canEditSurvey_(s, ctx)) throw userError_('만든 분과 연구부장·부담당만 바꿀 수 있어요.', 'FORBIDDEN');
  if (args.open) {
    if (s['마감 일시'] <= nowMin_()) throw userError_('마감이 이미 지났어요. "고치기"에서 마감을 늦춰 주세요.');
    updateRow_('조사', s['조사ID'], { '상태': '진행 중' }, actor, '조사 다시 엶: ' + s['제목']);
  } else {
    updateRow_('조사', s['조사ID'], { '상태': '끝남' }, actor, '조사 끝냄: ' + s['제목']);
  }
  return { done: true };
}

function apiSurveyDelete_(args, actor, ctx) {
  var s = findRow_('조사', String(args.id || ''));
  if (!s || s['삭제 여부']) throw userError_('이 조사를 찾지 못했어요.', 'NOTFOUND');
  if (!canEditSurvey_(s, ctx)) throw userError_('만든 분과 연구부장·부담당만 지울 수 있어요.', 'FORBIDDEN');
  softDelete_('조사', s['조사ID'], actor, '조사 지움: ' + s['제목']);
  return { done: true };
}

// ---------------------------------------------------------------- 응답

function cleanAnswers_(questions, answers) {
  answers = answers || {};
  var out = {};
  questions.forEach(function (q, i) {
    var v = answers[q.id];
    var n = (i + 1) + '번 질문';
    var empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      if (q.required) throw userError_(n + '에 답해 주세요.');
      return;
    }
    if (q.type === 'one') {
      if ((q.options || []).indexOf(String(v)) < 0) throw userError_(n + '의 보기를 다시 골라 주세요.');
      out[q.id] = String(v);
    } else if (q.type === 'many') {
      var list = [].concat(v).map(String);
      list.forEach(function (o) { if ((q.options || []).indexOf(o) < 0) throw userError_(n + '의 보기를 다시 골라 주세요.'); });
      out[q.id] = q.options.filter(function (o) { return list.indexOf(o) >= 0; });
    } else if (q.type === 'number') {
      var s = String(v).trim().replace(/,/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(s) || s.length > 15) throw userError_(n + '에는 숫자만 적어 주세요.');
      out[q.id] = s;
    } else if (q.type === 'date') {
      if (!isDate_(String(v))) throw userError_(n + '의 날짜를 골라 주세요.');
      out[q.id] = String(v);
    } else {
      out[q.id] = cleanText_(v, q.type === 'long' ? 2000 : 200, n);
    }
  });
  return out;
}

function apiSurveyRespond_(args, actor, ctx) {
  var me = ctx.identity['교직원ID'];
  return withLock_(function () {
    var s = findRow_('조사', String(args.id || ''));
    if (!s || s['삭제 여부']) throw userError_('이 조사를 찾지 못했어요. 지워졌을 수 있어요.', 'NOTFOUND');
    if (surveyClosed_(s)) throw userError_('마감된 조사예요. 더 이상 내거나 고칠 수 없어요.', 'CLOSED');
    var target = safeParse_(s['대상'], { type: 'all' });
    if (!targetStaff_(target).some(function (r) { return r['교직원ID'] === me; })) {
      throw userError_('이 조사의 대상이 아니에요. 만든 분께 여쭤봐 주세요.', 'FORBIDDEN');
    }
    var answers = cleanAnswers_(safeParse_(s['질문'], []), args.answers);
    // 조사마다 '긴 글' 질문으로 받으므로 화면에는 따로 칸이 없다. 예전 값은 그대로 둔다.
    var noteSent = args.note !== undefined && args.note !== null;
    var note = noteSent ? cleanText_(args.note, 500, '하고 싶은 말') : '';
    var now = nowText_();
    var old = liveResponses_(s['조사ID']).filter(function (r) { return r['교직원ID'] === me; })[0];
    if (old) {
      var patch = { '답': JSON.stringify(answers), '고친 시각': now };
      if (noteSent) patch['하고 싶은 말'] = note;
      updateRow_('응답', old['응답ID'], patch, actor, s['제목'] + ' 응답 고침');
      return { edited: true, at: now };
    }
    insertRow_('응답', { '조사ID': s['조사ID'], '교직원ID': me, '답': JSON.stringify(answers), '하고 싶은 말': note, '낸 시각': now }, actor, s['제목'] + ' 응답 냄');
    return { edited: false, at: now };
  });
}

// ---------------------------------------------------------------- 다시 알리기·내려받기

function apiSurveyRemind_(args, actor, ctx) {
  var s = findRow_('조사', String(args.id || ''));
  if (!s || s['삭제 여부']) throw userError_('이 조사를 찾지 못했어요.', 'NOTFOUND');
  if (!canEditSurvey_(s, ctx)) throw userError_('만든 분과 연구부장·부담당만 알릴 수 있어요.', 'FORBIDDEN');
  if (surveyClosed_(s)) throw userError_('마감된 조사예요. 마감을 늦춘 뒤에 알려 주세요.');
  var done = {};
  liveResponses_(s['조사ID']).forEach(function (r) { done[r['교직원ID']] = true; });
  var targets = targetStaff_(safeParse_(s['대상'], { type: 'all' })).filter(function (r) { return !done[r['교직원ID']]; });
  if (!targets.length) return { count: 0 };
  var now = nowText_();
  insertRows_('알림', targets.map(function (r) {
    return { '조사ID': s['조사ID'], '대상 교직원ID': r['교직원ID'], '알린 시각': now };
  }), actor, s['제목'] + ': 안 낸 ' + targets.length + '명에게 다시 알림');
  return { count: targets.length };
}

/** CSV 글자(엑셀에서 한글이 깨지지 않게 화면에서 BOM을 붙인다) */
function apiSurveyCsv_(args, actor, ctx) {
  var d = apiSurveyGet_(args, actor, ctx);
  if (!d.canSeeResults) throw userError_('이 조사의 결과는 만든 분만 볼 수 있어요.', 'FORBIDDEN');
  var cell = function (v) {
    var t = Array.isArray(v) ? v.join(', ') : String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t; // 엑셀 수식으로 읽히지 않게(음수 같은 숫자는 그대로)
    return '"' + t.replace(/"/g, '""') + '"';
  };
  var hasNote = d.responses.some(function (r) { return r.note; });
  var head = ['이름', '소속', '낸 시각'].concat(d.questions.map(function (q, i) { return (i + 1) + '. ' + q.title; })).concat(hasNote ? ['하고 싶은 말'] : []);
  var lines = [head.map(cell).join(',')];
  d.responses.forEach(function (r) {
    lines.push([r.name, r.group, r.at].concat(d.questions.map(function (q) { return r.answers[q.id]; })).concat(hasNote ? [r.note] : []).map(cell).join(','));
  });
  return { filename: d.card.title.replace(/[\\\/:*?"<>|]/g, '_') + ' 응답.csv', csv: lines.join('\r\n') };
}

// ---------------------------------------------------------------- 휴지통(조사)

function adminSurveyTrash_() {
  var names = staffNames_();
  var del = readRows_('조사').filter(function (s) { return s['삭제 여부']; }).reverse();
  del.sort(function (a, b) { var x = String(a['수정 시각'] || ''), y = String(b['수정 시각'] || ''); return x < y ? 1 : x > y ? -1 : 0; }); // 최근에 지운 것부터
  return del.slice(0, 100).map(function (s) {
    return { id: s['조사ID'], title: s['제목'], deadline: s['마감 일시'], by: names[s['입력자ID']] || '', deletedBy: names[s['수정자ID']] || '', deletedAt: s['수정 시각'] };
  });
}

function adminSurveyRestore_(args, actor) {
  var s = findRow_('조사', String(args.id || ''));
  if (!s || !s['삭제 여부']) throw userError_('되살릴 조사를 찾지 못했어요.');
  restoreRow_('조사', s['조사ID'], actor, '조사 되살림: ' + s['제목']);
  return { done: true };
}

// ---------------------------------------------------------------- 테스트용 가짜 조사

function seedTestSurveys_() {
  if (liveRows_('조사').length) throw userError_('조사 탭에 이미 조사가 있어요. 가짜 조사는 빈 테스트 시트에만 넣을 수 있어요.');
  var staff = sortStaff_(activeStaff_());
  if (staff.length < 3) throw userError_('먼저 "테스트용 가짜 데이터 넣기"로 가짜 교직원을 넣어 주세요.');
  var dept = {};
  liveRows_('분류').forEach(function (c) { if (c['종류'] === '부서') dept[c['이름']] = c['분류ID']; });
  var owner = { id: staff[0]['교직원ID'], name: staff[0]['이름'] };
  var inDays = function (n, hm) { return addDays_(todayYmd_(), n) + ' ' + hm; };
  ensureCols_('조사');
  var s1 = insertRow_('조사', {
    '제목': '교직원 체육대회 참가 신청', '설명': '참가할 종목을 하나 골라 주세요.', '부서ID': dept['교무부'] || '',
    '대상': JSON.stringify({ type: 'all' }), '마감 일시': inDays(2, '17:00'), '상태': '진행 중',
    '질문': JSON.stringify([
      { id: 'q1', type: 'one', title: '참가할 종목을 골라 주세요', required: true, options: ['피구', '배드민턴', '줄다리기', '응원만 할게요'] },
      { id: 'q2', type: 'many', title: '도와줄 수 있는 일(여러 개)', required: false, options: ['준비물 챙기기', '사진 찍기', '정리하기'] }
    ]),
    '메신저 문구': '', '결과 공개': '예'
  }, owner, '가짜 조사');
  var s2 = insertRow_('조사', {
    '제목': '교실 물품 구입 희망 조사', '설명': '', '부서ID': dept['정보부'] || dept['정보과학부'] || '',
    '대상': JSON.stringify({ type: 'all' }), '마감 일시': inDays(8, '16:00'), '상태': '진행 중',
    '질문': JSON.stringify([
      { id: 'q1', type: 'short', title: '필요한 물품', required: true },
      { id: 'q2', type: 'number', title: '수량', required: true },
      { id: 'q3', type: 'date', title: '받고 싶은 날', required: false },
      { id: 'q4', type: 'long', title: '하고 싶은 말', required: false }
    ]),
    '메신저 문구': '', '결과 공개': ''
  }, owner, '가짜 조사');
  var picks = ['피구', '배드민턴', '줄다리기'];
  staff.slice(1, 4).forEach(function (r, i) {
    insertRow_('응답', { '조사ID': s1['조사ID'], '교직원ID': r['교직원ID'], '답': JSON.stringify({ q1: picks[i], q2: i ? ['정리하기'] : [] }), '하고 싶은 말': '', '낸 시각': nowText_() }, { id: r['교직원ID'], name: r['이름'] }, '가짜 응답');
  });
  insertRow_('응답', { '조사ID': s2['조사ID'], '교직원ID': staff[1]['교직원ID'], '답': JSON.stringify({ q1: '보드마커', q2: '12' }), '하고 싶은 말': '', '낸 시각': nowText_() }, { id: staff[1]['교직원ID'], name: staff[1]['이름'] }, '가짜 응답');
  return 2;
}
