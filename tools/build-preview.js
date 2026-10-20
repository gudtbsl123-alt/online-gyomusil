/**
 * build-preview.js — 미리보기 파일 만들기 (node tools/build-preview.js)
 * apps-script 의 화면(Index·Styles·App)과 서버 코드(*.gs)를 한 파일로 묶어,
 * 인터넷 서버 없이 브라우저에서 가짜 데이터로 돌려 볼 수 있게 한다.
 * 결과: 미리보기/미리보기.html  (웹앱에 올리는 파일이 아니다)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { GAS_FILES, GAS_DIR } = require('./load-gas.js');

const read = (f) => fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
/** 스크립트 안의 '</script' 글자가 태그를 닫지 않게 */
const inScript = (js) => js.replace(/<\/script/gi, '<\\/script');
const mock = fs.readFileSync(path.join(__dirname, 'gas-mock.js'), 'utf8');

/**
 * 취합 시트 화면 파일(TableUi.html)은 웹앱처럼 '열 때 받기'(판 2026-10-19a)로 묶는다: 가짜 서버의 HtmlService가 파일 내용을 돌려준다(ui.table).
 * PREVIEW_INLINE=1이면 예전처럼 처음부터 넣는다(설정 '처음에 함께'). 글자 '<'는 \u003c로 적어 스크립트 안에서 태그로 읽히지 않게 한다
 */
const INLINE = process.env.PREVIEW_INLINE === '1';
const tableUiSrc = JSON.stringify(read('TableUi.html')).replace(/</g, '\\u003c');
const boot = `<script>
${inScript(mock)}
</script>
<script>
/* ---- 미리보기 서버: apps-script/*.gs 를 그대로 가짜 시트 위에서 돌린다 ---- */
(function () {
  var env = GasMock.createEnv({});
  var SpreadsheetApp = env.SpreadsheetApp, PropertiesService = env.PropertiesService, LockService = env.LockService,
      Utilities = env.Utilities, Session = env.Session, DriveApp = env.DriveApp, MimeType = env.MimeType, ScriptApp = env.ScriptApp,
      CacheService = env.CacheService;
  var PREVIEW_TABLE_UI = ${tableUiSrc};
  var HtmlService = { // 미리보기는 TableUi만 있다(window.__previewNoTableUi: 파일이 없는 경우 흉내)
    createHtmlOutputFromFile: function (n) {
      if (n !== 'TableUi' || window.__previewNoTableUi) throw new Error('없는 파일: ' + n);
      return { getContent: function () { return PREVIEW_TABLE_UI; } };
    }
  };
${GAS_FILES.map((f) => '/* ===== ' + f + ' ===== */\n' + inScript(read(f))).join('\n')}
  setupAll_();
  setPassword_('common', 'preview1');
  setPassword_('admin', 'admin1');
  seedTestData_('1111');
  seedTestSchedule_();
  seedTestSurveys_();
  seedTestLibrary_();
  seedTestNotices_();
  seedTestTables_();
  // 미리보기용 가짜 학기 기간(오늘이 들어가게): 수업일수 계산을 보여 주려는 값이에요
  (function () {
    var t = todayYmd_(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    var sy = m >= 3 ? y : y - 1, a = { id: '', name: '미리보기' };
    putSetting_('1학기 시작일', sy + '-03-02', a);
    putSetting_('1학기 끝일', sy + '-07-24', a);
    putSetting_('2학기 시작일', sy + '-08-17', a);
    putSetting_('2학기 끝일', (sy + 1) + '-01-08', a);
  })();
  window.__previewSheet = env._ss;
  window.__previewServer = function (req) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(api(req)); }, 120); });
  };
  window.__previewNote = '미리보기예요. 가짜 데이터로 움직이고, 새로 고치면 처음으로 돌아가요. ' +
    '공통 비밀번호 <b>preview1</b> · 관리자 비밀번호 <b>admin1</b> · 이름만 고르면 돼요 · 학기 기간과 일정도 가짜 값이에요';
})();
</script>
`;

let html = read('Index.html')
  .replace("<?!= include('Styles'); ?>", () => read('Styles.html'))
  .replace("<?!= typeof tableUiTag_ === 'function' ? tableUiTag_() : include('TableUi'); ?>", () => (INLINE ? read('TableUi.html') : '<script>window.__gyTableUiLazy = true;</script>'))
  .replace("<?!= include('App'); ?>", () => boot + read('App.html'));
if (/<\?/.test(html)) throw new Error('끼워 넣지 못한 템플릿 표시가 남았어요');
const out = process.env.PREVIEW_OUT || path.join(__dirname, '..', '미리보기', '미리보기.html');
fs.writeFileSync(out, html);
console.log('만듦: ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + 'KB)');
