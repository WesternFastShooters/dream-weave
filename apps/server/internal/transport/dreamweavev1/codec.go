package dreamweavev1

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/dream-weave/dream-weave/apps/server/internal/apierror"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const maxJSONBodyBytes = 2 << 20

var (
	jsonMarshal   = protojson.MarshalOptions{UseProtoNames: false, EmitUnpopulated: true}
	jsonUnmarshal = protojson.UnmarshalOptions{DiscardUnknown: false}
)

func decodeProtoJSON(r *http.Request, target any) error {
	message, ok := target.(proto.Message)
	if !ok {
		return apierror.Validation("request body must target a generated proto message", map[string]string{"body": "invalid transport target"})
	}
	limited := io.LimitReader(r.Body, maxJSONBodyBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return apierror.Validation("invalid JSON", map[string]string{"body": err.Error()})
	}
	r.Body = io.NopCloser(bytes.NewReader(data))
	if len(data) == 0 {
		return nil
	}
	if len(data) > maxJSONBodyBytes {
		return apierror.Validation("invalid JSON", map[string]string{"body": "request body exceeds 2 MiB"})
	}
	if err := jsonUnmarshal.Unmarshal(data, message); err != nil {
		return apierror.Validation("invalid JSON", map[string]string{"body": err.Error()})
	}
	return nil
}

func encodeProtoJSON(w http.ResponseWriter, _ *http.Request, value any) error {
	if value == nil {
		return nil
	}
	message, ok := value.(proto.Message)
	if !ok {
		return fmt.Errorf("public HTTP response is not a generated proto message: %T", value)
	}
	data, err := jsonMarshal.Marshal(message)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	_, err = w.Write(data)
	return err
}

func encodeAPIError(w http.ResponseWriter, _ *http.Request, err error) {
	var public *apierror.Error
	if !errors.As(err, &public) {
		public = apierror.New(http.StatusInternalServerError, "INTERNAL", "internal server error", nil)
	}
	apierror.Write(w, public)
}
