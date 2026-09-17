import {describe,it,expect} from 'vitest';
import * as payment from '../src/lib/payment-polling';

describe('payment recovery decisions',()=>{
 it('reopens an unlocked report without offering payment',()=>{
  expect(typeof payment.recoveryAction).toBe('function');
  expect(payment.recoveryAction('unlocked','included','a'.repeat(64))).toBe('open_report');
 });
 it('uses an existing hash to verify rather than offering payment',()=>{
  expect(typeof payment.recoveryAction).toBe('function');
  expect(payment.recoveryAction('awaiting_payment','not_started','a'.repeat(64))).toBe('verify_payment');
 });
 it('never offers payment for a pending purchase whose receipt must be recovered',()=>{
  expect(typeof payment.recoveryAction).toBe('function');
  expect(payment.recoveryAction('awaiting_payment','pending','')).toBe('recover_hash');
 });
 it('offers a first payment only for an unsubmitted intent',()=>{
  expect(typeof payment.recoveryAction).toBe('function');
  expect(payment.recoveryAction('awaiting_payment','not_started','')).toBe('new_payment');
 });
 it('blocks payment when a receipt was entered but is malformed',()=>{
  expect(payment.recoveryAction('awaiting_payment','not_started','invalid-hash')).toBe('recover_hash');
 });
 it('requires reloading after the user changes the report ID',()=>{
  expect(payment.recoveryAction('awaiting_payment','not_started','','original','edited')).toBe('reload_report');
 });
});

describe('local transfer receipt recovery',()=>{
 const storage=()=>{const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};};
 it('keeps a returned hash across a client restart without storing wallet secrets',()=>{
  expect(typeof payment.persistPaymentReceipt).toBe('function');
  const disk=storage();
  payment.persistPaymentReceipt(disk,'report','purchase','a'.repeat(64),1000);
  expect(payment.recoverPaymentReceipt(disk,'report','purchase',2000)).toBe('a'.repeat(64));
  expect(payment.recoverPaymentReceipt(disk,'report','other-purchase',2000)).toBe('');
 });
 it('rejects a receipt after ninety days',()=>{
  expect(typeof payment.persistPaymentReceipt).toBe('function');
  const disk=storage();
  payment.persistPaymentReceipt(disk,'report','purchase','a'.repeat(64),1000);
  expect(payment.recoverPaymentReceipt(disk,'report','purchase',1000+90*86400000)).toBe('');
  expect(disk.getItem('dwellence-payment:report')).toBeNull();
 });
 it('does not accept an invalid native transaction hash as a durable receipt',()=>{
  expect(typeof payment.persistPaymentReceipt).toBe('function');
  expect(()=>payment.persistPaymentReceipt(storage(),'report','purchase','not-a-hash',1000)).toThrow();
 });
});
