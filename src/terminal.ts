/**
 * Máquina de estados del terminal de pago.
 *
 *   idle ──charge()──▶ processing ──respuesta del lector──▶ idle
 *
 * Solo hay un cobro a la vez: mientras el terminal está en `processing`, cualquier
 * cobro nuevo se rechaza con "Terminal ocupado".
 */
import type { AuthorizationResponse, PaymentDevice } from './protocol.ts';

export type TerminalState = 'idle' | 'processing';

export interface PendingTransaction {
  id: string;
  amountCents: number;
  startedAt: number;
}

export type ChargeResult =
  | { status: 'approved'; transactionId: string; amountCents: number; authCode: string }
  | { status: 'declined'; transactionId: string; amountCents: number; reason: string }
  | { status: 'timeout'; transactionId: string; amountCents: number };

export interface TerminalOptions {
  /** Tiempo máximo de espera de la respuesta del lector, en milisegundos. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export class TerminalBusyError extends Error {
  constructor() {
    super('Terminal ocupado');
    this.name = 'TerminalBusyError';
  }
}

const TIMEOUT = Symbol('timeout');

export class PaymentTerminal {
  private readonly device: PaymentDevice;
  private readonly timeoutMs: number;
  private currentState: TerminalState = 'idle';
  private pending: PendingTransaction | null = null;
  private sequence = 0;

  constructor(device: PaymentDevice, options: TerminalOptions = {}) {
    this.device = device;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get state(): TerminalState {
    return this.currentState;
  }

  get pendingTransaction(): PendingTransaction | null {
    return this.pending;
  }

  async charge(amountCents: number): Promise<ChargeResult> {
    if (this.currentState !== 'idle') {
      throw new TerminalBusyError();
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new RangeError(`Importe no válido: ${amountCents}`);
    }

    const transaction: PendingTransaction = {
      id: `TX-${String(++this.sequence).padStart(6, '0')}`,
      amountCents,
      startedAt: Date.now(),
    };
    this.currentState = 'processing';
    this.pending = transaction;

    let response: AuthorizationResponse | typeof TIMEOUT;
    try {
      response = await withTimeout(
        this.device.authorize({ transactionId: transaction.id, amountCents }),
        this.timeoutMs,
      );
    } catch (error) {
      this.finish();
      throw error;
    }

    if (response === TIMEOUT) {
      // El lector no ha contestado a tiempo: se anula la operación en el dispositivo.
      this.device.cancel(transaction.id);
      this.finish();
      return { status: 'timeout', transactionId: transaction.id, amountCents };
    }

    this.finish();
    if (!response.approved) {
      return {
        status: 'declined',
        transactionId: transaction.id,
        amountCents,
        reason: response.reason ?? 'Operación denegada',
      };
    }
    return {
      status: 'approved',
      transactionId: transaction.id,
      amountCents,
      authCode: response.authCode ?? '',
    };
  }

  /** Vuelve a `idle` y olvida la transacción en curso. */
  private finish(): void {
    this.currentState = 'idle';
    this.pending = null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
