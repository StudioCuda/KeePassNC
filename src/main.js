// KeePassNC - Einstieg. Die gesamte Oberflaeche baut ausschliesslich mit DOM-Methoden und textContent (kein innerHTML mit Daten).
import { readNextcloudContext } from './nextcloud.js';
import { setLang, detectLang } from './i18n.js';
import { ctx, applyTheme } from './ui/ctx.js';
import { showLogin } from './ui/login.js';
import { installShortcuts } from './ui/shell.js';
import { installGlobalListeners, ensureOfflineApp } from './ui/session.js';
import { langNow } from './ui/settings-dialog.js';
import { renderNcHeader } from './ui/ncheader.js';
import { askRemoteCredentials } from './ui/credentials-dialog.js';

ctx.app = document.getElementById('app');
ctx.NC = readNextcloudContext(ctx.app);
setLang(langNow());
applyTheme();
const ncHeader = renderNcHeader(ctx.NC); // nur in Nextcloud: Kopfleiste wie bei den anderen Apps
if (ncHeader) { document.body.prepend(ncHeader); document.body.classList.add('has-nch'); }
ctx.ui.showLogin = showLogin;
ctx.ui.askRemoteCredentials = askRemoteCredentials;
ctx.ui.rerender = () => (ctx.state.vault ? ctx.ui.showMain() : showLogin());
installGlobalListeners();
installShortcuts();
showLogin();
ensureOfflineApp();
