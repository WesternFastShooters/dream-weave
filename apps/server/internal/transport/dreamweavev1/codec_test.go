package dreamweavev1

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	"github.com/dream-weave/dream-weave/apps/server/internal/canvas/domain"
	"github.com/dream-weave/dream-weave/apps/server/internal/identity"
)

func TestGeneratedRouteUsesStrictProtoDecoder(t *testing.T) {
	handler := NewHandler(Services{Identity: &identity.Service{AppOrigin: "https://app.test"}}, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/dreamweave/v1/projects/project-1/asset-uploads", strings.NewReader(`{"projectId":"project-1","fileName":"image.png","declaredMimeType":"image/png","byteSize":"42","unknown":true}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://app.test")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d body = %s, want generated route validation 422", response.Code, response.Body.String())
	}
}

func TestDecodeProtoJSONRejectsUnknownFields(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"projectId":"p","unknown":true}`))
	err := decodeProtoJSON(request, &v1.GetCanvasRequest{})
	if err == nil {
		t.Fatal("decodeProtoJSON() error = nil, want validation error")
	}
	response := httptest.NewRecorder()
	apierror.Write(response, err)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"validation"`) || !strings.Contains(response.Body.String(), `"fieldViolations"`) {
		t.Fatalf("body = %s, want canonical validation details", response.Body.String())
	}
}

func TestAPIErrorUsesCanonicalProtoJSONAndStringInt64(t *testing.T) {
	response := httptest.NewRecorder()
	apierror.Write(response, apierror.Conflict(42))
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.Code)
	}
	body, _ := io.ReadAll(response.Result().Body)
	want := `{"code":"CANVAS_REVISION_CONFLICT","message":"canvas revision conflict","canvasRevisionConflict":{"currentRevision":"42"}}`
	var compact bytes.Buffer
	if err := json.Compact(&compact, body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if compact.String() != want {
		t.Fatalf("body = %s, want %s", body, want)
	}
}

func TestEncodeProtoJSONEmitsEmptyRepeatedContractFields(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	if err := encodeProtoJSON(response, request, snapshotToProto(domain.Snapshot{ProjectID: "project-1"})); err != nil {
		t.Fatalf("encodeProtoJSON() error = %v", err)
	}
	body := response.Body.String()
	if !strings.Contains(body, `"revision":"0"`) || !strings.Contains(body, `"nodes":[]`) || !strings.Contains(body, `"placements":[]`) || !strings.Contains(body, `"connections":[]`) {
		t.Fatalf("body = %s, want emitted int64 and repeated fields", body)
	}
}

func TestSnapshotMappingUsesGeneratedRenderDataOneof(t *testing.T) {
	snapshot := snapshotToProto(domain.Snapshot{
		ProjectID: "project-1",
		Revision:  7,
		Nodes: []domain.SnapshotNode{{
			ID: "node-1", Kind: domain.Audio, Title: "Audio", AssetID: "asset-1",
			RenderData: map[string]any{"format": "mp3", "durationMs": int64(1200), "waveform": make([]float64, 64), "sceneLabel": "intro"},
		}},
	})
	if snapshot.GetRevision() != 7 {
		t.Fatalf("revision = %d, want 7", snapshot.GetRevision())
	}
	audio := snapshot.GetNodes()[0].GetRenderData().GetAudio()
	if audio == nil || audio.GetDurationMs() != 1200 || len(audio.GetWaveform()) != 64 {
		t.Fatalf("audio = %#v, want generated audio render data", audio)
	}
}
