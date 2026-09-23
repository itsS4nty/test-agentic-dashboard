#!/usr/bin/env bash
# Coordinador de una ejecución ya en marcha:  RUN=run_x COORD=term_y ./coordinador.sh
set -euo pipefail
ORCA=${ORCA:-orca}
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${RUN:?falta RUN}" ; : "${COORD:?falta COORD}"
# Orca mezcla líneas de log de Electron con el JSON: nos quedamos desde la primera llave.
json() { python3 -c "
import sys, json
t = sys.stdin.read(); i = t.find('{')
d = json.loads(t[i:]) if i >= 0 else {}
print(eval(sys.argv[1]))" "$1"; }

# Coordinador: imprime lo que llega y contesta las preguntas.
while true; do
  LOTE=$("$ORCA" orchestration check --terminal "$COORD" --run "$RUN" --wait --timeout-ms 900000 --json 2>/dev/null || true)
  if [ -z "$LOTE" ] || ! echo "$LOTE" | grep -q '{'; then echo "· Sin mensajes. Fin."; break; fi

  echo "$LOTE" | python3 - "$RUN" <<'PY'
import json, sys
t = sys.stdin.read(); i = t.find('{')
d = json.loads(t[i:]) if i >= 0 else {}
for m in (d.get('result') or {}).get('messages', []):
    print(f"\n  [{m.get('type','mensaje')}] {m.get('subject','')}")
    if m.get('body'):
        print("  " + m['body'].replace("\n", "\n  "))
    if m.get('type') == 'question':
        print(f"  (id {m.get('id')}) opciones: {m.get('options')}")
PY

  PREGUNTA=$(echo "$LOTE" | json "next((m['id'] for m in (d.get('result') or {}).get('messages',[]) if m.get('type')=='question'), '')" 2>/dev/null || true)
  if [ -n "${PREGUNTA:-}" ]; then
    echo
    if [ -n "${RESPUESTA_AUTO:-}" ]; then
      RESPUESTA="$RESPUESTA_AUTO"
      echo "  Respuesta automática: $RESPUESTA"
    else
      read -r -p "  Respuesta del coordinador (por ejemplo: aprobar): " RESPUESTA
    fi
    "$ORCA" orchestration reply --id "$PREGUNTA" --body "${RESPUESTA:-aprobar}" --from "$COORD" --run "$RUN" --json >/dev/null
    echo "  Respondido: ${RESPUESTA:-aprobar}"
  fi

  DELIVERY=$(echo "$LOTE" | json "(d.get('result') or {}).get('deliveryId','')" 2>/dev/null || true)
  [ -n "${DELIVERY:-}" ] && "$ORCA" orchestration check --terminal "$COORD" --run "$RUN" --ack "$DELIVERY" --json >/dev/null 2>&1 || true

  if [ -f salida/3-resumen-interno.md ]; then
    echo
    echo "· Listo. Resultados en salida/"
    break
  fi
done
