/**
 * shots.js — 미리보기를 브라우저로 직접 눌러 보며 사진을 찍고, 옆으로 넘치는지 확인한다.
 * node tools/shots.js [사진 폴더]
 */
'use strict';
// 브라우저 시각을 학교(한국) 시각으로: 가짜 서버(Asia/Seoul)와 화면의 '오늘'이 어긋나지 않게
if (!process.env.TZ) process.env.TZ = 'Asia/Seoul';
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

/**
 * 미리보기는 작은 로컬 서버(http://127.0.0.1)로 연다. file://로 열면 브라우저가 다시 열기(reload) 직전에 쓴 기기 저장(localStorage:
 * 화면 크기·디자인)을 가끔 잃어 점검이 틀렸다(2026-10-18 확인, 예전 판도 같음. 실제 웹앱은 https라 괜찮음)
 */
const http = require('http');
const SERVE = {}; // 주소 경로 → 파일
let BASE = '';
function serveFile(name, file) {
  const key = '/' + encodeURIComponent(name);
  SERVE[key] = file;
  return BASE + key;
}
async function startServer() {
  const srv = http.createServer((req, res) => {
    const f = SERVE[req.url.split('?')[0].split('#')[0]];
    if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + srv.address().port;
  srv.unref();
}
let FILE = ''; // startServer() 뒤에 정한다
let guideInfo = ''; // 운영 안내서 선생님용 인쇄 쪽수(보완4)
const PREVIEW = process.env.PREVIEW || path.join(__dirname, '..', '미리보기', '미리보기.html'); // 다른 곳에 복사해 둔 미리보기로 돌릴 때(고치는 동안 뒤에서 돌리기)
const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', '스크린샷');
fs.mkdirSync(OUT, { recursive: true });

const problems = [];

/** 인터넷 없는 곳에서 사진을 찍을 때: PRETENDARD_DIR(npm pretendard 패키지 폴더)이 있으면 글꼴을 거기서 읽는다 */
const FONT_DIR = process.env.PRETENDARD_DIR;
async function newCtx(browser, opts, intro) {
  const ctx = await browser.newContext(opts);
  // 여는 그림(인트로)은 화면을 4초쯤 가리니 끄고 찍는다. 인트로 점검(introFlow)만 켠 채로 연다
  if (!intro) await ctx.addInitScript(() => { try { localStorage.setItem('gy.introOff', '1'); } catch (e) { /* 그대로 */ } });
  if (FONT_DIR) {
    await ctx.route('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/**', (route) => {
      const rel = new URL(route.request().url()).pathname.replace('/npm/pretendard@1.3.9/', '');
      const f = path.join(FONT_DIR, rel);
      if (fs.existsSync(f)) route.fulfill({ path: f, contentType: f.endsWith('.css') ? 'text/css' : 'font/woff2' });
      else route.abort();
    });
  }
  return ctx;
}
let n = 0;

async function check(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (o.sw > o.w + 1) problems.push(label + ': 옆으로 넘침 ' + o.sw + ' > ' + o.w);
}
async function shot(page, name, full) {
  await page.waitForTimeout(250);
  await check(page, name);
  n++;
  await page.screenshot({ path: path.join(OUT, String(n).padStart(2, '0') + '_' + name + '.png'), fullPage: !!full });
}
async function waitText(page, t) { await page.getByText(t, { exact: false }).first().waitFor({ timeout: 10000 }); }
/**
 * 창(openModal)은 열리고 0.03초 뒤 첫 칸으로 포커스를 옮긴다. 그 전에 다른 칸을 채우면 글이 첫 칸으로 들어갈 수 있어서
 * (무거운 전체 점검에서 표 설명이 표 이름 앞에 붙은 적이 있음, 2026-10-20) 포커스가 창 안으로 옮겨진 뒤에 채운다. 창이 없으면 바로
 */
function modalSettled(page) {
  return page.waitForFunction(() => {
    const m = document.querySelector('.modal');
    return !m || !!(document.activeElement && m.contains(document.activeElement));
  }, null, { timeout: 3000 }).catch(() => {});
}

/** 분류 이름 칸: 6글자가 잘리지 않고, 단추가 카드 밖으로 나가지 않는지 */
async function checkCatFields(page, label) {
  const r = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-cat-name],[data-cat-new]').forEach((i) => {
      const old = i.value;
      i.value = '인성안전부장';
      if (i.scrollWidth > i.clientWidth) out.push('이름 칸이 6글자보다 좁음(' + i.clientWidth + 'px)');
      i.value = old;
    });
    document.querySelectorAll('.cat-row').forEach((row) => {
      const card = row.closest('.card').getBoundingClientRect();
      row.querySelectorAll('button,input').forEach((b) => {
        const r2 = b.getBoundingClientRect();
        if (r2.right > card.right - 8 || r2.left < card.left) out.push('칸·단추가 카드 밖으로 나감');
        if (b.tagName === 'BUTTON' && b.scrollWidth > b.clientWidth + 1) out.push('단추 글자가 잘림: ' + b.textContent);
      });
    });
    return Array.from(new Set(out));
  });
  r.forEach((m) => problems.push(label + ' 분류: ' + m));
}

/** 2단계: 일정 화면 */
async function scheduleFlow(page, kind) {
  const phone = kind === '휴대폰';
  await page.click(phone ? '.bottom-nav [data-go=schedule]' : '.side [data-go=schedule]');
  if (phone) {
    await page.locator('.pweek').waitFor();
    await shot(page, kind + '_일정_이번주', true);
    await page.click('[data-action=phone-month]');
    await page.locator('.cal').waitFor();
    await shot(page, kind + '_일정_한달', true);
    await page.click('[data-action=phone-week]');
    await page.click('.fab');
  } else {
    await page.locator('.cal').waitFor();
    await shot(page, kind + '_일정_달력', true);
    await page.click('.bar [data-action=ev-add]');
  }
  await page.locator('#ev-form').waitFor();
  await modalSettled(page);
  await page.fill('#ef-title', '전교 다모임');
  await page.fill('#ef-time', '5교시');
  await page.click('[data-tg="3"]');
  await page.click('[data-tg="4"]');
  await page.fill('#ef-place', '강당');
  await page.check('#ef-imp');
  await shot(page, kind + '_행사추가', !phone);
  await takeCalls(page);
  await page.click('#ev-form [type=submit]');
  await waitText(page, '전교 다모임을 넣었어요');
  await page.locator('[data-action=ev-open]', { hasText: '전교 다모임' }).first().waitFor();
  const saveCalls = (await takeCalls(page)).filter((x) => x !== 'batch');
  if (saveCalls.join() !== 'sched.save') problems.push(kind + ': 일정 저장에 서버를 ' + saveCalls.length + '번 부름(' + saveCalls.join(', ') + ')');
  await page.waitForTimeout(400);
  // 넣은 행사 열어 보기 → 고치기 → 지우기
  await page.locator('[data-action=ev-open]', { hasText: '전교 다모임' }).first().click();
  await page.locator('.ev-dl').waitFor();
  await shot(page, kind + '_행사보기');
  await page.click('[data-action=ev-edit]');
  await page.locator('#ev-form').waitFor();
  await page.click('#ev-form [data-action=ev-del]');
  await page.click('#cf-ok');
  await waitText(page, '일정을 지웠어요');
  // 월별 계획·연간 학사일정
  await page.click('[data-sched-view=plan]');
  await page.locator('table.plan').waitFor();
  await shot(page, kind + '_월별계획', true);
  await page.click('[data-sched-view=year]');
  await page.locator('.year-grid').waitFor();
  await shot(page, kind + '_연간학사일정', true);
  await page.click('[data-sched-view=cal]');
  await page.locator(phone ? '.pweek' : '.cal').waitFor();
  await page.click(phone ? '.bottom-nav [data-go=home]' : '.side [data-go=home]');
  await page.locator('.today-card').waitFor();
}

/** 3단계: 조사·신청 */
async function surveyFlow(page, kind) {
  const phone = kind === '휴대폰';
  if (phone) await page.click('.bottom-nav [data-go=survey]');
  else await page.click('.side [data-go=survey]');
  await page.locator('.sv-card').first().waitFor();
  if (phone) {
    await shot(page, kind + '_조사_목록', true);
    await page.locator('.sv-card').first().click();
  }
  await page.locator('#sv-form, .sv-owner').first().waitFor();
  await shot(page, kind + '_조사_응답', true);
  // 새 조사 만들기
  await page.click('[data-action=sv-new]');
  await page.locator('#svf').waitFor();
  // 창을 연 뒤 0.03초에 제목 칸으로 커서가 옮겨 온다. 그 전에 질문 칸에 글을 넣으면 글이 제목 칸에 붙으니 기다린다
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'svf-title');
  await page.fill('#svf-title', '학년 협의회 참석 여부');
  await page.fill('.q-edit [data-qf=title]', '참석할 수 있나요?');
  await page.fill('.q-edit [data-qf=opts]', '참석\n불참');
  await page.check('.q-edit [data-qf=req]');
  await page.click('#svf-addq');
  await page.locator('.q-edit').nth(1).locator('[data-qf=type]').selectOption('long');
  await page.locator('.q-edit').nth(1).locator('[data-qf=title]').fill('하고 싶은 말');
  await page.click('[data-tt=grade]');
  await page.click('[data-tg2="3"]');
  await shot(page, kind + '_조사_만들기');
  await page.click('#svf [type=submit]');
  await waitText(page, '조사를 만들었어요');
  await page.locator('.sv-owner').waitFor();
  await shot(page, kind + '_조사_제출현황', true);
  await page.click('[data-action=sv-copy]');
  await waitText(page, '복사');
  await page.click('[data-action=sv-remind]');
  await takeCalls(page);
  await page.click('#cf-ok');
  await waitText(page, '다시 알렸어요');
  await page.locator('.sv-owner').waitFor();
  const rCalls = (await takeCalls(page)).filter((x) => x !== 'batch');
  if (rCalls.join() !== 'survey.remind') problems.push(kind + ': 다시 알리기에 서버를 ' + rCalls.length + '번 부름(' + rCalls.join(', ') + ')');
  await page.click('[data-action=sv-csv]');
  await page.locator('#csv-dl').waitFor();
  await shot(page, kind + '_조사_엑셀');
  await page.click('[data-action=close-modal]');
  // 홈의 내가 할 일
  await page.click(phone ? '.bottom-nav [data-go=home]' : '.side [data-go=home]');
  await page.locator('.todo-card').waitFor();
  if (!(await page.locator('.todo-first').count())) problems.push(kind + ': 홈 내가 할 일에 새 조사가 안 보임');
  await shot(page, kind + '_홈_내가할일');
}

/** 4단계: 홈 검색 → 자료실·교직원·도움말·운영 안내서 */
async function libraryFlow(page, kind) {
  const phone = kind === '휴대폰';
  const nav = (id) => page.evaluate((x) => window.__gy.go(x), id);
  // 홈 검색
  await page.fill('#home-q', '협의');
  await page.press('#home-q', 'Enter');
  await page.locator('.search-res').waitFor();
  for (const g of ['자료', '일정']) if (!(await page.locator('.sr-h', { hasText: g }).count())) problems.push(kind + ': 홈 검색 "협의"에서 ' + g + '이(가) 안 나옴');
  await shot(page, kind + '_홈_검색', true);
  await page.fill('#home-q', '정보부');
  await page.press('#home-q', 'Enter');
  await page.locator('.sr-h', { hasText: '교직원' }).waitFor();
  if ((await page.locator('.sr-h', { hasText: '교직원' }).locator('xpath=..').locator('.sr-row').count()) !== 2) problems.push(kind + ': 홈 검색 "정보부" 교직원이 2명이 아님');
  await page.locator('.sr-row[data-action=sr-lib]').first().click();
  await page.locator('.modal .ev-dl').waitFor();
  await shot(page, kind + '_자료_보기');
  await page.click('.modal [data-action=close-modal]');
  await page.locator('.lib-card').first().waitFor();
  await shot(page, kind + '_자료실', true);
  const firstGroup = await page.locator('.lib-group').first().evaluate((el) => ({ common: el.classList.contains('common'), n: el.querySelectorAll('.lib-card').length, first: el.querySelector('.lib-title').textContent }));
  if (!firstGroup.common || firstGroup.n !== 3 || firstGroup.first !== '가정통신문 양식(가짜)') problems.push(kind + ': 공통 자료가 맨 위에 순서대로 안 보임 ' + JSON.stringify(firstGroup));
  await page.locator('#lib-depts .tg', { hasText: '정보부' }).click();
  if ((await page.locator('.lib-group.common').count()) || (await page.locator('.lib-group .lib-h').allInnerTexts()).some((t) => !/^정보부/.test(t))) problems.push(kind + ': 부서 단추를 고르면 그 부서 자료만 보여야 함(판 2026-10-22a)');
  await page.locator('#lib-depts .tg', { hasText: '공통' }).click();
  if ((await page.locator('.lib-group.common .lib-card').count()) !== 3 || (await page.locator('.lib-group:not(.common)').count())) problems.push(kind + ': 공통 단추를 고르면 공통 자료 3개만 보여야 함');
  await page.click('#lib-depts .tg[data-id=""]');
  // 파일 올리기
  await page.click('[data-action=lib-new]');
  await page.locator('#lib-form').waitFor();
  await modalSettled(page);
  await page.fill('#lf-title', '학급 운영 계획 양식');
  await page.fill('#lf-desc', '새 학년 학급 운영 계획을 적는 양식이에요.');
  await page.check('#lf-common');
  await page.fill('#lf-corder', '4');
  await page.click('#lib-form [data-mode=file]');
  await page.setInputFiles('#lf-file', { name: '학급운영계획.hwp', mimeType: 'application/x-hwp', buffer: Buffer.from('가짜 한글 파일') });
  await shot(page, kind + '_자료_넣기');
  await page.click('#lib-form [type=submit]');
  await waitText(page, '자료를 넣었어요');
  if (!(await page.locator('.lib-card', { hasText: '학급 운영 계획 양식' }).count())) problems.push(kind + ': 올린 자료가 목록에 안 보임');
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.locator('.lib-card', { hasText: '학급 운영 계획 양식' }).locator('[data-action=file-dl]').click();
  const d = await dl;
  if (!d) problems.push(kind + ': 파일 내려받기가 안 됨');
  // 이름은 확인하지 않는다: 시험용 headless 크롬은 한글 파일 이름을 'download'로 바꾼다(영문 이름은 그대로). 실제 브라우저에서 확인할 것
  else if (require('fs').readFileSync(await d.path(), 'utf8') !== '가짜 한글 파일') problems.push(kind + ': 내려받은 파일 내용이 다름');
  // 보관함
  await page.click('[data-action=lib-view][data-v=archive]');
  await page.locator('.lib-card').first().waitFor();
  await shot(page, kind + '_자료실_보관함');
  await page.click('[data-action=lib-view][data-v=now]');
  // 교직원 명단
  await nav('staff');
  await page.locator('.dir-row').nth(3).waitFor();
  await shot(page, kind + '_교직원명단', true);
  await page.fill('#dir-q', '정보');
  await page.waitForTimeout(200);
  if ((await page.locator('.dir-row:not(.head)').count()) !== 2) problems.push(kind + ': 교직원 찾기 "정보" 결과가 2명이 아님');
  // 도움말
  await nav('help');
  await page.locator('.help-item').first().waitFor();
  await page.locator('.help-item summary').first().click();
  await shot(page, kind + '_도움말', true);
  await page.click('[data-action=help-new]');
  await page.locator('#help-form').waitFor();
  await modalSettled(page);
  await page.fill('#hf-title', '연가 사용 안내(예시)');
  await page.fill('#hf-body', '학교에서 정한 내용을 여기에 적어요.');
  await shot(page, kind + '_도움말_쓰기');
  await page.click('#help-form [type=submit]');
  await waitText(page, '도움말을 넣었어요');
  // 운영 안내서
  await nav('guide');
  await page.locator('.guide-card').first().waitFor();
  await shot(page, kind + '_운영안내서', true);
  await page.click(phone ? '.bottom-nav [data-go=home]' : '.side [data-go=home]');
  await page.locator('.today-card').waitFor();
  if (!(await page.locator('.quick-card .sr-row').count())) problems.push(kind + ': 홈 자주 찾는 자료가 비어 있음');
}

/** 5단계: 학사일정 한 번에 올리기(관리자) — SAMPLE_XLSX(엑셀로 만든 시험 파일)가 있을 때 */
const SAMPLE_XLSX = process.env.SAMPLE_XLSX;
const TEMPLATE_OUT = process.env.TEMPLATE_OUT;
async function uploadFlow(page, kind) {
  const nav = (id) => page.evaluate((x) => window.__gy.go(x), id);
  // 이름만 방식이라 역할 '관리'라도 관리자 화면을 열어야 학사일정 올리기 단추가 보인다
  await nav('schedule');
  if (await page.locator('[data-go=upload]').count()) problems.push(kind + ': 관리자 화면을 열기 전인데 학사일정 올리기 단추가 보임');
  await nav('admin');
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.locator('.srow').nth(3).waitFor();
  await nav('schedule');
  await page.locator('[data-go=upload]').click();
  await page.locator('.up-steps').waitFor();
  await shot(page, kind + '_학사일정올리기', true);
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('[data-action=up-template]');
  const d = await dl;
  if (!d) problems.push(kind + ': 양식 내려받기가 안 됨');
  else if (TEMPLATE_OUT && kind === 'PC') await d.saveAs(TEMPLATE_OUT);
  if (SAMPLE_XLSX) {
    await page.setInputFiles('#up-file', SAMPLE_XLSX);
    await page.locator('.up-table').waitFor();
    const n = await page.locator('#up-count').textContent();
    if (!/^2[0-9]개$/.test(n.trim())) problems.push(kind + ': 엑셀 파일에서 올릴 행사 수가 이상함 ' + n);
    const first = await page.locator('.up-table tbody tr').first().innerText();
    if (!/학예회/.test(first) || !/11월 9일/.test(first)) problems.push(kind + ': 엑셀 날짜 칸을 못 읽음 ' + first.replace(/\s+/g, ' '));
    await shot(page, kind + '_학사일정_미리보기', true);
    // 올릴 수 없는 줄 고치기
    await page.click('[data-action=up-filter][data-v=error]');
    await page.locator('.up-table [data-action=up-edit]').first().click();
    await page.locator('#ue-form').waitFor();
    await shot(page, kind + '_학사일정_줄고치기');
    await modalSettled(page);
    await page.fill('#ue-start', '2026-10-30');
    await page.click('#ue-form [type=submit]');
    await page.waitForTimeout(500);
    await page.locator('.up-table, .up-card .empty').first().waitFor();
    if ((await page.locator('[data-action=up-filter][data-v=error] .tab-n').textContent()).trim() !== '0') problems.push(kind + ': 줄을 고쳐도 오류가 남음');
    await page.click('[data-action=up-save]');
    await page.click('#cf-ok');
    await page.locator('.up-done').waitFor();
    await shot(page, kind + '_학사일정_올림');
    await page.click('[data-action=up-undo]');
    await page.click('#cf-ok');
    await waitText(page, '되돌렸어요');
  }
  // 한글·엑셀에서 표를 복사해 붙여 넣기(HTML 표 흉내)
  if (await page.locator('[data-action=up-again]').count()) await page.click('[data-action=up-again]');
  await page.click('[data-action=up-input][data-v=paste]');
  await page.locator('#up-paste').focus();
  await page.evaluate(() => {
    const html = '<table><tr><td>날짜</td><td>행사명</td><td>대상</td><td>구분</td></tr><tr><td>2026. 11. 20.(금)</td><td>학교 축제</td><td>전교</td><td>행사</td></tr><tr><td>11월 23일</td><td>재량휴업일</td><td></td><td>휴업일</td></tr></table>';
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', '날짜\t행사명\t대상\t구분\n2026. 11. 20.(금)\t학교 축제\t전교\t행사\n11월 23일\t재량휴업일\t\t휴업일');
    const ta = document.querySelector('#up-paste');
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    ta.value = dt.getData('text/plain');
  });
  await page.click('[data-action=up-read-paste]');
  await page.locator('.up-table').waitFor();
  if ((await page.locator('#up-count').textContent()).trim() !== '2개') problems.push(kind + ': 붙여 넣은 표를 못 읽음');
  await shot(page, kind + '_학사일정_붙여넣기', true);
  await nav('admin');
  await page.click('[data-action=admin-out]');
  await page.locator('#admin-form').waitFor();
}

/** 5단계: 공지 */
async function noticeFlow(page, kind) {
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.notice-card').waitFor();
  if (!(await page.locator('[data-dot=notice]:not([hidden])').count())) problems.push(kind + ': 새 공지 점이 안 보임');
  if ((await page.locator('.notice-card .sr-row').count()) !== 2) problems.push(kind + ': 홈 공지가 2개가 아님(지난 공지는 빠져야 함)');
  await page.click('.notice-card [data-action=notice-new]');
  await page.locator('#notice-form').waitFor();
  await modalSettled(page);
  await page.fill('#nf-title', '다음 주 교직원 협의회 장소 변경');
  await page.fill('#nf-body', '회의실 대신 도서실에서 해요.');
  await shot(page, kind + '_공지_쓰기');
  await takeCalls(page);
  await page.click('#notice-form [type=submit]');
  await waitText(page, '공지를 올렸어요');
  await page.locator('.notice-item').nth(2).waitFor();
  const nCalls = (await takeCalls(page)).filter((x) => x !== 'batch');
  if (nCalls.join() !== 'notice.save') problems.push(kind + ': 공지 저장에 서버를 ' + nCalls.length + '번 부름(' + nCalls.join(', ') + ')');
  await shot(page, kind + '_공지', true);
  if (await page.locator('[data-dot=notice]:not([hidden])').count()) problems.push(kind + ': 공지를 봤는데 새 공지 점이 남음');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.notice-card .sr-row').nth(2).waitFor();
  await page.locator('.notice-card .sr-row').first().click();
  await page.locator('.modal').waitFor();
  await shot(page, kind + '_공지_보기');
  await page.click('.modal [data-action=close-modal]');
}

/** 홈 '학생 수 현황': 빈 카드 → 학교 전체 넣기 창(반마다 남·여) → 카드 → 학년 누르면 반별 → 고치기는 그 학년으로 */
async function studentsFlow(page, kind) {
  await page.evaluate(() => window.__gy.go('home'));
  const card = page.locator('.stu-card');
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  await shot(page, kind + '_홈_학생수_비어있음');
  await page.click('[data-action=students-edit]');
  await page.locator('#stu-form').waitFor();
  // 처음 반 수는 교직원 소속에서만: 가짜 명단은 3학년 1·2반, 6학년 2반 → 3학년 2반, 6학년 2반, 나머지 1반
  const counts = await page.evaluate(() => [1, 2, 3, 4, 5, 6].map((g) => document.querySelectorAll('#stu-rows-' + g + ' .stu-row').length));
  if (counts.join() !== '1,1,2,1,1,2') problems.push(kind + ': 넣기 창의 처음 반 수가 ' + counts.join());
  // 4학년에 반 하나 더하고 빼 보기
  await page.click('[data-stu-add="4"]');
  if ((await page.locator('#stu-rows-4 .stu-row').count()) !== 2) problems.push(kind + ': 반 더하기가 안 됨');
  await page.click('[data-stu-del="4"]');
  if ((await page.locator('#stu-rows-4 .stu-row').count()) !== 1) problems.push(kind + ': 마지막 반 빼기가 안 됨');
  // 미리보기용 가짜 숫자: 칸마다 10~16
  const n = await page.locator('.stu-n').count();
  for (let i = 0; i < n; i++) await page.locator('.stu-n').nth(i).fill(String(10 + (i % 7)));
  await page.fill('#stu-1-1-0', '1a');
  if ((await page.inputValue('#stu-1-1-0')) !== '1') problems.push(kind + ': 학생 수 칸에 숫자가 아닌 글자가 남음');
  await page.fill('#stu-1-1-0', '12');
  const sumNow = () => page.evaluate(() => Array.from(document.querySelectorAll('.stu-n')).reduce((a, x) => a + Number(x.value || 0), 0));
  let sum = await sumNow();
  const total = (await page.textContent('#stu-sum')).trim();
  if (!total.endsWith(' · ' + sum + '명')) problems.push(kind + ': 넣기 창 전체 합계가 ' + total + ' (기대 ' + sum + '명)');
  await page.fill('#stu-3-2-1', '');
  await page.click('#stu-save');
  try {
    await page.locator('#stu-err', { hasText: '3학년 2반 여학생 수를 숫자로' }).waitFor({ timeout: 5000 });
  } catch (e) { problems.push(kind + ': 빈칸으로 저장을 눌렀는데 몇 학년 몇 반인지 안내가 안 나옴'); }
  await page.fill('#stu-3-2-1', '13');
  if ((await page.textContent('#stu-err')).trim()) problems.push(kind + ': 숫자를 고쳤는데 지난 안내가 남아 있음');
  sum = await sumNow();
  await page.locator('#stu-sec-3').scrollIntoViewIfNeeded();
  await shot(page, kind + '_학생수_넣기창');
  await page.click('#stu-save');
  await page.locator('.stu-grid').waitFor();
  await card.scrollIntoViewIfNeeded();
  if (!(await page.locator('.stu-g.mine', { hasText: '3학년' }).count())) problems.push(kind + ': 우리 학년(3학년) 표시가 없음');
  const shown = Number((await page.textContent('.stu-total-num')).replace(/,/g, ''));
  if (shown !== sum) problems.push(kind + ': 전체 학생 수가 ' + shown + ' (기대 ' + sum + ')');
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 9000 }).catch(() => {}); // 알림 글이 사라진 뒤 찍기(알림은 글 길이만큼 보인다)
  await shot(page, kind + '_홈_학생수');
  // 학년을 누르면 반별 남·여
  await page.click('[data-action=students-grade][data-id="3"]');
  await page.locator('.stu-table').waitFor();
  if ((await page.locator('.stu-table tbody tr').count()) !== 2) problems.push(kind + ': 3학년 반별 줄이 2개가 아님');
  await shot(page, kind + '_학생수_3학년반별');
  await page.click('.modal [data-action=students-edit]');
  await page.locator('#stu-form').waitFor();
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => Math.round(document.querySelector('#stu-sec-3').getBoundingClientRect().top - document.querySelector('.modal').getBoundingClientRect().top));
  if (off > 40) problems.push(kind + ': 학년 상세에서 고치기를 눌렀는데 그 학년으로 가지 않음(' + off + ')');
  await page.click('#stu-form [data-action=close-modal]');
}

/** 속도: 다시 열기는 boot 한 번, 15초 안에 다시 연 메뉴는 서버를 부르지 않음 */
async function speedFlow(page, kind) {
  await page.evaluate(() => {
    if (!window.__countOn) {
      const o = window.__previewServer;
      window.__calls = [];
      window.__previewServer = (req) => { window.__calls.push(JSON.parse(req).action); return o(req); };
      window.__countOn = true;
    }
    window.__calls.length = 0;
  });
  await page.evaluate(() => { window.__gy.memoClear(); window.__gy.S.screen = 'home'; document.getElementById('app').innerHTML = ''; window.__gy.init(); });
  await page.locator('.today-card').waitFor();
  await page.waitForTimeout(300);
  let c = await takeCalls(page);
  if (c.join() !== 'boot') problems.push(kind + ': 다시 열 때 서버를 ' + c.length + '번 부름(' + c.join(', ') + ')');
  // 미리 받기: 홈이 뜬 뒤 뒤에서 한 번(batch) → 처음 누르는 메뉴도 서버를 부르지 않고 바로
  await page.waitForTimeout(1500);
  c = await takeCalls(page);
  if (c.join() !== 'batch') problems.push(kind + ': 미리 받기가 한 번이 아님(' + c.join(', ') + ')');
  // (공지 화면은 열면 '본 공지'가 되어 뒤의 새 공지 점 점검이 달라지므로 여기서는 열지 않는다)
  for (const [scr, sel] of [['survey', '.sv-card, .sv-detail'], ['library', '.lib-card'], ['help', '.help-item'], ['staff', '.dir-row:not(.head)']]) {
    await page.evaluate((x) => window.__gy.go(x), scr);
    await page.locator(sel).first().waitFor();
    await page.waitForTimeout(150);
    c = (await takeCalls(page)).filter((x) => x !== 'survey.get');
    if (c.length) problems.push(kind + ': 미리 받은 ' + scr + ' 화면을 처음 열었는데 서버를 부름(' + c.join(', ') + ')');
  }
  const cal = kind === '휴대폰' ? '.pweek' : '.cal';
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator(cal).waitFor();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await takeCalls(page);
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator(cal).waitFor();
  await page.waitForTimeout(300);
  c = await takeCalls(page);
  if (c.length) problems.push(kind + ': 방금 본 일정을 다시 열었는데 서버를 부름(' + c.join(', ') + ')');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await takeCalls(page);
}
/** 최종 검토에서 고친 화면 문제가 다시 생기지 않는지(PC) */
async function reviewFlow(page, kind) {
  const val = (sel) => page.inputValue(sel);
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator('.cal').waitFor();
  await page.waitForTimeout(1500); // 지난달·다음 달을 뒤에서 받아 둔다
  await takeCalls(page);
  await page.click('[data-action=m-next]');
  await page.locator('.cal').waitFor();
  await page.waitForTimeout(300);
  let c = (await takeCalls(page)).filter((x) => x !== 'batch');
  if (c.length) problems.push(kind + ': 다음 달을 눌렀는데 서버를 기다림(' + c.join(', ') + ')');
  await page.click('[data-action=m-prev]');
  await page.locator('.cal').waitFor();
  // 옆 행사 추가 칸: 필터·달 옮기기에도 쓰던 값 그대로
  await page.click('.bar [data-action=ev-add]');
  await page.locator('#side-form #ev-form').waitFor();
  await page.fill('#ef-title', '쓰던 행사');
  await page.fill('#ef-place', '도서관');
  await page.click('[data-tg="3"]');
  await page.selectOption('#f-grade', '3');
  await page.waitForTimeout(200);
  if ((await val('#ef-title')) !== '쓰던 행사' || (await val('#ef-place')) !== '도서관' || (await page.getAttribute('[data-tg="3"]', 'aria-pressed')) !== 'true') problems.push(kind + ': 필터를 바꾸면 옆 행사 칸에 쓰던 것이 지워짐');
  await page.click('[data-action=m-next]');
  await page.locator('#side-form #ev-form').waitFor();
  if ((await val('#ef-title')) !== '쓰던 행사') problems.push(kind + ': 달을 옮기면 옆 행사 칸이 닫히거나 지워짐');
  await page.click('[data-action=m-prev]');
  await page.locator('#side-form #ev-form').waitFor();
  // 창을 좁히면(모니터 절반) 쓰던 것을 창으로 옮긴다(입력 중에는 기다렸다가)
  const vp = page.viewportSize();
  await page.focus('#ef-title');
  await page.setViewportSize({ width: 1100, height: vp.height });
  await page.waitForTimeout(400);
  if ((await val('#ef-title')) !== '쓰던 행사') problems.push(kind + ': 입력 중에 창을 좁히니 쓰던 것이 지워짐');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(400);
  if (!(await page.locator('#modal-form #ev-form').count()) || (await val('#ef-title')) !== '쓰던 행사') problems.push(kind + ': 창을 좁힌 뒤 쓰던 행사가 창으로 옮겨지지 않음');
  await page.click('#ev-form [data-action=ev-cancel]');
  await page.setViewportSize(vp);
  await page.waitForTimeout(400);
  await page.selectOption('#f-grade', '');
  // 부서가 있는 행사를 홈에서 고쳐도 부서가 남고, 달력에서 고친 뒤 다시 열면 새 내용
  const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await page.click('.bar [data-action=ev-add]');
  await page.locator('#ev-form').waitFor();
  await modalSettled(page);
  await page.fill('#ef-start', today);
  await page.fill('#ef-title', '부서 행사 점검');
  await page.selectOption('#ef-dept', { label: '정보부' });
  await page.click('#ev-form [type=submit]');
  await waitText(page, '부서 행사 점검을 넣었어요');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await page.locator('[data-action=ev-open]', { hasText: '부서 행사 점검' }).first().click();
  await page.click('[data-action=ev-edit]');
  await page.locator('#ev-form').waitFor();
  const deptLabel = await page.evaluate(() => { const s = document.querySelector('#ef-dept'); return s.options[s.selectedIndex].text; });
  if (deptLabel !== '정보부') problems.push(kind + ': 홈에서 행사를 고치려니 담당 부서가 비어 있음(' + deptLabel + ')');
  await page.fill('#ef-memo', '홈에서 메모만 고침');
  await page.click('#ev-form [type=submit]');
  await waitText(page, '부서 행사 점검을 고쳤어요');
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator('.cal').waitFor();
  await page.locator('[data-action=ev-open]', { hasText: '부서 행사 점검' }).first().click();
  await page.click('[data-action=ev-edit]');
  await page.locator('#ev-form').waitFor();
  await modalSettled(page);
  await page.fill('#ef-title', '고친 행사 점검');
  await page.click('#ev-form [type=submit]');
  await waitText(page, '고친 행사 점검을 고쳤어요');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await page.locator('[data-action=ev-open]', { hasText: '고친 행사 점검' }).first().click();
  await page.locator('.ev-dl').waitFor();
  const dl = await page.locator('.modal').innerText();
  if (!/정보부/.test(dl) || !/홈에서 메모만 고침/.test(dl)) problems.push(kind + ': 고친 행사를 다시 열었더니 부서나 메모가 옛것');
  await page.click('[data-action=ev-edit]');
  await page.locator('#ev-form').waitFor();
  await page.click('#ev-form [data-action=ev-del]');
  await page.click('#cf-ok');
  await waitText(page, '일정을 지웠어요');
  // 새 조사 만들기 창은 Esc로 닫히지 않는다(쓰던 질문을 잃지 않게)
  await page.evaluate(() => window.__gy.go('survey'));
  await page.locator('.sv-card').first().waitFor();
  await page.click('[data-action=sv-new]');
  await page.locator('#svf').waitFor();
  await modalSettled(page);
  await page.fill('#svf-title', 'Esc 점검');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (!(await page.locator('#svf').count())) problems.push(kind + ': 새 조사 만들기 창이 Esc로 닫혀 쓰던 것이 사라짐');
  else await page.click('#svf [data-action=close-modal]');
  // '다른 분들의 답 보기'를 눌러도 아직 안 낸 답은 그대로
  if (await page.locator('[data-sv-tab=answer]').count()) await page.click('[data-sv-tab=answer]');
  await page.waitForTimeout(300);
  const cards = page.locator('[data-action=sv-open]');
  let tried = false;
  for (let i = 0; i < await cards.count() && !tried; i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(300);
    if (!(await page.locator('[data-action=sv-results]').count()) || !(await page.locator('#sv-form input[type=radio]:not([disabled])').count())) continue;
    tried = true;
    const radios = page.locator('#sv-form input[type=radio]');
    const pick = (await radios.count()) - 1;
    await radios.nth(pick).evaluate((el) => el.closest('label').click());
    if (!(await radios.nth(pick).isChecked())) { problems.push(kind + ': 응답 칸을 눌러도 골라지지 않음'); continue; }
    await page.click('[data-action=sv-results]');
    await page.waitForTimeout(200);
    if (!(await page.locator('#sv-form input[type=radio]').nth(pick).isChecked())) problems.push(kind + ': 다른 분들의 답 보기를 누르니 고른 답이 지워짐');
  }
  if (!tried) problems.push(kind + ': 다른 분들의 답 보기를 점검할 조사가 없음');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await takeCalls(page);
}

async function takeCalls(page) {
  return page.evaluate(() => { const c = (window.__calls || []).slice(); if (window.__calls) window.__calls.length = 0; return c; });
}

/** 화면 크기 막대: +로 끝까지(PC 130%, 휴대폰 120%), 막대로 가장 작게, 기억하기, 예전 '글자 크게' 이어받기 */
async function zoomFlow(page, kind) {
  const phone = kind === '휴대폰';
  const zoomVar = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gy-zoom').trim());
  const box = phone ? '#sheet .zoom' : '.side .zoom';
  const open = async () => {
    if (!phone) return;
    await page.click('.bottom-nav [data-action=sheet]');
    await page.locator(box).waitFor();
    await page.locator(box).scrollIntoViewIfNeeded();
  };
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await open();
  for (let i = 0; i < 6; i++) {
    const plus = page.locator(box + ' [data-action=zoom-in]');
    if (await plus.isDisabled()) break;
    await plus.click();
  }
  const max = phone ? '1.2' : '1.3';
  if ((await zoomVar()) !== max) problems.push(kind + ': 화면 크기 최대가 ' + (await zoomVar()) + ' (기대 ' + max + ')');
  if ((await page.textContent(box + ' .zoom-val')).trim() !== Math.round(Number(max) * 100) + '%') problems.push(kind + ': 화면 크기 숫자가 맞지 않음');
  if (phone) {
    await shot(page, kind + '_화면크기_전체메뉴');
    await page.click('#sheet [data-action=close-sheet]');
  } else {
    const side = await page.evaluate(() => document.querySelector('.side').getBoundingClientRect().width);
    if (Math.round(side) !== 248) problems.push(kind + ': 화면을 키웠는데 메뉴도 커짐(' + side + ')');
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, kind + '_화면크기_' + Math.round(Number(max) * 100), true);
  await open();
  await page.locator(box + ' .zoom-range').fill('0');
  if ((await zoomVar()) !== '0.9') problems.push(kind + ': 막대를 맨 왼쪽으로 옮겼는데 ' + (await zoomVar()));
  if (phone) await page.click('#sheet [data-action=close-sheet]');
  // 기억하기: 다시 열어도 그대로, 예전 '글자 크게'를 켠 기기는 110%로 이어받기
  // Index.html의 '여는 중' 글자가 #app에 먼저 있으니, 앱 스크립트가 돈 뒤(window.__gy)에 화면 크기를 본다
  await page.reload();
  await page.waitForFunction(() => !!window.__gy);
  if ((await zoomVar()) !== '0.9') problems.push(kind + ': 다시 열었더니 화면 크기를 잊음(' + (await zoomVar()) + ')');
  await page.evaluate(() => { localStorage.removeItem('gy.zoom'); localStorage.setItem('gy.big', '1'); });
  await page.reload();
  await page.waitForFunction(() => !!window.__gy);
  if ((await zoomVar()) !== '1.1') problems.push(kind + ': 예전 글자 크게를 110%로 이어받지 못함(' + (await zoomVar()) + ')');
  await page.evaluate(() => { localStorage.removeItem('gy.big'); localStorage.removeItem('gy.zoom'); });
}

async function login(page) {
  await page.fill('#login-pw', 'preview1');
  await page.click('#login-form [type=submit]');
  await waitText(page, '누구신가요?');
}
async function verify(page, name, remember) {
  await page.locator('.person', { hasText: name }).first().click();
  if (await page.locator('#id-pin').count()) await page.fill('#id-pin', '1111');
  if (remember) await page.check('#id-remember');
  await page.click('#id-form [type=submit]');
  await page.locator('.main').waitFor();
}

async function flow(browser, kind, viewport) {
  const ctx = await newCtx(browser, { viewport, deviceScaleFactor: 1, hasTouch: kind === '휴대폰', isMobile: kind === '휴대폰' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(kind + ' 페이지 오류: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/pretendard|ERR_|net::/i.test(m.text())) problems.push(kind + ' 콘솔: ' + m.text()); });
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator('#gy-intro').count()) problems.push(kind + ': 인트로를 끈 기기(gy.introOff)인데 인트로가 남아 있음');
  await shot(page, kind + '_로그인');

  await page.fill('#login-pw', 'wrong-pass');
  await page.click('#login-form [type=submit]');
  await waitText(page, '비밀번호가 맞지 않아요');
  await shot(page, kind + '_로그인_틀림');

  await page.fill('#login-pw', '');
  await login(page);
  await shot(page, kind + '_본인확인');

  await page.locator('.person', { hasText: '성춘향' }).click();
  if (await page.locator('#id-pin').count()) problems.push(kind + ': 이름만 방식인데 번호 칸이 보임');
  if (!(await page.isChecked('#id-remember'))) problems.push(kind + ': 이름만 방식에서 기억하기가 기본으로 켜져 있지 않음');
  await shot(page, kind + '_이름고르기');
  await page.click('#id-form [type=submit]');
  await waitText(page, '오늘도 반가워요');
  await page.locator('.today-card').waitFor();
  await shot(page, kind + '_홈', true);
  await studentsFlow(page, kind);
  await speedFlow(page, kind);
  await scheduleFlow(page, kind);
  await surveyFlow(page, kind);
  await libraryFlow(page, kind);
  await noticeFlow(page, kind);
  await uploadFlow(page, kind);
  if (kind === 'PC') await reviewFlow(page, kind);

  if (kind === '휴대폰') {
    await page.click('.bottom-nav [data-action=sheet]');
    await shot(page, kind + '_전체메뉴');
    await page.click('#sheet [data-go=admin]');
  } else {
    await page.click('.side [data-go=admin]');
  }
  await waitText(page, '관리자 비밀번호를 넣어 주세요');
  await shot(page, kind + '_관리자_비밀번호');
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.locator('.srow').nth(3).waitFor();
  await shot(page, kind + '_관리자_교직원표', true);
  // 교직원 표 찾기: 칸은 그대로 두고 줄만 바뀐다(한글을 입력하는 중에 칸이 새로 그려지면 글자가 깨진다)
  const findBox = await page.$('#staff-find');
  await page.type('#staff-find', '홍');
  await page.waitForTimeout(150);
  if (!(await findBox.evaluate((el) => el.isConnected && document.activeElement === el))) problems.push(kind + ': 교직원 표 찾기 칸이 입력할 때마다 새로 그려짐');
  if ((await page.locator('#staff-rows .srow:not(.head)').count()) < 1) problems.push(kind + ': 교직원 표 찾기 결과가 없음');
  await page.fill('#staff-find', '');

  await page.click('[data-action=staff-import]');
  await page.locator('#imp-paste').waitFor();
  await page.fill('#imp-paste', '이름\t직위\t소속\t부서\t내선\n전우치\t교사\t2학년 2반\t교무\t109\n박씨\t수석교사\t\t연구부\t010-1234-5678\n홍길동\t교사\t3학년 1반\t연구부\t101');
  await page.click('[data-action=imp-read]');
  await page.locator('.imp-table').waitFor();
  await shot(page, kind + '_명단_한번에넣기');
  await page.click('#imp-go');
  await waitText(page, '명을 넣었어요');
  await page.click('[data-admin-tab=check]');
  await page.locator('.check-row').first().waitFor();
  await shot(page, kind + '_관리자_점검', true);
  if (await page.locator('.check-row.bad').count()) problems.push(kind + ': 점검에 문제 항목이 있음 ' + (await page.locator('.check-row.bad').first().innerText()).replace(/\s+/g, ' '));
  await page.click('[data-action=speed-run]');
  await page.locator('.speed-table').waitFor();
  if ((await page.locator('.speed-table tbody tr').count()) !== 7) problems.push(kind + ': 속도 재기 표가 7줄이 아님');
  await page.locator('#speed-out').scrollIntoViewIfNeeded();
  await shot(page, kind + '_속도재기');
  await page.click('[data-admin-tab=staff]');
  await page.locator('.srow').nth(3).waitFor();
  await page.click('[data-action=staff-add]');
  await shot(page, kind + '_교직원_추가창');
  await page.fill('#sf-이름', '전우치');
  await page.fill('#sf-소속', '2학년 1반');
  await page.selectOption('#sf-부서ID', { label: '교무부' });
  await page.fill('#sf-내선', '0108');
  await page.click('#staff-form [type=submit]');
  await waitText(page, '전우치 선생님을 넣었어요');
  if (await page.locator('[data-action=staff-pin],[data-action=staff-issue]').count()) problems.push(kind + ': 이름만 방식인데 번호 단추가 보임');

  await page.click('[data-admin-tab=cat]');
  await page.locator('[data-cat-name]').first().waitFor();
  const first = page.locator('[data-cat-name]').nth(2);
  await first.fill('정보과학부');
  await page.locator('[data-action=cat-save]').nth(2).click();
  await waitText(page, '저장했어요');
  await checkCatFields(page, kind);
  await shot(page, kind + '_분류', true);

  await page.click('[data-admin-tab=settings]');
  await page.locator('#set-form').waitFor();
  await shot(page, kind + '_설정', true);

  await page.click('[data-admin-tab=year]');
  await page.locator('.ny-item').first().waitFor();
  await page.locator('.ny-item input').nth(1).uncheck();
  await shot(page, kind + '_관리자_새학년도', true);
  if (kind === 'PC') {
    await page.click('#ny-go');
    await page.click('#cf-ok');
    await waitText(page, '학년도로 넘겼어요');
    await page.locator('.ny-item').first().waitFor();
  }

  await page.click('[data-admin-tab=log]');
  await page.locator('.log-item').first().waitFor();
  const det = page.locator('.log-item details').first();
  if (await det.count()) await det.locator('summary').click();
  await shot(page, kind + '_수정기록', true);

  await page.click('[data-admin-tab=trash]');
  await page.locator('[data-action=trash-restore]').first().waitFor();
  await shot(page, kind + '_휴지통');
  await page.locator('[data-action=trash-restore]').first().click();
  await waitText(page, '일정을 되살렸어요');

  await page.click('[data-admin-tab=pw]');
  await shot(page, kind + '_비밀번호');

  // 어두운 화면
  if (kind === '휴대폰') await page.click('.topbar [data-action=theme-toggle]');
  else await page.click('.side [data-theme-btn=dark]');
  await page.click('[data-admin-tab=staff]');
  await page.locator('.srow').nth(3).waitFor();
  await shot(page, kind + '_어둡게_교직원표');
  if (kind === '휴대폰') {
    await page.click('.bottom-nav [data-go=schedule]');
  } else {
    await page.click('.side [data-go=schedule]');
  }
  await page.locator(kind === '휴대폰' ? '.pweek' : '.cal').waitFor();
  await shot(page, kind + '_어둡게_일정');
  await page.evaluate(() => window.__gy.go('library'));
  await page.locator('.lib-card').first().waitFor();
  await shot(page, kind + '_어둡게_자료실');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.stu-card').scrollIntoViewIfNeeded();
  await shot(page, kind + '_어둡게_홈_학생수');
  await zoomFlow(page, kind);
  await ctx.close();
}

/** '이름+개인 번호'로 바꿨을 때: 번호 칸·번호 단추가 다시 나오고 1111로 들어가진다 */
async function pinModeCheck(browser) {
  const ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('번호 방식 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.locator('.srow').nth(3).waitFor();
  await page.click('[data-admin-tab=settings]');
  await page.locator('[data-set="본인 확인 방식"]').selectOption('이름+개인 번호');
  await page.click('#set-form [type=submit]');
  await waitText(page, '본인 확인 방식을 바꿨어요');
  await page.click('[data-admin-tab=staff]');
  await page.locator('[data-action=staff-pin]').first().waitFor();
  await shot(page, '번호방식_교직원표');
  await page.locator('.srow', { hasText: '심청' }).locator('[data-action=staff-pin]').click();
  await page.click('#cf-ok');
  await page.locator('.pin-big').waitFor();
  await shot(page, '번호방식_개인번호_한번만');
  await page.click('[data-action=close-pins]');
  await page.click('.side [data-action=identity]');
  await page.locator('#id-pin').waitFor();
  await page.locator('.person', { hasText: '성춘향' }).click();
  await page.fill('#id-pin', '9999');
  await page.click('#id-form [type=submit]');
  await waitText(page, '남은 기회는 4번');
  await shot(page, '번호방식_번호_틀림');
  await page.fill('#id-pin', '1111');
  await page.click('#id-form [type=submit]');
  await waitText(page, '성춘향 선생님, 본인 확인이 됐어요');
  await ctx.close();
}

/** PDF 쪽수: pdfinfo가 있으면 그것으로, 없으면 /Type /Page 수를 센다 */
function pdfPages(file) {
  try { return Number(/Pages:\s+(\d+)/.exec(require('child_process').execFileSync('pdfinfo', [file]).toString())[1]); } catch (e) { /* 아래로 */ }
  return (fs.readFileSync(file).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
}
let planInfo = '';
let meetInfo = ''; // 회의록 인쇄·워드 파일(판 2026-10-22a)

async function printCheck(browser) {
  const ctx = await newCtx(browser, { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await login(page);
  await verify(page, '홍길동');
  await page.emulateMedia({ media: 'print' });
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.app')).backgroundColor);
  const sideShown = await page.evaluate(() => getComputedStyle(document.querySelector('.side')).display);
  if (bg !== 'rgb(255, 255, 255)') problems.push('인쇄: 바탕이 흰색이 아님 ' + bg);
  if (sideShown !== 'none') problems.push('인쇄: 메뉴가 숨겨지지 않음');
  await page.pdf({ path: path.join(OUT, '인쇄_홈.pdf'), format: 'A4' });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => { window.__gy.S.sched.view = 'plan'; window.__gy.go('schedule'); });
  await page.locator('table.plan').waitFor();
  await page.emulateMedia({ media: 'print' });
  const planBg = await page.evaluate(() => getComputedStyle(document.querySelector('.plan-card')).backgroundColor);
  if (!/rgba?\(255, 255, 255|rgba\(0, 0, 0, 0\)/.test(planBg)) problems.push('인쇄: 월별 계획 바탕이 흰색이 아님 ' + planBg);
  // 월별 계획은 A4 세로 한 장(교사 요청). page.pdf도 인쇄 직전 알림(beforeprint)을 보내 앱이 높이를 재고 줄인다
  const planPdf = async (name) => {
    const f = path.join(OUT, name);
    await page.pdf({ path: f, preferCSSPageSize: true });
    return { pages: pdfPages(f), zoom: await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--plan-zoom').trim()) };
  };
  let pp = await planPdf('인쇄_월별계획.pdf');
  if (pp.pages !== 1) problems.push('인쇄: 월별 계획이 ' + pp.pages + '쪽(한 장이어야 함)');
  // 공휴일·휴업일은 인쇄에도 빨강(교사 요청, 판 2026-10-21a): 날짜·요일·행사 이름 + 줄 바탕 연한 빨강, 토·일 요일도 빨강, 평일은 검정
  // 가짜 일정의 '테스트 공휴일'은 다음 주 월요일이라 이달에 없으면 다음 달에서 본다
  const RED = 'rgb(217, 45, 32)', INK = 'rgb(25, 31, 40)', TINT = 'rgb(251, 234, 233)';
  const toSched = async (view, sel) => {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate((v) => { window.__gy.S.sched.view = v; window.__gy.go('schedule'); }, view);
    await page.locator(sel).first().waitFor();
    if (!(await page.locator(view === 'cal' ? '.cal-d.off' : view === 'plan' ? 'table.plan tr.off' : '.ylist li.off').count())) {
      await page.click('[data-action=m-next]');
      await page.waitForTimeout(400);
      await page.locator(sel).first().waitFor();
    }
    await page.emulateMedia({ media: 'print' });
  };
  await toSched('plan', 'table.plan');
  const pc = await page.evaluate(() => {
    const st = (el, k) => (el ? getComputedStyle(el)[k] : null);
    const q = (s) => document.querySelector(s);
    const off = q('table.plan tr.off'), we = q('table.plan tr.we:not(.off)'), wd = q('table.plan tbody tr:not(.we):not(.off)');
    return {
      offDate: st(off && off.querySelector('.c-date'), 'color'), offDow: st(off && off.querySelector('.c-dow'), 'color'), offEv: st(off && off.querySelector('.plan-ev.off'), 'color'),
      offBg: st(off && off.querySelector('td'), 'backgroundColor'), weDow: st(we && we.querySelector('.c-dow'), 'color'), weDate: st(we && we.querySelector('.c-date'), 'color'),
      weBg: st(we && we.querySelector('td'), 'backgroundColor'), wdDow: st(wd && wd.querySelector('.c-dow'), 'color'), wdBg: st(wd && wd.querySelector('td'), 'backgroundColor')
    };
  });
  if (pc.offDate !== RED || pc.offDow !== RED || pc.offEv !== RED) problems.push('인쇄: 월별 계획의 공휴일·휴업일 날짜·요일·이름이 빨강이 아님 ' + JSON.stringify(pc));
  if (pc.offBg !== TINT) problems.push('인쇄: 월별 계획의 쉬는 날 줄 바탕이 연한 빨강이 아님 ' + pc.offBg);
  if (pc.weDow !== RED || pc.weDate !== INK) problems.push('인쇄: 월별 계획의 토·일은 요일만 빨강이어야 함 ' + JSON.stringify(pc));
  if (pc.wdDow !== INK || !/rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/.test(pc.wdBg) || !/rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/.test(pc.weBg)) problems.push('인쇄: 월별 계획의 평일·토·일 줄이 검정·흰 바탕이 아님 ' + JSON.stringify(pc));
  const offPdf = await planPdf('인쇄_월별계획_쉬는날.pdf');
  if (offPdf.pages !== 1) problems.push('인쇄: 쉬는 날이 있는 달의 월별 계획이 ' + offPdf.pages + '쪽');
  for (const [view, sel, name] of [['cal', '.cal-d', '인쇄_달력_쉬는날.pdf'], ['year', '.ylist', '인쇄_연간학사일정.pdf']]) {
    await toSched(view, sel);
    const c = await page.evaluate((v) => {
      const st = (el) => (el ? getComputedStyle(el).color : null);
      const q = (s) => document.querySelector(s);
      return v === 'cal' ? { num: st(q('.cal-d.off .cal-num')), ev: st(q('.ev-off')), plain: st(q('.cal-d:not(.off):not(.other) .cal-num')) }
        : { num: st(q('.ylist li.off .yd')), ev: st(q('.ylist li.off .plan-ev.off')), plain: st(q('.ylist li:not(.off) .yd')) };
    }, view);
    if (view === 'cal') {
      const lg = await page.evaluate(() => getComputedStyle(document.querySelector('.lg-off')).backgroundColor);
      if (lg !== RED) problems.push('인쇄: 달력 색 설명의 휴업일·공휴일 네모가 빨강이 아님 ' + lg);
    }
    if (c.num !== RED || c.ev !== RED || c.plain !== INK) problems.push('인쇄: ' + (view === 'cal' ? '달력' : '연간 학사일정') + '의 공휴일·휴업일이 빨강(나머지는 검정)이 아님 ' + JSON.stringify(c));
    await page.pdf({ path: path.join(OUT, name), format: 'A4' });
  }
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => { window.__gy.S.sched.view = 'plan'; window.__gy.go('schedule'); });
  await page.locator('table.plan').waitFor();
  await page.click('[data-action=m-today]');
  await page.waitForTimeout(400);
  await page.locator('table.plan').waitFor();
  await page.emulateMedia({ media: 'print' });
  // 행사가 아주 많은 달(날마다 4개씩, 긴 이름)도 한 장
  await page.emulateMedia({ media: 'screen' });
  const made = await page.evaluate(async () => {
    const S = window.__gy.S, y = S.sched.y, m = S.sched.m, last = new Date(y, m, 0).getDate(), jobs = [];
    for (let d = 1; d <= last; d++) {
      const ds = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      for (let k = 0; k < 4; k++) {
        jobs.push(window.__gy.server('sched.save', { id: '', fields: { start: ds, end: '', time: k ? '15:00' : '5교시', title: (k % 2 ? '교육활동 ' : '행사 ') + d + '-' + (k + 1) + ' 길게 적은 행사 이름 시험', kind: k % 2 ? '교육활동' : '행사', target: ['전체'], deptId: '', place: '', memo: '', important: k === 0 } }));
      }
    }
    await Promise.all(jobs);
    return jobs.length;
  });
  await page.evaluate(() => { window.__gy.S.sched.view = 'plan'; window.__gy.go('schedule'); });
  await page.locator('table.plan').waitFor();
  await page.emulateMedia({ media: 'print' });
  pp = await planPdf('인쇄_월별계획_행사많은달.pdf');
  if (pp.pages !== 1) problems.push('인쇄: 행사가 많은 달(' + made + '개 더함)의 월별 계획이 ' + pp.pages + '쪽(한 장이어야 함)');
  if (!(Number(pp.zoom) < 1)) problems.push('인쇄: 행사가 많은 달인데 줄이지 않음(' + pp.zoom + ')');
  planInfo = '월별 계획 인쇄 1장(보통 달 그대로, 행사 ' + made + '개 더한 달은 ' + Math.round(Number(pp.zoom) * 100) + '%로 줄임)';
  for (const [scr, sel, name] of [['staff', '.dir-row', '인쇄_교직원명단.pdf'], ['guide', '.guide-card', '인쇄_운영안내서.pdf']]) {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate((x) => window.__gy.go(x), scr);
    await page.locator(sel).first().waitFor();
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, name), format: 'A4' });
  }
  await ctx.close();
}

/** 달력에서 끌어서 날짜 옮기기(교사 요청): PC 마우스(그만두기·옮기기·여러 날·남의 일정·그냥 누르기), 휴대폰 한 달 보기 터치(길게 눌러 끌기·짧게 누르기) */
async function dragCheck(browser) {
  const shotP = async (page, name) => { n++; await page.screenshot({ path: path.join(OUT, String(n).padStart(2, '0') + '_' + name + '.png') }); };
  const monthDays = (page) => page.evaluate(() => {
    const S = window.__gy.S, ym = S.sched.y + '-' + String(S.sched.m).padStart(2, '0');
    return Array.from(document.querySelectorAll('.cal-d[data-day]')).map((c) => c.getAttribute('data-day')).filter((d) => d.slice(0, 7) === ym);
  });
  const plus = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  const make = (page, start, end, title) => page.evaluate(([a, b, t]) => window.__gy.server('sched.save', { id: '', fields: { start: a, end: b, time: '', title: t, kind: '행사', target: ['전체'], deptId: '', place: '', memo: '', important: false } }), [start, end, title]);
  const mid = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const mouseDrag = async (page, from, to) => {
    const a = await mid(page, from), b = await mid(page, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
    await page.mouse.up();
  };
  const asked = (page) => page.locator('#cf-ok').waitFor({ timeout: 3000 }).then(() => true, () => false);
  const modalText = async (page) => (await page.locator('#modal-root').innerText()).replace(/\s+/g, ' ');
  const chip = (day, id) => `.cal-d[data-day="${day}"] [data-ev="${id}"]`;

  // ---------- PC: 마우스로 끌기
  let ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('끌기 PC 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '성춘향');
  await page.evaluate(() => { window.__gy.S.sched.view = 'cal'; window.__gy.go('schedule'); });
  await page.locator('.cal').waitFor();
  const mon = (await monthDays(page)).find((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1 && Number(d.slice(8)) >= 5);
  const tue = plus(mon, 1), thu = plus(mon, 3);
  const one = await make(page, mon, '', '끌기 시험 행사');
  const two = await make(page, mon, tue, '이틀 행사 시험');
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator(chip(mon, one.id)).waitFor();
  if (!(await page.locator(chip(mon, one.id) + '[data-drag]').count())) problems.push('끌기: 내가 넣은 행사인데 끌 수 없음');
  if (!(await page.locator('.cal-card .hint', { hasText: '끌어다 놓으면' }).count())) problems.push('끌기: 달력 아래 안내가 안 보임');
  // 그냥 누르면 지금처럼 열린다
  await page.click(chip(mon, one.id));
  if (!(await page.locator('.ev-dl').waitFor({ timeout: 3000 }).then(() => true, () => false))) problems.push('끌기: 행사를 그냥 눌렀는데 열리지 않음');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // 끌어서 목요일 → 묻는 창 → 그만두기면 그대로
  await mouseDrag(page, chip(mon, one.id), `.cal-d[data-day="${thu}"]`);
  if (!(await asked(page))) problems.push('끌기: 끌어 놓았는데 옮길지 묻지 않음');
  else {
    const t = await modalText(page);
    if (!/옮길까요/.test(t) || !t.includes('→')) problems.push('끌기: 묻는 창 글이 이상함 ' + t);
    await shotP(page, 'PC_달력_끌기_묻는창');
    await page.click('#modal-root [data-action=close-modal]');
    await page.waitForTimeout(300);
    if (!(await page.locator(chip(mon, one.id)).count())) problems.push('끌기: 그만두기를 눌렀는데 옮겨짐');
  }
  // 다시 끌어서 옮기기
  await mouseDrag(page, chip(mon, one.id), `.cal-d[data-day="${thu}"]`);
  if (await asked(page)) {
    await page.click('#cf-ok');
    await waitText(page, '옮겼어요');
    const ok = await page.locator(chip(thu, one.id)).waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (!ok || (await page.locator(chip(mon, one.id)).count())) problems.push('끌기: 옮기기를 눌렀는데 목요일로 가지 않음');
    await shotP(page, 'PC_달력_끌기_옮김');
  } else problems.push('끌기: 두 번째로 끌었는데 묻지 않음');
  // 여러 날 행사: 화요일 칸을 잡고 목요일에 놓으면 이틀 뒤로(수~목)
  await mouseDrag(page, chip(tue, two.id), `.cal-d[data-day="${thu}"]`);
  if (await asked(page)) {
    await page.click('#cf-ok');
    await waitText(page, '옮겼어요');
    await page.locator(chip(thu, two.id)).waitFor({ timeout: 5000 }).catch(() => {});
    const e2 = await page.evaluate((id) => (window.__gy.S.sched.data && window.__gy.S.sched.data.events.find((e) => e.id === id)) || {}, two.id);
    if (e2.start !== plus(mon, 2) || e2.end !== thu) problems.push('끌기: 여러 날 행사가 기간 그대로 옮겨지지 않음(' + e2.start + '~' + e2.end + ')');
  } else problems.push('끌기: 여러 날 행사를 끌었는데 묻지 않음');
  // 남의 행사(고칠 수 없음)는 끌리지 않는다
  const other = page.locator('.cal .ev:not([data-drag])').first();
  if (await other.count()) {
    const oid = await other.getAttribute('data-ev'), oday = await other.evaluate((el) => el.closest('.cal-d').getAttribute('data-day'));
    const target = (await monthDays(page)).find((d) => d !== oday);
    await mouseDrag(page, chip(oday, oid), `.cal-d[data-day="${target}"]`);
    await page.waitForTimeout(400);
    if ((await page.locator('#cf-ok').count()) || (await page.locator('.drag-ghost').count())) problems.push('끌기: 고칠 수 없는 행사가 끌림');
    await page.keyboard.press('Escape');
  } else problems.push('끌기: 점검할 남의 행사가 달력에 없음');
  await ctx.close();

  // ---------- 휴대폰: 한 달 보기에서 길게 눌러 끌기(터치)
  ctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('끌기 휴대폰 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '성춘향');
  await page.evaluate(() => { window.__gy.S.sched.view = 'cal'; window.__gy.S.sched.phoneMonth = true; window.__gy.go('schedule'); });
  await page.locator('.cal').waitFor();
  const pmon = (await monthDays(page)).find((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1 && Number(d.slice(8)) >= 5);
  const pwed = plus(pmon, 2);
  const p1 = await make(page, pmon, '', '휴대폰 끌기');
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator(chip(pmon, p1.id)).waitFor();
  await page.locator(chip(pmon, p1.id)).scrollIntoViewIfNeeded();
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  let a = await mid(page, chip(pmon, p1.id));
  await touch('touchStart', a);
  await page.waitForTimeout(80);
  await touch('touchEnd');
  if (!(await page.locator('.ev-dl').waitFor({ timeout: 3000 }).then(() => true, () => false))) problems.push('끌기(휴대폰): 짧게 눌렀는데 행사가 열리지 않음');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  a = await mid(page, chip(pmon, p1.id));
  const b = await mid(page, `.cal-d[data-day="${pwed}"]`);
  await touch('touchStart', a);
  await page.waitForTimeout(550);
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8 });
  await shotP(page, '휴대폰_달력_길게눌러_끌기');
  await touch('touchEnd');
  if (await asked(page)) {
    await page.click('#cf-ok');
    await waitText(page, '옮겼어요');
    if (!(await page.locator(chip(pwed, p1.id)).waitFor({ timeout: 5000 }).then(() => true, () => false))) problems.push('끌기(휴대폰): 옮기기를 눌렀는데 수요일로 가지 않음');
  } else problems.push('끌기(휴대폰): 길게 눌러 끌었는데 묻지 않음');
  await ctx.close();
}

/** 열 때 성춘향으로 미리 로그인해 두는 미리보기 사본(임시 폴더, 끝나면 지움). 인트로 뒤에 홈이 이어지는지 보려고 쓴다 */
let loggedIn = '';
function loggedInCopy() {
  if (loggedIn) return loggedIn;
  const src = fs.readFileSync(PREVIEW, 'utf8');
  const hook = '  window.__previewSheet = env._ss;';
  if (!src.includes(hook)) throw new Error('미리보기에 미리 로그인을 끼울 자리가 없어요');
  const auto = `  (function () {
    var call = function (a, args, tk) { return JSON.parse(api(JSON.stringify({ action: a, args: args || {}, tokens: tk || {} }))); };
    var L = call('login', { password: 'preview1' }).data.login;
    var me = call('staffPicker', {}, { login: L }).data.filter(function (x) { return x.name === '성춘향'; })[0];
    localStorage.setItem('gy.login', L);
    localStorage.setItem('gy.identity', call('verify', { staffId: me.id }, { login: L }).data.identity);
  })();
`;
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gy-shots-'));
  const f = path.join(dir, '미리보기_로그인됨.html');
  fs.writeFileSync(f, src.replace(hook, () => auto + hook));
  loggedIn = serveFile('미리보기_로그인됨.html', f);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return loggedIn;
}

/** 교표(책 모양 로고 대신, 판 2026-10-17e): 로그인 화면·PC 메뉴(밝은·어두운 화면)·휴대폰 위 막대의 로고가 교표 그림으로 칠해지는지
 * 로고 칸을 찍어 교표의 남색 테두리·초록 줄기·주황 입 색을 세어 보고, 빛 알갱이를 그릴 수 없을 때 대신 나오는 '짧게' 여는 그림의 로고도 본다 */
async function emblemCheck(browser) {
  async function look(page, sel, label, wantW) {
    const el = page.locator(sel).first();
    await el.waitFor();
    const info = await el.evaluate((m) => {
      const cs = getComputedStyle(m);
      return { cls: m.className, png: cs.backgroundImage.indexOf('url("data:image/png;base64,') === 0, radius: cs.borderTopLeftRadius, svg: !!m.querySelector('svg'), w: Math.round(m.getBoundingClientRect().width) };
    });
    if (!/emblem/.test(info.cls) || !info.png || info.svg) problems.push(label + ': 로고가 교표가 아님 ' + JSON.stringify(info));
    if (info.radius !== '50%') problems.push(label + ': 교표 칸이 동그랗지 않음(' + info.radius + ')');
    if (wantW && info.w !== wantW) problems.push(label + ': 교표 크기 ' + info.w + 'px (기대 ' + wantW + 'px)');
    const png = (await el.screenshot()).toString('base64');
    const k = await page.evaluate(async (b64) => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + b64;
      await im.decode();
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      const g = cv.getContext('2d');
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const c = { navy: 0, green: 0, orange: 0 };
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gr = d[i + 1], b = d[i + 2];
        if (b > 70 && b - r > 40 && b - gr > 30 && r < 110) c.navy++;
        else if (gr > 120 && gr - r > 25 && gr - b > 50) c.green++;
        else if (r > 190 && gr > 70 && gr < 170 && b < 110) c.orange++;
      }
      return c;
    }, png);
    if (k.navy < 200 || k.green < 100 || k.orange < 10) problems.push(label + ': 교표 색이 보이지 않음 ' + JSON.stringify(k));
  }
  async function clip(page, name, box) {
    n++;
    await page.screenshot({ path: path.join(OUT, String(n).padStart(2, '0') + '_' + name + '.png'), clip: box });
  }
  // PC: 로그인 화면 → 메뉴(밝은 화면) → 메뉴(어두운 화면)
  let ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  let page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('교표 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await look(page, '.gate-top .brand-mark', '교표 로그인 화면', 40);
  const gb = await page.locator('.gate-top').boundingBox();
  await clip(page, '교표_로그인화면', { x: gb.x - 16, y: gb.y - 16, width: gb.width + 32, height: gb.height + 32 });
  await login(page);
  await verify(page, '홍길동');
  await look(page, '.side .brand-mark', '교표 PC 메뉴(밝은 화면)', 40);
  await clip(page, '교표_PC메뉴_밝은화면', { x: 0, y: 0, width: 248, height: 96 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await look(page, '.side .brand-mark', '교표 PC 메뉴(어두운 화면)', 40);
  await clip(page, '교표_PC메뉴_어두운화면', { x: 0, y: 0, width: 248, height: 96 });
  await ctx.close();
  // 휴대폰: 위 막대(36px)
  ctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('교표 휴대폰 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await look(page, '.topbar .brand-mark', '교표 휴대폰 위 막대', 36);
  await clip(page, '교표_휴대폰_위막대', { x: 0, y: 0, width: 390, height: 60 });
  await ctx.close();
  // 여는 그림 '짧게'(빛 알갱이를 그릴 수 없을 때): 그림 묶음을 비워 짧게로 열고, 교표가 가운데 떴다가 메뉴 교표 자리로 들어가는지
  ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, true);
  await ctx.addInitScript(() => { Object.defineProperty(window, '__gyIntroKinds', { value: Object.freeze({}), writable: false }); });
  await slowServer(ctx, 2500);
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('교표 여는 그림(짧게) 페이지 오류: ' + e.message));
  await page.goto(loggedInCopy());
  await page.locator('#gy-intro.gi-short .gi-logo').waitFor({ timeout: 5000 });
  await page.waitForTimeout(700);
  const lg = await page.evaluate(() => {
    const e = document.querySelector('#gy-intro .gi-logo'), cs = getComputedStyle(e);
    return { png: cs.backgroundImage.indexOf('url("data:image/png;base64,') === 0, radius: cs.borderTopLeftRadius, svg: !!e.querySelector('svg') };
  });
  if (!lg.png || lg.radius !== '50%' || lg.svg) problems.push('여는 그림(짧게) 로고가 교표가 아님 ' + JSON.stringify(lg));
  n++;
  await page.screenshot({ path: path.join(OUT, String(n).padStart(2, '0') + '_교표_여는그림_짧게.png') });
  await page.waitForFunction(() => !document.getElementById('gy-intro'), null, { timeout: 10000 }).catch(() => problems.push('여는 그림(짧게)이 걷히지 않음'));
  await look(page, '.side .brand-mark', '교표 여는 그림(짧게) 뒤 메뉴', 40);
  await ctx.close();
}

/** 여는 그림 인사(판 2026-10-17f): 열 때마다 응원 문장 20개 중 하나이고 바로 전 문장과 다르며, 가장 긴 문장에 이름을 붙여도
 * PC는 한 줄, 휴대폰은 두 줄 안에 들어가는지 본다(줄 수는 글자를 잠깐 바꿔 넣고 재고 되돌린다) */
let helloInfo = '';
async function helloCheck(browser) {
  const out = [];
  for (const [label, vp, phone] of [['PC', { width: 1280, height: 800 }, false], ['휴대폰 390', { width: 390, height: 844 }, true], ['휴대폰 360', { width: 360, height: 740 }, true]]) {
    const ctx = await newCtx(browser, { viewport: vp, hasTouch: phone, isMobile: phone }, true);
    await slowServer(ctx, 1500);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('인사 ' + label + ' 페이지 오류: ' + e.message));
    let prev = null;
    const shown = [];
    for (let k = 0; k < (phone ? 3 : 6); k++) {
      await page.goto(FILE);
      await page.locator('#gy-intro .gib-hello').waitFor({ state: 'attached', timeout: 5000 });
      const r = await page.evaluate(() => {
        const el = document.querySelector('#gy-intro .gib-hello'), H = window.__gyIntroU.HELLOS;
        const now = el.textContent, lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
        let most = 0, worst = '';
        H.forEach((x) => { el.textContent = '홍길동 선생님, ' + x; const n = Math.round(el.getBoundingClientRect().height / lh); if (n > most) { most = n; worst = x; } });
        el.textContent = now;
        return { now, ok: H.indexOf(now) >= 0, most, worst };
      });
      if (!r.ok) problems.push('인사 ' + label + ': 응원 문장 20개 중 하나가 아님(' + r.now + ')');
      if (r.now === prev) problems.push('인사 ' + label + ': 바로 전과 같은 문장이 또 나옴(' + r.now + ')');
      if (r.most > (phone ? 2 : 1)) problems.push('인사 ' + label + ': 이름을 붙인 문장이 ' + r.most + '줄(' + r.worst + ')');
      if (k === 0) out.push(label + ' 가장 많은 줄 ' + r.most + '줄');
      prev = r.now;
      shown.push(r.now);
      await page.waitForFunction(() => !document.getElementById('gy-intro'), null, { timeout: 12000 }).catch(() => problems.push('인사 ' + label + ': 여는 그림이 걷히지 않음'));
    }
    if (label === 'PC') out.push('PC에서 연 ' + shown.length + '번: ' + shown.join(' / '));
    await ctx.close();
  }
  helloInfo = '인사: ' + out.join(', ');
}

/** 화면 디자인(판 2026-10-17g): 선생님마다 기기에서 기본·장도·종이색을 고른다. PC는 메뉴 아래, 휴대폰은 '전체' 메뉴에서 고르면
 * 곧바로(부드럽게) 바뀌고, 다시 열어도 처음 그릴 때부터 그 디자인. 밝게·어둡게와 함께 쓰는지 포인트 색으로 보고 디자인마다 사진을 찍는다 */
async function designCheck(browser) {
  const want = { base: { light: '#1B64DA', dark: '#4795FF' }, jangdo: { light: '#2B3990', dark: '#93A3FF' }, paper: { light: '#A0502A', dark: '#E89C64' } };
  const label = { base: '기본', jangdo: '장도', paper: '종이색' };
  const state = (page) => page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-design') || 'base', saved: localStorage.getItem('gy.design'),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase(),
    anim: document.documentElement.classList.contains('design-anim')
  }));
  let ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('디자인 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor();
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 5000 }).catch(() => {});
  const seg = await page.evaluate(() => {
    const el = document.querySelector('.side .design-seg');
    return el ? { n: el.querySelectorAll('[data-design-btn]').length, over: el.scrollWidth > el.clientWidth + 1, pressed: (el.querySelector('[aria-pressed="true"]') || {}).textContent } : null;
  });
  if (!seg || seg.n !== 3) problems.push('디자인: PC 메뉴 아래에 고르기 3개가 없음 ' + JSON.stringify(seg));
  else {
    if (seg.over) problems.push('디자인: 고르기 단추가 메뉴 폭을 넘침');
    if (seg.pressed !== '기본') problems.push('디자인: 처음이 기본이 아님(' + seg.pressed + ')');
  }
  for (const d of ['jangdo', 'paper', 'base']) {
    for (const th of ['light', 'dark']) {
      await page.click('.side [data-theme-btn=' + th + ']');
      if (th === 'light') {
        await page.click('.side [data-design-btn=' + d + ']');
        const st = await state(page);
        if (st.attr !== d || st.saved !== d) problems.push('디자인: ' + label[d] + '를 눌렀는데 ' + JSON.stringify(st));
        if (!st.anim) problems.push('디자인: ' + label[d] + '로 바꿀 때 부드럽게 바뀌지 않음');
        await page.waitForTimeout(500);
      }
      const st = await state(page);
      if (st.accent !== want[d][th]) problems.push('디자인: ' + label[d] + ' ' + th + '의 포인트 색이 ' + st.accent + ' (기대 ' + want[d][th] + ')');
      if (d !== 'base') await shot(page, '디자인_' + label[d] + '_' + (th === 'dark' ? '어둡게' : '밝게') + '_PC홈');
    }
  }
  // 다시 열어도 그대로: 처음 그릴 때(머리 스크립트)부터 그 디자인, 고르기 단추도 그 디자인
  await page.click('.side [data-theme-btn=light]');
  await page.click('.side [data-design-btn=paper]');
  await page.reload({ waitUntil: 'domcontentloaded' });
  const early = await page.evaluate(() => document.documentElement.getAttribute('data-design'));
  if (early !== 'paper') problems.push('디자인: 다시 열었을 때 처음부터 종이색이 아님(' + early + ')');
  await page.locator('#app > *').first().waitFor();
  await ctx.close();
  // 휴대폰: '전체' 메뉴에서 고르기, 장도 밝게는 위 막대가 남색
  ctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('디자인 휴대폰 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor();
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 5000 }).catch(() => {});
  for (const d of ['jangdo', 'paper', 'base']) {
    await page.click('.bottom-nav [data-action=sheet]');
    await page.locator('#sheet .design-seg').waitFor();
    await page.locator('#sheet .design-seg').scrollIntoViewIfNeeded();
    if (d === 'jangdo') await shot(page, '디자인_휴대폰_전체메뉴에서_고르기');
    await page.locator('#sheet [data-design-btn=' + d + ']').click();
    await page.click('#sheet [data-action=close-sheet]');
    await page.waitForTimeout(500);
    const st = await state(page);
    if (st.attr !== d || st.accent !== want[d].light) problems.push('디자인: 휴대폰에서 ' + label[d] + '를 골랐는데 ' + JSON.stringify(st));
    if (d === 'jangdo') {
      const bar = await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor);
      if (bar !== 'rgb(35, 44, 111)') problems.push('디자인: 장도 휴대폰 위 막대가 남색이 아님(' + bar + ')');
    }
    if (d !== 'base') await shot(page, '디자인_' + label[d] + '_휴대폰홈');
  }
  await ctx.close();
}

/**
 * 함께 쓰는 표(판 2026-10-17h): 다른 분 화면(잠근 열·고르고 쓰기·이어 쓰기·되돌리기·고르기 열), 다른 분이 고친 칸(10초 새로 받기),
 * 같은 칸 동시에(묻는 창), 여러 칸 고르기·복사·붙여 넣기(넘치면 묻고 줄 더하기), 줄 더하기·빼기, 만든 분(열·마감·엑셀·인쇄 A4 가로),
 * 새 표(구글 시트 붙여 넣기: 합친 칸·바탕색·열 너비·고르기 열), 휴대폰(줄 목록·줄 고치기·표로 보기), 어둡게·장도
 * 다른 선생님은 같은 가짜 서버에 그분 이름으로 바로 요청해 흉내 낸다(as)
 */
let tableInfo = '';
/** 함께 쓰는 표 점검 도구(tableCheck·table2Check가 함께 쓴다) */
function tbKit(browser) {
  const cell = (i, j) => '#tb-wrap td.tb-c[data-i="' + i + '"][data-j="' + j + '"]';
  const text = (page, i, j) => page.evaluate((s) => {
    const td = document.querySelector(s);
    if (!td) return null;
    const c = td.cloneNode(true);
    c.querySelectorAll('.tb-tip').forEach((x) => x.remove());
    return c.textContent.trim();
  }, cell(i, j));
  const saved = (page, what) => page.waitForFunction(() => !document.querySelector('#tb-wrap td.saving') && !document.querySelector('.tb-rowcard.saving'), null, { timeout: 5000 })
    .then(() => page.waitForTimeout(150), () => problems.push('표: 저장이 끝나지 않음(' + what + ')'));
  const toastHas = (page, re) => page.waitForFunction((src) => {
    const t = document.querySelector('#toast');
    return !!t && t.classList.contains('show') && new RegExp(src).test(t.textContent);
  }, re.source, { timeout: 4000 }).then(() => true, () => false);
  const pollNow = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const rowsN = (page) => page.evaluate(() => window.__gy.S.table.d ? window.__gy.S.table.d.rows.length : -1);
  const as = (page, name, action, args) => page.evaluate(async ([nm, a, ar]) => {
    const login = localStorage.getItem('gy.login') || sessionStorage.getItem('gy.login');
    const call = (x, y, tok) => window.__previewServer(JSON.stringify({ action: x, args: y || {}, tokens: tok })).then((t) => JSON.parse(t));
    const staff = (await call('staffPicker', {}, { login })).data;
    const p = staff.find((s) => s.name === nm);
    const identity = (await call('verify', { staffId: p.id, pin: '1111', remember: false }, { login })).data.identity;
    return call(a, ar, { login, identity });
  }, [name, action, args]);
  const copyOut = (page) => page.evaluate(() => {
    const ed = document.querySelector('#tb-ed'), d = new DataTransfer();
    ed.dispatchEvent(new ClipboardEvent('copy', { clipboardData: d, bubbles: true, cancelable: true }));
    return { text: d.getData('text/plain'), html: d.getData('text/html') };
  });
  const pasteIn = (page, sel, html, txt) => page.evaluate(([s, h, t]) => {
    const el = document.querySelector(s), d = new DataTransfer();
    if (h) d.setData('text/html', h);
    d.setData('text/plain', t || '');
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true }));
  }, [sel, html, txt]);
  const open = async (vp, name, phone, init) => {
    const ctx = await newCtx(browser, { viewport: vp, deviceScaleFactor: 1, isMobile: !!phone, hasTouch: !!phone });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('표 페이지 오류: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/pretendard|ERR_|net::/i.test(m.text())) problems.push('표 콘솔: ' + m.text()); });
    await page.goto(FILE);
    await waitText(page, '어서 오세요');
    await login(page);
    await verify(page, name);
    await page.locator('.today-card').waitFor();
    await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 5000 }).catch(() => {});
    return { ctx, page };
  };
  const toList = (page) => page.evaluate(() => { window.__gy.S.table.sel = ''; window.__gy.S.table.d = null; window.__gy.go('table'); }); // 메뉴를 누른 것처럼 목록부터
  const openTable = async (page, title) => {
    await toList(page);
    await page.locator('.tb-card').first().waitFor();
    await page.locator('.tb-card', { hasText: title }).first().click();
    await page.locator('#tb-detail .tb-bar .chip').first().waitFor();
    await page.waitForTimeout(200);
    return page.evaluate(() => window.__gy.S.table.sel);
  };

  return { cell, text, saved, toastHas, pollNow, rowsN, as, copyOut, pasteIn, open, toList, openTable };
}

async function tableCheck(browser) {
  const { cell, text, saved, toastHas, pollNow, rowsN, as, copyOut, pasteIn, open, toList, openTable } = tbKit(browser);
  // ---------- 1) 다른 분(심청) PC: 보기·고치기
  let { ctx, page } = await open({ width: 1440, height: 900 }, '심청');
  await page.click('.side [data-go=table]');
  await page.locator('.tb-card').first().waitFor();
  if ((await page.locator('.tb-card').count()) !== 3) problems.push('표: 목록에 예시 표 3개가 아님');
  const prog = await page.locator('.tb-card .tb-prog b').first().innerText();
  if (prog !== '완료 6 · 미완료 4') problems.push('표: 목록의 고르기 수가 ' + prog);
  await shot(page, '표_목록_PC');
  await page.locator('.tb-card', { hasText: '2026 폐기' }).click();
  await page.locator(cell(0, 0)).waitFor();
  const tid = await page.evaluate(() => window.__gy.S.table.sel);
  const look = await page.evaluate(() => ({
    merged: document.querySelectorAll('#tb-wrap td.merged').length, paint: document.querySelectorAll('#tb-wrap td.paint').length,
    locks: document.querySelectorAll('#tb-wrap th .lk').length, ro: document.querySelectorAll('#tb-wrap td.ro').length, owner: !!document.querySelector('[data-action=tb-menu]')
  }));
  if (look.merged !== 3) problems.push('표: 층 열이 위아래로 합쳐지지 않음(' + look.merged + ')');
  if (look.paint !== 23) problems.push('표: 붙여 넣은 바탕색 칸 수가 ' + look.paint + ' (기대 23)');
  if (look.locks !== 3 || look.ro !== 23) problems.push('표: 잠근 열 표시가 다름 ' + JSON.stringify(look));
  if (look.owner) problems.push('표: 만든 분이 아닌데 표 고치기 단추가 보임');
  await shot(page, '표_PC_다른분');
  await page.click(cell(1, 1));
  await page.keyboard.type('x');
  if (!(await toastHas(page, /잠겨 있어요/))) problems.push('표: 잠근 열에 쓰려고 하면 안내가 나와야 함');
  if (await page.locator('#tb-ed.on').count()) problems.push('표: 잠근 열인데 고치는 칸이 열림');
  await page.click(cell(0, 4));
  if (await page.locator('#tb-ed.on').count()) problems.push('표: 한 번 누르면 고르기만 해야 함(구글 시트처럼)');
  await page.keyboard.type('사물함 1개');
  await page.keyboard.press('Enter');
  await saved(page, '고르고 쓰기');
  if ((await text(page, 0, 4)) !== '사물함 1개') problems.push('표: 고르고 쓴 칸이 ' + (await text(page, 0, 4)));
  const cur = await page.evaluate(() => { const c = document.querySelector('#tb-wrap td.cur'); return c ? c.getAttribute('data-i') + ':' + c.getAttribute('data-j') : ''; });
  if (cur !== '1:4') problems.push('표: Enter 뒤 아래 칸으로 가지 않음(' + cur + ')');
  await page.click(cell(1, 4));
  await page.keyboard.type(', 책상');
  await page.keyboard.press('Enter');
  await saved(page, '이어 쓰기');
  if ((await text(page, 1, 4)) !== '의자 8개(플라스틱 및 스텐), 책상') problems.push('표: 한 번 더 눌러 이어 쓰기가 안 됨(' + (await text(page, 1, 4)) + ')');
  await page.keyboard.press('Control+z');
  await saved(page, '되돌리기');
  if ((await text(page, 1, 4)) !== '의자 8개(플라스틱 및 스텐)') problems.push('표: Ctrl+Z로 되돌리지 못함(' + (await text(page, 1, 4)) + ')');
  let srv = (await as(page, '흥부', 'table.get', { id: tid })).data;
  if (srv.rows[0].cells.c5 !== '사물함 1개' || srv.rows[1].cells.c5 !== '의자 8개(플라스틱 및 스텐)') problems.push('표: 서버에 저장된 값이 다름');
  await page.click(cell(0, 3) + ' .tb-pick');
  await page.locator('.tb-menu').waitFor();
  await shot(page, '표_고르기열_PC');
  await page.locator('.tb-menu button:has(span:text-is("완료"))').click();
  await saved(page, '고르기');
  const bar = await page.locator('#tb-bar').innerText();
  if (!/완료 7/.test(bar) || !/미완료 3/.test(bar)) problems.push('표: 고른 뒤 표 위 수가 그대로(' + bar.replace(/\s+/g, ' ') + ')');
  // 다른 분이 고친 칸: 10초 새로 받기(여기서는 바로 받기)로 잠깐 파랗게 + 이름
  const before = (await as(page, '장화', 'table.get', { id: tid })).data;
  const r2 = before.rows[2], r3 = before.rows[3];
  await as(page, '장화', 'table.cell', { id: tid, row: r2.id, n: r2.n, col: 'c5', value: '장화가 넣은 값', base: (r2.stamps.c5 || [0])[0] });
  await pollNow(page);
  if (!(await page.locator(cell(2, 4) + '.flash .tb-tip').waitFor({ timeout: 4000 }).then(() => true, () => false))) problems.push('표: 다른 분이 고친 칸이 새로 받기로 보이지 않음');
  else {
    if (!/장화 선생님 · 방금/.test(await page.locator(cell(2, 4) + ' .tb-tip').innerText())) problems.push('표: 고친 분 이름이 보이지 않음');
    if ((await text(page, 2, 4)) !== '장화가 넣은 값') problems.push('표: 다른 분이 고친 값이 보이지 않음');
    await shot(page, '표_다른분이_고친칸_PC');
  }
  // 같은 칸을 동시에: 심청이 쓰기 시작한 뒤 장화가 먼저 저장 → 묻는 창
  await page.click(cell(3, 4));
  await page.keyboard.type('심청 값');
  await as(page, '장화', 'table.cell', { id: tid, row: r3.id, col: 'c5', value: '장화 먼저', base: 0 });
  await page.keyboard.press('Enter');
  if (!(await page.getByText('다른 선생님이 먼저 고쳤어요').waitFor({ timeout: 4000 }).then(() => true, () => false))) problems.push('표: 같은 칸을 동시에 고쳤는데 묻지 않음');
  else {
    const box = await page.locator('.modal').innerText();
    if (!/장화 먼저/.test(box) || !/심청 값/.test(box) || !/장화 선생님/.test(box)) problems.push('표: 묻는 창에 두 값·고친 분이 없음');
    if ((await text(page, 3, 4)) !== '장화 먼저') problems.push('표: 묻는 동안 먼저 고친 값이 보여야 함(' + (await text(page, 3, 4)) + ')');
    await shot(page, '표_같은칸_동시에_PC');
    await page.click('#tb-mine');
    await saved(page, '내 값으로');
    if ((await text(page, 3, 4)) !== '심청 값') problems.push('표: 내 값으로 바꾸기가 안 됨');
  }
  // 끌어서 여러 칸 고르기 → 복사(구글 시트에 붙일 글·바탕색)
  const b1 = await page.locator(cell(0, 2)).boundingBox(), b2 = await page.locator(cell(1, 3)).boundingBox();
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 5 });
  await page.mouse.up();
  const nsel = await page.locator('#tb-wrap td.tb-c.sel').count();
  if (nsel !== 4) problems.push('표: 끌어서 고른 칸이 ' + nsel + '개(기대 4)');
  const out = await copyOut(page);
  if (out.text !== '홍길동\t완료\n성춘향\t완료') problems.push('표: 복사한 글이 ' + JSON.stringify(out.text));
  if (!/background-color:#F4CCCC/.test(out.html)) problems.push('표: 복사한 표에 바탕색이 없음');
  await shot(page, '표_여러칸_고르기_PC');
  // 구글 시트에서 복사한 세 칸 붙여 넣기
  await page.click(cell(4, 4));
  await pasteIn(page, '#tb-ed', '<google-sheets-html-origin><table><tbody><tr><td>가</td></tr><tr><td>나</td></tr><tr><td>다</td></tr></tbody></table>', '가\n나\n다');
  await saved(page, '붙여 넣기');
  const p3 = [await text(page, 4, 4), await text(page, 5, 4), await text(page, 6, 4)].join(',');
  if (p3 !== '가,나,다') problems.push('표: 세 칸 붙여 넣기가 ' + p3);
  if (!(await toastHas(page, /3칸을 붙여 넣었어요/))) problems.push('표: 붙여 넣은 칸 수 안내가 없음');
  // 잠근 칸에 붙여 넣기는 건너뜀
  await page.click(cell(4, 1));
  await pasteIn(page, '#tb-ed', '', 'A\tB');
  if (!(await toastHas(page, /잠긴 칸이라 붙여 넣지 않았어요/))) problems.push('표: 잠근 칸에 붙여 넣을 때 안내가 없음');
  // 표 아래로 넘치면 묻고 줄을 더한다
  await page.click(cell(9, 4));
  await pasteIn(page, '#tb-ed', '', 'ㄱ\nㄴ\nㄷ');
  if (!(await page.getByText('줄 더해서 붙여 넣기').first().waitFor({ timeout: 3000 }).then(() => true, () => false))) problems.push('표: 넘치는 붙여 넣기를 묻지 않음');
  else {
    await shot(page, '표_붙여넣기_넘침_묻기');
    await page.click('#cf-ok');
    await page.waitForFunction(() => window.__gy.S.table.d.rows.length === 12, null, { timeout: 5000 }).catch(() => {});
    await saved(page, '줄 더해 붙여 넣기');
    if ((await rowsN(page)) !== 12 || (await text(page, 11, 4)) !== 'ㄷ') problems.push('표: 줄을 더해 붙여 넣지 못함(줄 ' + (await rowsN(page)) + ')');
  }
  // 키보드: 화살표·Delete
  await page.click(cell(4, 4));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Delete');
  await saved(page, '비우기');
  if ((await text(page, 5, 4)) !== '') problems.push('표: Delete로 비우지 못함');
  // 줄 메뉴: 아래에 줄 더하기(층은 위 줄 값을 이어 받아 합친 칸이 커짐) → 내가 더한 줄은 잠근 칸도 고침 → 빼기
  await page.click('#tb-wrap tbody tr:nth-child(1) .tb-rowbtn');
  await page.locator('.tb-menu').waitFor();
  await page.locator('.tb-menu button', { hasText: '아래에 줄 더하기' }).click();
  await page.waitForFunction(() => window.__gy.S.table.d.rows.length === 13, null, { timeout: 5000 }).catch(() => problems.push('표: 아래에 줄 더하기가 안 됨'));
  await page.waitForTimeout(200);
  if ((await page.locator(cell(0, 0)).getAttribute('rowspan')) !== '4') problems.push('표: 아래에 더한 줄이 층 칸에 합쳐지지 않음');
  if (await page.locator(cell(1, 1) + '.ro').count()) problems.push('표: 내가 더한 줄의 잠근 칸을 고칠 수 없음');
  await page.keyboard.type('상담실');
  await page.keyboard.press('Enter');
  await saved(page, '더한 줄 쓰기');
  if ((await text(page, 1, 1)) !== '상담실') problems.push('표: 더한 줄에 쓴 값이 ' + (await text(page, 1, 1)));
  await shot(page, '표_아래에_줄더하기_PC');
  await page.click('#tb-wrap tbody tr:nth-child(2) .tb-rowbtn');
  await page.locator('.tb-menu').waitFor();
  const canDel = await page.locator('.tb-menu button', { hasText: '줄 빼기' }).count();
  if (!canDel) problems.push('표: 내가 더한 줄인데 빼기가 없음');
  else {
    await page.locator('.tb-menu button', { hasText: '줄 빼기' }).click();
    await page.click('#cf-ok');
    await page.waitForFunction(() => window.__gy.S.table.d.rows.length === 12, null, { timeout: 5000 }).catch(() => problems.push('표: 줄 빼기가 안 됨'));
  }
  await page.click('#tb-wrap tbody tr:nth-child(1) .tb-rowbtn');
  await page.locator('.tb-menu').waitFor();
  if (await page.locator('.tb-menu button', { hasText: '줄 빼기' }).count()) problems.push('표: 다른 분이 넣은 줄인데 빼기가 보임');
  await page.keyboard.press('Escape');
  // 어둡게·장도
  await page.click('.side [data-theme-btn=dark]');
  await page.waitForTimeout(300);
  await shot(page, '표_어둡게_PC');
  await page.click('.side [data-theme-btn=light]');
  await page.click('.side [data-design-btn=jangdo]');
  await page.waitForTimeout(500);
  await shot(page, '표_장도_PC');
  await page.click('.side [data-design-btn=base]');
  // 만든 분이 그사이 열을 더하면 새로 받기로 머리글이 바뀐다
  const colsNow = (await as(page, '흥부', 'table.get', { id: tid })).data.table.cols;
  await as(page, '흥부', 'table.cols', { id: tid, cols: colsNow.concat([{ name: '확인한 날' }]) });
  await pollNow(page);
  if (!(await page.locator('#tb-wrap th', { hasText: '확인한 날' }).waitFor({ timeout: 4000 }).then(() => true, () => false))) problems.push('표: 다른 분이 더한 열이 새로 받기로 보이지 않음');
  // 보고 있는 표를 만든 분이 지우면 목록으로
  const tid3 = await openTable(page, '배정 시간표');
  await as(page, '놀부', 'table.delete', { id: tid3 });
  await pollNow(page);
  if (!(await toastHas(page, /이 표가 지워졌어요/))) problems.push('표: 보던 표가 지워졌는데 알리지 않음');
  await page.locator('.tb-card').first().waitFor({ timeout: 4000 }).catch(() => problems.push('표: 지워진 표를 보던 화면이 목록으로 가지 않음'));
  await ctx.close();

  // ---------- 2) 만든 분(흥부) PC: 열 고치기·마감·엑셀·인쇄
  ({ ctx, page } = await open({ width: 1280, height: 900 }, '흥부'));
  const tid2 = await openTable(page, '2026 폐기');
  await page.click('[data-action=tb-menu]');
  await page.locator('.tb-menu').waitFor();
  await shot(page, '표_만든분_표고치기_메뉴');
  await page.locator('.tb-menu button', { hasText: '표 이름·마감 고치기' }).click();
  await page.locator('#tbe-title').waitFor();
  await modalSettled(page);
  await page.fill('#tbe-desc', '실마다 버리기 어려운 가구를 적어 주세요(예시). 10월 24일까지예요.');
  await shot(page, '표_이름마감_고치기');
  await page.click('#tbe-save');
  await page.locator('.tb-desc', { hasText: '10월 24일까지예요' }).waitFor({ timeout: 4000 }).catch(() => problems.push('표: 표 설명을 고쳤는데 보이지 않음'));
  await page.click('[data-action=tb-menu]');
  await page.locator('.tb-menu').waitFor();
  await page.locator('.tb-menu button', { hasText: '열 고치기' }).click();
  await page.locator('#tbc-list .tb-colrow').first().waitFor();
  await page.click('#tbc-add');
  await page.locator('#tbc-list .tb-cn').last().fill('비고');
  await shot(page, '표_열고치기');
  await page.click('#tbc-save');
  await page.waitForFunction(() => window.__gy.S.table.d && window.__gy.S.table.d.table.cols.length === 6, null, { timeout: 5000 }).catch(() => problems.push('표: 열 더하기가 안 됨'));
  await page.locator('#tb-wrap th', { hasText: '비고' }).waitFor({ timeout: 3000 }).catch(() => problems.push('표: 더한 열이 보이지 않음'));
  await page.click('[data-action=tb-menu]');
  await page.locator('.tb-menu button', { hasText: '지금 마감' }).click();
  await page.click('#cf-ok');
  await page.getByText('마감한 표예요').first().waitFor({ timeout: 5000 }).catch(() => problems.push('표: 마감했는데 표시가 없음'));
  const r0 = (await as(page, '흥부', 'table.get', { id: tid2 })).data.rows[0];
  const closedTry = await as(page, '심청', 'table.cell', { id: tid2, row: r0.id, col: 'c5', value: '마감 뒤', base: 0 });
  if (closedTry.code !== 'CLOSED') problems.push('표: 마감한 표를 다른 분이 고칠 수 있음(' + closedTry.code + ')');
  await shot(page, '표_마감_만든분');
  await page.click('[data-action=tb-menu]');
  await page.locator('.tb-menu button', { hasText: '다시 열기' }).click();
  await page.click('#cf-ok');
  await page.waitForFunction(() => !window.__gy.S.table.d.table.closed, null, { timeout: 5000 }).catch(() => problems.push('표: 다시 열기가 안 됨'));
  await page.click('[data-action=tb-csv]');
  await page.locator('#tbx-dl').waitFor();
  await shot(page, '표_엑셀로_받기');
  const csvDl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('#tbx-dl');
  const dl = await csvDl;
  if (!dl) problems.push('표: 엑셀(CSV) 파일을 내려받지 못함');
  else {
    const f = await dl.path();
    const csv = fs.readFileSync(f, 'utf8');
    if (csv.charCodeAt(0) !== 0xFEFF || !/^﻿"층","각 실","관리자","입력완료","배출이 어려운 가구","비고"\r\n"1층","교장실"/.test(csv)) problems.push('표: CSV 모양이 다름 ' + JSON.stringify(csv.slice(0, 80)));
  }
  await page.click('.modal [data-action=close-modal]');
  await page.emulateMedia({ media: 'print' });
  const pdf = path.join(OUT, '인쇄_함께쓰는표.pdf');
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  let size = '';
  try { size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(require('child_process').execFileSync('pdfinfo', [pdf]).toString()).slice(1, 3).map(Number).join('x'); } catch (e) { size = '?'; }
  const wh = size.split('x').map(Number); // A4 가로 297×210mm = 약 842×595pt(브라우저마다 소수점이 조금 다름)
  if (!(Math.abs(wh[0] - 842) < 3 && Math.abs(wh[1] - 595) < 3)) problems.push('표: 인쇄가 A4 가로가 아님(' + size + ')');
  if (await page.evaluate(() => !!document.querySelector('#tb-page'))) problems.push('표: 인쇄가 끝났는데 가로 인쇄 설정이 남음');
  // 지우기 → 목록에서 사라지고 관리자 휴지통에서 되살리기
  await page.click('[data-action=tb-menu]');
  await page.locator('.tb-menu button', { hasText: '표 지우기' }).click();
  await page.click('#cf-ok');
  await page.locator('.tb-card').first().waitFor();
  if (await page.locator('.tb-card', { hasText: '2026 폐기' }).count()) problems.push('표: 지운 표가 목록에 남음');
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=trash]');
  await page.locator('[data-action=trash-restore-tb]').first().waitFor({ timeout: 5000 }).catch(() => problems.push('표: 관리자 휴지통에 지운 표가 없음'));
  if (await page.locator('[data-action=trash-restore-tb]').count()) {
    await page.locator('[data-action=trash-restore-tb]').first().click();
    await toastHas(page, /표를 되살렸어요/);
    await toList(page);
    await page.locator('.tb-card', { hasText: '2026 폐기' }).first().waitFor({ timeout: 5000 }).catch(() => problems.push('표: 되살린 표가 목록에 없음'));
  }
  // ---------- 3) 새 표: 구글 시트에서 복사한 칸 붙여 넣기
  await toList(page);
  await page.locator('[data-action=tb-new]').click();
  await page.locator('#tbm-paste').waitFor();
  await modalSettled(page);
  await page.fill('#tbm-title', '2학기 상담 주간 신청(예시)');
  const sheetHtml = '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>' +
    '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1">' +
    '<colgroup><col width="70"/><col width="90"/><col width="120"/><col width="90"/><col width="220"/></colgroup><tbody>' +
    '<tr style="height:21px;"><td style="font-weight:bold;">학년</td><td style="font-weight:bold;">반</td><td style="font-weight:bold;">담임</td><td style="font-weight:bold;">신청</td><td style="font-weight:bold;">바라는 시간</td></tr>' +
    '<tr><td style="background-color:#d9ead3;" rowspan="2">1학년</td><td>1반</td><td>홍길동</td><td>O</td><td>화 3시</td></tr>' +
    '<tr><td>2반</td><td>성춘향</td><td></td><td></td></tr>' +
    '<tr><td style="background-color:#cfe2f3;" rowspan="2">2학년</td><td>1반</td><td>이몽룡</td><td>O</td><td>수 2시<br>또는 목 4시</td></tr>' +
    '<tr><td>2반</td><td>심청</td><td>O</td><td></td></tr>' +
    '<tr><td style="background-color:#fce5cd;">3학년</td><td>1반</td><td>흥부</td><td></td><td></td></tr>' +
    '</tbody></table>';
  await pasteIn(page, '#tbm-paste', sheetHtml, '학년\t반\t담임\t신청\t바라는 시간\n1학년\t1반\t홍길동\tO\t화 3시');
  await page.locator('#tbm-prev table').waitFor();
  const msg = await page.locator('#tbm-msg').innerText();
  if (msg !== '5줄 · 5열을 가져왔어요(글꼴·색·테두리·합친 칸·열 너비 그대로)') problems.push('표: 붙여 넣은 뒤 안내가 ' + msg);
  const made = await page.evaluate(() => window.__gy.S.table.make.cols.map((c) => [c.name, c.type, c.options.join('/'), c.lock, c.merge, c.w].join(':')));
  const wantCols = ['학년:text::true:false:70', '반:text::true:false:90', '담임:text::true:false:120', '신청:pick:O:false:false:90', '바라는 시간:text::false:false:220'];
  if (made.join('|') !== wantCols.join('|')) problems.push('표: 붙여 넣은 열 모양이 다름 ' + JSON.stringify(made));
  await shot(page, '표_새표_붙여넣기');
  await page.click('#tbm-go');
  await page.locator(cell(0, 0)).waitFor({ timeout: 6000 }).catch(() => problems.push('표: 새 표를 만든 뒤 표가 열리지 않음'));
  const nt = await page.evaluate(() => {
    const d = window.__gy.S.table.d;
    return d ? { rows: d.rows.length, m: JSON.stringify(((d.rows[0].fmt || {}).c1 || {}).m) === JSON.stringify([d.rows[1].id, 'c1']), two: d.rows[1].cells.c1 || '',
      multi: d.rows[2].cells.c5, paint: d.rows[0].colors.c1, span: (document.querySelector('#tb-wrap td.tb-c[rowspan]') || {}).rowSpan } : null;
  });
  // 구글 시트처럼 합친 칸은 첫 칸에만 값(덮인 칸은 빈칸)
  if (!nt || nt.rows !== 5 || !nt.m || nt.two !== '' || nt.multi !== '수 2시\n또는 목 4시' || nt.paint !== '#D9EAD3' || nt.span !== 2) problems.push('표: 만든 표 내용이 다름 ' + JSON.stringify(nt));
  await shot(page, '표_새표_만든뒤');
  // 붙여 넣을 표가 없으면 빈 표로(열 3개·빈 줄 10개, 열 이름은 바꿔서)
  await toList(page);
  await page.locator('[data-action=tb-new]').click();
  await page.waitForTimeout(150); // 창이 열리며 이름 칸으로 옮기는 포커스가 끝난 뒤(사람이 누르는 빠르기)
  await page.locator('#tbm-how [data-how="blank"]').click();
  await page.locator('#tbm-prev .tb-cn').first().fill('학년');
  await page.locator('#tbm-prev .tb-cn').nth(1).fill('방과후 강사');
  await page.fill('#tbm-title', '빈 표 시험');
  await page.click('#tbm-go');
  await page.locator(cell(0, 0)).waitFor({ timeout: 6000 }).catch(() => {});
  const blank = await page.evaluate(() => { const d = window.__gy.S.table.d; return d ? d.rows.length + '줄 ' + d.table.cols.map((c) => c.name).join(',') : ''; });
  if (blank !== '10줄 학년,방과후 강사,열 3') problems.push('표: 빈 표로 만들기가 다름(' + blank + ')');
  await ctx.close();

  // ---------- 4) 휴대폰(390): 줄 목록 → 줄 고치기, 표로 보기
  ({ ctx, page } = await open({ width: 390, height: 844 }, '장화', true));
  await openTable(page, '2026 폐기');
  await page.locator('.tb-rowcard').first().waitFor();
  await shot(page, '표_휴대폰_줄목록');
  await page.locator('.tb-rowcard', { hasText: '컴퓨터실' }).click();
  await page.locator('#sheet .tb-seg').waitFor();
  await shot(page, '표_휴대폰_줄고치기');
  await page.locator('#sheet .tb-seg button', { hasText: /^완료$/ }).click();
  await page.locator('#sheet textarea.tb-ta').last().fill('모니터 2대');
  await page.click('#tbf-save');
  await page.waitForFunction(() => { const d = window.__gy.S.table.d; const r = d && d.rows.find((x) => x.cells.c2 === '컴퓨터실'); return r && r.cells.c4 === '완료' && r.cells.c5 === '모니터 2대' && !(r.pending && Object.keys(r.pending).length); }, null, { timeout: 5000 })
    .catch(() => problems.push('표: 휴대폰 줄 고치기 저장이 안 됨'));
  await page.click('[data-action=tb-view][data-v=grid]');
  await page.locator('#tb-wrap').waitFor();
  await shot(page, '표_휴대폰_표로보기');
  await ctx.close();
  tableInfo = '함께 쓰는 표: 다른 분·만든 분·새 표·휴대폰 점검, 인쇄 ' + size;
}

/**
 * 함께 쓰는 표 2판(판 2026-10-18a): 시트 여러 개·도구 막대(서식)·열 너비·줄 높이·보기(왼쪽 열 고정·줄 간격)·
 * 정렬·걸러 보기(내 화면만)·찾기·바꾸기·시트 메뉴·휴지통·휴대폰 시트 단추·인쇄
 */
let table2Info = '';
async function table2Check(browser) {
  const { cell, saved, toastHas, pollNow, as, open, openTable, pasteIn, copyOut } = tbKit(browser);
  const P = (m) => problems.push('표2: ' + m);
  const srv = async (page, who, args) => (await as(page, who, 'table.get', args)).data;
  const fmtOf = (d, i, cid) => ((d.rows[i] || {}).fmt || {})[cid] || {};
  const tool = (page, k) => page.click('#tt-' + k);
  const menuPick = async (page, re) => {
    await page.locator('.tb-menu').waitFor();
    await page.locator('.tb-menu button', { hasText: re }).first().click();
  };
  const sheetNames = (page) => page.evaluate(() => window.__gy.S.table.d.doc.sheets.map((s) => s.name).join('|'));
  const waitSheet = (page, name) => page.waitForFunction((x) => {
    const T = window.__gy.S.table;
    return T.d && T.d.table.name === x && !T.loading && !!document.querySelector('#tb-wrap td.tb-c');
  }, name, { timeout: 6000 }).then(() => page.waitForTimeout(150), () => P('시트 "' + name + '"(으)로 바뀌지 않음'));
  /** 서버에 저장될 때까지 기다린다(열 너비·줄 높이·보기처럼 칸이 흐려지지 않는 저장) */
  const until = async (page, label, fn) => {
    for (let k = 0; k < 25; k++) {
      if (await fn()) return true;
      await page.waitForTimeout(200);
    }
    P(label);
    return false;
  };
  const sheetMenu = async (page, re) => {
    await page.click('#tb-tabs .tb-tab[aria-selected="true"] .tchv');
    await menuPick(page, re);
  };

  // ---------- 1) 만든 분(성춘향) PC: 시트 3개·서식이 보이고, 도구 막대로 서식을 바꾼다
  let { ctx, page } = await open({ width: 1440, height: 900 }, '성춘향');
  const did = await openTable(page, '업무 협의');
  await page.locator(cell(0, 0)).waitFor();
  if ((await sheetNames(page)) !== '폐기 물품|특별실 시간표|상담 주간') P('시트가 ' + (await sheetNames(page)));
  const tabTexts = (await page.locator('#tb-tabs .tb-tab').allInnerTexts()).map((x) => x.trim());
  if (tabTexts.join('|') !== '폐기 물품|특별실 시간표|상담 주간') P('아래 시트 탭 글이 ' + JSON.stringify(tabTexts));
  const look = await page.evaluate(() => {
    const q = (s) => document.querySelector(s), td = q('#tb-wrap td.tb-c[data-i="4"][data-j="4"]'), cs = getComputedStyle(td);
    return {
      frz: document.querySelectorAll('#tb-wrap th.frz').length, end: document.querySelectorAll('#tb-wrap th.frz-end').length,
      color: cs.color, w: cs.fontWeight, h: q('#tb-wrap tr[data-i="2"]').offsetHeight, span: q('#tb-wrap td.tb-c[data-i="0"][data-j="0"]').rowSpan,
      bd: getComputedStyle(q('#tb-wrap td.tb-c[data-i="2"][data-j="4"]')).borderBottomWidth, tools: q('#tb-tools').offsetHeight,
      own: !!q('#tb-tabs [data-action=tb-sheet-add]') && !!q('#tb-tabs .tchv')
    };
  });
  if (look.frz !== 2 || look.end !== 1) P('왼쪽 2열 고정이 보이지 않음 ' + JSON.stringify(look));
  if (look.color !== 'rgb(204, 0, 0)' || look.w !== '800') P('글자 색·굵게가 보이지 않음 ' + look.color + ' ' + look.w);
  if (look.h < 66) P('줄 높이(68)가 보이지 않음 ' + look.h);
  if (look.span !== 3) P('합친 칸(1층, 3줄)이 ' + look.span);
  if (look.bd !== '2px') P('굵은 아래 테두리가 ' + look.bd);
  if (look.tools > 52) P('도구 막대가 두 줄(1440) ' + look.tools);
  if (!look.own) P('만든 분인데 시트 더하기·시트 메뉴가 없음');
  await shot(page, '표2_시트여러개_PC');

  // 서식: 굵게(Ctrl+B)·글꼴·크기·글자 색·채우기 → 도구 막대가 고른 칸의 서식을 보여 줌 → 되돌리기·다시 하기
  await page.click(cell(0, 5));
  await page.keyboard.press('Control+b');
  await saved(page, '굵게');
  let d = await srv(page, '심청', { id: did });
  if (fmtOf(d, 0, 'c6').b !== 1) P('Ctrl+B 굵게가 저장되지 않음 ' + JSON.stringify(fmtOf(d, 0, 'c6')));
  await tool(page, 'font');
  await page.locator('.tb-menu').waitFor();
  await shot(page, '표2_글꼴_메뉴');
  await menuPick(page, '바탕');
  await saved(page, '글꼴');
  await tool(page, 'fsp');
  await saved(page, '크기');
  await tool(page, 'fc');
  await page.locator('.tb-pop .tb-pal').waitFor();
  await shot(page, '표2_글자색_고르기');
  await page.click('.tb-pop [data-hex="#1155CC"]');
  await saved(page, '글자 색');
  await tool(page, 'fill');
  await page.locator('.tb-pop .tb-pal').waitFor();
  await page.click('.tb-pop [data-hex="#FFF2CC"]');
  await saved(page, '채우기');
  d = await srv(page, '심청', { id: did });
  const f0 = fmtOf(d, 0, 'c6');
  if (f0.ff !== 'batang' || f0.fs !== 12 || f0.fc !== '#1155CC' || d.rows[0].colors.c6 !== '#FFF2CC') P('서식 저장이 다름 ' + JSON.stringify(f0) + ' ' + d.rows[0].colors.c6);
  const bar = await page.evaluate(() => ({ b: document.querySelector('#tt-b').getAttribute('aria-pressed'), font: document.querySelector('#tt-font-l').textContent, fs: document.querySelector('#tt-fs').value }));
  if (bar.b !== 'true' || bar.font !== '바탕' || bar.fs !== '12') P('도구 막대가 칸 서식을 보여 주지 않음 ' + JSON.stringify(bar));
  await page.keyboard.press('Control+z');
  await saved(page, '서식 되돌리기');
  d = await srv(page, '심청', { id: did });
  if (d.rows[0].colors.c6) P('Ctrl+Z로 채우기를 되돌리지 못함');
  await page.keyboard.press('Control+y');
  await saved(page, '서식 다시 하기');
  d = await srv(page, '심청', { id: did });
  if (d.rows[0].colors.c6 !== '#FFF2CC') P('Ctrl+Y로 다시 하지 못함');
  // 글자 크기 칸에 직접 적기
  await page.fill('#tt-fs', '16');
  await page.press('#tt-fs', 'Enter');
  await saved(page, '크기 적기');
  if (fmtOf(await srv(page, '심청', { id: did }), 0, 'c6').fs !== 16) P('글자 크기 칸에 적은 크기가 저장되지 않음');

  // 열 이름을 누르면 그 열 전체 → 굵게 → 되돌리기
  await page.click('#tb-wrap th[data-j="5"]', { position: { x: 20, y: 18 } });
  if ((await page.locator('#tb-wrap td.tb-c.sel').count()) < 9) P('열 이름을 눌러 열 전체를 고르지 못함');
  await page.keyboard.press('Control+b');
  await saved(page, '열 전체 굵게');
  d = await srv(page, '심청', { id: did });
  const boldN = d.rows.filter((r, i) => fmtOf(d, i, 'c6').b === 1).length;
  if (boldN !== 10) P('열 전체 굵게가 ' + boldN + '칸(기대 10)');
  await page.keyboard.press('Control+z');
  await saved(page, '열 전체 굵게 되돌리기');
  d = await srv(page, '심청', { id: did });
  if (d.rows.filter((r, i) => fmtOf(d, i, 'c6').b === 1).length !== 1) P('열 전체 굵게를 되돌리지 못함');

  // 구글 시트에서 서식·합친 칸과 함께 복사한 칸 붙여 넣기 → 되돌리기
  await page.click(cell(8, 4));
  await pasteIn(page, '#tb-ed', '<meta charset="utf-8"><google-sheets-html-origin><table style="font-size:10pt;font-family:Arial"><tbody>' +
    '<tr><td style="font-weight:bold;color:#cc0000;" rowspan="2">합친 글</td><td>둘째</td></tr><tr><td style="background-color:#d9ead3;">셋째</td></tr></tbody></table>', '합친 글\t둘째\n\t셋째');
  await saved(page, '서식 붙여 넣기');
  d = await srv(page, '심청', { id: did });
  const pf = fmtOf(d, 8, 'c5');
  if (d.rows[8].cells.c5 !== '합친 글' || pf.b !== 1 || pf.fc !== '#CC0000' || JSON.stringify(pf.m) !== JSON.stringify([d.rows[9].id, 'c5'])) P('서식·합친 칸 붙여 넣기가 다름 ' + JSON.stringify(pf));
  if (d.rows[8].cells.c6 !== '둘째' || d.rows[9].cells.c6 !== '셋째' || d.rows[9].colors.c6 !== '#D9EAD3' || (d.rows[9].cells.c5 || '') !== '' || fmtOf(d, 9, 'c6').ff) P('붙여 넣은 칸이 다름 ' + JSON.stringify([d.rows[8].cells, d.rows[9].cells, d.rows[9].colors]));
  // 이 표에서 복사하면 서식·합친 칸이 함께 간다(구글 시트에 붙일 HTML)
  await page.click(cell(8, 4));
  await page.click(cell(9, 5), { modifiers: ['Shift'] });
  const out2 = await copyOut(page);
  if (!/rowspan="2"/.test(out2.html) || !/font-weight:bold/.test(out2.html) || !/color:#CC0000/.test(out2.html) || out2.text !== '합친 글\t둘째\n\t셋째') P('서식째 복사가 다름 ' + JSON.stringify(out2.text) + ' ' + out2.html.slice(0, 160));
  await shot(page, '표2_서식붙여넣기');
  await page.keyboard.press('Control+z');
  await saved(page, '붙여 넣기 되돌리기');
  d = await srv(page, '심청', { id: did });
  if (d.rows[9].cells.c6 !== '※ 학년말에 한 번 더 확인' || fmtOf(d, 9, 'c6').ff !== 'batang' || fmtOf(d, 8, 'c5').m || d.rows[9].cells.c5 !== '실험대 2개') P('붙여 넣기를 되돌리지 못함 ' + JSON.stringify([d.rows[8].cells, d.rows[9].cells, fmtOf(d, 9, 'c6')]));

  // 여러 칸: 테두리 → 모두 합치기 → 가운데 맞춤 → 합치기 풀기 → 서식 지우기(Ctrl+\)
  await page.click(cell(5, 4));
  await page.click(cell(6, 5), { modifiers: ['Shift'] });
  await tool(page, 'bd');
  await page.locator('.tb-pop .tb-bgrid').waitFor();
  await shot(page, '표2_테두리_고르기');
  await page.click('.tb-pop [data-bd="all"]');
  await saved(page, '테두리');
  d = await srv(page, '심청', { id: did });
  if (fmtOf(d, 5, 'c5').bd !== '1111' || fmtOf(d, 6, 'c6').bd !== '1111') P('모든 테두리가 저장되지 않음 ' + fmtOf(d, 5, 'c5').bd + ' ' + fmtOf(d, 6, 'c6').bd);
  await tool(page, 'mg');
  await page.locator('.tb-menu').waitFor();
  await shot(page, '표2_칸합치기_메뉴');
  await menuPick(page, '모두 합치기');
  await saved(page, '합치기');
  d = await srv(page, '심청', { id: did });
  if (JSON.stringify(fmtOf(d, 5, 'c5').m) !== JSON.stringify([d.rows[6].id, 'c6'])) P('합친 칸이 저장되지 않음 ' + JSON.stringify(fmtOf(d, 5, 'c5').m));
  const mg = await page.evaluate(() => { const td = document.querySelector('#tb-wrap td.tb-c[data-i="5"][data-j="4"]'); return td ? td.rowSpan + 'x' + td.colSpan : ''; });
  if (mg !== '2x2') P('합친 칸이 표에 ' + mg);
  await tool(page, 'ha');
  await menuPick(page, '가운데 맞춤');
  await saved(page, '가운데 맞춤');
  if (fmtOf(await srv(page, '심청', { id: did }), 5, 'c5').ha !== 'c') P('가운데 맞춤이 저장되지 않음');
  await shot(page, '표2_서식_바꾼뒤');
  await page.click('.side [data-theme-btn=dark]');
  await page.waitForTimeout(300);
  await shot(page, '표2_서식_어둡게');
  await page.click('.side [data-theme-btn=light]');
  await page.waitForTimeout(200);
  await page.click(cell(5, 4));
  await tool(page, 'mg');
  await menuPick(page, '합치기 풀기');
  await saved(page, '합치기 풀기');
  d = await srv(page, '심청', { id: did });
  if (fmtOf(d, 5, 'c5').m) P('합치기를 풀지 못함');
  if (d.rows[5].cells.c5 !== 'tv 거치대') P('합치기를 푼 뒤 값이 ' + d.rows[5].cells.c5);
  await page.click(cell(5, 4));
  await page.click(cell(6, 5), { modifiers: ['Shift'] });
  await page.keyboard.press('Control+Backslash');
  await saved(page, '서식 지우기');
  d = await srv(page, '심청', { id: did });
  if (fmtOf(d, 5, 'c5').bd || fmtOf(d, 5, 'c5').ha || fmtOf(d, 6, 'c6').bd) P('서식 지우기가 안 됨 ' + JSON.stringify(fmtOf(d, 5, 'c5')));

  // 열 너비·줄 높이(끌기, 모든 분 화면에 함께) → 열 이름 ▾ '열 너비를 글에 맞추기'
  const w0 = (await srv(page, '심청', { id: did })).table.cols.find((c) => c.id === 'c5').w;
  const cr = await page.locator('#tb-wrap th[data-j="4"] .tb-cr').boundingBox();
  await page.mouse.move(cr.x + cr.width / 2, cr.y + cr.height / 2);
  await page.mouse.down();
  await page.mouse.move(cr.x + cr.width / 2 + 60, cr.y + cr.height / 2, { steps: 6 });
  await shot(page, '표2_열너비_끌기');
  await page.mouse.up();
  await until(page, '열 너비 끌기가 저장되지 않음', async () => Math.abs((await srv(page, '심청', { id: did })).table.cols.find((c) => c.id === 'c5').w - (w0 + 60)) <= 2);
  const h0 = await page.evaluate(() => document.querySelector('#tb-wrap tr[data-i="1"]').offsetHeight);
  const rr = await page.locator('#tb-wrap td.rn[data-ri="1"] .tb-rr').boundingBox();
  await page.mouse.move(rr.x + 20, rr.y + rr.height / 2);
  await page.mouse.down();
  await page.mouse.move(rr.x + 20, rr.y + rr.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await until(page, '줄 높이 끌기가 저장되지 않음', async () => Math.abs(((await srv(page, '심청', { id: did })).rows[1].h || 0) - (h0 + 40)) <= 2);
  await page.hover('#tb-wrap th[data-j="5"]');
  await page.click('#tb-wrap th[data-j="5"] .tb-hb');
  await page.locator('.tb-menu [data-fit]').click();
  await until(page, '열 너비를 글에 맞추지 못함', async () => { const w = (await srv(page, '심청', { id: did })).table.cols.find((c) => c.id === 'c6').w; return w !== 206 && w >= 60 && w <= 900; });

  // 보기: 왼쪽 열 고정·줄 간격(모든 분 화면에 함께)
  await tool(page, 'view');
  await page.locator('.tb-menu [data-fr="1"]').waitFor();
  await shot(page, '표2_보기_메뉴');
  await page.click('.tb-menu [data-fr="1"]');
  await until(page, '왼쪽 열 고정이 저장되지 않음', async () => (await srv(page, '심청', { id: did })).table.view.fr === 1);
  await tool(page, 'view');
  await page.click('.tb-menu [data-gap="w"]');
  await until(page, '줄 간격이 저장되지 않음', async () => (await srv(page, '심청', { id: did })).table.view.gap === 'w');
  if (!/gap-w/.test(await page.evaluate(() => document.querySelector('#tb-wrap table.tb-grid').className))) P('줄 간격 넓게가 보이지 않음');
  await tool(page, 'view');
  await page.click('.tb-menu [data-gap="n"]');
  await tool(page, 'view');
  await page.click('.tb-menu [data-fr="2"]');
  await until(page, '보기를 되돌리지 못함', async () => { const v = (await srv(page, '심청', { id: did })).table.view; return v.fr === 2 && v.gap === 'n'; });

  // 정렬·걸러 보기: 내 화면에서만(서버·다른 분 화면은 그대로)
  await page.hover('#tb-wrap th[data-j="3"]');
  await page.click('#tb-wrap th[data-j="3"] .tb-hb');
  await page.locator('.tb-menu .tb-fl').waitFor();
  await page.locator('.tb-menu .tb-fl label', { hasText: '미완료' }).locator('input').uncheck();
  await shot(page, '표2_걸러보기_메뉴');
  await page.click('.tb-menu [data-apply]');
  await page.waitForTimeout(200);
  if ((await page.evaluate(() => window.__gy.S.table.vrows.length)) !== 6) P('걸러 보기(완료만) 줄 수가 ' + (await page.evaluate(() => window.__gy.S.table.vrows.length)));
  if (!(await page.locator('.tb-local').count())) P('걸러 보기 중 알림이 없음');
  await page.hover('#tb-wrap th[data-j="2"]');
  await page.click('#tb-wrap th[data-j="2"] .tb-hb');
  await page.click('.tb-menu [data-sort="1"]');
  await page.waitForTimeout(200);
  const order = await page.evaluate(() => window.__gy.S.table.vrows.map((r) => r.cells.c3).join(','));
  if (order !== '성춘향,심청,이몽룡,장화,홍길동,홍련') P('가나다순 정렬이 ' + order);
  await shot(page, '표2_걸러보기_정렬_PC');
  d = await srv(page, '심청', { id: did });
  if (d.rows.length !== 10 || d.rows[0].cells.c2 !== '교장실') P('걸러 보기가 서버 순서를 바꿈');
  await page.click('[data-action=tb-local-clear]');
  await page.waitForTimeout(200);
  if ((await page.evaluate(() => window.__gy.S.table.vrows.map((r) => r.cells.c2)[0] + window.__gy.S.table.vrows.length)) !== '교장실10') P('모두 풀기가 안 됨');

  // 찾기·바꾸기(Ctrl+F): 이 시트에서 찾은 수, 다른 시트에서 찾은 수는 탭에 숫자로
  await page.click(cell(1, 4));
  await page.keyboard.press('Control+f');
  await page.locator('#tb-fq').waitFor();
  await page.fill('#tb-fq', '홍길동');
  await page.waitForTimeout(900);
  const fc = await page.locator('#tb-fcnt').innerText();
  if (fc !== '1/2') P('찾은 수가 ' + fc);
  const tabN = await page.locator('#tb-tabs .tb-tab', { hasText: '상담 주간' }).locator('.n').innerText().catch(() => '');
  if (tabN !== '1') P('다른 시트(상담 주간)에서 찾은 수가 탭에 ' + JSON.stringify(tabN));
  await page.press('#tb-fq', 'Enter');
  if ((await page.locator('#tb-fcnt').innerText()) !== '2/2') P('다음 찾기(Enter)가 안 됨');
  await shot(page, '표2_찾기바꾸기_PC');
  await page.fill('#tb-fr', '홍길순');
  await page.click('[data-action=tb-frep]');
  await until(page, '바꾸기가 저장되지 않음', async () => (await srv(page, '심청', { id: did })).rows[7].cells.c3 === '홍길순');
  await page.click('[data-action=tb-frepall]');
  await until(page, '모두 바꾸기가 저장되지 않음', async () => (await srv(page, '심청', { id: did })).rows[0].cells.c3 === '홍길순');
  await page.click('[data-action=tb-fclose]');

  // 시트 옮겨 다니기(아래 탭): 상담 주간은 날짜 칸을 위아래로 합친 시트
  await page.click('#tb-tabs .tb-tab:has-text("상담 주간")');
  await waitSheet(page, '상담 주간');
  const sp = await page.evaluate(() => document.querySelector('#tb-wrap td.tb-c[data-i="0"][data-j="0"]').rowSpan);
  if (sp !== 3) P('상담 주간의 합친 날짜 칸이 ' + sp);
  await shot(page, '표2_시트_상담주간');

  // 시트 메뉴(만든 분·관리): 이름 고치기 → 사본 → 왼쪽으로 옮기기 → 지우기
  await page.click('#tb-tabs .tb-tab[aria-selected="true"] .tchv');
  await page.locator('.tb-menu').waitFor();
  await shot(page, '표2_시트메뉴');
  await menuPick(page, '시트 이름·설명 고치기');
  await page.locator('#tbs-name').waitFor();
  await page.fill('#tbs-name', '상담 주간(2학기)');
  await page.click('#tbs-save');
  await waitSheet(page, '상담 주간(2학기)');
  await sheetMenu(page, '사본 만들기');
  await waitSheet(page, '상담 주간(2학기) 사본');
  if ((await sheetNames(page)) !== '폐기 물품|특별실 시간표|상담 주간(2학기)|상담 주간(2학기) 사본') P('사본 뒤 시트가 ' + (await sheetNames(page)));
  if ((await page.evaluate(() => document.querySelector('#tb-wrap td.tb-c[data-i="0"][data-j="0"]').rowSpan)) !== 3) P('사본에서 합친 칸이 깨짐');
  await sheetMenu(page, '왼쪽으로 옮기기');
  await page.waitForFunction(() => window.__gy.S.table.d.doc.sheets.map((s) => s.name).join('|') === '폐기 물품|특별실 시간표|상담 주간(2학기) 사본|상담 주간(2학기)', null, { timeout: 5000 })
    .catch(async () => P('왼쪽으로 옮기기 뒤 ' + (await sheetNames(page))));
  await sheetMenu(page, '시트 지우기');
  await page.click('#cf-ok');
  await page.waitForFunction(() => { const T = window.__gy.S.table; return T.d && T.d.doc.sheets.length === 3 && !T.loading; }, null, { timeout: 5000 }).catch(() => P('시트 지우기가 안 됨'));

  // 시트 더하기(+): 빈 시트 → 모든 시트(☰)에서 고르기
  await page.click('#tb-tabs [data-action=tb-sheet-add]');
  await page.locator('#tbm-sheet').waitFor();
  await page.click('#tbm-how [data-how="blank"]');
  await shot(page, '표2_시트더하기');
  await page.click('#tbm-go');
  await waitSheet(page, '시트4');
  const nb = await page.evaluate(() => { const x = window.__gy.S.table.d; return x.rows.length + '줄 ' + x.table.cols.length + '열'; });
  if (nb !== '10줄 3열') P('빈 시트가 ' + nb);
  await page.click('#tb-tabs [data-action=tb-sheet-list]');
  await page.locator('.tb-menu .tb-sl').first().waitFor();
  await shot(page, '표2_모든시트');
  await page.locator('.tb-menu .tb-sl', { hasText: '폐기 물품' }).click();
  await waitSheet(page, '폐기 물품');

  // 지운 시트는 관리자 › 휴지통에서 되살린다
  await page.click('#tb-tabs .tb-tab:has-text("시트4")');
  await waitSheet(page, '시트4');
  await sheetMenu(page, '시트 지우기');
  await page.click('#cf-ok');
  await page.waitForFunction(() => { const T = window.__gy.S.table; return T.d && T.d.doc.sheets.length === 3 && !T.loading; }, null, { timeout: 5000 }).catch(() => P('시트4 지우기가 안 됨'));
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=trash]');
  const sheetTrash = page.locator('[data-action=trash-restore-tb][data-kind=sheet]').first();
  if (!(await sheetTrash.waitFor({ timeout: 5000 }).then(() => true, () => false))) P('휴지통에 지운 시트가 없음');
  else {
    await sheetTrash.scrollIntoViewIfNeeded();
    await shot(page, '표2_휴지통_시트');
    await sheetTrash.click();
    if (!(await toastHas(page, /시트를 되살렸어요/))) P('시트를 되살렸다는 안내가 없음');
    await openTable(page, '업무 협의');
    await page.waitForTimeout(300);
    const names = await sheetNames(page);
    if (!/시트4/.test(names) || names.split('|').length !== 4) P('되살린 시트가 보이지 않음 ' + names);
  }
  await ctx.close();

  // ---------- 2) 다른 분(심청) 1280: 시트는 못 고치고, 서식은 고칠 수 있는 칸만. 만든 분이 바꾼 서식·열 너비가 새로 받기로 보인다
  ({ ctx, page } = await open({ width: 1280, height: 800 }, '심청'));
  const did2 = await openTable(page, '업무 협의');
  await page.locator(cell(0, 0)).waitFor();
  const lk = await page.evaluate(() => ({ add: !!document.querySelector('#tb-tabs [data-action=tb-sheet-add]'), menu: !!document.querySelector('#tb-tabs .tchv'), tools: document.querySelector('#tb-tools').offsetHeight }));
  if (lk.add) P('다른 분인데 시트 더하기가 보임');
  if (!lk.menu) P('다른 분에게 시트 메뉴(양식으로 저장)가 없음');
  else { // 다른 분의 시트 메뉴는 '양식으로 저장'만(판 2026-10-18b)
    await page.click('#tb-tabs .tb-tab[aria-selected="true"] .tchv');
    await page.locator('.tb-menu').waitFor();
    const items = (await page.locator('.tb-menu button').allInnerTexts()).map((x) => x.trim());
    if (items.join('|') !== '양식으로 저장') P('다른 분의 시트 메뉴가 ' + JSON.stringify(items));
    await page.keyboard.press('Escape');
  }
  if (lk.tools > 52) P('도구 막대가 두 줄(1280) ' + lk.tools);
  await page.click(cell(1, 4));
  await page.keyboard.press('Control+i');
  await saved(page, '다른 분 기울임');
  if (fmtOf(await srv(page, '흥부', { id: did2 }), 1, 'c5').i !== 1) P('다른 분이 고칠 수 있는 칸의 서식을 바꾸지 못함');
  await page.click(cell(1, 1));
  await page.click(cell(1, 4), { modifiers: ['Shift'] });
  await tool(page, 'mg');
  await menuPick(page, '가로로 합치기');
  if (!(await toastHas(page, /잠긴 열이 들어 있어/))) P('잠근 열을 합치려는데 안내가 없음');
  await page.click(cell(1, 1));
  await page.keyboard.press('Control+b');
  if (!(await toastHas(page, /잠겨 있어요/))) P('잠근 칸에 굵게를 하려는데 안내가 없음');
  const r3 = (await srv(page, '성춘향', { id: did2 })).rows[3];
  await as(page, '성춘향', 'table.cells', { id: did2, cells: [{ row: r3.id, n: r3.n, col: 'c5', fill: '#D9EAD3', f: { b: 1 } }] });
  await as(page, '성춘향', 'table.colw', { id: did2, w: { c6: 300 } });
  await pollNow(page);
  await page.waitForFunction(() => {
    const td = document.querySelector('#tb-wrap td.tb-c[data-i="3"][data-j="4"]');
    return td && td.classList.contains('paint') && getComputedStyle(td).fontWeight === '800';
  }, null, { timeout: 5000 }).catch(() => P('만든 분이 바꾼 서식이 새로 받기로 보이지 않음'));
  const w6 = await page.evaluate(() => window.__gy.S.table.d.table.cols.find((c) => c.id === 'c6').w);
  if (w6 !== 300) P('만든 분이 바꾼 열 너비가 새로 받기로 보이지 않음 ' + w6);
  await shot(page, '표2_다른분_1280');
  await ctx.close();

  // ---------- 3) 휴대폰(390): 위쪽 둥근 단추로 시트 고르기 → 줄 목록(합친 날짜 칸으로 묶음) → 줄 고치기
  ({ ctx, page } = await open({ width: 390, height: 844 }, '장화', true));
  await openTable(page, '업무 협의');
  await page.locator('.tb-msheets').waitFor();
  const pills = (await page.locator('.tb-msheets [data-action=tb-sheet]').allInnerTexts()).map((x) => x.trim());
  if (pills.join('|') !== '폐기 물품|특별실 시간표|상담 주간') P('휴대폰 시트 단추가 ' + JSON.stringify(pills));
  await shot(page, '표2_휴대폰_시트');
  await page.click('.tb-msheets [data-action=tb-sheet]:has-text("상담 주간")');
  await page.waitForFunction(() => { const T = window.__gy.S.table; return T.d && T.d.table.name === '상담 주간' && !T.loading && !!document.querySelector('.tb-rowcard'); }, null, { timeout: 6000 })
    .catch(() => P('휴대폰에서 시트를 바꾸지 못함'));
  const groups = (await page.locator('.tb-group').allInnerTexts()).map((x) => x.trim());
  if (groups.join('|') !== '10/26 (월)|10/27 (화)') P('휴대폰 줄 목록 묶음이 ' + JSON.stringify(groups));
  await shot(page, '표2_휴대폰_상담주간');
  await page.locator('.tb-rowcard').nth(1).click();
  await page.locator('#sheet .tb-seg').waitFor();
  if (!(await page.locator('#sheet', { hasText: '(합친 칸)' }).count())) P('휴대폰 줄 고치기에 합친 칸 표시가 없음');
  await shot(page, '표2_휴대폰_줄고치기');
  await ctx.close();

  // ---------- 4) 인쇄: 지금 시트만 A4 가로(도구 막대·시트 탭·줄 번호는 빼고)
  ({ ctx, page } = await open({ width: 1440, height: 900 }, '성춘향'));
  await openTable(page, '업무 협의');
  await page.locator(cell(0, 0)).waitFor();
  await page.emulateMedia({ media: 'print' });
  const hid = await page.evaluate(() => ['#tb-tools', '#tb-tabs', '#tb-wrap td.rn'].map((s) => getComputedStyle(document.querySelector(s)).display).join(','));
  if (hid !== 'none,none,none') P('인쇄에 도구 막대·시트 탭·줄 번호가 나옴 ' + hid);
  const pdf = path.join(OUT, '인쇄_함께쓰는표_시트.pdf');
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  let size = '';
  try { size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(require('child_process').execFileSync('pdfinfo', [pdf]).toString()).slice(1, 3).map(Number).join('x'); } catch (e) { size = '?'; }
  const wh = size.split('x').map(Number);
  if (!(Math.abs(wh[0] - 842) < 3 && Math.abs(wh[1] - 595) < 3)) P('인쇄가 A4 가로가 아님(' + size + ')');
  await ctx.close();
  table2Info = '함께 쓰는 표 2: 시트·서식·열 너비·줄 높이·보기·걸러 보기·찾기·휴지통·다른 분·휴대폰, 인쇄 ' + size;
}

/**
 * 취합 시트(예전 이름 함께 쓰는 표)·시트 양식(판 2026-10-18b): 메뉴·제목 이름, 새 표 만들기 › 양식에서 고르기(기본 양식 10개(2026-10-19a), 교직원 소속으로 채운 학년·반),
 * 시트 메뉴 › 양식으로 저장(잠근 열 글만), 시트 더하기 › 우리 학교 양식(이름 고치기·고르기·지우기), 관리자 › 휴지통 되살리기,
 * 다른 분의 시트 메뉴('양식으로 저장'만), 휴대폰에서 양식으로 새 표
 */
let tplInfo = '';
async function tplCheck(browser) {
  const { cell, toastHas, open, openTable, toList, as } = tbKit(browser);
  const P = (m) => problems.push('양식: ' + m);
  const line = (page) => page.evaluate(() => [...document.querySelectorAll('#tbm-prev .tb-prevt tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
  const waitPrev = (page) => page.locator('#tbm-prev .tb-prevt').waitFor({ timeout: 6000 }).then(() => true, () => { P('양식 미리보기가 보이지 않음'); return false; });
  const tplNames = (page) => page.locator('#tbm-tplbox .tb-tpl:not([hidden]) .tb-tplb b').allInnerTexts();

  // ---------- 1) 홍길동 PC 1440: 이름이 '취합 시트', 새 표 만들기 › 양식에서 고르기 › 학년·반별 제출 확인
  let { ctx, page } = await open({ width: 1440, height: 900 }, '홍길동');
  const menuLabel = (await page.locator('.side [data-go=table]').innerText()).trim();
  if (menuLabel !== '취합 시트') P('메뉴 이름이 ' + JSON.stringify(menuLabel));
  await toList(page);
  await page.locator('.tb-card').first().waitFor();
  const title = (await page.locator('#screen .page-head .title').first().innerText()).trim();
  if (title !== '취합 시트') P('목록 제목이 ' + JSON.stringify(title));
  if ((await page.title()) !== '취합 시트 · 온라인 교무실') P('창 제목이 ' + (await page.title()));
  await page.click('[data-action=tb-new]');
  await page.waitForTimeout(150);
  const seg = (await page.locator('#tbm-how button').allInnerTexts()).map((x) => x.trim());
  if (seg.join('|') !== '구글 시트에서 붙여 넣기|양식에서 고르기|빈 표') P('시작 단추가 ' + JSON.stringify(seg));
  await page.click('#tbm-how [data-how="tpl"]');
  await page.locator('#tbm-tplbox .tb-tplb').first().waitFor();
  const names = await tplNames(page);
  if (names.join('|') !== '학년·반별 제출 확인|실별 점검|교시×요일 시간표|날짜·시간 신청|업무 협의 안건|방학 근무 신청|연수 이수 확인|대피 훈련 인원 확인|학급별 안전교육 시수|위험 요소 신고·조치') P('기본 양식이 ' + names.join('|'));
  if (!(await page.locator('#tbm-tplbox', { hasText: '아직 저장한 양식이 없어요' }).count())) P('우리 학교 양식이 없다는 안내가 없음');
  if (await page.locator('#tbm-tplbox [data-tplm]').count()) P('기본 양식에 고치기 메뉴가 보임');
  await shot(page, '양식_고르기_PC');
  await page.click('#tbm-tplbox [data-tpl="B1"]');
  if (await waitPrev(page)) {
    const pv = await page.evaluate(() => {
      const t = document.querySelector('#tbm-prev .tb-prevt');
      return {
        heads: [...t.querySelectorAll('thead .tb-cn')].map((x) => x.value).join(','), span: (t.querySelector('tbody td[rowspan]') || {}).rowSpan || 0,
        sheet: document.querySelector('#tbm-sheet').value, step: (document.querySelector('#tbm-steps li.on') || {}).textContent || '',
        locks: [...t.querySelectorAll('thead [data-mk=lock].on')].length, picks: [...t.querySelectorAll('thead [data-mk=type].on')].map((x) => x.textContent).join(','),
        on: (document.querySelector('#tbm-tplbox .tb-tpl.on b') || {}).textContent || '', note: (document.querySelector('#tbm-prev .tb-tplsel') || {}).textContent || ''
      };
    });
    const rows = await line(page);
    if (pv.heads !== '학년,반,담임,제출,비고') P('열 이름이 ' + pv.heads);
    if (pv.locks !== 3 || pv.picks !== '고르기') P('잠금·고르기 열이 ' + pv.locks + ' ' + pv.picks);
    if (pv.span !== 2) P('3학년 칸이 합쳐 보이지 않음 ' + pv.span);
    if (rows.slice(0, 4).join('|') !== '1학년 1반 홍련|2학년 1반 장화|3학년 1반 홍길동|2반 성춘향') P('교직원 소속으로 채운 줄이 ' + JSON.stringify(rows.slice(0, 4)));
    if (!/줄 8개/.test(pv.note)) P('미리보기 안내가 ' + pv.note);
    if (pv.sheet !== '학년·반별 제출 확인') P('첫 시트 이름이 양식 이름으로 채워지지 않음 ' + pv.sheet);
    if (pv.step !== '2 열 정하기') P('단계 표시가 ' + pv.step);
    if (pv.on !== '학년·반별 제출 확인') P('고른 양식이 표시되지 않음');
  }
  await shot(page, '양식_미리보기_PC');
  await page.click('#tbm-go');
  if (!/표 이름을 적어 주세요/.test(await page.locator('#tbm-err').innerText())) P('표 이름 없이 만들 때 안내가 없음');
  await page.fill('#tbm-title', '방과후 신청서 제출(예시)');
  await page.click('#tbm-go');
  await page.locator(cell(0, 0)).waitFor({ timeout: 6000 }).catch(() => P('양식으로 만든 표가 열리지 않음'));
  await page.waitForTimeout(200);
  const made = await page.evaluate(() => {
    const d = window.__gy.S.table.d;
    return d ? { n: d.rows.length, sheet: d.table.name, title: d.table.title, own: d.table.canEdit,
      cols: d.table.cols.map((c) => c.name + (c.lock ? '*' : '') + (c.type === 'pick' ? '?' : '')).join(','),
      span: (document.querySelector('#tb-wrap td.tb-c[data-i="2"][data-j="0"]') || {}).rowSpan, kicker: (document.querySelector('#tb-detail .page-head .kicker') || {}).textContent, doc: document.title } : null;
  });
  if (!made || made.n !== 8 || made.sheet !== '학년·반별 제출 확인' || made.cols !== '학년*,반*,담임*,제출?,비고' || made.span !== 2 || !made.own) P('양식으로 만든 표가 다름 ' + JSON.stringify(made));
  if (made && (made.kicker !== '취합 시트 · 연구부' || made.doc !== '방과후 신청서 제출(예시) · 취합 시트')) P('표 화면의 이름이 ' + JSON.stringify([made.kicker, made.doc])); // 부서는 만든 분 부서(연구부)
  await shot(page, '양식_만든표_PC');

  // ---------- 2) 시트 메뉴 › 양식으로 저장(잠근 열 글만): 처음 이름은 겹치지 않게 표 이름으로
  await page.click(cell(0, 3));
  await page.keyboard.type('제출');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.click('#tb-tabs .tb-tab[aria-selected="true"] .tchv');
  await page.locator('.tb-menu').waitFor();
  const own = (await page.locator('.tb-menu button').allInnerTexts()).map((x) => x.trim());
  if (own.indexOf('양식으로 저장') !== 3) P('만든 분의 시트 메뉴가 ' + JSON.stringify(own));
  await page.locator('.tb-menu button', { hasText: '양식으로 저장' }).click();
  await page.locator('#tbt-sname').waitFor();
  await page.waitForTimeout(300);
  const def = await page.inputValue('#tbt-sname');
  if (def !== '방과후 신청서 제출(예시)') P('양식 이름이 기본 양식과 겹침(처음 이름 ' + def + ')');
  const whats = await page.locator('#tbt-what input').evaluateAll((xs) => xs.map((x) => x.value + (x.checked ? '*' : '')).join(','));
  if (whats !== 'all*,lock,cols') P('담을 것 고르기가 ' + whats);
  await page.fill('#tbt-sname', '방과후 제출 확인');
  await page.fill('#tbt-sdesc', '학년 반마다 냈는지 확인해요(예시)');
  await page.click('#tbt-what .opt:has(input[value=lock])');
  if (!(await page.locator('#tbt-what .opt.on input[value=lock]').count())) P('잠근 열 글만을 골라도 표시가 바뀌지 않음');
  await shot(page, '양식_저장_창');
  await page.click('#tbt-save');
  if (!(await toastHas(page, /"방과후 제출 확인" 양식으로 저장했어요/))) P('양식으로 저장했다는 안내가 없음');

  // ---------- 3) 시트 더하기 › 양식에서 고르기 › 우리 학교 양식: 이름 고치기 → 고르기 → 시트 더하기(잠근 열 글만 남음)
  await page.click('#tb-tabs [data-action=tb-sheet-add]');
  await page.locator('#tbm-sheet').waitFor();
  const seg2 = (await page.locator('#tbm-how button').allInnerTexts()).map((x) => x.trim());
  if (seg2.join('|') !== '구글 시트에서 붙여 넣기|양식에서 고르기|빈 시트|지금 시트의 열만 복사') P('시트 더하기 시작 단추가 ' + JSON.stringify(seg2));
  await page.click('#tbm-how [data-how="tpl"]');
  await page.locator('#tbm-tplbox [data-tplm]').first().waitFor({ timeout: 6000 }).catch(() => P('우리 학교 양식이 보이지 않음'));
  const mine = await page.locator('#tbm-tplbox .tb-tpl:has([data-tplm]) .tb-tplb').innerText().catch(() => '');
  if (!/방과후 제출 확인/.test(mine) || !/학년 · 반 · 담임 · 제출 · 비고/.test(mine) || !/8줄 · 할 일 열 · 홍길동 선생님/.test(mine)) P('우리 학교 양식 카드가 ' + JSON.stringify(mine)); // 학년·반별 제출 확인의 담임 열이 할 일 열(2026-10-19a)
  await shot(page, '양식_시트더하기_우리학교');
  await page.click('#tbm-tplbox [data-tplm]');
  await page.locator('.tb-menu button', { hasText: '이름·설명 고치기' }).click();
  await page.locator('#tbt-name').waitFor();
  await page.fill('#tbt-name', '방과후 강사 제출 확인');
  await shot(page, '양식_이름고치기');
  await page.press('#tbt-name', 'Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('#tbm-tplbox .tb-tplb b')].some((b) => b.textContent === '방과후 강사 제출 확인'), null, { timeout: 5000 })
    .catch(() => P('양식 이름 고치기가 안 됨'));
  await page.click('#tbm-tplbox .tb-tplb:has-text("방과후 강사 제출 확인")');
  if (await waitPrev(page)) {
    const rows = await line(page);
    if (rows[2] !== '3학년 1반 홍길동' || (await page.inputValue('#tbm-sheet')) !== '방과후 강사 제출 확인') P('잠근 열 글만 담은 양식이 ' + JSON.stringify(rows.slice(0, 3)));
  }
  await page.click('#tbm-go');
  await page.waitForFunction(() => { const T = window.__gy.S.table; return T.d && T.d.table.name === '방과후 강사 제출 확인' && !T.loading; }, null, { timeout: 6000 })
    .catch(() => P('양식으로 시트를 더하지 못함'));
  const add = await page.evaluate(() => { const d = window.__gy.S.table.d; return d.rows.length + '줄 ' + d.rows.filter((r) => r.cells.c4).length + ' ' + d.doc.sheets.length; });
  if (add !== '8줄 0 2') P('양식으로 더한 시트가 ' + add + '(8줄, 제출 칸은 비고, 시트 2개)');

  // ---------- 4) 양식 지우기(창 안에서 묻고) → 관리자 › 휴지통에서 되살리기
  await page.click('#tb-tabs [data-action=tb-sheet-add]');
  await page.locator('#tbm-sheet').waitFor();
  await page.click('#tbm-how [data-how="tpl"]');
  await page.locator('#tbm-tplbox [data-tplm]').first().waitFor();
  await page.click('#tbm-tplbox [data-tplm]');
  await page.locator('.tb-menu button', { hasText: '지우기' }).click();
  await page.locator('[data-tple="del"]').waitFor();
  await shot(page, '양식_지우기_묻기');
  await page.click('[data-tple="del"]');
  await page.waitForFunction(() => !document.querySelector('#tbm-tplbox [data-tplm]') && !!document.querySelector('#tbm-tplbox .tb-tplb'), null, { timeout: 5000 }).catch(() => P('양식 지우기가 안 됨'));
  await page.click('#tbm-go');
  if (!/쓸 양식을 골라 주세요/.test(await page.locator('#tbm-err').innerText())) P('양식을 고르지 않고 더할 때 안내가 없음');
  await page.click('.modal [data-action=close-modal]');
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=trash]');
  const tr = page.locator('[data-action=trash-restore-tb][data-kind=tpl]').first();
  if (!(await tr.waitFor({ timeout: 5000 }).then(() => true, () => false))) P('휴지통에 지운 양식이 없음');
  else {
    const item = await tr.locator('xpath=ancestor::div[contains(@class,"log-item")]').innerText();
    if (!/양식/.test(item) || !/방과후 강사 제출 확인/.test(item) || !/저장한 사람 홍길동/.test(item)) P('휴지통의 양식이 ' + JSON.stringify(item));
    const h2 = await page.locator('h2', { hasText: '지운 취합 시트' }).innerText().catch(() => '');
    if (h2 !== '지운 취합 시트(표·시트·양식)') P('휴지통 제목이 ' + h2);
    await tr.scrollIntoViewIfNeeded();
    await shot(page, '양식_휴지통');
    await tr.click();
    if (!(await toastHas(page, /양식을 되살렸어요/))) P('양식을 되살렸다는 안내가 없음');
  }
  await ctx.close();

  // ---------- 5) 다른 분(심청) 1280: 시트 메뉴는 '양식으로 저장'만, 저장한 양식은 모든 분이 쓴다
  ({ ctx, page } = await open({ width: 1280, height: 800 }, '심청'));
  await openTable(page, '업무 협의');
  await page.locator(cell(0, 0)).waitFor();
  await page.click('#tb-tabs .tb-tab[aria-selected="true"] .tchv');
  await page.locator('.tb-menu').waitFor();
  await shot(page, '양식_다른분_시트메뉴');
  await page.locator('.tb-menu button', { hasText: '양식으로 저장' }).click();
  await page.locator('#tbt-sname').waitFor();
  if ((await page.inputValue('#tbt-sname')) !== '폐기 물품') P('다른 분 양식 이름이 ' + (await page.inputValue('#tbt-sname')));
  await page.click('#tbt-what .opt:has(input[value=cols])');
  await page.click('#tbt-save');
  if (!(await toastHas(page, /"폐기 물품" 양식으로 저장했어요/))) P('다른 분이 양식으로 저장하지 못함');
  await toList(page);
  await page.locator('.tb-card').first().waitFor();
  await page.click('[data-action=tb-new]');
  await page.waitForTimeout(150);
  await page.click('#tbm-how [data-how="tpl"]');
  await page.locator('#tbm-tplbox [data-tplm]').first().waitFor();
  const saved2 = await page.locator('#tbm-tplbox .tb-tpl:has([data-tplm]) b').allInnerTexts();
  if (saved2.join('|') !== '폐기 물품') P('심청이 고칠 수 있는 양식이 ' + saved2.join('|'));
  const all2 = await tplNames(page);
  if (all2.slice(10).join('|') !== '폐기 물품') P('우리 학교 양식이 ' + all2.slice(10).join('|')); // 기본 양식 10개 다음. 미리보기는 창마다 가짜 서버가 따로라 이 창에서 저장한 것만
  const other = (await as(page, '장화', 'table.tpl.list', {})).data;
  if (!other || other.saved.map((x) => x.name + ':' + x.by + ':' + x.canEdit).join('|') !== '폐기 물품:심청:false') P('다른 분(장화)에게 보이는 양식이 ' + JSON.stringify(other && other.saved));
  await page.click('#tbm-tplbox .tb-tplb:has-text("폐기 물품")');
  if (await waitPrev(page)) {
    const rows = await line(page);
    if (rows.length !== 6 || rows.some((x) => x)) P('열 모양만 담은 양식은 빈 줄로 보여야 함 ' + JSON.stringify(rows));
  }
  // 어둡게·장도 디자인에서도 고른 양식·카드가 보인다
  await page.click('.modal [data-action=close-modal]');
  await page.click('.side [data-theme-btn=dark]');
  await page.click('.side [data-design-btn=jangdo]');
  await page.click('[data-action=tb-new]');
  await page.waitForTimeout(150);
  await page.click('#tbm-how [data-how="tpl"]');
  await page.locator('#tbm-tplbox .tb-tplb').first().waitFor();
  await page.click('#tbm-tplbox [data-tpl="B2"]');
  await waitPrev(page);
  await page.locator('#tbm-tplbox').scrollIntoViewIfNeeded();
  await shot(page, '양식_고르기_어둡게_장도');
  await page.click('.modal [data-action=close-modal]');
  await page.click('.side [data-theme-btn=light]');
  await page.click('.side [data-design-btn=base]');
  await ctx.close();

  // ---------- 6) 휴대폰(390, 장화): 짧은 단추 글, 교시×요일 시간표 양식으로 새 표
  ({ ctx, page } = await open({ width: 390, height: 844 }, '장화', true));
  await toList(page);
  await page.locator('.tb-card').first().waitFor();
  await page.click('[data-action=tb-new]');
  await page.waitForTimeout(150);
  const seg3 = (await page.locator('#tbm-how button').allInnerTexts()).map((x) => x.trim());
  if (seg3.join('|') !== '붙여 넣기|양식|빈 표') P('휴대폰 시작 단추가 ' + JSON.stringify(seg3));
  await page.click('#tbm-how [data-how="tpl"]');
  await page.locator('#tbm-tplbox .tb-tplb').first().waitFor();
  await page.click('#tbm-tplbox [data-tpl="B3"]');
  await waitPrev(page);
  await page.fill('#tbm-title', '컴퓨터실 배정(예시)');
  await shot(page, '양식_휴대폰_고르기');
  const wide = await page.evaluate(() => document.querySelector('.modal').scrollWidth - document.querySelector('.modal').clientWidth);
  if (wide > 1) P('휴대폰 만들기 창이 옆으로 넘침 ' + wide);
  await page.click('#tbm-go');
  await page.locator('.tb-rowcard').first().waitFor({ timeout: 6000 }).catch(() => P('휴대폰에서 양식으로 만든 표가 열리지 않음'));
  const ph = await page.evaluate(() => { const d = window.__gy.S.table.d; return d ? d.rows.map((r) => r.cells.c1).join(',') + ' ' + d.table.cols.length + '열' : ''; });
  if (ph !== '1교시,2교시,3교시,4교시,5교시,6교시 6열') P('휴대폰 양식 표가 ' + ph);
  await shot(page, '양식_휴대폰_만든표');
  await ctx.close();
  tplInfo = '취합 시트·시트 양식: 이름·고르기·미리보기·저장(잠근 열 글만·열 모양만)·이름 고치기·지우기·휴지통·다른 분·휴대폰 점검';
}

/** TableUi 파일을 아직 안 만든 웹앱: 다른 화면은 그대로, 표 화면은 안내, 관리자 › 점검은 'TableUi 새로 만들기'를 알려 준다 */
/** 전체 보완(판 2026-10-19a): 취합 시트 저장 실패·붙여 넣기·묻는 창·늦은 새로 받기·되돌리기·바꾸기·합치기 풀기·인쇄 안내 */
async function tableFixCheck(browser) {
  const { cell, text, saved, toastHas, pollNow, as, pasteIn, open, openTable } = tbKit(browser);
  const wrap = (page, rule) => page.evaluate((src) => { // 미리보기 가짜 서버 앞에 끼워 늦추거나 막는다
    const orig = window.__previewServer;
    const f = new Function('r', 'orig', 'req', src);
    window.__previewServer = (req) => f(JSON.parse(req), orig, req);
    window.__unwrap = () => { window.__previewServer = orig; };
  }, rule);
  const unwrap = (page) => page.evaluate(() => { if (window.__unwrap) window.__unwrap(); });
  let { ctx, page } = await open({ width: 1440, height: 900 }, '심청', false, () => { window.__gyTbRetryMs = [80, 80, 80]; });
  await openTable(page, '2026 폐기');
  const tid = await page.evaluate(() => window.__gy.S.table.d.table.id);
  // 1) 저장 차례를 못 받으면(BUSY) 저절로 다시 보내고, 끝내 안 되면 쓴 글은 칸에 그대로 + '다시 보내기'
  await page.evaluate(() => { window.__tbBusy = 4; });
  await wrap(page, "if ((r.action === 'table.cell' || r.action === 'table.cells') && window.__tbBusy > 0) { window.__tbBusy--; return Promise.resolve(JSON.stringify({ ok: false, error: '다른 분이 저장하는 중이에요. 잠시 뒤에 다시 눌러 주세요.', code: 'BUSY' })); } return orig(req);");
  await page.click(cell(0, 4));
  await page.keyboard.type('회의 중에 적은 긴 내용');
  await page.keyboard.press('Enter');
  if (!(await page.locator('#tb-bar .tb-unsaved').waitFor({ timeout: 6000 }).then(() => true, () => false))) problems.push('보완 표: 저장하지 못했는데 "저장 못 한 칸"이 보이지 않음');
  if ((await text(page, 0, 4)) !== '회의 중에 적은 긴 내용') problems.push('보완 표: 저장하지 못한 칸의 글이 사라짐(' + (await text(page, 0, 4)) + ')');
  if (!(await page.locator(cell(0, 4) + '.unsaved').count())) problems.push('보완 표: 저장하지 못한 칸에 빨간 테두리가 없음');
  if (!(await page.locator('#toast.show.toast-err .toast-x').count())) problems.push('보완 표: 저장 실패 알림이 닫을 때까지 남지 않음');
  if ((await page.evaluate(() => window.__tbBusy)) !== 0) problems.push('보완 표: 저절로 세 번 다시 보내지 않음');
  await shot(page, '보완_표_저장못한칸_PC');
  await page.click('.side [data-go=home]');
  if (!(await page.getByText('저장하지 못한 칸이 있어요').first().waitFor({ timeout: 3000 }).then(() => true, () => false))) problems.push('보완 표: 저장 못 한 칸을 두고 나갈 때 묻지 않음');
  else await page.click('.modal [data-action=close-modal]');
  if (await page.evaluate(() => window.__gy.S.screen) !== 'table') problems.push('보완 표: 그만두기를 눌렀는데 표를 떠남');
  await page.click('[data-action=tb-resend]');
  await saved(page, '다시 보내기');
  await page.waitForTimeout(200);
  if (await page.locator('#tb-bar .tb-unsaved').count()) problems.push('보완 표: 다시 보낸 뒤에도 "저장 못 한 칸"이 남음');
  let srv = (await as(page, '흥부', 'table.get', { id: tid })).data;
  if (srv.rows[0].cells.c5 !== '회의 중에 적은 긴 내용') problems.push('보완 표: 다시 보내기로 서버에 저장되지 않음');
  await unwrap(page);
  await page.click('#toast .toast-x').catch(() => {});
  // 2) 메신저·메모장 글은 값만 붙여 넣는다(칸의 채우기 색·굵게는 그대로)
  const r9 = srv.rows[9];
  await as(page, '심청', 'table.cells', { id: tid, cells: [{ row: r9.id, n: r9.n, col: 'c5', fill: '#FCE5CD', f: { b: 1 } }] });
  await pollNow(page);
  await page.waitForTimeout(700);
  await page.click(cell(9, 4));
  await pasteIn(page, '#tb-ed', '', '메신저에서 복사한 글');
  await saved(page, '글만 붙여 넣기');
  let row = (await as(page, '흥부', 'table.get', { id: tid })).data.rows[9];
  if (row.cells.c5 !== '메신저에서 복사한 글' || row.colors.c5 !== '#FCE5CD' || !(row.fmt.c5 && row.fmt.c5.b)) problems.push('보완 표: 글만 붙여 넣었는데 칸의 색·서식이 바뀜 ' + JSON.stringify([row.cells.c5, row.colors.c5, row.fmt.c5]));
  // 3) 정렬한 채로 합친 칸을 붙여 넣으면 합친 칸은 빼고(숨은 줄을 덮지 않게)
  await page.hover('#tb-wrap th.tb-h[data-j="4"]');
  await page.click('#tb-wrap th.tb-h[data-j="4"] .tb-hb');
  await page.click('.tb-menu [data-sort="1"]');
  await page.waitForTimeout(200);
  await page.click(cell(0, 4));
  await pasteIn(page, '#tb-ed', '<google-sheets-html-origin><table><tbody><tr><td rowspan="2">합친 값</td></tr><tr></tr><tr><td>셋째 값</td></tr></tbody></table>', '합친 값\n\n셋째 값');
  if (!(await toastHas(page, /합친 칸은 빼고/))) problems.push('보완 표: 정렬 중 합친 칸을 붙여 넣을 때 안내가 없음');
  await saved(page, '정렬 중 붙여 넣기');
  srv = (await as(page, '흥부', 'table.get', { id: tid })).data;
  if (srv.rows.some((x) => x.fmt.c5 && x.fmt.c5.m)) problems.push('보완 표: 정렬한 채로 붙여 넣었는데 합친 칸이 생김');
  await page.click('[data-action=tb-local-clear]');
  await page.waitForTimeout(200);
  // 4) 두 칸을 잇달아 고쳤는데 둘 다 다른 분이 먼저 고쳤으면 한 창에서 두 칸을 함께 묻는다
  srv = (await as(page, '장화', 'table.get', { id: tid })).data;
  for (const i of [5, 6]) {
    const r = srv.rows[i];
    await as(page, '장화', 'table.cell', { id: tid, row: r.id, n: r.n, col: 'c5', value: '장화 먼저 ' + i, base: (r.stamps.c5 || [0])[0] });
  }
  await wrap(page, "if (r.action === 'table.cell') return orig(req).then((t) => new Promise((res) => setTimeout(() => res(t), 600))); return orig(req);");
  await page.click(cell(5, 4));
  await page.keyboard.type('심청 5');
  await page.keyboard.press('Enter');
  await page.keyboard.type('심청 6');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  await unwrap(page);
  const box = await page.locator('#tb-conf-box').innerText().catch(() => '');
  if (!/2칸을/.test(box) || !/장화 먼저 5/.test(box) || !/장화 먼저 6/.test(box) || !/심청 5/.test(box) || !/심청 6/.test(box)) problems.push('보완 표: 잇달아 부딪힌 두 칸을 함께 묻지 않음(' + box.replace(/\s+/g, ' ').slice(0, 120) + ')');
  else {
    await shot(page, '보완_표_묻는창_두칸_PC');
    await page.click('#tb-mine');
    await saved(page, '모두 내 값으로');
    srv = (await as(page, '흥부', 'table.get', { id: tid })).data;
    if (srv.rows[5].cells.c5 !== '심청 5' || srv.rows[6].cells.c5 !== '심청 6') problems.push('보완 표: 모두 내 값으로 바꾸기가 안 됨');
  }
  // 5) 늦게 온 새로 받기가 방금 저장한 내 값을 지우지 않는다
  const r7 = srv.rows[7];
  await as(page, '장화', 'table.cell', { id: tid, row: r7.id, n: r7.n, col: 'c4', value: '미완료', base: (r7.stamps.c4 || [0])[0] }); // 같은 줄의 다른 칸
  await wrap(page, "if (r.action === 'table.poll') return orig(req).then((t) => new Promise((res) => setTimeout(() => res(t), 1500))); return orig(req);");
  await pollNow(page); // 이 새로 받기는 심청이 저장하기 전의 줄을 1.5초 늦게 가져온다
  await page.waitForTimeout(150);
  await page.click(cell(6, 4)); // 이미 고른 칸을 다시 누르면 이어 쓰기라서, 다른 칸을 거쳐 고른다
  await page.click(cell(7, 4));
  await page.keyboard.type('심청이 쓴 값');
  await page.keyboard.press('Enter');
  await saved(page, '늦은 새로 받기');
  await page.waitForTimeout(2000);
  await unwrap(page);
  if ((await text(page, 7, 4)) !== '심청이 쓴 값') problems.push('보완 표: 늦게 온 새로 받기가 방금 저장한 값을 지움(' + (await text(page, 7, 4)) + ')');
  // 6) 다른 선생님으로 바꾸면 앞 선생님의 되돌리기(Ctrl+Z)는 없어진다
  await page.click(cell(9, 4));
  await page.click(cell(8, 4));
  await page.keyboard.type('되돌리기 시험');
  await page.keyboard.press('Enter');
  await saved(page, '되돌리기 시험');
  await page.click('.side [data-action=switch]');
  await verify(page, '장화');
  await openTable(page, '2026 폐기');
  await page.click(cell(8, 4));
  await page.keyboard.press('Control+z');
  if (!(await toastHas(page, /되돌릴 것이 없어요/))) problems.push('보완 표: 다른 선생님으로 바꿨는데 앞 선생님의 되돌리기가 남음');
  if ((await text(page, 8, 4)) !== '되돌리기 시험') problems.push('보완 표: 앞 선생님이 쓴 값이 되돌려짐');
  // 7) 인쇄에는 화면용 안내('칸을 누르고 쓰면…')가 찍히지 않는다
  await page.emulateMedia({ media: 'print' });
  const hint = await page.evaluate(() => { const x = document.querySelector('#tb-detail .page-head .lead .print-hide'); return x ? getComputedStyle(x).display : 'missing'; });
  await page.emulateMedia({ media: 'screen' });
  if (hint !== 'none') problems.push('보완 표: 인쇄에 화면용 안내가 찍힘(' + hint + ')');
  await ctx.close();

  // 8) 만든 분(흥부): 예전 '위아래 합침' 열에서 모두 바꾸기는 이어진 줄을 함께 바꾼다 · 정렬한 채로는 합치기·풀기를 막는다
  ({ ctx, page } = await open({ width: 1440, height: 900 }, '흥부'));
  await openTable(page, '2026 폐기');
  await page.click(cell(0, 4));
  await page.keyboard.press('Control+h');
  await page.locator('#tb-fq').waitFor();
  await page.fill('#tb-fq', '1층');
  await page.fill('#tb-fr', '본관 1층');
  await page.waitForTimeout(400);
  await page.click('[data-action=tb-frepall]');
  await saved(page, '모두 바꾸기');
  const id1 = await page.evaluate(() => window.__gy.S.table.d.table.id);
  const c1 = (await as(page, '흥부', 'table.get', { id: id1 })).data.rows.slice(0, 3).map((x) => x.cells.c1).join(',');
  if (c1 !== '본관 1층,본관 1층,본관 1층') problems.push('보완 표: 위아래 합침 열에서 모두 바꾸기가 이어진 줄을 함께 바꾸지 않음(' + c1 + ')');
  await page.click('[data-action=tb-fclose]');
  await openTable(page, '2학기 업무 협의');
  await page.hover('#tb-wrap th.tb-h[data-j="4"]');
  await page.click('#tb-wrap th.tb-h[data-j="4"] .tb-hb');
  await page.click('.tb-menu [data-sort="-1"]');
  await page.waitForTimeout(200);
  await page.click(cell(0, 0));
  await page.click('#tt-mg');
  await page.locator('.tb-menu').waitFor();
  const dis = await page.evaluate(() => Array.from(document.querySelectorAll('.tb-menu button[data-k]')).map((b) => b.disabled));
  if (!dis.length || dis.some((x) => !x)) problems.push('보완 표: 정렬한 채로 합치기·합치기 풀기를 고를 수 있음 ' + JSON.stringify(dis));
  await page.keyboard.press('Escape');
  await page.click('[data-action=tb-local-clear]').catch(() => {});
  // 9) 아주 큰 서식 작업(200줄 × 30열 = 6000칸에 테두리)은 줄째로 나눠 보내 모두 저장된다(5000칸 한도에 걸리지 않게)
  const bigCols = Array.from({ length: 30 }, (_, j) => ({ id: 'c' + (j + 1), name: '열' + (j + 1) }));
  const big = await as(page, '흥부', 'table.create', { fields: { title: '아주 큰 표(점검)', sheet: '시트1' }, cols: bigCols, rows: Array.from({ length: 200 }, (_, i) => ({ cells: { c1: String(i + 1) } })) });
  if (!big.ok) problems.push('보완 표: 큰 표를 만들지 못함 ' + big.error);
  else {
    await page.evaluate(() => window.__gy.memoClear());
    await openTable(page, '아주 큰 표');
    await page.click(cell(0, 1));
    await page.keyboard.press('Control+a');
    await page.click('#tt-bd');
    await page.click('.tb-pop [data-bd="all"]');
    await page.waitForFunction(() => !document.querySelector('#tb-wrap td.saving'), null, { timeout: 30000 }).catch(() => problems.push('보완 표: 큰 서식 작업 저장이 끝나지 않음'));
    if (await page.locator('#toast.toast-err').count()) problems.push('보완 표: 큰 서식 작업에 오류 알림 ' + (await page.locator('#toast').innerText()));
    const bd = (await as(page, '흥부', 'table.get', { id: big.data.id })).data.rows;
    if (bd.length !== 200 || !bd.every((r) => bigCols.every((c) => r.fmt[c.id] && r.fmt[c.id].bd))) problems.push('보완 표: 6000칸 테두리가 모두 저장되지 않음');
  }
  await ctx.close();
}

/** 전체 보완(판 2026-10-19a): 일정(끌기·고치기 충돌, 휴대폰 토·일, 연간 날짜)·홈(토요일)·학사일정 붙여 넣기(합친 칸)·학생 수(학년마다)·설정(학기 기간) */
async function schedFixCheck(browser) {
  const { as, open, toastHas } = tbKit(browser);
  const raw = (page, action, args) => page.evaluate(([a, b]) => { // 화면 기억을 건드리지 않고(다른 창에서 한 것처럼) 서버를 부른다
    const login = localStorage.getItem('gy.login') || sessionStorage.getItem('gy.login');
    const identity = localStorage.getItem('gy.identity') || sessionStorage.getItem('gy.identity');
    return window.__previewServer(JSON.stringify({ action: a, args: b, tokens: { login, identity } })).then((t) => JSON.parse(t));
  }, [action, args]);
  const plus = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  const mid = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const mouseDrag = async (page, from, to) => {
    const a = await mid(page, from), b = await mid(page, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
    await page.mouse.up();
  };
  const asked = (page) => page.locator('#cf-ok').waitFor({ timeout: 3000 }).then(() => true, () => false);
  const chip = (day, id) => `.cal-d[data-day="${day}"] [data-ev="${id}"]`;
  const toSat = () => { // 시계를 다음 토요일(오늘이 토요일이면 오늘)로
    const RD = Date, d = new RD(RD.now() + 9 * 3600e3).getUTCDay(), off = ((6 - d + 7) % 7) * 86400e3;
    class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } }
    window.Date = FD;
  };

  // 1) 끌어 옮기기: 다른 창에서 고친 일정은 옮기지 않고 알린 뒤 달력을 새로 받는다 → 다시 끌면 날짜만 옮겨진다
  let { ctx, page } = await open({ width: 1440, height: 900 }, '성춘향');
  await page.evaluate(() => { window.__gy.S.sched.view = 'cal'; window.__gy.go('schedule'); });
  await page.locator('.cal').waitFor();
  const days = await page.evaluate(() => { const S = window.__gy.S, ym = S.sched.y + '-' + String(S.sched.m).padStart(2, '0'); return Array.from(document.querySelectorAll('.cal-d[data-day]')).map((c) => c.getAttribute('data-day')).filter((d) => d.slice(0, 7) === ym); });
  const wed = days.find((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 3 && Number(d.slice(8)) >= 8 && Number(d.slice(8)) <= 22), fri = plus(wed, 2);
  const ev1 = await page.evaluate((d) => window.__gy.server('sched.save', { id: '', fields: { start: d, end: '', time: '5교시', title: '보완 끌기 행사', kind: '행사', target: ['3'], deptId: '', place: '3-2 교실', memo: '', important: false } }), wed);
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator(chip(wed, ev1.id)).waitFor();
  await page.waitForTimeout(1100); // 저장 시각은 초 단위
  const ed = await raw(page, 'sched.save', { id: ev1.id, fields: { start: wed, title: '보완 끌기 행사', time: '6교시', place: '시청각실', kind: '행사', target: ['3'] } });
  if (!ed.ok) problems.push('보완 일정: 다른 창에서 고치지 못함 ' + ed.error);
  await mouseDrag(page, chip(wed, ev1.id), `.cal-d[data-day="${fri}"]`);
  if (await asked(page)) {
    await page.click('#cf-ok');
    if (!(await toastHas(page, /고쳤어요/))) problems.push('보완 일정: 그사이 고친 일정을 끌어 옮겼는데 알리지 않음');
    await page.waitForTimeout(500);
    await page.locator(chip(wed, ev1.id)).waitFor({ timeout: 5000 }).catch(() => problems.push('보완 일정: 옮기지 않은 일정이 제자리에 없음'));
    await mouseDrag(page, chip(wed, ev1.id), `.cal-d[data-day="${fri}"]`);
    if (await asked(page)) {
      await page.click('#cf-ok');
      await waitText(page, '옮겼어요');
      const m = (await raw(page, 'sched.month', { year: +fri.slice(0, 4), month: +fri.slice(5, 7) })).data.events.find((e) => e.id === ev1.id);
      if (!m || m.start !== fri || m.time !== '6교시' || m.place !== '시청각실') problems.push('보완 일정: 끌어 옮긴 뒤 다른 분이 고친 시간·장소가 되돌아감 ' + JSON.stringify(m && [m.start, m.time, m.place]));
    } else problems.push('보완 일정: 다시 끌었는데 묻지 않음');
  } else problems.push('보완 일정: 끌어 놓았는데 묻지 않음');
  // 2) 고치기 창: 연 뒤 다른 분이 고쳤으면 쓰던 글은 그대로 두고 '그래도 저장'
  await page.locator(chip(fri, ev1.id)).waitFor({ timeout: 5000 }).catch(() => {});
  await page.click(chip(fri, ev1.id));
  await page.locator('.ev-dl').waitFor();
  await page.click('[data-action=ev-edit]');
  await page.locator('#ef-title').waitFor();
  await page.waitForTimeout(1100);
  await raw(page, 'sched.save', { id: ev1.id, fields: { start: fri, title: '보완 끌기 행사', time: '7교시', place: '시청각실', kind: '행사', target: ['3'] } });
  await page.fill('#ef-title', '보완 끌기 행사(고침)');
  await page.click('#ev-form [type=submit]');
  if (!(await page.locator('#ef-force').waitFor({ timeout: 4000 }).then(() => true, () => false))) problems.push('보완 일정: 그사이 고친 일정을 저장했는데 묻지 않음');
  else {
    if (!/그사이/.test(await page.textContent('#ef-err'))) problems.push('보완 일정: 먼저 고친 분 안내가 없음');
    if ((await page.inputValue('#ef-title')) !== '보완 끌기 행사(고침)') problems.push('보완 일정: 묻는 동안 쓰던 글이 사라짐');
    await shot(page, '보완_일정_고치기_먼저고침');
    await page.click('#ef-force');
    await waitText(page, '고쳤어요');
    const m2 = (await raw(page, 'sched.month', { year: +fri.slice(0, 4), month: +fri.slice(5, 7) })).data.events.find((e) => e.id === ev1.id);
    if (!m2 || m2.title !== '보완 끌기 행사(고침)') problems.push('보완 일정: 그래도 저장이 안 됨');
  }
  // 3) 연간 학사일정 날짜는 '12일(월)'
  await page.click('[data-sched-view=year]');
  await page.locator('.ylist .yd').first().waitFor();
  const yd = await page.locator('.ylist .yd').first().innerText();
  if (!/^\d{1,2}일\([월화수목금토일]\)$/.test(yd.trim())) problems.push('보완 일정: 연간 학사일정 날짜가 ' + yd);
  // 4) 학사일정 붙여 넣기: 날짜 칸을 합친 표(rowspan)도 칸이 밀리지 않고, 한 칸에 적은 기간을 나눈다
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.locator('.srow').nth(3).waitFor();
  await page.evaluate(() => window.__gy.go('upload'));
  await page.locator('.up-steps').waitFor();
  await page.click('[data-action=up-input][data-v=paste]');
  await page.locator('#up-paste').focus();
  await page.evaluate(() => {
    const html = '<table><tr><td>날짜</td><td>행사명</td><td>구분</td></tr><tr><td rowspan="2">2026. 11. 18.</td><td>교직원 연수</td><td>행사</td></tr><tr><td>학부모 상담</td><td>행사</td></tr><tr><td>2026. 11. 19.~11. 20.</td><td>현장체험학습</td><td>교육활동</td></tr></table>';
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', '날짜\t행사명\t구분\n2026. 11. 18.\t교직원 연수\t행사\n\t학부모 상담\t행사\n2026. 11. 19.~11. 20.\t현장체험학습\t교육활동');
    const ta = document.querySelector('#up-paste');
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    ta.value = dt.getData('text/plain');
  });
  await page.click('[data-action=up-read-paste]');
  await page.locator('.up-table').waitFor();
  const up = await page.evaluate(() => (window.__gy.S.up.res.rows || []).map((r) => [r.title, r.start, r.end, r.status]));
  const upRow = (t) => up.find((x) => x[0] === t) || [];
  if (upRow('학부모 상담')[1] !== '2026-11-18' || upRow('현장체험학습')[1] !== '2026-11-19' || upRow('현장체험학습')[2] !== '2026-11-20') problems.push('보완 올리기: 합친 날짜 칸·한 칸 기간을 못 읽음 ' + JSON.stringify(up));
  await shot(page, '보완_학사일정_합친칸_붙여넣기', true);
  // 5) 설정 › 학기 기간: 지금·다음 학년도를 따로, 학년도는 새 학년도에서
  await page.evaluate(() => { window.__gy.S.adminTab = 'settings'; window.__gy.go('admin'); });
  await page.locator('.sem-year').first().waitFor();
  if ((await page.locator('.sem-year').count()) !== 2) problems.push('보완 설정: 학기 기간이 학년도 두 개로 나뉘지 않음');
  if (await page.locator('[data-set="학년도"]').count()) problems.push('보완 설정: 학년도를 설정에서 바꿀 수 있음');
  const ny = await page.evaluate(() => document.querySelectorAll('.sem-year')[1].querySelector('[data-sem]').getAttribute('data-sem'));
  await page.fill('#sem-' + ny + '-s1from', ny + '-03-02');
  await page.fill('#sem-' + ny + '-s1to', ny + '-07-23');
  await page.fill('#sem-' + ny + '-s2from', ny + '-08-16');
  await page.fill('#sem-' + ny + '-s2to', (Number(ny) + 1) + '-02-11');
  await page.click('#set-form [type=submit]');
  if (!(await toastHas(page, /설정을 저장했어요/))) problems.push('보완 설정: 다음 학년도 학기 기간을 저장하지 못함 ' + (await page.textContent('#set-err')));
  await page.locator('.sem-year').nth(1).scrollIntoViewIfNeeded();
  await shot(page, '보완_설정_학기기간');
  const yr = (await raw(page, 'sched.year', { year: Number(ny) })).data.days.semesters.map((x) => x.from).join(',');
  if (yr !== ny + '-03-02,' + ny + '-08-16') problems.push('보완 설정: 다음 학년도 학기 기간이 연간 학사일정에 쓰이지 않음 ' + yr);
  await ctx.close();

  // 6) 토요일: 홈은 다음 주 일정·월요일 미리 보기, 휴대폰 일정은 토·일 칸
  ({ ctx, page } = await open({ width: 1440, height: 900 }, '심청', false, toSat));
  const head = await page.locator('#home-body h2', { hasText: '주 일정' }).first().innerText();
  const tom = await page.locator('.tomorrow b').innerText();
  if (!/다음 주 일정/.test(head) || tom.trim() !== '월요일 미리 보기') problems.push('보완 홈: 토요일인데 ' + head + ' / ' + tom);
  await shot(page, '보완_홈_토요일_다음주');
  await ctx.close();
  ({ ctx, page } = await open({ width: 390, height: 844 }, '심청', true, toSat));
  await page.evaluate(() => { window.__gy.S.sched.view = 'cal'; window.__gy.go('schedule'); });
  await page.locator('.pdays').waitFor();
  if (!(await page.locator('.pdays.six .pday.wk.on').count())) problems.push('보완 휴대폰: 토요일인데 토·일 칸이 골라지지 않음');
  if (!/토·일/.test(await page.locator('.pweek .card-head h2').innerText())) problems.push('보완 휴대폰: 토·일 제목이 없음');
  await check(page, '보완 휴대폰 토·일');
  await shot(page, '보완_휴대폰_일정_토일');
  await ctx.close();

  // 7) 학생 수: 다른 학년은 함께 저장, 같은 학년을 그사이 고쳤으면 쓰던 숫자는 두고 바뀐 숫자를 보여 준다
  ({ ctx, page } = await open({ width: 1440, height: 900 }, '심청'));
  const today = await page.evaluate(() => window.__gy.S.home && window.__gy.S.home.today);
  const all = {};
  for (let g = 1; g <= 6; g++) all[g] = [[10, 10]];
  await as(page, '심청', 'students.save', { date: today, classes: all });
  await page.evaluate(() => { window.__gy.memoClear(); window.__gy.go('home'); });
  await page.locator('.stu-card [data-action=students-edit]').waitFor();
  await page.click('.stu-card [data-action=students-edit]');
  await page.locator('#stu-form').waitFor();
  const five = JSON.parse(JSON.stringify(all)); five[5] = [[12, 13]];
  await as(page, '흥부', 'students.save', { date: today, classes: five }); // 흥부가 5학년을 먼저 고친다(심청 창은 모름)
  await page.fill('#stu-4-1-0', '11');
  await page.click('#stu-save');
  await page.locator('#stu-form').waitFor({ state: 'detached', timeout: 5000 }).catch(() => problems.push('보완 학생 수: 다른 학년을 고쳤는데 저장되지 않음 ' + ''));
  let st = (await as(page, '심청', 'home', {})).data.students;
  if (JSON.stringify(st.classes['4']) !== '[[11,10]]' || JSON.stringify(st.classes['5']) !== '[[12,13]]') problems.push('보완 학생 수: 두 분이 고친 학년이 함께 남지 않음 ' + JSON.stringify(st.classes));
  await page.click('.stu-card [data-action=students-edit]');
  await page.locator('#stu-form').waitFor();
  const four = JSON.parse(JSON.stringify(st.classes)); four['4'] = [[15, 15]];
  await page.waitForTimeout(1100);
  await as(page, '장화', 'students.save', { date: today, classes: four }); // 장화가 같은 4학년을 먼저
  await page.fill('#stu-4-1-1', '9');
  await page.click('#stu-save');
  if (!(await page.locator('#stu-clash-4').waitFor({ timeout: 5000 }).then(() => true, () => false))) problems.push('보완 학생 수: 같은 학년을 그사이 고쳤는데 묻지 않음 ' + (await page.textContent('#stu-err')));
  else {
    if ((await page.inputValue('#stu-4-1-1')) !== '9') problems.push('보완 학생 수: 묻는 동안 쓰던 숫자가 사라짐');
    if (!/장화 선생님/.test(await page.textContent('#stu-err'))) problems.push('보완 학생 수: 먼저 고친 분 안내가 없음');
    await page.locator('#stu-sec-4').scrollIntoViewIfNeeded();
    await shot(page, '보완_학생수_같은학년_먼저고침');
    await page.click('[data-stu-take="4"]');
    if ((await page.inputValue('#stu-4-1-1')) !== '15') problems.push('보완 학생 수: 이 숫자로 바꾸기가 안 됨');
    await page.click('#stu-save');
    await page.locator('#stu-form').waitFor({ state: 'detached', timeout: 5000 }).catch(() => problems.push('보완 학생 수: 바뀐 숫자를 보고 다시 저장하지 못함'));
  }
  await ctx.close();
}

/** 전체 보완 묶음 3(판 2026-10-19a): 조사·공지·자료실·교직원 */
async function svFixCheck(browser) {
  const { as, open, toastHas } = tbKit(browser);
  const asAdmin = (page, name, action, args) => page.evaluate(async ([nm, a, ar]) => { // 관리자 화면을 연 기기처럼
    const login = localStorage.getItem('gy.login') || sessionStorage.getItem('gy.login');
    const call = (x, y, tok) => window.__previewServer(JSON.stringify({ action: x, args: y || {}, tokens: tok })).then((t) => JSON.parse(t));
    const staff = (await call('staffPicker', {}, { login })).data;
    const p = staff.find((s) => s.name === nm);
    const identity = (await call('verify', { staffId: p.id, pin: '1111', remember: false }, { login })).data.identity;
    const admin = (await call('adminLogin', { password: 'admin1' }, { login })).data.admin;
    return call(a, ar, { login, identity, admin });
  }, [name, action, args]);
  const plus = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
  const { ctx, page } = await open({ width: 1440, height: 900 }, '성춘향');
  const today = (await as(page, '성춘향', 'home', {})).data.today;
  const qs4 = [{ type: 'one', title: '참석', required: true, options: ['참석', '불참'] }, { type: 'many', title: '도울 일', options: ['사진', '정리'] }, { type: 'long', title: '하고 싶은 말' }];
  const mk = async (title) => {
    const r = await as(page, '성춘향', 'survey.save', { fields: { title, deadline: plus(today, 3) + ' 17:00', target: { type: 'all' }, questions: qs4 } });
    if (!r.ok) problems.push('보완 조사: 만들지 못함 ' + r.error);
    return r.data && r.data.id;
  };
  const A = await mk('보완 다시 열 조사'), B = await mk('보완 끝낸 다른 조사');
  const qa = (await as(page, '심청', 'survey.get', { id: A })).data.questions;
  await as(page, '심청', 'survey.respond', { id: A, answers: { [qa[0].id]: '참석', [qa[1].id]: ['사진', '정리'], [qa[2].id]: '첫 줄\n둘째 줄 "따옴표"' } });
  await as(page, '흥부', 'survey.respond', { id: A, answers: { [qa[0].id]: '불참' } });
  for (const id of [A, B]) await as(page, '성춘향', 'survey.setOpen', { id, open: false });

  // 1) 지난 조사에서 '다시 열기'를 누르면 같은 조사가 그대로 보인다(그 조사가 있는 탭으로)
  await page.evaluate(() => { const S = window.__gy.S; window.__gy.memoClear(); S.survey.list = null; S.survey.tab = 'past'; S.survey.sel = ''; window.__gy.go('survey'); });
  await page.locator('.sv-card', { hasText: '보완 다시 열 조사' }).first().click();
  await page.locator('#sv-detail .sv-owner').waitFor();
  await page.click('[data-action=sv-close][data-open="1"]');
  await page.click('#cf-ok');
  await toastHas(page, /다시 열었어요/);
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ sel: window.__gy.S.survey.sel, tab: window.__gy.S.survey.tab, h: (document.querySelector('#sv-detail .sv-h') || {}).textContent || '' }));
  if (st.sel !== A || st.h !== '보완 다시 열 조사') problems.push('보완 조사: 다시 연 뒤 다른 조사가 열림 ' + JSON.stringify(st));
  if (st.tab !== 'mine') problems.push('보완 조사: 다시 연 조사가 있는 탭으로 옮기지 않음 ' + st.tab);
  await shot(page, '보완_조사_다시열기_그대로');

  // 2) 표 복사: 여러 줄로 쓴 답은 따옴표로 감싸 한 칸으로(앞 점검과 따로 보려고 A를 다시 고른다)
  await page.evaluate((id) => { const S = window.__gy.S; S.survey.tab = 'mine'; S.survey.sel = id; window.__gy.go('survey'); }, A);
  await page.locator('#sv-detail .sv-owner').waitFor();
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied = t; return Promise.resolve(); } }); });
  await page.click('[data-action=sv-csv]');
  await page.locator('#csv-copy').waitFor();
  await page.click('#csv-copy');
  await toastHas(page, /복사했어요/);
  const tsv = await page.evaluate(() => window.__copied || '');
  if (!tsv.includes('"첫 줄\n둘째 줄 ""따옴표"""')) problems.push('보완 조사: 표 복사에서 여러 줄 답을 한 칸으로 감싸지 않음 ' + JSON.stringify(tsv.slice(0, 200)));
  if (tsv.split('\n').filter((l) => /^(심청|흥부|이름)\t/.test(l)).length !== 3) problems.push('보완 조사: 표 복사 줄 수가 맞지 않음 ' + JSON.stringify(tsv.slice(0, 300)));
  await page.click('.modal [data-action=close-modal]');

  // 3) 답이 있는 조사에서 '결과 공개'를 켤 때 한 번 묻는다
  await page.click('[data-action=sv-edit]');
  await page.locator('#svf').waitFor();
  await page.click('#svf-public');
  if (!(await visible(page, '#svf-pub-ask'))) problems.push('보완 조사: 답이 있는데 결과 공개를 켤 때 묻지 않음');
  if (await page.isChecked('#svf-public')) problems.push('보완 조사: 묻기 전에 결과 공개가 켜짐');
  if (await visible(page, '#svf-pub-ask')) {
    await page.locator('#svf-pub-ask').scrollIntoViewIfNeeded();
    await shot(page, '보완_조사_결과공개_묻기');
    await page.click('[data-pub-ask="1"]');
    if (!(await page.isChecked('#svf-public'))) problems.push("보완 조사: '그래도 보여 주기'를 눌렀는데 켜지지 않음");
  }
  await page.click('#svf [data-action=close-modal]');

  // 4) 여러 개 고르기는 네모, 하나 고르기는 동그라미
  await page.evaluate(() => { const S = window.__gy.S; S.survey.tab = 'answer'; S.survey.sel = ''; window.__gy.go('survey'); });
  await page.locator('.sv-card', { hasText: '보완 다시 열 조사' }).first().click();
  await page.locator('.sv-respond .opt').first().waitFor();
  const marks = await page.evaluate(() => ({
    many: getComputedStyle(document.querySelector('.sv-respond .opt.many .opt-mark')).borderTopLeftRadius,
    one: getComputedStyle(document.querySelector('.sv-respond .opt:not(.many) .opt-mark')).borderTopLeftRadius
  }));
  if (marks.many !== '6px' || marks.one !== '50%') problems.push('보완 조사: 고르기 표시 모양 ' + JSON.stringify(marks));
  await page.locator('.sv-respond .opt.many').first().click();
  await page.locator('.sv-respond .opt.many').first().scrollIntoViewIfNeeded();
  await shot(page, '보완_조사_여러개고르기_네모');

  // 5) 공지: 게시 끝일을 지난 날로 고르면 한 번 묻는다
  await page.evaluate(() => { window.__gy.S.notice.view = 'now'; window.__gy.go('notice'); });
  await page.locator('.notice-item').first().waitFor();
  await page.locator('.main [data-action=notice-new]').first().click();
  await page.locator('#notice-form').waitFor();
  await modalSettled(page);
  await page.fill('#nf-title', '보완 지난 날 공지');
  await page.fill('#nf-until', plus(today, -2));
  await page.click('#notice-form [type=submit]');
  if (!(await page.locator('#nf-past-ok').waitFor({ timeout: 3000 }).then(() => true, () => false))) problems.push('보완 공지: 지난 날을 골랐는데 묻지 않음');
  else {
    if (!/오늘보다 앞이라/.test(await page.textContent('#nf-err'))) problems.push('보완 공지: 묻는 글이 없음');
    await shot(page, '보완_공지_지난날_묻기');
    await page.click('#nf-past-ok');
    await toastHas(page, /공지를 올렸어요/);
    await page.click('[data-action=notice-view][data-v=past]');
    if (!(await page.locator('.notice-item', { hasText: '보완 지난 날 공지' }).first().waitFor({ timeout: 4000 }).then(() => true, () => false))) problems.push('보완 공지: 그대로 올린 공지가 지난 공지에 없음');
  }

  // 6) 설정의 '자료실' 칸(파일 크기 한도 20MB까지)과 자료 넣기 창의 '홈에는 6개까지' 안내
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=settings]');
  await page.locator('#set-form').waitFor();
  const fileField = page.locator('#set-form [data-set="파일 크기 한도"]');
  if (!(await fileField.count())) problems.push('보완 설정: 파일 크기 한도 칸이 없음');
  else {
    await fileField.scrollIntoViewIfNeeded();
    if (!/1~20MB/.test(await page.locator('#set-form section', { has: page.locator('[data-set="파일 크기 한도"]') }).innerText())) problems.push('보완 설정: 파일 크기 한도 범위 안내가 20MB가 아님');
    await shot(page, '보완_설정_파일크기한도');
    await fileField.fill('25');
    await page.click('#set-form [type=submit]');
    await page.waitForFunction(() => /20MB/.test((document.querySelector('#set-err') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => problems.push('보완 설정: 25MB를 막지 않음'));
  }
  for (let i = 1; i <= 7; i++) await asAdmin(page, '홍길동', 'lib.save', { fields: { '제목': '보완 홈 자료 ' + i, mode: 'link', link: 'https://example.com/b' + i, home: true } });
  await page.evaluate(() => { window.__gy.memoClear(); window.__gy.S.lib.data = null; window.__gy.S.lib.view = 'now'; window.__gy.go('library'); });
  await page.locator('.lib-card').first().waitFor();
  await page.click('[data-action=lib-new]');
  await page.locator('#lib-form').waitFor();
  if (!/홈에는 6개까지/.test(await page.locator('#lib-form').innerText())) problems.push('보완 자료실: 자료 넣기 창에 홈 6개 안내가 없음');
  await page.click('#lib-form [data-action=close-modal]');
  await page.evaluate(() => { window.__gy.S.home = null; window.__gy.go('home'); });
  await page.locator('.quick-card').waitFor();
  const total = (await as(page, '성춘향', 'home', {})).data.libraryTotal;
  const more = await page.locator('.quick-card .quick-more').innerText().catch(() => '');
  if (!more.includes('나머지 ' + (total - 6) + '개')) problems.push('보완 홈: 자주 찾는 자료 나머지 안내 ' + JSON.stringify([total, more]));
  await page.locator('.quick-card').scrollIntoViewIfNeeded();
  await shot(page, '보완_홈_자주찾는자료_나머지');

  // 7) '3·4학년 전담' 소속은 두 학년 모두 우리 학년. 내선에 휴대폰 번호는 막는다
  const add = await asAdmin(page, '홍길동', 'admin.staff.save', { fields: { '이름': '임꺽정', '직위': '교사', '소속': '3·4학년 전담' } });
  if (!add.ok) problems.push('보완 교직원: 임꺽정을 넣지 못함 ' + add.error);
  const phone = await asAdmin(page, '홍길동', 'admin.staff.save', { fields: { '이름': '전우치', '내선': '010-1234-5678' } });
  if (phone.ok || !/휴대폰/.test(phone.error || '')) problems.push('보완 교직원: 내선에 휴대폰 번호가 들어감');
  const all = {};
  for (let gr = 1; gr <= 6; gr++) all[gr] = [[10, 10]];
  await as(page, '심청', 'students.save', { date: today, classes: all });
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.side [data-action=switch]').first().click();
  await waitText(page, '누구신가요?');
  await verify(page, '임꺽정');
  await page.locator('.stu-card').waitFor();
  const mine = await page.evaluate(() => Array.from(document.querySelectorAll('.stu-g.mine')).map((b) => b.getAttribute('data-id')));
  if (mine.join(',') !== '3,4') problems.push('보완 우리 학년: 3·4학년 전담인데 학생 수 칸 ' + mine.join(','));
  if (await page.locator('[data-home-f=grade][disabled]').count()) problems.push("보완 우리 학년: 3·4학년 전담인데 '우리 학년' 거르기를 못 씀");
  await page.locator('.stu-card').scrollIntoViewIfNeeded();
  await shot(page, '보완_우리학년_두학년');

  // 8) 새 학년도가 되면 지난 조사·지난 공지·보관함은 '이전 학년도 보기'를 눌러(보관함은 열 때) 받는다
  const sy = Number((await asAdmin(page, '홍길동', 'admin.year.preview', {})).data.year);
  const ys = await asAdmin(page, '홍길동', 'admin.year.start', { year: String(sy + 1), keep: [] });
  if (!ys.ok) problems.push('보완 새 학년도: 넘기지 못함 ' + ys.error);
  await page.evaluate(() => { const S = window.__gy.S; window.__gy.memoClear(); S.survey.list = null; S.survey.pastAll = false; S.survey.tab = 'past'; S.survey.sel = ''; window.__gy.go('survey'); });
  if (!(await page.locator('[data-action=sv-older]').waitFor({ timeout: 5000 }).then(() => true, () => false))) problems.push('보완 조사: 지난 학년도 조사가 있는데 이전 학년도 보기가 없음');
  else {
    if (await page.locator('.sv-card', { hasText: '보완 끝낸 다른 조사' }).count()) problems.push('보완 조사: 지난 학년도 조사를 처음부터 받음');
    await shot(page, '보완_조사_이전학년도_보기');
    await page.click('[data-action=sv-older]');
    if (!(await page.locator('.sv-card', { hasText: '보완 끝낸 다른 조사' }).first().waitFor({ timeout: 5000 }).then(() => true, () => false))) problems.push('보완 조사: 이전 학년도 보기를 눌러도 지난 조사가 안 보임');
  }
  await page.evaluate(() => { const S = window.__gy.S; S.notice.older = false; S.notice.view = 'past'; window.__gy.go('notice'); });
  if (!(await page.locator('[data-action=notice-older]').waitFor({ timeout: 5000 }).then(() => true, () => false))) problems.push('보완 공지: 지난 학년도 공지가 있는데 이전 학년도 보기가 없음');
  else {
    await page.click('[data-action=notice-older]');
    if (!(await page.locator('.notice-item', { hasText: '보완 지난 날 공지' }).first().waitFor({ timeout: 5000 }).then(() => true, () => false))) problems.push('보완 공지: 이전 학년도 보기를 눌러도 지난 공지가 안 보임');
  }
  await page.evaluate(() => { const S = window.__gy.S; S.lib.data = null; S.lib.view = 'now'; window.__gy.go('library'); });
  await page.locator('#lib-list .card, #lib-list .lib-group').first().waitFor();
  const before = await page.evaluate(() => window.__gy.S.lib.data.items.filter((i) => i.archived).length);
  if (before) problems.push('보완 자료실: 보관함을 열기 전에 지난 자료를 ' + before + '개 받음');
  await page.click('[data-action=lib-view][data-v=archive]');
  if (!(await page.locator('#lib-list .lib-card').first().waitFor({ timeout: 5000 }).then(() => true, () => false))) problems.push('보완 자료실: 보관함을 열어도 지난 자료가 안 보임');
  else await shot(page, '보완_자료실_보관함_열때받기');
  await ctx.close();
}

/** 전체 보완 묶음 4(판 2026-10-19a): 메뉴 아래 내 이름·나가기, 이름 고르기 확인 단추, 오류 알림, 수정 기록 이름·거르기, 운영 안내서 1쪽 인쇄, 점검 요약, 태블릿 터치 크기 */
async function b4FixCheck(browser) {
  // 1) 낮은 노트북 창(1280×720·1366×768)에서도 메뉴 맨 아래 내 이름·나가기가 보이고, 이름 고르기의 '확인' 단추가 보인다
  for (const vp of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }]) {
    const ctx = await newCtx(browser, { viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('보완4 페이지 오류: ' + e.message));
    await page.goto(FILE);
    await waitText(page, '어서 오세요');
    await login(page);
    await page.locator('.person', { hasText: '심청' }).first().click();
    await page.waitForTimeout(600);
    const ok = await page.evaluate(() => { const r = document.querySelector('#id-form [type=submit]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
    if (ok.bottom > ok.h + 1 || ok.top < 0) problems.push('보완4 ' + vp.width + '×' + vp.height + ': 이름을 골랐는데 확인 단추가 화면 밖 ' + JSON.stringify(ok));
    if (vp.width === 1280) await shot(page, '보완4_이름고르기_확인단추_1280x720');
    await page.click('#id-form [type=submit]');
    await page.locator('.main').waitFor();
    await page.locator('.today-card').waitFor();
    const me = await page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
      return { card: r('.side .me-card'), out: r('.side [data-action=logout]'), h: innerHeight, scroll: document.querySelector('.side-scroll').scrollHeight > document.querySelector('.side-scroll').clientHeight };
    });
    if (!me.card || !me.out || me.out.bottom > me.h || me.card.top < 0) problems.push('보완4 ' + vp.width + '×' + vp.height + ': 메뉴의 내 이름·나가기가 첫 화면에 안 보임 ' + JSON.stringify(me));
    if (vp.width === 1280) await shot(page, '보완4_메뉴_내이름_나가기_1280x720');
    await ctx.close();
  }

  const ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('보완4 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor();
  // 2) 오류 알림은 닫을 때까지 남고, 보통 알림은 글 길이에 맞춰 사라진다
  await page.evaluate(() => window.__gy.toast('시험용 오류 알림이에요. 닫기를 누를 때까지 남아요.', 'error'));
  await page.waitForTimeout(9000);
  if (!(await page.evaluate(() => document.querySelector('#toast').classList.contains('show')))) problems.push('보완4: 오류 알림이 9초 안에 사라짐');
  await shot(page, '보완4_오류알림_닫기단추');
  await page.click('#toast .toast-x');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => document.querySelector('#toast').classList.contains('show'))) problems.push('보완4: 오류 알림 닫기 단추가 안 됨');
  await page.evaluate(() => window.__gy.toast('짧은 알림'));
  await page.waitForTimeout(3600);
  if (await page.evaluate(() => document.querySelector('#toast').classList.contains('show'))) problems.push('보완4: 짧은 보통 알림이 3.6초가 지나도 남음');

  // 3) 관리자 › 수정 기록: 예전 이름 '함께표'는 '취합 시트'로, 공지·학생 수·취합 시트로 거르기
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=log]');
  await page.locator('#log-tab').waitFor();
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#log-tab option')).map((o) => o.textContent));
  for (const o of ['공지', '학생 수', '취합 시트', '시트 양식']) if (opts.indexOf(o) < 0) problems.push('보완4 수정 기록: 거르기에 ' + o + '이(가) 없음 ' + opts.join(','));
  await page.selectOption('#log-tab', '취합 시트');
  await page.locator('#log-list .log-item').first().waitFor({ timeout: 6000 }).catch(() => problems.push('보완4 수정 기록: 취합 시트로 거른 기록이 없음'));
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#log-list .log-item .log-top')).map((t) => (t.querySelectorAll('.chip')[1] || {}).textContent));
  if (!chips.length || chips.some((c) => c !== '취합 시트')) problems.push('보완4 수정 기록: 표 이름 칩 ' + JSON.stringify(chips.slice(0, 5)));
  if (await page.evaluate(() => /함께표/.test(document.querySelector('#log-list').textContent.replace(/\(.*?\)/g, '')) && Array.from(document.querySelectorAll('#log-list .chip')).some((c) => /함께표/.test(c.textContent)))) problems.push('보완4 수정 기록: 칩에 예전 이름 함께표가 보임');
  await shot(page, '보완4_수정기록_취합시트');

  // 4) 관리자 › 점검: 맨 위에 고칠 것·확인할 것과 '자세히'
  await page.click('[data-admin-tab=check]');
  await page.locator('.check-sum').waitFor();
  const sum = await page.evaluate(() => ({ todo: document.querySelectorAll('.check-todo li').length, warn: document.querySelectorAll('.check-row.warn,.check-row.bad').length }));
  if (sum.todo !== sum.warn) problems.push('보완4 점검: 맨 위 목록(' + sum.todo + ')과 확인할 줄(' + sum.warn + ')이 다름');
  if (sum.todo) {
    await page.locator('.check-todo [data-action=check-go]').first().click();
    await page.waitForTimeout(300);
    if (!(await page.locator('.check-row.flash').count())) problems.push('보완4 점검: 자세히를 눌러도 그 줄로 가지 않음');
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await shot(page, '보완4_점검_맨위_확인할것');

  // 5) 운영 안내서: 선생님용 1쪽 인쇄는 A4 한 장, 모두 인쇄에는 관리자 부분도
  await page.evaluate(() => window.__gy.go('guide'));
  await page.locator('#guide-teacher').waitFor();
  const text = await page.locator('#screen').innerText();
  for (const w of ['공지', '취합 시트', '양식으로 저장', '끌어서', '장도', '백업에서 되살리기']) if (!text.includes(w)) problems.push('보완4 운영 안내서: "' + w + '" 안내가 없음');
  await shot(page, '보완4_운영안내서', true);
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('[data-action=print-guide-teacher]');
  await page.emulateMedia({ media: 'print' });
  const f = path.join(OUT, '인쇄_운영안내서_선생님용.pdf');
  await page.pdf({ path: f, preferCSSPageSize: true });
  const pages = pdfPages(f);
  if (pages !== 1) problems.push('보완4 운영 안내서: 선생님용 인쇄가 ' + pages + '쪽(한 장이어야 함)');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  if (await page.evaluate(() => document.body.classList.contains('print-guide-teacher'))) problems.push('보완4 운영 안내서: 인쇄가 끝났는데 1쪽 인쇄 모양이 남음');
  guideInfo = '운영 안내서 선생님용 인쇄 ' + pages + '쪽';
  await ctx.close();

  // 6) 태블릿(손가락): 취합 시트 도구 막대·달력 행사 칸이 손가락 크기
  const tctx = await newCtx(browser, { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 });
  const tp = await tctx.newPage();
  await tp.goto(FILE);
  await waitText(tp, '어서 오세요');
  await login(tp);
  await verify(tp, '홍길동');
  await tp.locator('.today-card').waitFor();
  const coarse = await tp.evaluate(() => matchMedia('(pointer:coarse)').matches);
  if (!coarse) problems.push('보완4 태블릿: 손가락 기기 흉내가 안 됨(pointer:coarse 아님)');
  await tp.evaluate(() => { window.__gy.S.sched.view = 'cal'; window.__gy.go('schedule'); });
  await tp.locator('.cal .ev').first().waitFor();
  const evH = await tp.evaluate(() => Math.round(document.querySelector('.cal .ev').getBoundingClientRect().height));
  if (coarse && evH < 36) problems.push('보완4 태블릿: 달력 행사 칸 높이 ' + evH + 'px');
  await shot(tp, '보완4_태블릿_달력');
  await tp.evaluate(() => { window.__gy.S.table.sel = ''; window.__gy.S.table.d = null; window.__gy.go('table'); });
  await tp.locator('.tb-card').first().click();
  await tp.locator('.tb-tools .tb-tb').first().waitFor();
  const tb = await tp.evaluate(() => ({ tool: Math.round(document.querySelector('.tb-tools .tb-tb').getBoundingClientRect().height), tab: Math.round((document.querySelector('.tb-tab') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height) }));
  if (coarse && (tb.tool < 40 || tb.tab < 44)) problems.push('보완4 태블릿: 취합 시트 단추 크기 ' + JSON.stringify(tb));
  await shot(tp, '보완4_태블릿_취합시트');
  await tctx.close();
}

/** 전체 보완 묶음 5(판 2026-10-19a) 일정: 구분 6개(회의·근무), 반복 일정(공휴일 건너뛰기·모두 지우기), 월별 계획 '관리자 근무' 칸, 주간 안내 문구·A4 인쇄 */
async function b5SchedCheck(browser) {
  const { open, toastHas } = tbKit(browser);
  const { ctx, page } = await open({ width: 1440, height: 900 }, '심청');
  const mon = await page.evaluate(() => { const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); const d = new Date(t + 'T00:00:00Z'); const w = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (w === 0 ? -6 : 1 - w)); return d.toISOString().slice(0, 10); });
  const plus = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  // 1) 행사 추가: 구분 6개(휴업일·공휴일·근무는 관리만), 반복 넣기(공휴일 건너뛰기)
  await page.evaluate((m) => { const S = window.__gy.S; S.sched.view = 'cal'; S.sched.y = +m.slice(0, 4); S.sched.m = +m.slice(5, 7); window.__gy.go('schedule'); }, mon);
  await page.locator('.cal').waitFor();
  await page.locator('[data-action=ev-add]').first().click();
  await page.locator('#ev-form').waitFor();
  const kinds = await page.evaluate(() => Array.from(document.querySelectorAll('#ev-form [data-kind]')).map((b) => b.textContent + (b.disabled ? '(잠김)' : '')));
  if (kinds.join(',') !== '행사,교육활동,회의,휴업일(잠김),공휴일(잠김),근무(잠김)') problems.push('보완5 일정: 구분 단추 ' + kinds.join(','));
  await page.fill('#ef-start', mon);
  await page.dispatchEvent('#ef-start', 'change');
  await page.fill('#ef-title', '보완 반복 협의');
  await page.click('#ev-form [data-kind="회의"]');
  await page.check('#ef-rep');
  await page.fill('#ef-rep-until', plus(mon, 28));
  await page.dispatchEvent('#ef-rep-until', 'change');
  await page.locator('#ef-rep-list .rep-days').waitFor({ timeout: 6000 }).catch(() => problems.push('보완5 일정: 반복 날짜 목록이 안 보임'));
  const rep = await page.evaluate(() => ({ all: document.querySelectorAll('#ef-rep-list .rep-days .chip').length, off: document.querySelectorAll('#ef-rep-list .rep-off').length, sum: (document.querySelector('#ef-rep-list .rep-sum') || {}).textContent || '', label: (document.querySelector('[data-rep=week]') || {}).textContent }));
  if (rep.all !== 5 || rep.off !== 1 || !/4개/.test(rep.sum)) problems.push('보완5 일정: 반복 미리보기(5개 중 공휴일 1개 건너뜀이어야 함) ' + JSON.stringify(rep));
  if (rep.label !== '매주 월요일') problems.push('보완5 일정: 반복 규칙 이름 ' + rep.label);
  await page.locator('#ef-rep-box').scrollIntoViewIfNeeded();
  await shot(page, '보완5_일정_반복넣기_미리보기');
  await page.click('[data-rep=nth]');
  const nth = await page.evaluate(() => (document.querySelector('[data-rep=nth]') || {}).textContent);
  if (!/^매월 (첫째|둘째|셋째|넷째|다섯째) 월요일$/.test(nth)) problems.push('보완5 일정: 몇째 요일 이름 ' + nth);
  await page.click('[data-rep=week]');
  await page.waitForTimeout(200);
  await page.click('#ev-form [type=submit]');
  if (!(await toastHas(page, /4번 넣었어요/))) problems.push('보완5 일정: 반복 일정을 넣었다는 알림이 없음 ' + (await page.textContent('#ef-err').catch(() => '')));
  await page.waitForTimeout(500);
  // 2) 반복 일정 하나 열기 → '반복 · 모두 4개', '이 날짜만 고치기' 창의 안내, '이 반복 모두 지우기'
  const chipSel = '.cal-d[data-day="' + mon + '"] .ev'; // 이번 주 월요일(첫 반복 날짜)은 늘 이 달력에 보인다
  await page.locator(chipSel, { hasText: '보완 반복 협의' }).first().click().catch(() => problems.push('보완5 일정: 달력에 반복 일정이 없음'));
  await page.locator('.ev-dl').waitFor({ timeout: 4000 }).catch(() => {});
  const head = await page.evaluate(() => (document.querySelector('.modal .row-btns') || {}).textContent || '');
  if (!/회의/.test(head) || !/반복 · 모두 4개/.test(head)) problems.push('보완5 일정: 반복 일정 창의 표시 ' + head);
  await shot(page, '보완5_일정_반복일정_보기');
  if (!(await page.locator('[data-action=ev-edit]').count())) { problems.push('보완5 일정: 반복 일정 창이 열리지 않음'); await ctx.close(); return; }
  await page.click('[data-action=ev-edit]');
  await page.locator('#ev-form').waitFor();
  if (!/반복 일정 중 하나예요\(모두 4개\)/.test(await page.locator('#ev-form').innerText())) problems.push('보완5 일정: 반복 일정 고치기에 안내가 없음');
  await page.click('#ev-form [data-action=ev-cancel]');
  await page.waitForTimeout(300);
  await page.locator(chipSel, { hasText: '보완 반복 협의' }).first().click();
  await page.locator('[data-action=ev-del-rep]').waitFor();
  await page.click('[data-action=ev-del-rep]');
  await page.click('#cf-ok');
  if (!(await toastHas(page, /반복 일정 4개를 지웠어요/))) problems.push('보완5 일정: 반복 모두 지우기 알림이 없음');
  await page.waitForTimeout(600);
  if (await page.locator('.cal .ev', { hasText: '보완 반복 협의' }).count()) problems.push('보완5 일정: 모두 지웠는데 달력에 남음');
  // 3) 월별 계획: '관리자 근무' 칸과 행사 칸의 [회의]
  await page.click('[data-sched-view=plan]');
  await page.locator('table.plan').waitFor();
  const plan = await page.evaluate(() => ({
    head: Array.from(document.querySelectorAll('table.plan thead th')).map((t) => t.textContent),
    duty: Array.from(document.querySelectorAll('table.plan td.c-duty')).map((t) => t.textContent).filter(Boolean),
    meet: Array.from(document.querySelectorAll('table.plan .kind-tag')).length
  }));
  if (plan.head.join(',') !== '날짜,요일,행사,교육활동,관리자 근무,담당 부서') problems.push('보완5 월별 계획: 머리 ' + plan.head.join(','));
  if (!plan.duty.some((x) => /교감 출장/.test(x))) problems.push('보완5 월별 계획: 관리자 근무 칸에 근무가 없음 ' + JSON.stringify(plan.duty));
  if (!plan.meet) problems.push('보완5 월별 계획: 행사 칸에 [회의] 표시가 없음');
  await shot(page, '보완5_월별계획_관리자근무');
  // 4) 주간 안내: 문구(이번 주·다음 주)와 복사·A4 인쇄
  await page.evaluate(() => { window.__gy.S.home = null; window.__gy.go('home'); });
  await page.locator('[data-action=week-notice]').first().click();
  await page.locator('#wn-text').waitFor({ timeout: 6000 }).catch(() => problems.push('보완5 주간 안내: 문구 칸이 안 보임'));
  const txt = await page.inputValue('#wn-text').catch(() => '');
  if (!/^\[(이번|다음) 주 학교 일정\]/.test(txt) || !/\[회의\] 16:00|16:00 \[회의\] 부장 회의/.test(txt)) problems.push('보완5 주간 안내: 문구 ' + JSON.stringify(txt.slice(0, 200)));
  if (/교감 출장/.test(txt)) problems.push('보완5 주간 안내: 관리자 근무가 처음부터 들어감');
  await page.check('#wn-duty');
  if (!/\[근무\]/.test(await page.inputValue('#wn-text'))) problems.push('보완5 주간 안내: 관리자 근무도 넣기가 안 됨');
  await shot(page, '보완5_주간안내_문구');
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied = t; return Promise.resolve(); } }); });
  await page.click('#wn-copy');
  await toastHas(page, /주간 안내 문구를 복사했어요/);
  if ((await page.evaluate(() => window.__copied)) !== (await page.inputValue('#wn-text'))) problems.push('보완5 주간 안내: 복사한 글이 문구 칸과 다름');
  await page.click('[data-wn="7"]');
  await page.waitForFunction(() => /^\[다음 주 학교 일정\]/.test((document.querySelector('#wn-text') || {}).value || ''), null, { timeout: 6000 }).catch(() => problems.push('보완5 주간 안내: 다음 주로 바뀌지 않음'));
  await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { html: document.querySelector('#print-area').innerHTML, cls: document.body.className, zoom: getComputedStyle(document.documentElement).getPropertyValue('--week-zoom').trim() }; }; });
  await page.click('#wn-print');
  await page.waitForFunction(() => !!window.__printed, null, { timeout: 4000 }).catch(() => problems.push('보완5 주간 안내: 인쇄를 부르지 않음'));
  const pr = await page.evaluate(() => window.__printed || {});
  if (!/week-print/.test(pr.html || '') || !/printing-week/.test(pr.cls || '')) problems.push('보완5 주간 안내: 인쇄 모양 ' + JSON.stringify({ cls: pr.cls }));
  if (!(Number(pr.zoom) > 0 && Number(pr.zoom) <= 1)) problems.push('보완5 주간 안내: 인쇄 배율 ' + pr.zoom);
  await page.waitForTimeout(700);
  if (await page.evaluate(() => document.body.classList.contains('printing-week') || !!document.querySelector('#print-area').innerHTML)) problems.push('보완5 주간 안내: 인쇄 뒤 인쇄 모양이 남음');
  await ctx.close();
}

/**
 * 묶음 5-3(판 2026-10-19a): 취합 시트 목록 찾기·부서 고르기, 기본 양식(대피 훈련 인원 확인: 숫자 열·할 일 열), 숫자 열 합계·평균(걸러 보면 보이는 줄만),
 * 할 일 열(표 위 남은 줄·안 채운 분 문구 복사, 홈 '내가 할 일'·채우기, 직접 본 시트가 더 새로우면 홈도 바로), 홈 검색의 취합 시트, 휴대폰 줄 찾기·내 이름이 있는 줄
 */
async function b5TableCheck(browser) {
  const { open, toastHas, saved, cell, as, toList } = tbKit(browser);
  const P = (m) => problems.push('보완5 표: ' + m);
  // 1) 목록: 찾기 칸·부서 고르기(흥부, 인성안전부)
  let { ctx, page } = await open({ width: 1440, height: 900 }, '흥부');
  await toList(page);
  await page.locator('.tb-card').first().waitFor();
  await page.fill('#tb-lq', '특별실');
  await page.waitForTimeout(150);
  if ((await page.locator('.tb-card').count()) !== 2) P('목록 찾기 "특별실"(표 이름·시트 이름)이 ' + (await page.locator('.tb-card').count()) + '개');
  await page.fill('#tb-lq', '과학실');
  await page.waitForTimeout(150);
  if ((await page.locator('.tb-card').count()) !== 1) P('목록 찾기 "과학실"이 ' + (await page.locator('.tb-card').count()) + '개');
  await shot(page, '보완5_표목록_찾기');
  await page.fill('#tb-lq', '');
  const depts = await page.locator('#tb-ldept option').allInnerTexts();
  if (depts.join(',') !== '모든 부서,연구부,인성안전부') P('부서 고르기가 ' + depts.join(','));
  await page.selectOption('#tb-ldept', { label: '인성안전부' });
  await page.waitForTimeout(150);
  if ((await page.locator('.tb-card').count()) !== 2) P('부서 인성안전부가 ' + (await page.locator('.tb-card').count()) + '개');
  await page.selectOption('#tb-ldept', '');
  // 2) 새 표 › 양식에서 고르기 › 대피 훈련 인원 확인: 숫자 열 2개, 담임 열이 할 일 열
  await page.click('[data-action=tb-new]');
  await page.click('#tbm-how [data-how="tpl"]');
  await page.locator('#tbm-tplbox [data-tpl="B8"]').waitFor();
  const card8 = (await page.locator('#tbm-tplbox [data-tplw="B8"]').innerText()).replace(/\s+/g, ' ');
  if (!/교직원 소속으로 8줄/.test(card8) || !/할 일 열/.test(card8)) P('대피 훈련 양식 카드가 ' + card8);
  await page.click('#tbm-tplbox [data-tpl="B8"]');
  await page.locator('#tbm-prev .tb-prevt').waitFor({ timeout: 6000 }).catch(() => P('양식 미리보기가 보이지 않음'));
  const pv = await page.evaluate(() => ({
    types: [...document.querySelectorAll('#tbm-prev thead [data-mk=type]')].map((x) => x.textContent).join(','),
    todo: [...document.querySelectorAll('#tbm-prev thead [data-mk=todo].on')].map((x) => x.closest('th').querySelector('.tb-cn').value).join(','),
    note: (document.querySelector('#tbm-auto') || {}).textContent || ''
  }));
  if (pv.types !== '글,글,글,숫자,숫자,글') P('열 종류가 ' + pv.types);
  if (pv.todo !== '담임') P('할 일 열이 ' + pv.todo);
  if (!/'담임' 열이 할 일 열이에요/.test(pv.note)) P('할 일 열 안내가 ' + pv.note);
  await shot(page, '보완5_양식_대피훈련_미리보기');
  await page.fill('#tbm-title', '대피 훈련 인원 확인(예시)');
  await page.click('#tbm-go');
  await page.locator(cell(0, 0)).waitFor({ timeout: 6000 }).catch(() => P('양식으로 만든 표가 열리지 않음'));
  await page.waitForTimeout(300);
  // 3) 숫자 열: 오른쪽 맞춤, 합계·평균, 숫자가 아닌 칸은 따로
  const typeIn = async (i, j, v) => { await page.click(cell(i, j)); await page.keyboard.type(v); await page.keyboard.press('Enter'); await saved(page, v); };
  await typeIn(0, 3, '25');
  await typeIn(1, 3, '24');
  await typeIn(0, 4, '25');
  await typeIn(1, 4, '23');
  await typeIn(4, 4, '스물'); // 4학년 1반(숫자가 아닌 값도 지우지 않고 따로 센다)
  const bar = async () => (await page.locator('#tb-bar').innerText()).replace(/\s+/g, ' ');
  let b = await bar();
  if (!/재적 합계 49 · 평균 24\.5/.test(b) || !/대피 인원 합계 48 · 평균 24 · 숫자 아닌 칸 1/.test(b)) P('합계·평균이 ' + b);
  if (!/할 일 남은 줄 5 · 5명/.test(b) || !(await page.locator('[data-action=tb-todo-copy]').count())) P('할 일 표시가 ' + b); // 1·2학년은 다 채움, 6학년 1반은 담임 이름이 없음
  const align = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).textAlign, cell(0, 3));
  if (align !== 'right') P('숫자 칸이 오른쪽 맞춤이 아님(' + align + ')');
  if (!(await page.locator('#tb-wrap th.tb-h .td').count())) P('열 이름에 할 일 열 표시가 없음');
  await shot(page, '보완5_숫자열_합계_할일');
  // 2학년만 걸러 보면 합계는 보이는 줄만(열 이름 ▾ › 모두 지우기 › 2학년 › 보기)
  await page.click('#tb-wrap [data-action=tb-head][data-j="0"]');
  await page.locator('.tb-menu .tb-fl').waitFor();
  await page.click('.tb-menu [data-all="0"]');
  await page.locator('.tb-menu .tb-fl label', { hasText: '2학년' }).locator('input').check();
  await page.click('.tb-menu [data-apply="1"]');
  await page.waitForTimeout(250);
  b = await bar();
  if (!/재적 합계 24 · 평균 24 대피 인원 합계 23 · 평균 23 합계·평균은 보이는 줄만/.test(b)) P('걸러 본 합계가 ' + b);
  await shot(page, '보완5_숫자열_걸러본합계');
  await page.click('[data-action=tb-local-clear]').catch(() => P('모두 풀기 단추가 없음'));
  await page.waitForTimeout(200);
  // 안 채운 분 문구 복사
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied = t; return Promise.resolve(); } }); });
  await page.click('[data-action=tb-todo-copy]');
  await toastHas(page, /문구를 복사했어요/);
  const msg = await page.evaluate(() => window.__copied || '');
  if (!/^\[취합 시트\] 대피 훈련 인원 확인\(예시\)\n아직 안 채운 분: 홍길동 선생님, 성춘향 선생님, 이몽룡 선생님, 심청 선생님, 흥부 선생님 \(5명\)\n/.test(msg)) P('안 채운 분 문구가 ' + JSON.stringify(msg));
  // 열 고치기: 숫자 종류·할 일 열
  await page.click('[data-action=tb-menu]');
  await page.locator('.tb-menu button', { hasText: '열 고치기' }).click();
  await page.locator('#tbc-list').waitFor();
  const ed = await page.evaluate(() => ({
    types: [...document.querySelectorAll('#tbc-list .tb-ct')].map((x) => x.value).join(','),
    todo: [...document.querySelectorAll('#tbc-list .tb-ctd')].map((x) => (x.checked ? 'v' : '') + (x.disabled ? 'x' : '-')).join('')
  }));
  if (ed.types !== 'text,text,text,num,num,text' || ed.todo !== '--v-xx-') P('열 고치기 창이 ' + JSON.stringify(ed));
  await shot(page, '보완5_열고치기_숫자_할일');
  await page.click('#tbc-list .tb-colrow[data-k="0"] .tb-ctd'); // 다른 열을 켜면 담임은 꺼진다(하나만)
  const one = await page.evaluate(() => [...document.querySelectorAll('#tbc-list .tb-ctd')].filter((x) => x.checked).length);
  if (one !== 1) P('할 일 열이 ' + one + '개 켜짐');
  await page.click('.modal [data-action=close-modal]');

  // 4) 홈: 홍길동(3학년 1반 담임)의 '내가 할 일'에 취합 시트 → 채우기로 그 표 열기 → 채우면 홈에서도 바로 빠짐(직접 본 시트)
  //    미리보기의 자료는 창(브라우저 탭)마다 따로라 같은 창에서 선생님을 바꾼다
  await page.click('.side [data-action=switch]');
  await verify(page, '홍길동');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.todo-card').waitFor();
  const todo = (await page.locator('.todo-card').innerText()).replace(/\s+/g, ' ');
  if (!/취합 시트/.test(todo) || !/대피 훈련 인원 확인\(예시\)/.test(todo) || !/내 이름이 있는 줄 1개가 남았어요/.test(todo)) P('홈 내가 할 일이 ' + todo.slice(0, 200));
  await page.locator('.todo-card [data-action=todo-table]').scrollIntoViewIfNeeded();
  await shot(page, '보완5_홈_내가할일_취합시트');
  await page.click('.todo-card [data-action=todo-table]');
  await page.locator(cell(0, 0)).waitFor({ timeout: 6000 }).catch(() => P('채우기를 눌러도 표가 열리지 않음'));
  if ((await page.evaluate(() => (window.__gy.S.table.d || { table: {} }).table.title)) !== '대피 훈련 인원 확인(예시)') P('다른 표가 열림');
  await page.click(cell(2, 3));
  await page.keyboard.type('21');
  await page.keyboard.press('Enter');
  await saved(page, '21');
  await page.click(cell(2, 4));
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await saved(page, '20');
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.todo-card').waitFor();
  if (/대피 훈련 인원 확인/.test(await page.locator('.todo-card').innerText())) P('채웠는데 홈에 그대로(직접 본 시트를 믿지 않음)');
  // 5) 홈 검색: 취합 시트
  await page.fill('#home-q', '대피 훈련');
  await page.press('#home-q', 'Enter');
  await page.locator('.search-res').waitFor();
  const sr = (await page.locator('.search-res').innerText()).replace(/\s+/g, ' ');
  if (!/취합 시트/.test(sr) || !/대피 훈련 인원 확인\(예시\)/.test(sr)) P('홈 검색에 취합 시트가 없음 ' + sr.slice(0, 200));
  await shot(page, '보완5_홈검색_취합시트');
  await page.click('.search-res [data-action=sr-table]');
  await page.locator(cell(0, 0)).waitFor({ timeout: 6000 }).catch(() => P('검색 결과를 눌러도 표가 열리지 않음'));
  await ctx.close();

  // 6) 휴대폰: 줄 찾기·내 이름이 있는 줄(새 창이라 표를 다시 만든다)
  ({ ctx, page } = await open({ width: 390, height: 844 }, '심청', true));
  const tp = await as(page, '흥부', 'table.tpl.get', { id: 'B8' });
  const mk = await as(page, '흥부', 'table.create', { fields: { title: '대피 훈련 인원 확인(예시)' }, cols: tp.data.cols, rows: tp.data.rows });
  if (!mk.ok) P('휴대폰 점검용 표를 만들지 못함 ' + mk.error);
  await toList(page);
  await page.locator('.tb-card', { hasText: '대피 훈련 인원 확인' }).first().click();
  await page.locator('.tb-rowcard').first().waitFor();
  await page.fill('#tb-rq', '4학년');
  await page.waitForTimeout(200);
  if ((await page.locator('.tb-rowcard').count()) !== 1) P('휴대폰 줄 찾기 "4학년"이 ' + (await page.locator('.tb-rowcard').count()) + '줄');
  await page.fill('#tb-rq', '');
  await page.click('[data-action=tb-rmine]');
  await page.waitForTimeout(200);
  const mine = await page.locator('.tb-rowcard').allInnerTexts();
  if (mine.length !== 1 || !/심청/.test(mine[0])) P('내 이름이 있는 줄이 ' + JSON.stringify(mine));
  await shot(page, '보완5_휴대폰_내이름줄', true);
  await ctx.close();
}

/** 묶음 5-4(판 2026-10-19a): 운영 안내서의 바탕화면 바로가기 안내와 '바로가기 파일 받기'(.url 내려받기) */
async function b5ShortcutCheck(browser) {
  const { open, toastHas } = tbKit(browser);
  const P = (m) => problems.push('보완5 바로가기: ' + m);
  const { ctx, page } = await open({ width: 1440, height: 900 }, '심청');
  await page.evaluate(() => window.__gy.go('guide'));
  await page.locator('[data-action=shortcut-file]').waitFor();
  await page.locator('[data-action=shortcut-file]').scrollIntoViewIfNeeded();
  await shot(page, '보완5_운영안내서_바로가기');
  await page.click('[data-action=shortcut-file]');
  await page.locator('#sc-url').waitFor();
  if (await page.inputValue('#sc-url')) P('미리보기는 웹앱 주소를 모르는데 칸이 채워짐');
  await page.click('#sc-go');
  if (!/https:\/\/로 시작하는/.test(await page.locator('#sc-err').innerText())) P('주소 없이 받을 때 안내가 없음');
  await page.fill('#sc-url', 'https://script.google.com/macros/s/AKfy-preview/exec');
  await shot(page, '보완5_바로가기_파일받기');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }), page.click('#sc-go')]).catch(() => [null]);
  if (!dl) { P('파일을 내려받지 않음'); await ctx.close(); return; }
  if (dl.suggestedFilename() !== '온라인 교무실.url') P('파일 이름이 ' + dl.suggestedFilename());
  const body = fs.readFileSync(await dl.path(), 'utf8');
  if (body !== '[InternetShortcut]\r\nURL=https://script.google.com/macros/s/AKfy-preview/exec\r\n') P('파일 내용이 ' + JSON.stringify(body));
  if (!(await toastHas(page, /바로가기 파일을 받았어요/))) P('받았다는 알림이 없음');
  await ctx.close();
}

/**
 * 자동 등록 파일(.bat, 판 2026-10-20a): 운영 안내서 '들어오기'의 두 단추, 창(주소 검사·파일 받기·안내 글 복사), 받은 파일의 바이트(CP949·CRLF), 휴대폰 창
 * 윈도우에서 실제로 돌려 보는 것은 이 환경에서 할 수 없다(확인 필요). 파일 모양은 test.js가 줄마다 본다
 */
async function batCheck(browser) {
  const { open, toastHas } = tbKit(browser);
  const P = (m) => problems.push('자동 등록 파일: ' + m);
  const URL0 = 'https://script.google.com/macros/s/AKfy-preview/exec';
  let { ctx, page } = await open({ width: 1440, height: 900 }, '심청');
  await page.evaluate(() => window.__gy.go('guide'));
  await page.locator('[data-action=bat-file]').waitFor();
  await page.locator('[data-action=bat-file]').scrollIntoViewIfNeeded();
  await shot(page, '등록파일_운영안내서_단추');
  const boxes = await page.evaluate(() => ['shortcut-file', 'bat-file'].map((a) => { const r = document.querySelector('[data-action=' + a + ']').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top }; }));
  if (boxes[1].l < boxes[0].r + 4 && Math.abs(boxes[1].t - boxes[0].t) < 4) P('두 단추가 붙거나 겹침 ' + JSON.stringify(boxes));
  await page.click('[data-action=bat-file]');
  await page.locator('#bat-url').waitFor();
  if (await page.inputValue('#bat-url')) P('미리보기는 웹앱 주소를 모르는데 칸이 채워짐');
  await page.click('#bat-go');
  if (!/https:\/\/로 시작하는/.test(await page.locator('#bat-err').innerText())) P('주소 없이 받을 때 안내가 없음');
  await page.fill('#bat-url', URL0 + '&calc');
  await page.click('#bat-go');
  if (!/넣을 수 없는 글자/.test(await page.locator('#bat-err').innerText())) P('& 든 주소를 막지 않음');
  await page.fill('#bat-url', URL0);
  if (await page.locator('#bat-err').innerText()) P('고친 뒤에도 안내가 남음');
  await shot(page, '등록파일_창');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }), page.click('#bat-go')]).catch(() => [null]);
  if (!dl) { P('파일을 내려받지 않음'); await ctx.close(); return; }
  if (dl.suggestedFilename() !== '온라인 교무실 등록.bat') P('파일 이름이 ' + dl.suggestedFilename());
  const buf = fs.readFileSync(await dl.path());
  const txt = new TextDecoder('euc-kr').decode(buf);
  const head2 = Buffer.from('@echo off\r\nchcp 949 >nul\r\n');
  if (!buf.subarray(0, head2.length).equals(head2)) P('맨 앞 두 줄이 다름');
  if (!txt.includes('\r\nset "URL=' + URL0 + '"\r\n')) P('주소 줄이 없음');
  if (!buf.includes(Buffer.from([0xbf, 0xc2, 0xb6, 0xf3, 0xc0, 0xce]))) P('한글이 CP949가 아님');
  if (/[^\r]\n/.test(txt) || !txt.endsWith('\r\n')) P('CRLF가 아닌 줄');
  if (!(await toastHas(page, /자동 등록 파일을 받았어요/))) P('받았다는 알림이 없음');
  if (!(await page.locator('#bat-url').isVisible())) P('받은 뒤 창이 닫힘(안내 글 복사를 이어서 못 함)');
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (t) => { window.__copied = t; return Promise.resolve(); } }); });
  await page.click('#bat-copy');
  if (!(await toastHas(page, /안내 글을 복사했어요/))) P('복사 알림이 없음');
  const copied = await page.evaluate(() => window.__copied);
  if (!copied || !copied.includes('온라인 교무실 등록.bat') || !copied.includes(URL0) || !/3번: 저절로 열기 끄기/.test(copied)) P('안내 글 ' + JSON.stringify(copied));
  await shot(page, '등록파일_안내글복사');
  await ctx.close();
  // 휴대폰: 단추와 창이 화면 안에
  ({ ctx, page } = await open({ width: 390, height: 844 }, '심청', true));
  await page.evaluate(() => window.__gy.go('guide'));
  await page.locator('[data-action=bat-file]').waitFor();
  await page.locator('[data-action=bat-file]').scrollIntoViewIfNeeded();
  await shot(page, '등록파일_휴대폰_단추');
  await page.click('[data-action=bat-file]');
  await page.locator('#bat-url').waitFor();
  const over = await page.evaluate(() => { const r = document.querySelector('.modal').getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1 || document.documentElement.scrollWidth > innerWidth + 1; });
  if (over) P('휴대폰에서 창이 넘침');
  await shot(page, '등록파일_휴대폰_창');
  await ctx.close();
}

/**
 * 자료 끌어다 놓기(판 2026-10-21b, 교사 요청): 자료실 화면에 여러 파일 → 창(파일마다 제목, 큰 파일 막기·빼기) → 한 번에 넣기,
 * 창 안에 파일 하나('링크'였어도 파일 올리기로, 제목 채움), 다른 화면에 놓아도 브라우저가 파일을 열지 않음, 도움말 파일 칸,
 * 휴대폰은 '파일 고르기'로 여러 개, 종이색·어둡게 사진
 */
async function dropCheck(browser) {
  const { open, toastHas } = tbKit(browser);
  const P = (m) => problems.push('끌어다 놓기: ' + m);
  // 파일을 만들어 끌어 온 것처럼 보낸다(dragenter → dragover → drop). big = MB
  const dropFiles = (page, sel, files, overOnly) => page.evaluate(([s, fs, oo]) => {
    const dt = new DataTransfer();
    fs.forEach((f) => dt.items.add(new File([f.big ? new Uint8Array(f.big * 1024 * 1024 + 10) : f.text], f.name, { type: f.type || 'application/octet-stream' })));
    const el = document.querySelector(s);
    const fire = (t) => { const e = new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
    fire('dragenter');
    const over = fire('dragover');
    return oo ? { over } : { over, drop: fire('drop') };
  }, [sel, files, !!overOnly]);
  // 진짜 끌어다 놓기(크롬 CDP Input.dispatchDragEvent): 디스크의 파일을 브라우저가 직접 끌어 온다. 놓을 수 없는 곳(dropEffect 'none')이면
  // 브라우저가 drop을 보내지 않는다 → window.__dropSeen으로 본다. 위의 흉내(dropFiles)로는 dropEffect를 볼 수 없다(크롬이 무시함)
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gy-drop-'));
  const real = ['진짜 끌기 시험.hwp', '두번째 파일.pdf'].map((nm, k) => { const f = path.join(tmp, nm); fs.writeFileSync(f, '진짜 파일 ' + (k + 1)); return f; });
  const realDrop = async (page, sel, paths) => {
    await page.evaluate(() => { window.__dropSeen = false; window.addEventListener('drop', () => { window.__dropSeen = true; }, { capture: true, once: true }); });
    const box = await page.locator(sel).first().boundingBox();
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + Math.min(box.height / 2, 40));
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: paths, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
    await cdp.detach();
    await page.waitForTimeout(300);
    return page.evaluate(() => window.__dropSeen);
  };
  const rowsOf = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#lf-rows .file-row')).map((r) => ({
    name: r.querySelector('.fr-name b').textContent, t: r.querySelector('[data-fr-t]') ? r.querySelector('[data-fr-t]').value : null, bad: r.classList.contains('bad')
  })));
  let { ctx, page } = await open({ width: 1280, height: 900 }, '심청');
  await page.evaluate(() => window.__gy.go('library'));
  await page.locator('.lib-card').first().waitFor();
  const maxMb = await page.evaluate(() => window.__gy.S.lib.data.maxMb);
  // 1) 자료실 화면에 끌어 오면 화면 전체 덮개
  const o1 = await dropFiles(page, '#lib-list', [{ name: '학년 협의록 양식.hwp', text: '가짜 한글' }], true);
  if (!o1.over) P('끌어 올 때 기본 동작을 막지 않음(dragover)'); // 놓을 수 있는지(dropEffect)는 아래 진짜 끌기로 본다
  await page.locator('#drop-cover').waitFor({ timeout: 2000 }).catch(() => P('자료실 화면에 끌어 와도 덮개가 안 보임'));
  await shot(page, '끌어놓기_자료실_덮개');
  await page.locator('#drop-cover').waitFor({ state: 'detached', timeout: 3000 }).catch(() => P('끌어 오다 그만두었는데 덮개가 남음'));
  // 2) 여러 파일을 놓으면 창: 파일마다 제목(확장자 뺌), 한도를 넘는 파일은 빨간 줄
  const r2 = await dropFiles(page, '#lib-list', [
    { name: '학년 협의록 양식.hwp', text: '가짜 한글 1' }, { name: '출결 확인 양식.xlsx', text: '가짜 엑셀' },
    { name: '현장체험학습 안내.pdf', text: '가짜 PDF' }, { name: '아주 큰 동영상.mp4', big: maxMb + 1 }]);
  if (!r2.drop) P('놓을 때 브라우저가 파일을 여는 것을 막지 않음');
  await page.locator('#lib-form').waitFor({ timeout: 3000 }).catch(() => P('놓아도 자료 넣기 창이 안 열림'));
  if (await page.locator('#drop-cover').count()) P('놓은 뒤에도 덮개가 남음');
  let rows = await rowsOf(page);
  if (rows.length !== 4 || rows[0].t !== '학년 협의록 양식' || rows[2].t !== '현장체험학습 안내' || !rows[3].bad || rows.slice(0, 3).some((x) => x.bad)) P('여러 파일 줄 ' + JSON.stringify(rows));
  if (!(await page.locator('#lf-title-box').isHidden())) P('여러 파일인데 제목 칸이 보임');
  if (!(await page.locator('#lib-form [data-mode=file][aria-pressed=true]').count())) P('파일 올리기로 바뀌지 않음');
  if (!(await page.locator('#lib-form [data-mode=link]').isDisabled())) P('여러 파일인데 링크로 바꿀 수 있음');
  if ((await page.locator('#lf-go').innerText()).trim() !== '4개 넣기') P('단추 글: ' + (await page.locator('#lf-go').innerText()));
  await page.waitForTimeout(150);
  if (!(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fr-t') === '0'))) P('첫 파일의 제목 칸으로 커서가 가지 않음');
  await shot(page, '끌어놓기_여러파일_창');
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); document.documentElement.setAttribute('data-design', 'paper'); });
  await shot(page, '끌어놓기_여러파일_창_종이색어둡게');
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); document.documentElement.setAttribute('data-design', 'base'); });
  await page.click('#lf-go');
  if (!/빼 주세요/.test(await page.locator('#lf-err').innerText())) P('한도를 넘는 파일이 있는데 막지 않음');
  await page.click('#lf-rows .file-row:nth-child(4) [data-fr-x]');
  await page.fill('[data-fr-t="1"]', '출결 확인 양식(2학기)');
  if ((await page.locator('#lf-go').innerText()).trim() !== '3개 넣기') P('뺀 뒤 단추 글: ' + (await page.locator('#lf-go').innerText()));
  await page.click('#lf-go');
  if (!(await toastHas(page, /3개 자료를 넣었어요/))) P('여러 파일을 넣었다는 알림이 없음');
  await page.locator('#lib-form').waitFor({ state: 'detached', timeout: 8000 }).catch(() => P('다 넣었는데 창이 닫히지 않음'));
  const want = ['학년 협의록 양식', '출결 확인 양식(2학기)', '현장체험학습 안내'];
  const saved = await page.evaluate((w) => window.__gy.S.lib.data.items.filter((x) => w.indexOf(x.title) >= 0).map((x) => ({ t: x.title, f: x.fileName, has: x.hasFile, dept: x.deptId, owner: x.owner })), want);
  if (saved.length !== 3 || saved.some((x) => !x.has || x.dept !== saved[0].dept || x.owner !== '심청')) P('저장된 자료 ' + JSON.stringify(saved));
  if (!saved.some((x) => x.t === '출결 확인 양식(2학기)' && x.f === '출결 확인 양식.xlsx')) P('고친 제목·파일 이름이 다름 ' + JSON.stringify(saved));
  for (const t of want) if (!(await page.locator('.lib-card', { hasText: t }).count())) P('목록에 없음: ' + t);
  await shot(page, '끌어놓기_여러파일_넣은뒤');
  // 3) 창 안에 파일 하나: '링크'였어도 파일 올리기로 바뀌고 제목이 채워진다. 끌어 오는 동안 숨은 상자 대신 창 전체를 밝힘
  await page.click('[data-action=lib-new]');
  await page.locator('#lib-form').waitFor();
  await modalSettled(page);
  await dropFiles(page, '#lf-desc', [{ name: '교실 안전 점검표.hwp', text: '가짜 점검표' }], true);
  if (!(await page.locator('.modal.drop-over').count())) P("'링크'일 때 끌어 와도 창이 밝아지지 않음");
  await shot(page, '끌어놓기_창_끌어오는중');
  await dropFiles(page, '#lf-desc', [{ name: '교실 안전 점검표.hwp', text: '가짜 점검표' }]);
  if (await page.locator('.modal.drop-over').count()) P('놓은 뒤에도 창 테두리가 남음');
  if ((await page.inputValue('#lf-title')) !== '교실 안전 점검표') P('제목이 파일 이름으로 채워지지 않음: ' + (await page.inputValue('#lf-title')));
  if (!(await page.locator('#lf-file-box').isVisible())) P('파일 칸으로 바뀌지 않음');
  rows = await rowsOf(page);
  if (rows.length !== 1 || rows[0].t !== null) P('파일 하나 줄 ' + JSON.stringify(rows));
  await shot(page, '끌어놓기_창에_하나');
  await page.click('#lf-go');
  if (!(await toastHas(page, /"교실 안전 점검표" 자료를 넣었어요/))) P('파일 하나를 넣었다는 알림이 없음');
  // 4) 다른 화면(홈)에 떨어뜨리면: 브라우저 기본 동작(파일 열기)을 막고 아무 창도 열지 않음
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  const r4 = await dropFiles(page, '.today-card', [{ name: '아무거나.hwp', text: 'x' }]);
  if (!r4.drop) P('홈에 떨어뜨리면 브라우저가 파일을 열 수 있음(기본 동작을 막지 않음)');
  const url0 = page.url();
  const seenHome = await realDrop(page, '.today-card', real.slice(0, 1));
  if (seenHome) P('홈인데 놓을 수 있다고 알림(진짜 끌기에서 drop이 옴)');
  if (page.url() !== url0 || !(await page.evaluate(() => !!(window.__gy && document.querySelector('.today-card'))))) P('홈에 진짜로 떨어뜨렸더니 웹앱을 떠남 ' + page.url());
  if (await page.locator('.modal').count()) P('홈에 떨어뜨렸는데 창이 열림');
  // 자료실: 진짜 끌기로 놓으면(drop이 옴) 파일 두 개가 창에 들어간다
  await page.evaluate(() => window.__gy.go('library'));
  await page.locator('.lib-card').first().waitFor();
  const seenLib = await realDrop(page, '#lib-list', real);
  if (!seenLib) P('자료실인데 진짜 끌기에서 놓을 수 없음(drop이 안 옴)');
  await page.locator('#lib-form').waitFor({ timeout: 3000 }).catch(() => P('진짜로 끌어다 놓아도 창이 안 열림'));
  const realRows = await rowsOf(page);
  if (realRows.map((x) => x.name).join() !== '진짜 끌기 시험.hwp,두번째 파일.pdf' || realRows[0].t !== '진짜 끌기 시험') P('진짜로 끌어 온 파일 줄 ' + JSON.stringify(realRows));
  await page.click('#lib-form [data-action=close-modal]');
  await page.locator('#lib-form').waitFor({ state: 'detached' });
  // 5) 도움말: 파일 칸에 놓기(파일 하나)
  await page.evaluate(() => window.__gy.go('help'));
  await page.locator('.help-item').first().waitFor(); // 목록을 받은 뒤에야 '도움말 쓰기'가 창을 연다
  await page.click('[data-action=help-new]');
  await page.locator('#help-form').waitFor();
  await modalSettled(page);
  await dropFiles(page, '#hf-file-zone', [{ name: '학교폭력 신고 절차.pdf', text: '가짜 1' }, { name: '두 번째.pdf', text: '가짜 2' }]);
  const hf = await page.evaluate(() => ({ rows: Array.from(document.querySelectorAll('#hf-rows .fr-name b')).map((b) => b.textContent), err: document.querySelector('#hf-err').textContent }));
  if (hf.rows.join() !== '학교폭력 신고 절차.pdf' || !/첫 파일만/.test(hf.err)) P('도움말 파일 칸 ' + JSON.stringify(hf));
  await shot(page, '끌어놓기_도움말');
  await ctx.close();
  // 6) 휴대폰: 상자 안의 '파일 고르기'로 여러 개 고르기
  ({ ctx, page } = await open({ width: 390, height: 844 }, '심청', true));
  await page.evaluate(() => window.__gy.go('library'));
  await page.locator('.lib-card').first().waitFor();
  await page.click('[data-action=lib-new]');
  await page.locator('#lib-form').waitFor();
  await modalSettled(page);
  await page.click('#lib-form [data-mode=file]');
  await page.locator('#lf-file-pick').scrollIntoViewIfNeeded();
  await shot(page, '끌어놓기_휴대폰_상자');
  await page.setInputFiles('#lf-file', [{ name: '가정통신문 양식.hwp', mimeType: 'application/x-hwp', buffer: Buffer.from('가짜 1') }, { name: '상담 일지.hwp', mimeType: 'application/x-hwp', buffer: Buffer.from('가짜 2') }]);
  rows = await rowsOf(page);
  if (rows.length !== 2 || rows[1].t !== '상담 일지') P('휴대폰에서 여러 개 고르기 ' + JSON.stringify(rows));
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || Array.from(document.querySelectorAll('.file-row')).some((r) => r.getBoundingClientRect().right > innerWidth + 1));
  if (wide) P('휴대폰에서 파일 줄이 넘침');
  await page.locator('#lf-rows').scrollIntoViewIfNeeded();
  await shot(page, '끌어놓기_휴대폰_여러개');
  await ctx.close();
}

/**
 * 취합 시트 화면 파일(TableUi.html) 받기(판 2026-10-19a, 45)
 *  1) 열 때 받기(기본): 첫 화면에는 없고 취합 시트를 처음 열 때 한 번 받는다(홈 '채우기'로 바로 그 표). 서버에 파일이 없으면 그 화면만 안내, 점검은 '문제'
 *  2) 처음에 함께(설정 '처음에 함께', 예전 방식): 처음부터 들어 있어 받지 않는다. 파일이 없으면 그 화면만 안내
 */
async function tableMissingCheck(browser) {
  const P = (m) => problems.push('표 화면 파일: ' + m);
  const spy = () => { window.__calls = []; let o = null; Object.defineProperty(window, '__previewServer', { configurable: true, get() { return o && ((req) => { window.__calls.push(JSON.parse(req).action); return o(req); }); }, set(v) { o = v; } }); };
  // 1-가) 열 때 받기: 처음엔 없고, 열 때 한 번
  let ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(spy);
  let page = await ctx.newPage();
  page.on('pageerror', (e) => P('페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor();
  const before = await page.evaluate(() => ({ lazy: !!window.__gyTableUiLazy, fn: typeof window.__gyTableUi, tb: !!window.__gy.tableUi() }));
  if (!before.lazy || before.fn !== 'undefined' || before.tb) P('첫 화면에 이미 들어 있음 ' + JSON.stringify(before));
  await page.click('.side [data-go=table]');
  await page.locator('.tb-card').first().waitFor({ timeout: 8000 }).catch(() => P('열 때 받아 목록이 열리지 않음'));
  await page.click('.side [data-go=home]');
  await page.click('.side [data-go=table]');
  await page.locator('.tb-card').first().waitFor();
  const n1 = await page.evaluate(() => window.__calls.filter((a) => a === 'ui.table').length);
  if (n1 !== 1) P('화면 파일을 ' + n1 + '번 받음(한 번이어야 함)');
  await ctx.close();
  // 1-나) 홈 '채우기'(화면 파일을 받기 전)로 바로 그 표: 받은 뒤에 연다
  ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => P('페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor();
  await page.evaluate(() => { const b = document.createElement('button'); b.setAttribute('data-action', 'todo-table'); b.setAttribute('data-id', window.__previewTableId || ''); b.id = 'fake-todo'; document.body.appendChild(b); });
  const doc = await page.evaluate(async () => {
    const login = localStorage.getItem('gy.login') || sessionStorage.getItem('gy.login');
    const r = JSON.parse(await window.__previewServer(JSON.stringify({ action: 'table.list', args: {}, tokens: { login } })));
    return r.data.tables.find((t) => /특별실/.test(t.title)).id;
  });
  await page.evaluate((id) => { const b = document.querySelector('#fake-todo'); b.setAttribute('data-id', id); b.click(); }, doc);
  await page.locator('#tb-detail .tb-bar .chip').first().waitFor({ timeout: 8000 }).catch(() => P('받기 전에 누른 표가 열리지 않음'));
  const opened = await page.evaluate(() => (window.__gy.S.table.d || { table: {} }).table.title || '');
  if (!/특별실/.test(opened)) P('받은 뒤에 다른 표가 열림 ' + opened);
  await ctx.close();
  // 1-다) 서버에 파일이 없음: 그 화면만 안내, 점검은 문제
  ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { window.__previewNoTableUi = true; });
  page = await ctx.newPage();
  page.on('pageerror', (e) => P('파일 없음 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor().catch(() => P('파일 없음: 홈이 열리지 않음'));
  await page.click('.side [data-go=table]');
  if (!(await page.getByText('화면 파일(TableUi)이 아직 없거나').first().waitFor({ timeout: 6000 }).then(() => true, () => false))) P('파일 없음: 표 화면에 안내가 없음');
  await shot(page, '표_화면파일_없음');
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=check]');
  if (!(await page.locator('text=TableUi.html').first().waitFor({ timeout: 8000 }).then(() => true, () => false))) P('파일 없음: 점검에 TableUi가 없음');
  else if (!(await page.getByText("'TableUi' 파일을 새로 만들고").first().count())) P('파일 없음: 점검이 TableUi 새로 만들기를 알려 주지 않음');
  await ctx.close();
  // 1-라) 열 때 받기 + 파일이 있으면 점검은 서버 파일의 판으로 '정상'
  ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=settings]');
  await page.locator('[data-set="취합 시트 화면 파일"]').waitFor({ timeout: 8000 }).catch(() => P('설정에 취합 시트 화면 파일 칸이 없음'));
  if ((await page.inputValue('[data-set="취합 시트 화면 파일"]').catch(() => '')) !== '열 때 받기') P('설정의 처음 값이 열 때 받기가 아님');
  await page.locator('[data-set="취합 시트 화면 파일"]').scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  await shot(page, '표_화면파일_설정');
  await page.click('[data-admin-tab=check]');
  await page.locator('text=TableUi.html').first().waitFor({ timeout: 8000 });
  const row = await page.evaluate(() => { const el = [...document.querySelectorAll('.check-row')].find((x) => /TableUi\.html/.test(x.textContent)); return el ? el.textContent : ''; });
  if (!/최신 판/.test(row)) P('열 때 받기인데 점검의 TableUi가 정상이 아님: ' + row.replace(/\s+/g, ' ').slice(0, 120));
  await ctx.close();
  // 2) 처음에 함께(예전 방식): 미리보기를 그 모양으로 만들어 본다
  const inline = path.join(require('os').tmpdir(), 'gy-inline-tableui.html');
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-preview.js')], { env: Object.assign({}, process.env, { PREVIEW_INLINE: '1', PREVIEW_OUT: inline }) });
  ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(spy);
  page = await ctx.newPage();
  page.on('pageerror', (e) => P('처음에 함께 페이지 오류: ' + e.message));
  await page.goto(serveFile('미리보기_처음에함께.html', inline));
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor();
  if (!(await page.evaluate(() => !!window.__gy.tableUi()))) P('처음에 함께인데 처음부터 붙지 않음');
  await page.click('.side [data-go=table]');
  await page.locator('.tb-card').first().waitFor({ timeout: 8000 }).catch(() => P('처음에 함께: 목록이 열리지 않음'));
  if (await page.evaluate(() => window.__calls.includes('ui.table'))) P('처음에 함께인데 화면 파일을 또 받음');
  await ctx.close();
  // 2-나) 처음에 함께 + 파일이 없음(예전 점검 그대로)
  const src = fs.readFileSync(inline, 'utf8');
  const a = src.indexOf('<style>\n/* ---------- 취합 시트(TableUi.html'), b = src.indexOf('window.__gyTableUi = function'), end = '\n};\n</script>', c = b < 0 ? -1 : src.indexOf(end, b);
  if (a < 0 || b < a || c < 0) { P('처음에 함께 미리보기에서 TableUi를 찾지 못함'); return; }
  const f = path.join(require('os').tmpdir(), 'gy-no-tableui.html');
  fs.writeFileSync(f, src.slice(0, a) + '<script>window.__gyTableUiMissing = true;</script>' + src.slice(c + end.length));
  ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => P('처음에 함께·파일 없음 페이지 오류: ' + e.message));
  await page.goto(serveFile('미리보기_표파일없음.html', f));
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '홍길동');
  await page.locator('.today-card').waitFor().catch(() => P('처음에 함께·파일 없음: 홈이 열리지 않음'));
  await page.click('.side [data-go=table]');
  if (!(await page.getByText('화면 파일(TableUi)이 아직 없거나').first().waitFor({ timeout: 5000 }).then(() => true, () => false))) P('처음에 함께·파일 없음: 안내가 없음');
  await ctx.close();
}

/** 가짜 서버를 늦춘다(웹앱 준비가 늦은 경우 흉내): 기기의 gy.testDelay(밀리초), 없으면 def만큼 기다렸다가 답한다 */
async function slowServer(ctx, def) {
  await ctx.addInitScript((d) => {
    let slow;
    Object.defineProperty(window, '__previewServer', {
      configurable: true,
      get() { return slow; },
      set(v) { slow = (req) => new Promise((r) => setTimeout(r, Number(localStorage.getItem('gy.testDelay') || d))).then(() => v(req)); }
    });
  }, def || 0);
}
const sec = (ms) => (ms / 1000).toFixed(1) + '초';

/** 여는 그림(인트로, Index.html): '여는 중' 화면 대신 웹앱이 준비될 때까지만 보이고(정해 둔 최소 시간 없음), 준비가 빠르면 글자까지 빨리 감아 보여 준 뒤 열린다.
 * 다시 열어도·어두운 화면에서도 빛 알갱이(교사 요청), 누르면 건너뜀(아래 앱은 눌리지 않음) */
async function introFlow(browser, kind, viewport) {
  const phone = kind === '휴대폰';
  const ctx = await newCtx(browser, { viewport, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }, true);
  await slowServer(ctx, 0);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(kind + ' 인트로 페이지 오류: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/pretendard|ERR_|net::/i.test(m.text())) problems.push(kind + ' 인트로 콘솔: ' + m.text()); });
  const mode = () => page.getAttribute('html', 'data-intro');
  const stats = () => page.evaluate(() => window.__gyIntroStats || {});
  const there = () => page.evaluate(() => !!document.getElementById('gy-intro'));
  const gone = (ms) => page.waitForFunction(() => !document.getElementById('gy-intro'), null, { timeout: ms }).then(() => true, () => false);
  const setDelay = (ms) => page.evaluate((v) => localStorage.setItem('gy.testDelay', String(v)), ms);
  let t0 = 0;
  const at = async (s) => { const w = s * 1000 - (Date.now() - t0); if (w > 0) await page.waitForTimeout(w); };
  const snap = async (name) => { n++; await page.screenshot({ path: path.join(OUT, String(n).padStart(2, '0') + '_' + name + '.png') }); };
  const press = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (phone) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  };
  const info = [];
  /** 걸린 시간 확인: 준비된 뒤 limit(밀리초) 안에 걷혀야 한다 */
  const took = async (label, limit) => {
    if (!(await gone(12000))) { problems.push(kind + ' 인트로(' + label + '): 걷히지 않음'); return; }
    const st = await stats();
    info.push(label + ' 준비 ' + sec(st.readyAt) + ' → 걷힘 ' + sec(st.doneAt) + (st.low || st.cheap ? '(가벼운 그림)' : ''));
    if (!(st.doneAt - st.readyAt <= limit)) problems.push(kind + ' 인트로(' + label + '): 준비된 뒤 ' + sec(st.doneAt - st.readyAt) + ' 더 걸림(' + sec(limit) + ' 넘음) ' + JSON.stringify(st));
  };

  // ① 처음 열기 + 빠른 서버: 글자까지 빨리 감아 보여 주고 바로 열림(예전처럼 4초를 채우지 않음)
  await page.goto(FILE);
  if ((await mode()) !== 'full') problems.push(kind + ' 인트로: 처음 열었는데 빛 알갱이가 아님(' + (await mode()) + ')');
  await took('빠른 서버', 2600);
  await waitText(page, '어서 오세요');

  // ② 같은 날 다시 열기: 다시 열어도 빛 알갱이(교사 요청, 예전에는 로고만 짧게)
  t0 = Date.now();
  await page.reload();
  if ((await mode()) !== 'full') problems.push(kind + ' 인트로: 다시 열었는데 빛 알갱이가 아님(' + (await mode()) + ')');
  await at(0.8);
  await snap(kind + '_인트로_4_다시열어도_빛알갱이');
  await took('다시 열기', 2600);
  await waitText(page, '어서 오세요');

  // ③ 서버가 3초 걸릴 때: 은하 → 글자 → 학교 이름·인사를 제 빠르기로 다 보여 주고, 글자에서 기다리다 준비되면 바로 열림
  await setDelay(3000);
  t0 = Date.now();
  await page.goto(FILE);
  await at(0.8);
  await snap(kind + '_인트로_1_빛알갱이');
  await at(1.5);
  await snap(kind + '_인트로_2_글자로_모임');
  await at(2.7);
  await check(page, kind + ' 인트로');
  await snap(kind + '_인트로_3_학교이름');
  if (!(await there())) problems.push(kind + ' 인트로: 서버가 3초 걸리는데 그 전에 걷혀 빈 화면이 보임');
  await took('서버 3초', 1000);
  await waitText(page, '어서 오세요');

  // ④ 이름을 고른 기기 + 서버 2초: 인사에 이름, 끝나면 로고 자리부터 홈이 열림
  // (미리보기는 새로 고치면 가짜 서버가 처음으로 돌아가 로그인이 풀리니, 열 때 미리 로그인하는 사본을 연다)
  const LOGGED = loggedInCopy();
  await setDelay(2000);
  t0 = Date.now();
  await page.goto(LOGGED);
  await page.waitForFunction(() => window.__gyIntroStats && window.__gyIntroStats.readyAt > 0, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(120);
  const hello = await page.locator('#gy-intro .gib-hello').textContent().catch(() => '');
  if (!/성춘향/.test(hello || '')) problems.push(kind + ' 인트로: 인사에 고른 이름이 없음(' + hello + ')');
  const hellos = await page.evaluate(() => (window.__gyIntroU && window.__gyIntroU.HELLOS) || []);
  if (!hellos.some((x) => hello === '성춘향 선생님, ' + x)) problems.push(kind + ' 인트로: 인사가 응원 문장 20개 중 하나가 아님(' + hello + ')');
  await snap(kind + '_인트로_5_이름인사');
  await page.waitForFunction(() => window.__gyIntroStats && window.__gyIntroStats.finishAt > 0, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  await snap(kind + '_인트로_6_로고에서_화면이_열림');
  await took('서버 2초', 1500);
  await page.locator('.today-card').waitFor();

  // ⑤ 누르면 건너뛰기: 건너뛰려고 누른 자리 아래의 메뉴(일정)가 눌리면 안 된다
  await setDelay(0);
  t0 = Date.now();
  await page.goto(LOGGED);
  await page.locator('.today-card').waitFor({ state: 'attached' });
  await at(0.6);
  const t1 = Date.now();
  if (await there()) {
    await press(phone ? '.bottom-nav [data-go=schedule]' : '.side [data-go=schedule]');
    if (!(await gone(2000))) problems.push(kind + ' 인트로: 눌렀는데 2초 안에 걷히지 않음');
    info.push('건너뛰기 ' + sec(Date.now() - t1));
    await page.waitForTimeout(400);
    if (await page.locator('.cal, .pweek').count()) problems.push(kind + ' 인트로: 건너뛰려고 누른 손이 아래 메뉴(일정)까지 눌렀음');
    if (!(await page.locator('.today-card').count())) problems.push(kind + ' 인트로: 건너뛴 뒤 홈이 아님');
  } else problems.push(kind + ' 인트로: 0.6초에 벌써 걷혀 건너뛰기를 점검하지 못함');
  // 건너뛴 뒤에는 앱이 바로 눌린다
  await press(phone ? '.bottom-nav [data-go=schedule]' : '.side [data-go=schedule]');
  await page.locator('.cal, .pweek').first().waitFor();

  // ⑥ 어두운 화면에서 다시 열기: 그래도 빛 알갱이
  await page.evaluate(() => localStorage.setItem('gy.theme', 'dark'));
  t0 = Date.now();
  await page.goto(LOGGED);
  if ((await mode()) !== 'full') problems.push(kind + ' 인트로: 어두운 화면에서 다시 열었는데 빛 알갱이가 아님(' + (await mode()) + ')');
  await at(1.5);
  await snap(kind + '_인트로_7_어두운화면_다시열기');
  await took('어두운 화면', 2600);
  await page.locator('.today-card').waitFor();
  await ctx.close();
  return kind + ' ' + info.join(', ');
}

/** 자료가 아주 늦게 올 때(가짜 서버 6초): 글자에서 기다리다 자료가 오면 넘어가고, 기다리는 중 두 번 누르면 앱의 '여는 중' 화면을 보여 준다 */
async function introLateCheck(browser) {
  const ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 } }, true);
  await slowServer(ctx, 6000);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('늦은 자료 인트로 페이지 오류: ' + e.message));
  const there = () => page.evaluate(() => !!document.getElementById('gy-intro'));
  const gone = (ms) => page.waitForFunction(() => !document.getElementById('gy-intro'), null, { timeout: ms }).then(() => true, () => false);
  let t0 = Date.now();
  await page.goto(FILE);
  await page.waitForTimeout(5200 - (Date.now() - t0));
  if (!(await there())) problems.push('자료가 늦게 오는데 인트로가 먼저 걷혀 빈 화면이 보임');
  if (!(await gone(6000))) problems.push('자료가 온 뒤에도 인트로가 걷히지 않음');
  const st = await page.evaluate(() => window.__gyIntroStats || {});
  if (!(st.doneAt - st.readyAt <= 1000)) problems.push('자료가 늦게 온 뒤 ' + sec(st.doneAt - st.readyAt) + ' 더 걸림');
  await waitText(page, '어서 오세요');
  t0 = Date.now();
  await page.goto(FILE);
  await page.waitForTimeout(1000);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(1000);
  if (!(await there())) problems.push('자료가 오기 전 한 번 누르니 인트로가 걷힘(글자에서 기다려야 함)');
  await page.mouse.click(640, 400);
  if (!(await gone(2000))) problems.push('기다리는 중 두 번 눌렀는데 인트로가 걷히지 않음');
  if (!(await page.locator('#app .loading').count())) problems.push('두 번 눌러 걷힌 뒤 앱의 여는 중 화면이 안 보임');
  await waitText(page, '어서 오세요');
  await ctx.close();
  return '서버 6초 준비 ' + sec(st.readyAt) + ' → 걷힘 ' + sec(st.doneAt);
}

/** 움직임 줄이기를 켠 기기(윈도우 '애니메이션 효과' 끄기 등)도 빛 알갱이(교사 선택) */
async function introReducedMotionCheck(browser) {
  const ctx = await newCtx(browser, { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }, true);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('움직임 줄이기 기기 인트로 페이지 오류: ' + e.message));
  const t0 = Date.now();
  await page.goto(FILE);
  const m = await page.getAttribute('html', 'data-intro');
  if (m !== 'full') problems.push('움직임 줄이기 기기인데 빛 알갱이가 아님(' + m + ')');
  await page.waitForTimeout(800 - (Date.now() - t0));
  n++;
  await page.screenshot({ path: path.join(OUT, String(n).padStart(2, '0') + '_PC_인트로_8_움직임줄이기_기기.png') });
  const ok = await page.waitForFunction(() => !document.getElementById('gy-intro'), null, { timeout: 8000 }).then(() => true, () => false);
  if (!ok) problems.push('움직임 줄이기 기기의 인트로가 걷히지 않음');
  const st = await page.evaluate(() => window.__gyIntroStats || {});
  if (st.mode !== 'full') problems.push('움직임 줄이기 기기에서 빛 알갱이를 그리지 않음 ' + JSON.stringify(st));
  await waitText(page, '어서 오세요');
  await ctx.close();
  return '움직임 줄이기 기기 준비 ' + sec(st.readyAt) + ' → 걷힘 ' + sec(st.doneAt);
}

/**
 * 자료실 부서 단추 줄(판 2026-10-21d, 교사 요청): '모든 부서' 고르는 칸 대신 [전체] [내 부서] [부서…] 단추. 처음은 전체, 숫자는 그 부서
 * 자료 수(공통 자료 포함), 부서를 골라도 공통 자료는 맨 위, 찾는 중 다른 부서에 있으면 '전체에서 보기', 고른 부서가 새 자료의 처음 부서,
 * 이 창에서 기억, 휴대폰은 한 줄로 옆으로 밀기(끝이 흐려짐)
 */
async function libDeptCheck(browser) {
  const P = (m) => problems.push('부서 단추: ' + m);
  const state = (page) => page.evaluate(() => {
    const row = document.querySelector('#lib-depts');
    if (!row) return null;
    const btns = [...row.querySelectorAll('.tg')].map((b) => ({
      name: b.childNodes[0].textContent.trim(), n: Number(b.querySelector('.tg-n').firstChild.textContent), on: b.getAttribute('aria-pressed') === 'true',
      mine: !!b.querySelector('.tg-mine'), zero: b.classList.contains('zero'), top: Math.round(b.getBoundingClientRect().top)
    }));
    return {
      btns, sel: !!document.querySelector('#lib-dept'), count: (document.querySelector('#lib-list > p.faint') || {}).textContent || '',
      cards: document.querySelectorAll('.lib-card').length, commons: document.querySelectorAll('.lib-group.common .lib-card').length,
      groups: [...document.querySelectorAll('.lib-group:not(.common) .lib-h')].map((h) => h.childNodes[0].textContent.trim()),
      more: (document.querySelector('.lib-other') || {}).textContent || '', note: [...document.querySelectorAll('#lib-list .card .empty')].map((e) => e.textContent).join(' / '),
      scrollW: row.scrollWidth, clientW: row.clientWidth, cls: row.className
    };
  });
  const pick = (page, name) => page.locator('#lib-depts .tg', { hasText: name }).first().click();
  const libOpen = async (page) => {
    await page.evaluate(() => window.__gy.go('library'));
    await page.locator('#lib-list .lib-card, #lib-list .empty').first().waitFor();
  };
  // PC: 심청 선생님(정보부)
  let ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } });
  let page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('부서 단추 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '심청');
  await libOpen(page);
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 6000 }).catch(() => {});
  let s = await state(page);
  if (!s) { P('단추 줄이 없음'); await ctx.close(); return; }
  if (s.sel) P("예전 '모든 부서' 고르는 칸이 남아 있음");
  const names = (st) => st.btns.map((b) => b.name + b.n).join(',');
  if (names(s) !== '공통3,전체9,정보부1,교무부4,연구부2,인성안전부2') P('단추·숫자가 다름: ' + names(s));
  const on = (st, nm) => (st.btns.find((b) => b.name === nm) || {}).on;
  if (!on(s, '전체')) P('처음에 전체가 골라져 있지 않음');
  if (!s.btns[2].mine) P("내 부서(정보부)가 전체 바로 뒤에 '내 부서' 표시와 함께 있지 않음");
  if (s.commons !== 3 || s.cards !== 9) P('전체에서 공통 자료가 맨 위에 없거나 자료 수가 다름 ' + JSON.stringify({ c: s.commons, n: s.cards }));
  const newLabel = () => page.$eval('.page-head [data-action=lib-new]', (b) => b.textContent.trim());
  if ((await newLabel()) !== '자료 넣기') P("전체에서 '자료 넣기' 단추 이름이 다름: " + (await newLabel()));
  if (new Set(s.btns.map((b) => b.top)).size !== 1) P('PC에서 단추가 한 줄이 아님');
  await check(page, 'PC 자료실 부서 단추');
  await shot(page, 'PC_자료실_부서단추_전체');
  // [공통]: 공통 자료 3개만(부서 칸 없음), 자료 넣기 단추는 '공통 자료 넣기'·처음부터 공통 자료 체크(판 2026-10-22a)
  await pick(page, '공통');
  s = await state(page);
  if (!on(s, '공통') || s.commons !== 3 || s.groups.length || !/^3개/.test(s.count)) P('공통을 골랐을 때 목록이 다름 ' + JSON.stringify({ c: s.commons, g: s.groups, n: s.count }));
  if ((await newLabel()) !== '공통 자료 넣기') P("공통에서 자료 넣기 단추 이름이 다름: " + (await newLabel()));
  await page.click('[data-action=lib-new]');
  await page.locator('#lib-form').waitFor();
  if (!(await page.isChecked('#lf-common')) || (await page.locator('#lf-corder-box').isHidden())) P('공통에서 자료 넣기를 열었는데 공통 자료가 켜져 있지 않음');
  await page.click('.modal [data-action=close-modal]');
  await page.locator('.modal').waitFor({ state: 'detached' }).catch(() => {});
  await shot(page, 'PC_자료실_공통');
  // 인성안전부: 그 부서 자료 2개만(공통 자료가 맨 위를 덮지 않게, 교사 선택 2026-10-22a)
  await pick(page, '인성안전부');
  s = await state(page);
  if (!on(s, '인성안전부')) P('누른 단추가 골라지지 않음');
  if (s.commons || s.groups.join() !== '인성안전부' || !/^2개/.test(s.count)) P('인성안전부를 골랐을 때 목록이 다름 ' + JSON.stringify({ c: s.commons, g: s.groups, n: s.count }));
  if ((await newLabel()) !== '인성안전부에 자료 넣기') P("인성안전부에서 자료 넣기 단추 이름이 다름: " + (await newLabel()));
  await shot(page, 'PC_자료실_부서단추_인성안전부');
  // 교무부: 그 부서의 공통 자료도 '공통' 표시로 함께
  await pick(page, '교무부');
  s = await state(page);
  const gyomuCommon = await page.locator('.lib-group:not(.common) .lib-card.common').count();
  if (s.groups.join() !== '교무부' || !/^4개/.test(s.count) || s.commons) P('교무부를 골랐을 때 목록이 다름 ' + JSON.stringify({ c: s.commons, g: s.groups, n: s.count }));
  if (!gyomuCommon) P('교무부의 공통 자료가 교무부 칸에 함께 나오지 않음');
  await shot(page, 'PC_자료실_부서단추_교무부');
  await pick(page, '인성안전부');
  // 찾기: 인성안전부를 고른 채 '학적'(교무부 자료) → 단추 숫자가 찾은 것으로, 다른 부서에 1개 · 전체에서 보기
  await page.fill('#lib-q', '학적');
  await page.waitForFunction(() => !!document.querySelector('.lib-other'), null, { timeout: 3000 }).catch(() => {});
  s = await state(page);
  if (!/다른 부서에도 찾는 자료가 1개/.test(s.more)) P('찾는 중 다른 부서에 있는데 안내가 없음: ' + s.more);
  if (!/이 부서에는 찾는 자료가 없어요/.test(s.note)) P('고른 부서에 찾는 자료가 없다는 글이 없음: ' + s.note);
  if (!/^공통[01],전체1,정보부0,교무부1,연구부0,인성안전부0$/.test(names(s))) P('찾는 중 단추 숫자가 다름: ' + names(s));
  if (!s.btns.find((b) => b.name === '정보부').zero) P('0개 단추가 흐리지 않음');
  await shot(page, 'PC_자료실_부서단추_찾기_다른부서');
  await page.click('.lib-other [data-action=lib-dept]');
  s = await state(page);
  if (!on(s, '전체') || !(await page.locator('.lib-title', { hasText: '학적 업무 안내' }).count())) P("'전체에서 보기'를 눌러도 찾은 자료가 안 보임");
  await page.fill('#lib-q', '');
  await page.waitForFunction(() => document.querySelectorAll('.lib-card').length === 9, null, { timeout: 3000 }).catch(() => P('찾기를 지워도 9개로 돌아오지 않음'));
  // 분류로 거르면 숫자도 함께. 0개 부서를 고르면 '이 부서에는 찾는 자료가 없어요'
  await page.selectOption('#lib-kind', { label: '연수 자료' });
  s = await state(page);
  if (!/^공통\d,전체2,정보부0,교무부0,연구부1,인성안전부1$/.test(names(s))) P('분류로 거를 때 단추 숫자가 다름: ' + names(s));
  await pick(page, '정보부');
  s = await state(page);
  if (s.cards || !/이 부서에는 찾는 자료가 없어요/.test(s.note)) P('0개 부서를 골랐는데 빈 글이 다름 ' + JSON.stringify({ cards: s.cards, note: s.note }));
  await page.selectOption('#lib-kind', '');
  // 고른 부서가 새 자료의 처음 부서, 전체면 내 부서
  await pick(page, '연구부');
  const newDept = async () => {
    await page.click('[data-action=lib-new]');
    await page.locator('#lib-form').waitFor();
    const v = await page.$eval('#lf-dept', (e) => e.options[e.selectedIndex].textContent);
    await page.click('.modal [data-action=close-modal]');
    await page.locator('.modal').waitFor({ state: 'detached' }).catch(() => {});
    return v;
  };
  if ((await newLabel()) !== '연구부에 자료 넣기') P("연구부에서 자료 넣기 단추 이름이 다름: " + (await newLabel()));
  let dep = await newDept();
  if (dep !== '연구부') P('연구부를 고른 채 자료 넣기를 열었는데 부서가 ' + dep);
  // 이 창에서 기억: 홈에 갔다 와도 연구부
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await libOpen(page);
  s = await state(page);
  if (!s.btns.find((b) => b.name === '연구부').on) P('다른 화면에 갔다 오면 고른 부서를 잊음');
  await page.click('#lib-depts .tg[data-id=""]');
  dep = await newDept();
  if (dep !== '정보부') P('전체에서 자료 넣기를 열었는데 처음 부서가 내 부서가 아님: ' + dep);
  // 보관함도 같은 단추 줄(그 학년도 자료 수)
  await page.click('[data-action=lib-view][data-v=archive]');
  await page.locator('#lib-list .lib-card, #lib-list .empty').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#lib-list .spin'), null, { timeout: 5000 }).catch(() => {});
  s = await state(page);
  const allN = (st) => (st.btns.find((b) => b.name === '전체') || {}).n;
  if (!s || allN(s) !== s.cards) P('보관함에서 전체 숫자와 보이는 자료 수가 다름 ' + JSON.stringify(s && { n: allN(s), cards: s.cards }));
  await shot(page, 'PC_자료실_부서단추_보관함');
  await page.click('[data-action=lib-view][data-v=now]');
  // 어둡게 + 종이색
  await page.evaluate(() => { localStorage.setItem('gy.theme', 'dark'); localStorage.setItem('gy.design', 'paper'); });
  await page.reload();
  await waitText(page, '어서 오세요').catch(() => {});
  if (await page.locator('#login-pw').count()) { await login(page); await verify(page, '심청'); }
  await page.locator('.main').waitFor();
  await libOpen(page);
  await pick(page, '교무부');
  await shot(page, 'PC_자료실_부서단추_어둡게_종이색');
  await ctx.close();
  // 휴대폰: 한 줄로 옆으로 밀기, 끝이 흐려짐, 화면이 옆으로 넘치지 않음
  ctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('부서 단추 휴대폰 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '심청');
  await libOpen(page);
  await page.waitForTimeout(300);
  s = await state(page);
  if (new Set(s.btns.map((b) => b.top)).size !== 1) P('휴대폰에서 단추가 한 줄이 아님');
  if (!(s.scrollW > s.clientW)) P('휴대폰에서 단추 줄이 옆으로 밀리지 않음(넘치지 않음) ' + JSON.stringify({ w: s.scrollW, c: s.clientW }));
  else if (!/more-r/.test(s.cls)) P('휴대폰에서 단추가 더 있는데 오른쪽 끝이 흐려지지 않음');
  await check(page, '휴대폰 자료실 부서 단추');
  await shot(page, '휴대폰_자료실_부서단추');
  await page.evaluate(() => { const r = document.querySelector('#lib-depts'); r.scrollLeft = r.scrollWidth; });
  await page.waitForTimeout(300);
  s = await state(page);
  if (!/more-l/.test(s.cls) || /more-r/.test(s.cls)) P('끝까지 밀었는데 흐림이 맞지 않음: ' + s.cls);
  await page.locator('#lib-depts .tg', { hasText: '인성안전부' }).tap();
  s = await state(page);
  if (!s.btns.find((b) => b.name === '인성안전부').on || s.groups.join() !== '인성안전부') P('휴대폰에서 단추를 눌러도 거르지 않음');
  await shot(page, '휴대폰_자료실_부서단추_인성안전부');
  await ctx.close();
}

/**
 * 회의록 보완(판 2026-10-28a): 홈 '내가 할 일'의 내 부서 칸(정보부 심청) → 쓰기 창까지, 홈 검색의 회의록, 회의 만들기 '일정에도 넣기' → 일정 창 '회의록 열기',
 * 회의 종류가 많아도 휴대폰 목록이 넘치지 않음, '공지 쓰기'는 회의록 탭을 보던 창에서도 공지 탭으로
 */
async function meet2Check(browser) {
  const P = (m) => problems.push('회의록 보완: ' + m);
  const ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('회의록 보완 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '심청');
  await page.locator('.todo-card').waitFor();
  const row = page.locator('.todo-card .todo-row', { hasText: '정보부 칸을 아직 안 썼어요' });
  if (!(await row.count())) P("홈 '내가 할 일'에 정보부 칸 알림이 없음");
  else {
    await shot(page, 'PC_홈_할일_회의록');
    await row.locator('[data-action=meet-goto]').click();
    await page.locator('#mw-text').waitFor({ timeout: 6000 }).catch(() => P("'쓰기'를 눌러도 정보부 칸 쓰기 창이 열리지 않음"));
    if (!/정보부 칸/.test(await page.locator('#m-title').innerText().catch(() => ''))) P('쓰기 창이 정보부 칸이 아님');
    await page.click('.modal [data-action=close-modal]');
  }
  // 공지 쓰기: 회의록 탭을 보던 창에서도 공지 탭과 쓰기 창
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await page.locator('[data-action=notice-new]').first().click();
  await page.locator('#nf-title, #notice-form, .modal form').first().waitFor({ timeout: 6000 }).catch(() => P("회의록 탭을 보던 창에서 홈 '공지 쓰기'가 쓰기 창을 열지 않음"));
  if (!(await page.locator('[data-action=notice-tab][data-v=notice][aria-selected=true]').count())) P("'공지 쓰기'가 공지 탭으로 가지 않음");
  await page.keyboard.press('Escape');
  await page.locator('.modal [data-action=close-modal]').click().catch(() => {});
  // 홈 검색
  await page.evaluate(() => window.__gy.go('home'));
  await page.fill('#home-q', '우천');
  await page.press('#home-q', 'Enter');
  await page.locator('.search-res').waitFor();
  const hit = page.locator('.sr-row[data-action=meet-goto]');
  if (!(await hit.count())) P('홈 검색에 회의록이 나오지 않음(기타 안건 "우천")');
  else {
    await shot(page, 'PC_검색_회의록');
    await hit.first().click();
    await page.locator('.meet-doc').waitFor({ timeout: 6000 }).catch(() => P('검색 결과를 눌러도 회의록이 열리지 않음'));
  }
  // 회의 만들기(일정에도 넣기 기본 켬) → 일정 창의 '회의록 열기'
  await page.evaluate(() => { const b = document.querySelector('[data-action=meet-back]'); if (b) b.click(); });
  await page.locator('.meet-card').first().waitFor();
  await page.click('.page-head [data-action=meet-new]');
  await page.locator('#mt-form').waitFor();
  await modalSettled(page);
  if (!(await page.isChecked('#mt-sched'))) P("회의 만들기의 '일정에도 넣기'가 처음에 켜져 있지 않음");
  await page.fill('#mt-newrow', '1학년');
  await page.click('#mt-addrow');
  if (!(await page.locator('#mt-pick label', { hasText: '1학년' }).count())) P('칸 추가가 안 됨');
  await shot(page, 'PC_회의록_만들기_칸추가');
  const title = await page.inputValue('#mt-title');
  await page.click('#mt-form [type=submit]');
  await page.locator('.meet-doc').waitFor();
  if (!(await page.locator('.meet-name', { hasText: '1학년' }).count())) P('추가한 칸이 회의록에 없음');
  if (!(await page.locator('.meet-doc .chip', { hasText: '일정에 있음' }).count())) P("만든 회의에 '일정에 있음' 표시가 없음");
  await page.evaluate(() => window.__gy.go('schedule'));
  await page.locator('.ev', { hasText: title }).first().click({ timeout: 8000 }).catch(() => P('달력에 회의 일정이 없음: ' + title));
  await page.locator('.modal [data-action=meet-goto]').waitFor({ timeout: 4000 }).catch(() => P("일정 창에 '회의록 열기'가 없음"));
  await shot(page, 'PC_일정창_회의록열기');
  await page.locator('.modal [data-action=meet-goto]').click().catch(() => {});
  await page.waitForFunction((t) => (document.querySelector('.meet-h') || {}).textContent === t, title, { timeout: 6000 }).catch(() => P("'회의록 열기'로 그 회의가 열리지 않음"));
  await ctx.close();
}

/**
 * 홈 '내가 할 일' 오른쪽 사이드바(판 2026-10-22a, 교사 요청 '스크롤 내려도 따라오게', 교사 선택 '넓은 모니터에서만'·'오늘 일정을 넓게'):
 * 본문 폭 1264 이상(100%면 창 폭 약 1600 이상)에서만 오른쪽에 붙고 스크롤을 따라온다. 오늘 학교 일정은 가운데 기둥 폭을 모두 쓴다.
 * 노트북(1366·1440·1536)과 휴대폰은 예전 그대로. 창 크기·화면 크기를 바꾸면 다시 그린다. 인쇄는 한 줄로, 찾기 결과가 지나가도 그대로
 */
async function homeSideCheck(browser) {
  const P = (m) => problems.push('홈 사이드바: ' + m);
  const look = (page) => page.evaluate(() => {
    const r = (el) => el ? el.getBoundingClientRect() : null;
    const aside = document.querySelector('.home-aside'), todo = document.querySelector('.todo-card'), today = document.querySelector('.today-card');
    const main = document.querySelector('.home-main');
    return {
      side: !!aside, cls: document.querySelector('#screen').className, inTop: !!document.querySelector('.home-top .todo-card'),
      todoTop: todo ? Math.round(r(todo).top) : null, todoBottom: todo ? Math.round(r(todo).bottom) : null, todoW: todo ? Math.round(r(todo).width) : 0,
      todayW: today ? Math.round(r(today).width) : 0, mainW: main ? Math.round(r(main).width) : 0, vh: window.innerHeight,
      maxH: todo ? getComputedStyle(todo).maxHeight : '', ovf: todo ? getComputedStyle(todo).overflowY : '', pos: aside ? getComputedStyle(aside).position : ''
    };
  });
  const homeReady = (page) => page.waitForFunction(() => !!document.querySelector('.today-card') && !!document.querySelector('.todo-card'), null, { timeout: 8000 });
  const ctx = await newCtx(browser, { viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('홈 사이드바 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '이몽룡');
  await homeReady(page);
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 6000 }).catch(() => {});
  let s = await look(page);
  if (!s.side || !/home-side/.test(s.cls) || s.inTop) P('1920에서 오른쪽 사이드바가 아님 ' + JSON.stringify(s));
  if (Math.abs(s.todayW - s.mainW) > 2) P('오늘 학교 일정이 가운데 기둥 폭을 모두 쓰지 않음 ' + JSON.stringify({ today: s.todayW, main: s.mainW }));
  if (s.mainW < 1100) P('1920에서 가운데 기둥이 예전(1120)보다 좁음: ' + s.mainW);
  if (s.pos !== 'sticky' || s.maxH === 'none' || s.ovf !== 'auto') P('사이드바가 스크롤을 따라오는 모양이 아님 ' + JSON.stringify({ pos: s.pos, maxH: s.maxH, ovf: s.ovf }));
  await check(page, '홈 사이드바 1920');
  await shot(page, 'PC1920_홈_사이드바');
  // 스크롤해도 따라온다(위에서 24px), 아래로 끝까지 가도 화면 안에
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(300);
  s = await look(page);
  if (Math.abs(s.todoTop - 24) > 3 || s.todoBottom > s.vh) P('스크롤해도 내가 할 일이 따라오지 않음 ' + JSON.stringify({ top: s.todoTop, bottom: s.todoBottom, vh: s.vh }));
  await shot(page, 'PC1920_홈_사이드바_스크롤');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  s = await look(page);
  if (s.todoTop < 0 || s.todoBottom > s.vh) P('맨 아래까지 내려도 내가 할 일이 화면 안에 있어야 함 ' + JSON.stringify({ top: s.todoTop, bottom: s.todoBottom }));
  await page.evaluate(() => window.scrollTo(0, 0));
  // 인쇄는 한 줄로(옆 칸 없이)
  await page.emulateMedia({ media: 'print' });
  const pr = await page.evaluate(() => ({ d: getComputedStyle(document.querySelector('.home-cols')).display, p: getComputedStyle(document.querySelector('.home-aside')).position }));
  if (pr.d !== 'flex' || pr.p !== 'static') P('인쇄할 때 두 칸이 그대로 ' + JSON.stringify(pr));
  await page.emulateMedia({ media: 'screen' });
  // 찾기 결과를 보고 지우면 사이드바 모양으로 돌아온다
  await page.fill('#home-q', '협의');
  await page.press('#home-q', 'Enter');
  await page.locator('.search-res').waitFor({ timeout: 6000 }).catch(() => P('찾기 결과가 나오지 않음'));
  await check(page, '홈 사이드바 찾기 결과');
  await page.click('[data-action=search-clear]');
  await homeReady(page).catch(() => P('찾기를 지운 뒤 홈이 돌아오지 않음'));
  if (!(await look(page)).side) P('찾기를 지운 뒤 사이드바가 아님');
  // 찾기 칸에 글쓰기 자리가 있는 동안은 모양 바꾸기를 미룬다(쓰던 글이 사라지지 않게, 예전 그대로) → 칸을 벗어난 뒤 창 폭을 바꾼다
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  // 창 폭: 1600은 사이드바, 1590·1536·1440·1366은 예전처럼(오늘 일정 옆). 창을 바꾸면 곧바로 다시 그린다
  for (const [w, h, want] of [[1600, 900, true], [1590, 900, false], [1536, 864, false], [1440, 900, false], [1366, 768, false], [1920, 1080, true]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForFunction((on) => !!document.querySelector('.home-aside') === on && !!document.querySelector('.todo-card'), want, { timeout: 4000 })
      .catch(() => P(w + 'x' + h + '에서 사이드바가 ' + (want ? '없음' : '남음')));
    s = await look(page);
    if (!want && !s.inTop) P(w + '에서 내가 할 일이 오늘 일정 옆이 아님');
    await check(page, '홈 ' + w + 'x' + h);
    if (w === 1600 || w === 1366) await shot(page, 'PC' + w + '_홈_' + (want ? '사이드바' : '예전처럼'));
  }
  // 화면 크기: 1920에서 130%로 키우면 본문이 좁아져 예전처럼, 100%로 돌리면 다시 사이드바
  for (let i = 0; i < 3; i++) await page.click('.side [data-action=zoom-in]');
  await page.waitForFunction(() => !document.querySelector('.home-aside') && !!document.querySelector('.home-top .todo-card'), null, { timeout: 4000 })
    .catch(() => P('1920에서 화면 크기를 130%로 키웠는데 사이드바가 남음'));
  await shot(page, 'PC1920_홈_화면크기130');
  for (let i = 0; i < 3; i++) await page.click('.side [data-action=zoom-out]');
  await page.waitForFunction(() => !!document.querySelector('.home-aside'), null, { timeout: 4000 }).catch(() => P('화면 크기를 100%로 돌렸는데 사이드바가 아님'));
  // 어둡게 + 장도
  await page.evaluate(() => { localStorage.setItem('gy.theme', 'dark'); localStorage.setItem('gy.design', 'jangdo'); });
  await page.reload();
  await waitText(page, '어서 오세요').catch(() => {});
  if (await page.locator('#login-pw').count()) { await login(page); await verify(page, '이몽룡'); }
  await homeReady(page);
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(300);
  await shot(page, 'PC1920_홈_사이드바_어둡게_장도');
  await ctx.close();
  // 휴대폰은 예전 그대로
  const pctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const pp = await pctx.newPage();
  await pp.goto(FILE);
  await waitText(pp, '어서 오세요');
  await login(pp);
  await verify(pp, '이몽룡');
  await homeReady(pp);
  if ((await look(pp)).side) P('휴대폰에 사이드바가 생김');
  await pctx.close();
}

/**
 * 회의록(판 2026-10-22a, 교사 요청 '공지에서 회의록 입력·인쇄·독스 내려받기'): 공지 화면 위 [공지 | 회의록] 탭, 목록·학기·종류 거르기,
 * 누구나 칸 쓰기(쓴 분이 남음)·그사이 다른 분이 고쳤으면 묻기(내 내용으로 바꾸기·먼저 고친 내용 두기), 기타 안건 더하기·빼기(더한 분),
 * 인쇄(A4 세로 한 장, 쓴 분 이름 없음, 날짜에 연도), 워드 파일(.docx: 내려받은 바이트에 칸 글, LibreOffice로 열어 A4 한 장),
 * 회의 만들기(제목 저절로·칸 고르기)·고치기(내용 있는 칸은 못 뺌)·지우기·관리자 휴지통에서 되살리기, 어둡게·장도, 휴대폰
 */
async function meetCheck(browser) {
  const P = (m) => problems.push('회의록: ' + m);
  const toastHas = (page, re) => page.waitForFunction((src) => {
    const t = document.querySelector('#toast');
    return !!t && t.classList.contains('show') && new RegExp(src).test(t.textContent);
  }, re.source, { timeout: 4000 }).then(() => true, () => false);
  const as = (page, name, action, args) => page.evaluate(async ([nm, a, ar]) => {
    const login = localStorage.getItem('gy.login') || sessionStorage.getItem('gy.login');
    const call = (x, y, tok) => window.__previewServer(JSON.stringify({ action: x, args: y || {}, tokens: tok })).then((t) => JSON.parse(t));
    const staff = (await call('staffPicker', {}, { login })).data;
    const who = staff.find((x) => x.name === nm);
    const identity = (await call('verify', { staffId: who.id, pin: '1111', remember: false }, { login })).data.identity;
    return call(a, ar, { login, identity });
  }, [name, action, args]);
  const detail = (page) => page.evaluate(() => {
    const d = window.__gy.S.meet.detail;
    return {
      m: d && d.meeting, names: [...document.querySelectorAll('.meet-row:not(.head):not(.etc) .meet-name')].map((e) => e.childNodes[0].textContent), // '내 부서' 표시는 빼고
      edit: !!document.querySelector('[data-action=meet-edit]'), del: !!document.querySelector('[data-action=meet-del]'),
      etc: [...document.querySelectorAll('.meet-etc')].map((e) => ({ text: e.querySelector('.meet-text').textContent, del: !!e.querySelector('[data-action=meet-etc-del]') }))
    };
  });
  const rowText = (page, name) => page.evaluate((nm) => {
    const r = [...document.querySelectorAll('.meet-row')].find((x) => (x.querySelector('.meet-name') || {}).textContent === nm);
    return r ? { text: (r.querySelector('.meet-text') || {}).textContent || '', by: (r.querySelector('.meet-by') || {}).textContent || '', k: r.getAttribute('data-k') } : null;
  }, name);
  const writeOpen = async (page, name) => {
    await page.locator('.meet-row', { has: page.locator('.meet-name', { hasText: name }) }).locator('[data-action=meet-write]').click();
    await page.locator('#mw-text').waitFor();
    await modalSettled(page);
  };
  const closed = (page) => page.locator('.modal').waitFor({ state: 'detached', timeout: 6000 }).catch(() => P('창이 닫히지 않음'));
  const toMeet = async (page) => {
    await page.evaluate(() => window.__gy.go('notice'));
    await page.locator('.notice-tabs').waitFor();
    if (!(await page.locator('[data-action=notice-tab][data-v=meet][aria-selected=true]').count())) await page.click('[data-action=notice-tab][data-v=meet]');
    await page.locator('#meet-body .meet-card, #meet-body .empty').first().waitFor();
  };
  const openCard = async (page, title) => {
    await page.locator('.meet-card', { hasText: title }).first().click();
    await page.locator('.meet-doc').waitFor();
    await page.waitForFunction((t) => (document.querySelector('.meet-h') || {}).textContent === t, title, { timeout: 5000 }).catch(() => P(title + ' 회의가 열리지 않음'));
  };
  // ---------- PC: 이몽룡 선생님(예시 회의를 만든 분이 아님)
  let ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  let page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('회의록 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '이몽룡');
  await page.evaluate(() => window.__gy.go('notice'));
  await page.locator('.notice-tabs').waitFor();
  const tabs = await page.$$eval('.notice-tabs .tab', (b) => b.map((x) => x.textContent));
  if (tabs.join() !== '공지,회의록') P('공지 화면 위 탭이 다름: ' + tabs.join());
  await page.click('[data-action=notice-tab][data-v=meet]');
  await page.locator('.meet-card').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 6000 }).catch(() => {});
  if (!(await page.locator('.page-head [data-action=meet-new]').count())) P("회의록 탭인데 위 단추가 '회의 만들기'가 아님");
  const kinds = await page.$$eval('.meet-tools [data-action=meet-kind]', (b) => b.map((x) => x.textContent));
  if (kinds.join() !== '모두,부장회의,교직원회의') P('종류 단추가 다름: ' + kinds.join());
  if ((await page.locator('.meet-card').count()) !== 2) P('예시 회의 2개가 목록에 없음');
  if ((await page.$$eval('#meet-term option', (o) => o.length)) < 2) P('학기 고르는 칸에 학기가 없음');
  await check(page, 'PC 회의록 목록');
  await shot(page, 'PC_회의록_목록');
  await page.click('.meet-tools [data-action=meet-kind]:has-text("교직원회의")');
  const only = await page.$$eval('.meet-card .meet-title', (t) => t.map((x) => x.textContent));
  if (only.join() !== '(예시) 교직원회의') P('교직원회의로 거른 목록이 다름: ' + only.join());
  await page.click('.meet-tools [data-action=meet-kind][data-id=""]');
  // 공지 탭으로 갔다 오기: 단추가 '공지 쓰기'로, 다른 화면에 갔다 와도 고른 탭은 그대로
  await page.click('[data-action=notice-tab][data-v=notice]');
  await page.locator('#notice-body').waitFor();
  if (!(await page.locator('.page-head [data-action=notice-new]').count())) P("공지 탭인데 위 단추가 '공지 쓰기'가 아님");
  await page.click('[data-action=notice-tab][data-v=meet]');
  await page.locator('.meet-card').first().waitFor();
  await page.evaluate(() => window.__gy.go('home'));
  await page.locator('.today-card').waitFor();
  await page.evaluate(() => window.__gy.go('notice'));
  await page.locator('#meet-body .meet-card').first().waitFor({ timeout: 6000 }).catch(() => P('다른 화면에 갔다 오면 회의록 탭을 잊음'));

  // 회의 보기: 맨 위 칸(교장·교감) → 부서 칸 → 기타 안건, 만든 분이 아니면 고치기·지우기 없음
  await openCard(page, '(예시) 부장회의');
  let d = await detail(page);
  if (d.names.join() !== '교장 선생님,교감 선생님,교무부,연구부,정보부,인성안전부') P('칸 이름·순서가 다름: ' + d.names.join());
  if (d.edit || d.del) P('만든 분이 아닌데 회의 고치기·지우기가 보임');
  if (d.etc.length !== 1 || d.etc[0].del) P('다른 분이 더한 기타 안건에 빼기가 보이거나 안건이 없음 ' + JSON.stringify(d.etc));
  const blankAlign = await page.evaluate(() => { const e = document.querySelector('.meet-row.blank .meet-none'); return e ? getComputedStyle(e).textAlign : ''; });
  if (blankAlign && blankAlign !== 'left' && blankAlign !== 'start') P('빈 칸 글이 가운데로 감(빈 화면 글 모양과 겹침): ' + blankAlign);
  await shot(page, 'PC_회의록_보기', true);
  // 칸 쓰기 → 쓴 분 이름이 남는다
  await writeOpen(page, '정보부');
  await page.fill('#mw-text', '1. 태블릿 충전 점검\n2. 정보실 사용 신청은 금요일까지');
  await shot(page, 'PC_회의록_칸쓰기');
  await page.click('#mw-go');
  await closed(page);
  await page.locator('.meet-row', { hasText: '태블릿 충전 점검' }).waitFor({ timeout: 6000 }).catch(() => P('쓴 내용이 보이지 않음'));
  let r = await rowText(page, '정보부');
  if (!r || !/^이몽룡 · /.test(r.by)) P('쓴 분이 남지 않음: ' + JSON.stringify(r));
  // 그사이 다른 분(성춘향)이 같은 칸을 고쳤으면 덮어쓰지 않고 묻는다 → 내 내용으로 바꾸기
  await writeOpen(page, '정보부');
  d = await detail(page);
  const row = d.m.rows.find((x) => x.name === '정보부');
  const other = await as(page, '성춘향', 'meet.row', { id: d.m.id, k: row.k, content: '정보실 열쇠는 교무실에 있어요', base: row.ver });
  if (!other.ok) P('다른 분 저장이 안 됨: ' + JSON.stringify(other));
  await page.fill('#mw-text', '1. 태블릿 충전 점검(고침)\n2. 정보실 사용 신청은 목요일까지');
  await page.click('#mw-go');
  await page.locator('.meet-conflict').waitFor({ timeout: 6000 }).catch(() => P('그사이 다른 분이 고쳤는데 묻지 않음'));
  if (!/성춘향/.test(await page.locator('.meet-conflict').innerText().catch(() => ''))) P('묻는 창에 먼저 고친 분이 없음');
  if (!/목요일까지/.test(await page.inputValue('#mw-text'))) P('묻는 동안 쓰던 글이 사라짐');
  await shot(page, 'PC_회의록_먼저고침_묻기');
  await page.click('#mw-mine');
  await closed(page);
  await page.locator('.meet-row', { hasText: '목요일까지' }).waitFor({ timeout: 6000 }).catch(() => P('내 내용으로 바꾸기가 안 됨'));
  // 기타 안건: 고칠 때 그사이 고쳤으면 → 먼저 고친 내용 두기
  await page.locator('.meet-etc [data-action=meet-etc-edit]').first().click();
  await page.locator('#mw-text').waitFor();
  await modalSettled(page);
  d = await detail(page);
  const e0 = d.m.etcItems[0];
  await as(page, '심청', 'meet.etc.save', { eid: e0.id, content: '(예시) 체육대회 날 우천 시 계획 — 강당으로', base: e0.ver });
  await page.fill('#mw-text', '이 글은 저장되지 않아야 해요');
  await page.click('#mw-go');
  await page.locator('#mw-keep').waitFor({ timeout: 6000 }).catch(() => P('기타 안건도 그사이 고쳤으면 물어야 함'));
  await page.click('#mw-keep');
  await closed(page);
  await page.locator('.meet-etc', { hasText: '강당으로' }).waitFor({ timeout: 6000 }).catch(() => P('먼저 고친 내용 두기가 안 됨'));
  // 기타 안건 더하기(더한 분은 빼기도) → 빼기
  await page.click('[data-action=meet-etc-add]');
  await page.locator('#mw-text').waitFor();
  await modalSettled(page);
  await page.fill('#mw-text', '학년말 행사 준비 협의');
  await page.click('#mw-go');
  await closed(page);
  await page.locator('.meet-etc', { hasText: '학년말 행사 준비 협의' }).waitFor({ timeout: 6000 }).catch(() => P('안건 더하기가 안 됨'));
  d = await detail(page);
  const mine = d.etc.find((x) => /학년말/.test(x.text));
  if (!mine || !mine.del) P('내가 더한 안건에 빼기가 없음');
  await shot(page, 'PC_회의록_쓴뒤', true);
  // 인쇄: A4 세로, 쓴 분 이름 없음, 날짜에 연도
  await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { html: document.querySelector('#print-area').innerHTML, cls: document.body.className, page: (document.querySelector('#meet-page') || {}).textContent || '' }; }; });
  await page.click('[data-action=meet-print]');
  await page.waitForFunction(() => !!window.__printed, null, { timeout: 4000 }).catch(() => P('인쇄를 부르지 않음'));
  const pr = await page.evaluate(() => window.__printed || {});
  const year = d.m.date.slice(0, 4);
  if (!/meet-print/.test(pr.html || '') || !/printing-meet/.test(pr.cls || '')) P('인쇄 모양이 다름 ' + JSON.stringify({ cls: pr.cls }));
  if (!/A4 portrait/.test(pr.page || '')) P('인쇄 쪽이 A4 세로가 아님: ' + pr.page);
  if (/이몽룡|성춘향|심청/.test(pr.html || '')) P('인쇄에 쓴 분 이름이 들어감');
  if (!(pr.html || '').includes(Number(year) + '년 ')) P('인쇄 날짜에 연도가 없음');
  for (const w of ['교장 선생님', '정보부', '목요일까지', '기타 안건', '강당으로', '학년말 행사 준비 협의']) if (!(pr.html || '').includes(w)) P('인쇄에 "' + w + '"이(가) 없음');
  await page.waitForTimeout(700);
  if (await page.evaluate(() => document.body.classList.contains('printing-meet') || !!document.querySelector('#print-area').innerHTML || !!document.querySelector('#meet-page'))) P('인쇄 뒤 인쇄 모양이 남음');
  // 인쇄 모양을 다시 붙여 PDF로: 쪽수·쪽 크기
  await page.evaluate((h) => {
    document.querySelector('#print-area').innerHTML = h;
    const st = document.createElement('style'); st.id = 'meet-page'; st.textContent = '@page{size:A4 portrait;margin:12mm}'; document.head.appendChild(st);
    document.body.classList.add('printing-slips', 'printing-meet');
  }, pr.html || '');
  await page.emulateMedia({ media: 'print' });
  const pdf = path.join(OUT, '인쇄_회의록.pdf');
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => { document.body.classList.remove('printing-slips', 'printing-meet'); document.querySelector('#print-area').innerHTML = ''; const st = document.querySelector('#meet-page'); if (st) st.remove(); });
  let size = '';
  try { size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(require('child_process').execFileSync('pdfinfo', [pdf]).toString()).slice(1, 3).map((x) => Math.round(Number(x))).join('x'); } catch (e) { size = '?'; }
  const pages = pdfPages(pdf);
  if (pages !== 1) P('인쇄가 ' + pages + '쪽(한 장이어야 함)');
  if (size !== '?' && size !== '595x842') P('인쇄 쪽 크기가 A4 세로가 아님: ' + size);
  // 워드 파일(.docx)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=meet-docx]')]);
  const docx = path.join(OUT, '회의록_워드.docx');
  await dl.saveAs(docx);
  if (dl.suggestedFilename() !== '(예시) 부장회의.docx') P('워드 파일 이름이 다름: ' + dl.suggestedFilename());
  const buf = fs.readFileSync(docx);
  if (buf.slice(0, 2).toString() !== 'PK') P('워드 파일이 zip이 아님');
  for (const w of ['word/document.xml', '교장 선생님', '정보부', '목요일까지', '강당으로', '학년말 행사 준비 협의', year + '년 ']) if (!buf.includes(Buffer.from(w))) P('워드 파일에 "' + w + '"이(가) 없음');
  if (/이몽룡|성춘향|심청/.test(buf.toString('utf8'))) P('워드 파일에 쓴 분 이름이 들어감');
  let docInfo = '워드 ' + buf.length + '바이트';
  const soffice = ['/usr/bin/soffice', '/usr/local/bin/soffice'].find((f) => fs.existsSync(f));
  if (soffice) { // LibreOffice로 열어 PDF로: 열리는지·A4 한 장
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'meetdocx-'));
    try {
      require('child_process').execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', tmp, docx], { timeout: 120000, stdio: 'ignore' });
      const out = path.join(tmp, '회의록_워드.pdf');
      if (!fs.existsSync(out)) P('워드 파일을 LibreOffice가 열지 못함');
      else {
        fs.copyFileSync(out, path.join(OUT, '회의록_워드를_PDF로.pdf'));
        const dp = pdfPages(out);
        let ds = '?';
        try { ds = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(require('child_process').execFileSync('pdfinfo', [out]).toString()).slice(1, 3).map((x) => Math.round(Number(x))).join('x'); } catch (e) { /* 그대로 */ }
        if (dp !== 1) P('워드 파일이 ' + dp + '쪽(예시 회의는 한 장)');
        if (ds !== '?' && ds !== '595x842') P('워드 파일 쪽 크기가 A4 세로가 아님: ' + ds);
        docInfo += ' · LibreOffice로 열어 ' + dp + '쪽 ' + ds;
      }
    } catch (e) { P('워드 파일을 LibreOffice로 바꾸다 멈춤: ' + e.message); }
  } else docInfo += ' · LibreOffice 없음(열어 보기는 건너뜀)';
  meetInfo = '회의록 인쇄 ' + pages + '쪽 ' + size + ' · ' + docInfo;

  // 회의 만들기: 제목 저절로, 칸 고르기(교감 빼기) → 만든 분은 고치기·지우기
  await page.click('[data-action=meet-back]');
  await page.locator('.meet-card').first().waitFor();
  if (!/3 \/ 6칸 씀|4 \/ 6칸 씀/.test(await page.locator('.meet-card', { hasText: '(예시) 부장회의' }).innerText())) P('목록 카드의 쓴 칸 수가 바뀌지 않음');
  await page.click('.page-head [data-action=meet-new]');
  await page.locator('#mt-form').waitFor();
  await modalSettled(page);
  const title = await page.inputValue('#mt-title');
  if (!/^\d{4}학년도 [12]학기 부장회의 \(\d+\)$/.test(title)) P('제목이 저절로 채워지지 않음: ' + title);
  const picks = await page.$$eval('#mt-form .meet-pick input', (x) => x.map((i) => i.checked));
  if (picks.length !== 6 || picks.some((c) => !c)) P('칸 고르기가 다름 ' + JSON.stringify(picks));
  await page.selectOption('#mt-kind', { label: '교직원회의' });
  if (!/교직원회의 \(\d+\)$/.test(await page.inputValue('#mt-title'))) P('종류를 바꿔도 제목이 따라 바뀌지 않음');
  await page.selectOption('#mt-kind', { label: '부장회의' });
  await page.fill('#mt-place', '교무실');
  await page.locator('#mt-form .meet-pick label', { hasText: '교감 선생님' }).click();
  await shot(page, 'PC_회의록_만들기');
  await page.click('#mt-form [type=submit]');
  await closed(page);
  await page.locator('.meet-doc').waitFor();
  await page.waitForFunction((t) => (document.querySelector('.meet-h') || {}).textContent === t, title, { timeout: 5000 }).catch(() => P('만든 회의가 열리지 않음'));
  d = await detail(page);
  if (d.names.includes('교감 선생님') || d.names.length !== 5) P('뺀 칸이 남음: ' + d.names.join());
  if (!d.edit || !d.del) P('만든 분인데 회의 고치기·지우기가 없음');
  await writeOpen(page, '교무부');
  await page.fill('#mw-text', '전달 사항 없음');
  await page.click('#mw-go');
  await closed(page);
  await page.click('[data-action=meet-edit]');
  await page.locator('#mt-form').waitFor();
  await modalSettled(page);
  const lock = await page.evaluate(() => [...document.querySelectorAll('#mt-form .meet-pick label')].map((l) => l.textContent.trim() + (l.querySelector('input').disabled ? '(잠김)' : '') + (l.querySelector('input').checked ? '' : '(꺼짐)')));
  if (lock.join() !== '교장 선생님,교감 선생님(꺼짐),교무부 (내용 있음)(잠김),연구부,정보부,인성안전부') P('회의 고치기의 칸이 다름: ' + lock.join());
  await page.fill('#mt-place', '도서실');
  await page.click('#mt-form [type=submit]');
  await closed(page);
  await page.waitForFunction(() => /도서실/.test((document.querySelector('.meet-sub') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => P('회의 고치기(장소)가 반영되지 않음'));
  // 지우기 → 목록에서 빠짐 → 관리자 › 휴지통에서 되살리기
  await page.click('[data-action=meet-del]');
  await page.locator('#cf-ok').waitFor();
  await page.click('#cf-ok');
  await closed(page);
  await page.locator('.meet-card').first().waitFor();
  if (await page.locator('.meet-card', { hasText: title }).count()) P('지운 회의가 목록에 남음');
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=trash]');
  await page.locator('section.card h2', { hasText: '지운 회의록' }).waitFor({ timeout: 8000 }).catch(() => P("관리자 › 휴지통에 '지운 회의록'이 없음"));
  const sec = page.locator('section.card', { has: page.locator('h2', { hasText: '지운 회의록' }) });
  if (!(await sec.innerText().catch(() => '')).includes(title)) P('휴지통에 지운 회의가 없음');
  if (!/회의록은/.test(await page.locator('#admin-panel').innerText())) P('휴지통 안내 글에 회의록이 없음');
  await shot(page, 'PC_관리자_휴지통_회의록', true);
  await sec.locator('[data-action=trash-restore-mt]').first().click();
  if (!(await toastHas(page, /회의록을 되살렸어요/))) P('되살리기 알림이 없음');
  await page.click('[data-admin-tab=settings]');
  await page.waitForFunction(() => /회의록 맨 위 칸/.test(document.querySelector('#admin-panel').textContent), null, { timeout: 6000 }).catch(() => P("설정에 '회의록 맨 위 칸'이 없음"));
  await toMeet(page);
  if (!(await page.locator('.meet-card', { hasText: title }).count())) P('되살린 회의가 목록에 없음');
  // 어둡게 + 장도
  await page.evaluate(() => { localStorage.setItem('gy.theme', 'dark'); localStorage.setItem('gy.design', 'jangdo'); });
  await page.reload();
  await waitText(page, '어서 오세요').catch(() => {});
  if (await page.locator('#login-pw').count()) { await login(page); await verify(page, '이몽룡'); }
  await page.locator('.main').waitFor();
  await toMeet(page);
  await openCard(page, '(예시) 부장회의');
  await shot(page, 'PC_회의록_보기_어둡게_장도', true);
  await ctx.close();

  // ---------- 휴대폰: 칸이 위아래로, 옆으로 넘치지 않음
  ctx = await newCtx(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('회의록 휴대폰 페이지 오류: ' + e.message));
  await page.goto(FILE);
  await waitText(page, '어서 오세요');
  await login(page);
  await verify(page, '흥부');
  await toMeet(page);
  await page.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 6000 }).catch(() => {});
  await check(page, '휴대폰 회의록 목록');
  await shot(page, '휴대폰_회의록_목록');
  await openCard(page, '(예시) 부장회의');
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.meet-row:not(.head)')).gridTemplateColumns.split(' ').length);
  if (cols !== 1) P('휴대폰에서 칸 이름과 내용이 위아래로 쌓이지 않음(열 ' + cols + '개)');
  await check(page, '휴대폰 회의록 보기');
  await shot(page, '휴대폰_회의록_보기', true);
  await writeOpen(page, '연구부');
  await shot(page, '휴대폰_회의록_칸쓰기');
  await ctx.close();
}

/**
 * 여는 그림의 학교 이름 간격(판 2026-10-21c, 교사 요청 '온라인 교무실 글자에 붙어 있어'): 글자가 다 모인 마지막 장면에서
 * 학교 이름 아래 끝과 '온라인 교무실' 알갱이 글자 위 끝 사이가 학교 이름 글자 크기쯤인지 화면 크기마다 잰다(예전에는 그 절반쯤)
 */
async function introGapCheck(browser) {
  const out = [];
  for (const [w, h] of [[1440, 900], [1280, 800], [1366, 768], [1920, 1080], [1259, 465], [844, 390], [390, 844], [360, 740]]) {
    const label = w + 'x' + h, mobile = w < 900;
    const ctx = await newCtx(browser, { viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile }, true);
    await slowServer(ctx, 9000); // 자료가 늦게 와서 마지막 장면(학교 이름·글자·인사)에서 기다린다
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('인트로 간격 ' + label + ' 페이지 오류: ' + e.message));
    await page.goto(FILE);
    const shown = await page.waitForFunction(() => {
      const s = document.querySelector('#gy-intro .gib-sub');
      return !!s && getComputedStyle(s).opacity === '1' && s.style.transform === 'none';
    }, null, { timeout: 8000 }).then(() => true, () => false);
    if (!shown) { problems.push('인트로 간격 ' + label + ': 학교 이름이 다 나타나지 않음'); await ctx.close(); continue; }
    await page.waitForTimeout(300);
    n++;
    await page.screenshot({ path: path.join(OUT, String(n).padStart(2, '0') + '_인트로_간격_' + label + '.png') });
    // 알갱이만, 학교 이름만 따로 찍어 줄마다 밝은 점을 센다(흩어진 별은 드물어서 글자 줄로 세지 않는다)
    const vis = (sel, v) => page.evaluate(([s, x]) => { const el = document.querySelector(s); if (el) el.style.visibility = x; }, [sel, v]);
    await vis('#gy-intro .gib-sub', 'hidden');
    await vis('#gy-intro .gib-hello', 'hidden');
    await vis('#gy-intro .gib-core', 'hidden');
    const onlyText = (await page.screenshot()).toString('base64');
    await vis('#gy-intro .gib-sub', 'visible');
    await vis('#gy-intro .gib-cv', 'hidden');
    const onlySchool = (await page.screenshot()).toString('base64');
    const r = await page.evaluate(async ([a, b]) => {
      const counts = async (b64) => {
        const im = new Image();
        im.src = 'data:image/png;base64,' + b64;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = im.width;
        c.height = im.height;
        const g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data, out = [];
        for (let y = 0; y < im.height; y++) { let k = 0; for (let x = 0; x < im.width; x++) if (d[(y * im.width + x) * 4] > 150) k++; out.push(k); }
        return out;
      };
      const band = (cnt, min) => { let t = -1, e = -1; cnt.forEach((k, y) => { if (k > min) { if (t < 0) t = y; e = y; } }); return [t, e]; };
      const P = await counts(a), S = await counts(b);
      const [pTop, pBot] = band(P, Math.max.apply(null, P) * 0.08);
      const [sTop, sBot] = band(S, 0);
      const sub = document.querySelector('#gy-intro .gib-sub'), hello = document.querySelector('#gy-intro .gib-hello');
      return { pTop, pBot, sTop, sBot, fs: parseFloat(getComputedStyle(sub).fontSize), helloTop: Math.round(hello.getBoundingClientRect().top) };
    }, [onlyText, onlySchool]);
    const gap = r.pTop - r.sBot;
    out.push(label + ' ' + gap + 'px(글자 ' + r.fs + 'px)');
    if (r.sTop < 0 || r.pTop < 0) problems.push('인트로 간격 ' + label + ': 학교 이름이나 글자를 찾지 못함 ' + JSON.stringify(r));
    else {
      if (!(gap >= r.fs * 0.85 && gap <= r.fs * 1.25 + 3)) problems.push('인트로 간격 ' + label + ': 학교 이름과 글자 사이 ' + gap + 'px(학교 이름 글자 ' + r.fs + 'px만큼이어야 함) ' + JSON.stringify(r));
      if (r.sTop < 8) problems.push('인트로 간격 ' + label + ': 학교 이름이 화면 위 끝에 붙음(' + r.sTop + 'px)');
      if (r.helloTop < r.pBot) problems.push('인트로 간격 ' + label + ': 인사가 글자와 겹침 ' + JSON.stringify(r));
    }
    await ctx.close();
  }
  return '학교 이름 간격 ' + out.join(', ');
}

(async () => {
  await startServer();
  FILE = serveFile('미리보기.html', PREVIEW);
  // 한글 파일 이름(바로가기·CSV)이 'download'로 바뀌지 않게 UTF-8 로캘로 연다(이 컨테이너는 기본이 C 로캘, 2026-10-20 확인)
  const browser = await chromium.launch({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
  // ONLY=print: 인쇄 점검만(고치는 동안 빨리 돌려 보기)
  if (process.env.ONLY === 'print') {
    await printCheck(browser);
    await browser.close();
    if (planInfo) console.log(planInfo);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=phone: 휴대폰 흐름만(고치는 동안 빨리 돌려 보기)
  if (process.env.ONLY === 'phone') {
    await flow(browser, '휴대폰', { width: 390, height: 844 });
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=schedfix: 일정·홈·학생 수·학기 보완 점검만(판 2026-10-19a)
  if (process.env.ONLY === 'schedfix') {
    await schedFixCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=b5fix: 묶음 5 새 기능 점검만(판 2026-10-19a)
  if (process.env.ONLY === 'b5fix') {
    await b5SchedCheck(browser);
    await b5TableCheck(browser);
    await b5ShortcutCheck(browser);
    await batCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=drop: 자료 끌어다 놓기(판 2026-10-21b) 점검만
  if (process.env.ONLY === 'drop') {
    await dropCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=lib: 자료실 부서 단추 줄(판 2026-10-21d) 점검만
  if (process.env.ONLY === 'lib') {
    await libDeptCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=home: 홈 '내가 할 일' 오른쪽 사이드바(판 2026-10-22a) 점검만
  if (process.env.ONLY === 'home') {
    await homeSideCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=meet: 회의록(판 2026-10-22a) 점검만
  if (process.env.ONLY === 'meet') {
    await meetCheck(browser);
    await meet2Check(browser);
    await browser.close();
    if (meetInfo) console.log(meetInfo);
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=intro: 여는 그림 점검만(학교 이름 간격, 판 2026-10-21c)
  if (process.env.ONLY === 'intro') {
    await emblemCheck(browser);
    await helloCheck(browser);
    const intro = [await introGapCheck(browser), await introFlow(browser, 'PC', { width: 1440, height: 900 }), await introFlow(browser, '휴대폰', { width: 390, height: 844 }), await introLateCheck(browser), await introReducedMotionCheck(browser)];
    await browser.close();
    console.log('인트로: ' + intro.join(' / '));
    if (helloInfo) console.log(helloInfo);
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=bat: 자동 등록 파일(.bat, 판 2026-10-20a) 점검만
  if (process.env.ONLY === 'bat') {
    await b5ShortcutCheck(browser);
    await batCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=b4fix: 메뉴·이름 고르기·알림·수정 기록·안내서·점검·태블릿 보완 점검만(판 2026-10-19a)
  if (process.env.ONLY === 'b4fix') {
    await b4FixCheck(browser);
    await browser.close();
    if (guideInfo) console.log(guideInfo);
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=svfix: 조사·공지·자료실·교직원 보완 점검만(판 2026-10-19a)
  if (process.env.ONLY === 'svfix') {
    await svFixCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=tablefix: 취합 시트 보완 점검만(판 2026-10-19a)
  if (process.env.ONLY === 'tablefix') {
    await tableFixCheck(browser);
    await browser.close();
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  // ONLY=table: 취합 시트(예전 이름 함께 쓰는 표) 점검만(고치는 동안 빨리 돌려 보기)
  if (process.env.ONLY === 'table') {
    await tableCheck(browser);
    await table2Check(browser);
    await tplCheck(browser);
    await tableFixCheck(browser);
    await tableMissingCheck(browser);
    await browser.close();
    if (tableInfo) console.log(tableInfo);
    if (table2Info) console.log(table2Info);
    if (tplInfo) console.log(tplInfo);
    console.log('사진 ' + n + '장 → ' + OUT);
    if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; } else console.log('넘침·오류 없음');
    return;
  }
  await flow(browser, 'PC', { width: 1440, height: 900 });
  await flow(browser, '휴대폰', { width: 390, height: 844 });
  // 좁은 휴대폰·태블릿·구형 PC 폭에서도 넘치지 않는지
  for (const vp of [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 900, height: 700 }, { width: 960, height: 1000 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    const ctx = await newCtx(browser, { viewport: vp });
    const page = await ctx.newPage();
    await page.goto(FILE);
    await waitText(page, '어서 오세요');
    await check(page, vp.width + ' 로그인');
    await login(page);
    await check(page, vp.width + ' 본인확인');
    await verify(page, '홍길동');
    await check(page, vp.width + ' 홈');
    // 모니터 절반(960) 같은 좁은 PC 창: '내가 할 일'이 오늘 일정 옆에 좁게 끼지 않고 아래로
    // 넓은 모니터(1600 이상)는 '내가 할 일'이 오른쪽 사이드바(판 2026-10-22a): 오늘 일정과 나란히 있는 것은 같아 2칸으로 센다
    await page.locator('.today-card').waitFor();
    const homeSide = await page.evaluate(() => !!document.querySelector('.home-aside'));
    if ((vp.width >= 1600) !== homeSide) problems.push(vp.width + ' 홈: 오른쪽 사이드바가 ' + (homeSide ? '좁은 창에 생김' : '넓은 창에 없음'));
    const homeCols = homeSide ? 2 : await page.evaluate(() => getComputedStyle(document.querySelector('.home-top')).gridTemplateColumns.split(' ').length);
    if (vp.width <= 1024 && homeCols !== 1) problems.push(vp.width + ' 홈: 내가 할 일이 오늘 일정 옆에 좁게 끼어 있음');
    const weekCols = await page.evaluate(() => getComputedStyle(document.querySelector('.week')).gridTemplateColumns.split(' ').length);
    if (vp.width <= 1024 && weekCols !== 1) problems.push(vp.width + ' 홈: 이번 주 5칸이 좁은 창에서 목록으로 바뀌지 않음');
    if (vp.width >= 1280 && (homeCols !== 2 || weekCols !== 5)) problems.push(vp.width + ' 홈: 넓은 창인데 좁은 배치가 됨');
    if (vp.width === 960) await shot(page, '960_홈_좁은창', true);
    await page.evaluate(() => window.__gy.go('schedule'));
    for (const v of ['cal', 'plan', 'year']) {
      await page.click('[data-sched-view=' + v + ']');
      await page.waitForTimeout(500);
      await check(page, vp.width + ' 일정 ' + v);
    }
    await page.evaluate(() => window.__gy.go('survey'));
    await page.locator('.sv-card').first().waitFor();
    await page.waitForTimeout(500);
    await check(page, vp.width + ' 조사');
    await page.fill('#home-q', '').catch(() => {});
    await page.evaluate(() => window.__gy.go('home'));
    await page.fill('#home-q', '협의');
    await page.press('#home-q', 'Enter');
    await page.locator('.search-res').waitFor();
    await check(page, vp.width + ' 홈 검색');
    for (const [scr, sel] of [['notice', '.notice-item'], ['upload', '#up-body section, #up-body .up-steps'], ['library', '.lib-card'], ['staff', '.dir-row:not(.head)'], ['help', '.help-item'], ['guide', '.guide-card']]) {
      await page.evaluate((x) => window.__gy.go(x), scr);
      await page.locator(sel).first().waitFor();
      if (scr === 'help') await page.locator('.help-item summary').first().click();
      await page.waitForTimeout(300);
      await check(page, vp.width + ' ' + scr);
    }
    await page.evaluate(() => window.__gy.go('library'));
    await page.locator('.lib-card').first().waitFor();
    await page.click('[data-action=lib-new]');
    await page.locator('#lib-form').waitFor();
    await page.click('#lib-form [data-mode=file]');
    await check(page, vp.width + ' 자료 넣기 창');
    await page.click('#lib-form [data-action=close-modal]');
    await page.evaluate(() => window.__gy.go('admin'));
    await page.fill('#admin-pw', 'admin1');
    await page.click('#admin-form [type=submit]');
    await page.locator('.srow').nth(3).waitFor();
    await check(page, vp.width + ' 관리자');
    for (const t of ['cat', 'settings', 'year', 'log', 'trash', 'pw', 'check']) {
      await page.click('[data-admin-tab=' + t + ']');
      await page.waitForTimeout(400);
      await check(page, vp.width + ' 관리자 ' + t);
      if (t === 'cat') await checkCatFields(page, vp.width);
    }
    // 화면을 그 폭에서 쓸 수 있는 가장 크게 키워도 넘치지 않는지(PC 130%·넓은 화면 150%·휴대폰 120%)
    await page.evaluate(() => { localStorage.setItem('gy.zoom', '150'); window.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(400);
    const zmax = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gy-zoom').trim());
    const want = vp.width < 900 ? '1.2' : vp.width >= 1600 ? '1.5' : '1.3';
    if (zmax !== want) problems.push(vp.width + ': 가장 큰 화면 크기가 ' + zmax + ' (기대 ' + want + ')');
    for (const [scr, sel] of [['home', '.today-card'], ['schedule', '[data-sched-view]'], ['survey', '.sv-card'], ['library', '.lib-card'], ['staff', '.dir-row:not(.head)'], ['notice', '.notice-item'], ['table', '.tb-card'], ['admin', '.tabs']]) {
      await page.evaluate((x) => window.__gy.go(x), scr);
      await page.locator(sel).first().waitFor();
      await page.waitForTimeout(300);
      if (scr === 'schedule') {
        for (const v of ['cal', 'plan', 'year']) {
          await page.click('[data-sched-view=' + v + ']');
          await page.waitForTimeout(500);
          await check(page, vp.width + ' 화면 ' + zmax + ' 일정 ' + v);
        }
      } else await check(page, vp.width + ' 화면 ' + zmax + ' ' + scr);
    }
    await page.evaluate(() => window.__gy.go('home'));
    await page.locator('.today-card').waitFor();
    if (vp.width === 1280 || vp.width === 1920) await shot(page, vp.width + '_화면크기_' + Math.round(Number(zmax) * 100), true);
    await ctx.close();
  }
  await pinModeCheck(browser);
  await printCheck(browser);
  await dragCheck(browser);
  await emblemCheck(browser);
  await helloCheck(browser);
  await designCheck(browser);
  await tableCheck(browser);
  await table2Check(browser);
  await tplCheck(browser);
  await tableFixCheck(browser);
  await schedFixCheck(browser);
  await svFixCheck(browser);
  await b4FixCheck(browser);
  await b5SchedCheck(browser);
  await b5TableCheck(browser);
  await b5ShortcutCheck(browser);
  await batCheck(browser);
  await dropCheck(browser);
  await libDeptCheck(browser);
  await meetCheck(browser);
  await meet2Check(browser);
  await homeSideCheck(browser);
  await tableMissingCheck(browser);
  const intro = [await introFlow(browser, 'PC', { width: 1440, height: 900 }), await introFlow(browser, '휴대폰', { width: 390, height: 844 }), await introLateCheck(browser), await introReducedMotionCheck(browser), await introGapCheck(browser)];
  await browser.close();
  console.log('인트로: ' + intro.join(' / '));
  if (planInfo) console.log(planInfo);
  if (helloInfo) console.log(helloInfo);
  if (tableInfo) console.log(tableInfo);
  if (table2Info) console.log(table2Info);
  if (tplInfo) console.log(tplInfo);
  if (guideInfo) console.log(guideInfo);
  if (meetInfo) console.log(meetInfo);
  console.log('사진 ' + n + '장 → ' + OUT);
  if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('넘침·오류 없음');
})().catch((e) => { console.error(e); process.exit(1); });
