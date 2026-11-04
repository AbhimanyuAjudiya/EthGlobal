import { describe, expect, it } from 'vitest';

import { ANDROID_EUICC_INTENT, iosUniversalLink, isLpa, LPA_PATTERN, splitLpa } from '../lib/lpa-links';

const LPA = 'LPA:1$local.test$0A1B2C3D4E5F6071';

describe('lpa-links', () => {
  it('the regex gate accepts real activation codes and nothing else (T-62)', () => {
    for (const ok of [LPA, 'LPA:1$rsp.truphone.com$QRF-BETTERROAMING-PMRDGIR2EARDEIT5', 'LPA:1$smdp.io$K2-1X9-XYZ$1.3.6.1$1'])
      expect(isLpa(ok), ok).toBe(true);
    for (const bad of [
      '',
      'LPA:2$local.test$ABC',
      'LPA:1$$ABC',
      'LPA:1$local.test$',
      'javascript:alert(1)',
      'LPA:1$evil.example$ABC&x=1',
      'LPA:1$local.test$ABC\n',
      `LPA:1$${'a'.repeat(260)}$ABC`,
      'https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$a$b',
    ])
      expect(isLpa(bad), JSON.stringify(bad)).toBe(false);
    expect(LPA_PATTERN.flags).toBe('');
  });

  it('builds the iOS universal link with the host lower-case and `$` URL-encoded', () => {
    expect(iosUniversalLink(LPA)).toBe(
      'https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA%3A1%24local.test%240A1B2C3D4E5F6071',
    );
    expect(new URL(iosUniversalLink(LPA)).searchParams.get('carddata')).toBe(LPA);
    expect(() => iosUniversalLink('LPA:1$evil$<script>')).toThrow(RangeError);
  });

  it('the Android settings intent is the documented action string, nothing that claims to install', () => {
    expect(ANDROID_EUICC_INTENT).toBe(
      'intent:#Intent;action=android.telephony.euicc.action.MANAGE_EMBEDDED_SUBSCRIPTIONS;end',
    );
    expect(ANDROID_EUICC_INTENT).not.toContain('START_EUICC_ACTIVATION');
  });

  it('splits the code on $ for the copyable display', () => {
    expect(splitLpa(LPA)).toEqual(['LPA:1', 'local.test', '0A1B2C3D4E5F6071']);
  });
});
