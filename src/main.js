// KeePassNC - entry point. The whole UI builds exclusively with DOM methods and textContent (no innerHTML with data).
import { readNextcloudContext } from './nextcloud.js';
import { setLang, detectLang } from './i18n.js';
import { ctx, applyTheme } from './ui/ctx.js';
import { showLogin } from './ui/login.js';
import { showCreate } from './ui/create.js';
import { installShortcuts } from './ui/shell.js';
import { installGlobalListeners, ensureOfflineApp } from './ui/session.js';
import { langNow } from './ui/settings-dialog.js';
import { renderNcHeader } from './ui/ncheader.js';
import { askRemoteCredentials } from './ui/credentials-dialog.js';
import { toast } from './ui/dom.js';
import { t } from './i18n.js';

ctx.app = document.getElementById('app');
ctx.NC = readNextcloudContext(ctx.app);
setLang(langNow());
applyTheme();
const ncHeader = renderNcHeader(ctx.NC); // Nextcloud only: header bar like the other apps
if (ncHeader) { document.body.prepend(ncHeader); document.body.classList.add('has-nch'); }
ctx.ui.showLogin = showLogin;
ctx.ui.showCreate = showCreate;
ctx.ui.askRemoteCredentials = askRemoteCredentials;
ctx.ui.rerender = () => (ctx.state.vault ? ctx.ui.showMain() : showLogin());
installGlobalListeners();
installShortcuts();
if (ctx.NC?.newFile) showCreate(); else showLogin(); // ?new= from "+ New" in Files
ensureOfflineApp();
if (ctx.NC?.urlFix) toast(t('nc.urlfix'), { kind: 'warn', timeout: 0, action: { label: t('close'), run() {} } });
