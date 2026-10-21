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
		// Die Adresse baut Nextcloud selbst. Liefert eine Instanz App-Pfade mit doppeltem webroot (siehe PageController), laedt das Skript
		// dort nicht; das laesst sich nur in der config.php der Instanz beheben.
		Util::addScript(Application::APP_ID, 'files-action');
	}
}
