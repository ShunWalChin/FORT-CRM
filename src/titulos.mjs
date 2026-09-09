/**
 * Contas a pagar e a receber.
 *
 * Um título é uma obrigação com data. Ele não é o razão — é o que gera
 * lançamento no razão, duas vezes: quando nasce (a obrigação passa a existir)
 * e quando é baixado (o dinheiro se move).
 *
 * A regra que amarra tudo: **nenhum dinheiro se move sem lançamento**. Não há
 * caminho neste módulo que altere saldo sem gravar a partida dobrada
 * correspondente, e é isso que faz o extrato do banco e o balancete falarem do
 * mesmo dinheiro.
 *
 * Sobre o `saldo_centavos` guardado no título: é redundante com a soma das
 * baixas, de propósito. "O que vence esta semana" é a pergunta mais feita do
 * financeiro, e respondê-la varrendo as baixas de cada título aberto piora a
 * cada mês. O razão continua sendo a verdade; `conferir()` prova que os dois
 * concordam, e reprova se um dia deixarem de concordar.
 */

import { agora, novoId } from './db.mjs';
import { centavos, formatar } from './dinheiro.mjs';
import { ErroContabil, competenciaDe, estornar, lancar } from './razao.mjs';

/**
 * Conta contábil de contrapartida por natureza.
 *
 * Um título a PAGAR credita Fornecedores (nasce uma obrigação) e debita a
 * despesa. Um a RECEBER debita Clientes a receber e credita a receita.
 */
const CONTRAPARTIDA = {
  pagar: '2.1.01.001',
  receber: '1.1.02.001',
};

/** Conta de caixa por meio de pagamento. É onde o dinheiro entra ou sai. */
export const CAIXA_POR_MEIO = {
  dinheiro: '1.1.01.001',
  pix: '1.1.01.003',
  debito: '1.1.01.002',
  credito: '1.1.01.002',
  boleto: '1.1.01.002',
  transferencia: '1.1.01.002',
  compensacao: null, // encontro de contas: não passa por caixa
};

/**
 * Abre um título e o seu lançamento de origem, numa transação só.
 *
 * O título e o lançamento nascem juntos ou não nascem: um título sem
 * lançamento é uma dívida que o balancete não conhece, e é assim que o passivo
 * de uma empresa fica menor do que ele é.
 */
export function abrir(banco, {
  instancia, natureza, parceiroId = null, numero = null, descricao,
  emissao, vencimento, valor, conta, centroCusto = null,
  origem = null, origemRef = null, ator,
}) {
  if (natureza !== 'pagar' && natureza !== 'receber') {
    throw new ErroContabil('natureza_invalida', 'Título é a pagar ou a receber.');
  }
  const texto = String(descricao ?? '').trim();
  if (texto.length < 3) {
    throw new ErroContabil('descricao_obrigatoria', 'Descreva o título.');
  }
  const v = centavos(valor, 'valor');
  if (v <= 0) throw new ErroContabil('valor_invalido', 'Título precisa de valor positivo.');
  if (!vencimento) throw new ErroContabil('vencimento_obrigatorio', 'Título sem vencimento não cobra.');
  if (!conta) throw new ErroContabil('conta_obrigatoria', 'Informe a conta de resultado.');

  const sql = banco.sistema();

  return banco.transacao(() => {
    const contrapartida = CONTRAPARTIDA[natureza];
    const partidas = natureza === 'pagar'
      ? [
        { conta, centro_custo: centroCusto, tipo: 'D', valor_centavos: v },
        { conta: contrapartida, tipo: 'C', valor_centavos: v },
      ]
      : [
        { conta: contrapartida, tipo: 'D', valor_centavos: v },
        { conta, centro_custo: centroCusto, tipo: 'C', valor_centavos: v },
      ];

    const lanc = lancar(sql, {
      instancia,
      data: emissao,
      historico: `${natureza === 'pagar' ? 'Título a pagar' : 'Título a receber'}: ${texto}`,
      partidas,
      origem: 'titulo',
      ator,
    });

    const id = novoId();
    sql.prepare(
      `insert into erp_titulos
         (id, instancia, natureza, parceiro_id, numero, descricao, emissao, vencimento,
          valor_centavos, saldo_centavos, status, conta, centro_custo, lancamento_id,
          origem, origem_ref, criado_por, criado_em)
       values (?,?,?,?,?,?,?,?,?,?,'aberto',?,?,?,?,?,?,?)`,
    ).run(id, instancia, natureza, parceiroId, numero, texto, emissao, vencimento,
      v, v, conta, centroCusto, lanc.id, origem, origemRef, ator, agora());

    sql.prepare('update erp_lancamentos set origem_ref = ? where id = ?').run(id, lanc.id);
    return { id, lancamentoId: lanc.id, saldo: v };
  });
}

/**
 * Baixa total ou parcial.
 *
 * Recusa passar do saldo — e recusa com o número, porque "valor inválido" faz
 * o operador tentar de novo às cegas, e "o saldo é R$ 340,00" resolve.
 */
export function baixar(banco, {
  tituloId, data, valor, meio = 'pix', contaCaixa = null, ator,
}) {
  const sql = banco.sistema();
  const t = sql.prepare('select * from erp_titulos where id = ?').get(tituloId);
  if (!t) throw new ErroContabil('nao_encontrado', 'Título não encontrado.');
  if (t.status === 'cancelado') throw new ErroContabil('titulo_cancelado', 'Título cancelado.');
  if (t.status === 'quitado') throw new ErroContabil('ja_quitado', 'Título já quitado.');

  const v = centavos(valor, 'valor');
  if (v <= 0) throw new ErroContabil('valor_invalido', 'A baixa precisa de valor positivo.');
  if (v > t.saldo_centavos) {
    throw new ErroContabil('acima_do_saldo',
      `Baixa de ${formatar(v)} acima do saldo de ${formatar(t.saldo_centavos)}.`,
      { saldo: t.saldo_centavos });
  }

  const caixa = contaCaixa ?? CAIXA_POR_MEIO[meio];
  if (!caixa) {
    throw new ErroContabil('conta_caixa_obrigatoria',
      `O meio "${meio}" não tem conta de caixa padrão — informe a conta.`);
  }

  return banco.transacao(() => {
    // Pagar: sai dinheiro (crédito no caixa) e some a obrigação (débito).
    // Receber: entra dinheiro (débito no caixa) e some o crédito do cliente.
    const contrapartida = CONTRAPARTIDA[t.natureza];
    const partidas = t.natureza === 'pagar'
      ? [
        { conta: contrapartida, tipo: 'D', valor_centavos: v },
        { conta: caixa, tipo: 'C', valor_centavos: v },
      ]
      : [
        { conta: caixa, tipo: 'D', valor_centavos: v },
        { conta: contrapartida, tipo: 'C', valor_centavos: v },
      ];

    const lanc = lancar(sql, {
      instancia: t.instancia,
      data,
      historico: `Baixa ${t.natureza === 'pagar' ? 'de pagamento' : 'de recebimento'}: ${t.descricao}`,
      partidas,
      origem: 'baixa',
      origemRef: t.id,
      ator,
    });

    const id = novoId();
    sql.prepare(
      `insert into erp_baixas
         (id, titulo_id, data, valor_centavos, meio, conta_caixa, lancamento_id, criado_por, criado_em)
       values (?,?,?,?,?,?,?,?,?)`,
    ).run(id, t.id, data, v, meio, caixa, lanc.id, ator, agora());

    const saldo = t.saldo_centavos - v;
    sql.prepare('update erp_titulos set saldo_centavos = ?, status = ? where id = ?')
      .run(saldo, saldo === 0 ? 'quitado' : 'parcial', t.id);

    return { id, lancamentoId: lanc.id, saldo, status: saldo === 0 ? 'quitado' : 'parcial' };
  });
}

/**
 * Cancela o título e estorna o que ele lançou.
 *
 * Só antes da primeira baixa. Depois dela existe dinheiro movido, e apagar a
 * obrigação deixaria o pagamento sem contra-parte — o caminho passa a ser
 * estornar a baixa primeiro.
 */
export function cancelar(banco, { tituloId, motivo, ator }) {
  const sql = banco.sistema();
  const t = sql.prepare('select * from erp_titulos where id = ?').get(tituloId);
  if (!t) throw new ErroContabil('nao_encontrado', 'Título não encontrado.');
  if (t.status === 'cancelado') throw new ErroContabil('ja_cancelado', 'Título já cancelado.');

  const baixas = sql.prepare('select count(*) as n from erp_baixas where titulo_id = ?').get(t.id).n;
  if (baixas > 0) {
    throw new ErroContabil('tem_baixa',
      'Este título já teve baixa. Estorne a baixa antes de cancelar — '
      + 'cancelar agora deixaria o pagamento sem obrigação correspondente.');
  }
  if (!motivo || String(motivo).trim().length < 5) {
    throw new ErroContabil('motivo_obrigatorio', 'Cancelar título exige motivo.');
  }

  return banco.transacao(() => {
    /*
     * O título some da carteira, mas o lançamento que o criou NÃO some: ele é
     * estornado. Apagar deixaria um buraco na sequência do razão, e a primeira
     * pergunta de qualquer auditoria é o que havia no buraco.
     */
    const est = estornar(sql, {
      lancamentoId: t.lancamento_id,
      data: agora().slice(0, 10),
      motivo: `Cancelamento do título ${t.numero ?? t.descricao}: ${motivo}`,
      ator,
    });
    sql.prepare("update erp_titulos set status = 'cancelado', saldo_centavos = 0 where id = ?")
      .run(t.id);
    return { id: t.id, status: 'cancelado', motivo, estornoId: est.id };
  });
}

/* ══ Leitura ═════════════════════════════════════════════════════════════ */

/**
 * A carteira: o que vence, quando, e o que já venceu.
 *
 * `atraso` em dias vem calculado aqui e não na tela, porque três telas
 * diferentes calculando "dias de atraso" produzem três respostas nas viradas
 * de mês.
 */
export function carteira(sql, {
  natureza = null, instancia = null, status = null, ate = null, hoje = null,
} = {}) {
  const cond = ["t.status <> 'cancelado'"];
  const params = [];
  if (natureza) { cond.push('t.natureza = ?'); params.push(natureza); }
  if (instancia) { cond.push('t.instancia = ?'); params.push(instancia); }
  if (status) { cond.push('t.status = ?'); params.push(status); }
  if (ate) { cond.push('t.vencimento <= ?'); params.push(ate); }

  const linhas = sql.prepare(
    `select t.*, p.nome as parceiro_nome, c.nome as conta_nome
       from erp_titulos t
       left join erp_parceiros p on p.id = t.parceiro_id
       left join erp_contas c on c.codigo = t.conta
      where ${cond.join(' and ')}
      order by t.vencimento, t.criado_em`,
  ).all(...params);

  const dia = (hoje ?? agora()).slice(0, 10);
  const emDias = (venc) => Math.round(
    (Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${venc}T00:00:00Z`)) / 86400000);

  return linhas.map((t) => {
    const atraso = t.status === 'quitado' ? 0 : Math.max(0, emDias(t.vencimento));
    return {
      ...t,
      atraso,
      vencido: atraso > 0,
      faixa: atraso === 0 ? 'em_dia'
        : atraso <= 30 ? 'ate_30'
          : atraso <= 60 ? 'ate_60'
            : atraso <= 90 ? 'ate_90' : 'acima_90',
    };
  });
}

/**
 * Posição consolidada: quanto o grupo deve e quanto tem a receber.
 *
 * Separado por empresa E somado, porque as duas perguntas são feitas — "como
 * está a Minas Peças" e "como está o grupo" — e responder só a segunda esconde
 * a empresa que está segurando as outras.
 */
export function posicao(sql, { hoje = null } = {}) {
  const todos = carteira(sql, { hoje });
  const abertos = todos.filter((t) => t.status !== 'quitado');

  const zerar = () => ({
    pagar: 0, receber: 0, pagarVencido: 0, receberVencido: 0, titulos: 0,
  });
  const porEmpresa = {};
  const grupo = zerar();

  for (const t of abertos) {
    const e = (porEmpresa[t.instancia] ??= zerar());
    const alvo = t.natureza === 'pagar' ? 'pagar' : 'receber';
    e[alvo] += t.saldo_centavos;
    grupo[alvo] += t.saldo_centavos;
    e.titulos += 1;
    grupo.titulos += 1;
    if (t.vencido) {
      e[`${alvo}Vencido`] += t.saldo_centavos;
      grupo[`${alvo}Vencido`] += t.saldo_centavos;
    }
  }

  for (const e of [...Object.values(porEmpresa), grupo]) {
    e.saldo = e.receber - e.pagar;
  }

  const faixas = {};
  for (const t of abertos) {
    const f = (faixas[t.faixa] ??= { pagar: 0, receber: 0 });
    f[t.natureza === 'pagar' ? 'pagar' : 'receber'] += t.saldo_centavos;
  }

  return { porEmpresa, grupo, faixas, competencia: competenciaDe(agora()) };
}
