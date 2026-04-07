-- Round all existing task due dates to the nearest hour (strip minutes/seconds)
UPDATE tasks SET due_date = date_trunc('hour', due_date) WHERE due_date IS NOT NULL;

-- Round all existing episode release dates to the nearest hour
UPDATE episodes SET release_date = date_trunc('hour', release_date::timestamptz)::text WHERE release_date IS NOT NULL;
