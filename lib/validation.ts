import { z } from 'zod';

// Lot validation
export const createLotSchema = z.object({
  name: z.string().min(1, 'Lot name is required').max(100, 'Lot name too long'),
});

export const updateLotSchema = z.object({
  name: z.string().min(1, 'Lot name is required').max(100, 'Lot name too long').optional(),
  completed: z.boolean().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

// CardItem validation
export const cardStatusSchema = z.enum(['Draft', 'Ready', 'Exported']);

export const updateCardItemSchema = z.object({
  title: z.string().nullable().optional(),
  status: cardStatusSchema.optional(),
  listings: z.string().nullable().optional(),
  salePrice: z.number().nullable().optional(),
  category: z.string().optional(),
  year: z.number().int().min(1800).max(2100).nullable().optional(),
  brand: z.string().nullable().optional(),
  setName: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  subsetParallel: z.string().nullable().optional(),
  attributes: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  variation: z.string().nullable().optional(),
  graded: z.boolean().optional(),
  grader: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  conditionType: z.string().optional(),
  condition: z.string().optional(),
  certNo: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const bulkUpdateCardItemsSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().uuid(),
      data: updateCardItemSchema,
    })
  ),
});

// ExportProfile validation
export const listingTypeSchema = z.enum(['Auction', 'BuyItNow']);
export const scheduleModeSchema = z.enum(['Immediate', 'Scheduled']);
export const durationDaysSchema = z.enum(['1', '3', '5', '7', '10']).transform(Number);

export const exportProfileSchema = z.object({
  templateName: z.string().min(1).max(100).optional(),
  ebayCategory: z.string().optional(),
  storeCategory: z.string().optional(),
  listingType: listingTypeSchema.optional(),
  startPriceDefault: z.number().positive().optional(),
  buyItNowPrice: z.number().positive().nullable().optional(),
  durationDays: z.number().int().refine((v) => [1, 3, 5, 7, 10].includes(v)).optional(),
  scheduleMode: scheduleModeSchema.optional(),
  scheduleDate: z.string().nullable().optional(),
  scheduleTime: z.string().nullable().optional(),
  staggerEnabled: z.boolean().optional(),
  staggerIntervalSeconds: z.number().int().min(0).max(3600).optional(),
  shippingService: z.string().optional(),
  handlingTimeDays: z.number().int().min(0).max(30).optional(),
  freeShipping: z.boolean().optional(),
  shippingCost: z.number().min(0).optional(),
  eachAdditionalItemCost: z.number().min(0).optional(),
  immediatePayment: z.boolean().optional(),
  itemLocationCity: z.string().nullable().optional(),
  itemLocationState: z.string().nullable().optional(),
  itemLocationZip: z.string().nullable().optional(),
  returnsAccepted: z.boolean().optional(),
  returnWindowDays: z.number().int().refine((v) => [14, 30, 60].includes(v)).optional(),
  refundMethod: z.string().optional(),
  shippingCostPaidBy: z.enum(['Buyer', 'Seller']).optional(),
  salesTaxEnabled: z.boolean().optional(),
});

export type CreateLotInput = z.infer<typeof createLotSchema>;
export type UpdateLotInput = z.infer<typeof updateLotSchema>;
export type UpdateCardItemInput = z.infer<typeof updateCardItemSchema>;
export type ExportProfileInput = z.infer<typeof exportProfileSchema>;
