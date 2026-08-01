import { describe, it, expect } from 'vitest';
import { Logger, MemoryLogSink } from '../logger';

describe('Logger', () => {
  it('writes records with level, message, and fields', () => {
    const sink = new MemoryLogSink();
    const logger = new Logger(sink);
    logger.info('hello', { a: 1 });
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({ level: 'info', message: 'hello', fields: { a: 1 } });
  });

  it('supports all four levels', () => {
    const sink = new MemoryLogSink();
    const logger = new Logger(sink);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(sink.records.map((r) => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('child() merges context fields into every subsequent record', () => {
    const sink = new MemoryLogSink();
    const logger = new Logger(sink, { service: 'test' });
    const child = logger.child({ requestId: 'r1' });
    child.info('hi');
    expect(sink.records[0].fields).toMatchObject({ service: 'test', requestId: 'r1' });
  });

  it('per-call fields override context fields with the same key', () => {
    const sink = new MemoryLogSink();
    const logger = new Logger(sink, { level: 'context' });
    logger.info('hi', { level: 'call' } as any);
    expect(sink.records[0].fields.level).toBe('call');
  });

  it('MemoryLogSink.clear() empties recorded entries', () => {
    const sink = new MemoryLogSink();
    const logger = new Logger(sink);
    logger.info('one');
    sink.clear();
    expect(sink.records).toHaveLength(0);
  });
});
