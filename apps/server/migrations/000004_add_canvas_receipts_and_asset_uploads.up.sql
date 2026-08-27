-- Repair databases where the original bootstrap migration stopped before the
-- placement finite-value constraint was corrected. New databases receive the
-- same objects from 000001; IF NOT EXISTS keeps this migration idempotent.
CREATE TABLE IF NOT EXISTS canvas_command_receipts (
  project_id UUID NOT NULL REFERENCES projects(id),
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  revision BIGINT NOT NULL,
  response_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, request_id)
);
CREATE TABLE IF NOT EXISTS asset_uploads (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  storage_ref TEXT NOT NULL,
  file_name TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL,
  declared_byte_size BIGINT NOT NULL CHECK (declared_byte_size >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_uploads_project_idx ON asset_uploads(project_id);
