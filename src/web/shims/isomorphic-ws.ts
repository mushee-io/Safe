const BrowserWebSocket = globalThis.WebSocket;

if (!BrowserWebSocket) {
  throw new Error('BLACKOUT_SAFE_BROWSER_WEBSOCKET_UNAVAILABLE');
}

export { BrowserWebSocket as WebSocket };
export default BrowserWebSocket;
