/**
 * install-guide.js — 최종 설치 안내서(설치안내.md)의 '붙여 넣을 파일' 표를 지금 코드로 다시 만든다.
 * node tools/install-guide.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'apps-script');
const OUT = path.join(__dirname, '..', '설치안내.md');
const BRANCH = 'claude/awesome-clarke-s0uhtb';
const REPO = 'https://github.com/gudtbsl123-alt/online-gyomusil/blob/' + BRANCH + '/apps-script/';
const FILES = [
  ['Code.gs', '스크립트', '이미 있음 → 내용 바꾸기'], ['Db.gs', '스크립트', '이미 있음 → 내용 바꾸기'], ['Auth.gs', '스크립트', '이미 있음 → 내용 바꾸기'],
  ['Admin.gs', '스크립트', '이미 있음 → 내용 바꾸기'], ['Schedule.gs', '스크립트', '이미 있음 → 내용 바꾸기'],
  ['Survey.gs', '스크립트', '이미 있음 → 내용 바꾸기'], ['Library.gs', '스크립트', '이미 있음 → 내용 바꾸기'], ['Help.gs', '스크립트', '이미 있음 → 내용 바꾸기'],
  ['Setup.gs', '스크립트', '이미 있음 → 내용 바꾸기'], ['Table.gs', '스크립트', '**새로 만들기**(+ → 스크립트, 이름 Table)'],
  ['Index.html', 'HTML', '이미 있음 → 내용 바꾸기'], ['Styles.html', 'HTML', '이미 있음 → 내용 바꾸기'], ['App.html', 'HTML', '이미 있음 → 내용 바꾸기']
];
// 파일마다 있어야 할 판(Code.gs의 fileBuilds_)과 가장 최근 판(APP_BUILD_): 이번에 바뀐 파일을 굵게 보여 준다
const code = fs.readFileSync(path.join(DIR, 'Code.gs'), 'utf8');
const latest = /var APP_BUILD_ = '([^']+)'/.exec(code)[1];
const builds = {};
const table0 = /function fileBuilds_\(\) \{[\s\S]*?\n\}/.exec(code)[0];
table0.replace(/'(\w+)': '([^']+)'/g, (m, k, v) => { builds[k] = v; return m; });
const rows = FILES.map(([f, kind, how], i) => {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\n+$/, '').split('\n');
  const last = lines[lines.length - 1].trim();
  const b = builds[f.replace(/\.(gs|html)$/, '')] || '';
  const mark = b === latest ? '**' + b + ' (이번에 바뀜)**' : b;
  return '| ' + (i + 1) + ' | [' + f.replace(/\.(gs|html)$/, '') + '](' + REPO + f + ') | ' + kind + ' | ' + how + ' | ' + mark + ' | **' + lines.length + '** | `' + last + '` |';
});
const table = '| 순서 | 파일(누르면 GitHub로) | 종류 | 할 일 | 판 | 마지막 줄 번호 | 마지막 줄 글자 |\n| --- | --- | --- | --- | --- | --- | --- |\n' + rows.join('\n');
const src = fs.readFileSync(OUT, 'utf8');
const out = src.replace(/<!-- 파일표 시작 -->[\s\S]*<!-- 파일표 끝 -->/, '<!-- 파일표 시작 -->\n' + table + '\n<!-- 파일표 끝 -->');
fs.writeFileSync(OUT, out);
console.log(table);
