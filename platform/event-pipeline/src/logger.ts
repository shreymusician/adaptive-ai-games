/**
 * Minimal structured logger. Deliberately dependency-free (no winston/pino)
 * to keep the pipeline package self-contained — every line is a single JSON
 * object on stdout/stderr, which is exactly what every log aggregator
 * (CloudWatch, Datadog, Loki, etc.) wants to ingest. Swap the `sink` in
 * tests to capture output instead of hitting the console.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface LogSink {
  write(level: LogLevel, message: string, fields: LogFields): void;
}

/** Default sink: writes one JSON line per call, level-appropriate stream. */
export class ConsoleLogSink implements LogSink {
  write(level: LogLevel, message: string, fields: LogFields): void {
    const record = {
      ts: new Date().toISOString(),
      level,
      message,
      ...fields,
    };
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'warn') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}

/** In-memory sink for tests — captures records instead of printing them. */
export class MemoryLogSink implements LogSink {
  readonly records: Array<{ level: LogLevel; message: string; fields: LogFields }> = [];
  write(level: LogLevel, message: string, fields: LogFields): void {
    this.records.push({ level, message, fields });
  }
  clear(): void {
    this.records.length = 0;
  }
}

export class Logger {
  constructor(
    private readonly sink: LogSink = new ConsoleLogSink(),
    private readonly context: LogFields = {}
  ) {}

  /** Returns a child logger with additional fields merged into every record. */
  child(fields: LogFields): Logger {
    return new Logger(this.sink, { ...this.context, ...fields });
  }

  debug(message: string, fields: LogFields = {}): void {
    this.sink.write('debug', message, { ...this.context, ...fields });
  }

  info(message: string, fields: LogFields = {}): void {
    this.sink.write('info', message, { ...this.context, ...fields });
  }

  warn(message: string, fields: LogFields = {}): void {
    this.sink.write('warn', message, { ...this.context, ...fields });
  }

  error(message: string, fields: LogFields = {}): void {
    this.sink.write('error', message, { ...this.context, ...fields });
  }
}

/** Process-wide default logger. Individual modules should prefer having a
 *  Logger injected, but this exists for call sites where wiring one through
 *  isn't worth the churn (e.g. top-level process handlers). */
export const rootLogger = new Logger(new ConsoleLogSink(), { service: 'event-pipeline' });
