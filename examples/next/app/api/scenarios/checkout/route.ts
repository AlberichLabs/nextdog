// Planted-bug scenario A — a 500 error on a route.
//
// GET /api/scenarios/checkout prices a cart loaded from a stored row. The row is
// parsed into an assumed shape (`as Cart`) that claims a `coupon` is always
// present — but this row has none. The BUGGY path reads `coupon.percentOff` and
// throws a TypeError that escapes the handler and surfaces as a 500 SERVER span
// with a captured stack trace. The FIXED path guards the optional coupon. Flip
// between them with `POST /api/scenarios { "scenario": "checkout", "fixed": true }`
// or by editing the buggy line below (Next hot-reloads).
import { isFixed } from '../../../../lib/planted-bugs';

interface Cart {
  items: Array<{ sku: string; price: number; qty: number }>;
  coupon: { code: string; percentOff: number };
}

// A stored cart row (as it might come back from a DB / cache). Note: this row has
// no `coupon`, but the `as Cart` cast below asserts one is always there.
const CART_ROW =
  '{"items":[{"sku":"dog-bed-large","price":4200,"qty":1},{"sku":"chew-toy","price":900,"qty":3}]}';

function subtotal(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function GET(): Response {
  const cart = JSON.parse(CART_ROW) as Cart;
  const gross = subtotal(cart);

  let discountPct: number;
  if (isFixed('checkout')) {
    // FIX: the coupon is not guaranteed, so default the discount to 0 when absent.
    discountPct = cart.coupon?.percentOff ?? 0;
  } else {
    // BUG: this row has no coupon, so reading `.percentOff` throws
    // "TypeError: Cannot read properties of undefined (reading 'percentOff')".
    discountPct = cart.coupon.percentOff;
  }

  const total = Math.round(gross * (1 - discountPct / 100));
  console.log(`[checkout] priced cart: gross=${gross} discountPct=${discountPct} total=${total}`);
  return Response.json({ currency: 'usd', gross, discountPct, total });
}
