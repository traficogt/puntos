.PHONY: setup-dev up down logs test openapi docs worker

setup-dev:
	@test -f .env || ./src/scripts/bootstrap-dev.sh

up: setup-dev
	@docker compose up -d --build
	@./src/scripts/wait-for-api.sh

down:
	@docker compose down

logs:
	@docker compose logs -f

test:
	@npm test

openapi:
	@npm run openapi:generate

worker:
	@IN_PROCESS_WORKERS=false npm start &
	@npm run worker
