# Fork Changes

This is a fork of [`@discord/embedded-app-sdk`](https://www.npmjs.com/package/@discord/embedded-app-sdk).

## Why this fork exists

Discord's embedded app SDK sends the handshake to the Discord client exactly once — at the end of the `DiscordSDK` constructor. The Discord client responds with a single `READY` dispatch. If the app page navigates (e.g. via `window.location.href`) before or shortly after construction — for example when a password-protection middleware redirects to the real app — the new page creates a fresh `DiscordSDK` instance that re-sends the handshake, but the Discord client may not respond with `READY` again. This causes `await sdk.ready()` to hang indefinitely.

See the upstream discussion: https://github.com/discord/embedded-app-sdk/issues/41

## Changes

### New: `sdk.handshake()`

`DiscordSDK` now exposes a public `handshake()` method. Calling it:

1. Resets the internal `isReady` flag to `false`
2. Re-registers the internal `READY` listener (deduplication-safe via `off` + `once`)
3. Re-sends the handshake `postMessage` to the Discord client

`IDiscordSDK` and `DiscordSDKMock` are updated to match.

### New: `disableAutoHandshake` config option

`SdkConfiguration` has a new optional field:

```typescript
interface SdkConfiguration {
  disableConsoleLogOverride: boolean;
  disableAutoHandshake?: boolean; // default: false
}
```

When `true`, the constructor does **not** call `handshake()` automatically. The app is responsible for calling `sdk.handshake()` at the right time.

---

## Usage in the consumer project

### Option A — disable auto-handshake, trigger manually after middleware

Use this when your app initialises the SDK on the page that sits behind the middleware (e.g. the real activity page), and you want full control over when the handshake fires.

```typescript
const sdk = new DiscordSDK(CLIENT_ID, { disableAutoHandshake: true });

// ... middleware finishes, you're on the real app page ...

sdk.handshake();
await sdk.ready();
```

### Option B — re-trigger after a missed READY

Use this if the SDK was already constructed with auto-handshake enabled but the `READY` event was missed because of the middleware redirect.

```typescript
// Somewhere after the redirect has settled:
sdk.handshake();
await sdk.ready();
```

### Mock environments

`DiscordSDKMock.handshake()` immediately emits `READY` on the internal event bus, mirroring what a real connection does. No changes are needed to existing mock usage — `emitReady()` still works as before.
