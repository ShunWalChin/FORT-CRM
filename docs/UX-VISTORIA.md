# UX da vistoria: o que foi medido e o que mudou

> Otimização do app de vistoria de entrada, feita a partir de medição no
> aparelho-alvo — celular de 375 × 812 — e não de opinião sobre a tela.

O check-list já era correto: guiado, com evidência obrigatória e aceite sobre um
conteúdo específico. O problema não era o que ele pede, era **o custo de
responder**. Uma vistoria Ouro são 86 decisões tomadas em pé, ao lado do
elevador, com uma mão segurando o telefone.

---

## 1. O que foi medido, antes

Tudo abaixo é medição no navegador, com a vistoria real aberta em 375 × 812.

| Medida | Antes | Como foi obtida |
|---|---|---|
| Cabeçalho fixo | 167 px | `getBoundingClientRect` de `.vistoria-topo` |
| Altura útil | 645 px | `innerHeight` menos o cabeçalho |
| Cartão do item (mediana) | **394 px** | mediana de 23 cartões do grupo "Sob o capô" |
| **Itens por tela** | **1,64** | 645 ÷ 394 |
| Tira de abas: visível | 347 px | `clientWidth` |
| Tira de abas: rolável | 1 494 px | `scrollWidth` |
| **Abas fora da tela** | **1 147 px (77 %)** | diferença entre os dois |
| Latência do toque | 78 ms | `performance.now()` em volta do clique |
| **Buscas de foto por toque** | **1 por foto do grupo** | contador em `fetch` |

### Composição dos 394 px do cartão

| Parte | px | Observação |
|---|---|---|
| Botões de estado | 98 | duas fileiras de quatro |
| Fileira da câmera | 76 | presente em **todos** os 86 itens |
| Campo de observação | 44 | vazio em **todos** os 86 itens |
| Dica | 39 | o que torna o check-list guiado |
| Aviso de pendência | 34 | só quando falta algo |
| Nome do item | 25 | |
| Espaçamento | ~78 | |

---

## 2. Os quatro problemas

### 2.1 Cada toque rebuscava as fotos do grupo inteiro

O mais caro, e invisível no relógio de quem desenvolve.

`desenhar()` trocava o `innerHTML` da raiz da tela. Toda `<img data-midia>`
nascia de novo, sem a marca `data-carregada`, e `carregarMidias()` — chamado no
fim de todo desenho — buscava **todas** as fotos do grupo aberto outra vez.

Medido: duas fotos no grupo, três toques, **seis buscas**. Num grupo real de 23
itens com seis fotos, marcar os dezessete restantes baixaria **102 imagens** —
cerca de 30 MB no 4G do telefone do técnico, para não mostrar nada de novo.

### 2.2 1,64 item por tela, com 86 itens para percorrer

O técnico via um item e meio de cada vez. Percorrer o check-list custava cerca
de cinquenta gestos de rolagem **intercalados** com os 86 toques — e é o
intercalar que cansa, não o número.

### 2.3 77 % das abas fora da tela

Chegar em "Após o serviço" custava três arrastões laterais num gesto que a tira
não anuncia: ela não mostra que continua.

### 2.4 78 ms por toque

Aceitável no computador. Num celular de gama média isso vira 250–400 ms, que é
onde o toque começa a parecer travado — na operação repetida 86 vezes.

---

## 3. O que foi feito

### 3.1 Pintura cirúrgica no lugar do redesenho

Três pintores tocam só o que mudou:

- `pintarItem(chave)` — a tarja do semáforo, os botões e o aviso de um cartão;
- `pintarResumo()` — a barra de progresso e os contadores;
- `pintarAbas()` — os números das abas, sem recriar a tira nem perder a rolagem.

`desenhar()` continua existindo para o que muda de **estrutura**: trocar de
grupo, abrir uma avaria.

> **78 ms → 3,1 ms por toque. Buscas de foto por toque: 0.**

### 3.2 Avanço automático — mas só no verde

Depois de marcar, a tela rola sozinha até o próximo item não avaliado do grupo.

**Amarelo e vermelho não avançam**, e essa é a decisão de desenho mais
importante daqui: esses estados exigem foto, e levar o técnico embora do item
que ele acabou de reprovar é levá-lo embora justamente da hora de fotografar.
Ao marcar defeito, a câmera **abre sozinha** no cartão.

O que **não** foi feito: um botão "marcar tudo conforme". Ele resolveria o
tempo e destruiria o produto — um check-list preenchido em bloco não vale como
prova, nem para o cliente, nem para a oficina. A regra continua sendo uma
decisão deliberada por item; o que mudou foi o custo de expressá-la.

Fim de grupo mostra para onde ir e **não vai sozinho**: trocar de grupo é
trocar a posição do veículo — descer o elevador, fechar o capô.

### 3.3 Cartão sob demanda

A fileira da câmera e o campo de observação só ocupam espaço quando têm o que
mostrar. Aberto por padrão onde a foto é exigida ou já existe; nos outros, um
par de fichas de 34 px. Os quatro botões de estado voltaram para uma fileira.

Medido no mesmo grupo: **4 de 23 itens** precisam da câmera aberta. Os outros
19 devolveram 76 px cada.

> **Cartão 394 → 244 px. Itens por tela 1,64 → 2,54.**

### 3.4 Seletor de grupo vertical

No celular, a tira horizontal sai e entra um botão que diz onde se está
(`GRUPO 5 DE 10 · Sob o capô · 17 pendentes`) e abre os dez grupos numa lista
vertical, cada um com **a posição do veículo** e o progresso (`6/16`).

A posição importa mais que o nome: o técnico não escolhe "Meia altura", escolhe
o que dá para fazer com o carro onde ele está.

> **1 147 px de abas escondidas → 723 px de lista, tudo visível numa tela de 812.**

No monitor do balcão (≥ 720 px) a tira cabe e continua sendo mais rápida.

---

## 4. Resultado

| Medida | Antes | Depois | |
|---|---|---|---|
| Cartão do item (mediana) | 394 px | **244 px** | −38 % |
| Itens por tela | 1,64 | **2,54** | +55 % |
| Latência do toque | 78 ms | **3,1 ms** | −96 % |
| Buscas de foto por toque | 1 por foto do grupo | **0** | — |
| Grupo "Sob o capô" | 8 619 px | **6 963 px** | −19 % |
| Navegação entre grupos | 1 147 px fora da tela | **tudo numa tela** | — |
| Gestos de rolagem no verde | ~50 | **0** | a tela segue |

Os 86 toques continuam sendo 86 toques. É o resto que saiu do caminho.

---

## 5. Trade-offs assumidos

**A tela adianta o estado; o servidor mantém a regra.** O avanço decide para
onde ir usando só o catálogo (`foto: 'sempre'`). Errar ali custa uma rolagem a
mais — a lista de pendências pega o que passar, e é ela que trava o envio.

**Pintura cirúrgica é mais código para manter.** São três funções que precisam
concordar com o gabarito do cartão. Se divergirem, a tela mente. A alternativa
seria um framework com DOM virtual, o que custaria a dependência zero — que é o
que faz o sistema subir com `node server.mjs`.

**A ficha esconde a câmera de quem não precisa dela.** O risco é o técnico não
achar onde anexar uma foto opcional. Mitigado por revelar sozinho no defeito e
por manter aberto onde a foto é obrigatória.

**O avanço automático pode desorientar.** Mitigado com a piscada de 900 ms no
item de destino, respeitando `prefers-reduced-motion`, e ancorando o cartão no
topo em vez de centralizar — a 244 px de cartão em 619 px úteis, centralizar
deixaria o de cima meio visível e convidaria a marcar o item errado.

---

## 6. O que eu revisitaria

- **A dica ocupa 39 px em todos os 86 itens.** É o que torna o check-list
  guiado, então não saiu. Se a densidade voltar a apertar, o caminho é recolher
  a dica **depois** da primeira vistoria daquele técnico — nunca antes.
- **`pintarAbas()` chama `desenhar()`** quando a última pendência cai, porque o
  rodapé muda de forma. É a única sobra de redesenho no caminho quente.
- **O avanço não atravessa grupos.** É deliberado hoje. Se a medição mostrar que
  o técnico sempre aceita a sugestão de fim de grupo, vale atravessar sozinho.
