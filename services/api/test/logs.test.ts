/** The pino redact list is the safety net under T-50 (the control is that nothing logs these values). */
import { describe, expect, it } from 'vitest';

import { createLogger, REDACT_PATHS } from '../src/logger.js';

describe('logger', () => {
  it('redacts secret-shaped fields at the top level and one level down', () => {
    const lines: string[] = [];
    const logger = createLogger('info', { write: (l: string) => void lines.push(l) });
    logger.info(
      {
        lpa: 'LPA:1$x$y',
        pin: '1234',
        nested: { proof: ['0x1'], signature: '0xsig', nullifier: '123' },
        headers: { authorization: 'Recharge-Sponsor abc' },
      },
      'm',
    );
    const line = lines.join('');
    expect(line).not.toMatch(/LPA:|1234|0xsig|Recharge-Sponsor|"0x1"/);
    expect(line).toContain('[redacted]');
    expect(JSON.parse(line)).toMatchObject({ service: 'api', msg: 'm' });
    expect(REDACT_PATHS).toEqual(expect.arrayContaining(['*.sealedLpa', '*.auditKey', '*.token']));
  });
});
