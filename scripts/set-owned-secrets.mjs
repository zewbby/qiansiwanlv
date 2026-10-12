import {spawn} from 'node:child_process';
import {passwordHash,sessionToken} from '../lib/shop-auth-crypto.ts';

const raw=await new Promise(resolve=>{let s='';if(process.stdin.isTTY){process.stdin.setRawMode(true);process.stderr.write('Ready for hidden shop credential.\n');}process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{s+=chunk;if(/[\r\n]/.test(s)){if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();resolve(s);}});});
const {password,ownerId}=JSON.parse(raw);
if(typeof password!=='string'||typeof ownerId!=='string'||!ownerId)throw Error('Missing credential inputs');
const salt=sessionToken(),pepper=sessionToken()+sessionToken();
const secrets={SALON_ADMIN_USERNAME:'admin',SALON_ADMIN_SALT:salt,SALON_ADMIN_HASH:await passwordHash(password,salt,pepper),SALON_AUTH_PEPPER:pepper,SALON_OWNER_ID:ownerId};
const child=spawn(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','secret','bulk','--config','work/owned-cloud/wrangler.json'],{stdio:['pipe','inherit','inherit']});
child.stdin.end(JSON.stringify(secrets));
const code=await new Promise(resolve=>child.on('exit',resolve));if(code!==0)throw Error('Secret upload did not complete');
console.log('Shop credentials stored only as server-side secrets.');
