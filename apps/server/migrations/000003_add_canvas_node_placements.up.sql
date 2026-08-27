-- Existing local databases created before placement persistence need this
-- additive migration; new databases already receive the table in 000001.
CREATE TABLE IF NOT EXISTS canvas_node_placements (
  node_id UUID PRIMARY KEY REFERENCES canvas_nodes(id),
  project_id UUID NOT NULL,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  width DOUBLE PRECISION NOT NULL CHECK (width > 0),
  height DOUBLE PRECISION NOT NULL CHECK (height > 0),
  z_index INTEGER NOT NULL,
  FOREIGN KEY (project_id, node_id) REFERENCES canvas_nodes(project_id, id),
  CHECK (x NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND
         y NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND
         width NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision) AND
         height NOT IN ('Infinity'::double precision, '-Infinity'::double precision, 'NaN'::double precision))
);
