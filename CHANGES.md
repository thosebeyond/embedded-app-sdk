# Fork Changes

This is a fork of [`@discord/embedded-app-sdk`](https://www.npmjs.com/package/@discord/embedded-app-sdk).

## Why this fork exists

### Problem 1 — `postMessage` silently dropped after a same-origin redirect

The original `getRPCServerSource()` used `document.referrer` as the `targetOrigin` for every `postMessage` call to Discord:

```typescript
// original
return [..., !!document.referrer ? document.referrer : '*'];
```

On first load inside a Discord activity, `document.referrer` is empty or `https://discord.com`, so `'*'` or the correct Discord origin is used and everything works.

After a middleware redirect (`window.location.href = sameUrl`), the new page's `document.referrer` becomes the app's own `https://xxx.discordsays.com` URL. Every subsequent `postMessage` to `window.parent` (Discord) is **silently dropped by the browser** because Discord's actual origin (`discord.com`) doesn't match the specified `targetOrigin`. Discord never receives the handshake, never sends `READY`, and `await sdk.ready()` hangs forever.

### Problem 2 — No way to trigger the handshake after construction

The handshake was `private` and only called once from the constructor. If a middleware redirect caused a missed `READY`, there was no recovery path.

---

## Changes

### Fix: `getRPCServerSource()` always uses `'*'` as `targetOrigin`

```typescript
// before
return [window.parent.opener ?? window.parent, !!document.referrer ? document.referrer : '*'];

// after
return [window.parent.opener ?? window.parent, '*'];
```

Using `'*'` with an explicit window target (`window.parent`) is safe — it only tells the browser not to check the recipient's origin; the message is still sent directly to the parent window.

### New: `sdk.handshake()` public method

`DiscordSDK` now exposes a public `handshake()` method. Calling it:

1. Resets the internal `isReady` flag to `false`
2. Re-registers the internal `READY` listener (deduplication-safe via `off` + `once`)
3. Re-sends the handshake `postMessage` to the Discord client

`IDiscordSDK` and `DiscordSDKMock` are updated to match.

### New: `disableAutoHandshake` config option

`SdkConfiguration` has a new optional field (default `false`). When `true`, the constructor does not call `handshake()` automatically. The app controls when the handshake fires:

```typescript
const sdk = new DiscordSDK(CLIENT_ID, { disableAutoHandshake: true });
// ... later, after middleware is done ...
sdk.handshake();
await sdk.ready();
```

---

## Usage in the consumer project

```typescript
const sdk = new DiscordSDK(CLIENT_ID, { disableAutoHandshake: true });

// In your setup hook, after React has mounted:
sdk.handshake();
await sdk.ready();
// ... authenticate etc.
```

### Mock environments

`DiscordSDKMock.handshake()` immediately emits `READY` on the internal event bus, mirroring what a real connection does. No changes are needed to existing mock usage.

---

## Installing from the fork

```json
"@discord/embedded-app-sdk": "github:thosebeyond/embedded-app-sdk#main"
```

The compiled `output/` is committed to the repo, so no build step is required on install. When updating the fork, rebuild locally (`npm run build`), commit the updated `output/`, and push. Then update `package-lock.json` in the consumer project with `npm install`.
