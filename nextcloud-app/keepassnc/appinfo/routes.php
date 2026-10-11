<?php

declare(strict_types=1);

return [
	'routes' => [
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
		['name' => 'page#sw', 'url' => '/sw.js', 'verb' => 'GET'],
		['name' => 'pepper#get', 'url' => '/api/kf-pepper', 'verb' => 'GET'],
		['name' => 'pepper#rotate', 'url' => '/api/kf-pepper/rotate', 'verb' => 'POST'],
	],
];
