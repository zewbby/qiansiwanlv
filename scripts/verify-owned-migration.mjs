import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const expected=JSON.parse(readFileSync('work/owned-cloud/verification.json','utf8'));
const canonical=rows=>JSON.stringify(rows.map(r=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
for(const table of ['salon_settings','salon_members','salon_cards','salon_transactions','salon_services']) {
 const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--remote','--config','work/owned-cloud/wrangler.json','--command','SELECT * FROM '+table,'--json'],{encoding:'utf8',timeout:30000});
 if(result.status!==0)throw Error('Target verification failed: '+table);
 const pages=JSON.parse(result.stdout),rows=pages.flatMap(p=>p.results??[]);
 assert.equal(rows.length,expected[table].count,'Row count differs: '+table);
 assert.equal(createHash('sha256').update(canonical(rows)).digest('hex'),expected[table].sha256,'Rows differ: '+table);
 console.log(table+': every field and row matches source ('+rows.length+' rows)');
}
console.log('Real source and own-account database verification PASSED.');
