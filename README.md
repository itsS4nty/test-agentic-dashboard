# terminal-pagos

Software de cobro que ejecutan los datáfonos de las tiendas.

- `src/terminal.ts` — máquina de estados del terminal: `idle → processing → idle`.
  Solo hay un cobro a la vez; si llega otro mientras hay uno en curso, responde
  "Terminal ocupado".
- `src/protocol.ts` — protocolo con el lector de tarjetas y un lector simulado con
  latencia para los tests.
- `test/` — tests con `node:test`.

## Tests

```sh
node --import tsx --test test/*.test.ts
```

## Versiones

La versión publicada es la de `package.json`. Dispositivo despliega cada versión nueva en los
datáfonos de tienda.
