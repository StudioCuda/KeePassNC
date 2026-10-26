<?php

declare(strict_types=1);

namespace OCA\Keepassnc\Controller;

use OCA\Keepassnc\AppInfo\Application;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Config\IUserConfig;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Server secret ("pepper") for remembered key files (see docs/KEYFILE-MEMORY.md).
 *
 * The browser derives the key for the locally stored record from the master password (Argon2id) AND this value (HKDF).
 * The server knows neither the password nor the key file nor the record - the value alone is worthless. A thief with a copy of the
 * browser profile can't guess offline without a valid Nextcloud session. "Renew" invalidates all remembered key files of this
 * user on all devices at once (e.g. lost laptop).
 *
 * Both calls require a logged-in session and the CSRF token (requesttoken, AppFramework default).
 */
class PepperController extends Controller {
	private const KEY = 'kf_pepper';

	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
		private IUserConfig $userConfig,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	public function get(): JSONResponse {
		$uid = $this->uid();
		if ($uid === null) {
			return $this->noStore(new JSONResponse(['error' => 'unauthorized'], Http::STATUS_UNAUTHORIZED));
		}
		$cur = $this->read($uid);
		if ($cur === null) {
			$mine = $this->create($uid);
			// Two tabs can get here at once, and the last write wins. Look again and hand out what is stored rather than what this
			// request wrote, so both tabs end up with the same value. (Narrows the window; setValueString has no "only if absent".)
			$cur = $this->read($uid) ?? $mine;
		}
		return $this->noStore(new JSONResponse($cur));
	}

	#[NoAdminRequired]
	public function rotate(): JSONResponse {
		$uid = $this->uid();
		if ($uid === null) {
			return $this->noStore(new JSONResponse(['error' => 'unauthorized'], Http::STATUS_UNAUTHORIZED));
		}
		return $this->noStore(new JSONResponse($this->create($uid)));
	}

	private function uid(): ?string {
		$user = $this->userSession->getUser();
		return $user === null ? null : $user->getUID();
	}

	/** @return array{v:int,id:string,pepper:string}|null */
	private function read(string $uid): ?array {
		$raw = $this->userConfig->getValueString($uid, Application::APP_ID, self::KEY, '', true);
		if ($raw === '') {
			return null;
		}
		$d = json_decode($raw, true);
		if (!is_array($d) || !is_string($d['id'] ?? null) || !is_string($d['pepper'] ?? null)
			|| !preg_match('/^[0-9a-f]{32}$/', $d['id']) || strlen((string)base64_decode($d['pepper'], true)) !== 32) {
			return null; // unusable -> regenerate (remembered records become invalid as a result, nothing else)
		}
		return ['v' => 1, 'id' => $d['id'], 'pepper' => $d['pepper']];
	}

	/** @return array{v:int,id:string,pepper:string} */
	private function create(string $uid): array {
		$d = ['v' => 1, 'id' => bin2hex(random_bytes(16)), 'pepper' => base64_encode(random_bytes(32))];
		$this->userConfig->setValueString($uid, Application::APP_ID, self::KEY, (string)json_encode($d), true,
			IUserConfig::FLAG_SENSITIVE | IUserConfig::FLAG_INTERNAL);
		return $d;
	}

	private function noStore(JSONResponse $r): JSONResponse {
		$r->addHeader('Cache-Control', 'no-store');
		return $r;
	}
}
