CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY, email CITEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE projects (
  id UUID PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id), user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE canvas_documents (
  project_id UUID PRIMARY KEY REFERENCES projects(id), revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE assets (
  id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'video', 'pdf', 'office', 'web', 'html')),
  display_name TEXT NOT NULL, source_type TEXT NOT NULL CHECK (source_type IN ('managed-object', 'external-url')),
  storage_ref TEXT NULL, normalized_url TEXT NULL, mime_type TEXT NOT NULL, format TEXT NOT NULL, byte_size BIGINT NULL CHECK (byte_size IS NULL OR byte_size >= 0),
  metadata JSONB NOT NULL, processing JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  CHECK ((source_type = 'managed-object' AND storage_ref IS NOT NULL AND normalized_url IS NULL) OR (source_type = 'external-url' AND storage_ref IS NULL AND normalized_url IS NOT NULL))
);
CREATE TABLE preview_artifacts (
  asset_id UUID NOT NULL REFERENCES assets(id), renderer TEXT NOT NULL CHECK (renderer IN ('audio-waveform', 'video-poster')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'ready', 'failed')), artifact_ref TEXT NULL, metadata JSONB NOT NULL, error JSONB NULL, generated_at TIMESTAMPTZ NULL,
  PRIMARY KEY (asset_id, renderer)
);
CREATE TABLE preview_jobs (
  id UUID PRIMARY KEY, asset_id UUID NOT NULL REFERENCES assets(id), renderer TEXT NOT NULL CHECK (renderer IN ('audio-waveform', 'video-poster')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4), next_attempt_at TIMESTAMPTZ NULL, lease_expires_at TIMESTAMPTZ NULL,
  error_code TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, renderer)
);
CREATE TABLE canvas_nodes (
  id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('markdown', 'image', 'audio', 'video', 'web-preview', 'html', 'pdf', 'office', 'frame')),
  markdown TEXT NULL, asset_id UUID NULL, frame_data JSONB NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, id), FOREIGN KEY (project_id, asset_id) REFERENCES assets(project_id, id),
  CHECK ((kind = 'markdown' AND markdown IS NOT NULL AND asset_id IS NULL AND frame_data IS NULL) OR
         (kind = 'frame' AND markdown IS NULL AND asset_id IS NULL AND frame_data IS NOT NULL) OR
         (kind NOT IN ('markdown', 'frame') AND markdown IS NULL AND asset_id IS NOT NULL AND frame_data IS NULL))
);
CREATE TABLE canvas_node_placements (
  node_id UUID PRIMARY KEY REFERENCES canvas_nodes(id), project_id UUID NOT NULL,
  x DOUBLE PRECISION NOT NULL, y DOUBLE PRECISION NOT NULL, width DOUBLE PRECISION NOT NULL CHECK (width > 0), height DOUBLE PRECISION NOT NULL CHECK (height > 0), z_index INTEGER NOT NULL,
  FOREIGN KEY (project_id, node_id) REFERENCES canvas_nodes(project_id, id),
  CHECK (x NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND
         y NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND
         width NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND
         height NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision))
);
CREATE TABLE canvas_command_receipts (
  project_id UUID NOT NULL REFERENCES projects(id), request_id UUID NOT NULL, request_hash TEXT NOT NULL, revision BIGINT NOT NULL,
  response_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (project_id, request_id)
);
CREATE INDEX preview_jobs_available_idx ON preview_jobs (status, next_attempt_at) WHERE status IN ('queued', 'retry_wait');

-- Upload tickets are server-side state only. Object keys remain internal and are never projected to canvas DTOs.
CREATE TABLE asset_uploads (
  id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id), storage_ref TEXT NOT NULL,
  file_name TEXT NOT NULL, declared_mime_type TEXT NOT NULL, declared_byte_size BIGINT NOT NULL CHECK (declared_byte_size >= 0),
  expires_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX asset_uploads_project_idx ON asset_uploads(project_id);
