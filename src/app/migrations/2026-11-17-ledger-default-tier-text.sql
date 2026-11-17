-- Businesses created before the Spanish default tiers received English ones:
-- Bronze, Silver and Gold, whose Silver and Gold perks promise "25% bonus
-- points" and "50% bonus points". Awards never apply tier multipliers, so
-- customers were promised points they do not receive.
--
-- Rewrite only businesses whose tiers are still exactly that original seed:
-- the same three tiers and no others, with unchanged names, thresholds,
-- multipliers, perks, colors and settings. Those get the names and perks that
-- new businesses receive (DEFAULT_TIERS in src/app/services/tier-service.js);
-- ids, thresholds, multipliers and colors stay, so customer tier assignments
-- and history are unaffected. Tiers an owner changed in any way are left as
-- they are. Idempotent: rewritten tiers no longer match the English seed.

WITH english_seed(tier_level, name, min_points, points_multiplier, perks, color) AS (
  VALUES
    (1, 'Bronze', 0, 1.00::numeric, '["Earn points on purchases", "Redeem rewards"]'::jsonb, '#CD7F32'),
    (2, 'Silver', 500, 1.25::numeric, '["25% bonus points", "Early access to new rewards", "Birthday bonus"]'::jsonb, '#C0C0C0'),
    (3, 'Gold', 2000, 1.50::numeric, '["50% bonus points", "Exclusive rewards", "Priority support", "Free delivery"]'::jsonb, '#FFD700')
),
untouched AS (
  SELECT lt.business_id
  FROM loyalty_tiers lt
  LEFT JOIN english_seed s
    ON s.tier_level = lt.tier_level
   AND lt.name = s.name
   AND lt.min_points = s.min_points
   AND lt.points_multiplier = s.points_multiplier
   AND lt.perks = s.perks
   AND lt.color = s.color
   AND lt.min_spend IS NULL
   AND lt.min_visits IS NULL
   AND lt.icon_url IS NULL
   AND lt.active IS TRUE
  GROUP BY lt.business_id
  HAVING count(*) = 3 AND count(s.tier_level) = 3
),
spanish(tier_level, name, perks) AS (
  VALUES
    (1, 'Bronce', '["Acumula puntos en tus compras", "Canjea recompensas"]'::jsonb),
    (2, 'Plata', '["Acceso anticipado a nuevas recompensas", "Bono de cumpleaños"]'::jsonb),
    (3, 'Oro', '["Recompensas exclusivas", "Atención prioritaria", "Envío gratis"]'::jsonb)
)
UPDATE loyalty_tiers lt
SET name = sp.name,
    perks = sp.perks,
    updated_at = now()
FROM untouched u, spanish sp
WHERE lt.business_id = u.business_id
  AND lt.tier_level = sp.tier_level;
