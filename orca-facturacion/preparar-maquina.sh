#!/usr/bin/env bash
#
# Prepara una máquina nueva para ejecutar estos agentes.
#
#   ./preparar-maquina.sh
#
# Instala lo que falte, registra esta carpeta en Orca y dice qué te queda por hacer a ti.
# No inicia sesión en tu cuenta ni cambia ajustes de seguridad: eso lo decides tú.
set -uo pipefail

CARPETA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PENDIENTE=()
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
falta() { printf '  \033[33m•\033[0m %s\n' "$1"; PENDIENTE+=("$1"); }
mal()   { printf '  \033[31m✗\033[0m %s\n' "$1"; PENDIENTE+=("$1"); }

echo "Preparando: $CARPETA"
echo

echo "1. Node 22 o superior"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'parseInt(process.versions.node)')" -ge 22 ]; then
  ok "node $(node --version)"
else
  if command -v brew >/dev/null 2>&1; then
    echo "   instalando…"; brew install node >/dev/null 2>&1 && ok "node $(node --version 2>/dev/null)" || mal "no se pudo instalar node; hazlo a mano"
  else
    mal "instala Node 22+ (o Homebrew) a mano"
  fi
fi

echo "2. Orca"
if command -v orca >/dev/null 2>&1; then
  ok "orca $(orca --version 2>/dev/null | head -1)"
else
  if command -v brew >/dev/null 2>&1; then
    echo "   instalando…"; brew install --cask stablyai/orca/orca >/dev/null 2>&1 && ok "Orca instalada" || mal "instala Orca a mano: brew install --cask stablyai/orca/orca"
  else
    mal "instala Homebrew y luego Orca"
  fi
fi

echo "3. Codex"
if command -v codex >/dev/null 2>&1; then
  ok "codex $(codex --version 2>/dev/null)"
else
  echo "   instalando…"; npm install -g @openai/codex >/dev/null 2>&1 && ok "codex $(codex --version 2>/dev/null)" || mal "instala Codex a mano: npm install -g @openai/codex"
fi

echo "4. Sesión de Codex"
if command -v codex >/dev/null 2>&1 && codex login status 2>&1 | grep -qi "logged in"; then
  ok "sesión iniciada"
else
  falta "inicia sesión tú: codex login"
fi

echo "5. Orca en marcha"
if command -v orca >/dev/null 2>&1; then
  orca status --json >/dev/null 2>&1 || orca open >/dev/null 2>&1
  for _ in $(seq 1 20); do orca status --json 2>/dev/null | grep -q '"state": "ready"' && break; sleep 2; done
  if orca status --json 2>/dev/null | grep -q '"state": "ready"'; then ok "Orca responde"; else falta "abre Orca y termina su pantalla de bienvenida"; fi
fi

echo "6. Esta carpeta registrada en Orca"
if command -v orca >/dev/null 2>&1 && orca status --json >/dev/null 2>&1; then
  # Solo si la carpeta no está ya dentro de un repositorio: Orca trabaja mejor con uno.
  git -C "$CARPETA" rev-parse --show-toplevel >/dev/null 2>&1 || git -C "$CARPETA" init -q 2>/dev/null
  if orca repo list 2>/dev/null | grep -qF "$CARPETA"; then
    ok "ya estaba registrada"
  else
    orca repo add --path "$CARPETA" --json >/dev/null 2>&1 && ok "registrada" || falta "regístrala: orca repo add --path \"$CARPETA\""
  fi
fi

echo "7. Argumento de Codex en Orca"
AJUSTES="$HOME/Library/Application Support/orca/profiles/local-default/orca-data.json"
if [ -f "$AJUSTES" ] && python3 -c "
import json,sys
a=json.load(open(sys.argv[1]))['settings']['agentDefaultArgs']
sys.exit(0 if 'bypass' in (a.get('codex') or '') else 1)" "$AJUSTES" 2>/dev/null; then
  ok "Codex arranca sin cajón de arena (puede hablar con Orca)"
else
  falta "en Orca, Ajustes → Agentes → Codex, pon: --dangerously-bypass-approvals-and-sandbox"
fi

echo "8. Base de datos de facturación"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^facturacion-demo$'; then
    ok "contenedor en marcha"
  else
    echo "   levantando…"
    (cd "$CARPETA/db" && docker compose up -d >/dev/null 2>&1) && ok "contenedor levantado (puerto 5434)" || falta "levántala: cd db && docker compose up -d"
  fi
else
  falta "arranca Docker y luego: cd db && docker compose up -d"
fi

echo "9. Conector de la base de datos para el agente"
CODEX_CFG="$HOME/.codex/config.toml"
if [ -f "$CODEX_CFG" ] && grep -q "mcp_servers.facturacion" "$CODEX_CFG"; then
  ok "conector registrado en Codex"
else
  falta "añade a ~/.codex/config.toml el bloque [mcp_servers.facturacion] que está en el README"
fi

echo
if [ ${#PENDIENTE[@]} -eq 0 ]; then
  echo "Todo listo. Abre una pestaña de agente en Orca y pégale el contenido de agentes/00-coordinador.md"
else
  echo "Te queda por hacer:"
  for p in "${PENDIENTE[@]}"; do echo "  - $p"; done
fi
