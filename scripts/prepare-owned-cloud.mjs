import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';

const owned=JSON.parse(readFileSync('cloud/owned.json','utf8'));
const [accountId=owned.account_id,databaseId=owned.database_id]=process.argv.slice(2);
if(!/^[a-f0-9]{32}$/.test(accountId??'')||!/^[a-f0-9-]{36}$/.test(databaseId??''))throw Error('Use IDs returned by Cloudflare');
const root=process.cwd(),dir=path.join(root,'work','owned-cloud');mkdirSync(dir,{recursive:true});
const built=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
const config={name:owned.worker_name,account_id:accountId,main:path.join(root,'dist/server',built.main).replaceAll('\\','/'),
 compatibility_date:built.compatibility_date,compatibility_flags:built.compatibility_flags,
 no_bundle:true,rules:built.rules,workers_dev:true,preview_urls:false,
 assets:{directory:path.join(root,'dist/client').replaceAll('\\','/'),binding:'ASSETS'},
 d1_databases:[{binding:'DB',database_name:owned.database_name,database_id:databaseId}],vars:{SALON_READ_ONLY:'true'},
 observability:{enabled:true}};
writeFileSync(path.join(dir,'wrangler.json'),JSON.stringify(config,null,2)+'\n');
console.log('Own-account deploy configuration prepared. New service remains read-only until validated.');
