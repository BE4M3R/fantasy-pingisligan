begin;

-- A locked chip is already consumed for the season. The app derives whether
-- it is currently active or previously used from the current gameweek window,
-- so no later database update is required.
select cron.unschedule(jobid)
from cron.job
where jobname = 'mark-used-chips';

commit;
