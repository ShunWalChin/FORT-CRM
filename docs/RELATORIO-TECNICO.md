# FORT-CRM — Relatório Técnico

**04 de setembro de 2026**

CRM multiempresas com compliance de mensageria e conversão offline para Google
Ads e Meta.

- **Em produção:** <https://fortcrm.fattech.com.br>
- **Código:** <https://github.com/ShunWalChin/FORT-CRM>

| | |
|---|---|
| Linhas de código | **14.490** |
| Dependências | **0** |
| Testes | **135** (45 unidade + 90 federação) |
| Módulos | **24** |
| Tabelas | **26** |
| Rotas | **46** |
| Telas | **23** |
| Documentos | **11** |

---

## O problema

O problema mais caro de um negócio de recorrência não é guardar cadastro —
planilha faz isso. É **o cliente que precisava voltar, ninguém lembrou de
chamar, e ele foi no concorrente**.

O FORT-CRM monta sozinho a fila de quem falar hoje, com a mensagem escrita e o
motivo à vista — e **recusa o envio quando não pode enviar**. É essa recusa que
protege o número de WhatsApp da empresa.

E fecha o outro lado: devolve ao Google e à Meta o que aconteceu depois do
clique, para que a campanha que traz gente deixe de parecer que não traz.

| Empresa | Segmento | O que tem de próprio |
|---|---|---|
| **Minas Peças** | Injeção diesel — Bosch Car Service | frota, ordens de serviço, laudo de bancada |
| **Fazenda Agrofort** | Queijo artesanal | pedidos, recompra, clube de assinatura |
| **Fort Tintas** | Tintas e vernizes | pedidos, pintor parceiro, obra |

---

## Arquitetura — isolamento físico, não lógico

Cada empresa é um **arquivo SQLite separado**. Quem atende o balcão da oficina
não enxerga um pedido de queijo porque aquele dado não está no sistema que ele
abriu — não porque uma cláusula `where` o escondeu. O escopo por `empresa_id`
continua como segunda barreira.

A consulta federada **não usa `ATTACH DATABASE`**: ela consulta cada instância e
junta em memória. É mais trabalho, e é deliberado — o desenho previsto é cada
empresa poder virar outra máquina, e `ATTACH` só funciona no mesmo sistema de
arquivos. Instância fora do ar some da lista e as outras seguem; numa federação,
indisponibilidade de uma é evento normal, não erro.

> ### ⚠ A central é projeção, e projeção que só acrescenta é acumulador
>
> A sincronização fazia *insert-or-update* e nunca removia. Recarregar a
> demonstração gera IDs novos, e as projeções antigas ficavam para trás.
>
> A remoção usa carimbo de execução, não `not in (lista)` — a lista cresce com a
> base e estoura o limite de parâmetros. Duas proteções: o lead em triagem
> sobrevive, e a remoção só roda após a leitura dar certo, para que instância
> fora do ar não vire perda de dado.
>
> **Medido em produção:** 76 linhas para 38 clientes reais — a tela do grupo
> mostrava o dobro do faturamento.

### Os módulos

| Módulo | Responsabilidade |
|---|---|
| `federacao.mjs` | catálogo de instâncias, consulta federada |
| `db.mjs` | SQLite, escopo por empresa, cadeia de auditoria |
| `schema.mjs` · `schema-extra.mjs` | 26 tabelas |
| `migracoes.mjs` | colunas novas em base existente |
| `compliance.mjs` | as 9 checagens — puro, sem I/O |
| `regua.mjs` | 17 gatilhos, mensagem e diagnóstico da fila |
| `atribuicao.mjs` | parâmetros de clique, normalização, SHA-256 |
| `conversoes.mjs` | payloads do Google Ads e da Meta CAPI |
| `conversoes-servico.mjs` | fila, avaliação e despacho |
| `ctwa.mjs` | Click-to-WhatsApp, HMAC, Business Messaging |
| `canais.mjs` | catálogo de canais de entrada por empresa |
| `propriedades.mjs` | campos do sistema e da empresa |
| `central.mjs` | consolidação e chaves de captação |
| `senha.mjs` | scrypt, migração automática |
| `limite.mjs` | teto de requisições por origem |
| `reancorar.mjs` | desliza a demonstração no tempo |

---

## O motor — régua de contato e compliance

**17 gatilhos** — 7 na oficina, 5 na fazenda, 5 na loja. Cada um é uma pergunta
que o dono faria se tivesse tempo de olhar cliente por cliente. O mais
específico é *obra parada no meio*: comprou massa e selador e não voltou para a
tinta.

**Nove checagens ordenadas** — canal conectado, consentimento LGPD, descadastro,
janela de 24 h, template aprovado, cooldown do gatilho, blocklist, teto de
caracteres, idempotência. A primeira que falha bloqueia e diz o motivo na tela.

| Canal | Escapa da janela de 24 h? |
|---|---|
| WhatsApp Cloud API | **sim**, com template aprovado |
| Evolution API (não-oficial) | **não** |

Tratar os dois igual é o erro que queima número.

> ### ⚠ Ambiguidade nunca se repete sozinha
>
> Cinco estados de envio: `claimed`, `sent`, `blocked`, `unknown`, `failed`. Um
> `timeout` não diz se a mensagem saiu, e repetir arrisca mandar duas vezes para
> o mesmo cliente.
>
> **Uma mensagem atrasada custa um dia. Uma duplicada custa a confiança do
> cliente.**

### O texto é rascunho, não palavra final

A mensagem é editável na linha, com *Copiar* e *Abrir no WhatsApp* com o texto
já dentro. E o texto editado **volta a passar pelo compliance no servidor** —
aceitar o que o navegador mandou daria ao operador um caminho para furar a
própria regra da empresa sem perceber.

---

## Aquisição — do clique no anúncio à conversão devolvida

O parâmetro de clique existe na primeira página aberta, ou na primeira mensagem
enviada, e some na navegação seguinte. Ou é capturado na chegada, ou aquele
cliente é para sempre anônimo para o anúncio que o trouxe.

| Identificador | Origem | Chega por | Observação |
|---|---|---|---|
| `gclid` | Google Ads | URL | o padrão da busca |
| `gbraid` / `wbraid` | Google Ads | URL | travessia app↔web no iOS; nunca junto com `gclid` |
| `fbclid` | Meta | URL | anúncio que abre *página* |
| `ctwa_clid` | Meta | Webhook | anúncio que abre *conversa* — não passa por navegador |
| `utm_*` | quem montou o link | URL | declaração, não prova |

> ### ⚠ A falha mais silenciosa de todo o sistema
>
> Google e Meta pedem o **mesmo telefone em formatos diferentes**: o Google quer
> E.164 com o sinal, a Meta quer só dígitos. Hash do formato errado não casa com
> nada — **e não dá erro**. A campanha simplesmente "não converte".
>
> O CRM guarda as duas formas, em colunas separadas.

**Origem não é local de conversão.** O cliente chega pelo WhatsApp e fecha na
loja. `action_source` descreve onde a conversão aconteceu, não de onde o lead
veio — e a decisão é gravada em coluna própria, porque a pergunta de auditoria é
"vocês disseram à Meta que esta venda foi no chat?".

### A cadeia

Mudança de etapa → `event_log` → worker enfileira uma conversão por destino →
cinco checagens → payload real.

Um gatilho de banco nunca faz chamada de rede: decidir consentimento e destino
dentro da transação que grava a oportunidade deixaria a venda refém de uma regra
de marketing.

| Resposta | Estado | Repete sozinho? | Por quê |
|---|---|---|---|
| `429` | limitado | **sim** | o evento está certo; foi só rápido demais |
| `400` | falhou | **não** | repetir produz o mesmo 400 para sempre |
| `401` / `403` | sem permissão | **não** | token não se conserta sozinho |
| `5xx` · `timeout` | desconhecido | **não** | a conversão *pode* ter sido registrada do outro lado |

---

## Canais — por onde o cliente chega, e o teto do que dá para medir

Catálogo **por empresa** — 11 na oficina, 10 na fazenda, 10 na loja. Cada canal
declara se carrega parâmetro de clique, e esse campo é o divisor de águas: o que
não é atribuível nunca vai render conversão importada.

> ### ⚠ As três empresas compartilhavam a mesma lista de origens
>
> `guincho_24h` e `site_diagnostico` — canais de oficina de injeção diesel —
> apareciam na fazenda de queijo e na loja de tintas. Pior: origem e atribuição
> eram sorteadas de forma independente, o que produzia cliente com
> `origem: 'balcao'` carregando `gclid`.
>
> **Quem entra pela porta não clicou em anúncio.**

A cobertura atribuível fica em torno de **50%**, e isso não é defeito. Balcão,
telefone, guincho e pintor parceiro não carregam parâmetro de clique e nunca vão
carregar. Na Minas Peças, o guincho que traz o veículo de madrugada é o maior
ticket e a pior rastreabilidade. Nesses canais a única atribuição possível é
**perguntar** — e a pergunta está na tela.

### A porta de entrada não existia

`POST /api/central/entrada` estava documentada como entrada externa e exigia
sessão. Um formulário de site não faz login.

Hoje `POST /api/entrada/:chave` é pública de verdade: a chave só roteia, 20
req/min por origem, corpo em 1 MB, e a resposta é **idêntica** para chave
válida, inválida, desativada e tentativa de travessia — variar transformaria a
porta num oráculo de enumeração.

---

## Interface — medida, não estimada

Cinco temas, cada um por um contexto de uso real — balcão sob luz fluorescente,
varanda ao sol, plantão de madrugada. **Contraste medido pintando num canvas e
lendo o pixel**, porque `getComputedStyle` devolve `oklab()` para valores de
`color-mix`. Pior caso: 4,9:1.

| Tela | Antes | Depois |
|---|---|---|
| Clientes, no celular | tabela de 936 px numa caixa de 343 — **593 px escondidos** | cartão de 214 px, sem rolagem lateral |
| Régua de contato | 12.136 px | **8.182 px** |
| Cabeçalho fixo da fila | 176 px | **116 px** |
| Início, no celular | ação principal a 332 px do topo | **255 px** |

> ### ⚠ Um ponto de corte era o erro
>
> **820 px** é sobre o formato da janela — a lateral não cabe ao lado do
> conteúdo. **640 px** é sobre a largura do conteúdo — abaixo disso a tabela
> vira cartão.
>
> A 812 px um tablet deitado recebia layout de telefone sem precisar.

### A tela de Início

O painel responde "como estamos" — a segunda pergunta. A primeira é "o que eu
faço aqui", e um menu de dezessete itens lista sem priorizar.

Cada cartão é nomeado pelo que a pessoa quer fazer e carrega estado vivo: *7
pessoas esperando*, *R$ 14.300 em negociação*. O número ensina o que a tela é sem
uma linha de explicação.

### Estado vazio com saída

A régua vazia dizia "já cobriu todo mundo, volte amanhã" — afirmando uma causa
que ninguém verificou. O servidor agora diagnostica cinco causas na ordem em que
se resolvem, e cada uma leva onde se resolve. Base vazia vem antes de
consentimento; consentimento antes de "todos bloqueados".

---

## Produção — contêiner isolado num host com 75 vizinhos

O host roda **Node v22.22.2**, e `node:sqlite` só existe sem flag a partir do
23.4. O instalador systemd teria atualizado o Node do sistema — com 75
contêineres de clientes ali, qualquer coisa que dependa daquele runtime
quebraria junto, e **o sintoma apareceria noutro serviço**. No contêiner, o
runtime pertence à aplicação.

| Recurso | Estado |
|---|---|
| `fortcrm-app` | `node:24-alpine`, `read_only`, `cap_drop: ALL`, 512 MB / 1 cpu — usa **31 MB** |
| Porta | `127.0.0.1:4310` — não existe para a internet |
| Rede | própria; não enxerga o Postgres nem o Redis dos vizinhos |
| Túnel | dedicado, com credencial e unidade próprias |
| Manutenção | 04:10 diário, `Persistent=true` — backup e reancoragem |
| Superfície externa | 22, 80, 111, 443 — **nenhuma porta nova** |

> ### ⚠ Backup com `cp` produz um banco íntegro e vazio
>
> O SQLite em modo WAL mantém as escritas recentes no arquivo lateral. Copiar o
> `.db` gera um arquivo que abre normalmente e não tem nada dentro — **e o erro
> só aparece na restauração**. A rotina usa `VACUUM INTO` e aborta se o backup
> sair com menos de 8 KB.
>
> **Medido no servidor:** `.db` com 4 KB, `-wal` com 832 KB.

---

## Limites — o que o sistema ainda não é

Escrito para que ninguém prometa ao cliente o que ele não entrega.

- **Nada sai para fora.** `DEMO_MODE` ligado: mensagem não chega a número real,
  conversão não chega ao Google nem à Meta. O payload é montado e gravado — é
  ele que mostra numa reunião exatamente o que iria.
- **Não há MFA, bloqueio por tentativas nem revogação de sessão.** Num endereço
  público permanente, Cloudflare Access na frente do hostname é obrigatório — e
  ainda não está posto.
- WhatsApp orgânico, Instagram e Mercado Livre dependem de conector que não
  existe.
- Não dá para adiar um item da régua, nem cadastrar veículo ou ordem de serviço
  pela interface.
- A base é fictícia. Nenhum dado real de cliente está no sistema.

---

*135 testes · zero dependências de terceiros · Januária/MG*
