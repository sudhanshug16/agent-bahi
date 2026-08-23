export interface JsonSchema {
  readonly type: "object";
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface DispatchSuccess {
  readonly ok: true;
  readonly operationId: string;
  readonly result: unknown;
  readonly resultHash: string;
  readonly replayed?: boolean;
}

export interface DispatchError {
  readonly ok: false;
  readonly operationId?: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export type DispatchEnvelope = DispatchSuccess | DispatchError;

export function isDispatchSuccess(value: DispatchEnvelope): value is DispatchSuccess {
  return value.ok;
}
