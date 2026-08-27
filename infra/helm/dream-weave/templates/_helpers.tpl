{{- define "dream-weave.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- define "dream-weave.fullname" -}}
{{- if .Values.fullnameOverride }}{{ .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}{{- else }}{{ printf "%s-%s" .Release.Name (include "dream-weave.name" .) | trunc 63 | trimSuffix "-" }}{{- end }}
{{- end }}
{{- define "dream-weave.labels" -}}
app.kubernetes.io/name: {{ include "dream-weave.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
