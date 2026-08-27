-- Restore the single controlled HTML renderer.  000002 removed it while the
-- asset API still exposed the original upload as iframe content.
DELETE FROM preview_jobs WHERE renderer IN ('web-snapshot', 'html-poster');
DELETE FROM preview_artifacts WHERE renderer IN ('web-snapshot', 'html-poster');

ALTER TABLE preview_jobs DROP CONSTRAINT IF EXISTS preview_jobs_renderer_check;
ALTER TABLE preview_artifacts DROP CONSTRAINT IF EXISTS preview_artifacts_renderer_check;
ALTER TABLE preview_jobs ADD CONSTRAINT preview_jobs_renderer_check
  CHECK (renderer IN ('audio-waveform', 'video-poster', 'sandboxed-html'));
ALTER TABLE preview_artifacts ADD CONSTRAINT preview_artifacts_renderer_check
  CHECK (renderer IN ('audio-waveform', 'video-poster', 'sandboxed-html'));

-- Existing HTML uploads get exactly one job and artifact.  The partial joins
-- make this upgrade safe when an older deployment left one of them behind.
INSERT INTO preview_artifacts(asset_id, renderer, status, metadata)
SELECT a.id, 'sandboxed-html', 'queued', '{}'::jsonb
FROM assets a
WHERE a.kind = 'html'
  AND NOT EXISTS (
    SELECT 1 FROM preview_artifacts pa
    WHERE pa.asset_id = a.id AND pa.renderer = 'sandboxed-html'
  );

INSERT INTO preview_jobs(id, asset_id, renderer, status)
SELECT gen_random_uuid(), a.id, 'sandboxed-html', 'queued'
FROM assets a
WHERE a.kind = 'html'
  AND NOT EXISTS (
    SELECT 1 FROM preview_jobs pj
    WHERE pj.asset_id = a.id AND pj.renderer = 'sandboxed-html'
  );

UPDATE assets
SET processing = jsonb_set(processing, '{state}', '"queued"'::jsonb), updated_at = now()
WHERE kind = 'html'
  AND processing->>'state' = 'ready'
  AND EXISTS (
    SELECT 1 FROM preview_jobs pj
    WHERE pj.asset_id = assets.id AND pj.renderer = 'sandboxed-html'
      AND pj.status IN ('queued', 'running', 'retry_wait')
  );
