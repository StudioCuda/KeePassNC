<?php

declare(strict_types=1);

namespace OCA\Keepassnc\Controller;

use OCA\Keepassnc\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IURLGenerator;
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
		$davBase = rtrim($this->urlGenerator->linkToRemote('dav'), '/') . '/files/' . rawurlencode($uid);
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

		$vars = [
			'__DAV_BASE__' => $davBase,
			'__CSRF_URL__' => $indexPhp . '/csrftoken',
			'__FILES_URL__' => $filesUrl,
			'__USER__' => $uid,
			'__FILE__' => $file,
			'__CSS__' => $this->urlGenerator->linkTo(Application::APP_ID, 'css/keepassnc.css') . '?v=' . $version,
			'__JS__' => $this->urlGenerator->linkTo(Application::APP_ID, 'js/keepassnc.js') . '?v=' . $version,
			'__LANG__' => 'de',
		];
		$template = file_get_contents(__DIR__ . '/../../templates/page.html');
		$html = strtr($template, array_map(static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8'), $vars));

		$response = new DataDisplayResponse($html, 200, ['Content-Type' => 'text/html; charset=utf-8']);
		$response->addHeader('Cache-Control', 'no-store');
		$response->addHeader('Referrer-Policy', 'no-referrer');
		$response->setContentSecurityPolicy($this->contentSecurityPolicy());
		return $response;
	}

	private function contentSecurityPolicy(): EmptyContentSecurityPolicy {
		$csp = new EmptyContentSecurityPolicy();
		$csp->addAllowedScriptDomain("'self'");
		$csp->allowEvalWasm(); // Argon2 laeuft als WebAssembly; kein 'unsafe-eval'
		$csp->addAllowedStyleDomain("'self'");
		$csp->addAllowedImageDomain("'self'");
		$csp->addAllowedImageDomain('data:');
		$csp->addAllowedConnectDomain("'self'");
		$csp->addAllowedFrameAncestorDomain("'self'");
		return $csp;
	}
}
