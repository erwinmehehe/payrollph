# Disposable CI emulator only; never a production storage deployment.
# Community MinIO no longer publishes the floating image used by these tests.
FROM golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848 AS build
ENV GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /source
# Exact upstream revision, not a moving branch or a precompiled binary mirror.
RUN git init . \
    && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin 7aac2a2c5b7c882e68c1ce017d8256be2feea27f \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 7aac2a2c5b7c882e68c1ce017d8256be2feea27f \
    && go build -trimpath -ldflags='-s -w' -o /out/minio .

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
COPY --from=build /out/minio /usr/local/bin/minio
RUN mkdir -p /data && chown 65532:65532 /data
ENV HOME=/tmp MINIO_UPDATE=off
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/minio"]
