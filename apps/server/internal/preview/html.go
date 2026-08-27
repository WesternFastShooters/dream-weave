package preview

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"path"
	"regexp"
	"strings"
)

// BuildSandboxedHTML turns an uploaded HTML document (or a zip containing one)
// into one self-contained entry artifact.  It deliberately has no reference to
// the original object: resource URLs are embedded, navigation primitives are
// removed and the only host integration is the private MessagePort runtime.
func BuildSandboxedHTML(name string, source []byte) ([]byte, error) {
	entry, files, err := htmlPackage(name, source)
	if err != nil {
		return nil, err
	}
	html := string(files[entry])
	html = removeDangerousHTML(html)
	html = rewritePackageURLs(html, entry, files)
	html = externalizeInlineContent(html)
	html = injectRuntime(html)
	return []byte(html), nil
}

func htmlPackage(name string, source []byte) (string, map[string][]byte, error) {
	if strings.EqualFold(path.Ext(name), ".zip") {
		reader, err := zip.NewReader(bytes.NewReader(source), int64(len(source)))
		if err != nil {
			return "", nil, fmt.Errorf("invalid HTML package: %w", err)
		}
		files := make(map[string][]byte, len(reader.File))
		var entry string
		var total int64
		for _, file := range reader.File {
			clean := path.Clean(strings.TrimPrefix(file.Name, "/"))
			if clean == "." || strings.HasPrefix(clean, "../") || file.FileInfo().IsDir() {
				continue
			}
			in, err := file.Open()
			if err != nil {
				return "", nil, err
			}
			// The processor has a bounded input; keep decompression bounded too so a
			// small zip cannot expand into an unbounded worker allocation.
			body, readErr := io.ReadAll(io.LimitReader(in, (64<<20)+1))
			_ = in.Close()
			if readErr != nil {
				return "", nil, readErr
			}
			if len(body) > 64<<20 {
				return "", nil, fmt.Errorf("HTML package resource exceeds 64 MiB")
			}
			total += int64(len(body))
			if total > 128<<20 {
				return "", nil, fmt.Errorf("HTML package exceeds 128 MiB after decompression")
			}
			files[clean] = body
			if strings.EqualFold(path.Base(clean), "index.html") || strings.EqualFold(path.Base(clean), "index.htm") {
				entry = clean
			}
		}
		if entry == "" {
			for file := range files {
				if strings.EqualFold(path.Ext(file), ".html") || strings.EqualFold(path.Ext(file), ".htm") {
					if entry != "" {
						return "", nil, fmt.Errorf("HTML package has no unambiguous entry document")
					}
					entry = file
				}
			}
		}
		if entry == "" {
			return "", nil, fmt.Errorf("HTML package has no entry document")
		}
		return entry, files, nil
	}
	return path.Base(name), map[string][]byte{path.Base(name): source}, nil
}

var (
	dangerousElement = regexp.MustCompile(`(?is)<(?:base|iframe|frame|frameset|object|embed|form)\b[^>]*>.*?</(?:iframe|frame|frameset|object|embed|form)>|<(?:base|iframe|frame|frameset|object|embed|form)\b[^>]*>`)
	metaRefresh      = regexp.MustCompile(`(?is)<meta\b[^>]*http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>`)
	eventHandler     = regexp.MustCompile(`(?is)\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)`)
	javascriptURL    = regexp.MustCompile(`(?is)\s(?:href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|https?)\s*:[^"]*"|'\s*(?:javascript|https?)\s*:[^']*'|(?:javascript|https?)\s*:[^\s>]+)`)
	resourceURL      = regexp.MustCompile(`(?is)\b(src|href|poster)\s*=\s*"([^"]+)"|\b(src|href|poster)\s*=\s*'([^']+)'`)
	inlineScript     = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script\s*>`)
	inlineStyle      = regexp.MustCompile(`(?is)<style\b[^>]*>(.*?)</style\s*>`)
)

func removeDangerousHTML(input string) string {
	input = dangerousElement.ReplaceAllString(input, "")
	input = metaRefresh.ReplaceAllString(input, "")
	input = eventHandler.ReplaceAllString(input, "")
	return javascriptURL.ReplaceAllString(input, "")
}

func rewritePackageURLs(input, entry string, files map[string][]byte) string {
	return resourceURL.ReplaceAllStringFunc(input, func(match string) string {
		parts := resourceURL.FindStringSubmatch(match)
		if len(parts) != 5 {
			return ""
		}
		attribute, quote, reference := parts[1], `"`, parts[2]
		if attribute == "" {
			attribute, quote, reference = parts[3], `'`, parts[4]
		}
		reference = strings.TrimSpace(reference)
		if reference == "" || strings.HasPrefix(reference, "#") || strings.HasPrefix(reference, "data:") || strings.HasPrefix(reference, "blob:") {
			return match
		}
		// Network-path, absolute and protocol URLs are never made reachable.
		if strings.Contains(reference, ":") || strings.HasPrefix(reference, "/") || strings.HasPrefix(reference, "//") {
			return ""
		}
		clean := path.Clean(path.Join(path.Dir(entry), reference))
		body, exists := files[clean]
		if !exists {
			return ""
		}
		contentType := mime.TypeByExtension(path.Ext(clean))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		dataURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(body)
		return attribute + "=" + quote + dataURL + quote
	})
}

func externalizeInlineContent(input string) string {
	input = inlineScript.ReplaceAllStringFunc(input, func(match string) string {
		parts := inlineScript.FindStringSubmatch(match)
		if len(parts) != 3 {
			return ""
		}
		attrs := strings.TrimSpace(parts[1])
		if strings.Contains(strings.ToLower(attrs), "src=") {
			return match
		}
		return `<script src="data:text/javascript;base64,` + base64.StdEncoding.EncodeToString([]byte(parts[2])) + `"></script>`
	})
	return inlineStyle.ReplaceAllStringFunc(input, func(match string) string {
		parts := inlineStyle.FindStringSubmatch(match)
		if len(parts) != 2 {
			return ""
		}
		return `<link rel="stylesheet" href="data:text/css;base64,` + base64.StdEncoding.EncodeToString([]byte(parts[1])) + `">`
	})
}

const htmlBridgeRuntime = `(()=>{"use strict";window.addEventListener("message",function(e){const d=e.data;if(!d||d.type!=="dream-weave:html-preview:configure"||d.protocolVersion!==1||typeof d.sessionId!=="string"||!Number.isInteger(d.loadGeneration)||!e.ports||e.ports.length!==1)return;const p=e.ports[0];const reply=(type)=>p.postMessage({type,sessionId:d.sessionId,loadGeneration:d.loadGeneration});p.onmessage=(m)=>{const x=m.data;if(!x||x.type!=="dream-weave:html-preview:visibility"||x.sessionId!==d.sessionId||x.loadGeneration!==d.loadGeneration)return;};try{reply("dream-weave:html-preview:ready")}catch(_){reply("dream-weave:html-preview:error")}})})();`

func injectRuntime(input string) string {
	runtime := `<script src="data:text/javascript;base64,` + base64.StdEncoding.EncodeToString([]byte(htmlBridgeRuntime)) + `"></script>`
	if match := regexp.MustCompile(`(?is)<head\b[^>]*>`).FindStringIndex(input); match != nil {
		return input[:match[1]] + runtime + input[match[1]:]
	}
	return runtime + input
}
