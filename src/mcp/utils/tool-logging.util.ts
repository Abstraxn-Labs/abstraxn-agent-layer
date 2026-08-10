import { Logger } from '@nestjs/common';

/** One `Logger` per tool file, named after the tool for grep-able log lines. */
export function createToolLogger(toolName: string): Logger {
  return new Logger(toolName);
}

/** Logs a caught error at `warn` and returns its message, for embedding in an error tool result. */
export function logToolFailure(
  logger: Logger,
  context: string,
  error: unknown,
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  logger.warn(`${context} failed: ${message}`);
  return message;
}
