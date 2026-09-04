# Decisões e armadilhas

> Cada item aqui é um defeito que existiu de verdade no código, ou uma escolha
> que parecia arbitrária e não é. Está documentado para que ninguém "conserte"
> de volta.

---

## Dados e persistência

### `min-height` não encolhe um `textarea` com `rows="4"`

O campo da mensagem vinha com `rows="4"` do HTML. Definir `min-height: 48px` no
CSS mobile não fez nada — um mínimo menor que a altura atual é só um piso já
satisfeito. Precisa ser `height`.

### Backup com `cp` produz um banco íntegro e **vazio**

Medido em produção: os arquivos `.db` têm **4 KB** e os `-wal` têm **832 KB**. O
SQLite em modo WAL mantém as escritas recentes no arquivo lateral e só as move
para o `.db` num checkpoint.

Copiar o `.db` sozinho — o reflexo de quem faz backup com `cp` — gera um arquivo
que abre normalmente e não tem nada dentro. **O erro só aparece na restauração.**

`deploy/manutencao.mjs` usa `VACUUM INTO`, que lê pela engine com o WAL aplicado,
e **aborta se o backup sair com menos de 8 KB** — porque esse é exatamente o
sintoma da falha silenciosa.

### A carga levava 25 segundos e travava o event loop

Cada `INSERT` era um commit com `fsync` próprio. Envolver a carga numa transação
e ligar `journal_mode=wal` + `synchronous=normal` levou de **25 s para 5 ms**. Há
teste de regressão.

### `semear` com `reset` exige a empresa explícita

`semear(banco, { empresa = 'MP', reset })` tem `'MP'` como padrão, e
`recarregarDemo` omitia o parâmetro. Recarregar a Agrofort **gravava a Minas
Peças por cima** — linha de `empresas` inclusive — e as três instâncias passavam
a se apresentar como MP.

O defeito ficou escondido atrás de um `ReferenceError: banco is not defined` na
rota que chamava. Consertar o crash foi o que revelou o estrago. Agora `reset`
sem empresa explícita **falha alto**.

### `create table if not exists` não acrescenta coluna

Resolve o banco novo e **não** resolve o que já existe. Acrescentar uma coluna
ao `schema.mjs` não muda uma tabela já criada, e a primeira escrita quebra com
`has no column named X` — longe do arquivo que foi editado.

Passou despercebido em desenvolvimento porque eu apagava `data/` e a base
renascia com o schema novo. Em produção, onde apagar a base não é opção, o
deploy subiu limpo e a recarga quebrou.

`src/migracoes.mjs` declara as colunas esperadas e aplica o que falta na
abertura do banco. Idempotente, e **falha alto** quando um `ALTER` não passa —
uma coluna que não entrou é uma escrita que vai quebrar depois, com uma
mensagem que não explica nada.

Deliberadamente **não** remove coluna, não renomeia e não muda tipo: isso exige
recriar a tabela, e essa operação tem de ser escrita e revisada uma a uma, nunca
inferida por diferença.

### Projeção que só acrescenta é acumulador

A sincronização da central fazia insert-or-update e **nunca removia**. Uma
projeção cujo cliente de origem sumiu ficava para sempre.

Medido em produção depois de uma recarga da demonstração — que gera ids novos:
**76 linhas na central para 38 clientes reais**. Metade apontando para gente
que não existe mais, e a tela do grupo mostrando o dobro do faturamento.

A remoção usa um **carimbo de execução**, e não `not in (lista de ids)`: a
lista cresce com a base e um dia estoura o limite de parâmetros. O carimbo
custa dois parâmetros com dez ou com dez mil clientes.

Duas proteções que o teste cobre:

- **`cliente_id is not null`** — o lead que chegou pela porta de captação e
  ainda está em triagem não é projeção de instância nenhuma. Apagá-lo aqui
  destruiria a fila de quem ainda não foi atendido.
- **A remoção só roda depois de a leitura ter dado certo.** Instância fora do
  ar lança antes, então indisponibilidade de minutos nunca vira perda de dado
  permanente.

### Recarregar uma instância exige re-sincronizar a central

A carga gera IDs novos, e a central é uma projeção das três instâncias.
Recarregar uma só deixava a central apontando para clientes que deixaram de
existir. A sincronização passou a acontecer no mesmo pedido.

---

## Atribuição e conversão

### Google e Meta querem o mesmo telefone em formatos diferentes

O Google Ads pede E.164 **com** o `+` (`+5538998112233`); a Meta pede só dígitos
(`5538998112233`). **Hash do formato errado não casa com nada, e não dá erro.** A
campanha simplesmente "não converte", e ninguém descobre por quê.

O CRM guarda as duas formas em colunas separadas. Guardar uma só e apelidar a
outra funciona até alguém ler a tabela achando que tem a forma da Meta.

### A data do Google Ads não é ISO-8601

É `yyyy-MM-dd HH:mm:ss+HH:mm` — espaço no lugar do `T` e fuso obrigatório.
Mandar ISO devolve erro de parse, e o detalhe engana porque *parece* a mesma
coisa.

### O `event_time` da Meta é Unix em **segundos**

Milissegundos passam pela validação de tipo e caem milhares de anos no futuro,
onde o evento é descartado sem aviso.

### `utm_source=google` com `utm_medium=organic` é busca orgânica

Classificar isso como `google_ads` faria o sistema devolver conversão ao Google
por um cliente que **nunca clicou em anúncio nenhum** — ensinando o algoritmo com
dado falso. Há uma lista explícita de meios não pagos (`MEDIUM_NAO_PAGO`).

### Nunca mandar `gclid` e `gbraid` juntos

É erro de validação na API do Google, não "mais chance de casar". Um só dos três,
na ordem de precisão.

### `ctwa_clid` e o ID do WABA **não** são hasheados

São identificadores de clique e de ativo, não dado pessoal. Hashear faz o evento
ser aceito e **nunca casar com anúncio nenhum**.

### Origem não é local de conversão

O cliente chega pelo WhatsApp e fecha a compra na loja. `action_source` descreve
onde a **conversão** aconteceu, não de onde o lead veio. Rotular tudo como
`business_messaging` porque o lead veio do chat é reportar coisa errada para quem
decide a verba.

O padrão é `system_generated` — o rótulo que afirma menos.

### A regra do `fbc`/`fbp` é de proveniência, não de `action_source`

Primeiro implementei cortando `fbc` de toda conversão que não fosse web. **Um
teste existente pegou.** Eles valem sempre que uma visita web real os produziu,
mesmo que a venda feche por telefone — o clique aconteceu. O proibido é
*fabricar* onde visita nenhuma houve, e esse é o caso do Click-to-WhatsApp.

### `Schedule` e `Opportunity` não existem em Business Messaging

São os nomes naturais para "reunião marcada" e "oportunidade criada", e **não
estão na lista aceita**. Mandar assim vira evento customizado, que pode ser
aceito e não fica elegível para otimização de campanha CTWA. As três etapas viram
`QualifiedLead`, distinguidas por `custom_data.funnel_stage`.

### A janela de 7 dias precisa ser chamada

Implementei `dentroDaJanela`, testei isolada, e **nunca passei `ocorridoEm` na
chamada real do despacho**. A função só confere a idade quando recebe a data — o
guarda era código morto, e toda conversão envelhecida seguia para a plataforma
para voltar como erro genérico.

### 429 e 400 são opostos

`429` é "você mandou rápido demais": o evento está **certo** e a mesma tentativa,
mais tarde, funciona. `400` é "o evento está errado": repetir produz o mesmo
`400` para sempre. Tratar os dois como `falhou` joga fora conversão boa num pico
de tráfego, ou repete lixo eternamente.

### Ambiguidade nunca se repete sozinha

Um `timeout` não diz se o evento entrou. Repetir arrisca contar a mesma venda
duas vezes — e número de conversão inflado vira decisão de verba tomada em cima
de mentira. O estado fica `desconhecido` e exige olho humano.

### `action_source` em coluna, não só no payload

A pergunta de auditoria é "vocês disseram à Meta que esta venda foi no chat?".
Ler isso via `json_extract` de um blob não é resposta. E como `action_source` é
vocabulário da Meta — o Google não tem campo equivalente —, a decisão é tomada
**uma vez no serviço** e vale para os dois destinos; se morasse no montador, a
coluna ficaria vazia em metade das linhas.

---

## Canais de entrada

### As três empresas compartilhavam a mesma lista de origens

`guincho_24h` e `site_diagnostico` — canais de oficina de injeção diesel —
apareciam na **fazenda de queijo** e na **loja de tintas**. Origem errada leva a
decidir verba errada.

### Origem e atribuição eram sorteadas de forma independente

Produzia cliente com `origem: 'balcao'` carregando `gclid`. **Quem entra pela
porta não clicou em anúncio.** Hoje a carga só dá origem atribuível a quem tem
parâmetro de clique.

### WhatsApp orgânico **não** é atribuível

E é o engano mais comum, porque o número é o mesmo que o anúncio usa. Só o
clique (`ctwa_clid`) distingue um do outro.

### A porta de entrada não existia

`POST /api/central/entrada` estava documentada como "porta de entrada de lead
externo (formulário, anúncio, parceiro)" e chamava `contexto()` — ou seja,
**exigia sessão**. Um formulário de site não faz login. O pipeline de atribuição
inteiro existia sem nada por onde entrar.

### `cloudflared tunnel route dns` concatena zonas em silêncio

Rotear um hostname de outra zona **não falha**. Ele cria
`fortcrm.januariamg.com.br.fattech.com.br` na zona do `cert.pem`. Criei e
removi. Conferir a zona **antes** de rotear.

---

## Interface

### Item de grade tem `min-width: auto`

E se recusa a encolher abaixo do conteúdo. Uma tabela larga esticava a **página
inteira** para 736 px num aparelho de 375 — apesar de a tabela já ter
`overflow:auto` no próprio contêiner. Resolvido com `min-width: 0` em `main`.

### `scrollWidth > clientWidth` não prova rolagem lateral

A diferença de 15 px no desktop era a barra de rolagem. Medir por comportamento:
`scrollTo(9999,0)` e conferir `scrollX`.

### `getComputedStyle` devolve `oklab()` para valores de `color-mix`

Calcular luminância tratando aqueles números como RGB dá resultado sem sentido —
me fez "encontrar" quatro temas quebrados que estavam corretos. A medição certa é
pintar num `canvas` e ler o pixel.

### Um ponto de corte só era o erro

820 px é sobre o **formato da janela** — a lateral não cabe ao lado do conteúdo e
o polegar precisa da barra de baixo. 640 px é sobre a **largura do conteúdo** —
abaixo disso a tabela vira cartão. A 812 px um tablet deitado recebia layout de
telefone sem precisar.

### O botão de ação não pode entrar no resumo

A regra de cartão resumido — três campos, o resto atrás de um toque — escondia a
nona coluna de Ordens, que é o botão "Concluir". Esconder informação secundária é
o objetivo; esconder o botão é quebrar a tela.

### Texto editado não encolhe ao perder o foco

Foi o que fiz primeiro, para a lista não ficar cheia de campos abertos. Mas
editar **já marca a linha para envio**, e recolher esconde justamente a mensagem
que a pessoa acabou de ajustar.

### Delegação, não listener por elemento

`desenharMenu()` reescreve o `innerHTML` a cada navegação, e listener preso ao
elemento morre junto. Foi assim que o menu do celular abriu e não fechou mais.

### O tema tem de ser aplicado antes da primeira pintura

`app.js` é `type="module"`, ou seja, adiado — quando ele roda, a página já foi
pintada uma vez. Quem escolheu "Papel" veria a tela nascer preta e clarear no
quadro seguinte. Por isso o tema é aplicado por um script no `<head>`.

### Backticks quebram o schema

O SQL vive dentro de um template literal JS. Um backtick num comentário SQL fecha
a string e o arquivo deixa de fazer parse. Aconteceu duas vezes.

---

## Segurança

### O papel filtrava o menu e não recusava nada

`papel` estava no schema desde o início, `visivelNoMenu()` o usava para esconder
telas — e **o servidor nunca o verificava**. Verificado chamando as rotas: um
`operador` acessava `/api/auditoria`, `/api/conversoes`, `/api/central/resumo` e
**executava** `POST /api/central/sincronizar` digitando o endereço.

Eu havia documentado "o menu por papel é organização, não segurança: quem
digitar a URL chega igual, e é o servidor que recusa". A primeira metade estava
certa; a segunda era falsa.

Agora há uma tabela de papel mínimo por rota, e a recusa acontece em
`contexto()`. O despachante carimba `req.rotaChave` com o **padrão** da rota
(`GET /api/clientes/:id`), não com o caminho pedido — senão cada id viraria uma
entrada diferente na tabela.

**O padrão de rota não declarada é `operador`**, o mais restrito que ainda deixa
o sistema funcionar: esquecer de declarar uma rota nova a torna inacessível para
`leitura`, e não acessível para todo mundo. Há teste varrendo a lista inteira de
rotas de governança.

### `leitura` não é um degrau abaixo de `operador`

É outra coisa: vê o que o operador vê e **não escreve nada**. Tratado como
degrau numa escala, seria recusado em quase tudo e a conta nasceria inútil — o
que quase aconteceu. Qualquer método diferente de `GET` é recusado, declarado ou
não.

## Segurança

### Sem segredo, a porta fica **fechada**

O webhook do WhatsApp recusa tudo quando `FORTCRM_META_APP_SECRET` não está
definido. O contrário — "sem segredo, aceita tudo" — funciona em
desenvolvimento, vai para produção sem a variável e vira endpoint público de
escrita.

### HMAC sobre o corpo bruto

Calcular sobre `JSON.stringify` do objeto já parseado muda ordem de chaves e
espaçamento. A assinatura nunca bate, e o sintoma é "o webhook parou de
funcionar" sem nada no log explicar. `lerCorpo` pendura os bytes em
`req.corpoBruto`.

### Resposta idêntica para chave válida e inválida

Na porta pública de captação. Variar transformaria a porta num oráculo — daria
para enumerar quais chaves existem, ou descobrir se um telefone já é cliente.

### O texto editado passa pelo compliance no servidor

Blocklist e teto de caracteres valem sobre o corpo final. Aceitar o que o
navegador mandou daria ao operador um caminho para furar a própria regra da
empresa sem perceber que furou.

### `scrypt`, não bcrypt

bcrypt exige dependência nativa compilada por arquitetura. O servidor é
`aarch64` e a máquina de desenvolvimento é `x86` — é exatamente o que funciona no
notebook e falha no deploy. `scrypt` vem do `node:crypto`.

A migração de senhas roda **na subida**, não no primeiro login: senão a senha de
quem não entrasse ficaria em claro por tempo indefinido, e são justamente as
contas esquecidas que ninguém audita.

### Segredos em `EnvironmentFile`, nunca em `Environment=`

`systemctl cat` é legível por qualquer usuário, e o host tem clientes.

### O menu por papel é organização, não segurança

Quem digitar a URL chega igual. É o servidor que recusa.

---

## Ideias vindas de fora

Três decisões foram adaptadas do [CRM da Comp AI](https://github.com/trycompai/crm)
(MIT, © Comp AI). O código é outro — eles são Next.js/Prisma/Postgres e nós somos
Node puro com SQLite —, mas o desenho vale nos dois.

### Campos personalizados em JSON, com um registro que descreve os dois tipos

Ver [Campos personalizados](CAMPOS-PERSONALIZADOS.md). A frase que resume o
motivo: uma lista mostrando oito colunas personalizadas não pode virar oito
junções.

O que mudei: eles têm um registro para a instalação inteira; aqui ele é por
empresa, porque cada instância é um negócio diferente. Há teste garantindo que o
catálogo da oficina não contém campo da fazenda.

### A ficha vive na URL

"Sheets, not inner pages." A ficha é uma gaveta identificada por um parâmetro
(`#/clientes?ficha=abc`), e não uma rota de página interna.

Três coisas passaram a funcionar: o endereço é compartilhável, o **botão Voltar
fecha a gaveta** em vez de sair da tela — no celular, onde voltar é um gesto,
isso tirava o operador do trabalho — e recarregar reabre onde estava.

Detalhe que importa: a gaveta usa `pushState`, não troca de hash. Trocar o hash
dispararia `hashchange` e faria a tela de trás recarregar por baixo da gaveta que
acabou de abrir.

### O Tag Manager apaga atributos

O injetor de HTML personalizado do Google Tag Manager **reconstrói** o elemento
de script e mantém apenas a URL: atributos `data-*`, `async` e `defer` somem no
caminho.

Um script de captação que só lê atributo carrega, não encontra a chave, e volta
em silêncio — aparece na aba de rede, o formulário parece instalado, e **nada é
registrado**. O snippet agora lê a chave do atributo **ou** do `?chave=` no
endereço, com o atributo vencendo quando os dois existem.

Esta é do tipo que só se descobre em produção, com o cliente reclamando que não
chega lead.
