/**
 * Peças de interface compartilhadas: ícones e temas.
 *
 * Ícones são SVG inline, escritos à mão, e não uma fonte de ícones nem um
 * pacote de CDN. Três motivos, nesta ordem:
 *
 *   1. o sistema roda atrás de um túnel, num servidor sem garantia de saída
 *      para a internet — qualquer CDN vira ícone quebrado justo no cliente;
 *   2. fonte de ícone pede download de arquivo binário e, no meio do caminho,
 *      mostra retângulo vazio ou a letra crua;
 *   3. `currentColor` faz o ícone acompanhar os cinco temas sem uma linha a
 *      mais. Um PNG teria de existir cinco vezes.
 *
 * Emoji foi descartado: renderiza diferente em cada sistema, muda de tamanho
 * no meio da lista e dá ao painel um ar de brinquedo que não combina com a
 * tela onde alguém decide mandar mensagem para 40 clientes.
 */

const P = {
  manual: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>',
  painel: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.2"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.2"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.2"/>',
  regua: '<path d="M4 18.5 4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8z"/><path d="M8 10.5h8M8 13.5h5"/>',
  clientes: '<circle cx="9.5" cy="8.5" r="3"/><path d="M3.5 19.5a6 6 0 0 1 12 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a6 6 0 0 0-2.2-4.7"/>',
  pipeline: '<rect x="3.5" y="4.5" width="5" height="15" rx="1.2"/><rect x="10.5" y="4.5" width="5" height="10" rx="1.2"/><rect x="17.5" y="4.5" width="3" height="7" rx="1.2"/>',
  frota: '<path d="M3.5 16.5v-4l2-4.5h9l2 4.5h2a2 2 0 0 1 2 2v2z"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  ordens: '<path d="M9 4.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2H15"/><rect x="9" y="2.8" width="6" height="3.4" rx="1"/><path d="M8.5 12l2 2 4.5-4.5"/>',
  pedidos: '<path d="M3.5 5.5h2l2.2 9.6a2 2 0 0 0 2 1.6h7.5a2 2 0 0 0 2-1.5L20.5 9H7"/><circle cx="10" cy="20" r="1.3"/><circle cx="17.5" cy="20" r="1.3"/>',
  catalogo: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>',
  canais: '<path d="M12 3.5v6M12 14.5v6"/><circle cx="12" cy="12" r="2.5"/><path d="M5 6.5 9.8 10M18.8 6.5 14.2 10M5 17.5 9.8 14M18.8 17.5 14.2 14"/>',
  atribuicao: '<path d="M3.5 20.5 9 12l4 4 7.5-10.5"/><path d="M15.5 5.5h5v5"/>',
  conversoes: '<path d="M4 8.5h12l-3-3M20 15.5H8l3 3"/>',
  central: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.4 7.4 10 10.2M17.6 7.4 14 10.2M6.4 16.6 10 13.8M17.6 16.6 14 13.8"/>',
  grupo: '<path d="M3.5 20.5V13M9 20.5V7M14.5 20.5v-9M20 20.5V4"/>',
  gatilhos: '<path d="M13 3 5.5 13.5H11l-1 7.5L18.5 10H13z"/>',
  disparos: '<path d="M3.5 12h4l2.5-6 4 12 2.5-6h4"/>',
  auditoria: '<path d="M5 4.5h9l5 5v10a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19.5v-14A1.5 1.5 0 0 1 5 4.5z"/><path d="M13.5 4.5V10h5"/><path d="M8 14l2.2 2.2L15 11.5"/>',
  importar: '<path d="M12 15.5V3.5M8 11.5l4 4 4-4"/><path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  busca: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  copiar: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
  zap: '<path d="M3.5 20.5 5 16.2A8 8 0 1 1 8.2 19.4z"/>',
  sair: '<path d="M14 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h8"/><path d="M17 8.5l3.5 3.5L17 15.5M9.5 12h11"/>',
  tema: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.4 2"/>',
};

/** SVG de um ícone. Volta string vazia se o nome não existir — nunca quebra. */
export function icone(nome, extra = '') {
  const d = P[nome];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
}

/* ── Temas ────────────────────────────────────────────────────────────────── */

/**
 * Os cinco temas. Cada um responde a um contexto de uso, não a um gosto:
 * a mesma tela é olhada num balcão sob luz fluorescente, numa varanda de
 * fazenda ao sol e num plantão de madrugada, e nenhuma paleta serve às três.
 *
 * `amostra` é a bolinha do seletor — a cor de fundo do próprio tema, para que
 * a escolha se explique sozinha sem precisar de legenda.
 */
export const TEMAS = [
  { id: 'cockpit', nome: 'Cockpit', para: 'Escuro. Demonstração e uso noturno.', amostra: '#06060e' },
  { id: 'oficina', nome: 'Oficina', para: 'Claro industrial. Balcão sob luz forte.', amostra: '#eceae4' },
  { id: 'cerrado', nome: 'Cerrado', para: 'Claro quente. Tela vista sob sol.', amostra: '#f4efe2' },
  { id: 'papel', nome: 'Papel', para: 'Contraste máximo, corpo em serifa. Vista cansada e impressão.', amostra: '#ffffff' },
  { id: 'meia-noite', nome: 'Meia-noite', para: 'Escuro quente, pouco azul. Plantão 24 h.', amostra: '#14110f' },
];

export const TEMA_PADRAO = 'cockpit';
const CHAVE = 'fortcrm.tema';

export function temaAtual() {
  try {
    const salvo = localStorage.getItem(CHAVE);
    return TEMAS.some((t) => t.id === salvo) ? salvo : TEMA_PADRAO;
  } catch {
    // Navegador com armazenamento bloqueado (janela anônima, política de
    // empresa) lança em vez de devolver null. O tema é conveniência: perder a
    // preferência é aceitável, a tela não abrir não é.
    return TEMA_PADRAO;
  }
}

export function aplicarTema(id) {
  const valido = TEMAS.some((t) => t.id === id) ? id : TEMA_PADRAO;
  document.documentElement.dataset.tema = valido;
  try { localStorage.setItem(CHAVE, valido); } catch { /* sem persistência */ }
  return valido;
}

/** O seletor: cinco botões, com o nome do tema no `title` e em `aria-label`. */
export function desenharSeletorDeTema() {
  const atual = temaAtual();
  return `<div class="temas" role="group" aria-label="Tema de cores">
    ${TEMAS.map((t) => `
      <button class="tema-btn" data-tema="${t.id}"
              aria-pressed="${t.id === atual}"
              title="${t.nome} — ${t.para}"
              aria-label="Tema ${t.nome}. ${t.para}">
        <i style="background:${t.amostra}"></i>
      </button>`).join('')}
  </div>`;
}
