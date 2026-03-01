import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { validate } from "../../utils/validation.js";
import { validateQuery } from "../../utils/schemas.js";
import { requireStaff } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { createGiftCard, giftCardDetails, listGiftCards, redeemGiftCard } from "../services/gift-card-service.js";
import { tenantContext } from "../../middleware/tenant.js";

const router = Router();

const CreateGiftCardSchema = z.object({
  amount_q: z.number().positive(),
  issued_to_name: z.string().max(120).optional(),
  issued_to_phone: z.string().min(6).max(30).optional(),
  expires_at: z.string().datetime().optional()
});

const GiftCardListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

router.get("/admin/gift-cards", requireStaff, tenantContext, requirePlanFeature("gift_cards"), validateQuery(GiftCardListQuerySchema), asyncRoute(async (req, res) => {
  const { limit } = req.validatedQuery;
  const cards = await listGiftCards({ staff: req.staff, limit });
  res.json({ ok: true, gift_cards: cards });
}));

router.post("/admin/gift-cards", csrfProtect, requireStaff, tenantContext, requirePlanFeature("gift_cards"), asyncRoute(async (req, res) => {
  const v = validate(CreateGiftCardSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const card = await createGiftCard({ staff: req.staff, ...v.data });
  res.status(201).json({ ok: true, gift_card: card });
}));

const RedeemGiftCardSchema = z.object({
  code_or_token: z.string().min(4).max(200),
  amount_q: z.number().positive(),
  note: z.string().max(200).optional()
});

router.post("/staff/gift-cards/redeem", csrfProtect, requireStaff, tenantContext, requirePlanFeature("gift_cards"), asyncRoute(async (req, res) => {
  const v = validate(RedeemGiftCardSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const card = await redeemGiftCard({ staff: req.staff, ...v.data });
  res.json({ ok: true, gift_card: card });
}));

router.get("/staff/gift-cards/:codeOrToken", requireStaff, tenantContext, requirePlanFeature("gift_cards"), asyncRoute(async (req, res) => {
  const details = await giftCardDetails({ staff: req.staff, code_or_token: String(req.params.codeOrToken || "") });
  res.json({ ok: true, ...details });
}));

export default router;
