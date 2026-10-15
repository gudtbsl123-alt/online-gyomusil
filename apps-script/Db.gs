/**
 * Db.gs — 전용 시트를 표처럼 읽고 쓰는 곳
 *
 * 원칙
 * - 탭 하나가 표 하나, 1행은 머리글. 값은 모두 글자로 저장한다(앞자리 0, 날짜 자동 변환 막기 → cellWrite_).
 * - 지우지 않는다: 삭제는 '삭제 여부' 칸에 표시만 하고, 관리자가 되살릴 수 있다.
 * - 고칠 때마다 '기록' 탭에 언제·누가·무엇을, 바뀌기 전·바뀐 뒤 내용까지 남긴다.
 * - 시트에 쓸 때는 잠금(LockService)을 걸어 동시에 저장해도 꼬이지 않게 한다.
 */

/** 모든 표(기록·설정 제외)에 붙는 입력·수정·삭제 칸 */
function auditCols_() {
  return ['입력자ID', '입력 시각', '수정자ID', '수정 시각', '삭제 여부'];
}

/** 시트 탭 구조. 첫 칸이 ID다(설정·기록은 예외). 순서를 바꾸지 말고, 새 칸은 끝에 더한다. */
function tabs_() {
  var A = auditCols_();
  return {
    '설정': ['키', '값', '설명'],
    '분류': ['분류ID', '종류', '이름', '순서', '사용 여부'].concat(A),
    '교직원': ['교직원ID', '이름', '직위', '소속', '부서ID', '담당 업무', '내선', '역할', '사용 여부', '순서',
      '개인번호해시', '솔트', '틀린 횟수', '잠금 해제 시각', '번호 바꾼 날'].concat(A),
    '일정': ['일정ID', '시작일', '끝일', '시간', '행사명', '대상 학년', '담당 부서ID', '장소', '구분', '메모',
      '올린 묶음ID'].concat(A).concat(['중요']),
    '월별중점': ['중점ID', '학년도', '월', '중점지도 내용'].concat(A),
    '조사': ['조사ID', '제목', '부서ID', '대상', '마감 일시', '상태', '질문', '메신저 문구'].concat(A).concat(['설명', '결과 공개']),
    '응답': ['응답ID', '조사ID', '교직원ID', '답', '하고 싶은 말', '낸 시각', '고친 시각'].concat(A),
    '알림': ['알림ID', '조사ID', '대상 교직원ID', '알린 시각'].concat(A),
    '자료': ['자료ID', '학년도', '분류ID', '부서ID', '제목', '설명', '링크', '파일ID', '담당', '보관 여부'].concat(A)
      .concat(['파일 이름', '파일 크기', '홈에 보이기', '원본 자료ID', '공통', '공통 순서']),
    '도움말': ['항목ID', '분류ID', '제목', '내용', '링크', '순서'].concat(A).concat(['파일ID', '파일 이름', '파일 크기']),
    '공지': ['공지ID', '제목', '내용', '링크', '부서ID', '게시 끝일', '고정'].concat(A),
    '기록': ['시각', '교직원ID', '이름', '탭', '대상ID', '동작', '요약', '바뀌기 전', '바뀐 뒤']
  };
}

/** ID 앞글자 */
function idPrefix_(tab) {
  return { '분류': 'C', '교직원': 'T', '일정': 'E', '월별중점': 'F', '조사': 'S', '응답': 'R', '알림': 'N', '자료': 'D', '도움말': 'H', '공지': 'G' }[tab] || 'X';
}

/** 기록에 남기지 않는 칸(개인 번호 해시 등) */
function secretCols_() {
  return ['개인번호해시', '솔트'];
}

/** 화면에 내보내지 않는 칸 */
function hiddenCols_() {
  return ['개인번호해시', '솔트'];
}

// ---------------------------------------------------------------- 시트 열기

var DB_SS_ = null; // 한 번 실행하는 동안만 쓰는 캐시

function ss_() {
  if (DB_SS_) return DB_SS_;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) {
    DB_SS_ = SpreadsheetApp.openById(id);
  } else {
    DB_SS_ = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!DB_SS_) throw userError_('아직 처음 설정이 되지 않았어요. 연구부장·부담당에게 알려 주세요.', 'SETUP');
  return DB_SS_;
}

function sheet_(tab) {
  var sh = ss_().getSheetByName(tab);
  if (!sh) throw userError_('시트에 "' + tab + '" 탭이 없어요. 관리자가 시트 메뉴에서 "처음 설정"을 먼저 해 주세요.', 'SETUP');
  return sh;
}

// ---------------------------------------------------------------- 값 다루기

/** 시트에서 읽은 값을 글자로 */
function cellText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    return Utilities.formatDate(v, tz_(), hasTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  }
  return String(v);
}

/**
 * 시트에 쓸 값. 모두 글자로 남긴다.
 * 빈칸이 아니면 늘 앞에 ' 를 붙여, 시트가 수식(=…)·숫자(0101, 1e3)·날짜(2026-03-02, 3-1)로 바꾸지 못하게 한다.
 * 시트에서 ' 는 보이지 않고, 읽을 때도 빠진다.
 */
function cellWrite_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (s === '') return '';
  return "'" + s;
}

function tz_() {
  return 'Asia/Seoul';
}

function nowText_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

// ---------------------------------------------------------------- 읽기

/** 표 전체를 [{머리글: 값, _row: 행 번호}] 로 읽는다 */
function readRows_(tab) {
  var sh = sheet_(tab);
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(cellText_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 };
    var empty = true;
    for (var j = 0; j < head.length; j++) {
      if (!head[j]) continue;
      o[head[j]] = cellText_(vals[i][j]);
      if (o[head[j]] !== '') empty = false;
    }
    if (!empty) rows.push(o);
  }
  return rows;
}

/** 삭제 표시가 없는 행만 */
function liveRows_(tab) {
  return readRows_(tab).filter(function (r) { return !r['삭제 여부']; });
}

function findRow_(tab, id) {
  var key = tabs_()[tab][0];
  var rows = readRows_(tab);
  for (var i = 0; i < rows.length; i++) if (rows[i][key] === id) return rows[i];
  return null;
}

/** 화면에 보낼 때 숨길 칸을 뺀다 */
function publicRow_(r) {
  var o = {};
  var hide = hiddenCols_();
  Object.keys(r).forEach(function (k) {
    if (k === '_row' || hide.indexOf(k) >= 0) return;
    o[k] = r[k];
  });
  return o;
}

// ---------------------------------------------------------------- 쓰기 (모두 잠금 안에서)

var DB_LOCK_DEPTH_ = 0;

function withLock_(fn) {
  if (DB_LOCK_DEPTH_ > 0) return fn(); // 이미 잠금 안이면 그대로
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('다른 분이 저장하는 중이에요. 잠시 뒤에 다시 눌러 주세요.', 'BUSY');
  DB_LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    DB_LOCK_DEPTH_--;
    lock.releaseLock();
  }
}

function headOf_(tab) {
  var sh = sheet_(tab);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(cellText_);
}

/** 나중에 더한 칸이 시트에 없으면 머리글 끝에 붙인다(있는 데이터는 그대로) */
function ensureCols_(tab) {
  withLock_(function () {
    var head = headOf_(tab);
    var missing = tabs_()[tab].filter(function (h) { return head.indexOf(h) < 0; });
    if (!missing.length) return;
    sheet_(tab).getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  });
}

function newId_(tab) {
  var key = tabs_()[tab][0];
  var used = {};
  readRows_(tab).forEach(function (r) { used[r[key]] = true; });
  for (var n = 0; n < 20; n++) {
    var id = idPrefix_(tab) + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    if (!used[id]) return id;
  }
  throw new Error('ID를 만들지 못했어요');
}

/**
 * 새 행 넣기. actor = {id, name}
 * 돌려주는 값: 넣은 행(숨김 칸 제외)
 */
function insertRow_(tab, obj, actor, summary) {
  return withLock_(function () {
    var head = headOf_(tab);
    var key = head[0];
    var rec = {};
    head.forEach(function (h) { if (obj[h] !== undefined) rec[h] = String(obj[h]); });
    rec[key] = newId_(tab);
    rec['입력자ID'] = actor.id || '';
    rec['입력 시각'] = nowText_();
    rec['수정자ID'] = '';
    rec['수정 시각'] = '';
    rec['삭제 여부'] = '';
    sheet_(tab).appendRow(head.map(function (h) { return cellWrite_(rec[h]); }));
    writeLog_(actor, tab, rec[key], '추가', summary || '', null, auditView_(rec));
    return publicRow_(rec);
  });
}

/**
 * 여러 줄을 한 번에 넣기(다시 알리기처럼 수십 줄을 쓸 때). 기록은 한 줄로 남긴다.
 * keepAudit: true면 obj의 입력자ID·입력 시각·수정자ID·수정 시각을 그대로 둔다
 *   (새 학년도로 옮긴 자료를 처음 넣은 분이 계속 고칠 수 있고, 수정일도 그대로 보이게. 옮긴 일은 기록 탭에 남는다)
 */
function insertRows_(tab, list, actor, summary, keepAudit) {
  if (!list.length) return [];
  return withLock_(function () {
    var head = headOf_(tab);
    var key = head[0];
    var used = {};
    readRows_(tab).forEach(function (r) { used[r[key]] = true; });
    var now = nowText_();
    var recs = list.map(function (obj) {
      var rec = {};
      head.forEach(function (h) { if (obj[h] !== undefined) rec[h] = String(obj[h]); });
      var id;
      do { id = idPrefix_(tab) + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); } while (used[id]);
      used[id] = true;
      rec[key] = id;
      rec['입력자ID'] = actor.id || '';
      rec['입력 시각'] = now;
      rec['수정자ID'] = '';
      rec['수정 시각'] = '';
      if (keepAudit) ['입력자ID', '입력 시각', '수정자ID', '수정 시각'].forEach(function (h) { if (obj[h]) rec[h] = String(obj[h]); });
      rec['삭제 여부'] = '';
      return rec;
    });
    var sh = sheet_(tab);
    sh.getRange(sh.getLastRow() + 1, 1, recs.length, head.length)
      .setValues(recs.map(function (rec) { return head.map(function (h) { return cellWrite_(rec[h]); }); }));
    writeLog_(actor, tab, '', '추가', summary || (recs.length + '줄 추가'), null, { '줄 수': String(recs.length) });
    return recs.map(publicRow_);
  });
}

/**
 * 행 고치기. patch에 있는 칸만 바꾼다(ID·입력 칸은 못 바꿈).
 * 바뀐 칸이 없으면 기록을 남기지 않는다.
 */
function updateRow_(tab, id, patch, actor, summary, action) {
  return withLock_(function () {
    var row = findRow_(tab, id);
    if (!row) throw userError_('고칠 항목을 찾지 못했어요. 화면을 새로 고쳐 주세요.', 'NOTFOUND');
    var head = headOf_(tab);
    var raw = sheet_(tab).getRange(row._row, 1, 1, head.length).getValues()[0]; // 머리글 없는 칸은 손대지 않으려고
    var locked = [head[0], '입력자ID', '입력 시각', '수정자ID', '수정 시각'];
    var before = {}, after = {}, changed = false;
    var next = {};
    head.forEach(function (h) { next[h] = row[h] === undefined ? '' : row[h]; });
    Object.keys(patch).forEach(function (h) {
      if (head.indexOf(h) < 0 || locked.indexOf(h) >= 0) return;
      var v = patch[h] === null || patch[h] === undefined ? '' : String(patch[h]);
      if (next[h] !== v) {
        before[h] = next[h];
        after[h] = v;
        next[h] = v;
        changed = true;
      }
    });
    if (!changed) return publicRow_(row);
    next['수정자ID'] = actor.id || '';
    next['수정 시각'] = nowText_();
    sheet_(tab).getRange(row._row, 1, 1, head.length)
      .setValues([head.map(function (h, j) { return h ? cellWrite_(next[h]) : raw[j]; })]);
    writeLog_(actor, tab, id, action || '수정', summary || '', auditView_(before), auditView_(after));
    next._row = row._row;
    return publicRow_(next);
  });
}

/**
 * 여러 줄에 같은 값을 한 번에 쓰기(새 학년도 보관, 학사일정 올리기의 바꾸기·되돌리기). 기록은 한 줄로 남긴다.
 * 바뀌기 전 값과 ID 목록을 기록에 남겨 되돌릴 수 있게 한다.
 * 보관처럼 내용을 고친 것이 아니면 수정일은 그대로 두고, 숨기기·되살리기('삭제 여부')면 수정자·수정 시각을 남긴다.
 */
function updateRowsSame_(tab, ids, patch, actor, summary, action) {
  if (!ids.length) return 0;
  return withLock_(function () {
    var head = headOf_(tab);
    var key = head[0];
    var want = {};
    ids.forEach(function (id) { want[id] = true; });
    var sh = sheet_(tab);
    var n = 0, before = {};
    var deleting = '삭제 여부' in patch; // 숨기기·되살리기는 누가 했는지 수정자 칸에 남긴다(휴지통에 보이게)
    var now = nowText_();
    readRows_(tab).forEach(function (row) {
      if (!want[row[key]]) return;
      var next = {};
      head.forEach(function (h) { next[h] = row[h] === undefined ? '' : row[h]; });
      Object.keys(patch).forEach(function (h) {
        if (head.indexOf(h) >= 0) { before[h] = before[h] || {}; before[h][row[key]] = next[h]; next[h] = String(patch[h]); }
      });
      if (deleting) { next['수정자ID'] = actor.id || ''; next['수정 시각'] = now; }
      var raw = sh.getRange(row._row, 1, 1, head.length).getValues()[0];
      sh.getRange(row._row, 1, 1, head.length).setValues([head.map(function (h, j) { return h ? cellWrite_(next[h]) : raw[j]; })]);
      n++;
    });
    var after = {};
    Object.keys(patch).forEach(function (h) { after[h] = String(patch[h]); });
    after['ID 목록'] = ids.join(',');
    writeLog_(actor, tab, '', action || '수정', summary || (n + '줄 고침'), before, after);
    return n;
  });
}

/** 지우기 = 숨김 표시. 되살릴 수 있다. */
function softDelete_(tab, id, actor, summary) {
  return updateRow_(tab, id, { '삭제 여부': '삭제' }, actor, summary, '삭제');
}

function restoreRow_(tab, id, actor, summary) {
  return updateRow_(tab, id, { '삭제 여부': '' }, actor, summary, '되살리기');
}

/**
 * 기록을 남기지 않고 칸만 바꾼다. 틀린 횟수처럼 보안용 숫자에만 쓴다.
 * 반드시 withLock_ 안에서 부른다.
 */
function setCellsNoLog_(tab, row, patch) {
  var head = headOf_(tab);
  var sh = sheet_(tab);
  Object.keys(patch).forEach(function (h) {
    var c = head.indexOf(h);
    if (c < 0) return;
    sh.getRange(row._row, c + 1).setValue(cellWrite_(patch[h]));
    row[h] = String(patch[h]);
  });
}

// ---------------------------------------------------------------- 기록

function auditView_(rec) {
  if (!rec) return null;
  var o = {};
  var secret = secretCols_();
  Object.keys(rec).forEach(function (k) {
    if (k === '_row') return;
    o[k] = secret.indexOf(k) >= 0 ? '(비공개)' : rec[k];
  });
  return o;
}

function writeLog_(actor, tab, id, action, summary, before, after) {
  var sh = sheet_('기록');
  sh.appendRow([
    nowText_(),
    actor.id || '',
    actor.name || '',
    tab,
    id || '',
    action,
    summary || '',
    before ? JSON.stringify(before) : '',
    after ? JSON.stringify(after) : ''
  ].map(cellWrite_));
}

// ---------------------------------------------------------------- 오류

/** 사용자에게 그대로 보여 줄 오류 */
function userError_(msg, code) {
  var e = new Error(msg);
  e.userMessage = msg;
  e.code = code || 'USER';
  return e;
}

/** 글자 길이 확인 */
function cleanText_(v, max, label, required) {
  var s = v === null || v === undefined ? '' : String(v).trim();
  if (required && !s) throw userError_(label + josa_(label, '을', '를') + ' 적어 주세요.');
  if (s.length > max) throw userError_(label + josa_(label, '은', '는') + ' ' + max + '자까지 적을 수 있어요.');
  return s;
}

/** 받침에 맞는 조사 */
function josa_(word, withBatchim, without) {
  var c = String(word).charCodeAt(String(word).length - 1);
  if (c < 0xAC00 || c > 0xD7A3) return withBatchim + '(' + without + ')';
  return (c - 0xAC00) % 28 ? withBatchim : without;
}
