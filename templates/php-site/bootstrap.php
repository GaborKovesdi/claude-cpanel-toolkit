<?php
declare(strict_types=1);

/**
 * Loads environment from the .env that lives OUTSIDE the docroot and is linked in
 * from the release's shared directory, so it survives every deploy.
 */
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

$envFile = __DIR__ . '/.env';
if (is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#')) {
            continue;
        }
        [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
        $_ENV[trim($k)] = trim($v, " \t\"'");
    }
}

date_default_timezone_set($_ENV['APP_TZ'] ?? 'Europe/Budapest');
