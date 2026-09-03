# Deploy

> Como o sistema está em produção hoje, e como reproduzir.
> Sistema no ar: **[fortcrm.fattech.com.br](https://fortcrm.fattech.com.br)**

O IP do servidor e o id do túnel aparecem como `<IP-DO-SERVIDOR>` e
`<TUNNEL-ID>` neste repositório público — aquela máquina hospeda dezenas de
stacks de outros clientes, e publicar a arquitetura dela não serve a ninguém que
leia este projeto.

---

## Por que contêiner, e não systemd

O runbook original instalava um serviço systemd e atualizava o Node do host. **É
o que não se faz** num servidor compartilhado.

O host roda **Node v22.22.2**, e `node:sqlite` só existe sem flag a partir do
**23.4** — a aplicação sobe e morre no primeiro `import`. A saída óbvia seria
atualizar o Node do sistema. Com dezenas de contêineres de clientes rodando ali,
qualquer coisa que dependa daquele runtime quebraria junto, **e o sintoma
apareceria noutro serviço**, não no CRM.

No contêiner, o runtime pertence à aplicação. O host não muda.

O `deploy/instalar.sh` (systemd) continua no repositório porque serve para uma
instância dedicada, onde atualizar o Node é aceitável. Ele exige major ≥ 23 e
**prova** com `node -e 'require("node:sqlite")'` antes de seguir.

---

## O que sobe

```
/opt/fortcrm                    código
/etc/fortcrm.env                segredos, 0600, dono root
/etc/cloudflared-fortcrm/       credencial e config do túnel dedicado
volume  fortcrm-dados           bases SQLite + backups
rede    fortcrm-rede            própria, isolada
```

| Serviço | O que é |
|---|---|
| `fortcrm-app` | contêiner `node:24-alpine`, porta **127.0.0.1:4310** |
| `fortcrm-tunnel.service` | Cloudflare Tunnel **dedicado** |
| `fortcrm-manutencao.timer` | backup e reancoragem, 04:10 diário |

### Instalar

```bash
# do seu computador, com a pasta do projeto
tar --exclude=./data --exclude=./export -czf /tmp/src.tar.gz server.mjs src web deploy
scp /tmp/src.tar.gz SERVIDOR:/tmp/

# no servidor
sudo mkdir -p /opt/fortcrm && sudo chown $USER /opt/fortcrm
cd /opt/fortcrm && tar xzf /tmp/src.tar.gz
```

Os segredos são gerados **no servidor** — nunca passam pelo seu disco nem por um
log:

```bash
SEGREDO=$(openssl rand -base64 32)
SENHA=$(openssl rand -base64 12 | tr -dc "A-Za-z0-9" | cut -c1-14)Aa1
sudo tee /etc/fortcrm.env >/dev/null <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=4310
DEMO_MODE=true
FORTCRM_DIR=/dados/instancias
FORTCRM_SECRET=${SEGREDO}
FORTCRM_SENHA_INICIAL=${SENHA}
EOF
sudo chmod 600 /etc/fortcrm.env && sudo chown root:root /etc/fortcrm.env
echo "Anote a senha inicial: ${SENHA}"
```

```bash
cd /opt/fortcrm/deploy && sudo docker compose up -d --build
```

**Redeploy** é o mesmo comando. O volume de dados não é tocado.

---

## Contenção

O `compose.yml` não é genérico — cada linha existe por causa do host
compartilhado:

- **rede própria**, sem `network_mode: host`. O CRM não enxerga o Postgres nem o
  Redis dos vizinhos, e nenhum deles o enxerga;
- **porta só em `127.0.0.1`**. A superfície externa do servidor continua sendo
  apenas 22, 80 e 443 — o ingresso é o túnel;
- **`read_only: true`**, `cap_drop: ALL`, `no-new-privileges`, `/tmp` em tmpfs;
- **teto de 512 MB e 1 cpu**. Num host com 22 GB e 12 já em uso, um processo sem
  limite que vaze memória derruba o vizinho, não a si mesmo;
- **log rotacionado** em 3 × 10 MB — disco compartilhado não comporta log
  infinito.

Consumo real medido: **~25 MB, 0,01 % de CPU**.

---

## O túnel

Um túnel **dedicado**, com credencial, configuração e unidade systemd próprias.

Deliberadamente **não** é uma regra a mais no túnel de produção que já existia
naquele host: ele serve outros hostnames com conexões ativas, e mexer no ingress
dele para acrescentar um serviço é arriscar todos os demais.

```yaml
# /etc/cloudflared-fortcrm/config.yml
tunnel: <TUNNEL-ID>
credentials-file: /etc/cloudflared-fortcrm/cred.json
ingress:
  - hostname: fortcrm.fattech.com.br
    service: http://127.0.0.1:4310
  - service: http_status:404   # exigido: toda config termina em catch-all
```

O DNS é um `CNAME` para `<TUNNEL-ID>.cfargotunnel.com`, com proxy ligado.

> **Armadilha:** `cloudflared tunnel route dns <tunel> <host>` **não falha** se o
> hostname for de outra zona — ele concatena e cria
> `host.outra-zona.com.zona-do-cert.com`. Confira a zona do `cert.pem` antes.

---

## Manutenção automática

`fortcrm-manutencao.timer`, 04:10 diário, `Persistent=true` — se a máquina passou
o horário desligada, roda ao voltar.

### Backup

`VACUUM INTO`, **nunca** cópia de arquivo. Ver
[Decisões](DECISOES.md#backup-com-cp-produz-um-banco-íntegro-e-vazio) — em
resumo: os `.db` têm 4 KB e os `-wal` têm 832 KB, e copiar o `.db` gera um
arquivo íntegro e vazio.

O script **aborta se o backup sair com menos de 8 KB**. Guarda 14 dias em
`/dados/backups`.

### Reancoragem

A carga gera datas relativas ao instante em que roda, e o compliance —
funcionando corretamente — vai fechando a janela de 24 h. Nove horas depois da
carga, a fila da oficina já havia encolhido de 16 liberados para 9.

Num link permanente que alguém abre quando quiser, isso significa **abrir numa
tela vazia**. A reancoragem desliza a história para frente quando a âncora passa
de 10 h, sem apagar nada — preserva auditoria, disparos e conversões.

### Rodar à mão

```bash
sudo docker exec fortcrm-app node deploy/manutencao.mjs backup
sudo docker exec fortcrm-app node deploy/manutencao.mjs reancorar
```

---

## Variáveis

| Variável | Em produção | Por quê |
|---|---|---|
| `HOST` | `0.0.0.0` **dentro** do contêiner | Quem restringe é a publicação da porta, amarrada em `127.0.0.1` do host. Sem isso o Docker não encaminha nada |
| `PORT` | `4310` | |
| `DEMO_MODE` | `true` | Só vira `false` com adaptador de canal existindo — hoje desligar não liga o envio, trava a fila em `claimed` |
| `FORTCRM_DIR` | `/dados/instancias` | Volume, separado do código |
| `FORTCRM_SECRET` | gerado | Sem fixar, reiniciar derruba toda sessão aberta |
| `FORTCRM_SENHA_INICIAL` | gerado | Vale só para a primeira carga |
| `FORTCRM_META_APP_SECRET` | — | Sem ela o webhook do WhatsApp fica **fechado** |
| `FORTCRM_WHATSAPP_VERIFY_TOKEN` | — | Verificação inicial do endpoint |

---

## Verificação depois de subir

```bash
sudo docker ps --filter name=fortcrm-app
sudo systemctl is-active fortcrm-tunnel fortcrm-manutencao.timer
```

E de **fora** do servidor, o que realmente importa:

```bash
nmap -Pn -p- SERVIDOR | grep -v closed
```

Esperado: **nenhuma porta nova**. Num host com clientes, uma porta a mais é
problema de todo mundo.

---

## O que ainda falta

**Não há MFA, bloqueio por tentativas nem revogação de sessão.** Enquanto não
houver, **Cloudflare Access na frente do hostname é obrigatório**, não opcional.

Zero Trust → Access → Applications → Add, com política de e-mails permitidos.

---

## Rollback

```bash
sudo docker compose -f /opt/fortcrm/deploy/compose.yml down
sudo systemctl stop fortcrm-tunnel
```

Os dados ficam no volume e não são tocados. Para remover de vez:

```bash
sudo systemctl disable --now fortcrm-tunnel fortcrm-manutencao.timer
sudo rm -rf /opt/fortcrm /etc/cloudflared-fortcrm /etc/fortcrm.env
sudo rm /etc/systemd/system/fortcrm-*.{service,timer}
```

O volume `fortcrm-dados` fica de propósito — apagar dado é decisão separada de
desinstalar serviço.
