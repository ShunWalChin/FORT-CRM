/**
 * Reancorar a demonstração no tempo.
 *
 * O problema, medido: a carga gera datas relativas ao instante em que roda.
 * Nove horas depois, dois clientes já haviam saído da janela de 24 horas e a
 * fila da oficina caiu de 16 liberados para 9 — sem erro nenhum, só o
 * compliance funcionando sobre dado que envelheceu. A demonstração tem prazo
 * de validade menor que um dia.
 *
 * A saída existente era "Recarregar demonstração", que apaga tudo e semeia de
 * novo. Resolve, mas joga fora o que acabou de ser demonstrado — a conversão
 * despachada na frente do cliente, o cadastro feito durante a reunião.
 *
 * Reancorar é a alternativa cirúrgica: desliza para frente TODA a linha do
 * tempo semeada, pelo mesmo intervalo, preservando as distâncias entre os
 * eventos. O que era "passou aqui há 62 dias" continua sendo 62 dias; o que
 * era "falou comigo há 5 horas" volta a ser 5 horas.
 *
 * O que NÃO é deslocado, de propósito:
 *
 *   `audit_log` — é append-only e encadeado por hash. Reescrever a data
 *   quebraria a cadeia inteira, e a tela de auditoria acusaria na hora. Uma
 *   conveniência de demonstração não pode corromper o registro que existe
 *   justamente para não ser corrompido.
 *
 *   `disparos` e `conversoes` — são o que o OPERADOR fez, não história
 *   semeada. Deixá-los para trás é o comportamento certo: os cooldowns
 *   expiram naturalmente e a fila volta a encher, que é o efeito desejado.
 */

import { agora } from './db.mjs';

/**
 * Colunas de data que representam história semeada.
 * Toda coluna aqui é deslocada pelo mesmo intervalo — deslocar só algumas
 * romperia a relação entre elas (uma OS concluída depois da próxima visita).
 */
const COLUNAS = {
  clientes: ['ultimo_inbound_em', 'consentimento_em', 'opt_out_em', 'criado_em'],
  veiculos: ['ultima_visita_em', 'criado_em'],
  ordens_servico: ['aberta_em', 'concluida_em'],
  pedidos: ['feito_em', 'proximo_contato_em'],
  oportunidades: ['criado_em', 'atualizado_em'],
  atividades: ['criado_em'],
  atribuicoes: ['capturado_em'],
  canais: ['criado_em'],
  catalogo: [],
  gatilhos: [],
};

/** Marca de quando a linha do tempo foi ancorada pela última vez. */
const ACAO_ANCORA = 'demo.reancorar';
const ACAO_CARGA = 'carga_demonstracao';

/**
 * Descobre o instante a que a linha do tempo desta instância está ancorada:
 * a última reancoragem ou, na falta dela, a carga original.
 */
export function ancoraDe(banco) {
  const sql = banco.sistema();
  const ultima = sql
    .prepare(
      `select criado_em from audit_log
       where acao in (?, ?) order by seq desc limit 1`,
    )
    .get(ACAO_ANCORA, ACAO_CARGA);
  return ultima?.criado_em ?? null;
}

/**
 * Desliza a história desta instância para frente, até que a âncora seja agora.
 *
 * @returns {{deslocouSegundos:number, tabelas:object, ancoraAnterior:string|null}}
 */
export function reancorar(banco, escopo, { ator = 'sistema', minimoSegundos = 60 } = {}) {
  const ancoraAnterior = ancoraDe(banco);
  if (!ancoraAnterior) {
    return { deslocouSegundos: 0, tabelas: {}, ancoraAnterior: null, motivo: 'sem_ancora' };
  }

  const deslocouSegundos = Math.floor((Date.now() - Date.parse(ancoraAnterior)) / 1000);

  // Deslocar por poucos segundos não muda nada e só suja a auditoria.
  if (deslocouSegundos < minimoSegundos) {
    return { deslocouSegundos: 0, tabelas: {}, ancoraAnterior, motivo: 'ancora_recente' };
  }

  const tabelas = {};

  banco.transacao(() => {
    for (const [tabela, colunas] of Object.entries(COLUNAS)) {
      if (!colunas.length) continue;

      // `case when ... is null` preserva o nulo: um contato sem descadastro não
      // pode ganhar uma data de descadastro por efeito colateral do
      // deslocamento.
      const sets = colunas
        .map((c) => `${c} = case when ${c} is null then null else `
          + `strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '+' || ? || ' seconds') end`)
        .join(', ');

      const r = escopo.sql
        .prepare(`update ${tabela} set ${sets} where empresa_id = ?`)
        .run(...colunas.map(() => deslocouSegundos), escopo.empresaId);

      tabelas[tabela] = r.changes;
    }
  });

  banco.auditar({
    empresaId: escopo.empresaId,
    ator,
    acao: ACAO_ANCORA,
    entidade: 'instancia',
    dados: { deslocouSegundos, ancoraAnterior, tabelas },
  });

  return { deslocouSegundos, tabelas, ancoraAnterior };
}

/**
 * Idade da demonstração e se ela já perdeu o fôlego.
 *
 * O limite é 12 horas e não 24 de propósito: o dano começa antes do prazo
 * fechar, porque os contatos foram semeados espalhados DENTRO da janela — o
 * de 21 horas cai primeiro, e a fila encolhe aos poucos em vez de sumir de
 * uma vez.
 */
export function diagnosticoDaAncora(banco, { limiteHoras = 12 } = {}) {
  const ancora = ancoraDe(banco);
  if (!ancora) return { ancora: null, horas: null, envelhecida: false };

  const horas = (Date.now() - Date.parse(ancora)) / 3_600_000;
  return {
    ancora,
    horas: Math.round(horas * 10) / 10,
    envelhecida: horas >= limiteHoras,
    verificadoEm: agora(),
  };
}
