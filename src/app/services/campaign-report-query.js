// One statement snapshot: cohort, refunds, capture, costs and saved evidence.
// Every join carries business_id even under forced RLS.
export const campaignReportQuery = `WITH campaign AS (
 SELECT g.*,COALESCE(g.observation_ends_at,g.expires_at) AS measurement_end FROM growth_campaigns g WHERE g.business_id=$1::uuid AND g.id=$2::uuid
), member_sales AS (
 SELECT m.allocation,m.id,m.measurement_baseline,(c.id IS NULL OR c.deleted_at IS NOT NULL) AS unavailable,
  COALESCE(s.sales,0) AS sales,COALESCE(s.purchases,0) AS purchases,
  COALESCE(s.followup_sales,0) AS followup_sales,COALESCE(s.followup_purchases,0) AS followup_purchases,
  COALESCE(s.offer_sales,0) AS offer_sales,COALESCE(s.offer_purchases,0) AS offer_purchases,
  COALESCE(s.refunds,0) AS refunds,COALESCE(s.gross,0) AS gross,COALESCE(s.late_purchases,0) AS late_purchases,
  COALESCE(s.missing_dates,0) AS missing_dates,COALESCE(s.untrusted,0) AS untrusted,COALESCE(s.legacy,0) AS legacy,COALESCE(s.pending_refunds,0) AS pending_refunds,
  CASE WHEN bonus.id IS NOT NULL THEN m.bonus_points_awarded ELSE 0 END AS bonus_points,
  EXISTS(SELECT 1 FROM growth_campaign_members om JOIN growth_campaigns og ON og.business_id=om.business_id AND og.id=om.campaign_id
   WHERE om.business_id=m.business_id AND om.customer_id=m.customer_id AND om.campaign_id<>m.campaign_id AND om.allocation='treatment'
    AND og.starts_at<g.measurement_end AND og.starts_at<=statement_timestamp() AND LEAST(og.expires_at,COALESCE(og.paused_at,og.expires_at))>g.starts_at) AS overlapping
 FROM growth_campaign_members m JOIN campaign g ON g.business_id=m.business_id AND g.id=m.campaign_id
 LEFT JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id
 LEFT JOIN transactions bonus ON bonus.business_id=m.business_id AND bonus.id=m.bonus_transaction_id
   AND bonus.status IN('POSTED','PENDING') AND bonus.original_transaction_id IS NULL AND bonus.reversed_transaction_id IS NULL
 LEFT JOIN LATERAL (
  SELECT sum(net) AS sales,count(*) FILTER(WHERE is_purchase) AS purchases,
   sum(net) FILTER(WHERE event_at>=g.expires_at) AS followup_sales,count(*) FILTER(WHERE event_at>=g.expires_at AND is_purchase) AS followup_purchases,
   sum(net) FILTER(WHERE event_at<g.expires_at) AS offer_sales,count(*) FILTER(WHERE event_at<g.expires_at AND is_purchase) AS offer_purchases,
   sum(amount_q-net) AS refunds,sum(amount_q) AS gross,
   count(*) FILTER(WHERE created_at>=g.measurement_end OR created_at>event_at+interval '24 hours') AS late_purchases,
   count(*) FILTER(WHERE purchase_time_source='client_reported') AS untrusted,
   count(*) FILTER(WHERE purchase_occurred_at IS NULL AND source IN('external','order','offline')) AS missing_dates,
   count(*) FILTER(WHERE purchase_time_source IS NULL) AS legacy,sum(pending_refunds) AS pending_refunds
  FROM (
   SELECT valued.*,net>0 OR (amount_q=0 AND status<>'REVERSED' AND reversed_transaction_id IS NULL AND (visits>0 OR items>0)) AS is_purchase
   FROM (
    SELECT t.id,t.amount_q,t.status,t.visits,t.items,t.reversed_transaction_id,t.created_at,t.purchase_time_source,t.purchase_occurred_at,t.source,
     COALESCE(t.purchase_occurred_at,t.created_at) AS event_at,
     CASE WHEN t.status='REVERSED' OR t.reversed_transaction_id IS NOT NULL THEN 0
       ELSE GREATEST(0,t.amount_q-COALESCE(r.refunded,0)) END AS net,
     COALESCE(r.pending,0) AS pending_refunds
    FROM transactions t LEFT JOIN LATERAL (
     SELECT sum(r.amount_q) FILTER(WHERE r.reason NOT IN('ambiguous_original','amount_mismatch')) AS refunded,
      count(*) FILTER(WHERE r.status='pending') AS pending
     FROM pos_refund_receipts r WHERE r.business_id=t.business_id AND r.original_transaction_id=t.id AND r.created_at<=statement_timestamp()
    ) r ON true
    WHERE t.business_id=m.business_id AND t.customer_id=m.customer_id AND t.source IN('online','offline','external','order')
     AND (t.type='PURCHASE' OR t.type IS NULL) AND t.status IN('POSTED','PENDING','EXPIRED','REVERSED')
     AND (t.amount_q>0 OR t.visits>0 OR t.items>0) AND t.original_transaction_id IS NULL
     AND COALESCE(t.purchase_occurred_at,t.created_at)>=g.starts_at AND COALESCE(t.purchase_occurred_at,t.created_at)<g.measurement_end
     AND COALESCE(t.purchase_occurred_at,t.created_at)<=statement_timestamp() AND t.created_at<=statement_timestamp()
   ) valued
  ) purchases
 ) s ON true
 WHERE m.business_id=$1::uuid AND m.allocation IS NOT NULL
), stats AS (
 SELECT allocation,count(*)::int AS observed_members,count(*) FILTER(WHERE unavailable)::int AS unavailable_members,
  count(*) FILTER(WHERE purchases>0)::int AS returned_customers,sum(sales) AS recorded_sales_q,
  count(*) FILTER(WHERE offer_purchases>0)::int AS offer_returned_customers,sum(offer_sales) AS offer_sales_q,
  count(*) FILTER(WHERE followup_purchases>0)::int AS followup_returned_customers,sum(followup_sales) AS followup_sales_q,
  sum(gross) AS gross_sales_q,sum(refunds) AS refunds_q,sum(bonus_points) AS bonus_points,
  sum(missing_dates)::int AS missing_purchase_dates,sum(late_purchases)::int AS late_purchases,sum(untrusted)::int AS untrusted_time_purchases,sum(legacy)::int AS legacy_time_purchases,
  sum(pending_refunds)::int AS pending_refunds,count(*) FILTER(WHERE overlapping)::int AS overlap_members,
  count(*) FILTER(WHERE measurement_baseline IS NULL)::int AS missing_preperiod_members,
  count(*) FILTER(WHERE (measurement_baseline->>'purchases')::int>0)::int AS baseline_returned_customers,
  COALESCE(sum((measurement_baseline->>'sales_q')::numeric),0) AS baseline_sales_q
 FROM member_sales GROUP BY allocation
)
SELECT to_jsonb(g) AS campaign,statement_timestamp() AS as_of,b.program_json AS measurement_program,
 COALESCE((SELECT jsonb_agg(s) FROM stats s),'[]'::jsonb) AS groups,
 COALESCE((SELECT jsonb_object_agg(status,total) FROM (SELECT status,count(*)::int AS total FROM growth_message_outbox WHERE business_id=$1::uuid AND campaign_id=$2::uuid GROUP BY status) d),'{}'::jsonb) AS message_counts,
 (SELECT to_jsonb(c) FROM growth_measurement_costs c WHERE c.business_id=$1::uuid AND c.campaign_id=$2::uuid ORDER BY revision DESC LIMIT 1) AS cost_revision,
 (SELECT to_jsonb(r) FROM growth_measurement_reports r WHERE r.business_id=$1::uuid AND r.campaign_id=$2::uuid ORDER BY revision DESC LIMIT 1) AS last_report,
 (SELECT jsonb_build_object('total',count(*),'linked',count(*) FILTER(WHERE p.status='matched'),'unmatched',count(*) FILTER(WHERE p.status='unmatched'),'rejected',count(*) FILTER(WHERE p.status='rejected'))
  FROM pos_measurement_receipts p LEFT JOIN transactions pt ON pt.business_id=p.business_id AND pt.id=p.transaction_id WHERE p.business_id=g.business_id AND COALESCE(pt.purchase_occurred_at,pt.created_at,p.occurred_at,p.first_seen_at)>=g.starts_at
   AND COALESCE(pt.purchase_occurred_at,pt.created_at,p.occurred_at,p.first_seen_at)<g.measurement_end AND p.first_seen_at<=statement_timestamp()) AS receipt_coverage,
 (SELECT count(*)::int FROM pos_refund_receipts rf WHERE rf.business_id=g.business_id AND rf.status='pending'
  AND rf.original_transaction_id IS NULL AND rf.created_at>=g.starts_at AND rf.created_at<=statement_timestamp()) AS unallocated_refunds
FROM campaign g JOIN businesses b ON b.id=g.business_id`;
