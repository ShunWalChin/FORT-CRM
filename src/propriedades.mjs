/**
 * Registro de propriedades — campos do sistema e campos que a empresa cria.
 *
 * A ideia vem do CRM da Comp AI (github.com/trycompai/crm, MIT), adaptada para
 * o nosso desenho. Duas decisões deles que valem para nós, e uma que não.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. UM REGISTRO DESCREVE OS DOIS TIPOS DE CAMPO.
 *
 *    Campo de sistema (`origem: 'sistema'`) descreve uma COLUNA REAL da tabela
 *    — `nome`, `telefone`, `cidade`. Campo personalizado (`origem: 'custom'`)
 *    descreve uma chave dentro da coluna JSON `campos`.
 *
 *    A tela não sabe a diferença. Ela lê o registro e desenha. É isso que faz
 *    "acrescentar um campo ao CRM" ser uma linha de dado em vez de uma alteração
 *    em quatro lugares — o formulário, a tabela, o filtro e a ficha.
 *
 * 2. JSON, NÃO ENTIDADE-ATRIBUTO-VALOR.
 *
 *    EAV é a resposta de manual e a errada aqui. Mostrar uma tabela com oito
 *    campos personalizados viraria oito junções, em toda página de toda lista.
 *    Numa coluna JSON os valores vêm na MESMA linha que já foi lida: zero
 *    consulta a mais, escrita atômica.
 *
 *    O preço é não haver integridade referencial no valor — e é por isso que
 *    `validarCampos` existe e roda no servidor, em toda escrita. Sem essa
 *    validação, JSON vira depósito de lixo em seis meses.
 *
 * 3. O QUE NÃO COPIEI: eles têm um registro único para a instalação inteira.
 *
 *    Aqui cada empresa é uma instância com banco próprio, então o registro é
 *    POR EMPRESA por construção. A oficina de injeção quer "tipo de bomba"; a
 *    fazenda quer "preferência de maturação"; a loja de tintas quer "tipo de
 *    superfície". Um registro comum às três seria a união de três negócios que
 *    não se parecem.
 */

import { novoId } from './db.mjs';

/** Tipos aceitos. Cada um decide como o valor é validado e desenhado. */
export const TIPOS_CAMPO = {
  texto: { nome: 'Texto', entrada: 'text' },
  texto_longo: { nome: 'Texto longo', entrada: 'textarea' },
  numero: { nome: 'Número', entrada: 'number' },
  moeda: { nome: 'Valor (R$)', entrada: 'number' },
  data: { nome: 'Data', entrada: 'date' },
  booleano: { nome: 'Sim/não', entrada: 'checkbox' },
  selecao: { nome: 'Escolha única', entrada: 'select', exigeOpcoes: true },
  multi_selecao: { nome: 'Escolha múltipla', entrada: 'multi', exigeOpcoes: true },
  telefone: { nome: 'Telefone', entrada: 'tel' },
  email: { nome: 'E-mail', entrada: 'email' },
  url: { nome: 'Endereço web', entrada: 'url' },
};

/**
 * Os campos de sistema, um por coluna real de `clientes`.
 *
 * Semeados na subida e nunca editados à mão. `chave` e `tipo` são imutáveis:
 * mudá-los não renomeia a coluna, só faz o registro mentir sobre a tabela. Da
 * linha de sistema, só `rotulo`, `mostrar_na_tabela` e `ordem` podem mudar.
 */
export const CAMPOS_SISTEMA = [
  { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: 1, mostrar_na_tabela: 1, ordem: 10 },
  { chave: 'telefone', rotulo: 'Telefone', tipo: 'telefone', obrigatorio: 0, mostrar_na_tabela: 1, ordem: 20 },
  { chave: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: 0, mostrar_na_tabela: 0, ordem: 30 },
  { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto', obrigatorio: 0, mostrar_na_tabela: 1, ordem: 40 },
  { chave: 'uf', rotulo: 'UF', tipo: 'texto', obrigatorio: 0, mostrar_na_tabela: 0, ordem: 50 },
  {
    chave: 'perfil', rotulo: 'Perfil', tipo: 'selecao', obrigatorio: 1, mostrar_na_tabela: 1, ordem: 60,
    opcoes: ['particular', 'frota', 'produtor_rural', 'revenda', 'consumidor'],
  },
  { chave: 'observacao', rotulo: 'Observação', tipo: 'texto_longo', obrigatorio: 0, mostrar_na_tabela: 0, ordem: 70 },
];

/** Chaves que NUNCA podem virar campo personalizado — colidiriam com coluna. */
export const CHAVES_RESERVADAS = new Set([
  ...CAMPOS_SISTEMA.map((c) => c.chave),
  'id', 'empresa_id', 'origem', 'consentimento_lgpd', 'consentimento_em',
  'opt_out_em', 'ultimo_inbound_em', 'criado_em', 'campos',
]);

/**
 * Uma chave de campo tem de sobreviver a virar nome de coluna, chave de JSON e
 * parâmetro de URL. Restringir agora é mais barato que descobrir depois que um
 * campo chamado "preço (R$)" quebra o filtro.
 */
export function validarChave(chave) {
  const k = String(chave ?? '').trim();
  if (!k) return 'A chave não pode ficar vazia.';
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(k)) {
    return 'A chave aceita apenas letras minúsculas, números e sublinhado, começando por letra.';
  }
  if (CHAVES_RESERVADAS.has(k)) return `"${k}" é um campo do sistema — escolha outro nome.`;
  return null;
}

/** Semeia/atualiza os campos de sistema. Idempotente. */
export function garantirCamposSistema(escopo) {
  for (const c of CAMPOS_SISTEMA) {
    const existe = escopo.uma(
      "select * from propriedades where {ESCOPO} and entidade = 'cliente' and chave = ?", c.chave,
    );
    if (existe) {
      // Só o que é editável numa linha de sistema. `tipo` e `chave` ficam.
      continue;
    }
    escopo.inserir('propriedades', {
      /*
       * Id gerado, nao `sis_<chave>`.
       *
       * Uma instancia pode legitimamente hospedar mais de uma empresa — a
       * suite de isolamento logico depende disso. Com id fixo, semear a
       * segunda empresa no mesmo banco colide na chave primaria. A checagem
       * de existencia acima ja e escopada por empresa e garante a idempotencia.
       */
      id: novoId(),
      entidade: 'cliente',
      origem: 'sistema',
      chave: c.chave,
      rotulo: c.rotulo,
      tipo: c.tipo,
      opcoes: c.opcoes ? JSON.stringify(c.opcoes) : null,
      obrigatorio: c.obrigatorio,
      mostrar_na_tabela: c.mostrar_na_tabela,
      ordem: c.ordem,
      criado_em: new Date().toISOString(),
    });
  }
}

/** O registro completo de uma entidade, em ordem de exibição. */
export function listarPropriedades(escopo, entidade = 'cliente') {
  return escopo.todas(
    `select * from propriedades
     where {ESCOPO} and entidade = ? and arquivado_em is null
     order by ordem, rotulo`,
    entidade,
  ).map((p) => ({ ...p, opcoes: p.opcoes ? seguroJson(p.opcoes, []) : null }));
}

/**
 * Valida um conjunto de campos personalizados contra o registro.
 *
 * É esta função que compra de volta a integridade que o JSON não tem. Sem ela,
 * qualquer cliente da API grava qualquer chave com qualquer forma, e a coluna
 * vira depósito.
 *
 * Devolve `{ valido, erros, limpo }` — `limpo` só com as chaves conhecidas, já
 * convertidas. Chave desconhecida é DESCARTADA e reportada, nunca gravada em
 * silêncio: gravar dado que nenhuma tela mostra é criar um vazamento invisível.
 */
export function validarCampos(propriedades, entrada) {
  const custom = propriedades.filter((p) => p.origem === 'custom');
  const porChave = new Map(custom.map((p) => [p.chave, p]));
  const erros = [];
  const limpo = {};

  for (const [k, bruto] of Object.entries(entrada ?? {})) {
    const def = porChave.get(k);
    if (!def) { erros.push(`Campo desconhecido "${k}" — ignorado.`); continue; }

    const v = converter(def, bruto);
    if (v.erro) { erros.push(`${def.rotulo}: ${v.erro}`); continue; }
    if (v.valor !== null && v.valor !== undefined) limpo[k] = v.valor;
  }

  for (const p of custom) {
    if (p.obrigatorio && (limpo[p.chave] === undefined || limpo[p.chave] === '')) {
      erros.push(`${p.rotulo} é obrigatório.`);
    }
  }

  return { valido: erros.length === 0, erros, limpo };
}

function converter(def, bruto) {
  if (bruto === null || bruto === undefined || bruto === '') return { valor: null, erro: null };

  switch (def.tipo) {
    case 'numero':
    case 'moeda': {
      const n = Number(String(bruto).replace(',', '.'));
      if (!Number.isFinite(n)) return { erro: 'precisa ser um número.' };
      return { valor: n, erro: null };
    }
    case 'booleano':
      return { valor: bruto === true || bruto === 'true' || bruto === 1 || bruto === '1', erro: null };

    case 'data': {
      const t = Date.parse(bruto);
      if (Number.isNaN(t)) return { erro: 'data inválida.' };
      // Guarda só o dia: campo de data não carrega fuso, e gravar hora aqui
      // faz o mesmo dia aparecer diferente conforme quem lê.
      return { valor: String(bruto).slice(0, 10), erro: null };
    }
    case 'selecao': {
      const ops = def.opcoes ?? [];
      if (ops.length && !ops.includes(String(bruto))) {
        return { erro: `valor fora das opções (${ops.join(', ')}).` };
      }
      return { valor: String(bruto), erro: null };
    }
    case 'multi_selecao': {
      const arr = Array.isArray(bruto) ? bruto : String(bruto).split(',').map((s) => s.trim());
      const ops = def.opcoes ?? [];
      const fora = arr.filter((x) => x && ops.length && !ops.includes(x));
      if (fora.length) return { erro: `valores fora das opções: ${fora.join(', ')}.` };
      return { valor: arr.filter(Boolean), erro: null };
    }
    case 'email': {
      const s = String(bruto).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { erro: 'e-mail inválido.' };
      return { valor: s, erro: null };
    }
    case 'url': {
      const s = String(bruto).trim();
      try { new URL(s); } catch { return { erro: 'endereço inválido.' }; }
      return { valor: s, erro: null };
    }
    default: {
      const s = String(bruto).trim();
      // Teto por campo: sem ele, um campo de texto vira anexo de arquivo.
      if (s.length > 4000) return { erro: 'texto acima de 4000 caracteres.' };
      return { valor: s, erro: null };
    }
  }
}

/** Formata para exibição. Devolve string sempre — a tela não decide formato. */
export function formatar(def, valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  switch (def.tipo) {
    case 'moeda':
      return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    case 'booleano':
      return valor ? 'Sim' : 'Não';
    case 'data': {
      const [a, m, d] = String(valor).slice(0, 10).split('-');
      return d ? `${d}/${m}/${a}` : String(valor);
    }
    case 'multi_selecao':
      return (Array.isArray(valor) ? valor : [valor]).join(', ');
    default:
      return String(valor);
  }
}

function seguroJson(texto, padrao) {
  try { return JSON.parse(texto) ?? padrao; } catch { return padrao; }
}
