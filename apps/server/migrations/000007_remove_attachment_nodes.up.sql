CREATE TEMP TABLE attachment_asset_ids (id UUID PRIMARY KEY) ON COMMIT DROP;
INSERT INTO attachment_asset_ids(id)
SELECT id FROM assets WHERE kind = 'attachment';

CREATE TEMP TABLE attachment_project_ids (id UUID PRIMARY KEY) ON COMMIT DROP;
INSERT INTO attachment_project_ids(id)
SELECT project_id FROM assets WHERE kind = 'attachment'
UNION
SELECT project_id FROM canvas_nodes WHERE kind = 'attachment' OR asset_id IN (SELECT id FROM attachment_asset_ids);

CREATE TEMP TABLE attachment_storage_refs (storage_ref TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO attachment_storage_refs(storage_ref)
SELECT storage_ref FROM assets WHERE id IN (SELECT id FROM attachment_asset_ids) AND storage_ref IS NOT NULL;

DELETE FROM canvas_command_receipts
WHERE project_id IN (SELECT id FROM attachment_project_ids);

DELETE FROM canvas_node_placements
WHERE node_id IN (
  SELECT id FROM canvas_nodes
  WHERE kind = 'attachment' OR asset_id IN (SELECT id FROM attachment_asset_ids)
);

DELETE FROM canvas_nodes
WHERE kind = 'attachment' OR asset_id IN (SELECT id FROM attachment_asset_ids);

DELETE FROM preview_jobs WHERE asset_id IN (SELECT id FROM attachment_asset_ids);
DELETE FROM preview_artifacts WHERE asset_id IN (SELECT id FROM attachment_asset_ids);
DELETE FROM assets WHERE id IN (SELECT id FROM attachment_asset_ids);
DELETE FROM asset_uploads WHERE storage_ref IN (SELECT storage_ref FROM attachment_storage_refs);

UPDATE canvas_documents
SET revision = revision + 1, updated_at = now()
WHERE project_id IN (SELECT id FROM attachment_project_ids);

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('image', 'audio', 'video', 'pdf', 'office', 'web', 'html'));

ALTER TABLE canvas_nodes DROP CONSTRAINT IF EXISTS canvas_nodes_kind_check;
ALTER TABLE canvas_nodes ADD CONSTRAINT canvas_nodes_kind_check
  CHECK (kind IN ('markdown', 'image', 'audio', 'video', 'web-preview', 'html', 'pdf', 'office', 'frame'));
