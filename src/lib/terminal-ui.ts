// Minimal xterm.js page for the /terminal WebSocket endpoint.
// Protocol (developers.cloudflare.com/sandbox/guides/browser-terminals):
// - binary frames carry shell output (incl. ANSI escapes) and keystrokes in
// - JSON text frames carry control messages (ready / resize / exit / error)
// Note: no backticks or ${} in here — this is embedded as a plain string.
export function terminalUiHtml(
	options: {
		/** WebSocket path the terminal attaches to (defaults to /terminal). */
		wsPath?: string;
		/** Command typed into the shell once the session is ready. */
		autoRun?: string;
		/** Browser tab title. */
		title?: string;
	} = {},
): string {
	const wsPath = options.wsPath ?? "/terminal";
	const title = options.title ?? "sandbox terminal";
	// autoRun is worker-controlled, not user-controlled — but keep it shell-
	// safe anyway: nothing that could break out of the keystroke frame.
	const autoRun = (options.autoRun ?? "").replace(/[^A-Za-z0-9 _-]/g, "");
	// The container's pty server sends "ready" before the shell process has
	// actually attached (~3s in practice); keystrokes sent before the shell
	// starts are dropped, so the auto-run waits well past that window.
	const autoRunSend = autoRun
		? `setTimeout(function () { ws.send(enc.encode(${JSON.stringify(`${autoRun}\n`)})); }, 5000);`
		: "";
	return (
		`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<title>${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></scr` +
		`ipt>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></scr` +
		`ipt>
<style>
html,body{height:100%;margin:0;background:#000}
body{display:flex;flex-direction:column}
.touch-note{display:none;padding:8px 12px;font:12px system-ui;color:#9ca3af;border-bottom:1px solid #27272a}
#terminal{flex:1;min-height:0}
@media (pointer:coarse){
.touch-note{display:block}
body{padding-bottom:env(safe-area-inset-bottom)}
}
</style>
</head>
<body>
<div class="touch-note">This terminal needs a physical keyboard — on-screen keyboards can't send terminal shortcuts.</div>
<div id="terminal"></div>
<script>
var term = new Terminal({ cursorBlink: true });
var fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("terminal"));
fit.fit();

var proto = location.protocol === "https:" ? "wss" : "ws";
var ws = new WebSocket(proto + "://" + location.host + ${JSON.stringify(wsPath)});
ws.binaryType = "arraybuffer";

var dec = new TextDecoder();
var enc = new TextEncoder();

ws.addEventListener("message", function (ev) {
  if (ev.data instanceof ArrayBuffer) {
    term.write(dec.decode(ev.data));
    return;
  }
  var msg = JSON.parse(ev.data);
  if (msg.type === "ready") {
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    ${autoRunSend}
  } else if (msg.type === "exit") {
    term.write("\\r\\n[shell exited with code " + msg.code + "]\\r\\n");
  } else if (msg.type === "error") {
    term.write("\\r\\n[terminal error: " + msg.message + "]\\r\\n");
  }
});

term.onData(function (data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(data));
});

window.addEventListener("resize", function () {
  fit.fit();
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  }
});
</scr` +
		`ipt>
</body>
</html>`
	);
}

/** Back-compat: the shared review-sandbox terminal page. */
export const TERMINAL_UI_HTML = terminalUiHtml();
