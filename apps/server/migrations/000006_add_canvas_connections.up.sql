CREATE TABLE canvas_connections (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  source_node_id UUID NOT NULL,
  source_handle TEXT NOT NULL CHECK (source_handle IN ('top', 'right', 'bottom', 'left')),
  target_node_id UUID NOT NULL,
  target_handle TEXT NOT NULL CHECK (target_handle IN ('top', 'right', 'bottom', 'left')),
  shape TEXT NOT NULL CHECK (shape IN ('straight', 'curve', 'elbow')),
  stroke TEXT NOT NULL CHECK (stroke IN ('solid', 'dashed')),
  direction TEXT NOT NULL CHECK (direction IN ('none', 'forward', 'both')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, source_node_id) REFERENCES canvas_nodes(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, target_node_id) REFERENCES canvas_nodes(project_id, id) ON DELETE CASCADE
);

CREATE INDEX canvas_connections_source_idx ON canvas_connections(project_id, source_node_id);
CREATE INDEX canvas_connections_target_idx ON canvas_connections(project_id, target_node_id);
