-- Custom SQL migration file, put your code below! --
INSERT INTO destinations (target_id, provider, address, created_at)
SELECT id, 'discord', alert_channel_id, created_at
FROM targets
WHERE alert_channel_id IS NOT NULL;
