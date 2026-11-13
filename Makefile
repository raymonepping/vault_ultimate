.DEFAULT_GOAL := build

PREFIX := vaultultimat-
IMAGE := $(PREFIX)demo:local
CONTAINER := $(PREFIX)demo-run

.PHONY: check build run clean

check: ## Verify the Podman CLI is installed
	@command -v podman >/dev/null 2>&1 || { echo "podman is required" >&2; exit 1; }
	@podman --version

build: check ## Build this project's Containerfile
	@podman build --tag "$(IMAGE)" --file Containerfile .

run: build ## Run the demo container and remove it when it exits
	@podman run --rm --name "$(CONTAINER)" "$(IMAGE)"

clean: ## Remove only this project's generated image
	@podman image rm "$(IMAGE)"
