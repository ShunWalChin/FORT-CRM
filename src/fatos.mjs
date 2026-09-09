/**
 * Fatos subindo: como o que acontece nas instâncias vira lançamento no razão.
 *
 * Era o débito que fazia o ERP conhecer apenas o que alguém digitasse nele. A
 * oficina concluía dezoito ordens de serviço e o balancete do grupo continuava
 * zerado — a "integração total" era promessa.
 *
 * ═══ O caminho, em duas etapas separadas de propósito ═══
 *
 *   COLHER  — lê cada instância e grava o fato na central, sem contabilizar.
 *   POSTAR  — transforma fato não contabilizado em lançamento.
 *
 * Separadas porque falham por motivos diferentes. Colher falha por rede e por
 * instância fora do ar; postar falha por regra contábil — período fechado,
 * conta que não existe. Juntas, um erro de plano de contas faria a coleta
 * inteira parecer quebrada, e ninguém saberia se o problema era a leitura ou a
 * escrita.
 *
 * ═══ Três decisões que sustentam a idempotência ═══
 *
 *   1. **A chave é a origem, não o instante.** `(instância, tipo, ref)` é
 *      única. Rodar a coleta dez vezes produz o mesmo conjunto de fatos —
 *      um cron que dispara duas vezes não duplica a receita do mês.
 *
 *   2. **Fato contabilizado nunca é reprocessado.** `lancamento_id` preenchido
 *      é a marca. Sem ela, um reprocessamento dobraria o faturamento.
 *
 *   3. **Origem que muda depois de contabilizada é MARCADA, não corrigida.**
 *      A oficina corrige o valor de uma OS já lançada: reprocessar duplicaria,
 *      ignorar deixaria o razão discordando da origem para sempre. O terceiro
 *      caminho é registrar a divergência e deixar a decisão com quem responde
 *      pelo livro — estornar é ato contábil, não efeito colateral de um cron.
 */

import { createHash } from 'node:crypto';
import { agora, novoId } from './db.mjs';
import { ErroContabil, estornar } from './razao.mjs';
import { abrir as abrirTitulo } from './titulos.mjs';

/**
 * A receita de cada instância tem conta própria.
 *
 * "Venda" não diz nada num grupo que conserta bico injetor, planta e vende
 * tinta. Sem a separação, o resultado consolidado não responde à pergunta que
 * o dono faz — qual negócio está puxando o outro.
 */
export const CONTA_RECEITA = {
  MP: '4.1.01.002', // Serviços de oficina
  AF: '4.1.01.004', // Produção agrícola
  FT: '4.1.01.003', // Venda de tintas
};
const RECEITA_PADRAO = '4.1.01.001'; // Venda de peças

/**
 * O fato entregue vira TÍTULO A RECEBER, e não um lançamento solto.
 *
 * A primeira versão lançava direto contra "clientes a receber". O razão ficava
 * certo e a carteira ficava vazia: o painel mostrava receita reconhecida e
 * R$ 0 a receber ao mesmo tempo. Dois números para o mesmo conceito — que é a
 * classe de problema que este ERP inteiro existe para não ter.
 *
 * Como título, os dois passam a ser o mesmo número, e o valor vira cobrável:
 * aparece no que vence, aceita baixa, e some da carteira quando for pago.
 *
 * A contrapartida continua sendo "a receber" e nunca caixa. A instância sabe
 * que entregou; ela não sabe se recebeu — não há campo de pagamento em
 * `ordens_servico` nem em `pedidos`. Lançar contra o caixa afirmaria o que o
 * sistema não sabe, e o caixa contábil passaria a discordar do extrato todo mês.
 */

/**
 * O que cada tipo de fato lê na instância.
 *
 * As consultas ficam aqui, e não espalhadas: é a lista do que o ERP considera
 * fato financeiro, e ela precisa caber numa tela.
 */
export const COLETORES = {
  ordem_servico: {
    nome: 'Ordem de serviço concluída',
    sql: `select os.id as ref, os.numero, os.valor_centavos, os.concluida_em as ocorrido_em,
                 os.componente as descricao, c.nome as cliente
            from ordens_servico os
            join clientes c on c.id = os.cliente_id
           where os.{ESCOPO} and os.status = 'concluida'
             and os.concluida_em is not null and os.valor_centavos > 0`,
  },
  pedido: {
    nome: 'Pedido entregue',
    sql: `select p.id as ref, p.numero, p.valor_centavos, p.feito_em as ocorrido_em,
                 p.canal as descricao, c.nome as cliente
            from pedidos p
            join clientes c on c.id = p.cliente_id
           where p.{ESCOPO} and p.status = 'entregue' and p.valor_centavos > 0`,
  },
  venda: {
    nome: 'Oportunidade ganha',
    sql: `select o.id as ref, o.pedido_ref as numero, o.valor_centavos,
                 o.atualizado_em as ocorrido_em, o.titulo as descricao, c.nome as cliente
            from oportunidades o
            left join clientes c on c.id = o.cliente_id
           where o.{ESCOPO} and o.etapa = 'ganho' and o.valor_centavos > 0`,
  },
};

/** Resumo do conteúdo que importa. Muda o valor ou a data, muda o hash. */
function resumir(f) {
  return createHash('sha256')
    .update(JSON.stringify({
      valor: f.valor_centavos, ocorrido: f.ocorrido_em, numero: f.numero ?? null,
    }))
    .digest('hex')
    .slice(0, 32);
}

/**
 * Colhe os fatos de cada instância para a central.
 *
 * Devolve o contrato de completude: a coleta que não alcançou uma instância
 * NÃO é uma coleta completa, e quem consome precisa saber disso antes de somar.
 */
export function colher(fed, { codigos = null, ator = 'sistema' } = {}) {
  const central = fed.abrirCentral();
  const sql = central.sistema();
  const quando = agora();

  const alvos = codigos ?? fed.codigosDeEmpresa();
  const resultado = {
    novos: 0, atualizados: 0, divergentes: 0, jaConhecidos: 0,
    porInstancia: [], falhas: [], completo: true, lidoEm: quando,
  };

  const existente = sql.prepare(
    'select id, payload, payload_hash, lancamento_id from erp_fatos where instancia = ? and tipo = ? and ref = ?');
  const inserir = sql.prepare(
    `insert into erp_fatos (id, instancia, tipo, ref, payload, ocorrido_em, lido_em, payload_hash)
     values (?,?,?,?,?,?,?,?)`);
  const atualizar = sql.prepare(
    'update erp_fatos set payload = ?, ocorrido_em = ?, lido_em = ?, payload_hash = ? where id = ?');
  const marcarDivergencia = sql.prepare(
    'update erp_fatos set divergente_em = ?, divergencia = ? where id = ?');

  for (const cod of alvos) {
    const parcial = { instancia: cod, novos: 0, atualizados: 0, divergentes: 0, jaConhecidos: 0 };
    try {
      const banco = fed.abrir(cod);
      const emp = banco.sistema().prepare('select id from empresas limit 1').get();
      if (!emp) throw new Error('instância sem empresa');
      const escopo = banco.para(emp.id);

      central.transacao(() => {
        for (const [tipo, coletor] of Object.entries(COLETORES)) {
          for (const linha of escopo.todas(coletor.sql)) {
            const payload = JSON.stringify(linha);
            const hash = resumir(linha);
            const antes = existente.get(cod, tipo, linha.ref);

            if (!antes) {
              inserir.run(novoId(), cod, tipo, linha.ref, payload,
                linha.ocorrido_em, quando, hash);
              parcial.novos += 1;
            } else if (antes.payload_hash === hash) {
              parcial.jaConhecidos += 1;
            } else if (antes.lancamento_id) {
              /*
               * Mudou DEPOIS de virar lançamento. Não se reprocessa e não se
               * ignora: marca-se. Estornar é ato contábil, e não efeito
               * colateral de um cron que rodou de madrugada.
               */
              marcarDivergencia.run(quando, JSON.stringify({
                antes: JSON.parse(antes.payload ?? '{}').valor_centavos ?? null,
                agora: linha.valor_centavos,
              }), antes.id);
              parcial.divergentes += 1;
            } else {
              atualizar.run(payload, linha.ocorrido_em, quando, hash, antes.id);
              parcial.atualizados += 1;
            }
          }
        }
      });
    } catch (e) {
      resultado.falhas.push({ instancia: cod, erro: e.message });
      resultado.completo = false;
      resultado.porInstancia.push({ ...parcial, erro: e.message });
      continue;
    }

    resultado.novos += parcial.novos;
    resultado.atualizados += parcial.atualizados;
    resultado.divergentes += parcial.divergentes;
    resultado.jaConhecidos += parcial.jaConhecidos;
    resultado.porInstancia.push(parcial);
  }

  void ator;
  return resultado;
}

/**
 * Transforma fatos não contabilizados em lançamentos.
 *
 * Cada fato vira um lançamento próprio, e não um lançamento agregado por mês.
 * Agregar seria mais enxuto e tiraria a única coisa que faz o razão auditável:
 * a capacidade de olhar uma linha do balancete e chegar na ordem de serviço que
 * a gerou.
 *
 * Um fato que falha não derruba os outros. O motivo fica no retorno — quase
 * sempre é período fechado, e a resposta certa é lançar no mês seguinte, o que
 * é decisão de quem responde pelo livro.
 */
export function postar(fed, { ator, limite = 500, competencia = null } = {}) {
  const central = fed.abrirCentral();
  const sql = central.sistema();

  const cond = ['lancamento_id is null'];
  const params = [];
  if (competencia) {
    cond.push("substr(ocorrido_em, 1, 7) = ?");
    params.push(competencia);
  }

  const pendentes = sql.prepare(
    `select * from erp_fatos where ${cond.join(' and ')} order by ocorrido_em limit ?`,
  ).all(...params, limite);

  const feito = { postados: 0, valor: 0, recusados: [], porInstancia: {} };

  for (const f of pendentes) {
    const dados = JSON.parse(f.payload ?? '{}');
    const valor = Number(dados.valor_centavos ?? 0);
    if (!Number.isInteger(valor) || valor <= 0) {
      feito.recusados.push({ id: f.id, ref: f.ref, motivo: 'valor_invalido' });
      continue;
    }

    const conta = CONTA_RECEITA[f.instancia] ?? RECEITA_PADRAO;
    const rotulo = COLETORES[f.tipo]?.nome ?? f.tipo;
    const descricao = `${rotulo}${dados.numero ? ` ${dados.numero}` : ''}`
      + `${dados.cliente ? ` — ${dados.cliente}` : ''}`;
    const dia = String(f.ocorrido_em).slice(0, 10);

    try {
      /*
       * O título, o lançamento e a marca de contabilizado vão na MESMA
       * transação. Se o processo cair no meio, o fato voltaria a parecer
       * pendente e o próximo ciclo lançaria de novo — receita dobrada, e sem
       * rastro do porquê. `abrirTitulo` já roda a sua transação; esta chamada
       * fica fora de outra para o SQLite não recusar o aninhamento.
       */
      const t = abrirTitulo(central, {
        instancia: f.instancia,
        natureza: 'receber',
        descricao,
        numero: dados.numero ?? null,
        emissao: dia,
        // Vencimento na entrega: o sistema não conhece prazo combinado, e
        // inventar trinta dias esconderia atraso que já existe.
        vencimento: dia,
        valor,
        conta,
        origem: f.tipo,
        origemRef: f.ref,
        ator,
      });
      sql.prepare('update erp_fatos set lancamento_id = ? where id = ?').run(t.lancamentoId, f.id);

      feito.postados += 1;
      feito.valor += valor;
      const pi = (feito.porInstancia[f.instancia] ??= { postados: 0, valor: 0 });
      pi.postados += 1;
      pi.valor += valor;
    } catch (e) {
      feito.recusados.push({
        id: f.id,
        ref: f.ref,
        instancia: f.instancia,
        motivo: e instanceof ErroContabil ? e.codigo : 'erro',
        mensagem: e.message,
      });
    }
  }

  feito.pendentesRestantes = sql.prepare(
    'select count(*) as n from erp_fatos where lancamento_id is null').get().n;
  return feito;
}

/** Colher e postar, que é o que um ciclo de sincronização faz. */
export function sincronizar(fed, { ator = 'sistema', codigos = null } = {}) {
  const colheita = colher(fed, { codigos, ator });
  const postagem = postar(fed, { ator });
  return {
    colheita,
    postagem,
    // A completude atravessa: uma sincronização que não alcançou uma instância
    // não produziu um razão completo, por mais que a postagem tenha ido bem.
    completo: colheita.completo,
  };
}

/** O que está pendente ou divergente — a fila que alguém precisa olhar. */
export function pendencias(sql) {
  return {
    naoContabilizados: sql.prepare(
      `select instancia, tipo, count(*) as n,
              sum(json_extract(payload, '$.valor_centavos')) as valor
         from erp_fatos where lancamento_id is null
        group by instancia, tipo`,
    ).all(),
    divergentes: sql.prepare(
      `select f.*, l.historico from erp_fatos f
         left join erp_lancamentos l on l.id = f.lancamento_id
        where f.divergente_em is not null
        order by f.divergente_em desc limit 100`,
    ).all(),
    ultimaLeitura: sql.prepare('select max(lido_em) as em from erp_fatos').get()?.em ?? null,
  };
}

/**
 * Reconhece a divergência: aceita o novo valor, estornando e relançando.
 *
 * É a única porta que existe para resolver uma divergência, e ela passa pelo
 * estorno — não há caminho neste módulo que altere um lançamento já feito.
 */
export function reconhecerDivergencia(fed, { fatoId, ator, data = null }) {
  const central = fed.abrirCentral();
  const sql = central.sistema();
  const f = sql.prepare('select * from erp_fatos where id = ?').get(fatoId);
  if (!f) throw new ErroContabil('nao_encontrado', 'Fato não encontrado.');
  if (!f.divergente_em) throw new ErroContabil('sem_divergencia', 'Este fato não está divergente.');

  /*
   * Três passos, nesta ordem, e o do meio é o que eu tinha esquecido.
   *
   * A marcação de divergência NÃO atualiza o payload — de propósito, para o
   * fato contabilizado guardar exatamente o que foi lançado. O efeito é que,
   * depois do estorno, o fato volta à fila ainda com o valor VELHO: a próxima
   * postagem relançaria o mesmo número, e o reconhecimento não reconheceria
   * nada.
   *
   * Por isso reler a origem faz parte de reconhecer. Aceitar a correção é,
   * literalmente, ir buscar o valor corrigido.
   */
  const est = central.transacao(() => {
    const r = estornar(sql, {
      lancamentoId: f.lancamento_id,
      data: data ?? agora().slice(0, 10),
      motivo: `Origem corrigida: ${f.divergencia}`,
      ator,
    });
    sql.prepare(
      'update erp_fatos set lancamento_id = null, divergente_em = null, divergencia = null where id = ?',
    ).run(f.id);
    return r;
  });

  // Fora da transação: `colher` abre a sua, e SQLite não aninha transação.
  const releitura = colher(fed, { codigos: [f.instancia], ator });

  return {
    estornoId: est.id,
    fatoId: f.id,
    competencia: est.competencia,
    releitura: { atualizados: releitura.atualizados, completo: releitura.completo },
  };
}
