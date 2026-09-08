# Interface

> Cinco temas, versão mobile e as decisões de usabilidade — todas medidas.

## Refino de usabilidade — o que mudou e por quê

Cada item abaixo veio de usar o sistema como usuário, não de checklist.

**A régua era um beco sem saída.** Ela mostrava a mensagem certa, para a pessoa
certa, com o motivo certo — e não deixava fazer nada com aquilo. Sem adaptador
de canal, o uso prático hoje é copiar e mandar pelo WhatsApp, e isso não
existia. Agora a mensagem é **editável**, tem **Copiar texto** e **Abrir no
WhatsApp** com o texto já dentro. Editar marca a linha sozinho, porque quem
ajusta a frase vai mandar aquela mensagem.

O texto editado **volta a passar pelo compliance** no servidor. Blocklist e teto
de caracteres valem sobre o corpo final; aceitar o que o navegador mandou daria
ao operador um caminho para furar a própria regra sem perceber.

**No celular, o conteúdo começava a 902 px do topo.** A lateral empilhava
inteira antes de qualquer coisa aparecer. Numa oficina o atendente usa celular,
e rolar mil pixels para chegar na fila torna a tela inútil. Agora é uma barra
compacta com o menu atrás de um botão: **73 px**.

**O menu tinha 16 itens para quem atende balcão**, seis deles de governança e
aquisição que ele nunca usa. Agora o menu segue o papel — operador vê 10. É
organização de tela, nunca segurança: quem digitar a URL chega igual, e é o
servidor que recusa.

**A ficha do cliente era só leitura.** Telefone errado não tinha como corrigir —
e telefone certo é o que faz o botão do WhatsApp funcionar. Agora é editável.

**Telas de outra empresa abriam vazias, sem uma palavra.** O atendente da fazenda
entrava em "Frota" e via zero veículos; a pergunta que se faz nessa hora é "cadê
meus dados?". Agora explica de quem é a tela e oferece o atalho para trocar.

**O kanban não funcionava por toque.** Arrastar e soltar do HTML não tem
equivalente no dedo. Cada cartão ganhou um seletor de etapa — funciona em dedo,
mouse e teclado, e por isso existe no desktop também.

**Rolagem lateral no celular.** Item de grade tem `min-width: auto` e se recusa
a encolher abaixo do conteúdo: uma tabela larga esticava a página inteira para
736 px num aparelho de 375, apesar de a tabela já ter `overflow:auto`. Resolvido
com `min-width: 0`.

---

## Versão mobile

Não é o desktop encolhido. Medido num aparelho de 375 px, antes de escrever
qualquer CSS:

| Tela | Antes | Depois |
|---|---|---|
| Clientes | tabela de 936 px numa caixa de 343 — **593 px escondidos** | cartão de 214 px, sem rolagem lateral |
| Ordens de serviço | 903 px de tabela, 9 colunas | cartão com o botão de ação sempre visível |
| Régua de contato | **12.136 px** de altura para 22 itens | **8.182 px**, item de 330 px |
| Cabeçalho fixo da fila | 176 px presos no topo de uma tela de 812 | 116 px |

### Duas medidas, porque são duas perguntas

O ponto de corte único estava errado, e só apareceu ao testar a 812 px: um
tablet deitado recebia o layout de telefone e via as tabelas viradas em cartão
sem precisar.

- **820 px — formato da janela.** A lateral não cabe ao lado do conteúdo, e o
  polegar precisa da barra de baixo. Vale para tablet deitado.
- **640 px — largura do conteúdo.** Abaixo disso a tabela deixa de ser legível
  e vira cartão. A 812 px a de Clientes rola um pouco; a 375 px esconde 593 px,
  que é outra coisa.

### Tabela vira cartão sem tocar nas telas

`rotularTabelas` carimba em cada `<td>` o texto do `<th>` da coluna, depois da
renderização. O CSS usa `content: attr(data-rot)` para o rótulo. Onze telas com
tabela ganharam o formato de cartão sem uma linha alterada em nenhuma delas — e
os cabeçalhos continuam existindo num lugar só, em vez de duplicados numa
segunda camada que um dia divergiria.

`colSpan` é respeitado: sem isso, uma célula mesclada empurraria todos os
rótulos seguintes uma coluna para a direita, e o cartão passaria a mentir sobre
o que cada valor é.

### O que a medição pegou

- **O botão de ação sumiu.** A regra de resumo — três campos, o resto atrás de
  um toque — escondia a nona coluna de Ordens, que é o botão "Concluir".
  Esconder informação secundária é o objetivo; esconder o botão é quebrar a
  tela. O filtro agora deixa passar qualquer célula com botão e a coluna sem
  cabeçalho.
- **`min-height` não encolhe nada.** O campo da mensagem vem com `rows="4"` do
  HTML; um mínimo menor é só um piso já satisfeito. Precisa ser `height`.
- **O texto editado não pode encolher ao sair.** Era o que eu tinha feito
  primeiro. Mas editar já marca a linha para envio, e recolher o campo esconde
  justamente a mensagem que a pessoa acabou de ajustar.

### Navegação de polegar

Quatro abas — Hoje, Clientes, Funil, Mais — fixas na base, com
`env(safe-area-inset-bottom)` para não ficarem sob a barra de gestos do iPhone.
"Mais" abre a mesma gaveta do menu, e não uma segunda lista de telas que
precisaria ser mantida em paralelo.

No celular a rota padrão é a **régua**, não o painel: a pergunta com o cliente
na frente é "com quem eu falo agora".

---

---

## A tela de Início

O painel responde *"como estamos"*. Essa é a **segunda** pergunta de quem abre o
sistema — a primeira é *"o que eu faço aqui"*, e quem nunca viu a ferramenta não
faz nem uma nem outra: fica olhando para um menu de dezessete itens sem saber por
onde começar.

Três regras fazem esta tela funcionar, e nenhuma delas é "botão grande":

**Cada cartão é nomeado pelo que a pessoa quer fazer.** "Falar com clientes hoje",
não "Régua de contato". O nome da funcionalidade só ensina quem já sabe o que ela
faz.

**Cada cartão carrega estado vivo.** *"7 pessoas esperando"*, *"R$ 14.300 em
negociação"*, *"2 ordens abertas"*. O número ensina o que a tela é sem uma linha
de explicação, e mostra onde está o trabalho. Um menu lista; ele não prioriza.

**A ação principal não compete.** Ocupa a largura toda, com o número em 44 px.
É a razão de o sistema existir — deixá-la do mesmo tamanho das outras seria
fingir que tudo pesa igual.

### A busca do balcão

Dentro do cartão de clientes há um campo de busca. No balcão o cliente está na
frente, e abrir Clientes → achar o campo → digitar são três passos onde cabia um.
Enter leva para `#/clientes?busca=...`, já filtrado.

### Adapta por papel e por empresa

| | Vê |
|---|---|
| Operador da oficina | 8 cartões — frota e ordens de serviço |
| Operador da fazenda/loja | 8 cartões — pedidos e catálogo |
| Direção | 11 cartões — mais conversões, central e auditoria |

### O que a medição corrigiu

No celular o cartão principal começava a **332 px do topo** — 40% da tela gasta
em cabeçalho antes da coisa que a pessoa veio fazer, numa tela cujo propósito é
justamente deixar isso na cara. O botão "Como usar" saiu do cabeçalho no celular,
porque a faixa do rodapé já o tem: **255 px**, e o cartão inteiro cabe sem rolar.

---

## Busca global

`Ctrl+K`, `/`, ou a porta na lateral. Uma caixa, `GET /api/buscar`, que devolve
cliente, veículo, ordem de serviço, pedido, oportunidade, item de catálogo — e,
resolvidas no navegador, as telas do menu.

### Uma busca, não duas

Havia aqui um campo *"Filtrar telas…"* que filtrava o menu lateral. Ele não
achava cliente, nem placa, nem OS: quem digitava `antonio` lia **"Nada com
antonio"** e concluía, razoavelmente, que o sistema não tinha o Antônio.

Duas caixas de busca com alcances diferentes é pior que uma — a pessoa não tem
como saber qual das duas responde a pergunta dela. O campo virou a porta de uma
busca só, que acha tela **e** registro.

### `like` do SQLite não sabe português

`lower()` do SQLite dobra apenas ASCII: nem o acento nem o Ç saem sozinhos.
Procurar `antonio` não achava *Antônio* — e no balcão, de celular, ninguém digita
circunflexo.

A resposta é uma função `sem_acento()` registrada na conexão
(`db.function`, `deterministic: true`), aplicada dos **dois** lados: na coluna e
no termo digitado.

O preço está anotado no código: SQLite chama JS uma vez por linha avaliada, e
nenhum índice cobre a expressão. Numa base de balcão é imediato; quando passar
disso, a resposta é uma coluna `nome_busca` normalizada na escrita e indexada —
e não esticar a função.

### A busca não atravessa empresas

Varrer as três instâncias de uma vez seria cômodo e seria exatamente o vazamento
que a separação por banco existe para impedir: uma lista onde o cliente da
Agrofort aparece ao lado do da Minas Peças, e um clique errado leva o operador
para dentro de outra empresa.

O vazio, porém, não pode ser um beco. A resposta carrega em `meta.outras` as
instâncias a que **aquela pessoa** tem acesso, e a tela oferece *"Procurar em
Fazenda Agrofort"*. A travessia existe; é ela quem decide fazê-la — e a troca é
real, com a casca inteira mudando de cor e de menu. Quem só tem uma instância não
recebe o convite.

### Pontuação no servidor, entre os tipos

Cada consulta ordenada isoladamente nunca produz a ordem que importa, que é
**entre** os tipos: o cliente cujo nome é exatamente o termo tem de vencer a
ordem de serviço que apenas contém o termo no meio do componente. Daí a nota
(3 exato, 2 prefixo, 1 contém) ser calculada em JS depois das seis consultas, com
empate desfeito por tipo — pessoa primeiro, que é o que se busca no balcão.

### `?foco=` acende a linha

Buscar uma OS e cair numa tela de duzentas linhas é a mesma busca feita duas
vezes, a segunda com os olhos. As listas carimbam `data-linha` no `<tr>`, e
`focarDaUrl()` rola até ela e acende por 3 s. O destaque apaga sozinho: linha
marcada para sempre vira sujeira quando a pessoa continua trabalhando ali.

---

## Adiar um contato

A fila só tinha **disparar** ou **ignorar** — e ignorar faz o item voltar
idêntico no dia seguinte, até o operador aprender a desconfiar da lista.

O adiamento é por **(cliente, gatilho)**: adiar a revisão de um caminhão não
silencia a cobrança de orçamento do mesmo cliente. São conversas diferentes, e
uma chave só por cliente juntaria as duas.

**Adiado sai da fila, nunca em silêncio.** `montarRegua` devolve
`fila.adiados`, a tela mostra a faixa *"2 contatos adiados por você. Eles voltam
sozinhos na data — não somem."* com a data e o botão *"Trazer de volta"*, e
`diagnosticarFilaVazia` checa `tudo_adiado` **antes de qualquer outra causa**.
Sem isso, quem adiou dez pessoas numa terça abriria a quinta-feira com uma tela
dizendo que não há trabalho.

Adiar de novo **substitui** em vez de empilhar — senão desfazer o de cima
revelaria outro embaixo, e o operador não teria como saber quantos ainda existem.
Adiamento vencido volta sozinho: a consulta filtra por `ate > agora`, e ninguém
precisa lembrar de desfazer.

---

## Diálogo do sistema, no lugar de `confirm()` e `prompt()`

Os nativos custavam quatro coisas, e as quatro apareceram aqui:

- **ignoram os cinco temas.** Num sistema desenhado para o balcão sob luz forte e
  para o plantão de madrugada, a caixa branca do Chrome é a única coisa na tela
  que não obedece;
- **não validam nada.** *"Pressão medida na bancada (bar)"* aceitava qualquer
  texto, e o valor ia para o laudo do jeito que foi digitado. Hoje é campo
  numérico com faixa 0–3000 conferida antes de sair do diálogo;
- **não mostram contexto.** *"Motivo da perda"* sem dizer **qual** oportunidade —
  e quem arrastou três cartões seguidos não sabe mais qual está respondendo. O
  diálogo carrega uma linha de contexto (`OS OS-02500 · Antônio Ribeiro`);
- alguns navegadores móveis os suprimem ou os empilham fora de ordem.

Motivo de perda virou **opção estruturada**, e não texto livre: *perdido por
preço* e *perdido por sumiço* são sinais opostos para o anúncio, e um campo
aberto vira trinta grafias da mesma coisa.

No celular o diálogo é folha de baixo — cola no rodapé, com
`env(safe-area-inset-bottom)`, e as opções passam a uma por linha.

---

## Rolagem travada atrás do que é modal

Rolar com o dedo sobre o véu movia a lista **atrás** da busca: a pessoa fechava e
a tela estava noutro lugar, sem ter pedido nada.

`travarRolagem()` **conta** em vez de ligar e desligar, porque os modais se
empilham — a busca abre por cima da ficha, e soltar o fundo ao fechar a busca
destravaria a tela com a ficha ainda aberta.

E `overflow: hidden` sozinho não bastava: encolher a altura rolável faz o
navegador jogar a página para o topo, de modo que abrir a busca no meio de uma
lista longa e fechá-la devolvia a pessoa ao começo. O corpo vai para
`position: fixed` deslocado pela rolagem guardada, o que congela a tela
exatamente onde ela estava — e a devolve ao fechar. Medido: 320 → travado → 320.

---

## Segunda passada no mobile — medida, não estimada

A primeira passada tratou do formato: tabela virou cartão, a navegação desceu
para o polegar. Uma auditoria das 18 telas a 375 px mostrou o que sobrou.

### O que a medição encontrou

| | Antes | Depois |
|---|---|---|
| Alvos abaixo de 44 px | **86 de 86** na régua | **0 de 230** nas 18 telas |
| Caixa de marcar | 17 × 17 px | 44 × 44 px |
| Primeiro item da fila | 693 px do topo | 368 px |
| Altura da régua | 9.637 px | 4.023 px |
| Altura da Central | 10.247 px | 3.786 px |
| Altura da auditoria | 7.564 px | 1.857 px |
| Cromo permanente | 220 px | 119 px |

### Alvo de dedo: 44 px

Apple e Google publicam 44 pt / 48 dp como mínimo. A ação **principal da tela
principal** — escolher quem recebe mensagem hoje — era um alvo de 17 px.

A caixa nativa não deixa separar o desenho do alvo: `padding` nela não estende
a área de toque de forma confiável. Passou a ser desenhada (`appearance: none`),
com o quadrado do tamanho que se enxerga e a caixa do tamanho que o dedo acerta.

O tique é um **L girado**, e não dois gradientes cruzados: cruzados desenham um
X, que lê como *excluído* — o oposto de selecionado. Foi assim que saiu na
primeira tentativa.

### A explicação sai da frente do trabalho

Na régua, 693 px de prosa antes do primeiro cliente: o parágrafo que explica a
tela, o aviso de demonstração e o resumo de bloqueios. Tudo verdadeiro, tudo
útil na primeira visita, tudo lido uma vez só.

No computador o texto não custa — fica na coluna e o trabalho aparece ao lado.
No celular ele empurra. Agora recolhe, com um toque para abrir.

Duas regras que o recolhimento respeita:

- **`.aviso.crit` nunca se recolhe.** Mensagem de erro atrás de um toque é erro
  escondido. O que se dobra é explicação.
- **O resumo herda o tom do bloco.** Pintar tudo de âmbar transformava o resumo
  neutro de *"por que 21 não saem"* num alerta — e alerta que não é alerta
  ensina a ignorar os que são.

### A ação desce para o polegar

A barra de disparo media 190 px empilhados **acima** da fila: empurrava o
trabalho e ainda ficava longe da mão. Foi para o rodapé, acima da navegação —
não no lugar dela, que prenderia a pessoa na régua.

Ociosa é uma linha de 63 px. O botão aparece quando há seleção: ele já nascia
`disabled` e não fazia nada com zero marcados, então 48 px permanentes eram
puro custo.

### Listas por partes

Oito itens, e um botão que diz quantos faltam. As linhas continuam no DOM (só
`hidden`), e não removidas: a busca do navegador e a leitura de tela dependem
delas estarem lá.

### Duas armadilhas que a medição pegou

**`[hidden]` perde para o componente.** O atributo vale como `display: none` só
na folha do navegador, e `.item { display: grid }` o atropela. A lista carimbou
`hidden` em treze itens e a página continuou com 9.744 px. Resolvido com
`[hidden] { display: none !important }` global.

**Girar o aparelho perdia dois terços da fila.** O observador de redimensionamento
vigiava só o corte de 820 px, mas as mudanças de DOM dependem do de **640**.
Indo de 600 para 700 px, treze itens continuavam escondidos e as dobras
permaneciam — sem nenhum aviso.

Agora são os dois cortes, por `matchMedia` e não por `resize`: no iPhone a barra
de endereço que recolhe ao rolar dispara `resize` a cada gesto, sem cruzar corte
nenhum, e cada um viraria uma re-renderização no meio da rolagem. E `renderShell`
sozinho não bastava — ele redesenha a casca e deixa o conteúdo com as marcas que
o celular criou; é `navegar()` que devolve a lista inteira.

### Detalhes menores

- O botão *"mais N campos"* estava **dentro do título** do cartão, anunciando
  campos logo acima dos que já estavam à vista. Foi para o fim, que é onde
  "mais" quer dizer o que ainda falta.
- A marca *"CRM MULTIEMPRESAS"* sai no celular; o nome da empresa ativa fica,
  com um ponto na cor dela. São três instâncias, e mandar mensagem achando que
  se está noutra empresa é o erro caro desta tela.
- Endereço em mono não quebrava e estourava o cartão de Canais em 181 px.
