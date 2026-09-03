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
