# ppackage

One command, one commit, one tag.

`ppackage` releases a module (npm, go, composer, docker image, terraform
provider, …), i.e. anything published to a registry and consumed by others.
It aligns the version & repository markers of the module (`package.json`,
`composer.json`, `go.mod`, `Dockerfile`, `.gitlab-ci.yml`, Terraform provider
manifest), then creates the `vX.Y.Z` commit and tag. CI publishes from there.

## Install

```
npm install -g ppackage
```

## Usage

```
ppackage version patch|minor|major|X.Y.Z [--notag]
```

### `ppackage version`

From the repository root, with a clean working directory:

```
ppackage version minor
```

1. reads the current version from every marker found (see below),
2. computes the target (`patch`, `minor`, `major` or an explicit semver),
3. rewrites all markers,
4. commits `vX.Y.Z` and tags `vX.Y.Z`.

It aborts when the markers disagree on the repository URL (`ppackage repository`
fixes that first), when the working directory is dirty, or when a Go module
path does not match the target major. Nothing is pushed, nothing is published:
you review, then `git push --follow-tags`.

BTW, an npm `scripts.version` hook, if configured, is honored (as `npm version`
would).

`--notag` only rewrites the markers (useful from a `version` hook or a CI step)
and skips the commit/tag.

## Markers

A marker is detected by the presence of its file in the repository root.
Repository markers must agree on `<host>/<path>` and on the protocol.

| File | Version | Repository |
|---|---|---|
| `package.json` | `.version` | `.repository.url` |
| `composer.json` | `.version` | `.extra.repository.url` |
| `go.mod` | `// version: X.Y.Z` | `module <host>/<path>[/vN]` |
| `Dockerfile` | `LABEL org.opencontainers.image.version` | `LABEL org.opencontainers.image.source` |
| `.gitlab-ci.yml` | `.version` | `.repository` |
| `terraform-registry-manifest.json` | `.metadata.version` | `.metadata.repository` |

The Go module directive carries the repository and the
[major version suffix](https://go.dev/ref/mod#major-version-suffixes) (`/vN`
for a major ≥ 2): a major release rewrites it, update your imports accordingly.

## Advanced

```
ppackage repository [git@host:group/project.git]
ppackage gitify [repository_url] [branch]
```

### `ppackage repository`

Declares the same repository URL in every marker (defaults to
`remote.origin.url`), in a dedicated `Uniform repository declaration` commit.

### `ppackage gitify`

Turns an exported/extracted tree (npm tarball, Docker build context) back into
a working git checkout of the declared repository, restoring ignored files.
Credentials for https remotes are resolved through `bin/askpass` from
`GIT_USER_<DOMAIN>_LOGIN` / `GIT_USER_<DOMAIN>_PASSWORD` (or `GIT_USER_LOGIN` /
`GIT_USER_PASSWORD`).

## Philosophy

* Markers are files, tracked and reviewed. The version lives in the repository,
  not in `git describe`.
* ppackage never guesses: inconsistent markers are an error, not a warning.
* ppackage never pushes, never publishes. That's your CI's job.
