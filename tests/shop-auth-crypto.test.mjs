import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordHash,sameHash,sessionToken,digest} from '../lib/shop-auth-crypto.ts';
test('password verifier includes salt and server-only pepper and rejects wrong passwords',async()=>{
 const salt='01'.repeat(32),pepper='synthetic-server-pepper-test-only-'.repeat(2);
 const valid=await passwordHash('SyntheticOnly!123',salt,pepper);
 assert.equal(valid.length,64);
 assert.ok(sameHash(valid,await passwordHash('SyntheticOnly!123',salt,pepper)));
 assert.ok(!sameHash(valid,await passwordHash('wrong-password',salt,pepper)));
 assert.ok(!sameHash(valid,await passwordHash('SyntheticOnly!123','02'.repeat(32),pepper)));
 assert.ok(!sameHash(valid,await passwordHash('SyntheticOnly!123',salt,pepper+'changed')));
 assert.ok(!sameHash(valid,''));
});
test('session tokens are independent 256-bit values and the database receives only a digest',async()=>{
 const a=sessionToken(),b=sessionToken();assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,b);assert.notEqual(a,await digest(a));assert.equal(await digest(a),await digest(a));
});
