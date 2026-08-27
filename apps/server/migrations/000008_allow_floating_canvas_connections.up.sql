ALTER TABLE canvas_connections
  ADD COLUMN source_x DOUBLE PRECISION,
  ADD COLUMN source_y DOUBLE PRECISION,
  ADD COLUMN target_x DOUBLE PRECISION,
  ADD COLUMN target_y DOUBLE PRECISION;

UPDATE canvas_connections c
SET source_x = p.x + CASE c.source_handle WHEN 'right' THEN p.width WHEN 'left' THEN 0 ELSE p.width / 2 END,
    source_y = p.y + CASE c.source_handle WHEN 'bottom' THEN p.height WHEN 'top' THEN 0 ELSE p.height / 2 END
FROM canvas_node_placements p
WHERE p.project_id = c.project_id AND p.node_id = c.source_node_id;

UPDATE canvas_connections c
SET target_x = p.x + CASE c.target_handle WHEN 'right' THEN p.width WHEN 'left' THEN 0 ELSE p.width / 2 END,
    target_y = p.y + CASE c.target_handle WHEN 'bottom' THEN p.height WHEN 'top' THEN 0 ELSE p.height / 2 END
FROM canvas_node_placements p
WHERE p.project_id = c.project_id AND p.node_id = c.target_node_id;

ALTER TABLE canvas_connections
  ALTER COLUMN source_node_id DROP NOT NULL,
  ALTER COLUMN source_handle DROP NOT NULL,
  ALTER COLUMN target_node_id DROP NOT NULL,
  ALTER COLUMN target_handle DROP NOT NULL,
  ALTER COLUMN source_x SET NOT NULL,
  ALTER COLUMN source_y SET NOT NULL,
  ALTER COLUMN target_x SET NOT NULL,
  ALTER COLUMN target_y SET NOT NULL;

ALTER TABLE canvas_connections DROP CONSTRAINT IF EXISTS canvas_connections_project_id_source_node_id_fkey;
ALTER TABLE canvas_connections DROP CONSTRAINT IF EXISTS canvas_connections_project_id_target_node_id_fkey;
ALTER TABLE canvas_connections
  ADD CONSTRAINT canvas_connections_project_id_source_node_id_fkey FOREIGN KEY (project_id, source_node_id) REFERENCES canvas_nodes(project_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT canvas_connections_project_id_target_node_id_fkey FOREIGN KEY (project_id, target_node_id) REFERENCES canvas_nodes(project_id, id) ON DELETE SET NULL;

ALTER TABLE canvas_connections
  ADD CONSTRAINT canvas_connections_source_position_finite CHECK (source_x NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND source_y NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision)),
  ADD CONSTRAINT canvas_connections_target_position_finite CHECK (target_x NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND target_y NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision));
