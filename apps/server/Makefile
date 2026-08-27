GOBIN := $(shell go env GOBIN)
ifeq ($(GOBIN),)
GOBIN := $(shell go env GOPATH)/bin
endif
API_PROTO_FILES := $(shell find api/dreamweave/v1 -name '*.proto' | sort)
PROTOC ?= protoc
TS_HTTP_GENERATOR_VERSION := v0.0.0-20260526061946-7cb5d90103c2
TS_API_OUT := ../../packages/canvas-core/src/api/generated
TS_DESCRIPTOR := $(CURDIR)/.typescript-http-descriptor.pb
TS_GENERATED_ENTRY := $(TS_API_OUT)/dreamweave/v1/index.ts

.PHONY: api api-go api-typescript wire generate test verify run-server run-preview-worker migrate migration-validate install-tools
api: api-go api-typescript

api-go:
	$(PROTOC) --proto_path=./api --proto_path=./third_party --go_out=paths=source_relative:./api --go-grpc_out=paths=source_relative:./api --go-http_out=paths=source_relative:./api --go-errors_out=paths=source_relative:./api $(API_PROTO_FILES)

api-typescript:
	rm -rf $(TS_API_OUT)
	mkdir -p $(TS_API_OUT)
	$(PROTOC) --proto_path=./api --proto_path=./third_party --typescript-http_out=$(TS_API_OUT) $(API_PROTO_FILES)
	$(PROTOC) --proto_path=./api --proto_path=./third_party --include_imports --descriptor_set_out=$(TS_DESCRIPTOR) $(API_PROTO_FILES)
	go run ./scripts/canonicalize_typescript_http.go $(TS_DESCRIPTOR) $(TS_GENERATED_ENTRY)
	rm -f $(TS_DESCRIPTOR)

# Retained as an explicit target for future dependency-injection generation.
# The current app constructor takes runtime database/config values directly.
wire:
	@echo 'wire: no wireinject provider exists for the current runtime constructor'

generate: api

test:
	go test ./...

verify: generate
	git diff --exit-code -- api ../../packages/canvas-core/src/api/generated
	@test -z "$$(git status --porcelain -- api ../../packages/canvas-core/src/api/generated)" || (echo 'generated contracts contain uncommitted or untracked files' >&2; git status --short -- api ../../packages/canvas-core/src/api/generated; exit 1)
	go test ./...
	go build ./cmd/dream-weave-server ./cmd/preview-worker ./cmd/migrate

run-server:
	go run ./cmd/dream-weave-server

run-preview-worker:
	go run ./cmd/preview-worker

migrate:
	go run ./cmd/migrate

migration-validate:
	@test -n "$(DATABASE_URL)" || (echo "DATABASE_URL is required" >&2; exit 2)
	go run ./cmd/migrate

install-tools:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2
	go install github.com/go-kratos/kratos/cmd/protoc-gen-go-http/v2@v2.0.0-20260404020628-f149714c1d54
	go install github.com/go-kratos/kratos/cmd/protoc-gen-go-errors/v2@v2.0.0-20260404020628-f149714c1d54
	go install github.com/go-kratos/protoc-gen-typescript-http@$(TS_HTTP_GENERATOR_VERSION)
