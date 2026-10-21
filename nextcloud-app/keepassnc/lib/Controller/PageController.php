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
 * Serves the KeePassNC page as a standalone HTML document (without the Nextcloud layout and without core scripts).
 * That makes the page independent of layout/frontend changes in future Nextcloud versions and allows
 * a very strict Content-Security-Policy. The server only serves the app and the encrypted file;
 * decryption happens exclusively in the browser.
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
	public function index(?string $open = null, ?string $new = null): Response {
		$user = $this->userSession->getUser();
		$uid = $user?->getUID() ?? '';
		$version = $this->appManager->getAppVersion(Application::APP_ID);

		// Without a trailing "/": with pretty URLs (htaccess.IgnoreFrontController, e.g. YunoHost) linkTo() returns only "/" or
		// "/subfolder/", and "/" . "/csrftoken" turned into "//csrftoken", which the browser reads as a host named "csrftoken" (issue #50).
		$indexPhp = rtrim($this->urlGenerator->linkTo('', 'index.php'), '/');
		// Relative like all the other addresses of the page: linkToRemote() builds an absolute URL from protocol and host as PHP sees them.
		// Behind a reverse proxy without overwriteprotocol that becomes http://, and browser (mixed content) and CSP (connect-src 'self')
		// block the request before it reaches the server (issue #50).
		$davBase = $this->urlGenerator->linkTo('', 'remote.php') . '/dav/files/' . rawurlencode($uid);
		try {
			$filesUrl = $this->urlGenerator->linkToRoute('files.view.index');
		} catch (\Throwable) {
			$filesUrl = $indexPhp . '/apps/files/';
		}

		// Only paths inside the user's own directory; strip control characters. Further checks in the browser and by
		// WebDAV itself (permissions). $new: suggestion for a new database from "+ New" in Files (the file doesn't exist yet).
		$clean = static fn (?string $p): string => $p === null ? '' : (string)preg_replace('/[\x00-\x1F\x7F]/', '', $p);
		$file = $clean($open);
		$newFile = $clean($new);

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
			'__NEW__' => $newFile,
			'__CSS__' => $this->urlGenerator->linkTo(Application::APP_ID, 'css/keepassnc.css') . '?v=' . $version,
			'__JS__' => $this->urlGenerator->linkTo(Application::APP_ID, 'js/keepassnc.js') . '?v=' . $version,
			'__ICON__' => $this->urlGenerator->linkTo(Application::APP_ID, 'img/favicon.svg') . '?v=' . $version,
			'__TOUCH__' => $this->urlGenerator->linkTo(Application::APP_ID, 'img/apple-touch-icon.png') . '?v=' . $version,
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
	 * Service worker (keeps the app page ready for offline start). Public and reachable without login, because the browser has to
	 * check for updates without being redirected to the login page; the content is plain app code, the same for everyone.
	 * It lives at the same path as the page so that its scope covers the page.
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
	 * Primary colour and light/dark choice for theming the page. Colour via OCP\Defaults (respects the person's own colour);
	 * the theme choice has no public PHP interface and is stored as the user value theming/enabled-themes (JSON list,
	 * an enforced theme from enforce_theme comes first). On errors or without the theming app: empty, the page keeps its look.
	 *
	 * @return array{0: string, 1: string} [colour '#rrggbb' or '', theme IDs separated by comma]
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
	 * Content of the header bar (app menu and account menu) from Nextcloud's public navigation, as JSON for data-nc-nav.
	 * The browser checks the values once more (src/nextcloud.js). The logout link comes without requesttoken: the page sits in the
	 * offline cache, the browser fetches a fresh token on click.
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
			// Navigation actions only exist from Nextcloud 35 (INavigationManager::TYPE_ACTION); in 34 'action' returns nothing.
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
				// Like Nextcloud's app menu: admins get the "More apps" tile at the end (generateUrl('/settings/apps')).
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
		$csp->allowEvalWasm(); // Argon2 runs as WebAssembly; no 'unsafe-eval'
		$csp->addAllowedStyleDomain("'self'");
		$csp->addAllowedImageDomain("'self'");
		$csp->addAllowedImageDomain('data:');
		$csp->addAllowedConnectDomain("'self'");
		// No addAllowedFrameAncestorDomain(): EmptyContentSecurityPolicy then sets frame-ancestors 'none'. The page is never embedded;
		// so other apps on the same Nextcloud origin can't frame it invisibly (clickjacking, covert snooping).
		return $csp;
	}
}
