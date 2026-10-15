/**
 * gas-mock.js — Apps Script를 흉내 내는 가짜 환경 (미리보기·자동 시험용)
 * 진짜 서버 코드(apps-script/*.gs)를 그대로 브라우저나 Node에서 돌려 보려고 만든 것이다.
 * 웹앱에 올리지 않는다.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ SHA-256 / HMAC (순수 JS)
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8(s) {
    return Array.prototype.slice.call(new TextEncoder().encode(String(s)));
  }

  function sha256(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var msg = bytes.slice();
    var bitLen = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var w = new Array(64);
    for (var off = 0; off < msg.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = [];
    h.forEach(function (x) { out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); });
    return out;
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function hmac(keyBytes, msgBytes) {
    if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
    var k = keyBytes.slice();
    while (k.length < 64) k.push(0);
    var ipad = k.map(function (b) { return b ^ 0x36; });
    var opad = k.map(function (b) { return b ^ 0x5c; });
    return sha256(opad.concat(sha256(ipad.concat(msgBytes))));
  }

  function signed(bytes) { return bytes.map(function (b) { return b > 127 ? b - 256 : b; }); }
  function unsigned(bytes) { return bytes.map(function (b) { return (b + 256) % 256; }); }
  function toBytes(v) { return typeof v === 'string' ? utf8(v) : unsigned(v); }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64ws(bytes, abc) {
    abc = abc || B64;
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (i + 1 < bytes.length ? abc[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? abc[n & 63] : '=');
    }
    return out;
  }
  function unb64ws(s, abc) {
    abc = abc || B64;
    s = s.replace(/=+$/, '');
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = abc.indexOf(s[i]);
      if (v < 0) throw new Error('bad base64');
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return out;
  }

  function uuid() {
    var c = root.crypto;
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  /** Asia/Seoul(UTC+9, 서머타임 없음) 기준 */
  function formatDate(d, tz, fmt) {
    var k = new Date(d.getTime() + 9 * 3600 * 1000);
    return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, function (t) {
      return { yyyy: k.getUTCFullYear(), MM: pad(k.getUTCMonth() + 1, 2), dd: pad(k.getUTCDate(), 2), HH: pad(k.getUTCHours(), 2), mm: pad(k.getUTCMinutes(), 2), ss: pad(k.getUTCSeconds(), 2) }[t];
    });
  }

  // ------------------------------------------------------------ 시트
  function Range(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this.nr; i++) {
      var row = [];
      for (var j = 0; j < this.nc; j++) {
        var line = this.s.data[this.r - 1 + i] || [];
        var v = line[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  };
  Range.prototype.getValue = function () { return this.getValues()[0][0]; };
  Range.prototype.setValues = function (vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues: 크기가 맞지 않음');
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.s.put(this.r + i, this.c + j, vals[i][j]);
    return this;
  };
  Range.prototype.setValue = function (v) { this.s.put(this.r, this.c, v); return this; };
  Range.prototype.setFontWeight = function () { return this; };
  Range.prototype.setBackground = function () { return this; };
  Range.prototype.setNumberFormat = function () { return this; };

  function Sheet(name) { this.name = name; this.data = []; this.frozen = 0; }
  /** 진짜 시트처럼: ' 로 시작하면 글자로 저장하고 ' 는 뺀다. 아니면 숫자처럼 보이면 숫자로 바꾼다. */
  Sheet.prototype.put = function (r, c, v) {
    while (this.data.length < r) this.data.push([]);
    var line = this.data[r - 1];
    while (line.length < c) line.push('');
    if (typeof v === 'string') {
      if (v.charAt(0) === "'") v = v.slice(1);
      else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = new Date(v + 'T00:00:00+09:00');
      else if (/^=/.test(v)) v = '#수식#';
    }
    line[c - 1] = v;
  };
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getLastRow = function () {
    for (var i = this.data.length; i > 0; i--) if (this.data[i - 1].some(function (v) { return v !== ''; })) return i;
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    var m = 0;
    this.data.forEach(function (line) { for (var j = line.length; j > m; j--) if (line[j - 1] !== '') { m = j; break; } });
    return m;
  };
  Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  Sheet.prototype.getDataRange = function () { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); };
  Sheet.prototype.appendRow = function (vals) {
    var r = this.getLastRow() + 1;
    for (var j = 0; j < vals.length; j++) this.put(r, j + 1, vals[j]);
    return this;
  };
  Sheet.prototype.setFrozenRows = function (n) { this.frozen = n; };

  function Spreadsheet(id) { this.id = id; this.sheets = []; }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
  Spreadsheet.prototype.insertSheet = function (n) { var s = new Sheet(n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };

  // ------------------------------------------------------------ 드라이브 (자료 파일·백업 폴더)
  function makeBlob(bytes, type, name) {
    var b = unsigned(bytes || []);
    var blob = {
      getBytes: function () { return signed(b); },
      getName: function () { return name || ''; },
      setName: function (n) { name = n; return blob; },
      getContentType: function () { return type || 'application/octet-stream'; },
      getDataAsString: function () { return new TextDecoder().decode(new Uint8Array(b)); }
    };
    return blob;
  }

  function createDrive() {
    var store = { files: {}, folders: {}, n: 0 };
    function newId(p) { store.n++; return p + 'mock' + store.n; }
    function makeFile(name, bytes, type, folderId) {
      var id = newId('F'), trashed = false, created = new Date();
      var f = {
        _bytes: unsigned(bytes), _folder: folderId,
        getId: function () { return id; },
        getName: function () { return name; },
        getMimeType: function () { return type; },
        getSize: function () { return f._bytes.length; },
        getBlob: function () { return makeBlob(f._bytes, type, name); },
        isTrashed: function () { return trashed; },
        setTrashed: function (v) { trashed = !!v; return f; },
        getDateCreated: function () { return created; },
        makeCopy: function (n, folder) { return makeFile(n, f._bytes, type, folder.getId()); }
      };
      store.files[id] = f;
      return f;
    }
    function makeFolder(name) {
      var id = newId('D'), trashed = false;
      var d = {
        getId: function () { return id; },
        getName: function () { return name; },
        isTrashed: function () { return trashed; },
        setTrashed: function (v) { trashed = !!v; return d; },
        createFile: function (blob) { return makeFile(blob.getName(), blob.getBytes(), blob.getContentType(), id); },
        getFilesByType: function () {
          var list = Object.keys(store.files).map(function (k) { return store.files[k]; }).filter(function (f) { return f._folder === id && !f.isTrashed(); });
          var i = 0;
          return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
        }
      };
      store.folders[id] = d;
      return d;
    }
    return {
      _store: store,
      createFolder: makeFolder,
      getFolderById: function (id) { if (!store.folders[id]) throw new Error('없는 폴더'); return store.folders[id]; },
      getFileById: function (id) {
        if (id === 'mock-sheet-id') return { makeCopy: function (n, folder) { return makeFile(n, [], 'application/vnd.google-apps.spreadsheet', folder.getId()); } };
        if (!store.files[id]) throw new Error('없는 파일');
        return store.files[id];
      }
    };
  }

  // ------------------------------------------------------------ 환경 만들기
  function createEnv(opts) {
    opts = opts || {};
    var ss = new Spreadsheet('mock-sheet-id');
    var props = {};
    var env = {
      _ss: ss,
      _props: props,
      _sleeps: 0,
      SpreadsheetApp: {
        getActiveSpreadsheet: function () { return ss; },
        openById: function (id) { if (id !== ss.id) throw new Error('없는 시트'); return ss; },
        getUi: function () { if (!opts.ui) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return opts.ui; }
      },
      PropertiesService: {
        getScriptProperties: function () {
          return {
            getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
            setProperty: function (k, v) { props[k] = String(v); return this; },
            deleteProperty: function (k) { delete props[k]; return this; },
            getProperties: function () { return Object.assign({}, props); }
          };
        }
      },
      LockService: {
        getScriptLock: function () {
          return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {}, hasLock: function () { return true; } };
        }
      },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: function (alg, s) { return signed(sha256(toBytes(s))); },
        computeHmacSha256Signature: function (value, key) { return signed(hmac(toBytes(key), toBytes(value))); },
        base64EncodeWebSafe: function (v) { return b64ws(toBytes(v)); },
        base64DecodeWebSafe: function (s) { return signed(unb64ws(s)); },
        newBlob: function (bytes, type, name) { return makeBlob(typeof bytes === 'string' ? utf8(bytes) : bytes, type, name); },
        base64Encode: function (v) { return b64ws(toBytes(v), B64STD); },
        base64Decode: function (s) { return signed(unb64ws(String(s), B64STD)); },
        getUuid: uuid,
        formatDate: formatDate,
        sleep: function () { env._sleeps++; }
      },
      Session: { getScriptTimeZone: function () { return 'Asia/Seoul'; } },
      DriveApp: createDrive(),
      MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
      console: root.console
    };
    return env;
  }

  var api = { createEnv: createEnv, sha256Hex: function (s) { return sha256(utf8(s)).map(function (b) { return pad(b.toString(16), 2); }).join(''); }, hmacHex: function (k, m) { return hmac(utf8(k), utf8(m)).map(function (b) { return pad(b.toString(16), 2); }).join(''); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GasMock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
