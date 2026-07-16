# Security policy

## Supported versions

Security fixes are made on the `main` branch and released in the newest container image. Older commits and commit-scoped `sha-<full-git-sha>` images do not receive backports. Upgrade to a newer tested image after reviewing its commits and following the [upgrade and rollback runbook](docs/upgrading.md).

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue. Use [GitHub private vulnerability reporting](https://github.com/krbob/wklejka/security/advisories/new) and include:

- the affected commit or image tag;
- deployment details relevant to the issue, with secrets removed;
- reproduction steps or a minimal proof of concept;
- the expected and observed security impact.

You should receive an acknowledgement within seven days. Investigation and remediation timelines depend on severity and maintainer availability. Please allow time for a fix before public disclosure.

## Deployment responsibility

Wklejka stores and broadcasts clipboard data to every client admitted by the configured deployment policy. Authentication is optional in the application but required for the recommended network deployment. Wklejka is not designed for mutually untrusted tenants. Operators are responsible for:

- terminating TLS with a trusted certificate;
- enabling strong authentication and protecting credentials;
- restricting network access and configuring `TRUST_PROXY` and `PUBLIC_ORIGIN` correctly;
- maintaining backups, disk capacity, and timely upgrades;
- reviewing remote link-preview use for their threat model.

The minimum recommended setup is documented in [docs/deployment.md](docs/deployment.md).
