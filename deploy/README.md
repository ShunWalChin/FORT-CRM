# Hospedar o FORT-CRM no servidor Oracle ARM

Kit completo e testado até onde dá para testar sem o servidor. O que falta é
acesso, não código.

---

## O que trava hoje

| Bloqueio | Verificado em 03/09/2026 | Quem resolve |
|---|---|---|
| **Chave SSH** | `ssh root@<IP-DO-SERVIDOR>` → `Permission denied (publickey)`. Testado também com `opc`, `ubuntu` e `oracle`: todos recusam. Nenhuma chave minha está autorizada | Soberano |
| **Escolha do destino** | O `<IP-DO-SERVIDOR>` é Oracle Linux 9.7 aarch64, mas hospeda 13 stacks de clientes, nginx em 80/443 e um túnel Cloudflare ativo. Instância dedicada versus co-tenancy é gate G3 e continua sem registro | Soberano + FORJA |
| **Registro DNS** | Criar `crm.fattech.com.br` escreve no DNS do domínio de produção | Soberano |

O servidor **responde** — o SSH aceita conexão e recusa a autenticação. Não é
rede, é credencial.

### O que eu preciso, exatamente

Uma destas três, qualquer uma resolve:

1. **Instalar minha chave pública** no `authorized_keys` de um usuário com
   sudo, e me dizer o usuário e o IP.
2. **Rodar você mesmo** o instalador — são três comandos, estão abaixo.
3. **Uma instância dedicada nova** (a Opção A do runbook do Palantyr), com
   acesso — é a recomendação da doutrina, e evita o risco de co-tenancy.

---

## Instalação — três comandos

Do seu notebook, com a pasta do projeto:

```bash
rsync -a --exclude data --exclude export ./ USUARIO@SERVIDOR:/tmp/fort-crm/
```

No servidor:

```bash
cd /tmp/fort-crm && bash deploy/instalar.sh
```

E, para ficar público:

```bash
sudo cloudflared service install && cloudflared tunnel route dns crm-demo crm.fattech.com.br
```

O instalador é **idempotente**: rodar de novo atualiza em vez de duplicar, e
preserva os segredos já gerados.

---

## O que o instalador faz — e o que se recusa a fazer

**Faz:**

- confere a arquitetura e o Node, instalando o 24 se preciso;
- cria o usuário de serviço `fortcrm`, sem shell;
- separa código (`/opt/fort-crm`) de dados (`/var/lib/fort-crm`, modo 750) —
  para que um deploy nunca apague a base;
- gera `FORTCRM_SECRET` e uma **senha inicial forte**, em `/etc/fort-crm.env`
  com modo 0600 e dono root;
- instala e sobe o serviço systemd, com contenção (`ProtectSystem=strict`,
  `NoNewPrivileges`, `ReadWritePaths` só no diretório de dados, teto de memória);
- espera o serviço responder e falha ruidosamente se não responder;
- **confere que a porta não subiu em `0.0.0.0`** e aborta se subiu.

**Recusa-se a fazer**, porque o host é compartilhado com clientes:

- abrir qualquer porta;
- tocar em nginx, no firewall público ou em compose de cliente;
- instalar ou reconfigurar Docker.

Se algum desses limites precisar ser cruzado, é decisão do Soberano, não do
script.

---

## A armadilha do Node — corrigida

A versão anterior deste kit mandava `dnf install -y nodejs22`. **Isso quebra.**

`node:sqlite` entrou no Node 22.5 atrás de `--experimental-sqlite`, e só ficou
disponível sem a flag a partir do 23.4. O serviço roda `node server.mjs` sem
flag: com o Node 22, ele sobe e morre no primeiro `import`. O instalador agora
exige major ≥ 23, instala o 24 quando preciso, e ainda faz
`node -e 'require("node:sqlite")'` como prova antes de seguir.

---

## Segurança: o que mudou para poder hospedar

O laudo apontava como risco nº 1 "senha em texto claro com endereço público no
ar". Endereço permanente num servidor torna isso real, então foi resolvido
antes do deploy, não depois:

- **Senha em `scrypt`** (`node:crypto`, sem dependência nativa — o servidor é
  aarch64 e a máquina de quem desenvolve é x86; bcrypt compilado é exatamente o
  que funciona no notebook e falha no deploy). Custo medido: 28 ms.
- **Migração automática na subida**: qualquer senha ainda em texto claro vira
  hash quando o serviço inicia. Não no primeiro login — senão a senha de quem
  não entrasse ficaria em claro por tempo indefinido, e são justamente as contas
  esquecidas que ninguém audita.
- **Troca de senha federada**: muda em todas as instâncias onde o e-mail existe.
  Trocar só numa deixaria acesso parcial ao próprio grupo, sem aviso.
- **Senha inicial vem do ambiente.** Local, sem variável, nasce `demo` para a
  demonstração abrir sem atrito. Hospedado, o instalador gera uma forte e a
  imprime uma única vez.
- **Limite de requisição no login**: 12 por minuto por origem.

### O que ainda falta, e por isso o Access é obrigatório

Não há segundo fator, nem bloqueio por tentativas repetidas além do limite de
requisição, nem revogação de sessão. Enquanto isso não existir, **o Cloudflare
Access na frente do hostname não é opcional** — ele é o que garante que só quem
você convidar chega na tela de login.

Zero Trust → Access → Applications → Add · domínio `crm.fattech.com.br` ·
política de e-mails permitidos.

---

## Variáveis

| Variável | No servidor | Por quê |
|---|---|---|
| `HOST` | `127.0.0.1` | Superfície zero. Nunca `0.0.0.0` |
| `PORT` | `4501` | Só loopback; o túnel é o ingresso |
| `DEMO_MODE` | `true` | Só vira `false` com adaptador de canal existindo — hoje desligar não liga o envio, trava a fila em `claimed` |
| `FORTCRM_DIR` | `/var/lib/fort-crm/instancias` | Fora de `/opt`, para o deploy não apagar dados |
| `FORTCRM_SECRET` | gerado | Sem fixar, reiniciar derruba toda sessão aberta |
| `FORTCRM_SENHA_INICIAL` | gerado | Vale só para a primeira carga |

---

## Verificação depois de subir

```bash
sudo systemctl status fort-crm
curl -s localhost:4501/api/sessao -H 'content-type: application/json' -d '{}' | head -c 120
```

E de **fora** do servidor, o que realmente importa:

```bash
nmap -Pn -p- SERVIDOR | grep -v closed
```

Esperado: **apenas a 22**. Se aparecer outra porta, pare — superfície zero é
axioma, e num host com 13 clientes uma porta a mais é problema de todo mundo.

---

## Rollback

```bash
sudo systemctl stop fort-crm
sudo systemctl stop cloudflared
```

Os dados ficam em `/var/lib/fort-crm` e não são tocados. Para remover de vez:

```bash
sudo systemctl disable --now fort-crm
sudo rm /etc/systemd/system/fort-crm.service /etc/fort-crm.env
sudo rm -rf /opt/fort-crm
cloudflared tunnel delete crm-demo
```

`/var/lib/fort-crm` fica de propósito — apagar dado é decisão separada de
desinstalar serviço.
