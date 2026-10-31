import fs from 'node:fs/promises';
await import('./verify-ui.mjs');
if (process.exitCode) process.exit(1);
const root = process.env.CODEX_TABS_LIVE_DIR;
const port = process.env.CODEX_TABS_DEBUG_PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const phase of ['first', 'resume']) {
  let sent = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !sent) {
    let request;
    try { request = JSON.parse(await fs.readFile(root + '/request.json', 'utf8')); } catch {}
    if (request?.phase !== phase) { await sleep(200); continue; }
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    for (const target of targets.filter(target => target.type === 'iframe' && target.url.includes('extensionId=openai.chatgpt'))) {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      const contexts = [], pending = new Map(); let next = 0;
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
        if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context.id);
      });
      const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout')); }, 5000);
        pending.set(id, response => { clearTimeout(timer); resolve(response); });
        socket.send(JSON.stringify({ id, method, params }));
      });
      try {
        await call('Runtime.enable');
        for (const contextId of contexts) {
          const focused = await call('Runtime.evaluate', { contextId, returnByValue: true,
            expression: `(()=>{if(!document.body?.innerText.includes(${JSON.stringify(request.title)}))return false;const input=document.querySelector('[contenteditable=true],textarea');if(!input)return false;input.focus();return document.activeElement===input;})()` });
          if (!focused.result?.result?.value) continue;
          await call('Input.insertText', { text: request.prompt });
          await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          await fs.writeFile(root + '/sent.json', JSON.stringify({ phase }));
          sent = true; break;
        }
      } finally { socket.close(); }
      if (sent) break;
    }
    if (!sent) await sleep(500);
  }
  if (!sent) throw Error('Could not enter the controlled live-test prompt: ' + phase);
}
