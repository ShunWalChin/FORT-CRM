# Régua de contato e compliance

> A tela que vende, e o motor que a impede de queimar o número da empresa.

---

## O que a régua é

A lista de quem falar hoje, montada pelo sistema sozinho, com a mensagem já
escrita e o motivo à vista.

Ela resolve o problema mais caro de qualquer negócio de recorrência: **o cliente
que precisava voltar, ninguém lembrou de chamar, e ele foi no concorrente.**

Cada linha traz quem é, por que apareceu, a mensagem pronta e a decisão do
compliance. As bloqueadas aparecem em cinza tracejado, não podem ser marcadas, e
**dizem o motivo**.

---

## Os 17 gatilhos

Não são "campanhas". Cada um é uma pergunta que o dono do negócio faria se
tivesse tempo de olhar cliente por cliente.

### Minas Peças — injeção diesel (7)

| Gatilho | Quando dispara |
|---|---|
| Revisão de bomba injetora | projeção por km rodado e data da última revisão |
| Bico injetor no fim da vida | histórico de troca + quilometragem |
| Orçamento sem resposta | passou o prazo e ninguém voltou |
| OS concluída sem retirada | serviço pronto, veículo parado na oficina |
| Frota com veículo atrasado | contrato de frota com unidade fora do ciclo |
| Cliente de guincho sem retorno | entrou pela emergência e nunca voltou |
| Recompra de filtro | ciclo do item no catálogo |

### Fazenda Agrofort — queijo artesanal (5)

| Gatilho | Quando dispara |
|---|---|
| Recompra por ciclo do produto | queijo tem prazo de consumo previsível |
| Cliente de festa/feriado | comprou em data sazonal no ano anterior |
| Restaurante sem pedido no mês | conta B2B com ritmo quebrado |
| Assinatura perto do vencimento | clube mensal |
| Empório sem reposição | revenda com giro conhecido |

### Fort Tintas — varejo de tintas (5)

| Gatilho | Quando dispara |
|---|---|
| **Obra parada no meio** | comprou massa e selador e **não voltou para a tinta** |
| Orçamento de metragem sem fechamento | usou o simulador e sumiu |
| Pintor sem compra no período | parceiro com ritmo quebrado |
| Recompra de impermeabilizante | ciclo do produto |
| Construtora com obra em andamento | volume previsto vs. comprado |

> "Obra parada no meio" é o gatilho mais específico do sistema e o exemplo de por
> que gatilho genérico não serve: só quem conhece o negócio sabe que a sequência
> massa → selador → tinta tem um buraco no meio onde o cliente some.

---

## As nove checagens

Ordenadas. A **primeira que falha** bloqueia, e o motivo aparece na tela.

| # | Checagem | Por que existe |
|---|---|---|
| 1 | Canal conectado | Sem canal, a mensagem não sai — e fingir que saiu é pior |
| 2 | Consentimento LGPD | Sem autorização registrada, nenhum contato automático |
| 3 | Descadastro | Quem pediu para sair, sai. Não há exceção "só desta vez" |
| 4 | Janela de 24 h | Fora da janela de interação, só template aprovado |
| 5 | Template aprovado | Escape da janela — e **só o WhatsApp Cloud tem** |
| 6 | Cooldown do gatilho | O mesmo motivo não volta a disparar para a mesma pessoa |
| 7 | Blocklist de termos | Palavras que queimam o número |
| 8 | Teto de caracteres | Limite do canal |
| 9 | Idempotência | A mesma mensagem não sai duas vezes |

`src/compliance.mjs` é **puro** — recebe estado, devolve decisão, não toca banco
nem rede. É o que permite testar as combinações sem subir nada.

### A diferença entre os dois WhatsApps

| Canal | Escapa da janela de 24 h? |
|---|---|
| WhatsApp Cloud API | **sim**, com template aprovado |
| Evolution API (não-oficial) | **não** |

Tratar os dois igual é o erro que queima número. A política está em
`POLITICAS_CANAL`.

---

## A mensagem é rascunho, não palavra final

O texto gerado é editável na própria linha. Quem conhece o cliente ajusta uma
frase antes de mandar — e editar **já marca a linha para envio**, porque quem
ajustou vai mandar.

Duas ações ao lado: **Copiar texto** e **Abrir no WhatsApp**, esta última com o
texto já dentro da conversa. Sem adaptador de canal, é assim que a mensagem sai
de verdade hoje.

> **O texto editado volta a passar pelo compliance no servidor.** Blocklist e
> teto valem sobre o corpo final. Aceitar o que o navegador mandou daria ao
> operador um caminho para furar a própria regra da empresa sem perceber.

---

## Idempotência

Cinco estados: `claimed`, `sent`, `blocked`, `unknown`, `failed`.

A chave é `(gatilho, cliente, janela)`. O índice único do banco é a garantia
real; o `SELECT` anterior só evita o barulho de uma exceção por linha no caminho
normal.

### `unknown` nunca é repetido automaticamente

Um `timeout` não diz se a mensagem saiu. Repetir arrisca mandar duas vezes para
o mesmo cliente — e é assim que se queima um número de WhatsApp.

**Uma mensagem atrasada custa um dia. Uma duplicada custa a confiança do
cliente.** O estado exige olho humano.

### Um cliente, três veículos, uma linha

Um cliente com três veículos vencendo revisão produzia três linhas com a mesma
chave de idempotência. Hoje a fila deduplica por (gatilho, contato), mantém a
mais urgente e anuncia "e mais N caso(s)".

---

## O tratamento

`tratamento()` distingue pessoa de empresa. "Boa tarde, Fazenda!" foi um bug
real — o corte no primeiro nome quebra em razão social. Há um regex de marcador
de empresa (`MARCADOR_EMPRESA`) para isso.

---

## A demonstração envelhece

A carga gera datas relativas ao instante em que roda, e a checagem da janela de
24 h — funcionando **corretamente** — vai fechando a janela conforme o relógio
anda. Nove horas depois da carga, a fila da oficina caiu de 16 liberados para 9.

`src/reancorar.mjs` desliza a história para frente sem apagar nada. Ele
deliberadamente **não** mexe em `audit_log`, `disparos` nem `conversoes` — o que
já aconteceu, aconteceu.

Em produção roda por timer diário. Ver [Deploy](DEPLOY.md#reancoragem).
