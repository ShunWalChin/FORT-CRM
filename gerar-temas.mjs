/**
 * Gera os temas de dupla a partir das duas cores de cada combinação.
 *
 * Escrever 9 temas × 23 tokens à mão seria 207 valores escolhidos um a um, e
 * cada erro só apareceria numa tela específica de um tema específico. Aqui a
 * REGRA é escrita uma vez, aplicada nove vezes, e a mesma regra mede o que
 * produziu — nenhum tema sai daqui sem passar no contraste.
 *
 * ═══ O que a primeira versão me ensinou ═══
 *
 * Comecei com "o mais luminoso da dupla é o fundo", que é como os cartões estão
 * desenhados. Medido: 5 de 9 passaram. As quatro falhas dizem a mesma coisa —
 * **um cartaz não é uma interface**.
 *
 * O cartaz tem dois campos grandes e três palavras. A interface precisa de
 * corpo, texto auxiliar, borda, e de dizer "atenção" e "crítico" por cima de
 * tudo isso. São oito níveis distinguíveis, não dois.
 *
 *   - Vulcânico pôs o laranja #FF4103 como chapa, e sobre ela o vermelho de
 *     crítico ficou em 1,09:1. Invisível.
 *   - Mantis pôs o verde #59C749 como corpo sobre creme: 1,95:1.
 *
 * ═══ A regra corrigida ═══
 *
 *   1. O FUNDO É O MAIS QUIETO. Chapa de página tem de recuar; cor saturada de
 *      luminosidade média não recua, ela briga com tudo que se põe em cima.
 *      Escolho por croma baixo, e desempato pela luminosidade mais extrema.
 *
 *   2. A TINTA CEDE ATÉ PASSAR. A outra cor é empurrada em direção ao polo
 *      oposto do fundo até bater 5:1. Um verde-Mantis escurecido continua sendo
 *      da família Mantis; um ilegível não é nada.
 *
 *   3. A SEMÂNTICA TAMBÉM CEDE. Verde, âmbar e vermelho são ajustados contra o
 *      fundo daquele tema até 3:1. Não saem da dupla: uma combinação de duas
 *      cores não tem como dizer "atenção" e "crítico" ao mesmo tempo.
 *
 * O acento continua sendo `--empresa-cor`, e não a cor da dupla. É o sinal
 * periférico de qual empresa está na tela — a defesa mais barata contra
 * registrar algo na errada, e nenhum tema tem licença para apagá-la.
 */

const COMBOS = [
  { id: 'nupcial', nome: 'Nupcial', n: 10, a: '#FFC6A8', b: '#741A2F', na: 'Skin Tone', nb: 'Bridal' },
  { id: 'vulcanico', nome: 'Vulcânico', n: 9, a: '#FF4103', b: '#001621', na: 'Vulcanico', nb: 'Noturno' },
  { id: 'musgo', nome: 'Musgo', n: 8, a: '#2BEE34', b: '#141414', na: 'Luminous Moss', nb: 'Silver' },
  { id: 'curcuma', nome: 'Cúrcuma', n: 7, a: '#FFBE0B', b: '#2A2312', na: 'Turmeric', nb: 'Malt' },
  { id: 'mantis', nome: 'Mantis', n: 6, a: '#59C749', b: '#FFFDF1', na: 'Mantis', nb: 'Milky' },
  { id: 'copa', nome: 'Copa', n: 5, a: '#E4FD97', b: '#2D3E2C', na: 'Lime Sprout', nb: 'Fresh Canopy' },
  { id: 'cipreste', nome: 'Cipreste', n: 4, a: '#004741', b: '#F0EDE4', na: 'Cyprus', nb: 'Sand' },
  { id: 'cyber', nome: 'Cyber', n: 3, a: '#B6FF00', b: '#3C1A47', na: 'Cyber Line', nb: 'Charcoal Violet' },
  { id: 'pink', nome: 'True Pink', n: 2, a: '#FD1843', b: '#FFF9FA', na: 'True Pink', nb: 'Chill White' },
];

/* ── Cor ─────────────────────────────────────────────────────────────────── */

const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))
  .toString(16).padStart(2, '0')).join('')}`;

const luz = (c) => {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contraste = (a, b) => {
  const [l1, l2] = [luz(a), luz(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/** Croma grosseiro: distância entre o canal mais forte e o mais fraco. */
const croma = (c) => { const v = rgb(c); return (Math.max(...v) - Math.min(...v)) / 255; };

const mix = (a, b, pct) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * (pct / 100)));

/**
 * Empurra `cor` na direção de `polo` até alcançar `alvo` de contraste contra
 * `fundo`. Devolve o primeiro passo que passa — não o mais escuro possível,
 * para a cor ceder o mínimo e continuar reconhecível.
 */
function atePassar(cor, fundo, alvo, polo) {
  if (contraste(cor, fundo) >= alvo) return cor;
  for (let pct = 5; pct <= 95; pct += 5) {
    const tentativa = mix(cor, polo, pct);
    if (contraste(tentativa, fundo) >= alvo) return tentativa;
  }
  return polo;
}

/* ── A regra ─────────────────────────────────────────────────────────────── */

function tema(c) {
  // 1. O fundo é o mais quieto: menor croma, desempate pela luminosidade extrema.
  const extremo = (x) => Math.abs(luz(x) - 0.5);
  const aFundo = croma(c.a) < croma(c.b) - 0.08 ? true
    : croma(c.b) < croma(c.a) - 0.08 ? false
      : extremo(c.a) > extremo(c.b);
  const fundo = aFundo ? c.a : c.b;
  const viva = aFundo ? c.b : c.a;

  // Os nomes seguem a escolha, e nao a ordem em que foram escritos. Nos nove
  // combos `b` virou fundo em todos, o que faz "na sobre nb" acertar por acaso;
  // um decimo em que `a` ganhasse o fundo sairia com o rotulo invertido.
  const nomeFundo = aFundo ? c.na : c.nb;
  const nomeTinta = aFundo ? c.nb : c.na;

  const escuro = luz(fundo) < 0.4;
  const polo = escuro ? '#ffffff' : '#000000';
  const antipolo = escuro ? '#000000' : '#ffffff';

  // 2. A tinta cede até passar. 5:1 dá folga sobre o mínimo de 4,5.
  const tinta = atePassar(viva, fundo, 5, polo);

  const sup = (pct) => mix(fundo, polo, pct);

  // 3. A semântica também cede, contra o fundo deste tema.
  const base = escuro
    ? { ok: '#35d6a4', warn: '#e8a33d', crit: '#ff4d6d' }
    : { ok: '#127a4f', warn: '#8a5300', crit: '#b3123c' };
  const sem = Object.fromEntries(
    Object.entries(base).map(([k, v]) => [k, atePassar(v, fundo, 3.2, polo)]),
  );

  return {
    ...c,
    nomeFundo,
    nomeTinta,
    escuro,
    tokens: {
      ground: fundo,
      surface: sup(4),
      'surface-2': sup(7),
      'surface-3': sup(11),
      line: sup(17),
      'line-strong': sup(30),

      txt: atePassar(mix(tinta, fundo, 10), fundo, 4.5, polo),
      'txt-hi': tinta,
      dim: atePassar(mix(tinta, fundo, 35), fundo, 4.0, polo),
      faint: atePassar(mix(tinta, fundo, 45), fundo, 3.4, polo),

      ...sem,
      'sobre-ok': antipolo === '#000000' ? mix(fundo, '#000000', 55) : '#ffffff',
      'sobre-warn': antipolo === '#000000' ? mix(fundo, '#000000', 55) : '#ffffff',
      'sobre-crit': escuro ? mix(fundo, '#000000', 55) : '#ffffff',

      acento: escuro
        ? 'var(--empresa-cor, #00b8c4)'
        : 'color-mix(in oklab, var(--empresa-cor, #00b8c4) 58%, #000)',
      'sobre-acento': escuro ? mix(fundo, '#000000', 50) : '#ffffff',

      veu: escuro ? 'rgba(0, 0, 0, .74)' : `rgba(${rgb(mix(tinta, '#000000', 45)).join(', ')}, .55)`,
      sombra: escuro ? '0 18px 44px rgba(0, 0, 0, .5)' : '0 14px 34px rgba(40, 35, 30, .18)',
    },
  };
}

/* ── Saída e prova ───────────────────────────────────────────────────────── */

const temas = COMBOS.map(tema);

console.log('  tema         fundo    tinta    corpo   dim   faint   ok   warn  crit');
console.log(`  ${'-'.repeat(72)}`);
let reprovados = 0;
for (const t of temas) {
  const g = t.tokens.ground;
  const m = {
    corpo: contraste(t.tokens.txt, g),
    dim: contraste(t.tokens.dim, g),
    faint: contraste(t.tokens.faint, g),
    ok: contraste(t.tokens.ok, g),
    warn: contraste(t.tokens.warn, g),
    crit: contraste(t.tokens.crit, g),
  };
  const min = { corpo: 4.5, dim: 4.0, faint: 3.4, ok: 3.2, warn: 3.2, crit: 3.2 };
  const ruim = Object.entries(m).filter(([k, v]) => v < min[k] - 0.01);
  if (ruim.length) reprovados += 1;
  console.log(`  ${t.id.padEnd(12)} ${g}  ${t.tokens['txt-hi']}  `
    + [m.corpo, m.dim, m.faint, m.ok, m.warn, m.crit]
      .map((v) => v.toFixed(2).padStart(5)).join(' ')
    + (ruim.length ? `  ← ${ruim.map(([k]) => k).join(',')}` : ''));
}
console.log(`\n  ${temas.length - reprovados} de ${temas.length} passam`);

if (process.argv.includes('--escrever')) {
  const { writeFileSync } = await import('node:fs');
  const css = temas.map((t) => {
    const linhas = Object.entries(t.tokens).map(([k, v]) => `  --${k}: ${v};`).join('\n');
    return `/* Combo ${String(t.n).padStart(2, '0')} — ${t.nomeTinta} sobre ${t.nomeFundo}. */
[data-tema="${t.id}"] {
  color-scheme: ${t.escuro ? 'dark' : 'light'};
${linhas}

  --sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --corpo: var(--sans);
  --corpo-tam: 15px;
  --corpo-altura: 1.55;
}`;
  }).join('\n\n');
  writeFileSync('temas-dupla.css', css, 'utf8');

  /*
   * A ficha do seletor mostra a DUPLA, e nao so o fundo.
   *
   * Um ponto de 14 px com `#141414` (Musgo) e outro com `#001621` (Vulcanico)
   * sao indistinguiveis. Dividido em duas metades, cada tema fica reconhecivel
   * pela combinacao — que e o que a pessoa esta escolhendo.
   */
  const lista = temas.map((t) => `  { id: '${t.id}', nome: '${t.nome}', `
    + `para: '${t.nomeTinta} sobre ${t.nomeFundo}.', amostra: '${t.tokens.ground}', `
    + `tinta: '${t.tokens['txt-hi']}', dupla: true },`).join('\n');
  writeFileSync('temas-dupla.js', lista, 'utf8');
  console.log('\n  escrito: temas-dupla.css e temas-dupla.js');
}
