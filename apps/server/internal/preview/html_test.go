package preview

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func TestBuildSandboxedHTMLProducesSelfContainedPortOnlyArtifact(t *testing.T) {
	source := []byte(`<!doctype html><html><head><meta http-equiv="refresh" content="0;https://evil.example"><style>body{color:red}</style></head><body onload="steal()"><iframe src="https://evil.example"></iframe><img src="https://evil.example/a.png"><script>window.x=1</script><a href="javascript:alert(1)">x</a></body></html>`)
	artifact, err := BuildSandboxedHTML("story.html", source)
	if err != nil {
		t.Fatal(err)
	}
	value := string(artifact)
	for _, forbidden := range []string{"https://evil.example", "<iframe", "onload=", "javascript:", "http-equiv"} {
		if strings.Contains(strings.ToLower(value), strings.ToLower(forbidden)) {
			t.Fatalf("artifact contains forbidden %q: %s", forbidden, value)
		}
	}
	for _, required := range []string{"data:text/javascript;base64"} {
		if !strings.Contains(value, required) {
			t.Fatalf("artifact does not contain %q", required)
		}
	}
	for _, required := range []string{"dream-weave:html-preview:configure", "dream-weave:html-preview:ready", "protocolVersion"} {
		if !strings.Contains(htmlBridgeRuntime, required) {
			t.Fatalf("bridge runtime does not contain %q", required)
		}
	}
}

func TestBuildSandboxedHTMLEmbedsZipRelativeResources(t *testing.T) {
	var packed bytes.Buffer
	w := zip.NewWriter(&packed)
	index, err := w.Create("site/index.html")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = index.Write([]byte(`<html><body><img src="images/pixel.png"></body></html>`))
	image, err := w.Create("site/images/pixel.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = image.Write([]byte{0x89, 0x50, 0x4e, 0x47})
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	artifact, err := BuildSandboxedHTML("interactive.zip", packed.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(artifact), "data:image/png;base64,iVBORw==") {
		t.Fatalf("zip resource was not embedded: %s", artifact)
	}
}
