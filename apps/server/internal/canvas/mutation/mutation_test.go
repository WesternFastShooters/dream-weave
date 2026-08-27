package mutation

import (
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"testing"
)

func TestBatchRejectsAmbiguousAndInvalidPlacement(t *testing.T) {
	if e := ValidateBatch([]Mutation{{}}); e == nil {
		t.Fatal("empty mutation accepted")
	}
	if e := ValidateBatch([]Mutation{{CreateMarkdown: &CreateMarkdown{NodeID: "n", Markdown: "x", Placement: domain.Placement{NodeID: "n", Width: -1, Height: 1}}}}); e == nil {
		t.Fatal("invalid markdown placement accepted")
	}
	if e := ValidateBatch([]Mutation{{DeleteNodes: &DeleteNodes{NodeIDs: []string{"n", "n"}}}}); e == nil {
		t.Fatal("duplicate deletion accepted")
	}
}

func TestBatchRequiresClientUUIDNodeIDs(t *testing.T) {
	id := "5a30b237-01f8-44d8-956b-208c3974a8be"
	batch := []Mutation{{CreateMarkdown: &CreateMarkdown{NodeID: id, Markdown: "x", Placement: domain.Placement{NodeID: id, Width: 1, Height: 1}}}}
	if err := ValidateBatch(batch); err != nil {
		t.Fatalf("valid UUID node id rejected: %v", err)
	}
	batch[0].CreateMarkdown.NodeID = "not-a-uuid"
	if err := ValidateBatch(batch); err == nil {
		t.Fatal("non-UUID node id accepted")
	}
}

func TestBatchRejectsConflictingPlacementNodeID(t *testing.T) {
	id := "5a30b237-01f8-44d8-956b-208c3974a8be"
	other := "97f7ed9d-3994-4207-b8cf-6ce4ddc2c4b5"
	err := ValidateBatch([]Mutation{{CreateMarkdown: &CreateMarkdown{NodeID: id, Markdown: "x", Placement: domain.Placement{NodeID: other, Width: 1, Height: 1}}}})
	if err == nil {
		t.Fatal("mismatched placement node id accepted")
	}
}

func TestBatchValidatesFrameTitleUpdates(t *testing.T) {
	id := "5a30b237-01f8-44d8-956b-208c3974a8be"
	if err := ValidateBatch([]Mutation{{UpdateFrame: &UpdateFrame{NodeID: id, Title: "UI-home"}}}); err != nil {
		t.Fatalf("valid Frame title update rejected: %v", err)
	}
	if err := ValidateBatch([]Mutation{{UpdateFrame: &UpdateFrame{NodeID: id, Title: "   "}}}); err == nil {
		t.Fatal("blank Frame title accepted")
	}
}

func TestBatchValidatesConnectionMutations(t *testing.T) {
	connection := domain.Connection{
		ID:           "2b0c9d21-22b5-4d31-b602-18de60ba92fd",
		SourceNodeID: "5a30b237-01f8-44d8-956b-208c3974a8be", SourceHandle: "right",
		TargetNodeID: "97f7ed9d-3994-4207-b8cf-6ce4ddc2c4b5", TargetHandle: "left",
		SourceX: 120, SourceY: 80, TargetX: 360, TargetY: 80,
		Shape: "curve", Stroke: "solid", Direction: "forward",
	}
	if err := ValidateBatch([]Mutation{{CreateConnection: &CreateConnection{Connection: connection}}}); err != nil {
		t.Fatalf("valid connection rejected: %v", err)
	}
	invalid := connection
	invalid.Direction = "sideways"
	if err := ValidateBatch([]Mutation{{UpdateConnection: &UpdateConnection{Connection: invalid}}}); err == nil {
		t.Fatal("invalid connection direction accepted")
	}
	floating := connection
	floating.SourceNodeID, floating.SourceHandle, floating.TargetNodeID, floating.TargetHandle = "", "", "", ""
	if err := ValidateBatch([]Mutation{{CreateConnection: &CreateConnection{Connection: floating}}}); err != nil { t.Fatalf("floating connection rejected: %v", err) }
	if err := ValidateBatch([]Mutation{{DeleteConnections: &DeleteConnections{ConnectionIDs: []string{connection.ID, connection.ID}}}}); err == nil {
		t.Fatal("duplicate connection deletion accepted")
	}
}
