package dreamweavev1

import (
	"context"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/mutation"
	canvas "github.com/dream-weave/dream-weave/apps/server/internal/canvas/service"
)

type canvasTransport struct {
	v1.UnimplementedCanvasServiceServer
	canvas *canvas.Service
}

func (t *canvasTransport) GetCanvas(ctx context.Context, request *v1.GetCanvasRequest) (*v1.CanvasDocumentSnapshot, error) {
	snapshot, err := t.canvas.Get(ctx, request.GetProjectId())
	if err != nil {
		return nil, err
	}
	return snapshotToProto(snapshot), nil
}

func (t *canvasTransport) ApplyCanvasMutations(ctx context.Context, request *v1.ApplyCanvasMutationsRequest) (*v1.CanvasDocumentSnapshot, error) {
	mutations := make([]mutation.Mutation, 0, len(request.GetMutations()))
	for _, value := range request.GetMutations() {
		mutations = append(mutations, mutationFromProto(value))
	}
	snapshot, err := t.canvas.Apply(ctx, canvas.ApplyRequest{
		ProjectID:        request.GetProjectId(),
		ExpectedRevision: request.GetExpectedRevision(),
		RequestID:        request.GetRequestId(),
		Mutations:        mutations,
	})
	if err != nil {
		return nil, err
	}
	return snapshotToProto(snapshot), nil
}

func mutationFromProto(value *v1.CanvasMutation) mutation.Mutation {
	if value == nil {
		return mutation.Mutation{}
	}
	switch item := value.Value.(type) {
	case *v1.CanvasMutation_CreateMarkdownNode:
		input := item.CreateMarkdownNode
		return mutation.Mutation{CreateMarkdown: &mutation.CreateMarkdown{NodeID: input.GetNodeId(), Markdown: input.GetMarkdown(), Placement: placementFromProto(input.GetPlacement())}}
	case *v1.CanvasMutation_UpdateMarkdownNode:
		input := item.UpdateMarkdownNode
		return mutation.Mutation{UpdateMarkdown: &mutation.UpdateMarkdown{NodeID: input.GetNodeId(), Markdown: input.GetMarkdown()}}
	case *v1.CanvasMutation_CreateAssetNode:
		input := item.CreateAssetNode
		return mutation.Mutation{CreateAsset: &mutation.CreateAsset{NodeID: input.GetNodeId(), AssetID: input.GetAssetId(), Placement: placementFromProto(input.GetPlacement())}}
	case *v1.CanvasMutation_CreateFrameNode:
		input := item.CreateFrameNode
		frame := input.GetFrameData()
		return mutation.Mutation{CreateFrame: &mutation.CreateFrame{
			NodeID:    input.GetNodeId(),
			FrameData: domain.FrameData{Title: frame.GetTitle(), Description: frame.GetDescription(), Color: frame.GetColor()},
			Placement: placementFromProto(input.GetPlacement()),
		}}
	case *v1.CanvasMutation_UpdateFrameNode:
		input := item.UpdateFrameNode
		return mutation.Mutation{UpdateFrame: &mutation.UpdateFrame{NodeID: input.GetNodeId(), Title: input.GetTitle()}}
	case *v1.CanvasMutation_DeleteNodes:
		return mutation.Mutation{DeleteNodes: &mutation.DeleteNodes{NodeIDs: append([]string(nil), item.DeleteNodes.GetNodeIds()...)}}
	case *v1.CanvasMutation_SetPlacements:
		placements := make([]domain.Placement, 0, len(item.SetPlacements.GetPlacements()))
		for _, placement := range item.SetPlacements.GetPlacements() {
			placements = append(placements, placementFromProto(placement))
		}
		return mutation.Mutation{SetPlacements: &mutation.SetPlacements{Placements: placements}}
	case *v1.CanvasMutation_CreateConnection:
		return mutation.Mutation{CreateConnection: &mutation.CreateConnection{Connection: connectionFromProto(item.CreateConnection.GetConnection())}}
	case *v1.CanvasMutation_UpdateConnection:
		return mutation.Mutation{UpdateConnection: &mutation.UpdateConnection{Connection: connectionFromProto(item.UpdateConnection.GetConnection())}}
	case *v1.CanvasMutation_DeleteConnections:
		return mutation.Mutation{DeleteConnections: &mutation.DeleteConnections{ConnectionIDs: append([]string(nil), item.DeleteConnections.GetConnectionIds()...)}}
	default:
		return mutation.Mutation{}
	}
}

func connectionFromProto(value *v1.CanvasConnection) domain.Connection {
	if value == nil {
		return domain.Connection{}
	}
	return domain.Connection{
		ID: value.GetId(), SourceNodeID: value.GetSourceNodeId(), SourceHandle: value.GetSourceHandle(),
		TargetNodeID: value.GetTargetNodeId(), TargetHandle: value.GetTargetHandle(),
		SourceX: value.GetSourceX(), SourceY: value.GetSourceY(), TargetX: value.GetTargetX(), TargetY: value.GetTargetY(),
		Shape: value.GetShape(), Stroke: value.GetStroke(), Direction: value.GetDirection(),
	}
}

func placementFromProto(value *v1.Placement) domain.Placement {
	if value == nil {
		return domain.Placement{}
	}
	return domain.Placement{NodeID: value.GetNodeId(), X: value.GetX(), Y: value.GetY(), Width: value.GetWidth(), Height: value.GetHeight(), ZIndex: int(value.GetZIndex())}
}

func snapshotToProto(snapshot domain.Snapshot) *v1.CanvasDocumentSnapshot {
	result := &v1.CanvasDocumentSnapshot{ProjectId: snapshot.ProjectID, Revision: snapshot.Revision}
	result.Nodes = make([]*v1.CanvasNodeSnapshot, 0, len(snapshot.Nodes))
	for _, node := range snapshot.Nodes {
		result.Nodes = append(result.Nodes, snapshotNodeToProto(node))
	}
	result.Placements = make([]*v1.Placement, 0, len(snapshot.Placements))
	for _, placement := range snapshot.Placements {
		result.Placements = append(result.Placements, placementToProto(placement))
	}
	result.Connections = make([]*v1.CanvasConnection, 0, len(snapshot.Connections))
	for _, connection := range snapshot.Connections {
		result.Connections = append(result.Connections, connectionToProto(connection))
	}
	return result
}

func connectionToProto(value domain.Connection) *v1.CanvasConnection {
	return &v1.CanvasConnection{
		Id: value.ID, SourceNodeId: value.SourceNodeID, SourceHandle: value.SourceHandle,
		TargetNodeId: value.TargetNodeID, TargetHandle: value.TargetHandle,
		SourceX: value.SourceX, SourceY: value.SourceY, TargetX: value.TargetX, TargetY: value.TargetY,
		Shape: value.Shape, Stroke: value.Stroke, Direction: value.Direction,
	}
}

func placementToProto(value domain.Placement) *v1.Placement {
	return &v1.Placement{NodeId: value.NodeID, X: value.X, Y: value.Y, Width: value.Width, Height: value.Height, ZIndex: int32(value.ZIndex)}
}

func snapshotNodeToProto(node domain.SnapshotNode) *v1.CanvasNodeSnapshot {
	return &v1.CanvasNodeSnapshot{
		Id: node.ID, Kind: string(node.Kind), Title: node.Title, Summary: node.Summary,
		AssetId: node.AssetID, RenderData: renderDataToProto(node.Kind, node.RenderData),
		CreatedAt: node.CreatedAt, UpdatedAt: node.UpdatedAt,
	}
}

func renderDataToProto(kind domain.NodeKind, raw any) *v1.RenderData {
	data, _ := raw.(map[string]any)
	switch kind {
	case domain.Markdown:
		return &v1.RenderData{Value: &v1.RenderData_Markdown{Markdown: &v1.MarkdownRenderData{Markdown: stringField(data, "markdown")}}}
	case domain.Image:
		return &v1.RenderData{Value: &v1.RenderData_Image{Image: &v1.ImageRenderData{PreviewAvailable: boolField(data, "previewAvailable"), Format: stringField(data, "format")}}}
	case domain.Audio:
		return &v1.RenderData{Value: &v1.RenderData_Audio{Audio: &v1.AudioRenderData{Format: stringField(data, "format"), DurationMs: int64Field(data, "durationMs"), Waveform: floatSliceField(data, "waveform"), SceneLabel: stringField(data, "sceneLabel")}}}
	case domain.Video:
		return &v1.RenderData{Value: &v1.RenderData_Video{Video: &v1.VideoRenderData{PosterAvailable: boolField(data, "posterAvailable"), DurationMs: int64Field(data, "durationMs"), ShotLabel: stringField(data, "shotLabel")}}}
	case domain.WebPreview:
		return &v1.RenderData{Value: &v1.RenderData_WebPreview{WebPreview: &v1.WebRenderData{Url: stringField(data, "url"), Embeddable: boolField(data, "embeddable")}}}
	case domain.HTML:
		return &v1.RenderData{Value: &v1.RenderData_Html{Html: &v1.HtmlRenderData{PreviewAvailable: boolField(data, "previewAvailable")}}}
	case domain.PDF:
		return &v1.RenderData{Value: &v1.RenderData_Pdf{Pdf: &v1.PdfRenderData{PreviewAvailable: boolField(data, "previewAvailable")}}}
	case domain.Office:
		return &v1.RenderData{Value: &v1.RenderData_Office{Office: &v1.OfficeRenderData{OfficeKind: stringField(data, "officeKind"), FileType: stringField(data, "fileType"), PreviewAvailable: boolField(data, "previewAvailable")}}}
	case domain.Frame:
		return &v1.RenderData{Value: &v1.RenderData_Frame{Frame: &v1.FrameRenderData{Description: stringField(data, "description"), Color: stringField(data, "color")}}}
	default:
		return nil
	}
}

func stringField(data map[string]any, key string) string {
	value, _ := data[key].(string)
	return value
}
func boolField(data map[string]any, key string) bool {
	value, _ := data[key].(bool)
	return value
}
func int64Field(data map[string]any, key string) int64 {
	switch value := data[key].(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case float64:
		return int64(value)
	default:
		return 0
	}
}
func floatSliceField(data map[string]any, key string) []float64 {
	switch values := data[key].(type) {
	case []float64:
		return append([]float64(nil), values...)
	case []any:
		result := make([]float64, 0, len(values))
		for _, value := range values {
			number, ok := value.(float64)
			if !ok {
				return nil
			}
			result = append(result, number)
		}
		return result
	default:
		return nil
	}
}
