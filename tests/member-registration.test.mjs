import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMemberRegistration} from '../lib/member-registration.ts';
test('a member can register using just a name or just a phone',()=>{
 assert.deepEqual(parseMemberRegistration({name:' 王女士 '}),{name:'王女士',phone:'',note:''});
 assert.deepEqual(parseMemberRegistration({phone:'138-0000-0000'}),{name:'13800000000',phone:'13800000000',note:''});
 assert.throws(()=>parseMemberRegistration({name:' ',phone:''}));
 assert.throws(()=>parseMemberRegistration({phone:'abcde'}));
 assert.throws(()=>parseMemberRegistration({phone:'-----'}));
 assert.throws(()=>parseMemberRegistration({phone:'12345'}));
});
