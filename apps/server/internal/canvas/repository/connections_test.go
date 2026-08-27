package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/mutation"
)

func TestApplyPersistsConnectionLifecycle(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	repository := New(db)
	connection := domain.Connection{
		ID:           "2b0c9d21-22b5-4d31-b602-18de60ba92fd",
		SourceNodeID: "5a30b237-01f8-44d8-956b-208c3974a8be", SourceHandle: "right",
		TargetNodeID: "97f7ed9d-3994-4207-b8cf-6ce4ddc2c4b5", TargetHandle: "left",
		SourceX: 120, SourceY: 80, TargetX: 360, TargetY: 80,
		Shape: "curve", Stroke: "solid", Direction: "forward",
	}
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO canvas_connections(id,project_id,source_node_id,source_handle,source_x,source_y,target_node_id,target_handle,target_x,target_y,shape,stroke,direction) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6,NULLIF($7,''),NULLIF($8,''),$9,$10,$11,$12,$13)`)).
		WithArgs(connection.ID, "project", connection.SourceNodeID, "right", float64(120), float64(80), connection.TargetNodeID, "left", float64(360), float64(80), "curve", "solid", "forward").
		WillReturnResult(sqlmock.NewResult(1, 1))
	updated := connection
	updated.Stroke = "dashed"
	updated.Direction = "both"
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE canvas_connections SET source_node_id=NULLIF($3,''),source_handle=NULLIF($4,''),source_x=$5,source_y=$6,target_node_id=NULLIF($7,''),target_handle=NULLIF($8,''),target_x=$9,target_y=$10,shape=$11,stroke=$12,direction=$13,updated_at=now() WHERE id=$1 AND project_id=$2`)).
		WithArgs(updated.ID, "project", updated.SourceNodeID, "right", float64(120), float64(80), updated.TargetNodeID, "left", float64(360), float64(80), "curve", "dashed", "both").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM canvas_connections WHERE id=$1 AND project_id=$2`)).
		WithArgs(connection.ID, "project").WillReturnResult(sqlmock.NewResult(0, 1))

	err = repository.Apply(context.Background(), tx, "project", []mutation.Mutation{
		{CreateConnection: &mutation.CreateConnection{Connection: connection}},
		{UpdateConnection: &mutation.UpdateConnection{Connection: updated}},
		{DeleteConnections: &mutation.DeleteConnections{ConnectionIDs: []string{connection.ID}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectRollback()
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSnapshotLoadsConnections(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repository := New(db)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT revision FROM canvas_documents WHERE project_id=$1`)).WithArgs("project").WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(4))
	mock.ExpectQuery(`SELECT n.id,n.kind`).WithArgs("project").WillReturnRows(sqlmock.NewRows([]string{"id", "kind", "markdown", "asset_id", "frame_data", "created_at", "updated_at", "display_name", "mime_type", "format", "metadata", "processing", "normalized_url", "artifacts"}))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT node_id,x,y,width,height,z_index FROM canvas_node_placements WHERE project_id=$1 ORDER BY z_index,node_id`)).WithArgs("project").WillReturnRows(sqlmock.NewRows([]string{"node_id", "x", "y", "width", "height", "z_index"}))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id,COALESCE(source_node_id::text,''),COALESCE(CASE WHEN source_node_id IS NULL THEN NULL ELSE source_handle END,''),source_x,source_y,COALESCE(target_node_id::text,''),COALESCE(CASE WHEN target_node_id IS NULL THEN NULL ELSE target_handle END,''),target_x,target_y,shape,stroke,direction FROM canvas_connections WHERE project_id=$1 ORDER BY created_at,id`)).WithArgs("project").
		WillReturnRows(sqlmock.NewRows([]string{"id", "source_node_id", "source_handle", "source_x", "source_y", "target_node_id", "target_handle", "target_x", "target_y", "shape", "stroke", "direction"}).
			AddRow("edge", "a", "right", 10, 20, "b", "left", 30, 40, "curve", "dashed", "both"))
	snapshot, err := repository.Snapshot(context.Background(), db, "project")
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Connections) != 1 || snapshot.Connections[0].Direction != "both" {
		t.Fatalf("unexpected connections: %#v", snapshot.Connections)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
