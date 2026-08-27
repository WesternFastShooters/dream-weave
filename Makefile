.PHONY: dev dev-down dev-logs acceptance

# Daily full-stack development: Docker runs stateful dependencies while this
# process runs the Go services with restart-on-change and Vite with HMR.
dev:
	@if ! command -v mkcert >/dev/null; then \
		if command -v brew >/dev/null; then brew install mkcert; \
		else echo "make dev requires mkcert. Install it, then retry." >&2; exit 2; fi; \
	fi
	node scripts/dev.mjs

dev-down:
	docker compose -f infra/compose/local/compose.yaml -f infra/compose/local/compose.dev.yaml down

dev-logs:
	docker compose -f infra/compose/local/compose.yaml -f infra/compose/local/compose.dev.yaml logs -f

# The container-only workflow remains the manual acceptance environment.
acceptance:
	docker build -t dream-weave-server:local -f apps/server/Dockerfile .
	docker build -t dream-weave-canvas:local -f apps/canvas/Dockerfile .
	DW_SERVER_IMAGE=dream-weave-server:local DW_PREVIEW_WORKER_IMAGE=dream-weave-server:local DW_CANVAS_IMAGE=dream-weave-canvas:local $(MAKE) -C infra/compose/local up
