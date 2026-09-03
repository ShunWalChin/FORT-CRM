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
