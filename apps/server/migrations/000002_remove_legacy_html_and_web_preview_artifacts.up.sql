-- External URLs are rendered directly by the browser and uploaded HTML is served as
-- one sandboxed node. Remove obsolete server-side snapshots and bridge artifacts.
DELETE FROM preview_jobs WHERE renderer IN ('web-snapshot', 'html-poster', 'sandboxed-html');
DELETE FROM preview_artifacts WHERE renderer IN ('web-snapshot', 'html-poster', 'sandboxed-html');
ALTER TABLE preview_jobs DROP CONSTRAINT IF EXISTS preview_jobs_renderer_check;
ALTER TABLE preview_artifacts DROP CONSTRAINT IF EXISTS preview_artifacts_renderer_check;
ALTER TABLE preview_jobs ADD CONSTRAINT preview_jobs_renderer_check CHECK (renderer IN ('audio-waveform', 'video-poster'));
ALTER TABLE preview_artifacts ADD CONSTRAINT preview_artifacts_renderer_check CHECK (renderer IN ('audio-waveform', 'video-poster'));
