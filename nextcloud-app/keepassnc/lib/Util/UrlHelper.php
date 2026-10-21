<?php

declare(strict_types=1);

namespace OCA\Keepassnc\Util;

/**
 * Hilfsfunktionen fuer die URLs, die Nextcloud liefert, wenn die App in einem Unterordner
 * (webroot) laeuft, z. B. https://host/nc/.
 */
class UrlHelper {
	/**
	 * Der webroot einer Nextcloud-Installation: der Pfadteil der Basis-URL, z. B. "/nc" aus
	 * "https://host/nc". Ohne Unterordner ist das "".
	 */
	public static function webroot(string $baseUrl): string {
		$path = parse_url($baseUrl, PHP_URL_PATH);
		return is_string($path) ? rtrim($path, '/') : '';
	}

	/**
	 * Entfernt einen doppelt enthaltenen webroot aus einer URL.
	 *
	 * Manche Instanzen tragen den webroot in 'apps_paths[].url' der config.php mit (z. B. "/nc/apps"
	 * statt "/apps"). Nextcloud haengt den webroot dann ein zweites Mal an: aus
	 * "/nc/apps/keepassnc/js/app.js" wird "/nc/nc/apps/keepassnc/js/app.js". Solche URLs loesen im
	 * Browser nicht auf, die Seite bleibt leer.
	 *
	 * Die Pfade der Seite bleiben relativ (kein Mixed Content hinter einem Reverse Proxy ohne
	 * overwriteprotocol, siehe PageController), deshalb wird hier nur der ueberzaehlige webroot
	 * entfernt und nichts in eine absolute URL umgewandelt.
	 */
	public static function withoutDuplicateWebroot(string $url, string $webroot): string {
		if ($url === '' || $webroot === '') {
			return $url;
		}
		$prefix = '';
		$path = $url;
		if (preg_match('#^(https?://[^/]+)(/.*)$#i', $url, $m) === 1) {
			$prefix = $m[1];
			$path = $m[2];
		}
		if (str_starts_with($path, $webroot . $webroot . '/')) {
			return $prefix . substr($path, strlen($webroot));
		}
		return $url;
	}
}
