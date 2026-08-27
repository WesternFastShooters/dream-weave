// Package apierror provides the single public error vocabulary used by HTTP bindings.
package apierror

import (
	"errors"
	"net/http"
	"sort"

	v1 "github.com/dream-weave/dream-weave/apps/server/api/dreamweave/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

type Error struct {
	Status  int
	Code    string
	Message string
	Details any
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }
func New(status int, code, message string, details any) *Error {
	return &Error{status, code, message, details}
}
func Validation(message string, fields map[string]string) *Error {
	return New(http.StatusUnprocessableEntity, "VALIDATION_FAILED", message, map[string]any{"fieldViolations": fields})
}
func Forbidden() *Error           { return New(http.StatusForbidden, "FORBIDDEN", "permission denied", nil) }
func NotFound(code string) *Error { return New(http.StatusNotFound, code, "not found", nil) }
func Conflict(revision int64) *Error {
	return New(http.StatusConflict, "CANVAS_REVISION_CONFLICT", "canvas revision conflict", map[string]any{"currentRevision": revision})
}
func Write(w http.ResponseWriter, err error) {
	var e *Error
	if !errors.As(err, &e) {
		e = New(http.StatusInternalServerError, "INTERNAL", "internal server error", nil)
	}
	body, marshalErr := (protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: true}).Marshal(toProto(e))
	if marshalErr != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(e.Status)
	_, _ = w.Write(body)
}

func toProto(e *Error) *v1.ApiError {
	result := &v1.ApiError{Code: e.Code, Message: e.Message}
	details, _ := e.Details.(map[string]any)
	switch e.Code {
	case "CANVAS_REVISION_CONFLICT":
		result.Details = &v1.ApiError_CanvasRevisionConflict{CanvasRevisionConflict: &v1.CanvasRevisionConflictDetails{CurrentRevision: int64Value(details["currentRevision"])}}
	case "VALIDATION_FAILED":
		fields := stringMap(details["fieldViolations"])
		names := make([]string, 0, len(fields))
		for name := range fields {
			names = append(names, name)
		}
		sort.Strings(names)
		violations := make([]*v1.FieldViolation, 0, len(names))
		for _, name := range names {
			violations = append(violations, &v1.FieldViolation{Field: name, Reason: fields[name]})
		}
		result.Details = &v1.ApiError_Validation{Validation: &v1.ValidationDetails{FieldViolations: violations}}
	case "REQUEST_ID_REUSED":
		result.Details = &v1.ApiError_RequestIdReused{RequestIdReused: &v1.RequestIdReusedDetails{RequestId: stringValue(details["requestId"])}}
	case "ASSET_NOT_READY":
		result.Details = &v1.ApiError_AssetNotReady{AssetNotReady: &v1.AssetNotReadyDetails{AssetId: stringValue(details["assetId"]), State: stringValue(details["state"])}}
	}
	return result
}

func stringMap(value any) map[string]string {
	if fields, ok := value.(map[string]string); ok {
		return fields
	}
	result := map[string]string{}
	if fields, ok := value.(map[string]any); ok {
		for key, item := range fields {
			result[key] = stringValue(item)
		}
	}
	return result
}
func stringValue(value any) string {
	result, _ := value.(string)
	return result
}
func int64Value(value any) int64 {
	switch number := value.(type) {
	case int64:
		return number
	case int:
		return int64(number)
	case float64:
		return int64(number)
	default:
		return 0
	}
}
