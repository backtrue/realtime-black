import { AppError } from './contracts';
import { HttpEccalQuota } from './eccal-http';
import type { LineRef } from './line-delivery';

export class HttpEccalLine extends HttpEccalQuota {
  async register(ref: LineRef): Promise<void> {
    const value = await this.request('line/register', ref);
    if (!value || typeof value !== 'object' || (value as { registered?: unknown }).registered !== true) throw new AppError('ECCAL_RESPONSE_INVALID');
  }
}
