/**
 * Bills App: server side.
 * Every table lives in its own tab of this spreadsheet. Row 1 is the header,
 * column A is a unique id. The app only ever adds, changes or deletes single
 * rows, under a lock, so two saves can never collide.
 *
 * The app page lives on GitHub and talks to this script. This script only
 * answers when the passcode below is right.
 */

/* ============================================================
   PASSCODE: set in Project Settings > Script Properties (name PASSCODE).
   Use something you'll remember; you type it once per device.
   ============================================================ */
var PASSCODE = PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';

var TABLES = {
  Cards:       ['id', 'name', 'color', 'paid', 'order', 'url', 'username', 'password'],
  Charges:     ['id', 'cardId', 'item', 'amount', 'who', 'order', 'date', 'bankId', 'hold', 'settled', 'addedAt', 'bankAsOf'],   // addedAt: when the app brought it in; bankAsOf: when SimpleFIN last heard from that bank
  Joint:       ['id', 'item', 'amount', 'order'],
  Bills:       ['id', 'payOn', 'name', 'total', 'us', 'paid', 'note', 'order', 'status', 'url', 'username', 'password'],
  Funds:       ['id', 'name', 'color', 'order', 'target', 'perCheck'],   // target: goal amount; perCheck: set aside from each paycheck's leftover
  FundEntries: ['id', 'fundId', 'date', 'note', 'amount', 'order'],
  People:      ['id', 'name', 'budget', 'order'],
  Gifts:       ['id', 'personId', 'item', 'amount', 'order'],
  Settings:    ['id', 'value'],
  BankAccounts: ['id', 'name', 'bank', 'cardId', 'balance', 'nick', 'saveAs', 'bankAsOf'],   // nick: your own name; saveAs: mine / joint / out (Savings page)
  Imported:    ['id', 'date', 'amount', 'cardId'],
  History:     ['id', 'cardId', 'item', 'amount', 'who', 'date', 'clearedOn'],
  Pending:     ['id', 'cardId', 'item', 'amount', 'who', 'date', 'bankId', 'hold'],
  JointCash:   ['id', 'item', 'amount', 'date', 'order'],
  Checking:    ['id', 'date', 'name', 'amount', 'kind', 'pairId', 'period', 'order', 'pot', 'manual', 'note', 'extra', 'credit', 'nolink', 'other', 'addedAt', 'bankAsOf'],
  Periods:     ['id', 'startDate', 'endDate', 'income', 'cards', 'spend', 'bills', 'saved', 'byType', 'joint', 'savedTo'],
  TypeRules:   ['id', 'type'],
  Rules:       ['id', 'kind'],
  CheckPending: ['id', 'date', 'name', 'amount'],
  JointBank:   ['id', 'date', 'name', 'amount', 'pending', 'other'],   // copy of the joint checking's recent lines, rewritten on every sync
  JointKinds:  ['id', 'kind', 'amount', 'date'],                // your answer for each joint checking line (same id as JointBank)
  SyncLog:     ['id', 'at', 'how', 'added', 'banks']            // one row per bank sync: when, automatic or Sync now, how many came in, when SimpleFIN last heard from each bank
};
var NUMBER_FIELDS = { amount: 1, total: 1, us: 1, budget: 1, order: 1, balance: 1, income: 1, cards: 1, spend: 1, bills: 1, saved: 1,
                      extra: 1, credit: 1, joint: 1, target: 1, perCheck: 1 };
var BOOL_FIELDS = { paid: 1, hold: 1, manual: 1, nolink: 1, pending: 1 };
var TEXT_FIELDS = { id: 1, cardId: 1, fundId: 1, personId: 1, item: 1, name: 1, note: 1, who: 1,
                    payOn: 1, color: 1, date: 1, value: 1, status: 1,
                    url: 1, username: 1, password: 1, bank: 1, bankId: 1, clearedOn: 1, nick: 1, other: 1, kind: 1, pairId: 1, period: 1, settled: 1, startDate: 1, endDate: 1, byType: 1, savedTo: 1, type: 1, pot: 1, saveAs: 1, addedAt: 1, bankAsOf: 1, at: 1, how: 1, banks: 1 };

/* ---------------------------------------------------------------- entry points */

/** Opening the script link directly shows nothing private. */
function doGet() {
  return ContentService.createTextOutput('Bills App is running. Open your Bills page to use it.');
}

/**
 * Every request from the app page comes here as
 * {key: passcode, fn: 'getData' | 'apply' | 'backup' | 'ping', ops: [...]}.
 */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkPasscode_(req.key);
    if (req.fn === 'ping') out = { ok: true };
    else if (req.fn === 'getData') out = { ok: true, data: getData_() };
    else if (req.fn === 'apply') { apply_(req.ops); out = { ok: true }; }
    else if (req.fn === 'backup') out = { ok: true, data: backupNow() };
    else if (req.fn === 'getHistory') out = { ok: true, data: readTable_('History') };
    else if (req.fn === 'getOldChecking') out = { ok: true, data: oldChecking_() };
    else if (req.fn === 'bankConnect') out = { ok: true, data: bankConnect_(req.token) };
    else if (req.fn === 'bankSync') out = { ok: true, data: syncBank_('Sync now') };
    else if (req.fn === 'bankDisconnect') out = { ok: true, data: bankDisconnect_() };
    else throw new Error('Unknown request.');
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Wrong passcodes are counted; after 10 in 15 minutes everything is refused for 15 minutes. */
function checkPasscode_(key) {
  if (!PASSCODE || PASSCODE === 'change-me') {
    throw new Error('SETUP: Add a script property named PASSCODE in Project Settings > Script Properties.');
  }
  var cache = CacheService.getScriptCache();
  var fails = parseInt(cache.get('badTries') || '0', 10);
  if (fails >= 10) throw new Error('LOCKED: Too many wrong passcodes. Wait 15 minutes and try again.');
  if (String(key || '') !== String(PASSCODE)) {
    cache.put('badTries', String(fails + 1), 900);
    throw new Error('PASSCODE: That passcode isn’t right.');
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Bills App')
    .addItem('Make a backup copy', 'backupNow')
    .addItem('Repair tabs', 'setup')
    .addToUi();
}

/** Run once from the editor if you like; the app also does this on first open. */
function setup() {
  ensureSetup_();
}

/* ---------------------------------------------------------------- data */

function getData_() {
  ensureSetup_();
  var out = {};
  Object.keys(TABLES).forEach(function (name) { if (name !== 'Imported' && name !== 'History' && name !== 'SyncLog') out[name] = readTable_(name); });
  // checking lines filed with older pay periods stay in the Sheet but aren't sent on every open (search asks for them)
  var keep = checkingKeep_(out.Periods);
  out.Checking = out.Checking.filter(function (r) { return !r.period || r.period === keep; });
  return out;
}
/** The newest filed pay period: its lines stay loaded so Reopen works. */
function checkingKeep_(periods) {
  var p = (periods || []).slice().sort(function (a, b) { return String(b.endDate).localeCompare(String(a.endDate)); })[0];
  return p ? p.id : '';
}
function oldChecking_() {
  var k = checkingKeep_(readTable_('Periods'));
  return readTable_('Checking').filter(function (r) { return r.period && r.period !== k; });
}

/**
 * ops: [{op:'upsert', table, row}, {op:'remove', table, id},
 *       {op:'removeWhere', table, field, value}]
 * Applied in order, all under one lock.
 */
function apply_(ops) {
  if (!ops || !ops.length) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ops.forEach(function (o) {
      if (!TABLES[o.table]) throw new Error('Unknown table: ' + o.table);
      if (o.op === 'upsert') upsert_(o.table, o.row);
      else if (o.op === 'remove') remove_(o.table, String(o.id));
      else if (o.op === 'removeWhere') removeWhere_(o.table, o.field, o.value);
      else if (o.op === 'removeIds') removeIds_(o.table, o.ids || []);
      else throw new Error('Unknown op: ' + o.op);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** Saves a dated copy of the whole spreadsheet in your Google Drive. */
function backupNow() {
  var ss = ss_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd h.mm a');
  var copy = ss.copy(ss.getName() + ' backup ' + stamp);
  return { name: copy.getName(), url: copy.getUrl() };
}

/* ---------------------------------------------------------------- storage helpers */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (sh) {
    // newer versions of the app may add columns at the end; add any missing headers
    var cols0 = TABLES[name];
    var have = sh.getRange(1, 1, 1, cols0.length).getValues()[0];
    if (have[cols0.length - 1] !== cols0[cols0.length - 1]) {
      sh.getRange(1, 1, 1, cols0.length).setValues([cols0]).setFontWeight('bold').setBackground('#EEF1F5');
      cols0.forEach(function (c, i) {
        if (TEXT_FIELDS[c]) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
      });
    }
  } else {
    sh = ss.insertSheet(name);
    var cols = TABLES[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#EEF1F5');
    sh.setFrozenRows(1);
    // keep ids, dates and notes as plain text so Sheets never turns them into numbers or dates
    cols.forEach(function (c, i) {
      if (TEXT_FIELDS[c]) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sh;
}

function readTable_(name) {
  var sh = sheet_(name);
  var cols = TABLES[name];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  var rows = [];
  values.forEach(function (v) {
    if (v[0] === '' || v[0] === null) return;
    var o = {};
    cols.forEach(function (c, i) { o[c] = clean_(c, v[i]); });
    if (name === 'Bills' && !o.status && o.paid) o.status = 'paid';
    rows.push(o);
  });
  return rows;
}

function clean_(field, v) {
  if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (NUMBER_FIELDS[field]) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  if (BOOL_FIELDS[field]) return v === true || v === 'TRUE' || v === 'true';
  v = v === null || v === undefined ? '' : String(v);
  if (/^'[=+\-@]/.test(v)) v = v.slice(1);   // undo the guard added in toCell_
  return v;
}

function toCell_(field, v) {
  if (v === undefined || v === null) return '';
  if (NUMBER_FIELDS[field]) { var n = parseFloat(v); return isNaN(n) ? '' : n; }
  if (BOOL_FIELDS[field]) return v === true;
  v = String(v);
  // a password like "=abc" must be stored as text, never run as a formula
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return v;
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function upsert_(name, row) {
  if (!row || !row.id) throw new Error('Row needs an id');
  var sh = sheet_(name);
  var cols = TABLES[name];
  var r = findRow_(sh, String(row.id));
  if (r > 0) {
    var current = sh.getRange(r, 1, 1, cols.length).getValues()[0];
    var merged = cols.map(function (c, i) { return c in row ? toCell_(c, row[c]) : current[i]; });
    sh.getRange(r, 1, 1, cols.length).setValues([merged]);
  } else {
    sh.appendRow(cols.map(function (c) { return toCell_(c, row[c]); }));
  }
}

function remove_(name, id) {
  var sh = sheet_(name);
  var r = findRow_(sh, id);
  if (r > 0) sh.deleteRow(r);
}

/** Deletes many rows by id in one read and one write. */
function removeIds_(name, ids) {
  if (!ids.length) return;
  var drop = {}; ids.forEach(function (i) { drop[String(i)] = true; });
  var sh = sheet_(name), cols = TABLES[name], last = sh.getLastRow();
  if (last < 2) return;
  var range = sh.getRange(2, 1, last - 1, cols.length);
  var values = range.getValues();
  var keep = values.filter(function (v) { return !drop[String(v[0])]; });
  if (keep.length === values.length) return;
  range.clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, cols.length).setValues(keep);
}

function removeWhere_(name, field, value) {
  var sh = sheet_(name);
  var cols = TABLES[name];
  var k = cols.indexOf(field);
  if (k < 0) throw new Error('Unknown field: ' + field);
  var last = sh.getLastRow();
  if (last < 2) return;
  var range = sh.getRange(2, 1, last - 1, cols.length);
  var values = range.getValues();
  var keep = values.filter(function (v) { return String(v[k]) !== String(value); });
  if (keep.length === values.length) return;
  // rewrite the table in one go: one read and one write, however many rows go
  range.clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, cols.length).setValues(keep);
}

/* ---------------------------------------------------------------- automatic backups */

/** Makes a backup copy on the 1st of every month, late at night. */
function ensureBackupTrigger_() {
  var has = false;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'weeklyBackup') ScriptApp.deleteTrigger(t);   // older version backed up weekly
    if (fn === 'monthlyBackup') has = true;
  });
  if (!has) ScriptApp.newTrigger('monthlyBackup').timeBased().onMonthDay(1).atHour(23).create();
}

function monthlyBackup() {
  backupNow();
}

/** Kept only so an old weekly schedule can never fail before it is removed. */
function weeklyBackup() {
  backupNow();
}

/* ---------------------------------------------------------------- bank sync (SimpleFIN) */
/*
 * How it works:
 *  - You paste a SimpleFIN setup token in the app once. This script trades it for a private
 *    access link, kept in this script's private settings (never in the sheet or the page).
 *  - Once a day (and whenever you tap Sync now) it asks SimpleFIN for recent POSTED charges.
 *  - Each bank account is matched to one of your cards on the Bank Sync screen. Accounts you
 *    haven't matched are ignored.
 *  - Every transaction SimpleFIN sends has its own id. Each one imported is written to the
 *    Imported tab, and anything already in that tab is skipped forever, even after you clear
 *    a card's charges. That is what stops repeats.
 *  - Card payments are skipped. Refunds come in as negative charges.
 *  - An account matched to "My checking" goes to the Checking tab instead of a card. Deposits and
 *    anything that looks like a transfer come in unanswered so the app can ask what they are.
 *  - Pending charges go to the separate Pending tab, which is rebuilt on every sync. Labels you
 *    give them are kept while they stay pending. Once a charge posts, its pending entry is gone
 *    and the posted charge comes in as a normal charge. Pending charges never count as charges.
 */

function authorizeBankSync() {
  // Run this once from the editor so Google asks for the "connect to an external service" permission.
  UrlFetchApp.fetch('https://beta-bridge.simplefin.org/', { muteHttpExceptions: true });
  ensureSetup_();
  return 'OK';
}

function props_() { return PropertiesService.getScriptProperties(); }

function setSetting_(id, value) { upsert_('Settings', { id: id, value: value }); }
function getSetting_(id) {
  var s = readTable_('Settings').filter(function (r) { return r.id === id; })[0];
  return s ? s.value : '';
}

function bankConnect_(token) {
  token = String(token || '').trim();
  if (!token) throw new Error('Paste your SimpleFIN setup token first.');
  var claimUrl;
  try { claimUrl = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString(); }
  catch (e) {
    try { claimUrl = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString(); }
    catch (e2) { throw new Error('That doesn’t look like a SimpleFIN setup token. Copy the whole token again.'); }
  }
  if (!/^https:\/\//.test(claimUrl)) throw new Error('That doesn’t look like a SimpleFIN setup token. Copy the whole token again.');
  var res = UrlFetchApp.fetch(claimUrl, { method: 'post', payload: '', muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('SimpleFIN didn’t accept that token (it may have been used already). Make a new setup token in SimpleFIN and try again.');
  }
  var access = String(res.getContentText()).trim();
  if (!/^https:\/\/[^:]+:[^@]+@/.test(access)) throw new Error('SimpleFIN sent back something unexpected. Try a new setup token.');
  props_().setProperty('SIMPLEFIN_ACCESS', access);
  setSetting_('bankConnected', 'yes');
  if (!getSetting_('syncStart')) {
    setSetting_('syncStart', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  }
  ensureSyncTrigger_();
  // list the accounts (no transactions yet) so you can match them to cards
  var data = sfFetch_('version=2&balances-only=1');
  saveAccounts_(data);
  recordErrors_(data, 0);
  return { ok: true };
}

function bankDisconnect_() {
  props_().deleteProperty('SIMPLEFIN_ACCESS');
  setSetting_('bankConnected', '');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBankSync') ScriptApp.deleteTrigger(t);
  });
  return { ok: true };
}

/* The daily sync runs at about 8:30 AM (Eric, Oct 29, 2026; Google fires it within about 15 minutes of that; SimpleFIN asks apps to avoid the top of the hour). SYNC_AT records which schedule the
   current trigger was made with, so changing SYNC_SCHEDULE replaces the old trigger the next time the app is opened. */
var SYNC_SCHEDULE = '08:30';
function ensureSyncTrigger_() {
  var mine = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'dailyBankSync'; });
  if (mine.length && props_().getProperty('SYNC_AT') === SYNC_SCHEDULE) return;
  mine.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBankSync').timeBased().everyDays(1).atHour(8).nearMinute(30).create();
  props_().setProperty('SYNC_AT', SYNC_SCHEDULE);
}

function dailyBankSync() {
  try { syncBank_('Automatic'); }
  catch (e) { setSetting_('lastSyncMsg', 'Sync failed: ' + (e.message || e)); }
}

function sfFetch_(query) {
  var access = props_().getProperty('SIMPLEFIN_ACCESS');
  if (!access) throw new Error('Bank sync isn’t connected yet.');
  var m = access.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+?)\/?$/);
  if (!m) throw new Error('The saved SimpleFIN link looks damaged. Disconnect and connect again.');
  var res = UrlFetchApp.fetch(m[1] + m[4] + '/accounts?' + query, {
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(decodeURIComponent(m[2]) + ':' + decodeURIComponent(m[3])) },
    muteHttpExceptions: true, followRedirects: true
  });
  var code = res.getResponseCode();
  if (code === 402) throw new Error('SimpleFIN says your subscription needs attention. Check your SimpleFIN account.');
  if (code === 403) throw new Error('SimpleFIN turned down the saved access. Disconnect and connect again with a new setup token.');
  if (code !== 200) throw new Error('SimpleFIN didn’t answer (error ' + code + '). The app will try again tomorrow, or tap Sync now later.');
  return JSON.parse(res.getContentText());
}

function saveAccounts_(data) {
  var known = {};
  readTable_('BankAccounts').forEach(function (r) { known[r.id] = r; });
  var conns = {};
  (data.connections || []).forEach(function (c) { conns[c.conn_id] = c.name; });
  var keys = [];
  (data.accounts || []).forEach(function (a) {
    var key = acctKey_(a);
    keys.push(key);
    var row = known[key] || { id: key, cardId: '' };
    row.name = a.name || '';
    row.bank = conns[a.conn_id] || (a.org && (a.org.name || a.org.domain)) || '';
    row.balance = parseFloat(a.balance) || 0;
    row.bankAsOf = stamp_(a['balance-date']);
    upsert_('BankAccounts', row);
  });
  return keys;
}

/* A readable time like "Thu Oct 29 · 8:35 AM". The "·" keeps Sheets from turning it into a date (which would drop the time). */
function stamp_(secOrDate) {
  if (!secOrDate) return '';
  var d = secOrDate instanceof Date ? secOrDate : new Date(+secOrDate * 1000);
  return isNaN(d) ? '' : Utilities.formatDate(d, Session.getScriptTimeZone(), "EEE MMM d '·' h:mm a");
}

function acctKey_(a) { return (a.conn_id || (a.org && (a.org.domain || a.org.name)) || 'x') + '|' + a.id; }

function recordErrors_(data, added) {
  var msgs = [];
  (data.errlist || []).forEach(function (e) { if (e && e.msg) msgs.push(e.msg); });
  if (!msgs.length) (data.errors || []).forEach(function (e) { if (e) msgs.push(String(e)); });
  setSetting_('lastSync', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm"));
  setSetting_('lastSyncMsg', msgs.join(' | '));
  setSetting_('lastSyncAdded', String(added));
}

function tidyName_(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s && s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b([a-z])/g, function (x) { return x.toUpperCase(); });
  }
  return s.slice(0, 60);
}

/* One row in the SyncLog tab per sync, newest at the bottom; only the last 500 are kept. */
function logSync_(data, how, added, cardFor, nowStamp) {
  var names = {};
  readTable_('BankAccounts').forEach(function (r) { names[r.id] = r.nick || r.name; });
  var banks = (data.accounts || []).filter(function (a) { return cardFor[acctKey_(a)]; }).map(function (a) {
    return (names[acctKey_(a)] || a.name) + ': ' + (stamp_(a['balance-date']) || 'no time given');
  }).join('  |  ');
  appendRows_('SyncLog', [{ id: 'sync_' + Date.now(), at: nowStamp, how: how || 'Automatic', added: added, banks: banks }]);
  var sh = sheet_('SyncLog'), extra = sh.getLastRow() - 1 - 500;
  if (extra > 0) sh.deleteRows(2, extra);
}

function syncBank_(how) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var tz = Session.getScriptTimeZone();
    var startStr = getSetting_('syncStart');
    var startMs = startStr ? new Date(startStr + 'T00:00:00').getTime() : Date.now() - 30 * 864e5;
    // SimpleFIN allows at most 90 days per request; look back 45 days (overlap catches late posts)
    var fromMs = Math.max(startMs, Date.now() - 45 * 864e5);
    var data = sfFetch_('version=2&pending=1&start-date=' + Math.floor(fromMs / 1000));
    var nowStamp = stamp_(new Date());
    saveAccounts_(data);
    var partners = {};
    try { partners = transferPartners_(data); } catch (e) { console.error('Transfer matching failed: ' + (e.message || e)); }

    var cardFor = {};
    readTable_('BankAccounts').forEach(function (r) { if (r.cardId) cardFor[r.id] = r.cardId; });
    var seen = {};
    readTable_('Imported').forEach(function (r) { seen[r.id] = true; });
    var charges = readTable_('Charges');
    var order = charges.reduce(function (mx, r) { return Math.max(mx, +r.order || 0); }, 0);

    var newCharges = [], newImported = [], pending = [], newChecking = [], checkPending = [];
    var oldPending = {};
    readTable_('Pending').forEach(function (r) { oldPending[r.bankId] = r; });
    (data.accounts || []).forEach(function (a) {
      var key = acctKey_(a), cardId = cardFor[key], asOf = stamp_(a['balance-date']);
      if (!cardId) return;                                  // not matched to a card yet
      if (cardId === 'checking') {                          // your own checking account (My Money)
        (a.transactions || []).forEach(function (t) {
          if (t.pending) {                                  // only used to show "M&T shows it pending"
            var pa = Math.round(parseFloat(t.amount) * 100) / 100;
            var pm = ((t.transacted_at || t.posted) || 0) * 1000;
            if (pa) checkPending.push({ id: 'cp|' + key + '|' + t.id, amount: pa, name: tidyName_(t.payee || t.description || ''),
                                        date: Utilities.formatDate(new Date(pm || Date.now()), tz, 'yyyy-MM-dd') });
            return;
          }
          var ck = key + '|' + t.id;
          if (seen[ck]) return;
          var cMs = ((t.transacted_at || t.posted) || 0) * 1000;
          if (cMs && cMs < startMs) return;
          var amt = Math.round(parseFloat(t.amount) * 100) / 100;   // + money in, - money out
          if (!amt) return;
          var cDate = Utilities.formatDate(new Date(cMs || Date.now()), tz, 'yyyy-MM-dd');
          var desc = t.payee || t.description || '';
          var looksLikeTransfer = /transfer|xfer|online banking|to sav|savings|ally|zelle|venmo|cash app|paypal|withdraw|payment|epay|autopay|amex|american express|capital one|discover|chase|citi|synchrony|barclay|card svc|crd pmt/i.test((t.description || '') + ' ' + desc);
          seen[ck] = true;
          newImported.push({ id: ck, date: cDate, amount: amt, cardId: 'checking' });
          newChecking.push({ id: ck, date: cDate, name: tidyName_(desc), amount: amt,
                             kind: amt > 0 || looksLikeTransfer ? '' : 'spend', pairId: '', period: '', order: ++order, other: partners[ck] || '',
                             addedAt: nowStamp, bankAsOf: asOf });
        });
        return;
      }
      (a.transactions || []).forEach(function (t) {
        var tkey = key + '|' + t.id;
        if (t.pending) {                                    // shown separately until it posts
          var pAmt = Math.round(-parseFloat(t.amount) * 100) / 100;
          if (!pAmt) return;
          var pMs = ((t.transacted_at || t.posted) || 0) * 1000;
          var old = oldPending[tkey];
          if (old) old.stillPending = true;
          pending.push({ id: 'pd|' + tkey, cardId: cardId, item: tidyName_(t.payee || t.description || ''), amount: pAmt,
                         who: old ? old.who : '', hold: old ? !!old.hold : false,
                         date: pMs ? Utilities.formatDate(new Date(pMs), tz, 'yyyy-MM-dd') : '', bankId: tkey });
          return;
        }
        if (seen[tkey]) return;                             // already imported once, never again
        var whenMs = ((t.transacted_at || t.posted) || 0) * 1000;
        if (whenMs && whenMs < startMs) return;             // before your chosen start date
        var amount = Math.round(-parseFloat(t.amount) * 100) / 100;   // purchases come in negative
        var desc = t.payee || t.description || '';
        var date = Utilities.formatDate(new Date(whenMs || Date.now()), tz, 'yyyy-MM-dd');
        seen[tkey] = true;
        newImported.push({ id: tkey, date: date, amount: amount, cardId: cardId });
        // paying the card off: look at both the description and the payee (Target's feed names the payee "Target"
        // and words the payment differently, so a $109.45 payment came in as a refund on Oct 26)
        if (amount < 0 && /payment|paymt|pymnt|pymt|\bpmt\b|autopay|auto pay|thank you|online transfer|ach credit/i.test((t.description || '') + ' ' + (t.payee || ''))) return;
        if (!amount) return;
        newCharges.push({ id: 'bk_' + Utilities.getUuid().slice(0, 12), cardId: cardId, item: tidyName_(desc),
                          amount: amount, who: '', order: ++order, date: date, bankId: tkey, addedAt: nowStamp, bankAsOf: asOf });
      });
    });
    // a pending charge that just posted keeps the person and hold you gave it (same card, same amount, within 10 days)
    var gone = Object.keys(oldPending).map(function (k) { return oldPending[k]; })
      .filter(function (p) { return !p.stillPending && (p.who || p.hold); });
    newCharges.forEach(function (c) {
      for (var i = 0; i < gone.length; i++) {
        var p = gone[i];
        if (p.used || p.cardId !== c.cardId || Math.abs(+p.amount - c.amount) > 0.005) continue;
        if (p.date && c.date && Math.abs(new Date(c.date) - new Date(p.date)) > 10 * 864e5) continue;
        p.used = true; c.who = p.who || ''; if (p.hold) c.hold = true;
        break;
      }
    });
    appendRows_('Charges', newCharges);
    appendRows_('Checking', newChecking);
    try { fillOther_(partners); } catch (e) { console.error('Transfer names failed: ' + (e.message || e)); }
    appendRows_('Imported', newImported);
    rewriteTable_('Pending', pending);
    rewriteTable_('CheckPending', checkPending);
    try { mirrorJoint_(data, tz, partners); } catch (e) { console.error('Joint checking copy failed: ' + (e.message || e)); }
    // yes/no only (never the passcode): lets Claude confirm Script Properties is set up before updating the web app
    try { setSetting_('passcodeReady', PASSCODE && PASSCODE !== 'change-me' ? 'yes' : 'no'); } catch (e) {}
    recordErrors_(data, newCharges.length + newChecking.length);
    try { logSync_(data, how, newCharges.length + newChecking.length, cardFor, nowStamp); } catch (e) { console.error('Sync log failed: ' + (e.message || e)); }
    return { added: newCharges.length + newChecking.length };
  } finally {
    lock.releaseLock();
  }
}

/*
 * Joint checking (preview feature): keeps a copy of the joint account's recent lines, posted and pending,
 * in the JointBank tab. It is rewritten on every sync; the Joint page shows it, and your answers are kept in
 * JointKinds so they survive the rewrite. The joint account is the one named in the jointAccount
 * setting, or else the unmatched account whose name has both "joint" and "check" in it.
 */
function jointAccountKey_() {
  var set = getSetting_('jointAccount');
  if (set) return set;
  var hit = readTable_('BankAccounts').filter(function (r) { return !r.cardId && /joint/i.test(r.name) && /check/i.test(r.name); })[0];
  return hit ? hit.id : '';
}

function mirrorJoint_(data, tz, partners) {
  partners = partners || {};
  var jk = jointAccountKey_();
  if (!jk) return;
  var rows = [];
  (data.accounts || []).forEach(function (a) {
    if (acctKey_(a) !== jk) return;
    (a.transactions || []).forEach(function (t) {
      var amt = Math.round(parseFloat(t.amount) * 100) / 100;   // + money in, - money out
      if (!amt) return;
      var ms = ((t.transacted_at || t.posted) || 0) * 1000;
      rows.push({ id: 'jb|' + jk + '|' + t.id, date: Utilities.formatDate(new Date(ms || Date.now()), tz, 'yyyy-MM-dd'),
                  name: tidyName_(t.payee || t.description || ''), amount: amt, pending: !!t.pending, other: partners[jk + '|' + t.id] || '' });
    });
  });
  rows.sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : 0; });
  rewriteTable_('JointBank', rows);
}

/*
 * Transfers between your own accounts: works out which account each transfer went to or came from, so the app
 * can show "To Joint savings" (your nickname) instead of the bank's "Transfer to Savings Account".
 * 1. The description names the other account's last 4 digits ("Transfer from Savings 0763").
 * 2. Otherwise the same amount shows up the other way round in another linked account within 3 days,
 *    and at least one side reads like a transfer or payment (so a purchase never gets a name by chance).
 * Returns { '<account key>|<transaction id>': '<other account key>' } for posted transactions.
 */
function transferPartners_(data) {
  var accts = data.accounts || [], last4 = {}, txns = [], out = {};
  var XFER = /transfer|xfer|trnsfr|to sav|from sav|savings|online banking|from check|to check|from chk|to chk|payment|pmt|epay|autopay|ally|deposit/i;
  accts.forEach(function (a) { var m = String(a.name || '').match(/\((\d{4})\)/); if (m) last4[m[1]] = acctKey_(a); });
  accts.forEach(function (a) {
    var key = acctKey_(a);
    (a.transactions || []).forEach(function (t) {
      if (t.pending) return;
      var amt = Math.round(parseFloat(t.amount) * 100) / 100;
      if (!amt) return;
      var desc = (t.description || '') + ' ' + (t.payee || '');
      txns.push({ id: key + '|' + t.id, acct: key, amt: amt, ms: ((t.transacted_at || t.posted) || 0) * 1000, desc: desc, xfer: XFER.test(desc) });
    });
  });
  txns.forEach(function (x) {                                   // 1. last 4 digits in the description
    if (!x.xfer) return;                                        // (a store number never counts)
    var digits = x.desc.match(/\b\d{4}\b/g) || [];
    for (var i = 0; i < digits.length; i++) {
      var other = last4[digits[i]];
      if (other && other !== x.acct) { out[x.id] = other; return; }
    }
  });
  txns.sort(function (a, b) { return a.ms - b.ms; });
  var used = {};
  txns.forEach(function (x) {                                   // 2. the matching other half of the transfer
    if (used[x.id]) return;
    var best = null, bestGap = 3 * 864e5 + 1;
    txns.forEach(function (y) {
      if (used[y.id] || y.acct === x.acct || Math.abs(y.amt + x.amt) > 0.005 || !(x.xfer || y.xfer)) return;
      if (out[x.id] && out[x.id] !== y.acct) return;             // the digits already named the other account
      var gap = Math.abs(y.ms - x.ms);
      if (gap < bestGap) { best = y; bestGap = gap; }
    });
    if (!best) return;
    used[x.id] = used[best.id] = true;
    out[x.id] = out[x.id] || best.acct;
    out[best.id] = out[best.id] || x.acct;
  });
  return out;
}

/** Names the other account on checking lines brought in before this was worked out (only fills blanks). */
function fillOther_(partners) {
  readTable_('Checking').forEach(function (r) {
    if (!r.other && !r.manual && partners[r.id]) upsert_('Checking', { id: r.id, other: partners[r.id] });
  });
}

/** Replaces everything in a tab (below the header) with these rows. */
function rewriteTable_(table, rows) {
  var sh = sheet_(table), cols = TABLES[table], last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  appendRows_(table, rows);
}

function appendRows_(table, rows) {
  if (!rows.length) return;
  var sh = sheet_(table), cols = TABLES[table];
  var data = rows.map(function (r) { return cols.map(function (c) { return toCell_(c, r[c]); }); });
  sh.getRange(sh.getLastRow() + 1, 1, data.length, cols.length).setValues(data);
}

/* ---------------------------------------------------------------- first run */

function ensureSetup_() {
  Object.keys(TABLES).forEach(sheet_);
  ensureBackupTrigger_();
  if (props_().getProperty('SIMPLEFIN_ACCESS') && props_().getProperty('SYNC_AT') !== SYNC_SCHEDULE) ensureSyncTrigger_();
  var settings = readTable_('Settings');
  var seeded = settings.some(function (s) { return s.id === 'seeded'; });
  if (!seeded) {
    seed_();
    upsert_('Settings', { id: 'seeded', value: 'yes' });
  }
}

function seed_() {
  var n = 0;
  function id(p) { n++; return p + '_' + n; }
  function add(table, rows) {
    var sh = sheet_(table);
    var cols = TABLES[table];
    var data = rows.map(function (r) { return cols.map(function (c) { return toCell_(c, r[c]); }); });
    if (data.length) sh.getRange(sh.getLastRow() + 1, 1, data.length, cols.length).setValues(data);
  }

  // Cards and their charges
  var cards = [
    ['Amex', 'blue', [['Apple', 10.86, 'Joint'], ['Apple', 3.80, 'Joint'], ['Roku', 13.99, 'Joint']]],
    ['Disney Inspire', 'violet', [
      ['7 Brew', 8.59, 'Arianna'], ['Vending', 1.50, 'Eric'], ['Burger King', 19.54, 'Eric'], ["BJ's", 76.60, 'Split'],
      ['Target', 16.20, 'Joint'], ["BJ's", 57.14, 'Split'], ['Walmart', 124.19, 'Joint'], ['Aldi', 55.67, 'Joint'],
      ['Wegmans', 85.39, 'Joint'], ["Trader Joe's", 25.66, 'Joint'], ['7 Brew', 8.59, 'Arianna'], ['7 Brew', 8.59, 'Arianna'],
      ['Scholastic', 11.95, 'Joint'], ['Clarence', 10.00, 'Joint'], ['Scholastic', 20.00, 'Eric'], ['Scholastic', 20.00, 'Arianna'],
      ['Pets Best', 15.20, 'Joint'], ['Cloudflare', 10.46, 'Eric'], ['Scholastic', 10.86, 'Joint'], ['Tops', 26.49, 'Split'],
      ['7 Brew', 8.59, 'Arianna'], ['Vending', 1.50, 'Eric'], ['Panera', 8.14, 'Split'], ['Vending', 1.50, 'Eric'],
      ['Kin Pin', 19.35, 'Eric'], ['Mighty', 33.08, 'Split'], ['Hulu', 32.99, 'Bills'], ['China', 30.24, 'Split'],
      ['7 Brew', 8.59, 'Arianna'], ['Put', 9.99, 'Joint'], ['7 Brew', 8.59, 'Arianna'], ['Vending', 1.50, 'Eric'],
      ['Walgreens', 14.33, 'Eric'], ['HomeGoods', 22.82, 'Arianna'], ["Dickey's", 39.79, 'Split'],
      ['Brello (savings)', 399.00, 'Eric'], ['eBay', 5.49, 'Eric']]],
    ['Disney', 'green', [
      ['Chewy', 46.94, 'Bills'], ['Tims', 3.14, 'Eric'], ['Giancarlo', 106.30, 'Arianna'], ['Shear', 30.89, 'Joint'],
      ['PetSmart', 84.83, 'Joint'], ['Apple', 19.99, 'Bills'], ['Bucks', 8.27, 'Arianna'], ['TJ Maxx', 32.59, 'Joint'],
      ['Apple', 7.60, 'Joint'], ['Tims', 3.80, 'Eric'], ['Apple', 3.25, 'Joint'], ['Tims', 3.80, 'Eric'],
      ['Bucks', 14.19, 'Split'], ['DQ', 20.72, 'Split'], ['Tims', 4.80, 'Eric'], ['Apple', 2.99, 'Joint'],
      ['Tims', 10.22, 'Eric']]],
    ['Amazon', 'orange', [['Credit (no label)', -12.99, 'Joint'], ['Stocking', 7.02, 'Joint'], ['Dad birthday', 41.90, 'Joint']]],
    ['Target', 'rose', [['Containers', 64.69, 'Joint'], ['Containers', 44.76, 'Joint']]],
    ['Apple', 'slate', []]
  ];
  var cardRows = [], chargeRows = [];
  cards.forEach(function (c, i) {
    var cid = id('card');
    cardRows.push({ id: cid, name: c[0], color: c[1], paid: false, order: i + 1 });
    c[2].forEach(function (ch, j) {
      chargeRows.push({ id: id('ch'), cardId: cid, item: ch[0], amount: ch[1], who: ch[2], order: j + 1 });
    });
  });
  add('Cards', cardRows);
  add('Charges', chargeRows);

  add('Joint', [['Joint budget', 250], ['Groceries', 270], ['Dance', 50], ['Matteo', 45], ['Extra', 0]]
    .map(function (j, i) { return { id: id('j'), item: j[0], amount: j[1], order: i + 1 }; }));

  var bills = [
    ['1st', 'Gas', 143, 143], ['1st', 'Electric', 442, 442], ['1st', 'Mortgage', 2180, 1205, 'Ferris covers the rest'],
    ['1st', 'Arianna phone', 90, 90], ['1st', 'Food', 270, 270], ['1st', 'Savings', 80, 80],
    ['1st', 'Giovanna 529', 20, 20], ['1st', 'Disney', 394, 394], ['1st', 'HOA', 200, 200], ['1st', 'Dance', 50, 50],
    ['1st', 'Jeep', 436, 436], ['1st', 'Extra', 252, 252], ['1st', 'Hulu', 32.99, 32.99],
    ['15th', 'Truck', 436, 436], ['15th', 'Chewy', 47, 47], ['15th', 'Food', 270, 270],
    ['15th', 'Spectrum/Verizon', 175, 175, 'Spectrum is 95'], ['15th', 'Extra', 252, 252], ['15th', 'Spotify', 20, 20],
    ['15th', 'Insurance', 146, 146], ['15th', 'Savings', 80, 80], ['15th', 'Dance', 50, 50], ['15th', 'Disney', 394, 394],
    ['15th', 'Ring', 11, 11], ['15th', 'Alarm', 27, 27, '162 in July'], ['15th', 'Best Buy', 73, 73],
    ['15th', 'Giovanna 529', 20, 20]
  ];
  add('Bills', bills.map(function (b, i) {
    return { id: id('b'), payOn: b[0], name: b[1], total: b[2], us: b[3], paid: false, note: b[4] || '', order: i + 1, status: '' };
  }));

  var funds = [
    ['Disney', 'violet', [['2026-07-02', '', 370], ['2026-07-21', '', 394], ['2026-07-31', '', 394],
      ['2026-08-17', '', -873.77], ['2026-08-17', '', -164.57], ['2026-08-17', '', 394], ['2026-08-31', '', 394],
      ['2026-09-11', '', 394], ['2026-09-16', '', -164.57], ['2026-09-16', '', -481.49], ['2026-10-13', '', 394]]],
    ['Kids Christmas', 'rose', [['', 'Giovanna', 700]]],
    ['Arianna', 'orange', []], ['GSA', 'green', []], ['Summer Checks', 'gold', []], ['Part Check', 'slate', []]
  ];
  var fundRows = [], entryRows = [];
  funds.forEach(function (f, i) {
    var fid = id('f');
    fundRows.push({ id: fid, name: f[0], color: f[1], order: i + 1 });
    f[2].forEach(function (e, j) {
      entryRows.push({ id: id('fe'), fundId: fid, date: e[0], note: e[1], amount: e[2], order: j + 1 });
    });
  });
  add('Funds', fundRows);
  add('FundEntries', entryRows);

  var people = [
    ['Giovanna', 500, [['Disney', 120.31], ['Disney', 54.36], ['Bedtime', 44.02], ['Gift', 38.03], ['Gift', 91.34],
      ['Gift', 140.72], ['Return', -38]]],
    ['Matteo', 500, [['Gift', 88.33], ['Gift', 41.31], ['Ladybug', 10.86], ['Gift', 141.32], ['Gift', 38.03], ['Gift', 4.34]]],
    ['Angela & Tom', 100, []], ['Leanne', 50, []], ['Alba & Rocco', 200, []], ['My parents', 100, []],
    ['Aunts', 50, []], ['Cecelia & Derek', 50, [['Lululemon', 43.98]]], ['Logan & Lucas', 50, []],
    ['Marley & Patrick', 50, []]
  ];
  var personRows = [], giftRows = [];
  people.forEach(function (p, i) {
    var pid = id('p');
    personRows.push({ id: pid, name: p[0], budget: p[1], order: i + 1 });
    p[2].forEach(function (g, j) { giftRows.push({ id: id('g'), personId: pid, item: g[0], amount: g[1], order: j + 1 }); });
  });
  add('People', personRows);
  add('Gifts', giftRows);

  add('Settings', [{ id: 'christmasBudget', value: '1500' }]);
}