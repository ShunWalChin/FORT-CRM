# Oficina: vida do veículo e vistoria de entrada

> Só existe na **Minas Peças** — é a instância que tem elevador.

O CRM sabia registrar o que **aconteceu**. Este módulo é o que o faz **prever**:
a pergunta que sustenta uma oficina não é *"quantas ordens fechei"*, é *"qual
caminhão da minha carteira precisa de bico nos próximos trinta dias"*.

---

## 1. Identificação

O cliente passou a ter **CPF/CNPJ**, guardado **só com dígitos**. Formatado
obrigaria a normalizar em toda busca, e a mesma pessoa entraria duas vezes por
ter sido digitada com e sem ponto. A máscara é assunto da tela.

O veículo ganhou **chassi, renavam, cor, combustível e apelido**. O chassi é o
único identificador que sobrevive à troca de placa — e placa troca (Mercosul,
transferência entre estados).

A busca global (Ctrl+K) acha por **nome, telefone, CPF, placa** e número de OS.

---

## 2. Vida do veículo

### A média deixou de ser digitada

Era uma coluna preenchida uma vez e nunca revista. Um caminhão cadastrado como
4.000 km/mês que passou a rodar 1.200 continuava sendo cobrado como se rodasse
4.000: a revisão prevista caía meses antes da hora, o cliente respondia *"acabei
de fazer"*, e o operador aprendia a ignorar a fila — o pior desfecho possível
para uma tela cujo valor inteiro é ser confiável.

Agora `veiculo_km` guarda cada leitura de hodômetro com data e procedência, e a
média é o que o veículo **realmente andou** entre a primeira e a última.

**Ponta a ponta, e não a média das médias.** Duas leituras no mesmo dia produzem
um intervalo de horas; a média por trecho daria a esse trecho o mesmo peso de um
de seis meses, e uma única digitação distorceria o ano.

**O hodômetro só anda para a frente.** Leitura menor que a anterior é recusada
com o número anterior na mensagem — aceitar produziria média negativa e uma
previsão que nunca vence, fazendo o veículo sumir da fila em silêncio.

### O plano prevê por km **ou** por tempo

`planos_manutencao` tem uma linha por serviço, cada uma com intervalo próprio. O
que vencer primeiro manda:

| Serviço | km | meses |
|---|---|---|
| Óleo do motor e filtro | 10.000 | 6 |
| Filtro de combustível | 20.000 | 12 |
| Filtro separador de água | 20.000 | 12 |
| Filtro de ar | 20.000 | 12 |
| Teste de bicos injetores | 60.000 | 24 |
| Revisão da bomba injetora | 120.000 | 48 |
| Fluido de freio | 40.000 | 24 |
| Aditivo do arrefecimento | 60.000 | 24 |
| Correia dentada | 60.000 | 48 |

O caminhão que roda pouco estraga fluido por idade antes de chegar ao km; o que
roda muito chega ao km antes do ano. A projeção devolve **as duas contas e qual
delas mandou** — *"vence em 12 dias"* e *"vence em 12 dias porque completa um
ano"* levam a conversas diferentes com o cliente.

É ponto de partida, não regra: o plano vive por veículo. Uma frota urbana de
entrega e um bitrem de estrada não têm o mesmo desgaste.

### Sem histórico, sem previsão — e a tela diz isso

Duas leituras com pelo menos uma semana entre elas. Com menos, a tela mostra o
aviso em vez de um zero — zero parece um caminhão parado.

---

## 3. Vistoria de entrada

**86 itens em 8 etapas, e três profundidades de revisão.** É o documento que
separa o que já estava no veículo do que a oficina fez. Sem ele, todo arranhão
encontrado na entrega vira discussão sem árbitro — e a oficina perde as duas
coisas, o cliente e a razão.

### Os grupos são a ordem do TRABALHO, não a dos sistemas

Esta foi a mudança que veio das folhas da rede, e é a mais importante de todas.

Agrupar por sistema — freios, suspensão, motor — é como se **pensa** sobre um
carro. Não é como se **trabalha** nele: o técnico não pula do freio dianteiro
para o motor e volta ao freio traseiro. Ele recebe o carro no chão com o cliente
ao lado, abre o capô, sobe o elevador até a meia altura, sobe até o fim, desce,
e por último roda.

| Etapa | Onde o veículo está | Itens |
|---|---|---|
| Recepção com o cliente | No chão, cliente presente | 16 |
| Exterior | Volta ao redor | 8 |
| Sob o capô | Capô aberto, motor frio | 23 |
| Meia altura | Altura da cintura, rodas removidas | 16 |
| Altura total | Elevador no alto | 8 |
| Veículo abaixado | De volta ao chão | 3 |
| Diagnóstico eletrônico | Scanner conectado | 5 |
| Após o serviço | Teste de rodagem e entrega | 7 |

A lista na ordem do trabalho elimina o vai-e-vem — e é a diferença entre uma
vistoria de quinze minutos e uma de quarenta.

### Três profundidades

| Nível | Itens | O que cobre |
|---|---|---|
| **Bronze** | 64 | Segurança e fluidos. O que não pode faltar para o carro rodar. |
| **Prata** | 80 | Bronze mais filtros, suspensão sob elevador e teste de rodagem. |
| **Ouro** | 86 | Prata mais câmbio, diferencial, chassi e diagnóstico completo. |

Os níveis são **concêntricos**: todo item de Bronze aparece em Prata e em Ouro.
São uma lista só filtrada, e não três listas que um dia divergem — há teste que
garante isso.

O nível fica **gravado na vistoria**: editar o catálogo depois não muda uma
vistoria já feita. E o resumo conta sobre os itens *daquela* vistoria — mostrar
"32 de 86" numa Bronze faria a barra parecer parada num serviço que está pela
metade.

### Os quatro pneus, um a um

A folha da rede tem um diagrama com quatro caixas, uma por roda. *"Dianteiro"* e
*"traseiro"* escondia o pneu único que está gasto — e é sempre um só.

> **Sobre a origem da lista.** A estrutura foi reconstruída a partir de folhas
> reais fornecidas pelo Soberano — a de recepção junto ao cliente, a de revisão
> por níveis Bronze/Prata/Ouro, e uma folha de manutenção preventiva. Dela vêm
> a **sequência por posição do veículo**, os **três níveis**, a **medição por
> roda** e o **aceite do cliente com assinatura**.
>
> Os itens continuam sendo **dados** (`CHECKLIST` em `src/vistoria.mjs`), não
> código: ajustar a lista é editar essa constante, sem tocar em regra nenhuma.

### Três propriedades que fazem dela um instrumento, e não um formulário

**É guiada.** Cada item diz *o que olhar*:

> **Fluido de freio** — Nível entre as marcas e cor clara. Fluido escuro
> absorveu água e ferve na descida.

Um check-list que só lista nomes é preenchido no automático, e um preenchido no
automático não vale como prova. Há teste que reprova qualquer item sem
orientação.

**Crítico exige evidência.** Não se marca vermelho sem foto. É o que impede o
laudo de virar opinião, e o que sustenta o orçamento: o dono vê o pneu careca
antes de ouvir o preço. Dez itens exigem foto **mesmo estando tudo certo** — as
quatro faces do veículo, o hodômetro, o painel de advertências, o separador de
água: são eles que provam o estado na entrada.

**O aceite é sobre um conteúdo específico.** `hashConteudo` resume o que foi
aceito — veículo, km, cada item com estado, medida e a impressão digital das
mídias. Mexer num item depois muda o resumo, e no aceite a divergência aparece:
a vistoria volta para preenchimento em vez de gravar um aceite que não
corresponde. Um aceite que vale para qualquer versão do documento não vale nada.

Não entram no hash a data de criação nem quem digitou: o cliente aceita o
**estado do veículo**, e a vistoria continuar a mesma depois de o técnico
corrigir a própria grafia numa nota é o comportamento certo.

### O semáforo

`ok` · `atencao` · `critico` · `na`. O quarto é o item que **não existe naquele
veículo** — é diferente de não ter sido olhado, e a contagem de pendências
depende dessa distinção.

### Dezesseis itens pedem medida

Sulco em mm nas **quatro rodas** (mínimo legal 1,6), freio dianteiro e traseiro
em mm, bateria e alternador em V, pressão de rail em bar, retorno de bico em
ml/min, calibragem em psi, torque de roda em Nm, aditivo e teor de água em %.
Número
é o que transforma "pneu gasto" em "1,2 mm, abaixo do limite legal".

### O desenho da carroceria

O check-list responde *"está funcionando?"*. Ele **não** responde à pergunta da
devolução, que é outra: *"esse risco já estava aí?"*.

Cinco vistas — frente, lado direito, traseira, lado esquerdo e de cima — e o
técnico toca onde há marca. O tipo fica **escolhido** num seletor fixo: marcar
"risco" três vezes seguidas não abre caixa nenhuma. Perguntar o tipo a cada
toque dobraria o número de gestos, numa volta ao redor do carro que já é feita
com o cliente esperando.

**A coordenada é gravada em fração de 0 a 1, e não em pixel.** O desenho tem 325
px no celular e 620 no monitor do balcão; um pixel gravado numa tela apareceria
no lugar errado na outra — e o desenho que o cliente assinou tem de ser o mesmo
em qualquer tela. As cinco vistas usam a mesma caixa (200×120) justamente para
isso.

O alvo do dedo é um círculo transparente de raio 14 na caixa — 45 px na tela do
celular, acima do mínimo de 44. A bola colorida de 8,5 é só o que se vê.

A silhueta é deliberadamente genérica, um sedã de traços simples. Silhueta por
modelo daria um sistema que precisa de desenhista toda vez que a oficina atende
um utilitário — e o técnico não marca o risco "no para-lama do Gol", marca no
lugar onde ele está.

A numeração é **global e por ordem de marcação**, como na folha de papel: a
avaria 3 é a mesma no desenho e na lista embaixo dele.

### Duas listas de serviço, e não uma

O que o **cliente pediu** e o que a **oficina encontrou** ficam separados, pela
`origem`.

É a separação que permite a conversa honesta na entrega: *"você pediu isto, e
nós encontramos aquilo"*. Misturadas numa lista só, todo achado parece venda
empurrada — e o cliente que sai com a conta maior do que esperava não volta.

Cada linha tem estado (pendente / O.K. / N.O.K.), tempo de reparo e valor.
**Descrição, tempo e valor travam no envio** — são o que o cliente aceitou, e
mexer depois seria trocar o documento por baixo da assinatura. O **estado não
trava**: é por ele que a lista da recepção vira a lista da entrega.

### O combinado na recepção

Entrega prevista, forma de pagamento e próximo serviço em km ficam **na
vistoria**, e não num campo solto de observação. São promessas feitas ao cliente
na entrada; ficam no documento que ele aceita.

A forma de pagamento é lista fechada — "pix do João" viraria relatório sujo.

### A rede da oficina cai, e o trabalho não pode cair junto

São 86 toques feitos em pé ao lado do elevador, onde o sinal cai atrás da coluna
e volta na porta. Antes, cada toque era uma chamada síncrona: o técnico marcava,
a rede falhava, aparecia um aviso vermelho — e meia hora depois o trabalho
dependia de ele lembrar em **quais** itens o aviso apareceu.

As marcações passam por uma fila:

- **A tela anda na frente.** O toque pinta o item na hora; o envio vai para a
  fila. Esperar a rede a cada item torna a vistoria lenta demais para ser feita
  de verdade — e o que é lento demais é preenchido depois, no computador, de
  memória, que é exatamente o que a vistoria existe para impedir.
- **A fila sobrevive à aba.** Fica no `localStorage`: celular em oficina fica
  com a tela apagada no bolso e o navegador mata a aba para liberar memória.
- **Uma chave por alvo.** Marcar "atenção" e depois "crítico" no mesmo item não
  enfileira dois envios — o segundo substitui o primeiro.
- **4xx não é falta de rede.** Um pedido que o servidor recusa sai da fila em
  vez de travá-la para sempre, com todas as marcações seguintes atrás dele.
- **Nada é enviado com fila cheia.** `Concluir` drena a fila primeiro: o hash do
  aceite é calculado sobre o que está *no servidor*, e concluir com três itens
  ainda por subir gravaria a assinatura de um documento que ainda ia mudar.

Uma barra de estado aparece **só quando há algo por salvar**. Uma barra
permanente dizendo "tudo certo" vira ruído em quarenta minutos de vistoria, e
ninguém repara quando ela muda — que é justamente quando importa.

Foto e vídeo ficam **fora** da fila: um vídeo de 30 MB não cabe no
`localStorage` (o teto é ~5 MB por origem) e enfileirá-lo derrubaria a fila
inteira. Mídia é enviada na hora, com o erro dito na cara de quem está com o
telefone na mão.

Avaria e serviço também ficam fora, por outro motivo: o id vem do servidor, e
enfileirar exigiria id provisório e reconciliação depois. São poucos e feitos no
balcão, onde o sinal é o do escritório — a troca não valeria a máquina.

### Fluxo

```
rascunho ──concluir──► aguardando_aceite ──aceite──► aceita ──► OS pode iniciar
   ▲                          │
   └──── conteúdo mudou ──────┘         └──recusa──► recusada
```

Depois do envio **nada do documento muda**: nem item, nem foto, nem o desenho da
carroceria, nem o que foi orçado. Alterar quebraria o aceite. Se precisa
corrigir, abre-se outra vistoria.

O `hashConteudo` cobre os itens, as medidas, as fotos, **as avarias da lataria e
a lista de serviços** — tudo o que o cliente vê antes de assinar. Avarias e
serviços entram no resumo apenas quando existem: uma chave sempre presente,
ainda que vazia, mudaria o hash de toda vistoria já enviada e aguardando aceite,
e o cliente veria "o conteúdo mudou" numa vistoria em que ninguém tocou.

### A trava

`POST /api/ordens/:id/iniciar` recusa sem vistoria aceita, e a recusa diz **o
que fazer** — que é diferente em cada caso: fazer a vistoria, concluir o
preenchimento, colher o aceite, ou conversar com o cliente que recusou.

É a regra que dá sentido a tudo acima. Sem ela a vistoria vira papel que se
preenche depois, para constar.

---

## 4. Foto e vídeo

**No disco, não no banco.** Blob em SQLite levaria o banco de 370 KB a
gigabytes, e com ele o backup — `VACUUM INTO` copia o banco inteiro toda
madrugada. A mídia fica em `/dados/midia/<empresa>/<vistoria>/`, irmã do
diretório dos bancos, com política de retenção própria.

**Reduzida no navegador, antes de subir.** Um celular atual produz 4 a 8 MB por
foto; 86 itens seriam 400 MB por vistoria, no 4G do telefone do técnico. A 1600
px de lado maior e qualidade 0,82 a mesma foto fica em 200–400 KB e continua
mostrando trinca em disco e sulco de pneu — que é para o que ela serve. Subir 8
MB para reduzir no servidor gastaria exatamente a parte cara, que é a rede.

**Teto de corpo por rota.** 1 MB serve a JSON e barra abuso; a rota de mídia
aceita 48 MB. Levantar o teto geral abriria as outras cinquenta rotas para
corpos de dezenas de megabytes — e este é um processo único, com SQLite
síncrono.

O binário sobe **cru**, e não em base64 dentro de JSON: base64 infla 33% e um
vídeo de 30 MB viraria 40 MB de string para o `JSON.parse` engolir de uma vez.

`sha256` de cada arquivo prova que a evidência não mudou depois do aceite.

---

## 5. O que a operação real revelou

**O limitador bloqueava o técnico no meio da vistoria.** Descoberto rodando o
fluxo inteiro: parou no item 54 com `limite_excedido`. São 86 marcações em
poucos minutos, mais as fotos, contra um teto de escrita de 60/min — e é o pior
momento possível para o sistema recusar: o carro no elevador, o cliente
esperando, metade da vistoria feita. As rotas de vistoria ganharam balde
próprio, de 240/min, que sustenta quatro técnicos atrás do mesmo IP da oficina.

**Pendência não é reprovação.** O cartão do item marcado *Conforme* a que só
faltava a foto obrigatória aparecia com fundo vermelho — a tarja dizia verde e o
fundo dizia vermelho. A tarja é o estado do item; a pendência ganhou tracejado e
a frase que explica o que falta.

**Cada toque custava duas viagens.** Marcar um item era um `PATCH` seguido de um
`GET` da vistoria inteira — 86 itens e a lista de mídias — só para saber o que
ainda faltava. Numa vistoria completa eram mais de cento e setenta chamadas no
4G do telefone do técnico. O `PATCH` passou a devolver o resumo **e** as
pendências, e a segunda viagem sumiu.

**O anel do pino selecionado engolia a cor do tipo.** Um anel de 3 sobre uma
bola de raio 8,5 cobre um terço do raio; no tamanho que ela tem na tela, o pino
inteiro passava a ler como "acento" em vez de "amassado". O anel afinou e ganhou
um halo suave — a seleção continua visível, e a cor do tipo sobrevive.

---

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/checklist` | O catálogo. A tela não guarda cópia dele. |
| `POST` | `/api/veiculos` | Cadastra e **já cria o plano** — em dois passos, o segundo não acontece. |
| `GET` | `/api/veiculos/:id` | Vida completa: dados, uso, plano projetado, linha do tempo. |
| `POST` | `/api/veiculos/:id/km` | Leitura de hodômetro; recalcula média e previsões. |
| `POST` | `/api/vistorias` | Abre com os itens do nível já criados. |
| `GET` | `/api/vistorias/:id` | Vistoria, itens, mídias, avarias, serviços, resumo e **pendências**. |
| `PATCH` | `/api/vistorias/:id/itens/:chave` | Marca um item — 86 vezes por vistoria. Devolve resumo **e** pendências. |
| `PATCH` | `/api/vistorias/:id` | O combinado na recepção: entrega, pagamento, próximo serviço. |
| `POST` | `/api/vistorias/:id/avarias` | Marca a lataria. `x`/`y` em **fração** 0–1, nunca em pixel. |
| `DELETE` | `/api/vistorias/:id/avarias/:avariaId` | Só enquanto rascunho. |
| `POST` | `/api/vistorias/:id/servicos` | Pedido do cliente (`origem: cliente`) ou achado da oficina (`vistoria`). |
| `PATCH` | `/api/vistorias/:id/servicos/:servicoId` | Preço e descrição travam no envio; o estado, não. |
| `DELETE` | `/api/vistorias/:id/servicos/:servicoId` | Só enquanto rascunho. |
| `POST` | `/api/vistorias/:id/midia` | Binário cru. `?item=&tipo=foto\|video`. |
| `GET` | `/api/midia/:id` | Serve o arquivo, atrás de sessão. |
| `POST` | `/api/vistorias/:id/concluir` | Valida e envia. Recusa dizendo **quais** itens faltam. |
| `POST` | `/api/vistorias/:id/aceite` | Aceite ou recusa do cliente. Confere o hash. |
| `POST` | `/api/ordens/:id/iniciar` | **A trava.** |

Criar a vistoria abre os itens do nível de uma vez, e não conforme se marca: é o que
permite perguntar *"quanto falta"*, e o que garante que a lista não mude no meio
do preenchimento se o catálogo for editado.
