# Local model download TLS fixtures

These self-signed certificates and their publicly known test key are only for isolated loopback HTTPS tests. They are never loaded by production code.

`loopback.pem` matches `127.0.0.1`; `other-host.pem` matches `127.0.0.2` to exercise real hostname rejection. Tests temporarily trust the selected fixture through a private HTTPS agent and restore the original agent on teardown. TLS verification remains enabled.

The RSA-2048/SHA-256 fixtures expire in October 2036. Tests do not need OpenSSL or external network access.
