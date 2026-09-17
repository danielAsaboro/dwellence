import {describe,it,expect} from 'vitest';
import {createStore} from '../server/store.mjs';
import {createApp} from '../server/app.mjs';
import {sha256} from '../server/security.mjs';

// Controlled software fixtures only; never deployed or counted as field evidence.
async function scenario(state,lookup,run){
 const store=createStore(':memory:');
 const now=Date.now();
 store.prepare('INSERT INTO sessions (token_digest,wallet_address,role,expires_at,created_at) VALUES (?,?,?,?,?)').run(sha256('owner-token'),'owner','seeker',now+60000,now);
 store.prepare('INSERT INTO sessions (token_digest,wallet_address,role,expires_at,created_at) VALUES (?,?,?,?,?)').run(sha256('other-token'),'other','seeker',now+60000,now);
 store.prepare('INSERT INTO requests (id,seeker_address,invited_contributor,location_ciphertext,public_cell,window_starts_at,window_ends_at,price_luna,share_code,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('req','owner','contributor','test-only','0.00,0.00',now,now+60000,1000,'inv','submitted',now);
 store.prepare('INSERT INTO reports (id,request_id,seeker_address,contributor_address,price_luna,preview_json,report_json,scorer_version,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('report','req','owner','contributor',1000,'{"categories":["connectivity"]}','{"areaCell":"0.00,0.00"}','test',state==='included'?'unlocked':'awaiting_payment',now);
 store.prepare('INSERT INTO purchases (id,report_id,seeker_address,contributor_address,expected_luna,reference,transaction_hash,state) VALUES (?,?,?,?,?,?,?,?)').run('purchase','report','owner','contributor',1000,'rep:fixture',state==='not_started'?null:'a'.repeat(64),state);
 const app=createApp({store,locationEncryptionKey:'test-only-recovery-key-long-enough',transactionLookup:lookup});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const request=async(path,token='owner-token',body)=>{const response=await fetch(`http://127.0.0.1:${app.address().port}${path}`,{headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
 try{await run(request,store);}finally{await new Promise(resolve=>app.close(resolve));store.close();}
}
describe('authenticated report purchase recovery',()=>{
 it('returns the saved pending hash to the owner, not another wallet',async()=>{
  await scenario('pending',async()=>null,async request=>{
   const result=await request('/api/reports/report/preview');
   expect(result.body.purchase).toEqual({id:'purchase',reference:'rep:fixture',recipient:'contributor',valueLuna:1000,state:'pending',transactionHash:'a'.repeat(64)});
   expect((await request('/api/reports/report/preview','other-token')).status).toBe(404);
  });
 });
 it('identifies an already unlocked report so the owner can reopen without an intent',async()=>{
  await scenario('included',async()=>null,async request=>{
   expect((await request('/api/reports/report/preview')).body.reportState).toBe('unlocked');
   expect((await request('/api/reports/report')).status).toBe(200);
  });
 });
 it('retains a submitted hash even when canonical lookup is unavailable',async()=>{
  await scenario('not_started',async()=>{throw new Error('RPC offline');},async request=>{
   expect((await request('/api/purchases/purchase/verify','owner-token',{transactionHash:'b'.repeat(64)})).status).toBe(503);
   const recovered=await request('/api/reports/report/preview');
   expect(recovered.body.purchase.transactionHash).toBe('b'.repeat(64));
   expect(recovered.body.purchase.state).toBe('pending');
  });
 });
 it('does not replace an included purchase with a different transfer hash',async()=>{
  await scenario('included',async()=>null,async(request,store)=>{
   expect((await request('/api/purchases/purchase/verify','owner-token',{transactionHash:'b'.repeat(64)})).status).toBe(409);
   expect(store.prepare('SELECT state,transaction_hash FROM purchases WHERE id = ?').get('purchase')).toMatchObject({state:'included',transaction_hash:'a'.repeat(64)});
  });
 });
});
