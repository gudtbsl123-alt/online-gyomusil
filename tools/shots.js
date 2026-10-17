/**
 * shots.js — 미리보기를 브라우저로 직접 눌러 보며 사진을 찍고, 옆으로 넘치는지 확인한다.
 * node tools/shots.js [사진 폴더]
 */
'use strict';
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const FILE = 'file://' + path.join(__dirname, '..', '미리보기', '미리보기.html');
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
  await page.selectOption('#lib-dept', { label: '정보부' });
  if ((await page.locator('.lib-group.common .lib-card').count()) !== 3) problems.push(kind + ': 부서로 거르면 공통 자료가 사라짐');
  await page.selectOption('#lib-dept', '');
  // 파일 올리기
  await page.click('[data-action=lib-new]');
  await page.locator('#lib-form').waitFor();
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

/** 5단계: 학사일정 한 번에 올리기(연구부장·부담당) — SAMPLE_XLSX(엑셀로 만든 시험 파일)가 있을 때 */
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
  await page.waitForTimeout(2400); // 알림 글이 사라진 뒤 찍기
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
  await page.reload();
  await page.locator('#app > *').first().waitFor();
  if ((await zoomVar()) !== '0.9') problems.push(kind + ': 다시 열었더니 화면 크기를 잊음(' + (await zoomVar()) + ')');
  await page.evaluate(() => { localStorage.removeItem('gy.zoom'); localStorage.setItem('gy.big', '1'); });
  await page.reload();
  await page.locator('#app > *').first().waitFor();
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
  const src = fs.readFileSync(path.join(__dirname, '..', '미리보기', '미리보기.html'), 'utf8');
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
  loggedIn = 'file://' + f;
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
async function tableCheck(browser) {
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
  const open = async (vp, name, phone) => {
    const ctx = await newCtx(browser, { viewport: vp, deviceScaleFactor: 1, isMobile: !!phone, hasTouch: !!phone });
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

  // ---------- 1) 다른 분(심청) PC: 보기·고치기
  let { ctx, page } = await open({ width: 1440, height: 900 }, '심청');
  await page.click('.side [data-go=table]');
  await page.locator('.tb-card').first().waitFor();
  if ((await page.locator('.tb-card').count()) !== 2) problems.push('표: 목록에 예시 표 2개가 아님');
  const prog = await page.locator('.tb-card .tb-prog b').first().innerText();
  if (prog !== '완료 6 · 미완료 4') problems.push('표: 목록의 고르기 수가 ' + prog);
  await shot(page, '표_목록_PC');
  await page.locator('.tb-card', { hasText: '폐기' }).click();
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
  const nsel = await page.locator('#tb-wrap td.sel').count();
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
  const tid3 = await openTable(page, '시간표');
  await as(page, '놀부', 'table.delete', { id: tid3 });
  await pollNow(page);
  if (!(await toastHas(page, /이 표가 지워졌어요/))) problems.push('표: 보던 표가 지워졌는데 알리지 않음');
  await page.locator('.tb-card').first().waitFor({ timeout: 4000 }).catch(() => problems.push('표: 지워진 표를 보던 화면이 목록으로 가지 않음'));
  await ctx.close();

  // ---------- 2) 만든 분(흥부) PC: 열 고치기·마감·엑셀·인쇄
  ({ ctx, page } = await open({ width: 1280, height: 900 }, '흥부'));
  const tid2 = await openTable(page, '폐기');
  await page.click('[data-action=tb-menu]');
  await page.locator('.tb-menu').waitFor();
  await shot(page, '표_만든분_표고치기_메뉴');
  await page.locator('.tb-menu button', { hasText: '표 이름·마감 고치기' }).click();
  await page.locator('#tbe-title').waitFor();
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
  if (await page.locator('.tb-card', { hasText: '폐기' }).count()) problems.push('표: 지운 표가 목록에 남음');
  await page.evaluate(() => window.__gy.go('admin'));
  await page.fill('#admin-pw', 'admin1');
  await page.click('#admin-form [type=submit]');
  await page.click('[data-admin-tab=trash]');
  await page.locator('[data-action=trash-restore-tb]').first().waitFor({ timeout: 5000 }).catch(() => problems.push('표: 관리자 휴지통에 지운 표가 없음'));
  if (await page.locator('[data-action=trash-restore-tb]').count()) {
    await page.locator('[data-action=trash-restore-tb]').first().click();
    await toastHas(page, /표를 되살렸어요/);
    await toList(page);
    await page.locator('.tb-card', { hasText: '폐기' }).first().waitFor({ timeout: 5000 }).catch(() => problems.push('표: 되살린 표가 목록에 없음'));
  }
  // ---------- 3) 새 표: 구글 시트에서 복사한 칸 붙여 넣기
  await toList(page);
  await page.locator('[data-action=tb-new]').click();
  await page.locator('#tbm-paste').waitFor();
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
  if (msg !== '5줄 · 5열을 가져왔어요(합친 칸·바탕색 그대로)') problems.push('표: 붙여 넣은 뒤 안내가 ' + msg);
  const made = await page.evaluate(() => window.__gy.S.table.make.cols.map((c) => [c.name, c.type, c.options.join('/'), c.lock, c.merge, c.w].join(':')));
  const wantCols = ['학년:text::true:true:70', '반:text::true:false:90', '담임:text::true:false:120', '신청:pick:O:false:false:90', '바라는 시간:text::false:false:220'];
  if (made.join('|') !== wantCols.join('|')) problems.push('표: 붙여 넣은 열 모양이 다름 ' + JSON.stringify(made));
  await shot(page, '표_새표_붙여넣기');
  await page.click('#tbm-go');
  await page.locator(cell(0, 0)).waitFor({ timeout: 6000 }).catch(() => problems.push('표: 새 표를 만든 뒤 표가 열리지 않음'));
  const nt = await page.evaluate(() => {
    const d = window.__gy.S.table.d;
    return d ? { rows: d.rows.length, two: d.rows[1].cells.c1, multi: d.rows[2].cells.c5, paint: d.rows[0].colors.c1, span: (document.querySelector('#tb-wrap td.merged') || {}).rowSpan } : null;
  });
  if (!nt || nt.rows !== 5 || nt.two !== '1학년' || nt.multi !== '수 2시\n또는 목 4시' || nt.paint !== '#D9EAD3' || nt.span !== 2) problems.push('표: 만든 표 내용이 다름 ' + JSON.stringify(nt));
  await shot(page, '표_새표_만든뒤');
  // 붙여 넣을 표가 없으면 빈 표로(열 3개·빈 줄 10개, 열 이름은 바꿔서)
  await toList(page);
  await page.locator('[data-action=tb-new]').click();
  await page.locator('#tbm-blank').click();
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
  await openTable(page, '폐기');
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

(async () => {
  const browser = await chromium.launch();
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
    await page.locator('.home-top').waitFor();
    const homeCols = await page.evaluate(() => getComputedStyle(document.querySelector('.home-top')).gridTemplateColumns.split(' ').length);
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
  const intro = [await introFlow(browser, 'PC', { width: 1440, height: 900 }), await introFlow(browser, '휴대폰', { width: 390, height: 844 }), await introLateCheck(browser), await introReducedMotionCheck(browser)];
  await browser.close();
  console.log('인트로: ' + intro.join(' / '));
  if (planInfo) console.log(planInfo);
  if (helloInfo) console.log(helloInfo);
  if (tableInfo) console.log(tableInfo);
  console.log('사진 ' + n + '장 → ' + OUT);
  if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('넘침·오류 없음');
})().catch((e) => { console.error(e); process.exit(1); });
