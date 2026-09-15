// CDP Test Script
const tempDir = await Deno.makeTempDir();
const chromeProcess = new Deno.Command("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", {
  args: [
    "--headless=new",
    "--remote-debugging-port=9222",
    `--user-data-dir=${tempDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "http://localhost:3000"
  ]
}).spawn();

// Wait for CDP
let targets = null;
for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch("http://127.0.0.1:9222/json");
    targets = await res.json();
    if (targets && targets.length > 0) break;
  } catch (_e) {
    await new Promise(r => setTimeout(r, 200));
  }
}

console.log("Found targets:", targets.length);
const target = targets.find(t => t.type === "page") || targets[0];
console.log("Target ws:", target.webSocketDebuggerUrl);

const ws = new WebSocket(target.webSocketDebuggerUrl);

await new Promise((resolve) => {
  ws.onopen = resolve;
});

let msgId = 1;
function send(method, params = {}) {
  const id = msgId++;
  return new Promise((resolve) => {
    const handler = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.id === id) {
        ws.removeEventListener("message", handler);
        resolve(data.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");
await new Promise(r => setTimeout(r, 1000));

// Capture screenshot
const screenshot = await send("Page.captureScreenshot", { format: "png" });
await Deno.mkdir("./screenshots", { recursive: true });
await Deno.writeFile("./screenshots/dashboard_live.png", Uint8Array.from(atob(screenshot.data), c => c.charCodeAt(0)));
console.log("Screenshot saved to ./screenshots/dashboard_live.png!");

ws.close();
chromeProcess.kill();
await chromeProcess.status;
