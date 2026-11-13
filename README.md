# vault_ultimate

Podman-first container scaffold. Its project resource prefix is `vaultultimat-`.
Check that the prefix is unused before running the Make targets. On macOS,
start your Podman machine before building or running the image.

## Quickstart

`make check` verifies the Podman CLI is installed. Then use `make build` to build
the image, `make run` to run the short demo, and `make clean` to remove
only this project's generated image. The run target removes its container on
exit; the image remains until you clean it.
