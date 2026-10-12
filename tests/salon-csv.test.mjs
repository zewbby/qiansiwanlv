import test from 'node:test';
import assert from 'node:assert/strict';
import {csvCell} from '../lib/salon-csv.ts';
test('CSV money columns preserve negative reversal numbers for correct spreadsheet totals',()=>{
 assert.equal(csvCell('-58.00',5),'"-58.00"');assert.equal(csvCell('0.01',6),'"0.01"');assert.equal(csvCell('100.00',8),'"100.00"');
});
test('CSV escapes quotes and neutralizes text formulas while preserving international phone numbers',()=>{
 assert.equal(csvCell('=1+1',1),'"\'=1+1"');assert.equal(csvCell('+8613800000000',2),'"\'+8613800000000"');assert.equal(csvCell('备注,"换行\n下一行',10),'"备注,""换行\n下一行"');
});
