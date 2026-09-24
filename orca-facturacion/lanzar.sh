#!/usr/bin/env bash
#
# Los tres agentes de facturación con la orquestación de Orca (Codex).
#
#   ./lanzar.sh
#
# Crea una ejecución, tres tareas encadenadas por dependencias y una puerta de decisión que bloquea
# la última: sin el visto bueno de una persona no se redacta ningún aviso. Cada agente arranca como
# trabajador supervisado de Orca, recibe su tarea y avisa al terminar (`worker_done`).
#
# Requisitos: Codex instalado y con sesión iniciada (`codex login`), y en Orca, Ajustes → Agentes,
# el argumento de Codex «--dangerously-bypass-approvals-and-sandbox». Sin eso el agente no puede
# contestar a Orca desde dentro de su cajón de arena.
#
# Con RESPUESTA_AUTO="aprobar" la decisión se toma sola (útil para probar sin nadie delante).
set -euo pipefail

ORCA=${ORCA:-orca}
AGENTE=${AGENTE:-codex}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
mkdir -p salida/3-avisos salida/buzon

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
echo "· Ejecución $RUN"

# Las pestañas de Orca abren en la raíz del repositorio, así que cada agente recibe su carpeta.
spec() { printf 'Tu carpeta de trabajo es %s: muévete a ella antes de nada.\n\n%s' "$ROOT" "$(cat "$1")"; }

tarea() { # <fichero de instrucciones> <título> [deps json]
  if [ -n "${3:-}" ]; then
    "$ORCA" orchestration task-create --spec "$(spec "$1")" --task-title "$2" --display-name "$2" \
      --deps "$3" --from "$COORD" --run "$RUN" --json | json "d['result']['task']['id']"
  else
    "$ORCA" orchestration task-create --spec "$(spec "$1")" --task-title "$2" --display-name "$2" \
      --from "$COORD" --run "$RUN" --json | json "d['result']['task']['id']"
  fi
}
T1=$(tarea agentes/01-detector.md "1 · Detector")
T2=$(tarea agentes/02-analista.md "2 · Analista" "[\"$T1\"]")
T3=$(tarea agentes/03-redactor.md "3 · Redactor" "[\"$T2\"]")
echo "· Tareas: $T1 → $T2 → $T3"

# La puerta de decisión bloquea al Redactor hasta que una persona resuelve.
PUERTA=$("$ORCA" orchestration gate-create --task "$T3" \
  --question "¿Se redactan los avisos a los clientes?" \
  --options '["aprobar","solo borradores","cancelar"]' \
  --from "$COORD" --json | json "d['result']['gate']['id']")
echo "· Puerta de decisión $PUERTA sobre la tarea del Redactor"

arrancar() { # <task_id>
  "$ORCA" orchestration worker-start --task "$1" --worktree current --agent "$AGENTE" \
    --timeout-ms 180000 --from "$COORD" --run "$RUN" --json | json "d['result']['state']"
}
echo "· Arranca el Detector ($(arrancar "$T1")). Míralo en Orca."
echo

while true; do
  LOTE=$("$ORCA" orchestration check --terminal "$COORD" --run "$RUN" --wait \
    --types "worker_done,escalation,question" --timeout-ms 900000 --json 2>/dev/null || true)
  if [ -z "$LOTE" ] || ! echo "$LOTE" | grep -q '{'; then echo "· Sin mensajes. Fin."; break; fi

  echo "$LOTE" | python3 - <<'PY'
import json, sys
t = sys.stdin.read(); i = t.find('{')
d = json.loads(t[i:]) if i >= 0 else {}
for m in (d.get('result') or {}).get('messages', []):
    p = m.get('payload')
    p = json.loads(p) if isinstance(p, str) else (p or {})
    print(f"\n  [{m.get('type')} · {p.get('outcome', '')}] {m.get('subject', '')}")
    if m.get('body'):
        print("  " + m['body'].replace("\n", "\n  "))
PY

  TAREAS=$(echo "$LOTE" | json "' '.join((json.loads(m['payload']) if isinstance(m.get('payload'), str) else (m.get('payload') or {})).get('taskId','') for m in (d.get('result') or {}).get('messages', []))")

  case "$TAREAS" in
    *"$T1"*)
      echo; echo "· Arranca el Analista ($(arrancar "$T2"))."
      ;;
    *"$T2"*)
      echo
      python3 - <<'PY'
import json
d = json.load(open('salida/2-dictamen.json'))
filas = [x for x in d.get('dictamen', []) if x.get('veredicto') == 'confirmado']
print(f"  Dictamen: {len(filas)} hallazgos confirmados, {d.get('totalEur')} € en juego")
for x in filas:
    print(f"    · {x.get('cliente')} · {x.get('factura')} · {x.get('accion')} · {x.get('impactoEur')} €")
PY
      echo
      if [ -n "${RESPUESTA_AUTO:-}" ]; then
        DECISION="$RESPUESTA_AUTO"; echo "  Decisión automática: $DECISION"
      else
        read -r -p "  ¿Redactamos los avisos? (aprobar / solo borradores / cancelar): " DECISION
      fi
      DECISION="${DECISION:-aprobar}"
      "$ORCA" orchestration gate-resolve --id "$PUERTA" --resolution "$DECISION" --from "$COORD" --json >/dev/null
      printf '%s\n' "$DECISION" > salida/buzon/aprobacion.txt
      echo "· Puerta resuelta: $DECISION. Arranca el Redactor ($(arrancar "$T3"))."
      ;;
    *"$T3"*)
      echo; echo "· Listo. Resultados en salida/"
      break
      ;;
  esac

  DELIVERY=$(echo "$LOTE" | json "(d.get('result') or {}).get('deliveryId','')")
  [ -n "${DELIVERY:-}" ] && "$ORCA" orchestration check --terminal "$COORD" --run "$RUN" --ack "$DELIVERY" --json >/dev/null 2>&1 || true
done
