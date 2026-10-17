/**
 * load-gas.js — apps-script/*.gs 를 가짜 환경(gas-mock.js)에 올려 Node에서 돌린다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const GasMock = require('./gas-mock.js');

const GAS_DIR = path.join(__dirname, '..', 'apps-script');
const GAS_FILES = ['Code.gs', 'Db.gs', 'Auth.gs', 'Admin.gs', 'Schedule.gs', 'Survey.gs', 'Library.gs', 'Help.gs', 'Setup.gs', 'Table.gs'];

/** clock.offset(ms)를 바꾸면 서버 코드의 시계가 그만큼 앞으로 간다 */
function loadGas(opts) {
  opts = opts || {};
  const clock = { offset: 0 };
  const RealDate = Date;
  const env = GasMock.createEnv(Object.assign({ now: () => RealDate.now() + clock.offset }, opts));
  class FakeDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(RealDate.now() + clock.offset);
      else super(...a);
    }
    static now() { return RealDate.now() + clock.offset; }
  }
  const ctx = Object.assign({ Date: FakeDate, JSON, Math, Object, Array, String, Number, Error, RegExp, TextEncoder, TextDecoder, crypto: globalThis.crypto }, env);
  vm.createContext(ctx);
  for (const f of GAS_FILES) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f });
  }
  ctx.__clock = clock;
  return ctx;
}

module.exports = { loadGas, GAS_FILES, GAS_DIR };
