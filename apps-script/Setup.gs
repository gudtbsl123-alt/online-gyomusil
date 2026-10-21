/**
 * Setup.gs — 시트 메뉴, 처음 설정, 비밀번호 정하기, 매일 백업, 테스트용 가짜 데이터
 *
 * 메뉴 함수는 시트 안에서만 돌아간다(웹앱에서 부르면 requireSheetUi_()가 막는다).
 */

function fileMark_Setup_() { return '2026-10-21b'; } // 판 표시(관리자 › 점검)

/**
 * 시트를 손으로 고치면 고친 탭의 서버 기억을 버리게 한다(다음 요청은 그 탭만 시트에서 새로 읽는다).
 * 단순 트리거라 이 환경에서 되는지는 관리자 › 점검 '서버 기억'에 보인다(손으로 고친 것을 알아챈 시각, 스크립트 속성 SHEET_EDIT_AT).
 * 줄 지우기·정렬처럼 onEdit가 오지 않는 바꿈은, 화면이 뒤에서 보내는 요청이 10분 넘은 기억을 시트와 다시 맞춘다.
 * 이름이 '_'로 끝나지 않아 웹앱에서도 부를 수 있지만, 기억을 버리기만 하므로 괜찮다
 */
function onEdit(e) {
  // 웹앱(google.script.run)에서도 이 이름으로 부를 수 있다 → 시트에서 고친 칸(range)이 없으면 아무것도 하지 않는다(누구나 서버 기억을 통째로 비우지 못하게)
  if (!e || !e.range || typeof e.range.getSheet !== 'function') return;
  try {
    var tab = '';
    try { tab = e.range.getSheet().getName(); } catch (e1) { tab = ''; }
    CacheService.getScriptCache().put(tab ? 'gy:v:' + tab : 'gy:ep', Utilities.getUuid().replace(/-/g, '').slice(0, 10), 21600);
  } catch (err) { /* 무시 */ }
  try { PropertiesService.getScriptProperties().setProperty('SHEET_EDIT_AT', String(Date.now())); } catch (err2) { /* 점검 화면 표시용이라 못 남겨도 괜찮다 */ }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('온라인 교무실')
    .addItem('1. 처음 설정 (탭 만들기)', 'menuSetup')
    .addItem('2. 공통 비밀번호 정하기', 'menuCommonPassword')
    .addItem('3. 관리자 비밀번호 정하기', 'menuAdminPassword')
    .addItem('4. 매일 자동 백업 켜기', 'menuEnableBackup')
    .addSeparator()
    .addItem('지금 백업 한 번 하기', 'menuBackupNow')
    .addItem('테스트용 가짜 데이터 넣기 (테스트 시트에서만)', 'menuSeedTestData')
    .addItem('테스트용 가짜 일정 넣기 (테스트 시트에서만)', 'menuSeedTestSchedule')
    .addItem('테스트용 가짜 조사 넣기 (테스트 시트에서만)', 'menuSeedTestSurveys')
    .addItem('테스트용 가짜 자료·도움말·공지 넣기 (테스트 시트에서만)', 'menuSeedTestLibrary')
    .addToUi();
}

/** 시트 화면에서 부른 것이 아니면 멈춘다 */
function requireSheetUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    throw userError_('이 기능은 전용 시트의 "온라인 교무실" 메뉴에서만 쓸 수 있어요.');
  }
}

var SYSTEM_ACTOR_ = { id: '', name: '시트 관리자' };

// ---------------------------------------------------------------- 1. 처음 설정

function menuSetup() {
  var ui = requireSheetUi_();
  var r = setupAll_();
  ui.alert('처음 설정을 마쳤어요',
    '새로 만든 탭: ' + (r.created.length ? r.created.join(', ') : '없음') + '\n' +
    '칸을 더한 탭: ' + (r.extended.length ? r.extended.join(', ') : '없음') + '\n\n' +
    '다음 차례: 메뉴 "2. 공통 비밀번호 정하기"', ui.ButtonSet.OK);
}

/** 여러 번 눌러도 괜찮다. 있는 탭·칸·값은 그대로 두고 없는 것만 더한다. 서버 기억을 쓰지 않고 늘 시트에서 읽는다 */
function setupAll_() {
  MEMO_BYPASS_ = true; // 시트에서 손으로 줄을 지운 직후여도 옛 기억으로 판단하지 않게
  try {
    return setupAllNow_();
  } finally {
    MEMO_BYPASS_ = false;
  }
}

function setupAllNow_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var p = PropertiesService.getScriptProperties();
  p.setProperty('SHEET_ID', ss.getId());
  propsForget_();
  secretProp_('PIN_PEPPER');
  secretProp_('TOKEN_SECRET');
  DB_SS_ = ss;
  dbReset_();

  var created = [], extended = [];
  var defs = tabs_();
  Object.keys(defs).forEach(function (name) {
    var head = defs[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    }
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var cur = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(cellText_);
    var curUsed = cur.filter(function (h) { return h !== ''; });
    var missing = head.filter(function (h) { return cur.indexOf(h) < 0; });
    if (missing.length) {
      var start = curUsed.length ? cur.length + 1 : 1;
      growCols_(sh, start + missing.length - 1);
      sh.getRange(1, start, 1, missing.length).setValues([missing]);
      if (curUsed.length) extended.push(name);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#F2F4F6');
  });

  dbReset_(); // 머리글을 바꿨으니 다시 읽는다
  // 설정 기본값(없는 키만). 있는 키는 값은 그대로 두고 '설명' 칸만 지금 안내로 바꾼다
  var have = {};
  var sheet = sheet_('설정');
  var notes = {};
  settingDefs_().forEach(function (d) { notes[d.key] = d.note || d.label; });
  var noteCol = headOf_('설정').indexOf('설명') + 1; // 칸 위치는 머리글 이름으로(누가 칸을 끼워 넣어도)
  readRows_('설정').forEach(function (r) {
    have[r['키']] = true;
    if (noteCol > 0 && notes[r['키']] !== undefined && r['설명'] !== notes[r['키']]) sheet.getRange(r._row, noteCol).setValue(cellWrite_(notes[r['키']]));
  });
  settingDefs_().forEach(function (d) {
    if (!have[d.key]) sheet.appendRow(rowByHead_('설정', { '키': d.key, '값': d.def, '설명': d.note || d.label }));
  });
  SETTINGS_CACHE_ = null;
  dbReset_();
  memoClearAll_(); // 탭·칸을 바꿨으니 서버 기억을 모두 버린다
  return { created: created, extended: extended };
}

// ---------------------------------------------------------------- 2·3. 비밀번호 정하기 (가려지는 입력 창)

function menuCommonPassword() {
  requireSheetUi_();
  showPasswordDialog_('common');
}

function menuAdminPassword() {
  requireSheetUi_();
  showPasswordDialog_('admin');
}

function showPasswordDialog_(kind) {
  var title = kind === 'admin' ? '관리자 비밀번호 정하기' : '공통 비밀번호 정하기';
  var note = kind === 'admin'
    ? '관리자만 아는 비밀번호예요. 공통 비밀번호와 다르게 정해 주세요.'
    : '교직원 모두가 함께 쓰는 비밀번호예요. 바꾸면 모든 기기에서 다시 로그인해야 해요.';
  var html =
    '<div style="font:15px/1.6 -apple-system,\'Malgun Gothic\',sans-serif;color:#191F28">' +
    '<p style="margin:0 0 12px;color:#4E5968">' + note + '<br>' + AUTH_MIN_PW_ + '자 이상으로 정해 주세요. 입력한 글자는 저장되지 않고 해시로만 남아요.</p>' +
    '<label style="display:block;font-weight:700">새 비밀번호<br><input id="a" type="password" autocomplete="new-password" style="width:100%;box-sizing:border-box;height:44px;margin-top:4px;padding:0 12px;border:1px solid #D1D6DB;border-radius:10px;font-size:16px"></label>' +
    '<label style="display:block;font-weight:700;margin-top:10px">한 번 더<br><input id="b" type="password" autocomplete="new-password" style="width:100%;box-sizing:border-box;height:44px;margin-top:4px;padding:0 12px;border:1px solid #D1D6DB;border-radius:10px;font-size:16px"></label>' +
    '<p id="m" style="min-height:24px;margin:10px 0;color:#D92D20;font-weight:700"></p>' +
    '<button id="go" style="height:44px;padding:0 20px;border:0;border-radius:10px;background:#1B64DA;color:#fff;font-size:16px;font-weight:700;cursor:pointer">정하기</button>' +
    '</div><script>' +
    'document.getElementById("go").onclick=function(){var a=document.getElementById("a").value,b=document.getElementById("b").value,m=document.getElementById("m");' +
    'if(a!==b){m.textContent="두 칸이 서로 달라요.";return;}this.disabled=true;m.style.color="#4E5968";m.textContent="저장하는 중이에요…";' +
    'google.script.run.withSuccessHandler(function(r){if(r==="ok"){m.style.color="#12784A";m.textContent="정했어요. 이 창을 닫아도 돼요.";}else{m.style.color="#D92D20";m.textContent=r;document.getElementById("go").disabled=false;}})' +
    '.withFailureHandler(function(e){m.style.color="#D92D20";m.textContent=e.message;document.getElementById("go").disabled=false;})' +
    '.setPasswordFromSheet("' + kind + '",a);};' +
    '</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(360), title);
}

/** 비밀번호 창에서 부른다. 시트 화면 밖(웹앱)에서는 막힌다. */
function setPasswordFromSheet(kind, pw) {
  requireSheetUi_();
  try {
    if (kind !== 'admin' && kind !== 'common') return '알 수 없는 요청이에요.';
    if (!PropertiesService.getScriptProperties().getProperty('SHEET_ID')) return '먼저 메뉴 "1. 처음 설정"을 해 주세요.';
    setPassword_(kind, pw);
    withLock_(function () {
      writeLog_(SYSTEM_ACTOR_, '설정', '', '비밀번호 바꿈', (kind === 'admin' ? '관리자' : '공통') + ' 비밀번호를 시트 메뉴에서 정함', null, null);
    });
    return 'ok';
  } catch (e) {
    if (e.userMessage) return e.userMessage;
    throw e;
  }
}

// ---------------------------------------------------------------- 4. 매일 자동 백업

function menuEnableBackup() {
  var ui = requireSheetUi_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
  var r = backupNow_('처음 백업');
  ui.alert('매일 자동 백업을 켰어요',
    '매일 새벽 2~3시 사이에 시트 전체 사본을 "' + r.folder + '" 폴더에 저장해요.\n' +
    '최근 ' + r.keep + '개만 남기고, 오래된 사본은 드라이브 휴지통으로 옮겨요(휴지통에서 30일 동안 되살릴 수 있어요).\n\n' +
    '방금 첫 백업을 만들었어요: ' + r.name, ui.ButtonSet.OK);
}

function menuBackupNow() {
  var ui = requireSheetUi_();
  var r = backupNow_('손으로 백업');
  ui.alert('백업했어요', '"' + r.folder + '" 폴더에 ' + r.name + ' 을(를) 만들었어요.', ui.ButtonSet.OK);
}

/** 시간 트리거가 부른다. 너무 자주 불리면(1시간 안) 건너뛴다. */
/**
 * 매일 자동 백업(시간 트리거 전용). 이름이 _로 끝나지 않아 웹앱에서도 부를 수 있으므로,
 * 이 프로젝트의 진짜 dailyBackup 트리거가 부른 것(e.triggerUid가 맞을 때)만 백업한다.
 */
function dailyBackup(e) {
  var uid = e && e.triggerUid;
  var mine = uid && ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'dailyBackup' && String(t.getUniqueId()) === String(uid);
  });
  if (!mine) return;
  var p = PropertiesService.getScriptProperties();
  var last = Number(p.getProperty('LAST_BACKUP_AT') || 0);
  if (Date.now() - last < 20 * 3600 * 1000) return;
  backupNow_('매일 백업');
}

function backupNow_(why) {
  var ss = ss_();
  var folder = backupFolder_();
  var name = '온라인 교무실 백업 ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HHmm');
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_AT', String(Date.now()));

  var keep = Math.max(3, Number(setting_('백업 남길 개수')) || 30);
  var files = [];
  var it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  var trashed = 0;
  files.slice(keep).forEach(function (f) { f.setTrashed(true); trashed++; });

  withLock_(function () {
    writeLog_({ id: '', name: '자동 백업' }, '설정', '', '백업', why + ': ' + name + (trashed ? ' (오래된 사본 ' + trashed + '개 휴지통으로)' : ''), null, null);
  });
  return { name: name, folder: folder.getName(), keep: keep };
}

function backupFolder_() {
  var id = setting_('백업 폴더ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* 폴더가 없어졌으면 새로 만든다 */ }
  }
  var folder = DriveApp.createFolder('온라인 교무실 백업');
  putSetting_('백업 폴더ID', folder.getId(), { id: '', name: '자동 백업' });
  return folder;
}

// ---------------------------------------------------------------- 테스트용 가짜 데이터

function menuSeedTestData() {
  var ui = requireSheetUi_();
  var ok = ui.alert('테스트용 가짜 데이터',
    '테스트용 시트에서만 쓰세요. 진짜 전용 시트에는 넣지 마세요.\n가짜 부서·분류와 가짜 교직원 8명(홍길동 등)을 넣어요.\n\n넣을까요?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var list = seedTestData_();
  if (!pinMode_()) {
    ui.alert('가짜 데이터를 넣었어요', '가짜 부서·분류와 교직원 8명(홍길동 등)을 넣었어요.\n지금은 본인 확인 방식이 \'이름만\'이라 개인 번호 없이 이름만 고르면 돼요.', ui.ButtonSet.OK);
    return;
  }
  var rows = list.map(function (x) {
    return '<tr><td style="padding:4px 12px 4px 0">' + x.name + '</td><td style="padding:4px 12px 4px 0;color:#4E5968">' + x.group +
      '</td><td style="font:700 18px/1 monospace;letter-spacing:.15em">' + x.pin + '</td></tr>';
  }).join('');
  var html = '<div style="font:15px/1.6 -apple-system,\'Malgun Gothic\',sans-serif">' +
    '<p style="margin:0 0 8px">가짜 교직원의 개인 번호예요. 이 창을 닫으면 다시 볼 수 없어요(필요하면 관리자 화면에서 새로 만들 수 있어요).</p>' +
    '<table style="border-collapse:collapse">' + rows + '</table></div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(380).setHeight(420), '가짜 교직원 개인 번호');
}

function menuSeedTestSchedule() {
  var ui = requireSheetUi_();
  var ok = ui.alert('테스트용 가짜 일정',
    '테스트용 시트에서만 쓰세요. 이번 주부터 한 달 동안 가짜 일정 16개와 이달 중점지도를 넣어요.\n("테스트 공휴일", "테스트 재량휴업일"도 들어가요.)\n\n넣을까요?',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var n = seedTestSchedule_();
  ui.alert('가짜 일정을 넣었어요', '일정 ' + n + '개와 이달 중점지도를 넣었어요. 웹앱의 홈과 일정 화면에서 확인해 보세요.\n수업일수를 보려면 설정 탭(또는 관리자 화면 > 설정)에 학기 기간을 넣어 주세요.', ui.ButtonSet.OK);
}

function menuSeedTestSurveys() {
  var ui = requireSheetUi_();
  var ok = ui.alert('테스트용 가짜 조사', '테스트용 시트에서만 쓰세요. 가짜 조사 2개(체육대회 참가 신청, 물품 구입 희망)와 가짜 응답 몇 개를 넣어요.\n\n넣을까요?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  seedTestSurveys_();
  ui.alert('가짜 조사를 넣었어요', '웹앱의 조사·신청 화면과 홈 \'내가 할 일\'에서 확인해 보세요.', ui.ButtonSet.OK);
}

function menuSeedTestLibrary() {
  var ui = requireSheetUi_();
  var ok = ui.alert('테스트용 가짜 자료·도움말', '테스트용 시트에서만 쓰세요. 가짜 자료 10개(공통 자료 3개, 파일 3개는 "온라인 교무실 자료" 드라이브 폴더에 만들어요)와 예시 도움말 3개, 가짜 공지 3개를 넣어요.\n\n넣을까요?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  seedTestLibrary_();
  seedTestNotices_();
  ui.alert('가짜 자료를 넣었어요', '웹앱의 자료실·도움말·공지와 홈 검색창에서 확인해 보세요.', ui.ButtonSet.OK);
}

/** 가짜 데이터. 실제 교직원 이름은 쓰지 않는다. */
function seedTestData_(fixedPin) {
  if (liveRows_('교직원').length) throw userError_('교직원 탭에 이미 사람이 있어요. 가짜 데이터는 빈 테스트 시트에만 넣을 수 있어요.');
  var actor = { id: '', name: '테스트 데이터' };
  var dept = {};
  ['교무부', '연구부', '정보부', '인성안전부'].forEach(function (n, i) {
    dept[n] = insertRow_('분류', { '종류': '부서', '이름': n, '순서': String(i + 1), '사용 여부': '사용' }, actor, '가짜 부서')['분류ID'];
  });
  ['업무 자료', '양식', '연수 자료'].forEach(function (n, i) {
    insertRow_('분류', { '종류': '자료 분류', '이름': n, '순서': String(i + 1), '사용 여부': '사용' }, actor, '가짜 분류');
  });
  ['복무·인사', '학교 규칙·제규정'].forEach(function (n, i) {
    insertRow_('분류', { '종류': '도움말 분류', '이름': n, '순서': String(i + 1), '사용 여부': '사용' }, actor, '가짜 분류');
  });
  var people = [
    ['홍길동', '교사', '3학년 1반', '연구부', '연구부장 · 교육과정', '101', '관리'],
    ['성춘향', '교사', '3학년 2반', '연구부', '전문적학습공동체', '102', '관리'],
    ['이몽룡', '교사', '4학년 1반', '교무부', '교무부장 · 학적', '103', '일반'],
    ['심청', '교사', '5학년 1반', '정보부', '정보부장 · 태블릿', '104', '일반'],
    ['흥부', '교사', '6학년 2반', '인성안전부', '인성안전부장 · 학교폭력 예방', '105', '일반'],
    ['놀부', '교사', '과학 전담', '정보부', '정보화기기', '106', '일반'],
    ['장화', '교사', '2학년 1반', '교무부', '2학년 부장', '108', '일반'],
    ['홍련', '교사', '1학년 1반', '교무부', '방과후', '107', '일반']
  ];
  var out = [];
  withLock_(function () {
    people.forEach(function (x, i) {
      var added = insertRow_('교직원', {
        '이름': x[0], '직위': x[1], '소속': x[2], '부서ID': dept[x[3]], '담당 업무': x[4], '내선': x[5],
        '역할': x[6], '사용 여부': '사용', '순서': String(i + 1), '틀린 횟수': '0'
      }, actor, '가짜 교직원');
      var row = findRow_('교직원', added['교직원ID']);
      var pin = fixedPin ? setPinForTest_(row, fixedPin) : assignPin_(row, actor);
      out.push({ name: x[0], group: x[2], pin: pin });
    });
  });
  return out;
}

/** 미리보기·자동 시험에서만 쓰는 고정 번호 */
function setPinForTest_(row, pin) {
  var salt = Utilities.getUuid();
  setCellsNoLog_('교직원', row, { '개인번호해시': pinHash_(pin, salt), '솔트': salt, '틀린 횟수': '0', '잠금 해제 시각': '', '번호 바꾼 날': String(Date.now()) });
  return pin;
}
