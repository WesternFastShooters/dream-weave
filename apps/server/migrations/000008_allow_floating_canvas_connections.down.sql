ALTER TABLE canvas_connections
  DROP CONSTRAINT IF EXISTS canvas_connections_source_position_finite,
  DROP CONSTRAINT IF EXISTS canvas_connections_target_position_finite,
  DROP CONSTRAINT IF EXISTS canvas_connections_project_id_source_node_id_fkey,
  DROP CONSTRAINT IF EXISTS canvas_connections_project_id_target_node_id_fkey;

DELETE FROM canvas_connections WHERE source_node_id IS NULL OR target_node_id IS NULL;

ALTER TABLE canvas_connections
  DROP COLUMN source_x,
  DROP COLUMN source_y,
  DROP COLUMN target_x,
  DROP COLUMN target_y,
  ALTER COLUMN source_node_id SET NOT NULL,
  ALTER COLUMN source_handle SET NOT NULL,
  ALTER COLUMN target_node_id SET NOT NULL,
  ALTER COLUMN target_handle SET NOT NULL,
  ADD CONSTRAINT canvas_connections_project_id_source_node_id_fkey FOREIGN KEY (project_id, source_node_id) REFERENCES canvas_nodes(project_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT canvas_connections_project_id_target_node_id_fkey FOREIGN KEY (project_id, target_node_id) REFERENCES canvas_nodes(project_id, id) ON DELETE CASCADE;
