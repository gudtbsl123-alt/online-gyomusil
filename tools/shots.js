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

async function login(page) {
  await page.fill('#login-pw', 'preview1');
  await page.click('#login-form [type=submit]');
  await waitText(page, '누구신가요?');
}
async function verify(page, name, remember) {
  await page.locator('.person', { hasText: name }).first().click();
  await page.fill('#id-pin', '1111');
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
  await page.fill('#id-pin', '9999');
  await page.click('#id-form [type=submit]');
  await waitText(page, '남은 기회는 4번');
  await shot(page, kind + '_번호_틀림');

  await page.fill('#id-pin', '1111');
  await page.click('#id-form [type=submit]');
  await waitText(page, '오늘도 반가워요');
  await shot(page, kind + '_홈', true);

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
  await page.locator('.srow', { hasText: '전우치' }).locator('[data-action=staff-pin]').click();
  await page.click('#cf-ok');
  await page.locator('.pin-big').waitFor();
  await shot(page, kind + '_개인번호_한번만');
  await page.click('[data-action=close-pins]');

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

  await page.click('[data-admin-tab=log]');
  await page.locator('.log-item').first().waitFor();
  const det = page.locator('.log-item details').first();
  if (await det.count()) await det.locator('summary').click();
  await shot(page, kind + '_수정기록', true);

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
  await shot(page, kind + '_어둡게_준비중');
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
    await page.evaluate(() => window.__gy.go('admin'));
    await page.fill('#admin-pw', 'admin1');
    await page.click('#admin-form [type=submit]');
    await page.locator('.srow').nth(3).waitFor();
    await check(page, vp.width + ' 관리자');
    for (const t of ['cat', 'settings', 'log', 'pw']) {
      await page.click('[data-admin-tab=' + t + ']');
      await page.waitForTimeout(400);
      await check(page, vp.width + ' 관리자 ' + t);
      if (t === 'cat') await checkCatFields(page, vp.width);
    }
    await ctx.close();
  }
  await printCheck(browser);
  await browser.close();
  console.log('사진 ' + n + '장 → ' + OUT);
  if (problems.length) { console.log('문제:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('넘침·오류 없음');
})().catch((e) => { console.error(e); process.exit(1); });
