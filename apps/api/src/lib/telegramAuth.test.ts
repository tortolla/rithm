import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateInitData } from './telegramAuth.js';

function makeInitData(token: string, user = { id: 42, first_name: 'Настя' }) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAEAAAE',
    user: JSON.stringify(user)
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

describe('Telegram initData validation', () => {
  it('accepts correctly signed data', () => {
    expect(validateInitData(makeInitData('secret-token'), 'secret-token')).toMatchObject({ id: 42, first_name: 'Настя' });
  });

  it('rejects tampered data', () => {
    const value = makeInitData('secret-token').replace('%D0%9D%D0%B0%D1%81%D1%82%D1%8F', '%D0%95%D0%B2%D0%B0');
    expect(() => validateInitData(value, 'secret-token')).toThrow('Некорректная подпись Telegram');
  });

  it('rejects expired data', () => {
    const value = makeInitData('secret-token');
    expect(() => validateInitData(value, 'secret-token', -1)).toThrow('Сессия Telegram устарела');
  });
});
