import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEmployeeCsvLocally, employeeCsvDiagnosticReport, FICTIONAL_EMPLOYEE_CSV } from '../src/lib/public-employee-csv-preflight.mjs';

const analyze = csv => checkEmployeeCsvLocally(csv);

test('fictional sample has two rows and no issues', () => {
  assert.deepEqual(analyze(FICTIONAL_EMPLOYEE_CSV), { totalRows: 2, issues: [], missingColumns: [], unrecognizedColumns: 0 });
});

test('BOM, CRLF, escaped quotes, and quoted newline preserve source lines', () => {
  const csv = '\uFEFFEmployee No,First Name,Last Name,Start Date,Monthly Basic,Region\r\n' +
    'A,"Alex ""Sample""",Reyes,2026-10-01,18000,NCR\r\n' +
    'B,"Multiline\r\nName",Garcia,2026-10-02,20000,NCR\r\n' +
    'A,Alex,Garcia,2026-10-03,21000,NCR\r\n';
  const result = analyze(csv);
  assert.equal(result.totalRows, 3);
  assert.deepEqual(result.issues.filter(x=>x.field==='employeeNo').map(x=>x.row), [5]);
});

test('detects missing and duplicate canonical headers', () => {
  const csv = 'Employee No,employee_no,First Name,Last Name,Start Date,Region\nA,A,Alex,Reyes,2026-01-01,NCR';
  const result = analyze(csv);
  assert.ok(result.issues.some(x => x.field === 'employeeNo' && /Multiple/.test(x.message)));
  assert.ok(result.missingColumns.includes('monthlyBasic'));
});

test('detects field count, missing values, bad amounts and repeated ids without emitting source', () => {
  const csv = 'Employee No,First Name,Last Name,Start Date,Monthly Basic,Region\nSECRET123,A,,2026-02-30,abc,NCR\nsecret123,B,C,2026-02-01,18000,NCR,EXTRA';
  const result = analyze(csv);
  assert.ok(result.issues.some(x=>x.field==='monthlyBasic'&&x.row===2));
  assert.ok(result.issues.some(x=>x.field==='lastName'&&x.row===2));
  assert.ok(result.issues.some(x=>x.field==='startDate'&&x.row===2));
  assert.ok(result.issues.some(x=>x.field==='employeeNo'&&x.row===3));
  assert.ok(result.issues.some(x=>x.field==='row'&&x.row===3));
  assert.ok(!JSON.stringify(result).includes('SECRET123'));
  assert.ok(!employeeCsvDiagnosticReport(result).includes('SECRET123'));
});

test('malformed CSV is rejected without echoing cell contents', () => {
  const result = analyze('Employee No,First Name\nSECRET123,"unfinished');
  assert.equal(result.totalRows, 0);
  assert.equal(result.issues[0].severity, 'error');
  assert.ok(!JSON.stringify(result).includes('SECRET123'));
});

test('CSV formula payload never enters a downloadable diagnostic', () => {
  const csv = 'Employee No,First Name,Last Name,Start Date,Monthly Basic,Region\n"=HYPERLINK(""evil"")",Alex,Reyes,2026-10-01,18000,NCR\n"=HYPERLINK(""evil"")",Alex,Reyes,2026-10-01,18000,NCR';
  const result = analyze(csv);
  const report = employeeCsvDiagnosticReport(result);
  assert.equal(report.startsWith('row,severity,field,message'), true);
  assert.ok(!report.includes('HYPERLINK'));
  assert.ok(report.includes('Employee number repeats'));
});

test('limits total employee count', () => {
  const lines = Array.from({length:10001}, (_,i)=>`S${i},A,B,2026-10-01,12000,NCR`);
  const result = analyze('Employee No,First Name,Last Name,Start Date,Monthly Basic,Region\n'+lines.join('\n'));
  assert.equal(result.totalRows, 10001);
  assert.ok(result.issues.some(x=>/10,000/.test(x.message)));
});
