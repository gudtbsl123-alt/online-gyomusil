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

const boot = `<script>
${inScript(mock)}
</script>
<script>
/* ---- 미리보기 서버: apps-script/*.gs 를 그대로 가짜 시트 위에서 돌린다 ---- */
(function () {
  var env = GasMock.createEnv({});
  var SpreadsheetApp = env.SpreadsheetApp, PropertiesService = env.PropertiesService, LockService = env.LockService,
      Utilities = env.Utilities, Session = env.Session;
${GAS_FILES.map((f) => '/* ===== ' + f + ' ===== */\n' + inScript(read(f))).join('\n')}
  setupAll_();
  setPassword_('common', 'preview1');
  setPassword_('admin', 'admin1');
  seedTestData_('1111');
  window.__previewSheet = env._ss;
  window.__previewServer = function (req) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(api(req)); }, 120); });
  };
  window.__previewNote = '미리보기예요. 가짜 데이터로 움직이고, 새로 고치면 처음으로 돌아가요. ' +
    '공통 비밀번호 <b>preview1</b> · 관리자 비밀번호 <b>admin1</b> · 개인 번호는 모두 <b>1111</b>';
})();
</script>
`;

let html = read('Index.html')
  .replace("<?!= include('Styles'); ?>", () => read('Styles.html'))
  .replace("<?!= include('App'); ?>", () => boot + read('App.html'));
if (/<\?/.test(html)) throw new Error('끼워 넣지 못한 템플릿 표시가 남았어요');
const out = path.join(__dirname, '..', '미리보기', '미리보기.html');
fs.writeFileSync(out, html);
console.log('만듦: ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + 'KB)');
