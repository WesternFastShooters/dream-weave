FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.work go.work.sum ./
COPY apps/server/go.mod apps/server/go.sum ./apps/server/
WORKDIR /src/apps/server
RUN go mod download
WORKDIR /src
COPY apps/server ./apps/server
WORKDIR /src/apps/server
RUN CGO_ENABLED=0 go build -trimpath -o /out/dream-weave-server ./cmd/dream-weave-server \
 && CGO_ENABLED=0 go build -trimpath -o /out/preview-worker ./cmd/preview-worker \
 && CGO_ENABLED=0 go build -trimpath -o /out/migrate ./cmd/migrate \
 && CGO_ENABLED=0 go build -trimpath -o /out/media-preview-processor ./cmd/media-preview-processor

# The preview worker invokes only these two pinned Alpine packages to derive
# waveform metadata and video posters; browser playback never runs ffmpeg.
FROM alpine:3.21
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=build /out/dream-weave-server /app/dream-weave-server
COPY --from=build /out/preview-worker /app/preview-worker
COPY --from=build /out/migrate /app/migrate
COPY --from=build /out/media-preview-processor /app/media-preview-processor
COPY apps/server/migrations /app/migrations
RUN adduser -D -u 65532 dreamweave
USER dreamweave
ENTRYPOINT ["/app/dream-weave-server"]
