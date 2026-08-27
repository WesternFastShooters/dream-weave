// Package domain contains the persistence-safe Canvas contract. Runtime URLs and credentials are deliberately absent.
package domain

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type NodeKind string

const (
	Markdown   NodeKind = "markdown"
	Image      NodeKind = "image"
	Audio      NodeKind = "audio"
	Video      NodeKind = "video"
	WebPreview NodeKind = "web-preview"
	HTML       NodeKind = "html"
	PDF        NodeKind = "pdf"
	Office     NodeKind = "office"
	Frame      NodeKind = "frame"
)

type AssetKind string

const (
	AssetImage  AssetKind = "image"
	AssetAudio  AssetKind = "audio"
	AssetVideo  AssetKind = "video"
	AssetPDF    AssetKind = "pdf"
	AssetOffice AssetKind = "office"
	AssetWeb    AssetKind = "web"
	AssetHTML   AssetKind = "html"
)

type Placement struct {
	NodeID string  `json:"nodeId"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	ZIndex int     `json:"zIndex"`
}

type Connection struct {
	ID           string `json:"id"`
	SourceNodeID string `json:"sourceNodeId"`
	SourceHandle string `json:"sourceHandle"`
	SourceX      float64 `json:"sourceX"`
	SourceY      float64 `json:"sourceY"`
	TargetNodeID string `json:"targetNodeId"`
	TargetHandle string `json:"targetHandle"`
	TargetX      float64 `json:"targetX"`
	TargetY      float64 `json:"targetY"`
	Shape        string `json:"shape"`
	Stroke       string `json:"stroke"`
	Direction    string `json:"direction"`
}

func (c Connection) Validate() error {
	if strings.TrimSpace(c.ID) == "" || !finite(c.SourceX) || !finite(c.SourceY) || !finite(c.TargetX) || !finite(c.TargetY) {
		return fmt.Errorf("invalid connection")
	}
	if (c.SourceNodeID == "") != (c.SourceHandle == "") || (c.TargetNodeID == "") != (c.TargetHandle == "") {
		return fmt.Errorf("invalid connection handle")
	}
	if (c.SourceHandle != "" && !oneOf(c.SourceHandle, "top", "right", "bottom", "left")) || (c.TargetHandle != "" && !oneOf(c.TargetHandle, "top", "right", "bottom", "left")) { return fmt.Errorf("invalid connection handle") }
	if !oneOf(c.Shape, "straight", "curve", "elbow") || !oneOf(c.Stroke, "solid", "dashed") || !oneOf(c.Direction, "none", "forward", "both") {
		return fmt.Errorf("invalid connection style")
	}
	return nil
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

func (p Placement) Validate() error {
	if strings.TrimSpace(p.NodeID) == "" || !finite(p.X) || !finite(p.Y) || !finite(p.Width) || !finite(p.Height) || p.Width <= 0 || p.Height <= 0 {
		return fmt.Errorf("invalid placement")
	}
	return nil
}
func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }

type FrameData struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Color       string `json:"color"`
}
type Node struct {
	ID        string
	ProjectID string
	Kind      NodeKind
	Markdown  *string
	AssetID   *string
	Frame     *FrameData
	CreatedAt time.Time
	UpdatedAt time.Time
}
type Asset struct {
	ID            string
	ProjectID     string
	Kind          AssetKind
	DisplayName   string
	MIMEType      string
	Format        string
	Metadata      map[string]any
	Processing    map[string]any
	StorageRef    *string
	NormalizedURL *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}
type SnapshotNode struct {
	ID         string   `json:"id"`
	Kind       NodeKind `json:"kind"`
	Title      string   `json:"title"`
	Summary    string   `json:"summary"`
	AssetID    string   `json:"assetId,omitempty"`
	RenderData any      `json:"renderData"`
	CreatedAt  string   `json:"createdAt"`
	UpdatedAt  string   `json:"updatedAt"`
}
type Snapshot struct {
	ProjectID   string         `json:"projectId"`
	Revision    int64          `json:"revision,string"`
	Nodes       []SnapshotNode `json:"nodes"`
	Placements  []Placement    `json:"placements"`
	Connections []Connection   `json:"connections"`
}

func NodeKindForAsset(k AssetKind) (NodeKind, error) {
	switch k {
	case AssetImage:
		return Image, nil
	case AssetAudio:
		return Audio, nil
	case AssetVideo:
		return Video, nil
	case AssetPDF:
		return PDF, nil
	case AssetOffice:
		return Office, nil
	case AssetWeb:
		return WebPreview, nil
	case AssetHTML:
		return HTML, nil
	default:
		return "", fmt.Errorf("unsupported asset kind %q", k)
	}
}
func ValidateNode(kind NodeKind, markdown *string, assetID *string, frame *FrameData) error {
	switch kind {
	case Markdown:
		if markdown == nil || assetID != nil || frame != nil {
			return fmt.Errorf("markdown content is invalid")
		}
	case Frame:
		if frame == nil || markdown != nil || assetID != nil {
			return fmt.Errorf("frame content is invalid")
		}
	case Image, Audio, Video, WebPreview, HTML, PDF, Office:
		if assetID == nil || *assetID == "" || markdown != nil || frame != nil {
			return fmt.Errorf("asset content is invalid")
		}
	default:
		return fmt.Errorf("unknown node kind")
	}
	return nil
}
