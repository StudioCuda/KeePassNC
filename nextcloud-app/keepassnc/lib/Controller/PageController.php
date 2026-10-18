<?php

declare(strict_types=1);

namespace OCA\Keepassnc\Controller;

use OCA\Keepassnc\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\AppFramework\Http\Response;
use OCP\Defaults;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\INavigationManager;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;
use OCP\IUserSession;

/**
 * Liefert die KeePassNC-Seite als eigenstaendiges HTML-Dokument aus (ohne Nextcloud-Layout und ohne Core-Skripte).
 * Das macht die Seite unabhaengig von Layout-/Frontend-Aenderungen zukuenftiger Nextcloud-Versionen und erlaubt
 * eine sehr strenge Content-Security-Policy. Der Server liefert nur die App und die verschluesselte Datei aus;
 * Entschluesselung findet ausschliesslich im Browser statt.
 */
class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private IURLGenerator $urlGenerator,
		private IUserSession $userSession,
		private IAppManager $appManager,
		private IFactory $l10nFactory,
		private Defaults $defaults,
		private IConfig $config,
		private INavigationManager $navigationManager,
		private IGroupManager $groupManager,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(?string $open = null): Response {
		$user = $this->userSession->getUser();
		$uid = $user?->getUID() ?? '';
		$version = $this->appManager->getAppVersion(Application::APP_ID);

		$indexPhp = $this->urlGenerator->linkTo('', 'index.php');
		// Relativ wie alle anderen Adressen der Seite: linkToRemote() baut eine absolute URL aus Protokoll und Host, wie PHP sie sieht.
		// Hinter einem Reverse-Proxy ohne overwriteprotocol wird daraus http://, und Browser (Mixed Content) wie CSP (connect-src 'self')
		// blockieren den Abruf, bevor er den Server erreicht (Issue #50).
		$davBase = $this->urlGenerator->linkTo('', 'remote.php') . '/dav/files/' . rawurlencode($uid);
		try {
			$filesUrl = $this->urlGenerator->linkToRoute('files.view.index');
		} catch (\Throwable) {
			$filesUrl = $indexPhp . '/apps/files/';
		}

		$file = '';
		if ($open !== null) {
			// Nur der Pfad innerhalb des eigenen Benutzerverzeichnisses; Steuerzeichen entfernen. Weitere Pruefung im Browser
			// und durch WebDAV selbst (Berechtigungen).
			$file = (string)preg_replace('/[\x00-\x1F\x7F]/', '', $open);
		}

		try {
			$swUrl = $this->urlGenerator->linkToRoute('keepassnc.page.sw');
		} catch (\Throwable) {
			$swUrl = '';
		}

		try {
			$pepperUrl = $this->urlGenerator->linkToRoute('keepassnc.pepper.get');
		} catch (\Throwable) {
			$pepperUrl = '';
		}

		try {
			$lang = (string)$this->l10nFactory->findLanguage();
		} catch (\Throwable) {
			$lang = 'en';
		}
		$lang = preg_match('/^[a-z]{2,3}/i', $lang, $m) ? strtolower($m[0]) : 'en';

		[$ncColor, $ncThemes] = $this->theming($uid);

		$vars = [
			'__SW_URL__' => $swUrl,
			'__PEPPER_URL__' => $pepperUrl,
			'__DAV_BASE__' => $davBase,
			'__CSRF_URL__' => $indexPhp . '/csrftoken',
			'__FILES_URL__' => $filesUrl,
			'__USER__' => $uid,
			'__FILE__' => $file,
			'__CSS__' => $this->urlGenerator->linkTo(Application::APP_ID, 'css/keepassnc.css') . '?v=' . $version,
			'__JS__' => $this->urlGenerator->linkTo(Application::APP_ID, 'js/keepassnc.js') . '?v=' . $version,
			'__LANG__' => $lang,
			'__NC_COLOR__' => $ncColor,
			'__NC_THEMES__' => $ncThemes,
			'__NC_NAV__' => $this->navigation($uid, $indexPhp),
		];
		$template = file_get_contents(__DIR__ . '/../../templates/page.html');
		$html = strtr($template, array_map(static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8'), $vars));

		$response = new DataDisplayResponse($html, 200, ['Content-Type' => 'text/html; charset=utf-8']);
		$response->addHeader('Cache-Control', 'no-store');
		$response->addHeader('Referrer-Policy', 'no-referrer');
		$response->setContentSecurityPolicy($this->contentSecurityPolicy());
		return $response;
	}

	/**
	 * Service Worker (haelt die App-Seite fuer den Offline-Start vor). Oeffentlich und ohne Anmeldung abrufbar, weil der Browser
	 * Aktualisierungen ohne Weiterleitung auf die Login-Seite pruefen muss; der Inhalt ist reiner, fuer alle gleicher App-Code.
	 * Er liegt unter demselben Pfad wie die Seite, damit sein Geltungsbereich die Seite umfasst.
	 */
	#[PublicPage]
	#[NoCSRFRequired]
	public function sw(): Response {
		$js = (string)file_get_contents(__DIR__ . '/../../js/sw.js');
		$response = new DataDisplayResponse($js, 200, ['Content-Type' => 'text/javascript; charset=utf-8']);
		$response->addHeader('Cache-Control', 'no-cache');
		$response->setContentSecurityPolicy($this->contentSecurityPolicy());
		return $response;
	}

	/**
	 * Primaerfarbe und Hell/Dunkel-Wahl fuer das Theming der Seite. Farbe ueber OCP\Defaults (beruecksichtigt die eigene Farbe der
	 * Person); die Theme-Wahl hat keine oeffentliche PHP-Schnittstelle und steht als Benutzerwert theming/enabled-themes (JSON-Liste,
	 * ein erzwungenes Theme aus enforce_theme kommt davor). Bei Fehlern oder ohne Theming-App: leer, die Seite behaelt ihren Look.
	 *
	 * @return array{0: string, 1: string} [Farbe '#rrggbb' oder '', Theme-IDs durch Komma getrennt]
	 */
	private function theming(string $uid): array {
		try {
			if (!$this->appManager->isEnabledForUser('theming')) {
				return ['', ''];
			}
			$color = strtolower(trim($this->defaults->getColorPrimary()));
			if (!preg_match('/^#([0-9a-f]{3}|[0-9a-f]{6})$/', $color)) {
				$color = '';
			}
			$themes = [];
			$enforced = $this->config->getSystemValueString('enforce_theme', '');
			if ($enforced !== '') {
				$themes[] = $enforced;
			}
			if ($uid !== '') {
				$list = json_decode($this->config->getUserValue($uid, 'theming', 'enabled-themes', '["default"]'), true);
				if (is_array($list)) {
					$themes = array_merge($themes, $list);
				}
			}
			$themes = array_filter($themes, static fn ($t): bool => is_string($t) && preg_match('/^[a-z0-9-]{1,40}$/', $t) === 1);
			return [$color, implode(',', array_slice(array_values(array_unique($themes)), 0, 10))];
		} catch (\Throwable) {
			return ['', ''];
		}
	}

	/**
	 * Inhalt der Kopfleiste (App-Menue und Benutzermenue) aus der oeffentlichen Navigation von Nextcloud, als JSON fuer data-nc-nav.
	 * Der Browser prueft die Werte noch einmal (src/nextcloud.js). Der Abmelde-Link kommt ohne requesttoken: Die Seite liegt im
	 * Offline-Cache, das Token holt der Browser beim Klick frisch.
	 */
	private function navigation(string $uid, string $indexPhp): string {
		if ($uid === '') {
			return '';
		}
		try {
			$this->navigationManager->setActiveEntry(Application::APP_ID);
			$apps = [];
			foreach ($this->navigationManager->getAll(INavigationManager::TYPE_APPS) as $e) {
				$apps[] = [
					'id' => (string)($e['id'] ?? ''),
					'name' => (string)($e['name'] ?? ''),
					'href' => (string)($e['href'] ?? ''),
					'icon' => (string)($e['icon'] ?? ''),
					'active' => ($e['active'] ?? false) === true,
				];
			}
			// Navigations-Aktionen gibt es erst ab Nextcloud 35 (INavigationManager::TYPE_ACTION); in 34 liefert 'action' nichts.
			$actions = [];
			foreach ($this->navigationManager->getAll('action') as $e) {
				$entry = ['id' => (string)($e['id'] ?? ''), 'name' => (string)($e['name'] ?? ''), 'href' => (string)($e['href'] ?? ''), 'icon' => (string)($e['icon'] ?? '')];
				if (isset($e['color'])) {
					$entry['color'] = (string)$e['color'];
				}
				$actions[] = $entry;
			}
			$settings = [];
			foreach ($this->navigationManager->getAll(INavigationManager::TYPE_SETTINGS) as $e) {
				$href = (string)($e['href'] ?? '');
				$csrf = false;
				if (($e['id'] ?? '') === 'logout' && preg_match('/[?&]requesttoken=/', $href)) {
					$href = (string)preg_replace('/([?&])requesttoken=[^&]*&?/', '$1', $href);
					$href = rtrim($href, '?&');
					$csrf = true;
				}
				$settings[] = ['id' => (string)($e['id'] ?? ''), 'name' => (string)($e['name'] ?? ''), 'href' => $href, 'icon' => (string)($e['icon'] ?? ''), 'csrf' => $csrf];
			}
			try {
				$avatar = $this->urlGenerator->linkToRoute('core.avatar.getAvatar', ['userId' => $uid, 'size' => 64]);
			} catch (\Throwable) {
				$avatar = '';
			}
			$json = json_encode([
				'home' => $this->urlGenerator->linkToDefaultPageUrl(),
				'logo' => $this->defaults->getLogo(),
				'avatar' => $avatar,
				'name' => $this->userSession->getUser()?->getDisplayName() ?? $uid,
				'apps' => $apps,
				// Wie das App-Menue von Nextcloud: Admins bekommen am Ende die Kachel "Weitere Apps" (generateUrl('/settings/apps')).
				'moreApps' => $this->groupManager->isAdmin($uid) ? $indexPhp . '/settings/apps' : '',
				'settings' => $settings,
				'actions' => $actions,
			], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
			return $json === false ? '' : $json;
		} catch (\Throwable) {
			return '';
		}
	}

	private function contentSecurityPolicy(): EmptyContentSecurityPolicy {
		$csp = new EmptyContentSecurityPolicy();
		$csp->addAllowedScriptDomain("'self'");
		$csp->allowEvalWasm(); // Argon2 laeuft als WebAssembly; kein 'unsafe-eval'
		$csp->addAllowedStyleDomain("'self'");
		$csp->addAllowedImageDomain("'self'");
		$csp->addAllowedImageDomain('data:');
		$csp->addAllowedConnectDomain("'self'");
		// Kein addAllowedFrameAncestorDomain(): EmptyContentSecurityPolicy setzt dann frame-ancestors 'none'. Die Seite wird nie eingebettet;
		// so koennen andere Apps derselben Nextcloud-Herkunft sie nicht unsichtbar einrahmen (Clickjacking, verdecktes Mitlesen).
		return $csp;
	}
}
