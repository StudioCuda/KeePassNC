<?php

declare(strict_types=1);

namespace OCA\Keepassnc\Migration;

use OCA\Keepassnc\AppInfo\Application;
use OCP\Config\IUserConfig;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;

/**
 * Uninstall-Schritt: entfernt alles, was die App pro Benutzer in der Datenbank ablegt (derzeit nur den Pepper, siehe
 * PepperController). Nextcloud ruft Uninstall-Schritte bei jedem Deaktivieren auf, also auch bei "occ app:remove"; danach sind
 * gemerkte Schluesseldateien auf allen Geraeten ungueltig (wie nach "Erneuern"). KDBX-Dateien und Sicherungskopien gehoeren
 * den Benutzern und bleiben.
 */
class RemoveUserData implements IRepairStep {
	public function __construct(
		private IUserConfig $userConfig,
	) {
	}

	public function getName(): string {
		return 'Remove KeePassNC user settings';
	}

	public function run(IOutput $output): void {
		$this->userConfig->deleteApp(Application::APP_ID);
	}
}
