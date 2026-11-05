import {describe,it,expect,vi}from'vitest';
import {HttpEccalEmail}from'../src/email';
import {HttpEccalQuota}from'../src/eccal-http';
import type{DeliveryJob}from'../src/contracts';
const key='CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk';
const reply=(body:unknown)=>Response.json(body,{headers:{'x-voice-contract':'eccal-voice-v1'}});
const job:DeliveryJob={id:crypto.randomUUID(),recordId:crypto.randomUUID(),documentId:crypto.randomUUID(),memberId:'a',sourceRevision:1,operationId:crypto.randomUUID(),requestFingerprint:'fixture',recipient:'fixture@example.invalid',channel:'email',verifiedAt:null,state:'pending',createdAt:Date.now()};
describe('ECCAL Email 後端契約',()=>{
  it('收件人必須對回會員，地址不合格或錯會員均拒絕',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({memberId:'a',recipient:job.recipient})).mockResolvedValueOnce(reply({memberId:'b',recipient:job.recipient})).mockResolvedValueOnce(reply({memberId:'a',recipient:'bad-address'}));
    const port=new HttpEccalQuota('https://eccal.example.test',key,fetcher);expect(await port.emailRecipient('a')).toBe(job.recipient);await expect(port.emailRecipient('a')).rejects.toMatchObject({code:'ECCAL_RESPONSE_INVALID'});await expect(port.emailRecipient('a')).rejects.toMatchObject({code:'ECCAL_RESPONSE_INVALID'});
  });
  it('verify 與 send 只傳限定工作範圍，保存有效提供者收據',async()=>{
    const receipt=crypto.randomUUID();const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({memberId:'a',jobId:job.id,documentId:job.documentId,recipient:job.recipient,verifiedAt:job.createdAt,supervised:false})).mockResolvedValueOnce(reply({outcome:'sent',receipt}));
    const port=new HttpEccalEmail('https://eccal.example.test',key,fetcher);expect((await port.verify(job,{private:'fixture-proof-not-forwarded'})).recipient).toBe(job.recipient);expect(await port.send(job,'https://fixture.invalid/#result')).toEqual({outcome:'sent',receipt});
    expect(String(fetcher.mock.calls[0]![1]?.body)).not.toContain('fixture-proof-not-forwarded');expect(String(fetcher.mock.calls[0]![1]?.body)).not.toContain('requestFingerprint');expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get('authorization')).toBe(`Bearer ${key}`);
  });
  it('錯誤核對範圍與不合格收據拒絕，LINE 不經 Email adapter',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({memberId:'b',jobId:job.id,documentId:job.documentId,recipient:job.recipient,verifiedAt:job.createdAt,supervised:false})).mockResolvedValueOnce(reply({outcome:'sent',receipt:'-'.repeat(36)}));const port=new HttpEccalEmail('https://eccal.example.test',key,fetcher);
    await expect(port.verify(job,{})).rejects.toMatchObject({code:'RECIPIENT_UNVERIFIED'});await expect(port.send(job,'https://fixture.invalid')).rejects.toMatchObject({code:'ECCAL_RESPONSE_INVALID'});await expect(port.verify({...job,channel:'line'},{})).rejects.toMatchObject({code:'DELIVERY_NOT_CONFIGURED'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('提供者拒絕與不明保留固定錯誤及狀態，額外細節不外流',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(reply({outcome:'rejected',failureCode:'RESEND_REJECTED',providerStatus:422,private:'fixture-detail'}));const port=new HttpEccalEmail('https://eccal.example.test',key,fetcher);expect(await port.send(job,'https://fixture.invalid')).toEqual({outcome:'rejected',failureCode:'RESEND_REJECTED',providerStatus:422});
  });
});
