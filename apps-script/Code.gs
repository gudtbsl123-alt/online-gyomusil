/**
 * 인천장도초등학교 온라인 교무실 — Apps Script 웹앱
 *
 * Code.gs — 웹앱 시작과 화면→서버 요청 창구
 * 화면은 api() 하나로만 서버를 부른다. 요청마다 로그인·본인 확인·관리자 표를 확인한다.
 *
 * 파일
 *   Code.gs   시작, 요청 창구
 *   Db.gs     시트 읽기·쓰기, 기록, 잠금
 *   Auth.gs   비밀번호, 개인 번호, 로그인 표
 *   Admin.gs  설정, 분류, 교직원 표, 수정 기록
 *   Schedule.gs  일정(달력·연간 학사일정·월별 계획·홈), 수업일수, 휴지통, 학사일정 한 번에 올리기
 *   Survey.gs  조사·신청(만들기, 응답, 제출 현황, 다시 알리기, 요약, CSV)
 *   Library.gs  자료실(자료 카드, 파일 올리기·내려받기), 새 학년도 넘기기
 *   Help.gs   도움말, 교직원 명단, 홈 검색, 공지
 *   Table.gs  취합 시트(예전 이름 '함께 쓰는 표'. 구글 시트처럼 여럿이 함께 채우는 표: 붙여 넣기, 칸 고치기, 10초마다 새로 받기, 시트 양식)
 *   Setup.gs  시트 메뉴, 처음 설정, 매일 백업, 테스트 데이터
 *   Index.html / Styles.html / App.html  화면
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('온라인 교무실')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Index.html 안에서 다른 HTML 파일을 끼워 넣을 때 쓴다. 파일이 없으면(아직 붙여 넣지 않은 새 파일) 빈칸으로 두고 나머지 화면은 그대로 연다 */
function include(name) {
  try {
    return HtmlService.createHtmlOutputFromFile(name).getContent();
  } catch (e) {
    if (name === 'TableUi') return '<script>window.__gyTableUiMissing = true;</script>'; // 취합 시트 화면 파일이 없음 → 그 화면만 안내
    throw e;
  }
}

/**
 * 취합 시트 화면 파일(TableUi.html)을 언제 받을지(판 2026-10-19a, 교사 결정 45). 기본은 그 화면을 처음 열 때 받는다(첫 화면이 가벼워짐, ui.table).
 * 실제 웹앱에서 취합 시트가 열리지 않으면 관리자 › 설정 '취합 시트 화면 파일'을 '처음에 함께'로 바꿔 예전처럼 쓴다(스크립트 속성 TABLE_UI_INLINE='1').
 * Index.html이 부른다(시트를 열지 않고 속성 한 칸만 읽는다): 처음에 함께면 파일 내용, 아니면 '나중에 받기' 표시만
 */
function tableUiTag_() {
  var inline = false;
  try { inline = props_().getProperty('TABLE_UI_INLINE') === '1'; } catch (e) { inline = false; }
  return inline ? include('TableUi') : '<script>window.__gyTableUiLazy = true;</script>';
}
/** 화면이 취합 시트를 처음 열 때 받는다: { html } (파일이 없으면 { missing: true }, 화면은 그 화면만 안내) */
function apiUiTable_() {
  try {
    return { html: HtmlService.createHtmlOutputFromFile('TableUi').getContent() };
  } catch (e) {
    return { missing: true };
  }
}
/** 서버에 있는 TableUi.html의 판(관리자 › 점검: 나중에 받는 화면이라 화면이 아직 모를 때). 파일이 없으면 null, 판 표시가 없으면 '' */
function tableUiFileBuild_() {
  try {
    var m = /window\.__gyTableUiBuild = '([^']+)'/.exec(HtmlService.createHtmlOutputFromFile('TableUi').getContent());
    return m ? m[1] : '';
  } catch (e) {
    return null;
  }
}

/** 이 코드 묶음의 판(버전). 가장 최근에 고친 판이다 */
var APP_BUILD_ = '2026-10-21d';
function fileMark_Code_() { return '2026-10-21d'; }

/**
 * 파일마다 있어야 할 판. 관리자 › 점검이 각 파일의 판 표시(fileMark_○○_, App·Styles·Index의 판)와 견준다.
 * 파일을 고치면 그 파일의 판 표시와 여기 판을 함께 올린다 → 고친 파일만 다시 붙여 넣으면 된다.
 */
function fileBuilds_() {
  return {
    'Code': '2026-10-21d', 'Db': '2026-10-21b', 'Auth': '2026-10-21b', 'Admin': '2026-10-19a', 'Schedule': '2026-10-21b',
    'Survey': '2026-10-21b', 'Library': '2026-10-21b', 'Help': '2026-10-21b', 'Setup': '2026-10-21b', 'Table': '2026-10-21b',
    'App': '2026-10-21d', 'Styles': '2026-10-21d', 'Index': '2026-10-21c', 'TableUi': '2026-10-21b'
  };
}

/**
 * 요청 목록
 * need: 'public'(누구나) | 'login'(공통 로그인) | 'identity'(본인 확인까지) | 'admin'(관리자)
 * fn: 처리 함수 이름(글자). 부를 때 찾으므로, 파일 하나가 빠져도 그 기능만 멈추고 나머지는 돌아간다
 */
function routes_() {
  return {
    'start': { need: 'public', fn: 'apiStart_' },
    'ping': { need: 'public', fn: function () { return { at: Date.now() }; } }, // 속도 재기: 시트를 읽지 않는 빈 요청
    'boot': { need: 'login', fn: 'apiBoot_' },
    'batch': { need: 'login', fn: 'apiBatch_' }, // 미리 받기: 자주 여는 화면을 한 번에
    'login': { need: 'public', fn: function (a) { return login_(a); } },
    'session': { need: 'login', fn: 'apiSession_' },
    'staffPicker': { need: 'login', fn: function () { return staffPicker_(); } },
    'verify': { need: 'login', fn: function (a) { return verifyPin_(a); } },
    'adminLogin': { need: 'login', fn: function (a, actor) { return adminLogin_(a, actor); } },

    'home': { need: 'login', fn: 'apiHome_' },
    'sched.month': { need: 'login', fn: 'apiSchedMonth_' },
    'sched.year': { need: 'login', fn: 'apiSchedYear_' },
    'sched.save': { need: 'identity', fn: 'apiSchedSave_' },
    'sched.delete': { need: 'identity', fn: 'apiSchedDelete_' },
    'sched.move': { need: 'identity', fn: 'apiSchedMove_' },
    'sched.range': { need: 'login', fn: 'apiSchedRange_' },
    'sched.saveRepeat': { need: 'identity', fn: 'apiSchedSaveRepeat_' },
    'sched.deleteRepeat': { need: 'identity', fn: 'apiSchedDeleteRepeat_' }, // 달력에서 끌어 옮기기(날짜만)
    'focus.save': { need: 'identity', fn: 'apiFocusSave_' },
    'students.save': { need: 'identity', fn: 'apiStudentsSave_' },
    'sched.upload.info': { need: 'login', fn: 'apiUploadInfo_' },
    'sched.upload.check': { need: 'login', fn: 'apiUploadCheck_' },
    'sched.upload.save': { need: 'login', fn: 'apiUploadSave_' },
    'sched.upload.undo': { need: 'login', fn: 'apiUploadUndo_' },

    'survey.list': { need: 'login', fn: 'apiSurveyList_' },
    'survey.get': { need: 'login', fn: 'apiSurveyGet_' },
    'survey.save': { need: 'identity', fn: 'apiSurveySave_' },
    'survey.setOpen': { need: 'identity', fn: 'apiSurveySetOpen_' },
    'survey.delete': { need: 'identity', fn: 'apiSurveyDelete_' },
    'survey.respond': { need: 'identity', fn: 'apiSurveyRespond_' },
    'survey.remind': { need: 'identity', fn: 'apiSurveyRemind_' },
    'survey.csv': { need: 'login', fn: 'apiSurveyCsv_' },

    'lib.list': { need: 'login', fn: 'apiLibList_' },
    'lib.save': { need: 'identity', fn: 'apiLibSave_' },
    'lib.delete': { need: 'identity', fn: 'apiLibDelete_' },
    'lib.unarchive': { need: 'identity', fn: 'apiLibUnarchive_' },
    'file.get': { need: 'login', fn: 'apiFileGet_' },
    'help.list': { need: 'login', fn: 'apiHelpList_' },
    'help.save': { need: 'identity', fn: 'apiHelpSave_' },
    'help.seedSafety': { need: 'admin', fn: 'apiHelpSeedSafety_' },
    'help.delete': { need: 'identity', fn: 'apiHelpDelete_' },
    'staff.list': { need: 'login', fn: function () { return apiStaffDir_(); } },
    'search': { need: 'login', fn: 'apiSearch_' },
    'shortcut.url': { need: 'login', fn: 'apiShortcutUrl_' }, // 바탕화면 바로가기 파일에 넣을 웹앱 주소(운영 안내서)
    'ui.table': { need: 'login', fn: 'apiUiTable_' }, // 취합 시트 화면 파일(그 화면을 처음 열 때 받는다)
    'notice.list': { need: 'login', fn: 'apiNoticeList_' },
    'notice.save': { need: 'identity', fn: 'apiNoticeSave_' },
    'notice.delete': { need: 'identity', fn: 'apiNoticeDelete_' },

    'table.list': { need: 'login', fn: 'apiTableList_' },
    'table.get': { need: 'login', fn: 'apiTableGet_' },
    'table.poll': { need: 'login', fn: 'apiTablePoll_' }, // 표를 보는 동안 10초마다 바뀐 줄만
    'table.find': { need: 'login', fn: 'apiTableFind_' }, // 찾기: 시트마다 찾은 칸 수
    'table.create': { need: 'identity', fn: 'apiTableCreate_' },
    'table.cell': { need: 'identity', fn: 'apiTableCell_' },
    'table.cells': { need: 'identity', fn: 'apiTableCells_' },
    'table.row.add': { need: 'identity', fn: 'apiTableRowAdd_' },
    'table.row.delete': { need: 'identity', fn: 'apiTableRowDelete_' },
    'table.cols': { need: 'identity', fn: 'apiTableCols_' },
    'table.save': { need: 'identity', fn: 'apiTableSave_' },
    'table.setOpen': { need: 'identity', fn: 'apiTableSetOpen_' },
    'table.delete': { need: 'identity', fn: 'apiTableDelete_' },
    'table.colw': { need: 'identity', fn: 'apiTableColw_' },   // 열 너비
    'table.rowh': { need: 'identity', fn: 'apiTableRowh_' },   // 줄 높이
    'table.view': { need: 'identity', fn: 'apiTableView_' },   // 왼쪽 열 고정·줄 간격
    'table.sheet.add': { need: 'identity', fn: 'apiTableSheetAdd_' },
    'table.sheet.save': { need: 'identity', fn: 'apiTableSheetSave_' },
    'table.sheet.move': { need: 'identity', fn: 'apiTableSheetMove_' },
    'table.sheet.copy': { need: 'identity', fn: 'apiTableSheetCopy_' },
    'table.sheet.delete': { need: 'identity', fn: 'apiTableSheetDelete_' },
    'table.tpl.list': { need: 'login', fn: 'apiTableTplList_' },        // 시트 양식 목록(기본 양식 + 우리 학교 양식)
    'table.tpl.get': { need: 'login', fn: 'apiTableTplGet_' },          // 양식 하나(만들기 창에 채운다)
    'table.tpl.save': { need: 'identity', fn: 'apiTableTplSave_' },     // 시트를 양식으로 저장(이름을 고른 누구나)
    'table.tpl.update': { need: 'identity', fn: 'apiTableTplUpdate_' }, // 양식 이름·설명(저장한 분·관리)
    'table.tpl.delete': { need: 'identity', fn: 'apiTableTplDelete_' },

    'admin.settings.get': { need: 'admin', fn: function () { return adminSettingsGet_(); } },
    'admin.settings.save': { need: 'admin', fn: 'adminSettingsSave_' },
    'admin.cat.list': { need: 'admin', fn: function () { return adminCategoryList_(); } },
    'admin.cat.save': { need: 'admin', fn: 'adminCategorySave_' },
    'admin.cat.setActive': { need: 'admin', fn: 'adminCategorySetActive_' },
    'admin.staff.list': { need: 'admin', fn: function () { return { staff: adminStaffList_(), depts: deptOptions_(), pinMode: pinMode_() }; } },
    'admin.staff.save': { need: 'admin', fn: 'adminStaffSave_' },
    'admin.staff.setActive': { need: 'admin', fn: 'adminStaffSetActive_' },
    'admin.staff.resetPin': { need: 'admin', fn: 'adminStaffResetPin_' },
    'admin.staff.issueMissing': { need: 'admin', fn: 'adminStaffIssueMissing_' },
    'admin.staff.unlock': { need: 'admin', fn: 'adminStaffUnlock_' },
    'admin.log.list': { need: 'admin', fn: 'adminLogList_' },
    'admin.trash.list': { need: 'admin', fn: function () { return adminTrashList_(); } },
    'admin.trash.restore': { need: 'admin', fn: 'adminTrashRestore_' },
    'admin.trash.surveys': { need: 'admin', fn: function () { return adminSurveyTrash_(); } },
    'admin.trash.restoreSurvey': { need: 'admin', fn: 'adminSurveyRestore_' },
    'admin.trash.library': { need: 'admin', fn: function () { return adminLibTrash_(); } },
    'admin.trash.restoreLibrary': { need: 'admin', fn: 'adminLibRestore_' },
    'admin.trash.tables': { need: 'admin', fn: 'adminTableTrash_' },
    'admin.trash.restoreTable': { need: 'admin', fn: 'adminTableRestore_' },
    'admin.year.preview': { need: 'admin', fn: function () { return adminYearPreview_(); } },
    'admin.year.check': { need: 'admin', fn: 'adminYearCheck_' },
    'admin.year.start': { need: 'admin', fn: 'adminYearStart_' },
    'admin.pw.common': { need: 'admin', fn: 'adminChangeCommonPw_' },
    'admin.pw.admin': { need: 'admin', fn: 'adminChangeAdminPw_' },
    'admin.check': { need: 'admin', fn: 'adminCheck_' },
    'admin.speed': { need: 'admin', fn: 'adminSpeed_' },
    'admin.cache.clear': { need: 'admin', fn: 'adminCacheClear_' },
    'admin.staff.importCheck': { need: 'admin', fn: 'adminStaffImportCheck_' },
    'admin.staff.import': { need: 'admin', fn: 'adminStaffImport_' }
  };
}

/**
 * 쓰기 뒤 같은 요청 안에서 이어 읽을 수 있는 화면(로그인만 있으면 되는 읽기만).
 * 저장한 다음 목록을 다시 부르느라 서버를 한 번 더 다녀오지 않게 한다(속도).
 */
var THEN_READS_ = { 'home': 1, 'session': 1, 'sched.month': 1, 'sched.year': 1, 'sched.range': 1, 'survey.list': 1, 'survey.get': 1, 'notice.list': 1, 'help.list': 1, 'lib.list': 1, 'staff.list': 1, 'table.list': 1, 'table.get': 1, 'table.tpl.list': 1 };

/**
 * 요청마다 읽는 탭(서버 기억에서 한 번에 꺼내 두기, 속도). 로그인·본인 확인에서 늘 설정·교직원·분류를 읽는다.
 * 여기 없는 탭을 읽어도 그 탭만 따로 꺼내 오니 틀리지는 않고 조금 느릴 뿐이다(시험이 목록이 맞는지 본다)
 */
var BASE_TABS_ = ['설정', '교직원', '분류'];
var ROUTE_TABS_ = {
  'start': [], 'staffPicker': [], 'staff.list': [],
  'session': ['응답', '알림', '조사', '공지'],
  'home': ['일정', '월별중점', '학생수', '응답', '알림', '조사', '자료', '공지', '도움말', '@gy:tbtodo'], // '@키': 탭이 아닌 서버 기억(취합 시트 할 일 목록, Table.gs)
  'sched.month': ['일정', '월별중점', '학기'],
  'sched.year': ['일정', '학기'],
  'sched.range': ['일정'],
  'survey.list': ['조사', '응답', '알림'],
  'survey.get': ['조사', '응답', '알림'],
  'lib.list': ['자료'],
  'notice.list': ['공지'],
  'help.list': ['도움말'],
  'table.list': ['함께표', '함께표줄'],
  'table.get': ['함께표', '함께표줄'],
  'table.poll': ['함께표'], // 바뀐 것이 없으면 작은 탭만 보고 돌아간다
  'table.find': ['함께표', '함께표줄'],
  'table.tpl.list': ['시트양식', '학기', '일정', '학생수'], // 기본 양식의 줄(방학 근무·대피 훈련 재적)
  'table.tpl.get': ['시트양식', '학기', '일정', '학생수'],
  'search': ['일정', '자료', '도움말', '공지', '조사', '응답', '알림', '함께표']
};

/** 요청이 읽을 탭 목록. boot·batch·이어 읽기(then)는 합친다 */
function routeTabs_(action, args, then) {
  var out = BASE_TABS_.slice();
  var add = function (name, a) {
    if (name === 'boot') { add('start'); add('session'); if (a && a.home) add('home'); return; }
    if (name === 'batch') {
      (a && Array.isArray(a.reads) ? a.reads : []).slice(0, 8).forEach(function (x) { if (Array.isArray(x)) add(String(x[0])); });
      return;
    }
    (ROUTE_TABS_[name] || []).forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
  };
  add(action, args);
  (Array.isArray(then) ? then : []).slice(0, 3).forEach(function (x) { if (Array.isArray(x)) add(String(x[0])); });
  return out;
}

/** 서버 기억에서 탭들을 한 번에 꺼내 둔다(Db.gs가 예전 것이면 그냥 넘어간다) */
function preloadTabs_(tabs) {
  var f = tabs && globalFn_('memoPreload_');
  if (f) f(tabs);
}

/**
 * req.then = [[읽기 이름, args], …] (max개까지, 기본 3) → [{ data } 또는 null, …]. 하나가 안 되면 그것만 null(화면이 따로 다시 부른다)
 * 로그인을 확인한 요청에서만 읽는다(로그인이 필요 없는 요청에 then을 붙여 몰래 읽지 못하게)
 */
function thenReads_(list, actor, ctx, max) {
  if (!Array.isArray(list)) return undefined;
  var routes = routes_();
  return list.slice(0, max || 3).map(function (x) {
    try {
      if (!ctx || ctx.login !== true) return null;
      var name = Array.isArray(x) ? String(x[0]) : '';
      var r = THEN_READS_[name] ? routes[name] : null;
      if (!r || r.need !== 'login') return null;
      var f = typeof r.fn === 'string' ? globalFn_(r.fn) : r.fn;
      return f ? { data: f(x[1] || {}, actor, ctx) } : null;
    } catch (e) {
      return null;
    }
  });
}

/**
 * 화면에서 부르는 하나뿐인 창구. 주고받는 값은 JSON 글자다.
 * req = { action, args, tokens: { login, identity, admin }, then: [[읽기 이름, args], …](없어도 됨) }
 */
function api(reqText) {
  SETTINGS_CACHE_ = null;
  PROP_MEMO_ = null; // 스크립트 속성(Auth.gs): 요청마다 서버 기억에서 한 번
  DB_SS_ = null;
  dbReset_();
  PERF_ = newPerf_();
  try {
    var req = JSON.parse(String(reqText || '{}'));
    MEMO_RECHECK_ = !!req.bg; // 화면이 뒤에서 보낸 요청(기다리는 사람 없음): 오래된 서버 기억은 시트와 다시 맞춘다
    var route = routes_()[req.action];
    if (!route) throw userError_('알 수 없는 요청이에요. 화면을 새로 고쳐 주세요.');
    var fn = typeof route.fn === 'string' ? globalFn_(route.fn) : route.fn;
    if (!fn) {
      throw userError_('이 기능의 코드 파일이 빠졌거나 예전 것이에요(' + route.fn + '). 관리자가 관리자 › 점검에서 확인해 주세요.', 'MISSING');
    }
    var t = req.tokens || {};
    // 읽기 요청은 읽을 탭을 모두, 그 밖(쓰기 등)은 로그인 확인에 쓰는 탭만 서버 기억에서 한 번에 꺼낸다. 빈 요청(ping)·로그인은 꺼내지 않는다
    var a = req.action;
    preloadTabs_(ROUTE_TABS_[a] || a === 'boot' || a === 'batch' ? routeTabs_(a, req.args, req.then) : (route.need === 'public' ? null : BASE_TABS_));
    var ctx = { login: false, identity: null, admin: false, tokens: t };
    if (route.need !== 'public') {
      ctx.login = checkLogin_(t.login);
      if (!ctx.login) throw userError_('다시 로그인해 주세요.', 'LOGIN');
      ctx.identity = t.identity ? checkIdentity_(t.identity) : null;
      if (route.need === 'identity' && !ctx.identity) throw userError_('먼저 이름을 고르고 개인 번호를 넣어 주세요.', 'IDENTITY');
      if (route.need === 'admin') {
        ctx.admin = checkAdmin_(t.admin);
        if (!ctx.admin) throw userError_('관리자 비밀번호를 다시 넣어 주세요.', 'ADMIN');
      }
    }
    var actor = ctx.identity
      ? { id: ctx.identity['교직원ID'], name: ctx.identity['이름'] }
      : { id: '', name: ctx.admin ? '관리자(본인 확인 전)' : '' };
    var data = fn(req.args || {}, actor, ctx);
    var out = { ok: true, data: data === undefined ? null : data };
    if (req.then && ctx.login === true) {
      preloadTabs_(routeTabs_('', null, req.then)); // 쓴 뒤라면 바뀐 판으로 다시 꺼낸다(이미 읽은 탭은 빼고)
      out.then = thenReads_(req.then, actor, ctx);
    }
    return JSON.stringify(out);
  } catch (err) {
    if (err && err.userMessage) return JSON.stringify({ ok: false, error: err.userMessage, code: err.code });
    console.error(err && err.stack ? err.stack : err);
    // 원인 한 줄(예: ReferenceError: ○○ is not defined)을 함께 보내 화면에 작게 보여 준다(고칠 곳을 바로 찾게)
    var detail = err && err.name ? err.name + ': ' + err.message : String(err);
    return JSON.stringify({ ok: false, error: '잠시 문제가 생겼어요. 잠깐 뒤에 다시 해 주세요. 계속 안 되면 관리자에게 알려 주세요.', code: 'ERROR', detail: detail.slice(0, 300) });
  }
}

/**
 * 이름으로 함수 찾기(없으면 null). 이름은 코드에 적힌 글자만 쓰고(화면에서 받은 글자는 쓰지 않음),
 * 영문·숫자·_ 만 허락한다. 미리보기(한 함수 안에 묶어 돌림)와 Apps Script 모두에서 찾을 수 있게 eval로 찾는다.
 */
function globalFn_(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) return null;
  try {
    var f = eval(name);
    return typeof f === 'function' ? f : null;
  } catch (e) {
    return null;
  }
}

function apiStart_() {
  var ready = true;
  try { headOf_('교직원'); } catch (e) { ready = false; } // 서버 기억에 있으면 시트를 열지 않는다
  return {
    school: ready ? setting_('학교명') : '인천장도초등학교',
    year: ready ? setting_('학년도') : '',
    ready: ready && hasPassword_('common'),
    rememberDays: ready ? rememberDays_() : 365,
    pinMode: ready ? pinMode_() : false
  };
}

/**
 * 바탕화면 바로가기 파일(.url)·자동 등록 파일(.bat, 판 2026-10-20a)에 넣을 웹앱 주소(판 2026-10-19a, 교사 결정). /exec로 끝나는 주소만 보내고, 아니면 ''(화면이 주소창의
 * 주소를 붙여 넣게 한다). 확인 필요: 배포가 여러 개일 때 getUrl()이 어느 배포 주소를 주는지
 */
function apiShortcutUrl_() {
  var u = '';
  try { u = String(ScriptApp.getService().getUrl() || ''); } catch (e) { u = ''; }
  return { url: /^https:\/\/script\.google\.com\/[^\s"<>]+\/exec$/.test(u) ? u : '' };
}

/** 미리 받기: 화면이 뒤에서 자주 여는 화면들을 한 번에 받아 둔다. args.reads = [[읽기 이름, args], …] (8개까지, 이어 읽기와 같은 읽기만) */
function apiBatch_(args, actor, ctx) {
  return thenReads_(args.reads, actor, ctx, 8) || [];
}

/** 처음 열기(로그인이 기억된 기기): 시작 정보·로그인 상태·홈을 한 번에. 홈은 화면이 곧바로 홈을 그릴 때만(args.home) */
function apiBoot_(args, actor, ctx) {
  var start = apiStart_();
  if (!start.ready) return { start: start };
  var out = { start: start, session: apiSession_(args, actor, ctx) };
  if (args.home) {
    var home = globalFn_('apiHome_');
    if (home) out.home = home({}, actor, ctx);
  }
  return out;
}

function apiSession_(args, actor, ctx) {
  return {
    me: ctx.identity ? meView_(ctx.identity) : null,
    todoCount: ctx.identity ? optional_('todoList_', [])(ctx).length : 0,
    admin: !!(ctx.tokens.admin && checkAdmin_(ctx.tokens.admin)),
    noticeLatest: optional_('latestNoticeAt_', '')()
  };
}

/**
 * 다른 파일의 함수를 부를 때, 그 파일이 빠졌어도 화면 전체가 멈추지 않게 대신 값을 돌려준다
 * (빠진 파일은 관리자 › 점검에 '문제'로 보인다)
 */
function optional_(name, fallback) {
  var f = globalFn_(name);
  return f || function () { return fallback; };
}

function deptOptions_() {
  return liveRows_('분류').filter(function (r) { return r['종류'] === '부서'; })
    .sort(function (a, b) { return (Number(a['순서']) || 999) - (Number(b['순서']) || 999) || a['이름'].localeCompare(b['이름'], 'ko'); })
    .map(function (r) { return { id: r['분류ID'], name: r['이름'], active: r['사용 여부'] !== '사용 안 함' }; });
}
