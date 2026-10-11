// KeePassNC - Einstieg. Die gesamte Oberflaeche baut ausschliesslich mit DOM-Methoden und textContent (kein innerHTML mit Daten).
import { readNextcloudContext } from './nextcloud.js';
import { setLang, detectLang } from './i18n.js';
import { ctx, applyTheme } from './ui/ctx.js';
import { showLogin } from './ui/login.js';
import { installShortcuts } from './ui/shell.js';
import { installGlobalListeners, ensureOfflineApp } from './ui/session.js';
import { langNow } from './ui/settings-dialog.js';

ctx.app = document.getElementById('app');
ctx.NC = readNextcloudContext(ctx.app);
setLang(langNow());
applyTheme();
ctx.ui.showLogin = showLogin;
ctx.ui.rerender = () => (ctx.state.vault ? ctx.ui.showMain() : showLogin());
installGlobalListeners();
installShortcuts();
showLogin();
ensureOfflineApp();
