#!/usr/bin/env bash
#
# Lanza los tres agentes de facturación en Orca y hace de coordinador.
#
#   ./orca-facturacion/lanzar.sh
#
# Abre cuatro pestañas en Orca: el coordinador y un agente por paso. Cada agente avisa al siguiente
# y al coordinador con la mensajería de Orca (`orca orchestration send` / `check`); el coordinador
# arranca al siguiente en cuanto llega ese aviso. El Redactor pide aprobación antes de escribir los
# avisos y esa pregunta se contesta aquí, en esta terminal.
# Con RESPUESTA_AUTO="aprobar" se contesta sola (útil para probar sin nadie delante).
set -euo pipefail

ORCA=${ORCA:-orca}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRABAJO="${TMPDIR:-/tmp}/orca-facturacion"
cd "$ROOT"
mkdir -p "$TRABAJO" orca-facturacion/salida/3-avisos

# Orca mezcla líneas de log de Electron con el JSON: nos quedamos desde la primera llave.
json() { python3 -c "
import sys, json
t = sys.stdin.read(); i = t.find('{')
d = json.loads(t[i:]) if i >= 0 else {}
print(eval(sys.argv[1]))" "$1"; }

echo "· Comprobando Orca…"
"$ORCA" status --json >/dev/null

COORD=$("$ORCA" terminal create --worktree current --title "Coordinador" --json | json "d['result']['terminal']['handle']")
RUN=$("$ORCA" orchestration run-create \
  --objective "Revisión de las facturas de septiembre de 2026" \
  --from "$COORD" --json | json "d['result']['run']['id']")
echo "· Ejecución $RUN · coordinador $COORD"

H1=$("$ORCA" terminal create --worktree current --title "1 · Detector" --json | json "d['result']['terminal']['handle']")
H2=$("$ORCA" terminal create --worktree current --title "2 · Analista" --json | json "d['result']['terminal']['handle']")
H3=$("$ORCA" terminal create --worktree current --title "3 · Redactor" --json | json "d['result']['terminal']['handle']")
echo "· Agentes: detector $H1 · analista $H2 · redactor $H3"

# Cada agente recibe su prompt con los identificadores ya sustituidos.
preparar() { # <fichero> <yo> <siguiente> <destino>
  sed -e "s|{{RUN}}|$RUN|g" -e "s|{{YO}}|$2|g" -e "s|{{SIGUIENTE}}|$3|g" -e "s|{{COORD}}|$COORD|g" "$1" > "$4"
}
preparar orca-facturacion/agentes/01-detector.md "$H1" "$H2" "$TRABAJO/1.txt"
preparar orca-facturacion/agentes/02-analista.md "$H2" "$H3" "$TRABAJO/2.txt"
preparar orca-facturacion/agentes/03-redactor.md "$H3" "$COORD" "$TRABAJO/3.txt"

arrancar() { # <handle> <fichero de prompt>
  "$ORCA" terminal send --terminal "$1" --text "claude -p \"\$(cat $2)\" --output-format text" --enter >/dev/null
}

echo "· Arranca el Detector. Míralo en Orca."
arrancar "$H1" "$TRABAJO/1.txt"
echo

# Coordinador: por cada aviso que llega, arranca al siguiente agente y contesta las preguntas.
while true; do
  LOTE=$("$ORCA" orchestration check --terminal "$COORD" --run "$RUN" --wait --timeout-ms 900000 --json 2>/dev/null || true)
  if [ -z "$LOTE" ] || ! echo "$LOTE" | grep -q '{'; then echo "· Sin mensajes. Fin."; break; fi

  echo "$LOTE" | python3 - <<'PY'
import json, sys
t = sys.stdin.read(); i = t.find('{')
d = json.loads(t[i:]) if i >= 0 else {}
for m in (d.get('result') or {}).get('messages', []):
    print(f"\n  [{(m.get('from_handle') or '')[:12]}… {m.get('type','mensaje')}] {m.get('subject','')}")
    if m.get('body'):
        print("  " + m['body'].replace("\n", "\n  "))
PY

  ASUNTOS=$(echo "$LOTE" | json "' | '.join((m.get('subject') or '') for m in (d.get('result') or {}).get('messages', []))")
  case "$ASUNTOS" in
    *Detector*)
      echo; echo "· Arranca el Analista."
      arrancar "$H2" "$TRABAJO/2.txt"
      ;;
    *Analista*)
      # Aquí decide una persona: sin su visto bueno no se redacta ningún aviso.
      echo
      python3 - <<'PY'
import json
d = json.load(open('orca-facturacion/salida/2-dictamen.json'))
filas = [x for x in d.get('dictamen', []) if x.get('veredicto') == 'confirmado']
print(f"  Dictamen: {len(filas)} hallazgos confirmados, {d.get('totalEur')} € en juego")
for x in filas:
    print(f"    · {x.get('cliente')} · {x.get('factura')} · {x.get('accion')} · {x.get('impactoEur')} €")
PY
      echo
      if [ -n "${RESPUESTA_AUTO:-}" ]; then
        DECISION="$RESPUESTA_AUTO"
        echo "  Decisión automática: $DECISION"
      else
        read -r -p "  ¿Redactamos los avisos? (aprobar / solo borradores / cancelar): " DECISION
      fi
      mkdir -p orca-facturacion/salida/buzon
      printf '%s\n' "${DECISION:-aprobar}" > orca-facturacion/salida/buzon/aprobacion.txt
      echo "· Decisión registrada: ${DECISION:-aprobar}. Arranca el Redactor."
      arrancar "$H3" "$TRABAJO/3.txt"
      ;;
  esac

  DELIVERY=$(echo "$LOTE" | json "(d.get('result') or {}).get('deliveryId','')")
  [ -n "${DELIVERY:-}" ] && "$ORCA" orchestration check --terminal "$COORD" --run "$RUN" --ack "$DELIVERY" --json >/dev/null 2>&1 || true

  case "$ASUNTOS" in
    *Redactor*) echo; echo "· Listo. Resultados en orca-facturacion/salida/"; break ;;
  esac
done
