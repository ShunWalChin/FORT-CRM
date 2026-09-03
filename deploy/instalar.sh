#!/usr/bin/env bash
# =============================================================================
# FORT-CRM — instalação em Oracle Linux 9 aarch64.
#
# Roda NO SERVIDOR, como um usuário com sudo. Idempotente: rodar de novo
# atualiza em vez de duplicar.
#
# O que este script deliberadamente NÃO faz, porque o host é compartilhado com
# 13 stacks de clientes:
#
#   - não abre porta nenhuma (o serviço escuta em 127.0.0.1; o único ingresso
#     é o Cloudflare Tunnel);
#   - não toca em nginx, firewalld público nem em compose de cliente;
#   - não instala Docker nem mexe em rede Docker existente.
#
# Se qualquer um desses limites precisar ser cruzado, é decisão do Soberano
# (G3), não deste script.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fort-crm}"
DATA_DIR="${DATA_DIR:-/var/lib/fort-crm}"
APP_USER="${APP_USER:-fortcrm}"
PORTA="${PORTA:-4501}"
NODE_MIN_MAJOR=23

vermelho() { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
verde()    { printf '\033[0;32m%s\033[0m\n' "$*"; }
passo()    { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

falhar() { vermelho "✖ $*"; exit 1; }

# ── 0. Pré-condições ─────────────────────────────────────────────────────────
passo "Conferindo o terreno"

[[ $EUID -ne 0 ]] || falhar "não rode como root direto — use um usuário com sudo"
command -v sudo >/dev/null || falhar "sudo não encontrado"

ARQ="$(uname -m)"
[[ "$ARQ" == "aarch64" ]] || vermelho "aviso: arquitetura $ARQ (esperado aarch64)"

# ── 1. Node ──────────────────────────────────────────────────────────────────
# ARMADILHA REAL: o kit anterior mandava `dnf install nodejs22`, e isso QUEBRA.
# `node:sqlite` entrou no Node 22.5 atrás de `--experimental-sqlite` e só ficou
# disponível sem a flag a partir do 23.4. Como o servidor roda `node server.mjs`
# sem flag, o Node 22 sobe e morre no primeiro `import`.
passo "Node ≥ ${NODE_MIN_MAJOR} (exigido pelo node:sqlite sem flag)"

instalar_node() {
  verde "  instalando Node 24 (NodeSource, aarch64)"
  curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
  sudo dnf install -y nodejs
}

if command -v node >/dev/null; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if (( MAJOR < NODE_MIN_MAJOR )); then
    vermelho "  Node $(node --version) é antigo demais — node:sqlite exigiria flag"
    instalar_node
  else
    verde "  Node $(node --version) serve"
  fi
else
  instalar_node
fi

node -e 'require("node:sqlite")' 2>/dev/null \
  || falhar "node:sqlite indisponível nesta build do Node — a aplicação não sobe"
verde "  node:sqlite disponível sem flag"

# ── 2. Usuário e diretórios ──────────────────────────────────────────────────
passo "Usuário de serviço e diretórios"

id -u "$APP_USER" >/dev/null 2>&1 || sudo useradd -r -m -s /sbin/nologin "$APP_USER"
sudo mkdir -p "$APP_DIR" "$DATA_DIR"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
sudo chmod 750 "$DATA_DIR"
verde "  $APP_DIR e $DATA_DIR prontos"

# ── 3. Aplicação ─────────────────────────────────────────────────────────────
passo "Copiando a aplicação"

ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sudo rsync -a --delete \
  --exclude data --exclude export --exclude node_modules --exclude '.git' \
  "$ORIGEM/" "$APP_DIR/"
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"
verde "  copiado de $ORIGEM"

# ── 4. Segredos ──────────────────────────────────────────────────────────────
# Gerados uma vez e preservados: regenerar o segredo de sessão a cada deploy
# derruba todo mundo que estava logado, e regenerar a senha inicial não teria
# efeito nenhum (a carga já rodou) mas confundiria quem lesse o arquivo.
passo "Segredos"

ENV_FILE="/etc/fort-crm.env"
if sudo test -f "$ENV_FILE"; then
  verde "  $ENV_FILE já existe — preservado"
else
  SEGREDO="$(openssl rand -base64 32)"
  SENHA_INICIAL="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)Aa1"
  sudo tee "$ENV_FILE" >/dev/null <<EOF
# Gerado por instalar.sh em $(date -Iseconds). Não versione este arquivo.
NODE_ENV=production
HOST=127.0.0.1
PORT=${PORTA}
DEMO_MODE=true
FORTCRM_DIR=${DATA_DIR}/instancias
FORTCRM_SECRET=${SEGREDO}
FORTCRM_SENHA_INICIAL=${SENHA_INICIAL}
EOF
  sudo chmod 600 "$ENV_FILE"
  sudo chown root:root "$ENV_FILE"
  verde "  $ENV_FILE criado (0600)"
  printf '\n\033[1;33m  SENHA INICIAL: %s\033[0m\n' "$SENHA_INICIAL"
  printf '  Anote agora. Ela só vale para a PRIMEIRA carga e não é mostrada de novo.\n'
fi

# ── 5. Serviço ───────────────────────────────────────────────────────────────
passo "Serviço systemd"

sudo cp "$APP_DIR/deploy/crm.service" /etc/systemd/system/fort-crm.service
sudo systemctl daemon-reload
sudo systemctl enable fort-crm >/dev/null
sudo systemctl restart fort-crm

for i in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORTA}/api/sessao" \
      -H 'content-type: application/json' -d '{}' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

sudo systemctl is-active --quiet fort-crm \
  || { sudo journalctl -u fort-crm -n 30 --no-pager; falhar "o serviço não subiu"; }
verde "  fort-crm ativo"

# ── 6. Verificação de superfície ─────────────────────────────────────────────
# Superfície zero é axioma. Se a aplicação apareceu em 0.0.0.0, algo está
# errado na configuração e é melhor descobrir agora que num scan de fora.
passo "Superfície"

if ss -tlnp 2>/dev/null | grep -q "0.0.0.0:${PORTA}"; then
  falhar "a porta ${PORTA} está escutando em 0.0.0.0 — deveria ser só 127.0.0.1"
fi
verde "  ${PORTA} apenas em loopback"

echo
verde "════════════════════════════════════════════════════"
verde " FORT-CRM instalado."
echo
echo "  Serviço    sudo systemctl status fort-crm"
echo "  Registro   sudo journalctl -u fort-crm -f"
echo "  Local      http://127.0.0.1:${PORTA}"
echo "  Dados      ${DATA_DIR}/instancias"
echo
echo "  FALTA PARA FICAR PÚBLICO:"
echo "   1. cloudflared: copie deploy/cloudflared-crm.yml e o credencial do túnel"
echo "   2. cloudflared tunnel route dns crm-demo crm.fattech.com.br"
echo "   3. Cloudflare Access na frente do hostname — obrigatório enquanto"
echo "      não houver segundo fator; a senha sozinha não basta num endereço"
echo "      permanente."
echo
echo "  Confira de FORA que nada novo abriu:"
echo "   nmap -Pn -p- <IP> | grep -v closed     # esperado: apenas 22"
verde "════════════════════════════════════════════════════"
