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

**63 itens, 11 sistemas do veículo.** É o documento que separa o que já estava
no veículo do que a oficina fez. Sem ele, todo arranhão encontrado na entrega
vira discussão sem árbitro — e a oficina perde as duas coisas, o cliente e a
razão.

> **Sobre a origem da lista.** É uma vistoria profissional montada para oficina
> de injeção diesel, e **não** a transcrição da folha oficial de nenhuma rede.
> Os itens são **dados** (`CHECKLIST` em `src/vistoria.mjs`), não código —
> trocar pela folha oficial é editar essa constante, sem tocar em regra nenhuma.

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

### Nove itens pedem medida

Sulco de pneu em mm (mínimo legal 1,6), pastilha em mm, bateria e alternador em
V, pressão de rail em bar, retorno de bico em ml/min, calibragem em psi. Número
é o que transforma "pneu gasto" em "1,2 mm, abaixo do limite legal".

### Fluxo

```
rascunho ──concluir──► aguardando_aceite ──aceite──► aceita ──► OS pode iniciar
   ▲                          │
   └──── conteúdo mudou ──────┘         └──recusa──► recusada
```

Depois do envio **nenhum item muda**: alterar quebraria o aceite. Se precisa
corrigir, abre-se outra vistoria.

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
foto; 63 itens seriam 300 MB por vistoria, no 4G do telefone do técnico. A 1600
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
fluxo inteiro: parou no item 54 com `limite_excedido`. São 63 marcações em
poucos minutos, mais as fotos, contra um teto de escrita de 60/min — e é o pior
momento possível para o sistema recusar: o carro no elevador, o cliente
esperando, metade da vistoria feita. As rotas de vistoria ganharam balde
próprio, de 240/min, que sustenta quatro técnicos atrás do mesmo IP da oficina.

**Pendência não é reprovação.** O cartão do item marcado *Conforme* a que só
faltava a foto obrigatória aparecia com fundo vermelho — a tarja dizia verde e o
fundo dizia vermelho. A tarja é o estado do item; a pendência ganhou tracejado e
a frase que explica o que falta.

---

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/checklist` | O catálogo. A tela não guarda cópia dele. |
| `POST` | `/api/veiculos` | Cadastra e **já cria o plano** — em dois passos, o segundo não acontece. |
| `GET` | `/api/veiculos/:id` | Vida completa: dados, uso, plano projetado, linha do tempo. |
| `POST` | `/api/veiculos/:id/km` | Leitura de hodômetro; recalcula média e previsões. |
| `POST` | `/api/vistorias` | Abre com os 63 itens já criados. |
| `GET` | `/api/vistorias/:id` | Vistoria, itens, mídias, resumo e **pendências**. |
| `PATCH` | `/api/vistorias/:id/itens/:chave` | Marca um item. A operação mais repetida do app. |
| `POST` | `/api/vistorias/:id/midia` | Binário cru. `?item=&tipo=foto\|video`. |
| `GET` | `/api/midia/:id` | Serve o arquivo, atrás de sessão. |
| `POST` | `/api/vistorias/:id/concluir` | Valida e envia. Recusa dizendo **quais** itens faltam. |
| `POST` | `/api/vistorias/:id/aceite` | Aceite ou recusa do cliente. Confere o hash. |
| `POST` | `/api/ordens/:id/iniciar` | **A trava.** |

Criar a vistoria abre os 63 itens de uma vez, e não conforme se marca: é o que
permite perguntar *"quanto falta"*, e o que garante que a lista não mude no meio
do preenchimento se o catálogo for editado.
