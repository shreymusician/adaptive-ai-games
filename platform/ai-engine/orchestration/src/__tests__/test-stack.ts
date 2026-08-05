import { Db } from 'mongodb';
import { OrchestrationStack } from '../bootstrap';
import { FakeDb } from './fake-mongo';

/** Builds a fully-wired OrchestrationStack against a fresh in-memory FakeDb — one call per test for isolation. */
export async function buildTestStack(): Promise<OrchestrationStack> {
  const db = new FakeDb() as unknown as Db;
  const stack = new OrchestrationStack({ db });
  await stack.initialize();
  return stack;
}
