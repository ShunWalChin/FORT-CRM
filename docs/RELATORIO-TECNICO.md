# FORT-CRM — Relatório Técnico

**08 de setembro de 2026**

CRM multiempresas com compliance de mensageria, conversão offline para Google
Ads e Meta, e um módulo de oficina que prevê manutenção de frota.

- **Em produção:** <https://fortcrm.fattech.com.br>
- **Código:** <https://github.com/ShunWalChin/FORT-CRM>

| | |
|---|---|
| Linhas de código | **20.746** |
| Dependências | **0** |
| Testes | **188** (45 unidade + 143 federação) |
| Módulos | **28** |
| Tabelas | **34** (28 por instância + 6 na central) |
| Rotas | **67** |
| Telas | **22** |
| Documentos | **15** |

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
| **Minas Peças** | Injeção diesel | frota, ordens de serviço, laudo de bancada, **vida do veículo e vistoria de entrada** |
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

## Achar — uma busca, e não duas

Havia um campo que filtrava o **menu**. Quem digitava `antonio` lia *"Nada com
antonio"* e concluía, razoavelmente, que o sistema não tinha o Antônio.

`Ctrl+K` (ou `/`, ou a porta na lateral) acha **registro**: cliente, veículo,
ordem de serviço, pedido, oportunidade, item de catálogo — e também tela, por
apelido (*cobrança* leva à régua, *meta* leva a Conversões).

- **Sem acento e sem pontuação.** `lower()` do SQLite dobra apenas ASCII, então
  `antonio` não achava *Antônio*. Uma função `sem_acento()` registrada na
  conexão é aplicada **na coluna e no termo**. Telefone casa por dígitos, placa
  sem traço, e CPF também.
- **Não atravessa empresas.** Varrer as três seria o vazamento que a separação
  por banco existe para impedir. Quando não acha, a resposta diz **em que outras
  instâncias procurar**, e a travessia é escolha de quem opera.

---

## Adiar — a fila deixou de ter só duas saídas

Disparar ou ignorar. E ignorar faz o item voltar idêntico no dia seguinte, até o
operador aprender a desconfiar da lista.

O adiamento é por **(cliente, gatilho)**: adiar a revisão de um caminhão não
silencia a cobrança de orçamento do mesmo cliente. E **nunca é silencioso** — os
adiados viajam em toda resposta, aparecem numa faixa com a data de volta, e o
diagnóstico de fila vazia checa *"tudo adiado"* antes de qualquer outra causa.
Sem isso, quem adiou dez pessoas numa terça abriria a quinta com uma tela
dizendo que não há trabalho.

---

## Campanha — o nome por trás do `ad_id`

Lead de Click-to-WhatsApp **não tem UTM**: o anúncio abre a conversa direto, sem
navegador. A tela de origem agrupava por `utm_campaign`, então todo lead de
anúncio caía em `sem_campanha` — o canal onde há verba era o único sem resposta.

Agora o `ad_id` vira nome de campanha, conjunto e anúncio, lidos da Graph API e
guardados por sete dias. Três regras:

- **nunca inventa nome** — sem token, sem rede ou com erro, mostra o número e
  diz por quê. Um *"Campanha 120109"* fabricado seria pior que o número: parece
  resposta;
- **resolver fica fora do caminho da tela** — buscar durante a renderização
  deixaria a tela refém da latência da Meta;
- **falha não apaga o que já resolveu** — token vencido não pode transformar
  meses de nomes em ids crus.

---

## Credenciais — variável de ambiente é uma, e as empresas são três

`FORTCRM_META_MARKETING_TOKEN` é do processo. Minas Peças, Agrofort e Fort
Tintas têm contas de anúncio diferentes, e um token só servia a uma delas **em
silêncio** — a Graph API apenas responde *"não encontrado"* para o anúncio de
uma conta a que o token não tem acesso.

A credencial passou a viver cifrada (AES-256-GCM) **no banco da própria
empresa**, atrás do mesmo `empresa_id` que separa cliente e pedido. A cifra
existe por um caso concreto: `VACUUM INTO` produz um backup que **sai da
máquina**.

O valor **nunca volta para a tela**, nem para quem é soberano — sai a pista de
quatro caracteres, a origem e quem mudou. E sem chave-mestra o sistema **recusa
guardar**, em vez de cair num padrão embutido que tornaria a cifra decorativa.

---

## Oficina — de registro do passado a previsão do próximo serviço

Só na Minas Peças. É o módulo que responde à pergunta que sustenta uma oficina:
*qual caminhão da minha carteira precisa de bico nos próximos trinta dias?*

**A média de km/mês deixou de ser digitada.** Era coluna preenchida uma vez e
nunca revista: um caminhão cadastrado como 4.000 km/mês que passou a rodar 1.200
continuava sendo cobrado como 4.000, a revisão caía meses antes da hora, o
cliente respondia *"acabei de fazer"*, e o operador aprendia a ignorar a fila.
Agora cada leitura de hodômetro é guardada e a média é o que o veículo **andou**.

**Nove serviços com intervalo próprio**, cada um vencendo por km **ou** por
tempo, o que chegar primeiro — e a projeção diz qual dos dois mandou, porque
*"vence em 12 dias"* e *"vence porque completa um ano"* são conversas diferentes
com o cliente.

**A vistoria de entrada** tem 63 itens em 11 sistemas, e é o documento que
separa o que já estava no veículo do que a oficina fez. Três propriedades a
fazem instrumento e não formulário:

1. **guiada** — cada item diz o que olhar (*"fluido escuro absorveu água e ferve
   na descida"*). Há teste que reprova item sem orientação;
2. **crítico exige foto** — não se marca vermelho sem mostrar. O dono vê o pneu
   careca antes de ouvir o preço;
3. **o aceite vale para um conteúdo** — se algo mudar entre o envio e o aceite,
   a vistoria volta para preenchimento em vez de gravar um aceite que não
   corresponde.

E a trava: **a ordem de serviço não sai de `aberta` sem vistoria aceita.** É a
regra que dá sentido ao resto — sem ela a vistoria vira papel que se preenche
depois, para constar.

> A lista **não é a folha oficial de nenhuma rede**. É uma vistoria profissional
> montada para injeção diesel, e os itens são **dados**: trocar pela folha
> oficial é editar uma constante.

---

## Celular — segunda passada, medida

A primeira passada tratou do formato (tabela virou cartão, navegação no
polegar). Uma auditoria das 18 telas a 375 px mostrou o que sobrou:

| | Antes | Depois |
|---|---|---|
| Alvos abaixo de 44 px | **86 de 86** na régua | **0 de 230** nas 18 telas |
| Caixa de marcar | 17 × 17 px | 44 × 44 px |
| Primeiro item da fila | 693 px do topo | 368 px |
| Altura da régua | 9.637 px | 4.023 px |
| Altura da auditoria | 7.564 px | 1.857 px |
| Cromo permanente | 220 px | 119 px |

A ação principal da tela principal — escolher quem recebe mensagem hoje — era um
alvo de 17 px. Numa lista de vinte, errar o toque não é incômodo: é disparar
para o cliente errado.

A explicação da tela passou a recolher (693 px de prosa antes do primeiro
cliente), a barra de disparo desceu para junto do polegar e só aparece com
seleção, e as listas carregam oito por vez.

Duas armadilhas que só a medição pegou: **`[hidden]` perde para o componente**
(`.item { display: grid }` atropela o atributo, e treze itens marcados
continuavam na tela), e **girar o aparelho perdia dois terços da fila** — o
observador vigiava só o corte de 820 px, e as mudanças de DOM dependem do de 640.

---

## Limites — o que o sistema ainda não é

Escrito para que ninguém prometa ao cliente o que ele não entrega.

- **A conversão offline não tem fio.** Esta é a maior. Toda a cadeia existe — o
  clique é capturado, o consentimento conferido, o telefone normalizado nos dois
  formatos, a chave de idempotência gerada, o payload montado e gravado. E aí
  para: **não existe uma linha de rede que envie**. Desligar `DEMO_MODE` não liga
  o envio; a conversão passa a ser gravada como `desconhecido` com motivo
  `sem_adaptador_de_rede`. O sistema é honesto sobre isso, mas o efeito prático é
  que a frase que vende o produto hoje é promessa, não recurso. O conserto é
  pequeno: o tratamento de resposta já está escrito e testado — faltam a
  credencial e duas chamadas HTTP.
- **A previsão de manutenção não chega à régua.** O plano calcula corretamente
  qual veículo vence o quê e quando, mas isso **não entra sozinho na fila do
  dia**. É a peça que falta para o pós-venda agir em vez de só saber.
- **A tela de login está aberta na internet.** O que protege é o limitador de 12
  tentativas por minuto e a senha em `scrypt`. Não há MFA, bloqueio por
  tentativas repetidas nem revogação de sessão. Cloudflare Access na frente do
  hostname é obrigatório num endereço permanente — e está travado por um token
  do Zero Trust inválido.
- **Chave de captação errada descarta o lead em silêncio.** A resposta constante
  para chave válida, inválida ou desativada é deliberada (variar transformaria a
  porta num oráculo de enumeração), mas não há contador do lado de dentro: se o
  site do cliente for configurado com a chave errada, os leads somem e ninguém
  percebe.
- **Metade das rotas não é exercitada por teste.** O núcleo difícil está coberto
  — compliance, idempotência, atribuição, conversão, cofre, papéis, oficina. O
  que falta é o CRUD: ordens de serviço, pedidos, catálogo, gatilhos.
- WhatsApp orgânico, Instagram e Mercado Livre dependem de conector que não
  existe.
- Não dá para cadastrar ordem de serviço nem item de catálogo pela interface.
  Cliente, oportunidade e **veículo** já nascem por aqui.
- **Vídeo na vistoria não foi testado ponta a ponta.** O caminho existe e está
  limitado a 40 MB, mas só fotos foram enviadas de verdade. Também não há laudo
  em PDF da vistoria para entregar ao cliente, e o aceite só acontece presencial,
  na tela do técnico.
- **O teto de escala é um processo só.** Node é de thread única e o SQLite é
  síncrono: com 50 mil clientes, montar a fila leva 201 ms e **bloqueia todo o
  resto**. Faixa confortável medida: **~15 mil clientes por empresa**. É o teto
  do desenho, não defeito dele, e a saída já está anotada no código.
- A base é fictícia. Nenhum dado real de cliente está no sistema.

---

*188 testes · zero dependências de terceiros · Januária/MG*
