package service

import (
	"testing"

	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/mutation"
)

func TestRequestHashIncludesExpectedRevision(t *testing.T) {
	mutations := []mutation.Mutation{{DeleteNodes: &mutation.DeleteNodes{NodeIDs: []string{"5a30b237-01f8-44d8-956b-208c3974a8be"}}}}
	first, err := hashRequest(2, mutations)
	if err != nil {
		t.Fatal(err)
	}
	second, err := hashRequest(3, mutations)
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("expected revision must affect the idempotency hash")
	}
}
