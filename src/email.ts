import { AppError, type DeliveryJob, type DeliveryPort, type DeliveryResult } from './contracts';
import { HttpEccalQuota } from './eccal-http';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const scope = (job: DeliveryJob) => ({ memberId: job.memberId, jobId: job.id, recordId: job.recordId, documentId: job.documentId, recipient: job.recipient, createdAt: job.createdAt });

export class HttpEccalEmail extends HttpEccalQuota implements DeliveryPort {
  async verify(job: DeliveryJob, _proof: unknown) {
    if (job.channel !== 'email') throw new AppError('DELIVERY_NOT_CONFIGURED');
    const value = await this.request('email/verify', scope(job));
    if (!object(value) || value.memberId !== job.memberId || value.jobId !== job.id || value.documentId !== job.documentId || value.recipient !== job.recipient || !Number.isSafeInteger(value.verifiedAt) || value.supervised !== false) throw new AppError('RECIPIENT_UNVERIFIED', 403);
    return { memberId: job.memberId, jobId: job.id, documentId: job.documentId, recipient: job.recipient, verifiedAt: value.verifiedAt as number, supervised: false };
  }
  async send(job: DeliveryJob, resultUrl: string): Promise<DeliveryResult> {
    if (job.channel !== 'email') throw new AppError('DELIVERY_NOT_CONFIGURED');
    const value = await this.request('email/send', { ...scope(job), resultUrl });
    if (!object(value)) throw new AppError('ECCAL_RESPONSE_INVALID');
    if (value.outcome === 'sent' && typeof value.receipt === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.receipt)) return { outcome: 'sent', receipt: value.receipt };
    if ((value.outcome === 'rejected' || value.outcome === 'unknown') && ['EMAIL_NOT_CONFIGURED', 'RECIPIENT_UNVERIFIED', 'RESEND_REJECTED', 'RESEND_UNAVAILABLE'].includes(value.failureCode as string) && (value.providerStatus === undefined || Number.isInteger(value.providerStatus) && (value.providerStatus as number) >= 300 && (value.providerStatus as number) <= 599)) return { outcome: value.outcome, failureCode: value.failureCode as 'EMAIL_NOT_CONFIGURED' | 'RECIPIENT_UNVERIFIED' | 'RESEND_REJECTED' | 'RESEND_UNAVAILABLE', ...(value.providerStatus !== undefined ? { providerStatus: value.providerStatus as number } : {}) };
    throw new AppError('ECCAL_RESPONSE_INVALID');
  }
}
