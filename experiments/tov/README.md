# Tov feasibility experiment

Status: blocked, not a completed server port. No production source, API, authentication, deployment, or database configuration changed.

Inspected Tov v0.0.1 at upstream commit ae0f67f5450e4f89a387c0388556c432c2363c98 on October 10, 2026. Installed Rust stable and built Tov on KAT-BOX. Used system JavaScriptCore (libjavascriptcoregtk-4.1-dev) for the npm interoperability probes.

## Reproduction

On KAT-BOX with Tov and JavaScriptCore installed:

```sh
tov check --json experiments/tov/signing.tov
TOV_JSC=system tov build experiments/tov/signing.tov -o /tmp/tov-signing-probe
/tmp/tov-signing-probe

tov check --json experiments/tov/jwt-verification.tov
TOV_JSC=system tov build experiments/tov/jwt-verification.tov -o /tmp/tov-jwt-probe
/tmp/tov-jwt-probe
```

Both probes pass checking and compile to native Linux executables. Both fail at runtime:

```text
uncaught Error: The crypto.generateKeyPairSync method is not implemented
uncaught NotSupportedError: crypto.subtle.importKey is not supported in Tov yet
```

The JWT probe deliberately invokes the unavailable method directly; its example bytes are not a valid key. The runtime stub throws before validating arguments. It tests method availability, not a cryptographic operation.

## Why this blocks API parity

src/config.ts persists an Ed25519 signing key using generateKeyPairSync/createPrivateKey/createPublicKey. src/setup.ts signs the central challenge nonce. src/security.ts verifies central tickets with jose v6 using Web Crypto. src/google-mailer.ts also needs RSA-OAEP-256 and A256GCM JWE operations. Tov's runtime/node/crypto.js explicitly stubs key objects, signature/key generation, and cipher APIs; its Web Crypto implementation only supports digest (the other subtle methods throw).

Bypassing signature verification, weakening the broker encryption, changing public key formats, or accepting synthetic tickets would violate the existing security contract. Keeping Node behind a Tov proxy would retain the existing server, not rewrite it.

## Other dependencies and possible next steps

Tov supports npm imports, but packages run on embedded JavaScriptCore rather than compiling to native Tov. That is a possible compatibility bridge, not a native business-logic rewrite. NestJS decorators, reflection, Mongoose dynamic queries, and Socket.IO cannot be translated merely by renaming TypeScript files.

The native Bun.serve API documents no WebSocket support. However, current upstream node:http includes upgrade handoff to net.Socket, so Socket.IO-through-npm is not ruled out here. MongoDB-through-npm is also not declared impossible: node:net import checks and builds, but MongoDB transactions/driver behavior have not been exercised. Upstream NODE.md has some stale TCP placeholder wording; actual tcp_wrap.js includes TCP operations.

Safe routes forward would be implementing the missing crypto runtime primitives upstream, or agreeing to a separately reviewed, audited crypto adapter/native addon and checking all key/JWT/JWE interoperability. A Mongo driver and authenticated Socket.IO transport still need real tests afterwards. No custom crypto was written or security-sensitive workaround substituted.

## Test scope

Only the two availability probes were checked, built, and executed on KAT-BOX. Neither passed runtime execution, as recorded above. The existing 88-test backend suite (including 41 school tests) was NOT run against a port, because no functioning port exists. No isolated Mongo 9 compose project was started for this experiment. Existing QA and production stacks were untouched.
