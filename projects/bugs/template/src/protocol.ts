/**
 * Protocolo con el lector de tarjetas.
 *
 * `SimulatedDevice` imita un lector real: contesta tras una latencia, deniega los
 * importes por encima de un límite y puede quedarse sin contestar, que es lo que pasa
 * en tienda cuando se corta la conexión con el banco a mitad de un cobro.
 */

export interface AuthorizationRequest {
  transactionId: string;
  amountCents: number;
}

export interface AuthorizationResponse {
  approved: boolean;
  authCode?: string;
  reason?: string;
}

export interface PaymentDevice {
  /** Pide autorización al banco a través del lector. */
  authorize(request: AuthorizationRequest): Promise<AuthorizationResponse>;
  /** Anula en el lector una operación que ya no se va a esperar. */
  cancel(transactionId: string): void;
}

export interface SimulatedDeviceOptions {
  /** Latencia de cada autorización, en milisegundos. */
  latencyMs?: number;
  /** Importes por encima de este límite se deniegan. */
  declineAboveCents?: number;
}

export class SimulatedDevice implements PaymentDevice {
  /** Operaciones anuladas, en orden. */
  readonly cancelled: string[] = [];

  private readonly latencyMs: number;
  private readonly declineAboveCents: number;
  private readonly inFlight = new Map<string, ReturnType<typeof setTimeout>>();
  private hangs = 0;

  constructor(options: SimulatedDeviceOptions = {}) {
    this.latencyMs = options.latencyMs ?? 800;
    this.declineAboveCents = options.declineAboveCents ?? 50_000;
  }

  /** Las próximas `count` autorizaciones no recibirán respuesta. */
  hangNext(count = 1): void {
    this.hangs += count;
  }

  authorize(request: AuthorizationRequest): Promise<AuthorizationResponse> {
    if (this.hangs > 0) {
      this.hangs -= 1;
      return new Promise(() => {});
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.inFlight.delete(request.transactionId);
        if (request.amountCents > this.declineAboveCents) {
          resolve({ approved: false, reason: 'Importe superior al límite autorizado' });
        } else {
          resolve({ approved: true, authCode: authCodeFor(request.transactionId) });
        }
      }, this.latencyMs);
      this.inFlight.set(request.transactionId, timer);
    });
  }

  cancel(transactionId: string): void {
    const timer = this.inFlight.get(transactionId);
    if (timer) {
      clearTimeout(timer);
      this.inFlight.delete(transactionId);
    }
    this.cancelled.push(transactionId);
  }
}

function authCodeFor(transactionId: string): string {
  let hash = 0;
  for (const char of transactionId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000;
  }
  return String(hash).padStart(6, '0');
}
