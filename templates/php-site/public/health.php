<?php
declare(strict_types=1);

/**
 * Deploy health endpoint. Kept deliberately cheap: it must answer even when the
 * application itself is unhappy, so the release tooling can tell "server up, app broken"
 * apart from "server down".
 */
header('Content-Type: application/json');
header('Cache-Control: no-store');

$release = @file_get_contents(__DIR__ . '/../RELEASE') ?: 'unknown';

$checks = [
    'php'     => PHP_VERSION,
    'release' => trim($release),
    'writable_tmp' => is_writable(sys_get_temp_dir()),
];

// Optional DB probe - only if the app has already been configured.
if (file_exists(__DIR__ . '/../config/db.php')) {
    try {
        require_once __DIR__ . '/../config/db.php';
        $checks['db'] = 'ok';
    } catch (Throwable $e) {
        http_response_code(503);
        $checks['db'] = 'failed';
    }
}

echo json_encode(['status' => http_response_code() === 200 ? 'ok' : 'degraded'] + $checks, JSON_PRETTY_PRINT);
