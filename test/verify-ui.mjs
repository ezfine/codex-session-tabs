import fs from 'node:fs/promises';

const port = process.env.CODEX_TABS_DEBUG_PORT || '9240';
const destination = process.env.CODEX_TABS_UI_READY_FILE;
const deadline = Date.now() + 60000;
let ready;
while (Date.now() < deadline && !ready) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    for (const target of targets.filter(target => target.type === 'iframe' && target.url.includes('extensionId=openai.chatgpt'))) {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      let next = 0;
      const pending = new Map();
      const contexts = [];
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
        else if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context.id);
      });
      const call = (method, params = {}) => Promise.race([
        new Promise(resolve => { const id = ++next; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('CDP timeout')), 4000)),
      ]);
      try {
        await call('Runtime.enable');
        for (const contextId of contexts) {
          const response = await call('Runtime.evaluate', { contextId, returnByValue: true,
            expression: '(()=>{const composer=!!document.querySelector("[contenteditable=true],textarea");if(!composer){const button=Array.from(document.querySelectorAll("button")).find(b=>["Next","Get started"].includes(b.textContent.trim()));if(button)button.click();}return {composer,textLength:document.body?.innerText.length||0,error:!!document.body?.innerText.includes("Codex could not start")};})()' });
          const value = response.result?.result?.value;
          if (value?.composer && value.textLength > 100 && !value.error) ready = { ready: true, composer: true, renderedCharacters: value.textLength };
        }
      } finally { socket.close(); }
    }
  } catch { /* Host or iframe may still be starting. */ }
  if (!ready) await new Promise(resolve => setTimeout(resolve, 1000));
}
if (ready && process.env.CODEX_TABS_UI_SCREENSHOT) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(target => target.type === 'page' && target.url.startsWith('vscode-file:'));
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    const screenshot = await new Promise(resolve => {
      socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id === 1) resolve(message.result.data); });
      socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
    await fs.writeFile(process.env.CODEX_TABS_UI_SCREENSHOT, Buffer.from(screenshot, 'base64'));
    socket.close();
  } catch { /* A screenshot is optional; renderer validation is required. */ }
}
await fs.writeFile(destination, JSON.stringify(ready || { ready: false, error: 'No rendered Codex composer within 60 seconds' }));
console.log(JSON.stringify(ready || { ready: false }));
if (!ready) process.exitCode = 1;
