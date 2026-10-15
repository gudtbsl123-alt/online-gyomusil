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
 *   Schedule.gs  일정(달력·연간 학사일정·월별 계획·홈), 수업일수, 휴지통
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

/**
 * 요청 목록
 * need: 'public'(누구나) | 'login'(공통 로그인) | 'identity'(본인 확인까지) | 'admin'(관리자)
 */
function routes_() {
  return {
    'start': { need: 'public', fn: apiStart_ },
    'login': { need: 'public', fn: function (a) { return login_(a); } },
    'session': { need: 'login', fn: apiSession_ },
    'staffPicker': { need: 'login', fn: function () { return staffPicker_(); } },
    'verify': { need: 'login', fn: function (a) { return verifyPin_(a); } },
    'adminLogin': { need: 'login', fn: function (a) { return adminLogin_(a); } },

    'home': { need: 'login', fn: apiHome_ },
    'sched.month': { need: 'login', fn: apiSchedMonth_ },
    'sched.year': { need: 'login', fn: apiSchedYear_ },
    'sched.save': { need: 'identity', fn: apiSchedSave_ },
    'sched.delete': { need: 'identity', fn: apiSchedDelete_ },
    'focus.save': { need: 'identity', fn: apiFocusSave_ },

    'admin.settings.get': { need: 'admin', fn: function () { return adminSettingsGet_(); } },
    'admin.settings.save': { need: 'admin', fn: adminSettingsSave_ },
    'admin.cat.list': { need: 'admin', fn: function () { return adminCategoryList_(); } },
    'admin.cat.save': { need: 'admin', fn: adminCategorySave_ },
    'admin.cat.setActive': { need: 'admin', fn: adminCategorySetActive_ },
    'admin.staff.list': { need: 'admin', fn: function () { return { staff: adminStaffList_(), depts: deptOptions_() }; } },
    'admin.staff.save': { need: 'admin', fn: adminStaffSave_ },
    'admin.staff.setActive': { need: 'admin', fn: adminStaffSetActive_ },
    'admin.staff.resetPin': { need: 'admin', fn: adminStaffResetPin_ },
    'admin.staff.issueMissing': { need: 'admin', fn: adminStaffIssueMissing_ },
    'admin.staff.unlock': { need: 'admin', fn: adminStaffUnlock_ },
    'admin.log.list': { need: 'admin', fn: adminLogList_ },
    'admin.trash.list': { need: 'admin', fn: function () { return adminTrashList_(); } },
    'admin.trash.restore': { need: 'admin', fn: adminTrashRestore_ },
    'admin.pw.common': { need: 'admin', fn: adminChangeCommonPw_ },
    'admin.pw.admin': { need: 'admin', fn: adminChangeAdminPw_ }
  };
}

/**
 * 화면에서 부르는 하나뿐인 창구. 주고받는 값은 JSON 글자다.
 * req = { action, args, tokens: { login, identity, admin } }
 */
function api(reqText) {
  SETTINGS_CACHE_ = null;
  DB_SS_ = null;
  try {
    var req = JSON.parse(String(reqText || '{}'));
    var route = routes_()[req.action];
    if (!route) throw userError_('알 수 없는 요청이에요. 화면을 새로 고쳐 주세요.');
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
    var data = route.fn(req.args || {}, actor, ctx);
    return JSON.stringify({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    if (err && err.userMessage) return JSON.stringify({ ok: false, error: err.userMessage, code: err.code });
    console.error(err && err.stack ? err.stack : err);
    return JSON.stringify({ ok: false, error: '잠시 문제가 생겼어요. 잠깐 뒤에 다시 해 주세요. 계속 안 되면 연구부장·부담당에게 알려 주세요.', code: 'ERROR' });
  }
}

function apiStart_() {
  var ready = true;
  try { sheet_('교직원'); } catch (e) { ready = false; }
  return {
    school: ready ? setting_('학교명') : '인천장도초등학교',
    year: ready ? setting_('학년도') : '',
    ready: ready && hasPassword_('common'),
    rememberDays: ready ? rememberDays_() : 30
  };
}

function apiSession_(args, actor, ctx) {
  return {
    me: ctx.identity ? meView_(ctx.identity) : null,
    admin: !!(ctx.tokens.admin && checkAdmin_(ctx.tokens.admin))
  };
}

function deptOptions_() {
  return liveRows_('분류').filter(function (r) { return r['종류'] === '부서'; })
    .sort(function (a, b) { return (Number(a['순서']) || 999) - (Number(b['순서']) || 999) || a['이름'].localeCompare(b['이름'], 'ko'); })
    .map(function (r) { return { id: r['분류ID'], name: r['이름'], active: r['사용 여부'] !== '사용 안 함' }; });
}
