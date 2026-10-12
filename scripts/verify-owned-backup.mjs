import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const expected=JSON.parse(readFileSync('work/owned-cloud/verification.json','utf8'));
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=OFF;');db.exec(readFileSync('work/owned-cloud/backup.sql','utf8'));
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0,'Restored backup has foreign key errors');
const canonical=rows=>JSON.stringify(rows.map(r=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
for(const [table,want] of Object.entries(expected)){const rows=db.prepare('SELECT * FROM '+table).all();assert.equal(rows.length,want.count);assert.equal(createHash('sha256').update(canonical(rows)).digest('hex'),want.sha256);}
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'salon_%'").get().n,6,'Backup must contain ledger protection triggers');
console.log('Full SQL backup restored in memory: all business rows, balances and six ledger guards verified.');
