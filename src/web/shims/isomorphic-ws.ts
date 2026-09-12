// Browser-only compatibility adapter for Midnight's indexer provider.
// `isomorphic-ws` exposes a CommonJS default in the browser build, while the
// Midnight 4.1.1 bundle also imports a named `WebSocket`. Mapping both exports
// to the browser-native implementation keeps the provider on the real browser
// socket API and avoids an undefined named export at runtime.
const BrowserWebSocket = globalThis.WebSocket;

if (!BrowserWebSocket) {
  throw new Error('BLACKOUT_SAFE_BROWSER_WEBSOCKET_UNAVAILABLE');
}

export { BrowserWebSocket as WebSocket };
export default BrowserWebSocket;
