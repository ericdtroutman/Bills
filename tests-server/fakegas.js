// A small stand-in for Google Apps Script + one spreadsheet, enough to run server/Code.js in Node.
// Made-up data only. Cells hold raw values (string, number, boolean, Date), the way getValues() gives them.
const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
const TZ = 'America/New_York';

function parts(d, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const o = {}; f.formatToParts(d).forEach(p => { o[p.type] = p.value; }); return o;
}
function formatDate(d, tz, fmt) {
  const p = parts(d, tz), mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p.month - 1], h = +p.hour;
  let out = '', i = 0;
  const tok = [['yyyy', p.year], ['MMM', mon], ['MM', p.month], ['dd', p.day], ['EEE', p.weekday], ['HH', p.hour], ['mm', p.minute], ['ss', p.second],
    ['d', String(+p.day)], ['h', String(h % 12 || 12)], ['a', h < 12 ? 'AM' : 'PM']];
  while (i < fmt.length) {
    if (fmt[i] === "'") { const j = fmt.indexOf("'", i + 1); out += fmt.slice(i + 1, j); i = j + 1; continue; }
    const t = tok.find(x => fmt.startsWith(x[0], i));
    if (t) { out += t[1]; i += t[0].length; } else { out += fmt[i]; i++; }
  }
  return out;
}
// wall time in tz -> Date
function parseDate(wall, tz) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(wall);
  let guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  for (let k = 0; k < 3; k++) { const p = parts(new Date(guess), tz); const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); guess += Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - shown; }
  return new Date(guess);
}
function serialOf(d) { const p = parts(d, TZ); return (Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(1899, 11, 30)) / 864e5 + (+p.hour * 3600 + +p.minute * 60 + +p.second) / 86400; }
function shown(d) { const p = parts(d, TZ); return (+p.hour || +p.minute || +p.second) ? `${+p.month}/${+p.day}/${p.year} ${+p.hour}:${p.minute}:${p.second}` : `${p.year}-${p.month}-${p.day}`; }

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.data = []; this.maxRows = 1000; }
  getName() { return this.name; } setName(n) { this.name = n; return this; }
  lastRow() { let n = this.data.length; while (n && !(this.data[n - 1] || []).some(x => x !== '' && x !== null && x !== undefined)) n--; return n; }
  lastCol() { let c = 0; this.data.forEach(r => { for (let i = (r || []).length; i > c; i--) if (r[i - 1] !== '' && r[i - 1] !== null && r[i - 1] !== undefined) { c = i; break; } }); return c; }
  getLastRow() { this.ss.calls++; return this.lastRow(); }
  getMaxRows() { return this.maxRows; }
  setFrozenRows() { return this; }
  insertRowsAfter(after, n) { this.ss.calls++; this.maxRows += n; return this; }
  deleteRow(r) { return this.deleteRows(r, 1); }
  deleteRows(r, n) { this.ss.calls++; this.data.splice(r - 1, n); this.maxRows -= n; return this; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.lastRow()), Math.max(1, this.lastCol())); }
  getRange(r, c, nr, nc) {
    const sh = this; nr = nr || 1; nc = nc || 1;
    const R = {
      getValues() { sh.ss.calls++; sh.ss.reads++; const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (sh.data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined || v === null ? '' : v); } out.push(row); } return out; },
      setValues(vals) {
        sh.ss.calls++;
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues: wrong size');
        if (r + nr - 1 > sh.maxRows) throw new Error('setValues: past the last row of ' + sh.name);
        if (sh.ss.failNextWrite) { sh.ss.failNextWrite = false; throw new Error('Service error (made up)'); }
        for (let i = 0; i < nr; i++) { while (sh.data.length < r + i) sh.data.push([]); const row = sh.data[r - 1 + i]; for (let j = 0; j < nc; j++) { while (row.length < c + j) row.push(''); row[c - 1 + j] = vals[i][j]; } }
        return R;
      },
      clearContent() { sh.ss.calls++; for (let i = 0; i < nr; i++) { const row = sh.data[r - 1 + i]; if (!row) continue; for (let j = 0; j < nc; j++) if (c - 1 + j < row.length) row[c - 1 + j] = ''; } return R; },
      setNumberFormat() { return R; }, setFontWeight() { return R; }, setBackground() { return R; }
    };
    return R;
  }
}
class Spreadsheet {
  constructor(name) { this.name = name; this.sheets = []; this.calls = 0; this.reads = 0; this.copies = []; this.id = 'ss_' + name; }
  getId() { return this.id; } getName() { return this.name; } getUrl() { return 'https://example.invalid/' + this.id; }
  getSpreadsheetTimeZone() { return TZ; }
  getSheets() { this.calls++; return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { this.calls++; const s = new Sheet(this, n); this.sheets.push(s); return s; }
  copy(name) { const c = new Spreadsheet(name); c.sheets = this.sheets.map(s => { const x = new Sheet(c, s.name); x.data = JSON.parse(JSON.stringify(s.data)); return x; }); this.copies.push(c); return c; }
  dump() { const o = {}; this.sheets.forEach(s => { o[s.name] = s.data.slice(0, s.lastRow()).map(r => r.map(v => v instanceof Date ? 'DATE:' + v.toISOString() : v)); }); return o; }
}

function makeWorld(codePath, opts) {
  opts = opts || {};
  const ss = opts.ss || new Spreadsheet('Bills App');
  const props = opts.props || { PASSCODE: 'made-up-passcode' };
  const cache = {}, triggers = opts.triggers || [], log = [];
  const world = { ss, props, log, batchCalls: 0, sheetsApi: opts.sheetsApi !== false, apiBreak: null, simplefin: opts.simplefin || { accounts: [], connections: [] } };
  const sandbox = {
    console: { log() {}, error(...a) { log.push(a.join(' ')); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => TZ },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {}, getUi: () => ({}) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => { const t = { getHandlerFunction: () => fn }; const b = { timeBased: () => b, onMonthDay: () => b, atHour: () => b, everyDays: () => b, nearMinute: () => b, create: () => { triggers.push(t); return t; } }; return b; }
    },
    Utilities: {
      formatDate, parseDate: (s, tz) => parseDate(s, tz),
      computeDigest: (alg, s) => Array.from(crypto.createHash('md5').update(s).digest()), DigestAlgorithm: { MD5: 'md5' },
      base64Encode: b => Buffer.from(typeof b === 'string' ? b : Uint8Array.from(b.map(x => (x + 256) % 256))).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')), base64DecodeWebSafe: s => Array.from(Buffer.from(s, 'base64url')),
      newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString('utf8') }), getUuid: () => crypto.randomUUID()
    },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(world.simplefin) }) },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Date, JSON, Math, Object, Array, String, Number, RegExp, Error, parseFloat, parseInt, isNaN, decodeURIComponent, encodeURIComponent
  };
  if (world.sheetsApi) sandbox.Sheets = { Spreadsheets: { Values: { batchGet(id, o) {
    world.batchCalls++;
    if (world.apiBreak === 'throw') throw new Error('Google Sheets API has not been used in project 123 before or it is disabled (made up).');
    if (o.valueRenderOption !== 'UNFORMATTED_VALUE') throw new Error('fake: only UNFORMATTED_VALUE');
    return { spreadsheetId: id, valueRanges: o.ranges.map(rg => {
      const name = rg.replace(/^'|'$/g, ''), sh = ss.getSheetByName(name);
      if (!sh) throw new Error('Unable to parse range: ' + rg);
      const nr = sh.lastRow(), values = [];
      for (let i = 0; i < nr; i++) {
        const row = (sh.data[i] || []).map(v => v instanceof Date ? (o.dateTimeRenderOption === 'FORMATTED_STRING' ? shown(v) : serialOf(v)) : (v === null || v === undefined ? '' : v));
        while (row.length && row[row.length - 1] === '') row.pop();          // the real service drops trailing empty cells
        values.push(row);
      }
      if (world.apiBreak === 'wrong' && name === 'Charges' && values[1]) values[1][3] = 999.99;
      const vr = { range: (/\W/.test(name) ? "'" + name + "'" : name) + '!A1:Z' + sh.maxRows, majorDimension: 'ROWS' };
      if (values.length) vr.values = values;                                 // an empty tab comes back with no values at all
      return vr;
    }) };
  } } } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), sandbox, { filename: codePath });
  world.sandbox = sandbox;
  world.post = (fn, extra) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(Object.assign({ key: props.PASSCODE, fn }, extra || {})) } }).text);
  world.run = name => sandbox[name]();
  // a new request = a fresh run of the script against the same spreadsheet and properties
  world.fresh = () => makeWorld(codePath, { ss, props, triggers, sheetsApi: world.sheetsApi, simplefin: world.simplefin });
  return world;
}
module.exports = { makeWorld, Spreadsheet, Sheet, TZ, formatDate };
