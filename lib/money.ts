import { Decimal } from "@prisma/client/runtime/library";

export function toDecimal(amount: string | number | undefined | null): Decimal {
  if (amount == null) return new Decimal(0);
  return new Decimal(typeof amount === "string" ? amount : String(amount));
}

export function toNumber(d: Decimal | null | undefined): number {
  if (d == null) return 0;
  return d.toNumber();
}
