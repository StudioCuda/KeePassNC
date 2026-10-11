import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { chromium } from 'playwright-core';
import { startServer } from '/tmp/claude-0/-home-claude/41d4df95-d509-51be-b03b-cb1174f507d0/scratchpad/keepassnc/tests/e2e/davserver.mjs';
const d='/tmp/claude-0/-home-claude/41d4df95-d509-51be-b03b-cb1174f507d0/scratchpad/daily';
const meta=JSON.parse(fs.readFileSync(d+'/daily.json'));
const davRoot=fs.mkdtempSync(path.join(os.tmpdir(),'dbg-')); fs.copyFileSync(d+'/daily.kdbx',davRoot+'/daily.kdbx');
const {port,stop}=await startServer({webRoot:'/tmp/claude-0/-home-claude/41d4df95-d509-51be-b03b-cb1174f507d0/scratchpad/keepassnc/web',davRoot});
const exe=fs.readdirSync('/opt/pw-browsers').filter(x=>/^chromium-\d+$/.test(x)).map(x=>`/opt/pw-browsers/${x}/chrome-linux/chrome`)[0];
const b=await chromium.launch({executablePath:exe,args:['--no-sandbox']});
const p=await (await b.newContext({locale:'de-DE'})).newPage();
await p.goto(`http://127.0.0.1:${port}`);
await p.fill('#dav-url',`http://127.0.0.1:${port}/dav/daily.kdbx`);await p.fill('#dav-user','tester');await p.fill('#dav-pass','app-secret');await p.fill('#master',meta.password);await p.setInputFiles('#keyfile',d+'/daily.keyx');await p.click('#open-btn');await p.locator('.shell').waitFor({timeout:90000});
for (const q of ['title:"Mit Anhaengen"','Anhaeng','title:Mit','Mit Verlauf']) { await p.fill('#search',q); await p.waitForTimeout(200); console.log(q, await p.locator('[data-testid=entry-row]').count(), (await p.locator('#list').innerText()).slice(0,120).replace(/\n/g,'|')); }
await b.close(); await stop();
