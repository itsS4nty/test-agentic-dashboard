import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentTerminal, TerminalBusyError } from '../src/terminal.ts';
import { SimulatedDevice } from '../src/protocol.ts';

test('cobra un importe aprobado y vuelve a idle', async () => {
  const terminal = new PaymentTerminal(new SimulatedDevice({ latencyMs: 5 }), { timeoutMs: 200 });

  const result = await terminal.charge(1250);

  assert.equal(result.status, 'approved');
  assert.equal(terminal.state, 'idle');
  assert.equal(terminal.pendingTransaction, null);
});

test('una operación denegada también libera el terminal', async () => {
  const device = new SimulatedDevice({ latencyMs: 5, declineAboveCents: 10_000 });
  const terminal = new PaymentTerminal(device, { timeoutMs: 200 });

  const result = await terminal.charge(25_000);

  assert.equal(result.status, 'declined');
  assert.equal(terminal.state, 'idle');
});

test('rechaza un segundo cobro mientras hay uno en curso', async () => {
  const terminal = new PaymentTerminal(new SimulatedDevice({ latencyMs: 30 }), { timeoutMs: 200 });

  const first = terminal.charge(900);
  assert.equal(terminal.state, 'processing');
  await assert.rejects(terminal.charge(450), TerminalBusyError);

  assert.equal((await first).status, 'approved');
});

test('rechaza importes no válidos sin cambiar de estado', async () => {
  const terminal = new PaymentTerminal(new SimulatedDevice({ latencyMs: 5 }), { timeoutMs: 200 });

  await assert.rejects(terminal.charge(0), RangeError);
  await assert.rejects(terminal.charge(12.5), RangeError);

  assert.equal(terminal.state, 'idle');
});

test('devuelve timeout y anula la operación si el lector no responde', async () => {
  const device = new SimulatedDevice({ latencyMs: 5 });
  const terminal = new PaymentTerminal(device, { timeoutMs: 20 });
  device.hangNext();

  const result = await terminal.charge(1250);

  assert.equal(result.status, 'timeout');
  assert.deepEqual(device.cancelled, [result.transactionId]);
});

test('tras un timeout vuelve a idle y acepta el siguiente cobro', async () => {
  const device = new SimulatedDevice({ latencyMs: 5 });
  const terminal = new PaymentTerminal(device, { timeoutMs: 20 });
  device.hangNext();

  const first = await terminal.charge(1250);
  assert.equal(first.status, 'timeout');

  const second = await terminal.charge(480);
  assert.equal(second.status, 'approved');
  assert.equal(terminal.state, 'idle');
  assert.equal(terminal.pendingTransaction, null);
});
