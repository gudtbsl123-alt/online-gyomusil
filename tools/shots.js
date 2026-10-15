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
async function newCtx(browser, opts) {
  const ctx = await browser.newContext(opts);
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
async function waitText(page, t) { await page.getByText(t, { exact: false }).first().waitFor({ timeout: 5000 }); }

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
  await page.click('#ev-form [type=submit]');
  await waitText(page, '전교 다모임을 넣었어요');
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
  await page.click('#cf-ok');
  await waitText(page, '다시 알렸어요');
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
  await scheduleFlow(page, kind);
  await surveyFlow(page, kind);
  await libraryFlow(page, kind);

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
  await page.pdf({ path: path.join(OUT, '인쇄_월별계획.pdf'), format: 'A4' });
  for (const [scr, sel, name] of [['staff', '.dir-row', '인쇄_교직원명단.pdf'], ['guide', '.guide-card', '인쇄_운영안내서.pdf']]) {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate((x) => window.__gy.go(x), scr);
    await page.locator(sel).first().waitFor();
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, name), format: 'A4' });
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await flow(browser, 'PC', { width: 1440, height: 900 });
  await flow(browser, '휴대폰', { width: 390, height: 844 });
  // 좁은 휴대폰·태블릿·구형 PC 폭에서도 넘치지 않는지
  for (const vp of [{ width: 360, height: 740 }, { width: 768, height: 1024 }, { width: 900, height: 700 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    const ctx = await newCtx(browser, { viewport: vp });
    const page = await ctx.newPage();
    await page.goto(FILE);
    await waitText(page, '어서 오세요');
    await check(page, vp.width + ' 로그인');
    await login(page);
    await check(page, vp.width + ' 본인확인');
    await verify(page, '홍길동');
    await check(page, vp.width + ' 홈');
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
    for (const [scr, sel] of [['library', '.lib-card'], ['staff', '.dir-row:not(.head)'], ['help', '.help-item'], ['guide', '.guide-card']]) {
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
    for (const t of ['cat', 'settings', 'year', 'log', 'trash', 'pw']) {
      await page.click('[data-admin-tab=' + t + ']');
      await page.waitForTimeout(400);
      await check(page, vp.width + ' 관리자 ' + t);
      if (t === 'cat') await checkCatFields(page, vp.width);
    }
    await ctx.close();
  }
  await pinModeCheck(browser);
  await printCheck(browser);
  await browser.close();
  console.log('사진 ' + n + '장 → ' + OUT);
  if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('넘침·오류 없음');
})().catch((e) => { console.error(e); process.exit(1); });
