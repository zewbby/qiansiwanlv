import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const raw=await new Promise(resolve=>{let s='';if(process.stdin.isTTY){process.stdin.setRawMode(true);process.stderr.write('Ready for hidden migration snapshot.\n');}process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{s+=chunk;if(/[\r\n]/.test(s)){if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();resolve(s);}});});
const snapshot=JSON.parse(raw);
const tables=['salon_settings','salon_members','salon_cards','salon_transactions','salon_services'];
assert.deepEqual(Object.keys(snapshot).sort(),[...tables].sort());
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;');
for(const file of ['0000_melodic_energizer.sql','0001_cold_the_twelve.sql'])sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
const sql=[];
const literal=value=>{if(value===null)return 'NULL';if(typeof value==='boolean')return value?'1':'0';if(typeof value==='number'){assert.ok(Number.isSafeInteger(value));return String(value);}assert.equal(typeof value,'string');return "CAST(X'"+Buffer.from(value,'utf8').toString('hex')+"' AS TEXT)";};
function insert(table,row){const columns=sqlite.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);assert.deepEqual(Object.keys(row).sort(),[...columns].sort());
 const statement='INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(c=>literal(row[c])).join(',')+');';sqlite.exec(statement);sql.push(statement);}
for(const table of ['salon_settings','salon_members','salon_services'])for(const row of snapshot[table])insert(table,row);
for(const row of snapshot.salon_cards)insert('salon_cards',{...row,cash_balance_cents:0,gift_balance_cents:0,balance_cents:0,version:0});
// Replaying the original immutable ledger preserves all guards and reconstructs balances.
for(const row of [...snapshot.salon_transactions].sort((a,b)=>a.card_id.localeCompare(b.card_id)||a.card_version-b.card_version))insert('salon_transactions',row);
const canonical=rows=>JSON.stringify(rows.map(r=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
const manifests={};for(const table of tables){const got=sqlite.prepare('SELECT * FROM '+table).all();assert.equal(canonical(got),canonical(snapshot[table]),'Migration differs: '+table);manifests[table]={count:got.length,sha256:createHash('sha256').update(canonical(got)).digest('hex')};}
mkdirSync('work/owned-cloud',{recursive:true});writeFileSync('work/owned-cloud/import.sql',sql.join('\n')+'\n',{mode:0o600});
writeFileSync('work/owned-cloud/source-snapshot.json',JSON.stringify(snapshot),{mode:0o600});
writeFileSync('work/owned-cloud/verification.json',JSON.stringify(manifests,null,2));
console.log(JSON.stringify({verified:true,tables:Object.fromEntries(Object.entries(manifests).map(([k,v])=>[k,v.count])),totalBalanceCents:snapshot.salon_cards.reduce((s,r)=>s+r.balance_cents,0)}));
