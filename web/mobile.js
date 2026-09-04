/**
 * Comportamento da versão mobile.
 *
 * Duas peças, e as duas existem por medição, não por gosto:
 *
 * 1. `rotularTabelas` carimba em cada `<td>` o texto do `<th>` da coluna. É o
 *    que permite ao CSS transformar tabela em cartão sem reescrever nenhuma
 *    das onze telas que têm tabela — e sem duplicar os cabeçalhos em dois
 *    lugares, que é como eles passariam a divergir.
 *
 * 2. A navegação de rodapé, porque o polegar alcança a base da tela. Menu
 *    atrás de um botão no alto custa dois toques e uma rolagem para tudo.
 *
 * O ponto de corte é 820 px, o mesmo do CSS. Um só número, para que layout e
 * comportamento nunca discordem sobre o que é celular.
 */

import { icone } from './ui.js';

/*
 * Dois cortes, duas perguntas.
 *
 * `CORTE_MOBILE` (820) é sobre o FORMATO DA JANELA: a lateral não cabe ao lado
 * do conteúdo e o polegar precisa da barra de baixo. Vale para tablet deitado.
 *
 * `CORTE_COMPACTO` (640) é sobre a LARGURA DO CONTEÚDO: abaixo disso a tabela
 * deixa de ser legível e vira cartão. Acima, ela cabe — a 812 px a de Clientes
 * rola um pouco; a 375 px esconde 593 px, que é outra coisa.
 */
export const CORTE_MOBILE = 820;
export const CORTE_COMPACTO = 640;

export function ehMobile() {
  return window.matchMedia(`(max-width: ${CORTE_MOBILE}px)`).matches;
}

/** Abaixo daqui a tabela vira cartão e a régua se compacta. */
export function ehCompacto() {
  return window.matchMedia(`(max-width: ${CORTE_COMPACTO}px)`).matches;
}

/**
 * As quatro coisas que se faz de celular.
 *
 * A escolha veio do uso real, não do organograma do menu: o atendente com o
 * cliente na frente quer a fila de hoje, achar alguém, mexer no funil. Painel,
 * auditoria e conversões são trabalho de mesa e ficam em "Mais".
 *
 * `Hoje` no lugar de `Painel` como primeira aba é deliberado — no celular a
 * pergunta é "com quem eu falo agora", não "como foi o mês".
 */
export const ABAS = [
  // Inicio primeiro: e a tela que ensina o que o sistema faz. `Hoje` fica ao
  // lado, para quem ja sabe continuar a um toque da fila.
  { id: 'inicio', nome: 'Inicio', ic: 'painel' },
  { id: 'regua', nome: 'Hoje', ic: 'regua', contador: 'regua' },
  { id: 'clientes', nome: 'Clientes', ic: 'clientes' },
  { id: '__mais', nome: 'Mais', ic: 'catalogo' },
];

/**
 * Carimba `data-rot` em cada célula, lendo o cabeçalho da coluna.
 *
 * Roda depois de cada renderização. É idempotente: reprocessar a mesma tabela
 * não muda nada, o que importa porque algumas telas redesenham em pedaços.
 *
 * `colSpan` é respeitado — sem isso, uma linha com célula mesclada empurraria
 * todos os rótulos seguintes uma coluna para a direita, e o cartão passaria a
 * mentir sobre o que cada valor é.
 */
export function rotularTabelas(raiz = document) {
  for (const tabela of raiz.querySelectorAll('table')) {
    const cabecalhos = [...tabela.querySelectorAll('thead th')]
      .map((th) => th.textContent.trim());
    if (!cabecalhos.length) continue;

    for (const linha of tabela.querySelectorAll('tbody tr')) {
      let coluna = 0;
      for (const celula of linha.children) {
        const rotulo = cabecalhos[coluna];
        if (rotulo) celula.setAttribute('data-rot', rotulo);
        coluna += celula.colSpan || 1;
      }
      if (ehCompacto()) porLinhaMobile(linha);
    }
  }
}

/**
 * Botão de expandir, para a linha que tem mais de três campos.
 *
 * Só no celular, e só quando há o que esconder. O toque no botão NÃO pode
 * disparar o clique da linha: em Clientes a linha abre a ficha, e quem quer
 * espiar mais um campo acabaria numa tela diferente da que pediu.
 */
function porLinhaMobile(linha) {
  const celulas = [...linha.children];
  if (celulas.length <= 3) return;
  if (linha.querySelector('.abrir-linha')) return;

  // Conta só o que o resumo de fato esconde. Célula de ação continua visível,
  // e incluí-la faria o botão prometer um campo a mais do que revela.
  const quantos = celulas.slice(3)
    .filter((c) => c.getAttribute('data-rot') && !c.querySelector('.btn')).length;
  if (!quantos) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'abrir-linha';
  b.setAttribute('aria-expanded', 'false');
  b.innerHTML = `<span class="rotulo">mais ${quantos} campo${quantos > 1 ? 's' : ''}</span>`
    + '<span class="seta">▼</span>';

  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    const aberto = linha.classList.toggle('aberto');
    b.setAttribute('aria-expanded', String(aberto));
    b.querySelector('.rotulo').textContent = aberto
      ? 'menos'
      : `mais ${quantos} campo${quantos > 1 ? 's' : ''}`;
  });

  celulas[0].appendChild(b);
}

/**
 * Desenha a navegação de polegar. Vive fora da lateral: a lateral recolhe, e a
 * navegação principal não pode recolher junto.
 */
export function desenharNavBaixo({ rotaAtual, contadores = {}, aoAbrirMais }) {
  let nav = document.querySelector('.nav-baixo');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'nav-baixo';
    nav.setAttribute('aria-label', 'Navegação principal');
    document.body.appendChild(nav);
  }

  nav.innerHTML = ABAS.map((a) => {
    const n = a.contador ? contadores[a.contador] : null;
    const ativo = a.id === rotaAtual;
    const alvo = a.id === '__mais' ? '#' : `#/${a.id}`;
    return `<a href="${alvo}" data-aba="${a.id}" class="${ativo ? 'on' : ''}"
               ${ativo ? 'aria-current="page"' : ''}>
      ${icone(a.ic)}
      <span>${a.nome}</span>
      ${n ? `<span class="contador">${n > 99 ? '99+' : n}</span>` : ''}
    </a>`;
  }).join('');

  // Delegação: o `innerHTML` acima é reescrito a cada navegação, e listener
  // preso a elemento morre junto. Foi assim que o menu do celular parou de
  // fechar antes.
  if (!nav.dataset.ligado) {
    nav.dataset.ligado = '1';
    nav.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-aba]');
      if (!a) return;
      if (a.dataset.aba === '__mais') {
        ev.preventDefault();
        aoAbrirMais();
      }
    });
  }
  return nav;
}

export function removerNavBaixo() {
  document.querySelector('.nav-baixo')?.remove();
}

/**
 * Rola a lista para o item ativo do kanban depois de trocar de etapa.
 * Sem isto, mover um cartão no celular deixa a tela na coluna antiga e parece
 * que nada aconteceu.
 */
export function revelarColuna(etapa) {
  if (!ehMobile()) return;
  const col = document.querySelector(`.coluna[data-etapa="${etapa}"]`);
  col?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
}

/**
 * Faz a mensagem crescer conforme se digita.
 *
 * No celular o campo nasce com 50 px — duas linhas, o bastante para reconhecer
 * a mensagem sem gastar 100 px por item numa lista de 22. Mas digitar dentro de
 * uma caixa de duas linhas que não cresce é ruim, e depender só de `:focus`
 * para abrir deixa o campo do tamanho errado assim que o texto passa do que
 * cabe.
 *
 * Delegação em `document`, e não listener por campo: a régua é redesenhada a
 * cada navegação e a cada disparo, e listener preso ao elemento morre junto.
 */
export function ligarAutoCrescer() {
  const crescer = (ta) => {
    if (!ta.classList.contains('editavel')) return;
    if (!ehCompacto()) { ta.style.height = ''; return; }
    ta.style.height = 'auto';
    // Teto para o campo não empurrar a lista inteira quando alguém colar um
    // texto longo; daí em diante ele rola por dentro.
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 260)}px`;
  };

  document.addEventListener('input', (ev) => {
    if (ev.target.matches?.('textarea.mensagem')) crescer(ev.target);
  });
  document.addEventListener('focusin', (ev) => {
    if (ev.target.matches?.('textarea.mensagem')) crescer(ev.target);
  });
  /*
   * Ao sair, o campo NÃO volta a encolher.
   *
   * Era o que eu tinha feito primeiro, para a lista não ficar cheia de campos
   * abertos. Mas quem editou o texto quer continuar vendo o que escreveu — e
   * editar já marca a linha para envio. Encolher ali esconde justamente a
   * mensagem que a pessoa acabou de ajustar, e o sistema pareceria ter
   * descartado o trabalho dela.
   *
   * Só volta ao tamanho de leitura quando o texto não foi tocado.
   */
  document.addEventListener('focusout', (ev) => {
    const ta = ev.target;
    if (!ta.matches?.('textarea.mensagem') || !ehCompacto()) return;
    if (ta.dataset.editado === '1') return;
    ta.style.height = '';
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.matches?.('textarea.mensagem')) ev.target.dataset.editado = '1';
  });
}
