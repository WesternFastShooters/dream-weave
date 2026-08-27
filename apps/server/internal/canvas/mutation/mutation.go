// Package mutation validates the complete command batch before repository writes.
package mutation

import (
	"fmt"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"regexp"
	"strings"
)

type Mutation struct {
	CreateMarkdown    *CreateMarkdown    `json:"createMarkdownNode,omitempty"`
	UpdateMarkdown    *UpdateMarkdown    `json:"updateMarkdownNode,omitempty"`
	CreateAsset       *CreateAsset       `json:"createAssetNode,omitempty"`
	CreateFrame       *CreateFrame       `json:"createFrameNode,omitempty"`
	UpdateFrame       *UpdateFrame       `json:"updateFrameNode,omitempty"`
	DeleteNodes       *DeleteNodes       `json:"deleteNodes,omitempty"`
	SetPlacements     *SetPlacements     `json:"setPlacements,omitempty"`
	CreateConnection  *CreateConnection  `json:"createConnection,omitempty"`
	UpdateConnection  *UpdateConnection  `json:"updateConnection,omitempty"`
	DeleteConnections *DeleteConnections `json:"deleteConnections,omitempty"`
}
type CreateMarkdown struct {
	NodeID    string           `json:"nodeId"`
	Markdown  string           `json:"markdown"`
	Placement domain.Placement `json:"placement"`
}
type UpdateMarkdown struct {
	NodeID   string `json:"nodeId"`
	Markdown string `json:"markdown"`
}
type CreateAsset struct {
	NodeID    string           `json:"nodeId"`
	AssetID   string           `json:"assetId"`
	Placement domain.Placement `json:"placement"`
}
type CreateFrame struct {
	NodeID    string           `json:"nodeId"`
	FrameData domain.FrameData `json:"frameData"`
	Placement domain.Placement `json:"placement"`
}
type UpdateFrame struct {
	NodeID string `json:"nodeId"`
	Title  string `json:"title"`
}
type DeleteNodes struct {
	NodeIDs []string `json:"nodeIds"`
}
type SetPlacements struct {
	Placements []domain.Placement `json:"placements"`
}
type CreateConnection struct {
	Connection domain.Connection `json:"connection"`
}
type UpdateConnection struct {
	Connection domain.Connection `json:"connection"`
}
type DeleteConnections struct {
	ConnectionIDs []string `json:"connectionIds"`
}

func (m Mutation) Count() int {
	n := 0
	if m.CreateMarkdown != nil {
		n++
	}
	if m.UpdateMarkdown != nil {
		n++
	}
	if m.CreateAsset != nil {
		n++
	}
	if m.CreateFrame != nil {
		n++
	}
	if m.UpdateFrame != nil {
		n++
	}
	if m.DeleteNodes != nil {
		n++
	}
	if m.SetPlacements != nil {
		n++
	}
	if m.CreateConnection != nil {
		n++
	}
	if m.UpdateConnection != nil {
		n++
	}
	if m.DeleteConnections != nil {
		n++
	}
	return n
}
func ValidateBatch(ms []Mutation) error {
	if len(ms) == 0 {
		return fmt.Errorf("at least one mutation is required")
	}
	for i, m := range ms {
		if m.Count() != 1 {
			return fmt.Errorf("mutation %d must contain exactly one value", i)
		}
		if err := validate(m); err != nil {
			return fmt.Errorf("mutation %d: %w", i, err)
		}
	}
	return nil
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// IsUUID accepts RFC 4122 textual UUIDs only. All public canvas node and
// receipt identifiers are client-generated UUIDs, never application strings.
func IsUUID(value string) bool { return uuidPattern.MatchString(strings.ToLower(value)) }

func validate(m Mutation) error {
	switch {
	case m.CreateMarkdown != nil:
		c := m.CreateMarkdown
		if !IsUUID(c.NodeID) {
			return fmt.Errorf("node_id must be a UUID")
		}
		if err := requirePlacementNodeID(c.NodeID, c.Placement.NodeID); err != nil {
			return err
		}
		if err := c.Placement.Validate(); err != nil {
			return err
		}
		return domain.ValidateNode(domain.Markdown, &c.Markdown, nil, nil)
	case m.UpdateMarkdown != nil:
		if !IsUUID(m.UpdateMarkdown.NodeID) {
			return fmt.Errorf("node_id must be a UUID")
		}
	case m.CreateAsset != nil:
		c := m.CreateAsset
		if !IsUUID(c.NodeID) || !IsUUID(c.AssetID) {
			return fmt.Errorf("node_id and asset_id must be UUIDs")
		}
		if err := requirePlacementNodeID(c.NodeID, c.Placement.NodeID); err != nil {
			return err
		}
		return c.Placement.Validate()
	case m.CreateFrame != nil:
		c := m.CreateFrame
		if !IsUUID(c.NodeID) {
			return fmt.Errorf("node_id must be a UUID")
		}
		if err := requirePlacementNodeID(c.NodeID, c.Placement.NodeID); err != nil {
			return err
		}
		return c.Placement.Validate()
	case m.UpdateFrame != nil:
		if !IsUUID(m.UpdateFrame.NodeID) {
			return fmt.Errorf("node_id must be a UUID")
		}
		if strings.TrimSpace(m.UpdateFrame.Title) == "" {
			return fmt.Errorf("title is required")
		}
	case m.DeleteNodes != nil:
		if len(m.DeleteNodes.NodeIDs) == 0 {
			return fmt.Errorf("node_ids is required")
		}
		seen := map[string]bool{}
		for _, id := range m.DeleteNodes.NodeIDs {
			if !IsUUID(id) || seen[id] {
				return fmt.Errorf("node_ids must be unique UUIDs")
			}
			seen[id] = true
		}
	case m.SetPlacements != nil:
		if len(m.SetPlacements.Placements) == 0 {
			return fmt.Errorf("placements is required")
		}
		seen := map[string]bool{}
		for _, p := range m.SetPlacements.Placements {
			if !IsUUID(p.NodeID) {
				return fmt.Errorf("placement node_id must be a UUID")
			}
			if err := p.Validate(); err != nil {
				return err
			}
			if seen[p.NodeID] {
				return fmt.Errorf("duplicate placement")
			}
			seen[p.NodeID] = true
		}
	case m.CreateConnection != nil:
		return validateConnection(m.CreateConnection.Connection)
	case m.UpdateConnection != nil:
		return validateConnection(m.UpdateConnection.Connection)
	case m.DeleteConnections != nil:
		if len(m.DeleteConnections.ConnectionIDs) == 0 {
			return fmt.Errorf("connection_ids is required")
		}
		seen := map[string]bool{}
		for _, id := range m.DeleteConnections.ConnectionIDs {
			if !IsUUID(id) || seen[id] {
				return fmt.Errorf("connection_ids must be unique UUIDs")
			}
			seen[id] = true
		}
	}
	return nil
}

func validateConnection(connection domain.Connection) error {
	if !IsUUID(connection.ID) || (connection.SourceNodeID != "" && !IsUUID(connection.SourceNodeID)) || (connection.TargetNodeID != "" && !IsUUID(connection.TargetNodeID)) {
		return fmt.Errorf("connection id and attached node ids must be UUIDs")
	}
	return connection.Validate()
}

// Placement belongs to the enclosing create mutation. An omitted nodeId is
// filled for wire compatibility; a supplied different value is never rewritten.
func requirePlacementNodeID(nodeID string, placementNodeID string) error {
	if placementNodeID == "" {
		return nil
	}
	if placementNodeID != nodeID {
		return fmt.Errorf("placement.node_id must match node_id")
	}
	return nil
}
