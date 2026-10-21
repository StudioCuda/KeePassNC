<?php

declare(strict_types=1);

namespace OCA\Keepassnc\Util;

/**
 * Helper for the URLs Nextcloud hands out when the instance runs in a sub-folder (webroot), e.g. https://host/nc/.
 */
class UrlHelper {
	/**
	 * Removes a doubled webroot from a URL.
	 *
	 * Some instances carry the webroot in 'apps_paths[].url' of config.php (e.g. "/nc/apps" instead of
	 * "/apps"). Nextcloud then prepends the webroot a second time: "/nc/apps/keepassnc/js/app.js"
	 * becomes "/nc/nc/apps/keepassnc/js/app.js". Such URLs don't resolve in the browser, the page
	 * stays empty.
	 *
	 * The paths on the page stay relative (no Mixed Content behind a reverse proxy without
	 * overwriteprotocol, see PageController), so only the surplus webroot is removed and nothing is
	 * turned into an absolute URL.
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
