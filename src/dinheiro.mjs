/**
 * Dinheiro: inteiro em centavos, sempre. Nunca ponto flutuante.
 *
 * `0.1 + 0.2` vale `0.30000000000000004` em JavaScript, e um sistema que
 * fecha caixa com isso apresenta uma diferença de um centavo por mês que
 * ninguém consegue explicar — e que corrói a confiança no número inteiro.
 *
 * O sistema já guardava `valor_centavos integer` em toda tabela. O que faltava
 * era o lugar único que converte, soma e rateia — sem ele, cada tela reinventa
 * o `parseFloat` e o erro volta pela porta dos fundos.
 *
 * Três regras que este módulo existe para impor:
 *
 *   1. **A fronteira converte, o miolo não.** Texto vira centavos na entrada,
 *      centavos viram texto na saída. Entre as duas coisas só existe inteiro.
 *
 *   2. **Rateio não perde centavo.** Dividir R$ 100,00 em três não dá três
 *      parcelas de 33,33 — dá 33,34 + 33,33 + 33,33. A sobra vai para a
 *      primeira parcela, e a soma das partes é sempre igual ao todo.
 *
 *   3. **Estouro falha alto.** Acima de `Number.MAX_SAFE_INTEGER` a soma passa
 *      a mentir em silêncio. Aqui ela levanta.
 */

/** R$ 90.071.992,54 — o teto seguro do inteiro do JavaScript, em centavos. */
export const TETO = Number.MAX_SAFE_INTEGER;

export class ErroDeDinheiro extends Error {}

/**
 * Confere que o valor é centavo de verdade: inteiro, finito, dentro do teto.
 *
 * Aceitar `1050.5` centavos seria aceitar meio centavo — que não existe, e que
 * mais tarde vira arredondamento onde ninguém procura.
 */
export function centavos(valor, campo = 'valor') {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new ErroDeDinheiro(`${campo}: não é número (${JSON.stringify(valor)})`);
  }
  if (!Number.isInteger(valor)) {
    throw new ErroDeDinheiro(`${campo}: centavo não se divide (${valor})`);
  }
  if (Math.abs(valor) > TETO) {
    throw new ErroDeDinheiro(`${campo}: acima do inteiro seguro (${valor})`);
  }
  return valor;
}

/**
 * Texto do teclado brasileiro para centavos.
 *
 * Aceita "1.650,00", "1650,00", "1650.00", "R$ 1.650", "-45,90". O ponto só é
 * separador de milhar quando vem seguido de exatamente três dígitos até o fim
 * ou até a vírgula — é o que distingue "1.650" (mil e seiscentos e cinquenta)
 * de "1.65" (um e sessenta e cinco), e errar isso é errar por mil vezes.
 */
export function paraCentavos(entrada, campo = 'valor') {
  if (typeof entrada === 'number') return centavos(Math.round(entrada * 100), campo);
  if (entrada == null || entrada === '') return null;

  let t = String(entrada).trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '');
  if (!t) return null;

  const negativo = /^-/.test(t) || /^\(.*\)$/.test(t);
  t = t.replace(/^-/, '').replace(/^\((.*)\)$/, '$1');

  if (t.includes(',')) {
    // Vírgula presente: ela é o decimal, e todo ponto é milhar.
    t = t.replace(/\./g, '').replace(',', '.');
  } else {
    // Sem vírgula: ponto de milhar só se separar grupos de exatamente três.
    const milhar = /^\d{1,3}(\.\d{3})+$/;
    if (milhar.test(t)) t = t.replace(/\./g, '');
  }

  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') {
    throw new ErroDeDinheiro(`${campo}: valor ilegível (${JSON.stringify(entrada)})`);
  }

  const [inteira, decimal = ''] = t.split('.');
  if (decimal.length > 2) {
    throw new ErroDeDinheiro(`${campo}: centavo não se divide (${JSON.stringify(entrada)})`);
  }
  const total = Number(inteira || '0') * 100 + Number(decimal.padEnd(2, '0') || '0');
  return centavos(negativo ? -total : total, campo);
}

/** Centavos para o texto que o brasileiro lê: 165000 → "1.650,00". */
export function formatar(valor, { sinal = false, moeda = false } = {}) {
  if (valor == null) return '';
  const v = centavos(valor);
  const neg = v < 0;
  const abs = Math.abs(v);
  const reais = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const corpo = `${reais.toLocaleString('pt-BR')},${cents}`;
  const prefixo = moeda ? 'R$ ' : '';
  if (neg) return `${prefixo}-${corpo}`;
  return `${sinal ? '+' : ''}${prefixo}${corpo}`;
}

/** Soma que levanta no estouro em vez de mentir. */
export function somar(...valores) {
  let total = 0;
  for (const v of valores.flat()) {
    total += centavos(v ?? 0);
    if (Math.abs(total) > TETO) throw new ErroDeDinheiro('soma acima do inteiro seguro');
  }
  return total;
}

/**
 * Reparte um total em partes proporcionais, sem perder nem inventar centavo.
 *
 * O método é o do maior resto: cada parte fica com o piso da sua fração, e os
 * centavos que sobraram do arredondamento são distribuídos um a um, começando
 * por quem tinha o maior resto. A soma das partes é IGUAL ao total, sempre —
 * e é isso que impede o rateio de um custo de virar diferença no fechamento.
 */
export function ratear(total, pesos) {
  const t = centavos(total, 'total');
  const ps = pesos.map((p, i) => centavos(Math.round(p), `peso[${i}]`));
  const soma = ps.reduce((a, b) => a + b, 0);

  if (soma <= 0) throw new ErroDeDinheiro('rateio sem peso: a divisão seria por zero');
  if (!ps.length) return [];

  const bruto = ps.map((p) => (t * p) / soma);
  const partes = bruto.map((x) => Math.trunc(x));
  let resto = t - partes.reduce((a, b) => a + b, 0);

  // Quem tem o maior resto recebe o centavo primeiro. Empate desempata pela
  // ordem, para o rateio ser reproduzível — dois cálculos iguais, saída igual.
  const ordem = bruto
    .map((x, i) => ({ i, frac: x - Math.trunc(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const passo = resto >= 0 ? 1 : -1;
  for (let k = 0; resto !== 0; k += 1) {
    partes[ordem[k % ordem.length].i] += passo;
    resto -= passo;
  }
  return partes;
}

/** Percentual sobre um valor, arredondado ao centavo. 1000 a 7,5% → 75. */
export function percentual(valor, taxa) {
  const v = centavos(valor);
  if (typeof taxa !== 'number' || !Number.isFinite(taxa)) {
    throw new ErroDeDinheiro(`taxa inválida (${taxa})`);
  }
  return Math.round((v * taxa) / 100);
}
