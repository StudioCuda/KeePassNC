<?php

declare(strict_types=1);

namespace OCA\Keepassnc\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Keepassnc\AppInfo\Application;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/** @template-implements IEventListener<LoadAdditionalScriptsEvent> */
class LoadAdditionalScriptsListener implements IEventListener {
	public function handle(Event $event): void {
		if (!$event instanceof LoadAdditionalScriptsEvent) {
			return;
		}
		// Nextcloud builds this URL itself. On an instance that hands out app paths with the webroot twice (see PageController) the script
		// does not load; that can only be fixed in the instance's config.php.
		Util::addScript(Application::APP_ID, 'files-action');
	}
}
