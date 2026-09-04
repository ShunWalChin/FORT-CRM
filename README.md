# FORT-CRM

**CRM multiempresas com compliance de mensageria e conversão offline para Google Ads e Meta.**

Três empresas do Fort Grupo, em Januária/MG, cada uma numa **instância com banco
de dados próprio** — não é separação por permissão, é arquivo diferente — com
consulta federada entre elas e uma central que consolida os leads de todas as
fontes.

🔗 **Sistema no ar: [fortcrm.fattech.com.br](https://fortcrm.fattech.com.br)**

```
Node ≥ 23.4 · zero dependências · 133 testes · nenhum passo de build
```

---

## O que ele resolve

O problema mais caro de qualquer negócio de recorrência não é guardar cadastro —
qualquer planilha faz isso. É **o cliente que precisava voltar, ninguém lembrou
de chamar, e ele foi no concorrente.**

O FORT-CRM monta sozinho a fila de quem falar hoje, com a mensagem já escrita e o
motivo à vista — e **recusa o envio quando não pode enviar**. É essa recusa que
protege o número de WhatsApp da empresa.

E fecha o outro lado do ciclo: devolve ao Google e à Meta o que aconteceu depois
do clique, para que a campanha que de fato traz gente deixe de parecer que não
traz.

| Empresa | Segmento | O que tem de próprio |
|---|---|---|
| **Minas Peças** | Injeção diesel — Bosch Car Service | frota, ordens de serviço, laudo de bancada |
| **Fazenda Agrofort** | Queijo artesanal | pedidos, recompra, clube de assinatura |
| **Fort Tintas** | Tintas e vernizes | pedidos, pintor parceiro, obra |

---

## Rodar

Não tem `npm install`. Não tem build. Não tem contêiner obrigatório.

```bash
node server.mjs
```

Abre em `http://127.0.0.1:4501`. A carga de demonstração roda sozinha na primeira
subida — três instâncias, ~38 clientes, histórico de doze meses.

**Node ≥ 23.4 é obrigatório.** O sistema usa `node:sqlite`, que só existe sem
flag a partir dessa versão. No Node 22 ele sobe e morre no primeiro `import`.

```bash
node src/selftest.mjs       # 45 testes — CRM de uma empresa
node src/selftest-fed.mjs   # 88 testes — federação, atribuição, conversão, CTWA
```

### Entrar

Senha `demo` no ambiente local. Em produção a senha inicial é gerada pelo
instalador e nunca é `demo`.

| E-mail | Papel | Enxerga |
|---|---|---|
| `diretoria@fortgrupo.com.br` | direção | as três empresas |
| `balcao@minaspecas.com.br` | operação | Minas Peças |
| `adenilde@agrofort.com.br` | operação | Agrofort |
| `loja@forttintas.com.br` | operação | Fort Tintas |

### A tela de Início

O sistema abre no **Início**, e não num painel de números. Cada botão é nomeado
pelo que a pessoa quer fazer — *"Falar com clientes hoje"*, não *"Régua de
contato"* — e carrega estado vivo: **7 pessoas esperando**, **R$ 14.300 em
negociação**. O número ensina o que a tela é sem uma linha de explicação.

Detalhe do balcão: o cartão de clientes tem busca embutida. Com o cliente na
frente, digite o nome e tecle Enter.

### O manual está dentro do sistema

Primeiro item do menu: **Manual do sistema**. 18 telas explicadas uma a uma, 23
verbetes de glossário, 12 receitas de "como faço para…" e uma lista honesta do
que o sistema ainda não faz. Cada seção tem um botão que abre a tela de verdade.

---

## Documentação

| Documento | O que cobre |
|---|---|
| [Arquitetura](docs/ARQUITETURA.md) | Federação, instâncias, central, escopo e auditoria |
| [Régua e compliance](docs/REGUA-E-COMPLIANCE.md) | Os 17 gatilhos, as 9 checagens, idempotência |
| [Atribuição e conversões](docs/ATRIBUICAO-E-CONVERSOES.md) | Do clique no anúncio à conversão devolvida |
| [Click-to-WhatsApp](docs/CTWA.md) | `ctwa_clid`, webhook assinado, Business Messaging |
| [Canais de entrada](docs/CANAIS.md) | Catálogo por empresa, porta pública, cobertura |
| [Campos personalizados](docs/CAMPOS-PERSONALIZADOS.md) | Registro de propriedades, JSON validado, por empresa |
| [Interface](docs/INTERFACE.md) | Cinco temas, versão mobile, decisões de usabilidade |
| [API](docs/API.md) | Referência das rotas |
| [Deploy](docs/DEPLOY.md) | Contêiner isolado, túnel, backup, manutenção |
| [Decisões e armadilhas](docs/DECISOES.md) | Os bugs encontrados e por que a solução é essa |
| [Roteiro de demonstração](docs/DEMONSTRACAO.md) | 12 minutos, passo a passo |
| [Relatório técnico](docs/RELATORIO-TECNICO.md) | Levantamento completo: números, arquitetura, funcionalidades e defeitos encontrados |
| [Roadmap](ROADMAP.md) | O que faz hoje e as 50 próximas implementações |

---

## Em uma página

### Isolamento físico, não lógico

Cada empresa é um arquivo SQLite separado. Quem atende o balcão da oficina não
enxerga um pedido de queijo porque **aquele dado não está no sistema que ele
abriu** — não porque uma cláusula `where` o escondeu.

O escopo por `empresa_id` continua existindo como segunda barreira, e permite que
uma instância hospede mais de uma empresa quando fizer sentido.

### Consulta federada sem `ATTACH DATABASE`

A central consulta cada instância e junta em memória. É mais trabalho do que
anexar bancos, e é deliberado: o desenho previsto é cada empresa poder virar
outra máquina. `ATTACH` só funciona no mesmo sistema de arquivos.

**Instância fora do ar não derruba a consulta** — ela some da lista e as outras
seguem. Numa federação, indisponibilidade de uma é evento normal, não erro.

### A central é projeção, nunca fonte de verdade

Ela consolida para leitura. Toda escrita acontece na instância da empresa.

### Compliance antes do envio

Nove checagens ordenadas — consentimento, descadastro, janela de 24 h, cooldown
do gatilho, blocklist, teto do canal, canal conectado. A primeira que falha
bloqueia e **diz o motivo na tela**.

O texto que o operador editar passa pela mesma checagem no servidor. Aceitar o
que o navegador mandou daria a ele um jeito de furar a própria regra da empresa
sem perceber.

### Ambiguidade nunca é repetida

Um `timeout` não diz se a mensagem saiu. O estado vira `desconhecido` e exige
olho humano. Uma mensagem atrasada custa um dia; uma duplicada custa a confiança
do cliente — e, na conversão, uma decisão de verba tomada em cima de número
inflado.

---

## Estrutura

```
server.mjs              HTTP, roteamento, arquivos estáticos
src/
  federacao.mjs         catálogo de instâncias, consulta federada
  db.mjs                SQLite, escopo por empresa, cadeia de auditoria
  schema.mjs            14 tabelas do CRM
  schema-extra.mjs      event_log, atribuições, conversões, webhooks, chaves
  migracoes.mjs         colunas novas em base existente
  compliance.mjs        as 9 checagens — puro, sem I/O
  regua.mjs             17 gatilhos e renderização de mensagem
  atribuicao.mjs        parâmetros de clique, normalização, hash SHA-256
  conversoes.mjs        payloads do Google Ads e da Meta CAPI
  conversoes-servico.mjs  fila, avaliação e despacho
  ctwa.mjs              Click-to-WhatsApp: webhook, HMAC, Business Messaging
  canais.mjs            catálogo de canais de entrada por empresa
  propriedades.mjs      registro de campos: sistema + personalizados
  central.mjs           consolidação e chaves de captação
  senha.mjs             scrypt, migração automática
  limite.mjs            teto de requisições por origem
  api.mjs               ~45 rotas
  seed.mjs              carga de demonstração
  selftest*.mjs         133 testes
web/
  app.js                SPA, sem framework
  ui.js                 ícones SVG e temas
  mobile.js             navegação de polegar, tabela→cartão
  styles.css            sistema visual
  temas.css             cinco temas
  mobile.css            dois pontos de corte: 820 e 640
  manual.js             o manual dentro do sistema
deploy/                 Dockerfile, compose, túnel, manutenção
docs/                   esta documentação
```

---

## O que este protótipo NÃO é

Escrito aqui para que ninguém prometa ao cliente o que ele ainda não entrega.

- **Nenhuma mensagem chega a número real.** `DEMO_MODE` está ligado; os disparos
  são registrados e auditados como simulação. Ligar o envio de verdade exige um
  adaptador de canal que ainda não existe.
- **Nenhuma conversão sai para o Google ou para a Meta.** O payload é montado,
  avaliado e gravado — é ele que mostra numa reunião exatamente o que iria, e é
  ele que denuncia um campo faltando antes de a conta estar ligada.
- **Não há MFA, bloqueio por tentativas nem revogação de sessão.** Num endereço
  público permanente, Cloudflare Access na frente do hostname é obrigatório.
- **A régua é calculada quando alguém abre a tela.** Em produção, roda de
  madrugada por timer.
- A base é fictícia. Nenhum dado real de cliente está aqui.

---

## Licença e contexto

Protótipo comercial do Fort Grupo, construído dentro da doutrina Palantyr.
Código sem dependências de terceiros — o que está aqui é auditável linha a linha.
