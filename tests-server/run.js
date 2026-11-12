// Tests for the Google script (server/Code.js), run in Node against a stand-in for Apps Script and one made-up Sheet:
//   node tests-server/run.js                     the script with and without the Sheets service must give the same answers
//   node tests-server/run.js older-Code.js       also compares against an older copy (git show HEAD~1:server/Code.js > older-Code.js)
// It covers opening (tab by tab and in one trip), saving, the bank sync, the read check and the monthly tidy-up.
// The stand-in is a model of Google, not Google: the read check in the script itself is what proves the real Sheet.
const path = require('path');
const { makeWorld } = require('./fakegas.js');
const NEW = path.join(__dirname, '..', 'server', 'Code.js'), OLD = process.argv[2] ? path.resolve(process.argv[2]) : NEW;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const now = Date.now(), day = n => new Date(now - n * 864e5).toISOString().slice(0, 10), sec = n => Math.floor((now - n * 864e5) / 1000);

function sheet(w, name) { return w.ss.getSheetByName(name); }
function addRows(w, name, rows) { const sh = sheet(w, name); rows.forEach(r => sh.data.push(r)); }
function fill(w) {
  // made-up rows, including the awkward cells: real dates, a number where text belongs, blanks, yes/no cells
  addRows(w, 'Settings', [['lastSync', new Date('2026-11-12T13:31:00Z')], ['syncStart', new Date('2026-10-01T04:00:00Z')], ['numberish', 1500], ['bankConnected', 'yes'],
    ['wrapPrev_pp1', '{"periodPay":"a"}'], ['wrapPrev_pp2', '{}'], ['wrapPrev_pp3', '{}'], ['wrapPrev_pp4', '{}'], ['wrapPrev_pp5', '{}'], ['cardLedger', '[{"id":"lg_1"}]']]);
  addRows(w, 'Periods', [1, 2, 3, 4, 5].map(i => ['pp' + i, day(20 + 14 * (6 - i)), day(7 + 14 * (6 - i)), 1900, 400, 100, 1406, 50 * i, '{}', 0, '{}']));
  addRows(w, 'Charges', [['bk_date', 'card_1', 365, 12.5, 'Eric', 900, new Date('2026-11-06T05:00:00Z'), 'b|1', true, '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''], ['bk_text', 'card_1', "=SUM(1)", -3, '', 901, '2026-11-07', '', false, 'ct:ck_1', '', '', '2026-11-08|no=x']]);
  addRows(w, 'JointBank', [0, 1, 2, 3].map(i => ['jb|j|' + i, day(3 * i), 'Store ' + i, -10 - i, i === 0, '']));
  addRows(w, 'JointKinds', [['jb|j|1', 'spend', -11, day(3)], ['jb|old|1', 'spend', -20, day(100)], ['jb|old|2', 'bill', -30, day(61)], ['jb|recent', 'move', -40, day(50)],
    ['jb|old|3', 'spend', -50, new Date(now - 200 * 864e5)], ['jb|nodate', 'spend', -60, ''], ['jb|j|3', 'ignore', -13, day(9)], ['jb|old|4', 'spend', -70, day(75)]]);
  addRows(w, 'Checking', [['ck_1', day(30), 'Old line', -5, 'spend', '', 'pp1', 1, '', false, '', 0, 0, false, '', '', ''], ['ck_2', day(2), 'New line', -6, '', '', '', 2, '', true, 'note', 0, 0, false, '', '', '']]);
  addRows(w, 'Imported', [['x|old', day(300), 5, 'card_1'], ['x|new', day(2), 6, 'card_1']]);
}
const SF = { connections: [{ conn_id: 'c1', name: 'Made Up Bank' }], accounts: [
  { id: 'A1', conn_id: 'c1', name: 'Card (1111)', balance: '-50.00', 'balance-date': sec(0), transactions: [
    { id: 't1', posted: sec(1), amount: '-21.50', description: 'COFFEE SHOP', pending: false }, { id: 't2', posted: sec(0), amount: '-8.00', description: 'PENDING PLACE', pending: true },
    { id: 't3', posted: sec(2), amount: '40.00', description: 'ONLINE PAYMENT THANK YOU', pending: false }] },
  { id: 'A2', conn_id: 'c1', name: 'My Checking (2222)', balance: '900.00', 'balance-date': sec(0), transactions: [
    { id: 'k1', posted: sec(1), amount: '1905.13', description: 'KENMORE TOWN OF PAYROLL', pending: false }, { id: 'k2', posted: sec(1), amount: '-30.00', description: 'TRANSFER TO SAVINGS 3333', pending: false }] },
  { id: 'A3', conn_id: 'c1', name: 'Joint Checking (4444)', balance: '2000.00', 'balance-date': sec(0), transactions: [
    { id: 'j1', posted: sec(1), amount: '-45.10', description: 'GROCERY', pending: false }, { id: 'j2', posted: sec(0), amount: '-9.99', description: 'PIZZA', pending: true }] },
  { id: 'A4', conn_id: 'c1', name: 'Savings (3333)', balance: '500.00', 'balance-date': sec(0), transactions: [{ id: 's1', posted: sec(1), amount: '30.00', description: 'TRANSFER FROM CHECKING', pending: false }] }] };
function linkAccounts(w) { const sh = sheet(w, 'BankAccounts'); sh.data.forEach(r => { if (r[0] === 'c1|A1') r[3] = sheet(w, 'Cards').data[1][0]; if (r[0] === 'c1|A2') r[3] = 'checking'; }); }
const noCheck = d => { d = JSON.parse(JSON.stringify(d)); d.Settings = d.Settings.filter(r => r.id !== 'readCheck'); return d; };
const dumpNoCheck = w => { const d = w.ss.dump(); d.Settings = d.Settings.filter(r => r[0] !== 'readCheck'); delete d.SyncLog; return d; };
// ids and stamps that differ run to run are evened out before comparing the two versions
const even = x => JSON.parse(JSON.stringify(x).replace(/bk_[0-9a-f-]{12}/g, 'bk_X').replace(/sync_\d+/g, 'sync_X').replace(/\d+ ms/g, 'N ms'));

const P = () => ({ PASSCODE: 'made-up-passcode', SIMPLEFIN_ACCESS: 'https://user:pass@bridge.example.invalid/simplefin' });
let o = makeWorld(OLD, { sheetsApi: false, simplefin: SF, props: P() }), n = makeWorld(NEW, { simplefin: SF, props: P() });
// 1. first open (seeds the Sheet), then the same made-up rows in both
let a = o.post('getData'), b = n.post('getData');
ok('first open: same data from old and new code', a.ok && b.ok && same(a.data, b.data));
fill(o); fill(n);
o = o.fresh(); n = n.fresh(); a = o.post('getData'); b = n.post('getData');
ok('open with awkward cells: same data (new code still tab by tab)', same(a.data, b.data) && n.batchCalls === 0);
ok('dates and numbers came through as the app expects', a.data.Settings.find(r => r.id === 'lastSync').value === '2026-11-12T08:31' && a.data.Settings.find(r => r.id === 'syncStart').value === '2026-10-01' && a.data.Settings.find(r => r.id === 'numberish').value === '1500' && a.data.Charges.find(r => r.id === 'bk_date').date === '2026-11-06' && a.data.Charges.find(r => r.id === 'bk_date').item === '365', a.data.Settings.slice(-12, -8));
// 2. saving
const ops = [{ op: 'upsert', table: 'Charges', row: { id: 'bk_text', who: 'Split' } }, { op: 'upsert', table: 'Joint', row: { id: 'j_new', item: 'Dance', amount: 50, order: 9 } },
  { op: 'remove', table: 'Gifts', id: a.data.Gifts[0].id }, { op: 'removeIds', table: 'FundEntries', ids: a.data.FundEntries.slice(0, 3).map(r => r.id) }, { op: 'upsert', table: 'Settings', row: { id: 'jointSince', value: day(5) } }];
o = o.fresh(); n = n.fresh(); ok('saving answers ok', o.post('apply', { ops }).ok && n.post('apply', { ops }).ok);
ok('after saving: the Sheets are the same', same(o.ss.dump(), n.ss.dump()));
// 3. automatic sync (twice: the first lists the accounts, then they are linked) proves the one-trip read
o = o.fresh(); n = n.fresh(); o.run('dailyBankSync'); n.run('dailyBankSync'); linkAccounts(o); linkAccounts(n);
o = o.fresh(); n = n.fresh(); o.run('dailyBankSync'); n.run('dailyBankSync');
const rc = () => (n.ss.dump().Settings.find(r => r[0] === 'readCheck') || [])[1];
ok('sync brought the same rows into both Sheets', same(even(dumpNoCheck(o)), even(dumpNoCheck(n))));
ok('…and it really synced', n.ss.dump().Charges.some(r => r[2] === 'Coffee Shop') && n.ss.dump().Checking.some(r => /Payroll/.test(r[2])) && n.ss.dump().JointBank.some(r => r[2] === 'Grocery') && n.ss.dump().Pending.length === 2, n.ss.dump().JointBank);
ok('the check passed and says so', /· same · one trip \d+ ms, tab by tab \d+ ms · asked twice \(dates\): /.test(rc()) && /^yes:/.test(n.props.READ_OK), rc());
if (OLD !== NEW) ok('old code has no readCheck row', !o.ss.dump().Settings.some(r => r[0] === 'readCheck'));
// 4. opening now takes one trip and gives the same data
o = o.fresh(); n = n.fresh(); o.ss.reads = 0; n.ss.reads = 0; a = o.post('getData'); b = n.post('getData');
ok('open after the check: same data as the old code', same(even(noCheck(a.data)), even(noCheck(b.data))), [a.data.Settings.length, b.data.Settings.length]);
ok('…and it came from the one-trip read', n.batchCalls >= 1 && n.batchCalls <= 2 && n.ss.reads === 0 && o.ss.reads >= 19, { batch: n.batchCalls, newReads: n.ss.reads, oldReads: o.ss.reads });
const tripsOld = o.ss.reads, tripsNew = n.batchCalls;
// 5. an empty tab and a tab with only a header
n = n.fresh(); sheet(n, 'CheckPending').data = []; sheet(n, 'Rules').data = [['id', 'kind']]; b = n.post('getData');
ok('empty tabs read as empty', b.ok && same(b.data.CheckPending, []) && same(b.data.Rules, []) && n.batchCalls >= 1);
sheet(n, 'CheckPending').data = [['id', 'date', 'name', 'amount']];
// 6. the service answers wrongly: the check turns it off and the app reads tab by tab
n = n.fresh(); n.apiBreak = 'wrong'; n.run('dailyBankSync');
ok('a different answer is caught', /differs in Charges/.test(rc()) && /^no:/.test(n.props.READ_OK), rc());
n = n.fresh(); n.apiBreak = 'wrong'; n.ss.reads = 0; b = n.post('getData'); o = o.fresh(); o.run('dailyBankSync'); o = o.fresh(); a = o.post('getData');
ok('…then opening is tab by tab and right', n.batchCalls === 0 && n.ss.reads >= 19 && same(even(noCheck(a.data)), even(noCheck(b.data))));
n = n.fresh(); n.run('dailyBankSync'); ok('the next good check turns it back on', /^yes:/.test(n.props.READ_OK));
// 7. the service fails while the app is opening
n = n.fresh(); n.apiBreak = 'throw'; b = n.post('getData');
ok('a failure while opening falls back and still answers right', b.ok && same(even(noCheck(a.data)), even(noCheck(b.data))) && /^no:/.test(n.props.READ_OK));
// 8. the service isn't there at all
n = n.fresh(); n.sheetsApi = false; n = n.fresh(); n.run('dailyBankSync');
ok('no Sheets service: says so, stays tab by tab', /one-trip read not available/.test(rc()) && /^no:/.test(n.props.READ_OK), rc());
n = n.fresh(); b = n.post('getData'); ok('…and the app still opens', b.ok && same(even(noCheck(a.data)), even(noCheck(b.data))));
n.sheetsApi = true;
// 9. Sync now runs the check once on code it hasn't been checked on
delete n.props.READ_OK; n = n.fresh(); const before = n.batchCalls; b = n.post('bankSync');
ok('Sync now proves it when it hasn’t been checked yet', b.ok && /^yes:/.test(n.props.READ_OK) && n.batchCalls > before, [b, n.props.READ_OK, n.batchCalls, before, n.log]);
n = n.fresh(); n.post('bankSync'); ok('…and not again once checked', n.batchCalls === 0);
// 10. wrong passcode is still refused; unknown request still refused
n = n.fresh(); ok('wrong passcode refused', /^PASSCODE:/.test(n.post('getData', { key: 'nope' }).error) && /Unknown request/.test(n.post('nothing').error));
// 11. monthly: backup first, then the tidy-up
n = n.fresh(); const kindsBefore = n.ss.dump().JointKinds, impBefore = n.ss.dump().Imported, chkBefore = n.ss.dump().Checking, copies0 = n.ss.copies.length;
n.run('monthlyBackup'); const d = n.ss.dump(), ids = d.JointKinds.slice(1).map(r => r[0]);
ok('a backup copy was made first', n.ss.copies.length === copies0 + 1 && n.ss.copies[copies0].dump().JointKinds.length === kindsBefore.length);
ok('old joint answers gone, the rest kept in order', same(ids, ['jb|j|1', 'jb|recent', 'jb|nodate', 'jb|j|3'].concat(ids.slice(4))) && !ids.some(x => /jb\|old/.test(x)), ids);
ok('kept rows are untouched', same(d.JointKinds.slice(1).map(r => JSON.stringify(r)), kindsBefore.slice(1).filter(r => !/jb\|old/.test(r[0])).map(r => JSON.stringify(r))));
ok('import records and checking lines left alone', same(d.Imported, impBefore) && same(d.Checking, chkBefore));
const wp = d.Settings.map(r => r[0]).filter(x => /^wrapPrev_/.test(x));
ok('wrapPrev kept for the newest three pay periods', same(wp.sort(), ['wrapPrev_pp3', 'wrapPrev_pp4', 'wrapPrev_pp5']), wp);
ok('lastTidy says what it did', / · took out 4 old joint answers and 2 old settings$/.test((d.Settings.find(r => r[0] === 'lastTidy') || [])[1]), d.Settings.find(r => r[0] === 'lastTidy'));
ok('other settings still there', d.Settings.some(r => r[0] === 'cardLedger' && r[1] === '[{"id":"lg_1"}]') && d.Settings.some(r => r[0] === 'jointSince'));
n = n.fresh(); n.run('monthlyBackup'); ok('running it again takes nothing more', / · took out 0 old joint answers and 0 old settings$/.test(n.ss.dump().Settings.find(r => r[0] === 'lastTidy')[1]));
// 12. JointBank empty: answers are not touched
n = n.fresh(); addRows(n, 'JointKinds', [['jb|old|9', 'spend', -1, day(90)]]); const jb = sheet(n, 'JointBank').data; sheet(n, 'JointBank').data = [jb[0]];
n.run('monthlyBackup'); ok('empty bank list: no answers removed', n.ss.dump().JointKinds.some(r => r[0] === 'jb|old|9'));
sheet(n, 'JointBank').data = jb;
// 13. a write that fails part-way loses nothing that should stay
n = n.fresh(); const keepIds = n.ss.dump().JointKinds.slice(1).map(r => r[0]).filter(x => x !== 'jb|old|9');
n.ss.failNextWrite = true;
n.run('monthlyBackup'); const after13 = n.ss.dump().JointKinds.slice(1).map(r => r[0]);
ok('failed write: every row that should stay is still there', keepIds.every(x => after13.includes(x)), after13);
n = n.fresh(); n.run('monthlyBackup'); ok('…and the next run finishes the job', !n.ss.dump().JointKinds.some(r => r[0] === 'jb|old|9'));
// 14. after the tidy the app still opens the same both ways
n = n.fresh(); n.run('dailyBankSync'); ok('check still passes after the tidy', /^yes:/.test(n.props.READ_OK), rc());
console.log(`${pass} passed, ${fail} failed · trips to the Sheet to open: ${tripsOld} before, ${tripsNew} now`);
if (n.log.length || o.log.length) console.log('script console:', [...new Set(n.log.concat(o.log))].slice(0, 6));
process.exit(fail ? 1 : 0);
