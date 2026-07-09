-- Custom SQL migration file, put your code below! --

-- Rename legacy 'hrv' vitals rows to the canonical registry key 'hrv_rmssd'.
UPDATE vitals SET metric_key = 'hrv_rmssd' WHERE metric_key = 'hrv';
