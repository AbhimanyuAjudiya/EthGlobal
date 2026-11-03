import { Coupon, type CouponProps, type CouponQrSlot } from './Coupon';
import { formatData } from './format';
import { Receipt } from './Receipt';

import type { CSSProperties, ReactNode } from 'react';

export interface PrintCard extends Omit<
  CouponProps,
  'variant' | 'pinCover' | 'pinConcealed' | 'renderQr' | 'status'
> {
  pin: string;
  serial: string;
  /** Back of the card: what the sponsor paid for this bundle ("$0.50"). */
  sponsorPaid?: string;
  /** Back of the card: "$0.00" when the facilitator pays. */
  networkFee?: string;
}

export type PrintSide = 'front' | 'back' | 'keyline';
/** a4 = 10 ISO ID-1 cards per sheet with crop marks; single = one 91.6 × 59.98 mm page per card. */
export type PrintLayout = 'a4' | 'single';

export interface PrintSheetProps {
  cards: readonly PrintCard[];
  side?: PrintSide;
  layout?: PrintLayout;
  renderQr?: (slot: CouponQrSlot) => ReactNode;
}

export const CARDS_PER_SHEET = 10;
const COLUMNS = 2;
const ROWS = CARDS_PER_SHEET / COLUMNS;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Crop marks on the sheet's perimeter, one pair per trim line; geometry lives in print.css. */
function CropMarks() {
  const marks: ReactNode[] = [];
  for (let col = 0; col < COLUMNS; col += 1) {
    for (const edge of [0, 1]) {
      for (const side of ['top', 'bottom'] as const) {
        marks.push(
          <span
            key={`v-${col}-${edge}-${side}`}
            className="print-mark print-mark--v"
            data-side={side}
            style={{ '--col': col, '--edge': edge } as CSSProperties}
          />,
        );
      }
    }
  }
  for (let row = 0; row < ROWS; row += 1) {
    for (const edge of [0, 1]) {
      for (const side of ['left', 'right'] as const) {
        marks.push(
          <span
            key={`h-${row}-${edge}-${side}`}
            className="print-mark print-mark--h"
            data-side={side}
            style={{ '--row': row, '--edge': edge } as CSSProperties}
          />,
        );
      }
    }
  }
  return <>{marks}</>;
}

function Back({ card }: { card: PrintCard }) {
  return (
    <div className="print-back">
      <Receipt
        labels={{
          you: 'Bundle',
          sponsor: card.sponsor ? `Paid by ${card.sponsor}` : 'Paid by',
          networkFee: 'Network fee',
        }}
        you={formatData(card.mb)}
        sponsor={card.sponsorPaid ?? '—'}
        networkFee={card.networkFee ?? '$0.00'}
      />
      <p className="print-back__ens">
        To: <span className="print-back__blank" aria-hidden="true" /> .eth — write a name to gift
        this card, or redeem at /card
      </p>
      <p className="print-back__serial" data-hash>
        {card.serial}
      </p>
    </div>
  );
}

/**
 * The paper scratch-card sheet (design-references §3). Fronts print the PIN layer and the visible QR; the
 * latex goes on afterwards. Backs are mirrored per row for long-edge duplex. The keyline side is the
 * 100 % K scratch-panel shape for the latex vendor.
 */
export function PrintSheet({ cards, side = 'front', layout = 'a4', renderQr }: PrintSheetProps) {
  const perSheet = layout === 'a4' ? CARDS_PER_SHEET : 1;
  return (
    <div className="print-root" data-layout={layout} data-color-scheme="light">
      {chunk(cards, perSheet).map((sheet, sheetIndex) => {
        const cells =
          side === 'back' && layout === 'a4'
            ? chunk(sheet, COLUMNS).flatMap((row) =>
                row.length === COLUMNS ? [...row].reverse() : [undefined, ...row],
              )
            : sheet;
        return (
          <section
            key={sheetIndex}
            className="print-sheet"
            data-side={side}
            data-layout={layout}
            aria-label={`Sheet ${sheetIndex + 1}, ${side}`}
          >
            {cells.map((card, cellIndex) => (
              <div className="print-cell" key={card?.serial ?? `empty-${cellIndex}`}>
                {card === undefined ? null : side === 'back' ? (
                  <Back card={card} />
                ) : (
                  <Coupon
                    {...card}
                    variant="print"
                    {...(renderQr && side === 'front' ? { renderQr } : {})}
                  />
                )}
              </div>
            ))}
            {layout === 'a4' ? <CropMarks /> : null}
          </section>
        );
      })}
    </div>
  );
}
