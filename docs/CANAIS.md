# Canais de entrada de lead

> Por onde o cliente de cada empresa chega, e quanto disso dá para medir.

## Temas, canais de entrada e refatoração de menus

### Cinco temas, cada um por um contexto de uso

`web/temas.css`. A mesma tela é olhada num balcão de peças sob luz
fluorescente, numa varanda de fazenda ao sol e num plantão de guincho às três
da manhã — nenhuma paleta serve às três.

| Tema | Para |
|---|---|
| **Cockpit** | Escuro, o padrão. Demonstração e uso noturno. |
| **Oficina** | Claro industrial. Balcão sob luz forte, onde o tema escuro vira espelho. |
| **Cerrado** | Claro quente. Tela vista sob sol. |
| **Papel** | Contraste máximo, corpo em serifa, um ponto maior. Vista cansada, sol direto, impressão. |
| **Meia-noite** | Escuro quente, pouco azul. Plantão de madrugada. |

O acento continua sendo a **cor da empresa** — o sinal de canto de olho contra
registrar na empresa errada. Nos temas claros ele é escurecido com
`color-mix(in oklab, …)`: o ciano #00b8c4 da Minas Peças sobre fundo claro dá
1,9:1, ilegível.

**Contraste medido, não estimado.** Nos cinco temas todo texto passa de 4,5:1;
o pior caso ficou em 4,9:1. Duas armadilhas no caminho, as duas minhas:
`getComputedStyle` devolve `oklab(…)` para valores vindos de `color-mix`, e
calcular luminância em cima daqueles números como se fossem RGB dá resultado
sem sentido — a medição certa é pintar num `canvas` e ler o pixel. E
`scrollWidth > clientWidth` não prova rolagem lateral: 15 px de diferença no
desktop era a barra.

O tema é aplicado por um script no `<head>`, antes da primeira pintura. Em
`app.js`, que é módulo e portanto adiado, a página já teria sido pintada uma
vez — quem escolheu "Papel" veria a tela nascer preta e clarear.

### Canais de entrada — o que estava errado

**As três empresas dividiam a mesma lista de origens.** `guincho_24h` e
`site_diagnostico` — canais de oficina de injeção — apareciam na fazenda de
queijo e na loja de tintas. Origem errada leva a decidir verba errada.

**E origem e atribuição eram sorteadas de forma independente**, o que produzia
cliente com `origem: 'balcao'` carregando `gclid`. Quem entrou pela porta não
clicou em anúncio.

`src/canais.mjs` passa a ter catálogo por empresa — 11 canais na Minas Peças,
10 na Agrofort, 10 na Fort Tintas — cada um declarando **se carrega parâmetro
de clique**. Esse campo é o divisor de águas da conversão offline: o que não é
atribuível nunca vai render conversão importada, por mais correto que esteja o
resto do pipeline. Daí a pergunta "como você chegou até a gente?" na tela de
canais: em balcão, telefone, guincho e indicação ela é a **única** atribuição
possível, e sem ela a campanha que funciona aparece com retorno zero e é a
primeira a ser cortada.

### A porta de entrada não existia

`POST /api/central/entrada` estava documentado como "porta de entrada de lead
externo (formulário, anúncio, parceiro)" e chamava `contexto()` — ou seja,
**exigia sessão**. Um formulário de site não faz login. Na prática o CRM não
tinha por onde receber lead.

`POST /api/entrada/:chave` é pública de verdade. O que a mantém segura, já que
é a única escrita anônima do sistema:

- a chave só **roteia** — não lê, não lista, não vira sessão. Colada no HTML
  público do cliente, que é onde precisa estar, o pior uso é mandar lead falso;
- **20 requisições por minuto** por origem, e o corpo para em 1 MB;
- a resposta é **idêntica** para chave válida, inválida, desativada e para
  tentativa de travessia de caminho — verificado. Variar transformaria a porta
  num oráculo de enumeração;
- o lead cai na **triagem da Central**. Nenhuma instância de empresa é exposta
  a tráfego externo.

A tela "Canais de entrada" entrega o formulário pronto para colar, que captura
`gclid`, `fbclid` e UTMs no instante da chegada — depois disso o parâmetro de
clique já se perdeu.

### Menus e botões

- **Um botão só, com variantes** (`quiet`, `ghost`, `sutil`, `perigo`, `sm`,
  `bloco`, `icone`). Antes havia `.btn` mais `style="width:100%"` espalhado e
  alturas de 30 a 40 px conforme o padding herdado — alvos de toque diferentes
  para ações equivalentes. Piso de 38 px, 32 px nos `.sm`.
- **Foco visível em tudo que recebe teclado.** O CSS anterior fazia
  `outline: none` e sinalizava foco só mudando a cor da borda — em "Papel" e
  "Oficina" isso é quase imperceptível, e quem navega por Tab ficava perdido.
- **Ícones SVG escritos à mão**, não fonte de ícone nem CDN: o sistema roda
  atrás de um túnel, num servidor sem garantia de saída para a internet, e
  `currentColor` faz o ícone acompanhar os cinco temas sem uma linha a mais.
- **Ativo no menu vira barra à esquerda** em vez de moldura, que competia com
  o cartão selecionado da régua.
- **Filtro de telas** aparece quando o menu passa de doze itens: o operador vê
  11 e não precisa; a direção vê 17 em cinco grupos e é o caminho mais curto.
- `prefers-reduced-motion` respeitado.

---
