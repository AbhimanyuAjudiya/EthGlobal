import { KitIcon, type KitIconName } from './icons';

export interface AvatarProps {
  /** Initials are taken from it: "Jio" → "J", "Hedera Testnet" → "HT", "rahul.eth" → "R". */
  label?: string;
  src?: string;
  /** An icon instead of initials (ListRow leading, QuickActions). */
  icon?: KitIconName;
  size?: 32 | 40 | 48;
  tone?: 'brand-pale' | 'brand' | 'neutral' | 'positive' | 'warning' | 'negative';
}

const initials = (label: string) =>
  label
    .split(/[\s.·_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('');

/** Round, brand-pale by default; decorative (the row's title says who it is). */
export function Avatar({ label, src, icon, size = 40, tone = 'brand-pale' }: AvatarProps) {
  return (
    <span className="avatar" data-size={size} data-tone={tone} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a 40 px decorative avatar; next/image adds nothing
        <img src={src} alt="" width={size} height={size} />
      ) : icon ? (
        <KitIcon name={icon} size={size === 32 ? 16 : 20} />
      ) : (
        initials(label ?? '')
      )}
    </span>
  );
}
