/**
 * Minimal structured logger — same dependency-free design as
 * @adaptive-ai/memory-engine's logger.ts, duplicated rather than shared
 * because these are peer leaf packages and a two-consumer shared-utils
 * package isn't worth the indirection yet.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface LogSink {
  write(level: LogLevel, message: string, fields: LogFields): void;
}

export class ConsoleLogSink implements LogSink {
  write(level: LogLevel, message: string, fields: LogFields): void {
    const record = { ts: new Date().toISOString(), level, message, ...fields };
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

export const rootLogger = new Logger(new ConsoleLogSink(), { service: 'player-modeling' });
