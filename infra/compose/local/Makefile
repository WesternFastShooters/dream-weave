.PHONY: local-certs up down

local-certs:
	@command -v mkcert >/dev/null || (echo "mkcert is required; install it before local TLS setup" >&2; exit 2)
	mkdir -p certs
	mkcert -install
	mkcert -cert-file certs/local-cert.pem -key-file certs/local-key.pem app.localhost preview.localhost office.localhost

up: local-certs
	docker compose --env-file .env -f compose.yaml up --build

down:
	docker compose --env-file .env -f compose.yaml down
