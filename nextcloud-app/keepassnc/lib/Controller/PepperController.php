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
 * Server-Geheimwert ("Pepper") fuer gemerkte Schluesseldateien (siehe docs/KEYFILE-MEMORY.md).
 *
 * Der Browser leitet den Schluessel fuer den lokal gespeicherten Datensatz aus Master-Passwort (Argon2id) UND diesem Wert ab (HKDF).
 * Der Server kennt weder Passwort noch Schluesseldatei noch den Datensatz - der Wert allein ist wertlos. Ein Dieb mit einer Kopie des
 * Browser-Profils kann ohne gueltige Nextcloud-Sitzung nicht offline raten. "Erneuern" macht alle gemerkten Schluesseldateien dieses
 * Benutzers auf allen Geraeten auf einen Schlag ungueltig (z. B. Laptop verloren).
 *
 * Beide Aufrufe verlangen eine angemeldete Sitzung und das CSRF-Token (requesttoken, Standard des AppFrameworks).
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
		return $this->noStore(new JSONResponse($cur ?? $this->create($uid)));
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
			return null; // unbrauchbar -> neu erzeugen (gemerkte Datensaetze werden dadurch ungueltig, nichts sonst)
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
