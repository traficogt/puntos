-- Odoo invokes module neutralization scripts for a neutralized database copy.
UPDATE pf_pos_connector SET enabled = false;
UPDATE ir_cron SET active = false WHERE id IN (
    SELECT res_id FROM ir_model_data WHERE module = 'pf_pos_connector' AND name IN ('cron_send_outbox', 'cron_send_reward_events', 'cron_publish_catalog')
);
