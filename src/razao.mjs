/**
 * Razão contábil: partida dobrada, período e estorno.
 *
 * É a espinha do ERP. Contas a pagar, contas a receber, folha, comissão e o BI
 * financeiro não são módulos independentes — são formas diferentes de gerar
 * lançamento e de ler saldo. Construir as telas antes daqui seria construir
 * sete relatórios que um dia discordam entre si.
 *
 * Tudo mora na central, num arquivo só, porque partida dobrada exige transação
 * e não existe transação que atravesse três SQLite. Ver `erp-schema.mjs` para a
 * decisão de arquitetura completa.
 *
 * O módulo recusa em vez de corrigir. Um lançamento desbalanceado não é
 * arredondado para fechar: é rejeitado, com a diferença no texto do erro.
 * Sistema contábil que conserta sozinho é sistema que esconde o defeito até o
 * dia em que ele custa caro.
 */

import { agora, novoId } from './db.mjs';
import { centavos, formatar, ratear, somar } from './dinheiro.mjs';

export class ErroContabil extends Error {
  constructor(codigo, mensagem, detalhe = null) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** Instância reservada ao que é do grupo e de nenhuma empresa em particular. */
export const GRUPO = 'GRUPO';

/**
 * Plano de contas mínimo, mas real.
 *
 * Segue a estrutura brasileira: 1 ativo, 2 passivo, 3 patrimônio, 4 receita,
 * 5 despesa. É semente, não lei — a contabilidade da empresa troca o que
 * quiser depois, e as contas que já receberam lançamento ficam.
 */
export const PLANO_SEMENTE = [
  ['1', 'ATIVO', 'ativo', 'D', null, 0],
  ['1.1', 'Circulante', 'ativo', 'D', '1', 0],
  ['1.1.01', 'Caixa e equivalentes', 'ativo', 'D', '1.1', 0],
  ['1.1.01.001', 'Caixa', 'ativo', 'D', '1.1.01', 1],
  ['1.1.01.002', 'Banco conta movimento', 'ativo', 'D', '1.1.01', 1],
  ['1.1.01.003', 'PIX a compensar', 'ativo', 'D', '1.1.01', 1],
  ['1.1.02', 'Créditos', 'ativo', 'D', '1.1', 0],
  ['1.1.02.001', 'Clientes a receber', 'ativo', 'D', '1.1.02', 1],
  ['1.1.03', 'Estoques', 'ativo', 'D', '1.1', 0],
  ['1.1.03.001', 'Peças e materiais', 'ativo', 'D', '1.1.03', 1],

  ['2', 'PASSIVO', 'passivo', 'C', null, 0],
  ['2.1', 'Circulante', 'passivo', 'C', '2', 0],
  ['2.1.01', 'Obrigações', 'passivo', 'C', '2.1', 0],
  ['2.1.01.001', 'Fornecedores', 'passivo', 'C', '2.1.01', 1],
  ['2.1.01.002', 'Salários a pagar', 'passivo', 'C', '2.1.01', 1],
  ['2.1.01.003', 'Impostos a recolher', 'passivo', 'C', '2.1.01', 1],

  ['3', 'PATRIMÔNIO LÍQUIDO', 'patrimonio', 'C', null, 0],
  ['3.1', 'Capital', 'patrimonio', 'C', '3', 0],
  ['3.1.01.001', 'Capital social', 'patrimonio', 'C', '3.1', 1],
  ['3.2', 'Resultado', 'patrimonio', 'C', '3', 0],
  ['3.2.01.001', 'Lucros acumulados', 'patrimonio', 'C', '3.2', 1],

  ['4', 'RECEITA', 'receita', 'C', null, 0],
  ['4.1', 'Receita operacional', 'receita', 'C', '4', 0],
  ['4.1.01.001', 'Venda de peças', 'receita', 'C', '4.1', 1],
  ['4.1.01.002', 'Serviços de oficina', 'receita', 'C', '4.1', 1],
  ['4.1.01.003', 'Venda de tintas', 'receita', 'C', '4.1', 1],
  ['4.1.01.004', 'Produção agrícola', 'receita', 'C', '4.1', 1],

  ['5', 'DESPESA', 'despesa', 'D', null, 0],
  ['5.1', 'Custos', 'despesa', 'D', '5', 0],
  ['5.1.01.001', 'Custo de mercadoria vendida', 'despesa', 'D', '5.1', 1],
  ['5.1.01.002', 'Mão de obra direta', 'despesa', 'D', '5.1', 1],
  ['5.2', 'Despesas operacionais', 'despesa', 'D', '5', 0],
  ['5.2.01.001', 'Salários e encargos', 'despesa', 'D', '5.2', 1],
  ['5.2.01.002', 'Aluguel', 'despesa', 'D', '5.2', 1],
  ['5.2.01.003', 'Energia, água e telefone', 'despesa', 'D', '5.2', 1],
  ['5.2.01.004', 'Marketing e publicidade', 'despesa', 'D', '5.2', 1],
  ['5.2.01.005', 'Software e TI', 'despesa', 'D', '5.2', 1],
  ['5.2.01.006', 'Serviços de terceiros', 'despesa', 'D', '5.2', 1],
  ['5.2.01.007', 'Despesas administrativas', 'despesa', 'D', '5.2', 1],
];

/** `AAAA-MM` a partir de uma data ISO. A competência é o mês do fato. */
export function competenciaDe(dataIso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(dataIso ?? ''));
  if (!m) throw new ErroContabil('data_invalida', `Data fora do formato: ${dataIso}`);
  return `${m[1]}-${m[2]}`;
}

/* ══ Semeadura ═══════════════════════════════════════════════════════════ */

export function semearPlano(sql, { ator = 'sistema' } = {}) {
  const criadas = [];
  const existe = sql.prepare('select codigo from erp_contas where codigo = ?');
  const inserir = sql.prepare(
    `insert into erp_contas (codigo, nome, tipo, natureza, pai, aceita_lancamento, ativa, criada_em)
     values (?,?,?,?,?,?,1,?)`);
  const quando = agora();

  for (const [codigo, nome, tipo, natureza, pai, aceita] of PLANO_SEMENTE) {
    if (existe.get(codigo)) continue;
    inserir.run(codigo, nome, tipo, natureza, pai, aceita, quando);
    criadas.push(codigo);
  }
  return { criadas, ator };
}

/**
 * Abre a competência se ela ainda não existe.
 *
 * Abrir sozinho, e não recusar o lançamento de um mês novo: o mês vira sem
 * pedir licença, e um sistema que exige ritual de abertura acaba com o
 * financeiro lançando tudo no mês errado por não saber do ritual.
 */
export function garantirPeriodo(sql, competencia) {
  const p = sql.prepare('select * from erp_periodos where competencia = ?').get(competencia);
  if (p) return p;
  sql.prepare('insert into erp_periodos (competencia, status, aberto_em) values (?,?,?)')
    .run(competencia, 'aberto', agora());
  return sql.prepare('select * from erp_periodos where competencia = ?').get(competencia);
}

/* ══ Lançamento ══════════════════════════════════════════════════════════ */

/**
 * Grava um lançamento com as suas partidas, ou não grava nada.
 *
 * As cinco recusas, na ordem em que são checadas — e todas ANTES de escrever,
 * porque um `insert` já feito dentro de uma transação que vai falhar ainda
 * gasta o id e polui a sequência.
 */
export function lancar(sql, {
  instancia, data, historico, partidas,
  origem = 'manual', origemRef = null, ator, estorna = null,
}) {
  if (!instancia) throw new ErroContabil('instancia_ausente', 'Lançamento sem empresa.');
  if (!ator) throw new ErroContabil('ator_ausente', 'Lançamento sem autor.');
  const texto = String(historico ?? '').trim();
  if (texto.length < 3) {
    throw new ErroContabil('historico_ausente',
      'Todo lançamento precisa de histórico: é o que explica o valor seis meses depois.');
  }
  if (!Array.isArray(partidas) || partidas.length < 2) {
    throw new ErroContabil('partida_dobrada',
      'Partida dobrada exige ao menos um débito e um crédito.');
  }

  const competencia = competenciaDe(data);
  const periodo = garantirPeriodo(sql, competencia);
  if (periodo.status === 'fechado') {
    throw new ErroContabil('periodo_fechado',
      `A competência ${competencia} está fechada. Lance no período aberto seguinte.`,
      { competencia });
  }

  // ── Invariante 1: soma zero ────────────────────────────────────────────
  let debitos = 0;
  let creditos = 0;
  for (const [n, p] of partidas.entries()) {
    if (p.tipo !== 'D' && p.tipo !== 'C') {
      throw new ErroContabil('tipo_invalido', `Partida ${n + 1}: use D ou C.`);
    }
    const v = centavos(p.valor_centavos, `partida[${n}]`);
    if (v <= 0) {
      throw new ErroContabil('valor_invalido',
        `Partida ${n + 1}: o valor é sempre positivo — quem dá o sinal é o tipo.`);
    }
    if (p.tipo === 'D') debitos += v; else creditos += v;
  }
  if (debitos !== creditos) {
    throw new ErroContabil('nao_fecha',
      `Débito ${formatar(debitos)} e crédito ${formatar(creditos)} não batem — `
      + `diferença de ${formatar(Math.abs(debitos - creditos))}.`,
      { debitos, creditos, diferenca: debitos - creditos });
  }

  // ── Invariante 4: só folha do plano recebe partida ─────────────────────
  const conta = sql.prepare('select codigo, aceita_lancamento, ativa from erp_contas where codigo = ?');
  for (const p of partidas) {
    const c = conta.get(p.conta);
    if (!c) throw new ErroContabil('conta_inexistente', `Conta ${p.conta} não existe no plano.`);
    if (!c.ativa) throw new ErroContabil('conta_inativa', `Conta ${p.conta} está inativa.`);
    if (!c.aceita_lancamento) {
      throw new ErroContabil('conta_sintetica',
        `Conta ${p.conta} é sintética: ela soma as filhas, não recebe lançamento.`);
    }
  }

  const id = novoId();
  const quando = agora();
  sql.prepare(
    `insert into erp_lancamentos
       (id, instancia, competencia, data, historico, origem, origem_ref, criado_por, criado_em, estorna)
     values (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, instancia, competencia, data, texto, origem, origemRef, ator, quando, estorna);

  const inserirPartida = sql.prepare(
    `insert into erp_partidas (id, lancamento_id, conta, centro_custo, tipo, valor_centavos, ordem)
     values (?,?,?,?,?,?,?)`);
  for (const [n, p] of partidas.entries()) {
    inserirPartida.run(novoId(), id, p.conta, p.centro_custo ?? null, p.tipo,
      centavos(p.valor_centavos), n);
  }

  return { id, competencia, total: debitos };
}

/**
 * Estorna: cria o lançamento espelho e amarra os dois.
 *
 * Não altera o original — nem o valor, nem o histórico. É a diferença entre um
 * livro que conta o que houve e um livro que conta o que alguém preferiria que
 * tivesse havido.
 */
export function estornar(sql, { lancamentoId, data, motivo, ator }) {
  const orig = sql.prepare('select * from erp_lancamentos where id = ?').get(lancamentoId);
  if (!orig) throw new ErroContabil('nao_encontrado', 'Lançamento não encontrado.');
  if (orig.estornado_por) {
    throw new ErroContabil('ja_estornado', 'Este lançamento já foi estornado.',
      { estornoId: orig.estornado_por });
  }
  if (orig.estorna) {
    throw new ErroContabil('estorno_de_estorno',
      'Estornar um estorno recria o lançamento original — faça um lançamento novo.');
  }

  const partidas = sql.prepare(
    'select * from erp_partidas where lancamento_id = ? order by ordem').all(lancamentoId);

  const espelho = partidas.map((p) => ({
    conta: p.conta,
    centro_custo: p.centro_custo,
    tipo: p.tipo === 'D' ? 'C' : 'D',
    valor_centavos: p.valor_centavos,
  }));

  const r = lancar(sql, {
    instancia: orig.instancia,
    data: data ?? agora().slice(0, 10),
    historico: `Estorno de ${orig.historico}${motivo ? ` — ${motivo}` : ''}`,
    partidas: espelho,
    origem: 'estorno',
    origemRef: orig.id,
    ator,
    estorna: orig.id,
  });

  sql.prepare('update erp_lancamentos set estornado_por = ? where id = ?').run(r.id, orig.id);
  return r;
}

/* ══ Leitura ═════════════════════════════════════════════════════════════ */

/**
 * Saldo por conta, no recorte pedido.
 *
 * O sinal segue a NATUREZA da conta: numa conta devedora, débito soma; numa
 * credora, crédito soma. Sem isso a despesa e a receita apareceriam com sinais
 * trocados no mesmo relatório, e o operador aprende a "ler ao contrário" — que
 * é como um erro real passa despercebido.
 */
export function saldos(sql, { competencia = null, ate = null, instancia = null, centroCusto = null } = {}) {
  const cond = ['1=1'];
  const params = [];
  if (competencia) { cond.push('l.competencia = ?'); params.push(competencia); }
  if (ate) { cond.push('l.competencia <= ?'); params.push(ate); }
  if (instancia) { cond.push('l.instancia = ?'); params.push(instancia); }
  if (centroCusto) { cond.push('p.centro_custo = ?'); params.push(centroCusto); }

  const linhas = sql.prepare(
    `select p.conta, c.nome, c.tipo, c.natureza,
            sum(case when p.tipo = 'D' then p.valor_centavos else 0 end) as debito,
            sum(case when p.tipo = 'C' then p.valor_centavos else 0 end) as credito
       from erp_partidas p
       join erp_lancamentos l on l.id = p.lancamento_id
       join erp_contas c on c.codigo = p.conta
      where ${cond.join(' and ')}
      group by p.conta, c.nome, c.tipo, c.natureza
      order by p.conta`,
  ).all(...params);

  return linhas.map((l) => ({
    ...l,
    saldo: l.natureza === 'D' ? l.debito - l.credito : l.credito - l.debito,
  }));
}

/**
 * Balancete: as contas, os totais e a prova de que o livro fecha.
 *
 * `confere` é o que se olha primeiro. Se vier falso, nenhum outro número desta
 * resposta vale — e é melhor a tela dizer isso do que desenhar um gráfico
 * bonito sobre um livro quebrado.
 */
export function balancete(sql, filtro = {}) {
  const contas = saldos(sql, filtro);
  const debito = contas.reduce((s, c) => s + c.debito, 0);
  const credito = contas.reduce((s, c) => s + c.credito, 0);

  const por = (tipo) => contas.filter((c) => c.tipo === tipo).reduce((s, c) => s + c.saldo, 0);
  const receita = por('receita');
  const despesa = por('despesa');

  return {
    contas,
    debito,
    credito,
    confere: debito === credito,
    diferenca: debito - credito,
    receita,
    despesa,
    resultado: receita - despesa,
    ativo: por('ativo'),
    passivo: por('passivo'),
    patrimonio: por('patrimonio'),
  };
}

/**
 * Fecha a competência.
 *
 * Recusa fechar um mês que não bate — e essa é a razão de o fechamento
 * existir. Fechar um livro torto só transfere o problema para quem for
 * procurar a diferença daqui a um ano, sem saber onde ela nasceu.
 */
export function fechar(sql, { competencia, ator }) {
  const p = sql.prepare('select * from erp_periodos where competencia = ?').get(competencia);
  if (!p) throw new ErroContabil('periodo_inexistente', `Competência ${competencia} não existe.`);
  if (p.status === 'fechado') {
    throw new ErroContabil('ja_fechado', `A competência ${competencia} já está fechada.`);
  }

  const anterior = sql.prepare(
    "select competencia from erp_periodos where competencia < ? and status = 'aberto' order by competencia limit 1",
  ).get(competencia);
  if (anterior) {
    throw new ErroContabil('anterior_aberto',
      `A competência ${anterior.competencia} ainda está aberta. Feche na ordem — `
      + 'pular um mês esconde a diferença dele dentro do seguinte.',
      { pendente: anterior.competencia });
  }

  const b = balancete(sql, { competencia });
  if (!b.confere) {
    throw new ErroContabil('nao_fecha',
      `O período não bate: diferença de ${formatar(Math.abs(b.diferenca))}.`,
      { diferenca: b.diferenca });
  }

  sql.prepare(
    `update erp_periodos
        set status = 'fechado', fechado_em = ?, fechado_por = ?,
            resultado_centavos = ?, receita_centavos = ?, despesa_centavos = ?
      where competencia = ?`,
  ).run(agora(), ator, b.resultado, b.receita, b.despesa, competencia);

  return { competencia, ...b };
}

export function reabrir(sql, { competencia, ator, motivo }) {
  const p = sql.prepare('select * from erp_periodos where competencia = ?').get(competencia);
  if (!p) throw new ErroContabil('periodo_inexistente', `Competência ${competencia} não existe.`);
  if (p.status !== 'fechado') throw new ErroContabil('nao_fechado', 'A competência já está aberta.');
  if (!motivo || String(motivo).trim().length < 5) {
    throw new ErroContabil('motivo_obrigatorio',
      'Reabrir período fechado exige motivo: é ele que a auditoria vai ler.');
  }
  sql.prepare(
    "update erp_periodos set status = 'aberto', fechado_em = null, fechado_por = null where competencia = ?",
  ).run(competencia);
  return { competencia, reabertoPor: ator, motivo };
}

/**
 * Conferência global do livro.
 *
 * Três perguntas que um razão saudável responde com zero: existe lançamento
 * que não soma zero, partida em conta sintética, ou título cujo saldo
 * discorda das suas baixas.
 */
export function conferir(sql) {
  const desbalanceados = sql.prepare(
    `select l.id, l.historico, l.competencia,
            sum(case when p.tipo = 'D' then p.valor_centavos else -p.valor_centavos end) as dif
       from erp_lancamentos l join erp_partidas p on p.lancamento_id = l.id
      group by l.id having dif <> 0`,
  ).all();

  const emSintetica = sql.prepare(
    `select p.lancamento_id, p.conta from erp_partidas p
       join erp_contas c on c.codigo = p.conta
      where c.aceita_lancamento = 0`,
  ).all();

  const titulosTortos = sql.prepare(
    `select t.id, t.numero, t.valor_centavos, t.saldo_centavos,
            coalesce((select sum(b.valor_centavos) from erp_baixas b where b.titulo_id = t.id), 0) as baixado
       from erp_titulos t
      where t.status <> 'cancelado'
        and t.saldo_centavos <> t.valor_centavos - baixado`,
  ).all();

  const orfas = sql.prepare(
    'select count(*) as n from erp_partidas p left join erp_lancamentos l on l.id = p.lancamento_id where l.id is null',
  ).get().n;

  return {
    saudavel: !desbalanceados.length && !emSintetica.length && !titulosTortos.length && !orfas,
    desbalanceados,
    emSintetica,
    titulosTortos,
    partidasOrfas: orfas,
  };
}

/* ══ Rateio entre empresas ═══════════════════════════════════════════════ */

/**
 * Distribui um custo do grupo entre as empresas, sem perder centavo.
 *
 * O caso real: a assinatura do sistema, a contabilidade, o contador. Pagos por
 * um, usados por três. Sem rateio esse custo mora inteiro na empresa que
 * pagou, e a margem das outras duas aparece melhor do que é.
 */
export function ratearEntreEmpresas(sql, {
  data, historico, contaDespesa, contaContrapartida, total, pesos, ator,
}) {
  const codigos = Object.keys(pesos);
  if (!codigos.length) throw new ErroContabil('sem_rateio', 'Informe as empresas e os pesos.');

  const partes = ratear(centavos(total, 'total'), codigos.map((c) => pesos[c]));
  const feitos = [];

  for (const [n, cod] of codigos.entries()) {
    if (partes[n] === 0) continue;
    feitos.push(lancar(sql, {
      instancia: cod,
      data,
      historico: `${historico} (rateio ${n + 1}/${codigos.length})`,
      origem: 'rateio',
      ator,
      partidas: [
        { conta: contaDespesa, tipo: 'D', valor_centavos: partes[n] },
        { conta: contaContrapartida, tipo: 'C', valor_centavos: partes[n] },
      ],
    }));
  }

  // A prova do rateio: a soma das partes é o total, e não "quase".
  const conferido = somar(feitos.map((f) => f.total));
  if (conferido !== centavos(total)) {
    throw new ErroContabil('rateio_perdeu_centavo',
      `Rateio somou ${formatar(conferido)} de ${formatar(total)}.`);
  }
  return { lancamentos: feitos, total: conferido, partes };
}
