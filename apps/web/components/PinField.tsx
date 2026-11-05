'use client';

import { Field } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';

/**
 * The 16-digit PIN as it is printed: 4 × 4 under the silver strip on the FRONT of the card (RT-W-09). One field for
 * /card and /gift/claim; the Verhoeff check runs in the caller before anything is sent.
 */
export function PinField({
  label,
  value,
  onChange,
  error,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  testId: string;
}) {
  const { t } = useLang();
  return (
    <Field
      label={label}
      hint={t('card.pinHint')}
      mono
      inputMode="numeric"
      autoComplete="off"
      maxLength={19}
      placeholder="0000 0000 0000 0000"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...(error ? { error } : {})}
      data-testid={testId}
    />
  );
}
