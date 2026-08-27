// Package repository persists canvas commands with the document row as the serialization lock.
package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/mutation"
)

type Postgres struct{ DB *sql.DB }
type Receipt struct {
	Hash     string
	Snapshot domain.Snapshot
}

func New(db *sql.DB) *Postgres { return &Postgres{DB: db} }
func (r *Postgres) BeginLocked(ctx context.Context, projectID string) (*sql.Tx, int64, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	var rev int64
	err = tx.QueryRowContext(ctx, `SELECT revision FROM canvas_documents WHERE project_id=$1 FOR UPDATE`, projectID).Scan(&rev)
	if err != nil {
		_ = tx.Rollback()
		return nil, 0, err
	}
	return tx, rev, nil
}
func (r *Postgres) Receipt(ctx context.Context, tx *sql.Tx, projectID, requestID string) (*Receipt, error) {
	var hash string
	var raw []byte
	err := tx.QueryRowContext(ctx, `SELECT request_hash,response_snapshot FROM canvas_command_receipts WHERE project_id=$1 AND request_id=$2`, projectID, requestID).Scan(&hash, &raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var s domain.Snapshot
	if err = json.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("decode receipt: %w", err)
	}
	return &Receipt{hash, s}, nil
}
func (r *Postgres) Apply(ctx context.Context, tx *sql.Tx, projectID string, mutations []mutation.Mutation) error {
	for _, m := range mutations {
		switch {
		case m.CreateMarkdown != nil:
			c := m.CreateMarkdown
			if err := r.createMarkdown(ctx, tx, projectID, c); err != nil {
				return err
			}
		case m.UpdateMarkdown != nil:
			if err := r.updateMarkdown(ctx, tx, projectID, m.UpdateMarkdown); err != nil {
				return err
			}
		case m.CreateAsset != nil:
			if err := r.createAssetNode(ctx, tx, projectID, m.CreateAsset); err != nil {
				return err
			}
		case m.CreateFrame != nil:
			if err := r.createFrame(ctx, tx, projectID, m.CreateFrame); err != nil {
				return err
			}
		case m.UpdateFrame != nil:
			if err := r.updateFrame(ctx, tx, projectID, m.UpdateFrame); err != nil {
				return err
			}
		case m.DeleteNodes != nil:
			if err := r.deleteNodes(ctx, tx, projectID, m.DeleteNodes.NodeIDs); err != nil {
				return err
			}
		case m.SetPlacements != nil:
			if err := r.setPlacements(ctx, tx, projectID, m.SetPlacements.Placements); err != nil {
				return err
			}
		case m.CreateConnection != nil:
			if err := r.createConnection(ctx, tx, projectID, m.CreateConnection.Connection); err != nil {
				return err
			}
		case m.UpdateConnection != nil:
			if err := r.updateConnection(ctx, tx, projectID, m.UpdateConnection.Connection); err != nil {
				return err
			}
		case m.DeleteConnections != nil:
			if err := r.deleteConnections(ctx, tx, projectID, m.DeleteConnections.ConnectionIDs); err != nil {
				return err
			}
		}
	}
	return nil
}
func (r *Postgres) createConnection(ctx context.Context, tx *sql.Tx, p string, c domain.Connection) error {
	if err := c.Validate(); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO canvas_connections(id,project_id,source_node_id,source_handle,source_x,source_y,target_node_id,target_handle,target_x,target_y,shape,stroke,direction) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,NULLIF($7,''),NULLIF($8,''),$9,$10,$11,$12,$13)`,
		c.ID, p, c.SourceNodeID, c.SourceHandle, c.SourceX, c.SourceY, c.TargetNodeID, c.TargetHandle, c.TargetX, c.TargetY, c.Shape, c.Stroke, c.Direction)
	return err
}
func (r *Postgres) updateConnection(ctx context.Context, tx *sql.Tx, p string, c domain.Connection) error {
	if err := c.Validate(); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE canvas_connections SET source_node_id=NULLIF($3,''),source_handle=NULLIF($4,''),source_x=$5,source_y=$6,target_node_id=NULLIF($7,''),target_handle=NULLIF($8,''),target_x=$9,target_y=$10,shape=$11,stroke=$12,direction=$13,updated_at=now() WHERE id=$1 AND project_id=$2`,
		c.ID, p, c.SourceNodeID, c.SourceHandle, c.SourceX, c.SourceY, c.TargetNodeID, c.TargetHandle, c.TargetX, c.TargetY, c.Shape, c.Stroke, c.Direction)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return fmt.Errorf("connection not found")
	}
	return nil
}
func (r *Postgres) deleteConnections(ctx context.Context, tx *sql.Tx, p string, ids []string) error {
	for _, id := range ids {
		res, err := tx.ExecContext(ctx, `DELETE FROM canvas_connections WHERE id=$1 AND project_id=$2`, id, p)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return fmt.Errorf("connection not found")
		}
	}
	return nil
}
func (r *Postgres) createMarkdown(ctx context.Context, tx *sql.Tx, p string, c *mutation.CreateMarkdown) error {
	c.Placement.NodeID = c.NodeID
	if err := c.Placement.Validate(); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO canvas_nodes(id,project_id,kind,markdown) VALUES($1,$2,'markdown',$3)`, c.NodeID, p, c.Markdown)
	if err != nil {
		return err
	}
	return r.insertPlacement(ctx, tx, p, c.Placement)
}
func (r *Postgres) updateMarkdown(ctx context.Context, tx *sql.Tx, p string, c *mutation.UpdateMarkdown) error {
	res, err := tx.ExecContext(ctx, `UPDATE canvas_nodes SET markdown=$3,updated_at=now() WHERE id=$1 AND project_id=$2 AND kind='markdown'`, c.NodeID, p, c.Markdown)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return fmt.Errorf("markdown node not found")
	}
	return nil
}
func (r *Postgres) createAssetNode(ctx context.Context, tx *sql.Tx, p string, c *mutation.CreateAsset) error {
	c.Placement.NodeID = c.NodeID
	if err := c.Placement.Validate(); err != nil {
		return err
	}
	var kind string
	err := tx.QueryRowContext(ctx, `SELECT kind FROM assets WHERE id=$1 AND project_id=$2`, c.AssetID, p).Scan(&kind)
	if err != nil {
		return fmt.Errorf("asset not found: %w", err)
	}
	nk, err := domain.NodeKindForAsset(domain.AssetKind(kind))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO canvas_nodes(id,project_id,kind,asset_id) VALUES($1,$2,$3,$4)`, c.NodeID, p, nk, c.AssetID)
	if err != nil {
		return err
	}
	return r.insertPlacement(ctx, tx, p, c.Placement)
}
func (r *Postgres) createFrame(ctx context.Context, tx *sql.Tx, p string, c *mutation.CreateFrame) error {
	c.Placement.NodeID = c.NodeID
	if err := c.Placement.Validate(); err != nil {
		return err
	}
	frame, err := json.Marshal(c.FrameData)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO canvas_nodes(id,project_id,kind,frame_data) VALUES($1,$2,'frame',$3::jsonb)`, c.NodeID, p, frame)
	if err != nil {
		return err
	}
	return r.insertPlacement(ctx, tx, p, c.Placement)
}
func (r *Postgres) updateFrame(ctx context.Context, tx *sql.Tx, p string, c *mutation.UpdateFrame) error {
	res, err := tx.ExecContext(ctx, `UPDATE canvas_nodes SET frame_data=jsonb_set(frame_data, '{title}', to_jsonb($3::text), true),updated_at=now() WHERE id=$1 AND project_id=$2 AND kind='frame'`, c.NodeID, p, c.Title)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return fmt.Errorf("frame node not found")
	}
	return nil
}
func (r *Postgres) insertPlacement(ctx context.Context, tx *sql.Tx, p string, x domain.Placement) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO canvas_node_placements(node_id,project_id,x,y,width,height,z_index) VALUES($1,$2,$3,$4,$5,$6,$7)`, x.NodeID, p, x.X, x.Y, x.Width, x.Height, x.ZIndex)
	return err
}
func (r *Postgres) deleteNodes(ctx context.Context, tx *sql.Tx, p string, ids []string) error {
	for _, id := range ids {
		res, err := tx.ExecContext(ctx, `DELETE FROM canvas_node_placements WHERE node_id=$1 AND project_id=$2`, id, p)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return fmt.Errorf("node not found")
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM canvas_nodes WHERE id=$1 AND project_id=$2`, id, p); err != nil {
			return err
		}
	}
	return nil
}
func (r *Postgres) setPlacements(ctx context.Context, tx *sql.Tx, p string, ps []domain.Placement) error {
	for _, x := range ps {
		res, err := tx.ExecContext(ctx, `UPDATE canvas_node_placements SET x=$3,y=$4,width=$5,height=$6,z_index=$7 WHERE node_id=$1 AND project_id=$2`, x.NodeID, p, x.X, x.Y, x.Width, x.Height, x.ZIndex)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return fmt.Errorf("node not found")
		}
	}
	return nil
}
func (r *Postgres) Commit(ctx context.Context, tx *sql.Tx, p, requestID, hash string, revision int64, s domain.Snapshot) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE canvas_documents SET revision=$2,updated_at=now() WHERE project_id=$1`, p, revision); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO canvas_command_receipts(project_id,request_id,request_hash,revision,response_snapshot) VALUES($1,$2,$3,$4,$5::jsonb)`, p, requestID, hash, revision, raw); err != nil {
		return err
	}
	return tx.Commit()
}
func (r *Postgres) Snapshot(ctx context.Context, q queryer, p string) (domain.Snapshot, error) {
	var rev int64
	if err := q.QueryRowContext(ctx, `SELECT revision FROM canvas_documents WHERE project_id=$1`, p).Scan(&rev); err != nil {
		return domain.Snapshot{}, err
	}
	rows, err := q.QueryContext(ctx, `SELECT n.id,n.kind,n.markdown,n.asset_id,n.frame_data,n.created_at,n.updated_at,a.display_name,a.mime_type,a.format,a.metadata,a.processing,a.normalized_url,COALESCE((SELECT jsonb_object_agg(pa.renderer,jsonb_build_object('status',pa.status,'metadata',pa.metadata)) FROM preview_artifacts pa WHERE pa.asset_id=a.id),'{}'::jsonb) FROM canvas_nodes n LEFT JOIN assets a ON a.id=n.asset_id AND a.project_id=n.project_id WHERE n.project_id=$1 ORDER BY n.created_at,n.id`, p)
	if err != nil {
		return domain.Snapshot{}, err
	}
	defer rows.Close()
	s := domain.Snapshot{ProjectID: p, Revision: rev, Nodes: make([]domain.SnapshotNode, 0), Placements: make([]domain.Placement, 0), Connections: make([]domain.Connection, 0)}
	for rows.Next() {
		var id, kind string
		var markdown, assetID, frame, display, mime, format, metadata, processing, url, artifacts []byte
		var created, updated time.Time
		if err := rows.Scan(&id, &kind, &markdown, &assetID, &frame, &created, &updated, &display, &mime, &format, &metadata, &processing, &url, &artifacts); err != nil {
			return s, err
		}
		node := domain.SnapshotNode{ID: id, Kind: domain.NodeKind(kind), CreatedAt: created.UTC().Format(time.RFC3339), UpdatedAt: updated.UTC().Format(time.RFC3339)}
		populate(&node, markdown, assetID, frame, display, mime, format, metadata, processing, url, artifacts)
		s.Nodes = append(s.Nodes, node)
	}
	if err := rows.Err(); err != nil {
		return s, err
	}
	pr, err := q.QueryContext(ctx, `SELECT node_id,x,y,width,height,z_index FROM canvas_node_placements WHERE project_id=$1 ORDER BY z_index,node_id`, p)
	if err != nil {
		return s, err
	}
	defer pr.Close()
	for pr.Next() {
		var x domain.Placement
		if err := pr.Scan(&x.NodeID, &x.X, &x.Y, &x.Width, &x.Height, &x.ZIndex); err != nil {
			return s, err
		}
		s.Placements = append(s.Placements, x)
	}
	if err := pr.Err(); err != nil {
		return s, err
	}
	cr, err := q.QueryContext(ctx, `SELECT id,COALESCE(source_node_id::text,''),COALESCE(CASE WHEN source_node_id IS NULL THEN NULL ELSE source_handle END,''),source_x,source_y,COALESCE(target_node_id::text,''),COALESCE(CASE WHEN target_node_id IS NULL THEN NULL ELSE target_handle END,''),target_x,target_y,shape,stroke,direction FROM canvas_connections WHERE project_id=$1 ORDER BY created_at,id`, p)
	if err != nil {
		return s, err
	}
	defer cr.Close()
	for cr.Next() {
		var connection domain.Connection
		if err := cr.Scan(&connection.ID, &connection.SourceNodeID, &connection.SourceHandle, &connection.SourceX, &connection.SourceY, &connection.TargetNodeID, &connection.TargetHandle, &connection.TargetX, &connection.TargetY, &connection.Shape, &connection.Stroke, &connection.Direction); err != nil {
			return s, err
		}
		s.Connections = append(s.Connections, connection)
	}
	return s, cr.Err()
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func populate(n *domain.SnapshotNode, md, assetID, frame, display, mime, format, metadata, processing, url, artifacts []byte) {
	n.Title = string(display)
	switch n.Kind {
	case domain.Markdown:
		n.Title = markdownTitle(string(md))
		n.Summary = summary(string(md))
		n.RenderData = map[string]any{"kind": "markdown", "markdown": string(md)}
	case domain.Frame:
		var f domain.FrameData
		_ = json.Unmarshal(frame, &f)
		n.Title = f.Title
		n.Summary = f.Description
		n.RenderData = map[string]any{"kind": "frame", "description": f.Description, "color": f.Color}
	default:
		n.AssetID = string(assetID)
		n.Summary = ""
		n.RenderData = render(n.Kind, string(display), string(mime), string(format), string(metadata), string(processing), string(url), string(artifacts))
	}
}
func render(k domain.NodeKind, name, mime, format, metadata, processing, url, artifacts string) any {
	meta := decodeJSON(metadata)
	state := stringValue(decodeJSON(processing), "state")
	ready := func(renderer string) bool { return stringValue(nestedJSON(artifacts, renderer), "status") == "ready" }
	switch k {
	case domain.Image:
		return map[string]any{"kind": "image", "previewAvailable": state == "ready", "format": format}
	case domain.Audio:
		return map[string]any{"kind": "audio", "format": format, "durationMs": nonNegativeInt(meta, "durationMs"), "waveform": waveform(meta), "sceneLabel": stringValue(meta, "sceneLabel")}
	case domain.Video:
		return map[string]any{"kind": "video", "posterAvailable": ready("video-poster"), "durationMs": nonNegativeInt(meta, "durationMs"), "shotLabel": stringValue(meta, "shotLabel")}
	case domain.WebPreview:
		return map[string]any{"kind": "web-preview", "url": url, "embeddable": state == "ready"}
	case domain.HTML:
		return map[string]any{"kind": "html", "previewAvailable": state == "ready"}
	case domain.PDF:
		return map[string]any{"kind": "pdf", "previewAvailable": state == "ready"}
	case domain.Office:
		officeKind, ok := officeKind(format)
		if !ok {
			return map[string]any{"kind": "office", "officeKind": "word", "fileType": "docx", "previewAvailable": false}
		}
		return map[string]any{"kind": "office", "officeKind": officeKind, "fileType": format, "previewAvailable": state == "ready"}
	default:
		return nil
	}
}
func decodeJSON(raw string) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}
func nestedJSON(raw, key string) map[string]any {
	value, _ := decodeJSON(raw)[key].(map[string]any)
	return value
}
func stringValue(value map[string]any, key string) string {
	result, _ := value[key].(string)
	return result
}
func nonNegativeInt(value map[string]any, key string) int64 {
	n, ok := value[key].(float64)
	if !ok || n < 0 || n != float64(int64(n)) {
		return 0
	}
	return int64(n)
}
func waveform(value map[string]any) []float64 {
	raw, ok := value["waveform"].([]any)
	if !ok || len(raw) != 64 {
		return make([]float64, 64)
	}
	out := make([]float64, 64)
	for index, point := range raw {
		n, ok := point.(float64)
		if !ok || n < 0 || n > 1 {
			return make([]float64, 64)
		}
		out[index] = n
	}
	return out
}
func officeKind(format string) (string, bool) {
	switch format {
	case "doc", "docx":
		return "word", true
	case "xls", "xlsx":
		return "spreadsheet", true
	case "ppt", "pptx":
		return "presentation", true
	}
	return "", false
}

var markdownSyntax = regexp.MustCompile(`(?m)(^\s{0,3}#{1,6}\s*|^\s*>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+|[*_` + "`" + `~]{1,3}|!?(?:\[[^\]]*\]\([^)]*\)))`)
var markdownSpace = regexp.MustCompile(`\s+`)

func markdownPlainText(s string) string {
	s = markdownSyntax.ReplaceAllString(s, "")
	return strings.TrimSpace(markdownSpace.ReplaceAllString(s, " "))
}
func markdownTitle(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if title := markdownPlainText(line); title != "" {
			r := []rune(title)
			if len(r) > 80 {
				r = r[:80]
			}
			return string(r)
		}
	}
	return "Untitled text"
}
func summary(s string) string {
	r := []rune(markdownPlainText(s))
	if len(r) > 160 {
		r = r[:160]
	}
	return string(r)
}
