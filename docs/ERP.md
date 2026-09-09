# ERP do grupo: débito técnico, arquitetura e o que existe

> Análise do que custa transformar a Central num ERP, a decisão de arquitetura
> que isso obriga, e o estado real do que foi construído.

---

## 1. O conflito que precisa ser resolvido antes de qualquer tela

A propriedade que define este sistema é o **isolamento físico**: cada empresa
num arquivo SQLite separado, e nenhuma consulta capaz de atravessar. Não é uma
coluna `empresa_id` filtrando linhas — são bancos diferentes.

Um ERP é o oposto disso. Ele é, no fundo, **um livro compartilhado**. E as duas
coisas colidem em três pontos concretos:

**Não existe transação entre instâncias.** `fed.emCada` roda a função em cada
banco e captura a falha de cada um num campo de texto. Se uma operação precisa
escrever na MP e na AF e a AF falha, a MP **já foi gravada**. Em dinheiro,
metade escrita é pior do que nada escrito.

**A Central foi construída para poder estar velha.** Está escrito no topo de
`central.mjs`: *"nunca é fonte de verdade… se a central discordar de uma
instância, a instância está certa e a central está velha."* Isso é correto para
consolidar leads. É inaceitável para contas a pagar: paga-se duas vezes.

**A Central não tem a disciplina de escopo.** As instâncias têm o marcador
`{ESCOPO}`, que obriga `empresa_id` em toda consulta de negócio. A Central não
tem nada disso — as tabelas dela são chaveadas por um texto `instancia`.

### A saída adotada

A Central deixa de ser *só* projeção e passa a ser **fonte de verdade do grupo,
para as coisas do grupo**. A direção do dado vira regra, de mão única em cada
sentido:

| Direção | Quem manda | O quê |
|---|---|---|
| **Para baixo** | Central | Plano de contas, centros de custo, parceiros, períodos, pessoas |
| **Para cima** | Instância | Fatos consumados: a venda fechou, a OS entregou |
| **Nunca** | — | A Central editar registro operacional de uma instância |

O razão inteiro mora num arquivo só. Um lançamento é uma transação local, e a
partida dobrada **fecha ou não acontece**.

O dia em que a Central puder mexer na ordem de serviço da oficina, o isolamento
virou enfeite.

---

## 2. Débito técnico: o levantamento

Cada item traz o que custa **não** resolver.

### 2.1 Resolvidos nesta entrega

| # | Débito | Como estava | Como ficou |
|---|---|---|---|
| 1 | **Sem tipo monetário** | `valor_centavos integer` espalhado, cada tela com o seu `parseFloat` | `dinheiro.mjs`: um lugar converte, soma e rateia. Ponto flutuante não entra |
| 2 | **Rateio perdia centavo** | Não existia | Maior resto: a soma das partes é sempre o todo, e é reprodutível |
| 3 | **Sem partida dobrada** | Um `valor_centavos` solto por linha | `razao.mjs`: débito = crédito, recusado quando não fecha |
| 4 | **Sem período contábil** | Não existia | Abertura automática, fechamento em ordem, reabertura com motivo |
| 5 | **Sem imutabilidade** | `update` no valor | Não se edita: estorna-se, e os dois lançamentos ficam amarrados |
| 6 | **Permissão só linear** | `leitura < operador < gestor < soberano` | Segundo eixo ortogonal por módulo. "Vê RH e não vê Financeiro" passou a ser expressável |
| 7 | **Erro de domínio virava 500** | `ErroDePermissao` escapava do despachante | `comoHttp` traduz em 403/404/422 num lugar só |
| 8 | **Fatos não subiam** | `erp_fatos` existia e ninguém alimentava. 18 OS concluídas, balancete zerado | `fatos.mjs`: colher e postar, idempotente. 48 fatos, R$ 49.376 |
| 9 | **`emCada` engolia falha parcial** | Lista que *parecia* completa | `completo` no contrato de `consultar`, `colher` e `sincronizar` |
| 11 | **Sem versão de esquema na Central** | Só `create table if not exists` | `COLUNAS_ESPERADAS_CENTRAL`, provado contra base antiga simulada |
| 16 | **Unidade ambígua na fronteira** | Número cru virava centavos; o diálogo mandava reais. R$ 1.850 entrou como R$ 18,50 | A rota **recusa** número cru: ou `valor_centavos` inteiro, ou `valor` em texto |

**Sobre o item 6** — era o mais insidioso. Sem o segundo eixo, dar acesso ao RH
obrigaria a promover a pessoa a `gestor`, e junto com a folha ela levaria o
financeiro inteiro. A checagem agora é conjunção: **passa pela escala E tem a
concessão do módulo**. Vale inclusive para o soberano, porque *conceder* e *ver*
são poderes diferentes.

### 2.2 Abertos, com o custo de cada um

| # | Débito | Consequência de não resolver | Esforço |
|---|---|---|---|
| 10 | **BI ao vivo recalcula tudo** | O painel varre o razão inteiro a cada carregamento. Com 48 fatos é instantâneo; com dois anos de operação, não | Médio |
| 12 | **Teto de escala** | ~15 mil clientes por empresa. O razão cresce mais rápido que o CRM: um ano de operação são dezenas de milhares de partidas | Médio |
| 13 | **Sem conciliação bancária** | A baixa diz que pagou; nada confere contra o extrato. É onde fraude e erro de digitação se escondem | Alto |
| 14 | **Folha de pagamento** | `erp_colaboradores` guarda o salário e nada calcula encargo, férias, 13º ou rescisão | Muito alto |
| 15 | **Sem fiscal** | Nota fiscal, SPED, apuração de imposto. É legislação, muda todo ano | Muito alto |

**Sobre 14 e 15** — a recomendação é **não construir**. Folha e fiscal mal
implementados não são recurso, são passivo: erram contra a lei, e a lei muda
sozinha todo ano. O caminho é integrar com quem já faz isso, e trazer para o
razão o **resultado** (a folha fechada, o imposto apurado) como fato.

---

## 3. O que existe e roda

**Backend + telas, 29 rotas, 48 testes de ERP (249 no total).**

```
src/dinheiro.mjs      centavos, teclado brasileiro, rateio sem perda
src/erp-schema.mjs    12 tabelas na Central + a decisão de arquitetura
src/razao.mjs         partida dobrada, período, estorno, balancete, rateio
src/titulos.mjs       contas a pagar e a receber, baixas, carteira, posição
src/permissoes.mjs    o segundo eixo: permissão por módulo
src/fatos.mjs         colher das instâncias e postar no razão
web/erp.js            painel do grupo, contas a pagar/receber, balancete
```

### As seis invariantes, cada uma com teste

| | Invariante | O que a viola é recusado com |
|---|---|---|
| 1 | Todo lançamento soma zero | `nao_fecha`, com a diferença no texto |
| 2 | Período fechado não recebe lançamento | `periodo_fechado`, dizendo onde lançar |
| 3 | Lançamento não se edita — estorna-se | `ja_estornado`, `estorno_de_estorno` |
| 4 | Conta sintética não recebe partida | `conta_sintetica` |
| 5 | Título não se baixa além do saldo | `acima_do_saldo`, dizendo o saldo |
| 6 | Nenhum dinheiro se move sem lançamento | Título e lançamento nascem na mesma transação |

E `GET /api/erp/conferir` responde as quatro perguntas de um livro saudável:
lançamento que não soma zero, partida em conta sintética, título cujo saldo
discorda das baixas, partida órfã. **Um teste planta sujeira direto no SQL para
provar que a conferência acusa** — verificador que nunca reprova não é
verificador.

### Verificado de ponta a ponta, pela API

```
o balcão é barrado no despachante, antes do banco — 403 papel_insuficiente
lançamento que não fecha — "Débito 100,00 e crédito 99,00 não batem — diferença de 1,00."
baixa acima do saldo   — "Baixa de 5.000,00 acima do saldo de 3.400,00."
R$ 100,00 em três      — partes = 3334, 3333, 3333
o balancete fecha      — débito 6.550,00 = crédito 6.550,00
gerente com RH concedido vê RH, e continua barrado no Financeiro
```

---

## 4. O que **não** foi construído

Sendo direto: o pedido era um ERP completo com sete setores, BI, gerência visual
de banco e integração total. **Isso é um programa de meses, não de uma sessão.**
O que entreguei é a espinha — e ela foi escolhida porque tudo o mais pendura
nela. Contas a pagar, RH, comercial e BI não são módulos independentes: são
formas diferentes de gerar lançamento e de ler saldo. Construir sete telas antes
do razão seria construir sete relatórios que um dia discordam entre si.

| Pedido | Estado |
|---|---|
| Contas a pagar / receber | **Pronto**, com tela: carteira por faixa de atraso e baixa |
| Financeiro (posição, caixa) | **Pronto**, no painel |
| Razão, balancete, fechamento | **Pronto**, com tela de balancete |
| Permissão root/admin por setor | **Pronto**, sem tela de administração |
| BI | **Painel do grupo**: resultado por empresa, doze meses, alertas |
| Integração com as instâncias | **Pronto**: colheita idempotente, 48 fatos das três |
| RH | Cadastro de colaborador e centro de custo. **Sem folha** |
| TI | Nada. As rotas de saúde e credenciais já existem fora do ERP |
| Comercial / Marketing | Nada no ERP. O CRM já cobre a operação |
| Gerência visual do banco | Nada — e é a que eu mais questionaria |

### Sobre a "gerência visual do banco de dados"

É o único item do pedido que eu recomendo **não** fazer. Uma tela que edita
tabela direto contorna todas as invariantes acima: o razão passa a ter uma porta
que não checa partida dobrada, período fechado nem conta sintética. O valor
legítimo por trás do pedido — *"quero ver e entender os dados"* — é atendido por
telas de leitura e pela conferência, sem abrir a porta de escrita.

---

## 5. O que a implementação revelou

Duas coisas só apareceram porque a tela foi construída, e nenhuma teria
aparecido em revisão de código.

**O painel denunciou dois números para o mesmo conceito.** A primeira versão da
postagem lançava direto contra "clientes a receber". O razão ficava certo e a
carteira ficava vazia — o painel mostrava receita reconhecida e R$ 0 a receber
ao mesmo tempo. A correção foi na raiz: o fato passou a **abrir um título**, e
os dois viraram o mesmo número. De quebra, o valor virou cobrável — aparece no
que vence, aceita baixa, sai da carteira quando for pago.

**Uma baixa de R$ 1.850,00 entrou como R$ 18,50.** O diálogo do sistema converte
campo decimal para reais em número; a rota tratava número como centavos. Ninguém
digitou errado, e nenhum erro apareceu: `1850` é inteiro válido nas duas
leituras. A rota passou a **recusar número cru** — ou `valor_centavos` inteiro,
ou `valor` como texto. O teste que guarda isso diz, em uma linha, que as duas
leituras são mil vezes diferentes.

**A recarga da demonstração dobrava a receita.** Descoberto por acidente: o
Soberano disse que faltava o deploy do ERP, fui verificar, e a senha da direção
tinha parado de funcionar. A auditoria mostrou que alguém clicara em *Recarregar
demonstração* dois minutos antes do deploy.

A recarga funcionou como devia — o problema era o que ela **não** fazia. A chave
de idempotência dos fatos é `(instância, tipo, ref)`, e `ref` é o id da linha na
instância. A recarga recria as instâncias com ids novos, então os 48 fatos
passaram a apontar para registros mortos, esperando o próximo *Sincronizar* para
colher as mesmas 18 ordens de serviço como inéditas: R$ 49.376 virariam
R$ 98.752, sem nada acusar.

O incômodo é que o princípio já estava escrito, na própria rota que recarrega:
*"a carga gera IDs novos, e a Central é uma projeção das três instâncias —
recarregar uma só deixaria a Central apontando para clientes que deixaram de
existir"*. Eu li isso ao construir o ERP e não apliquei ao ERP.

`limparMovimento()` zera lançamentos, partidas, títulos, baixas e fatos, e
**preserva as definições** — plano de contas, parceiros, períodos, permissões,
que não vieram das instâncias. Só a recarga chama: apagar movimento contábil não
é operação de sistema, é decisão de quem responde pelo livro, e para essa existe
o estorno.

**O ERP subiu funcionando e sem caminho até ele.** As rotas existiam, os
arquivos eram servidos, as telas respondiam — e o menu não as citava. Registrar
a visão, pôr palavra-chave na busca e criar um cartão no Início são três passos
que funcionam sozinhos, e nenhum deles é a porta.

## 6. Ordem recomendada daqui

1. **Agregados pré-calculados** (débito 10) antes que o razão cresça. O painel
   hoje varre tudo a cada carregamento.
2. **Tela de administração de acesso** — o backend concede por módulo e a
   concessão ainda é feita por chamada de API.
3. **Conciliação bancária** (débito 13) quando o volume justificar. É o que
   fecha o ciclo: hoje a baixa é registrada por quem diz que pagou.
4. **RH de verdade** — integrar folha, não calcular.

Folha e fiscal: integrar, não construir.
