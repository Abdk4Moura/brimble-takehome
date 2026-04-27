# Brimble deploy + feedback

**Live URL:** https://_(replace once `brimble-hello` is live)_.brimble.app

**Source:** https://github.com/Abdk4Moura/brimble-hello — a 90-line Node
HTTP hello-world. No build step, no framework, just a `start` script in
`package.json`.

---

## What I tried first

Before deploying the hello-world, I pushed the take-home repo itself
(`Abdk4Moura/brimble-takehome`) at Brimble to see how the platform handled a
multi-service repo. It didn't go well — but most of the friction wasn't the
repo's fault, so I'll separate the two.

I made four deploy attempts. Three failed in three different ways. One
succeeded but produced a useless container.

## What broke (all real bugs, in order of how loud they were)

### 1. Deterministic host port collision on redeploy

Attempt #3 (commit `66da20b`) failed at start with:

```
docker: Error response from daemon: driver failed programming external
connectivity on endpoint brimble-takehome-vocal-global ... Bind for
0.0.0.0:35793 failed: port is already allocated
```

The previous deploy was still bound to the same host port. Brimble seems to
allocate a stable host port per app (the slug suffix changed —
`vocal-global` → `vocal-skilled` — but the port didn't), and the runner
fires up the new container before the old one gives the port back. That's
a redeploy that should have been the easy case.

If your runner is `docker run -p <port>:...`, the simple fix is `docker
stop && wait` on the previous container before starting the new one, or
allocating a fresh port and swapping the upstream after the new one is
healthy. The latter also gets you zero-downtime redeploys, which Brimble
doesn't seem to do today.

### 2. Build log spam that looks exactly like a failure

Every BuildKit build I saw printed:

```
http2: server: error reading preface from client localhost:0:
grpchijack: conn read recvmsg: rpc error: code = Internal desc = ...
"error reading server preface: rpc error: code = Unavailable desc =
error reading from server: EOF"
```

In one case (attempt #1) it correlated with an actual failure. In another
(attempt #2) the same message appeared and the build finished fine. So
either it's a real intermittent transport bug worth fixing, or it's a
benign warning being logged at error severity — either way, it teaches
users to ignore real errors. Categorise it and silence it, or surface a
reason next to "Failed to build application".

### 3. Build log lines arrive out of order in the UI

Sample from one of my build logs:

```
2026-04-27T23:27:23.752Z --- Detected 1 environment variables
2026-04-27T23:27:23.767Z --- Cloning from ...
2026-04-27T23:27:24.452Z --- Repository cloned successfully.
2026-04-27T23:27:24.481Z ---  ╭─────────────────╮ ...
2026-04-27T23:27:23.237Z --- Deployment queued starting soon
2026-04-27T23:27:30.992Z --- #1 transferring dockerfile
```

`Deployment queued` should be at the top, not buried halfway down. Looks
like multiple log streams (control-plane + builder) get merged in arrival
order rather than timestamp order. It's a cosmetic bug but it makes the
build feel chaotic when you're trying to read why something failed.

### 4. Railpack provider detection has no escape hatch in the UI

For the multi-service repo, Railpack found nothing it knew how to start
and said:

```
⚠ Script start.sh not found
⚠ No start command detected. Specify a start command:
  https://railpack.com/config/file
```

…and then **shipped a container anyway**, picking pnpm as the package
manager despite no package.json declaring pnpm. The deploy went "live" at
a `.brimble.app` URL but served nothing useful. From the UI side I had no
way to say "use this subdirectory" or "use this start command" without
editing the source repo. A `Build settings` panel with `subdirectory`,
`build command`, `start command` overrides would have unblocked me without
a commit.

(I get that the take-home repo isn't a typical deploy target. The point is:
the platform should refuse the deploy when it can't determine a start
command, not ship a no-op container.)

### 5. Required env vars are surfaced as a count, not a list

`Detected 1 environment variables for build` — which one? Where do I see
them? It might just be `NODE_ENV`, but a user shouldn't have to guess.
Show the keys (not values) right there in the build log.

### 6. Mise hits GitHub unauthenticated and rate-limits the whole platform

When I deployed `brimble-hello` (a 90-line npm-only Node service), the build
failed at `mise install` with:

```
Failed to install aqua:pnpm/pnpm@10.33.2: HTTP status client error
(403 rate limit exceeded) for url
(https://api.github.com/repos/pnpm/pnpm/releases/tags/10.33.2)
```

Two compounding problems here:

- **Railpack provisions pnpm even when the project uses npm.** The same
  build's plan output says `↳ Using npm package manager` — and one line
  later, `pnpm  │  10.33.2  │  custom config (latest)`. My
  `package.json` has no pnpm reference. Looks like Brimble's Railpack
  config installs pnpm unconditionally as a "supported" tool, which
  doubles the GitHub API surface for every Node deploy that doesn't need
  it.
- **Mise calls the GitHub API anonymously.** GitHub's unauthenticated
  rate limit is 60 req/hr per IP. On a shared runner that's almost
  always exhausted. Set `GITHUB_TOKEN` (or `GH_TOKEN`) in the build
  environment and mise will use it — that's a 5,000/hr ceiling, which is
  the difference between "deploys flake on Tuesday" and "deploys never
  flake on this axis again."

Bonus: when mise *did* warn — `mise WARN GitHub rate limit exceeded.
Resets at 2026-04-27 23:45:42` — that warning was the actual root cause
of the failure 1.2 seconds later, but it was rendered indistinguishably
from the dozens of other lines. Catching it and surfacing
"Rate-limited by GitHub. Retry after 23:45 UTC, or contact support to
configure a token" would save the user from re-reading the whole
buildlog trying to figure out what `aqua:pnpm/pnpm` even is.

## What's nice

- **Generated app names** (`brimble-takehome-vocal-skilled`) are charming
  and disambiguate redeploys.
- **Clone speed** — the GitHub clone consistently took under a second.
- **Build cache** — `#3 CACHED` and `#5 CACHED` showed up on subsequent
  builds, which kept rebuild times in the seconds range.
- **The successful URL just worked.** No DNS configuration, no certificate
  step, the `https://` URL was alive about 2 seconds after `Site running
  at` appeared in the log. That's the experience users want.

## One thing to change next week

Hold ports across redeploys. The `0.0.0.0:35793 already allocated` error
is the kind of bug that loses someone the deploy they were trying to ship
right now. A 30-second sleep loop that waits for the port to free, or a
straight stop-then-start primitive, would have rescued me without any UI
change.

## One thing to change next quarter

Add a "Build settings" panel that lets a user set `subdirectory`,
`buildCommand`, and `startCommand` from the UI. Right now the only way to
influence Railpack's plan is to commit a config to the source repo. That's
fine for prod, but during the first 10 minutes of trying Brimble it's the
difference between "this works" and "I edited my repo three times and now
my git history is full of `try this`."
