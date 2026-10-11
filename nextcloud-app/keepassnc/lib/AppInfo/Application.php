<?php

declare(strict_types=1);

namespace OCA\Keepassnc\AppInfo;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\Keepassnc\Listener\LoadAdditionalScriptsListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

class Application extends App implements IBootstrap {
	public const APP_ID = 'keepassnc';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		// Fuegt in der Dateien-App die Aktion "Mit KeePassNC oeffnen" fuer .kdbx-Dateien hinzu.
		$context->registerEventListener(LoadAdditionalScriptsEvent::class, LoadAdditionalScriptsListener::class);
	}

	public function boot(IBootContext $context): void {
	}
}
