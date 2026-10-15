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
 *   Setup.gs  시트 메뉴, 처음 설정, 매일 백업, 테스트 데이터
 *   Index.html / Styles.html / App.html  화면
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('온라인 교무실')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Index.html 안에서 다른 HTML 파일을 끼워 넣을 때 쓴다 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** 이 코드 묶음의 판(버전). 파일마다 fileMark_○○_()가 같은 판을 돌려주는지 관리자 › 점검에서 확인한다 */
var APP_BUILD_ = '2026-10-16';
function fileMark_Code_() { return '2026-10-16'; }

/**
 * 요청 목록
 * need: 'public'(누구나) | 'login'(공통 로그인) | 'identity'(본인 확인까지) | 'admin'(관리자)
 * fn: 처리 함수 이름(글자). 부를 때 찾으므로, 파일 하나가 빠져도 그 기능만 멈추고 나머지는 돌아간다
 */
function routes_() {
  return {
    'start': { need: 'public', fn: 'apiStart_' },
    'login': { need: 'public', fn: function (a) { return login_(a); } },
    'session': { need: 'login', fn: 'apiSession_' },
    'staffPicker': { need: 'login', fn: function () { return staffPicker_(); } },
    'verify': { need: 'login', fn: function (a) { return verifyPin_(a); } },
    'adminLogin': { need: 'login', fn: function (a) { return adminLogin_(a); } },

    'home': { need: 'login', fn: 'apiHome_' },
    'sched.month': { need: 'login', fn: 'apiSchedMonth_' },
    'sched.year': { need: 'login', fn: 'apiSchedYear_' },
    'sched.save': { need: 'identity', fn: 'apiSchedSave_' },
    'sched.delete': { need: 'identity', fn: 'apiSchedDelete_' },
    'focus.save': { need: 'identity', fn: 'apiFocusSave_' },
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
    'help.delete': { need: 'identity', fn: 'apiHelpDelete_' },
    'staff.list': { need: 'login', fn: function () { return apiStaffDir_(); } },
    'search': { need: 'login', fn: 'apiSearch_' },
    'notice.list': { need: 'login', fn: 'apiNoticeList_' },
    'notice.save': { need: 'identity', fn: 'apiNoticeSave_' },
    'notice.delete': { need: 'identity', fn: 'apiNoticeDelete_' },

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
    'admin.year.preview': { need: 'admin', fn: function () { return adminYearPreview_(); } },
    'admin.year.start': { need: 'admin', fn: 'adminYearStart_' },
    'admin.pw.common': { need: 'admin', fn: 'adminChangeCommonPw_' },
    'admin.pw.admin': { need: 'admin', fn: 'adminChangeAdminPw_' },
    'admin.check': { need: 'admin', fn: 'adminCheck_' },
    'admin.staff.importCheck': { need: 'admin', fn: 'adminStaffImportCheck_' },
    'admin.staff.import': { need: 'admin', fn: 'adminStaffImport_' }
  };
}

/**
 * 화면에서 부르는 하나뿐인 창구. 주고받는 값은 JSON 글자다.
 * req = { action, args, tokens: { login, identity, admin } }
 */
function api(reqText) {
  SETTINGS_CACHE_ = null;
  DB_SS_ = null;
  dbReset_();
  try {
    var req = JSON.parse(String(reqText || '{}'));
    var route = routes_()[req.action];
    if (!route) throw userError_('알 수 없는 요청이에요. 화면을 새로 고쳐 주세요.');
    var fn = typeof route.fn === 'string' ? globalFn_(route.fn) : route.fn;
    if (!fn) {
      throw userError_('이 기능의 코드 파일이 빠졌거나 예전 것이에요(' + route.fn + '). 연구부장·부담당이 관리자 › 점검에서 확인해 주세요.', 'MISSING');
    }
    var t = req.tokens || {};
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
    return JSON.stringify({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    if (err && err.userMessage) return JSON.stringify({ ok: false, error: err.userMessage, code: err.code });
    console.error(err && err.stack ? err.stack : err);
    // 원인 한 줄(예: ReferenceError: ○○ is not defined)을 함께 보내 화면에 작게 보여 준다(고칠 곳을 바로 찾게)
    var detail = err && err.name ? err.name + ': ' + err.message : String(err);
    return JSON.stringify({ ok: false, error: '잠시 문제가 생겼어요. 잠깐 뒤에 다시 해 주세요. 계속 안 되면 연구부장·부담당에게 알려 주세요.', code: 'ERROR', detail: detail.slice(0, 300) });
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
  try { sheet_('교직원'); } catch (e) { ready = false; }
  return {
    school: ready ? setting_('학교명') : '인천장도초등학교',
    year: ready ? setting_('학년도') : '',
    ready: ready && hasPassword_('common'),
    rememberDays: ready ? rememberDays_() : 365,
    pinMode: ready ? pinMode_() : false
  };
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
