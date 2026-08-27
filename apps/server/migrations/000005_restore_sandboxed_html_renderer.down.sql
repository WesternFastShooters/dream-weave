DELETE FROM preview_jobs WHERE renderer = 'sandboxed-html';
DELETE FROM preview_artifacts WHERE renderer = 'sandboxed-html';

ALTER TABLE preview_jobs DROP CONSTRAINT IF EXISTS preview_jobs_renderer_check;
ALTER TABLE preview_artifacts DROP CONSTRAINT IF EXISTS preview_artifacts_renderer_check;
ALTER TABLE preview_jobs ADD CONSTRAINT preview_jobs_renderer_check
  CHECK (renderer IN ('audio-waveform', 'video-poster'));
ALTER TABLE preview_artifacts ADD CONSTRAINT preview_artifacts_renderer_check
  CHECK (renderer IN ('audio-waveform', 'video-poster'));
