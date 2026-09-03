/**
 * Instância central — o lugar onde todo lead de toda fonte se encontra.
 *
 * O pedido que ela atende: as empresas operam separadas, cada uma no seu
 * sistema, mas o dono quer UMA tela com tudo. Sem a central, isso obrigaria
 * cada consulta de grupo a varrer três bancos ao vivo — o que funciona hoje,
 * com três empresas na mesma máquina, e deixa de funcionar quando forem oito
 * espalhadas por VPS diferentes.
 *
 * A central é, então, uma projeção de leitura. Duas propriedades que a
 * mantêm honesta:
 *
 * NUNCA É FONTE DE VERDADE. Nada é criado nem editado aqui. Se a central
 * discordar de uma instância, a instância está certa e a central está velha.
 * Por isso cada linha carrega `sincronizado_em`: quem lê sabe a idade do que
 * está vendo, em vez de supor que é agora.
 *
 * A SINCRONIZAÇÃO É IDEMPOTENTE. Rodar duas vezes seguidas produz o mesmo
 * resultado — a chave é (instância, cliente), e reprocessar atualiza em vez de
 * duplicar. Sem isso, um cron que roda duas vezes por engano dobra a base do
 * grupo e ninguém percebe até o relatório do mês.
 */

import { randomBytes } from 'node:crypto';
import { agora, novoId } from './db.mjs';
import { metaDe } from './federacao.mjs';

/**
 * Puxa os leads de cada instância para a central.
 *
 * O SELECT junta cliente + atribuição + a oportunidade mais recente, porque é
 * essa a pergunta que a tela do grupo faz: quem é, de onde veio e em que pé
 * está. Fazer três consultas e casar em memória seria mais fácil de ler e
 * multiplicaria por três o custo em cada instância remota.
 */
export function sincronizarCentral(fed, { codigos = null } = {}) {
  const central = fed.abrirCentral();
  const sql = central.sistema();
  const alvos = codigos ?? fed.codigosDeEmpresa();
  const inicio = agora();

  let total = 0;
  const porInstancia = [];

  for (const cod of alvos) {
    const execucao = novoId();
    sql.prepare('insert into sincronizacoes (id, instancia, linhas, iniciado_em) values (?,?,?,?)')
      .run(execucao, cod, 0, inicio);

    try {
      const banco = fed.abrir(cod);
      const emp = banco.sistema().prepare('select id, nome from empresas limit 1').get();
      if (!emp) throw new Error('instância sem empresa');

      const linhas = banco.para(emp.id).todas(
        `select c.id, c.nome, c.telefone, c.email, c.cidade, c.perfil, c.origem,
                c.consentimento_lgpd, c.criado_em,
                a.plataforma, a.gclid, a.fbclid, a.utm_campaign,
                (select o.etapa from oportunidades o
                  where o.cliente_id = c.id order by o.atualizado_em desc limit 1) etapa,
                (select coalesce(sum(o.valor_centavos),0) from oportunidades o
                  where o.cliente_id = c.id and o.etapa = 'ganho') ganho_centavos
         from clientes c
         left join atribuicoes a on a.cliente_id = c.id and a.toque = 'primeiro'
         where c.{ESCOPO}`,
      );

      // Uma transação por instância: 300 linhas em 300 commits é o mesmo erro
      // que já custou 25 segundos na carga inicial.
      central.transacao(() => {
        for (const l of linhas) {
          const registro = {
            instancia: cod,
            empresa_nome: emp.nome,
            cliente_id: l.id,
            nome: l.nome,
            telefone: l.telefone,
            email: l.email,
            cidade: l.cidade,
            perfil: l.perfil,
            fonte: l.origem ?? 'desconhecida',
            plataforma: l.plataforma,
            gclid: l.gclid,
            fbclid: l.fbclid,
            utm_campaign: l.utm_campaign,
            etapa: l.etapa,
            valor_centavos: l.ganho_centavos ?? 0,
            consentimento: l.consentimento_lgpd,
            criado_em: l.criado_em,
            sincronizado_em: agora(),
          };

          // Índice único é PARCIAL na prática (cliente_id pode ser nulo em lead
          // que ainda não virou cliente), e `on conflict` não casa contra
          // índice parcial. Select explícito e depois update ou insert — a
          // armadilha que já custou uma noite em outro sistema.
          const existente = sql
            .prepare('select id from leads_consolidados where instancia = ? and cliente_id = ?')
            .get(cod, l.id);

          if (existente) {
            const cols = Object.keys(registro);
            sql.prepare(
              `update leads_consolidados set ${cols.map((c) => `${c} = ?`).join(', ')} where id = ?`,
            ).run(...cols.map((c) => registro[c]), existente.id);
          } else {
            const cols = ['id', ...Object.keys(registro)];
            sql.prepare(
              `insert into leads_consolidados (${cols.join(', ')})
               values (${cols.map(() => '?').join(', ')})`,
            ).run(novoId(), ...Object.keys(registro).map((c) => registro[c]));
          }
        }
      });

      total += linhas.length;
      porInstancia.push({ instancia: cod, linhas: linhas.length, erro: null });
      sql.prepare('update sincronizacoes set linhas = ?, concluido_em = ? where id = ?')
        .run(linhas.length, agora(), execucao);
    } catch (e) {
      porInstancia.push({ instancia: cod, linhas: 0, erro: e.message });
      sql.prepare('update sincronizacoes set concluido_em = ?, erro = ? where id = ?')
        .run(agora(), e.message, execucao);
    }
  }

  return { linhas: total, porInstancia, iniciadoEm: inicio, concluidoEm: agora() };
}

/** Leitura consolidada, com filtros de tela. */
export function consultarConsolidado(central, { q = '', instancia = '', fonte = '', plataforma = '', limite = 300 } = {}) {
  let sql = 'select * from leads_consolidados where 1 = 1';
  const params = [];

  if (q) {
    sql += ' and (lower(nome) like ? or telefone like ? or lower(coalesce(email,\'\')) like ?)';
    const t = `%${q.toLowerCase()}%`;
    params.push(t, t, t);
  }
  if (instancia) { sql += ' and instancia = ?'; params.push(instancia.toUpperCase()); }
  if (fonte) { sql += ' and fonte = ?'; params.push(fonte); }
  if (plataforma) { sql += ' and plataforma = ?'; params.push(plataforma); }

  sql += ' order by criado_em desc limit ?';
  params.push(Math.min(Number(limite) || 300, 1000));

  return central.sistema().prepare(sql).all(...params);
}

/** Números do topo da tela consolidada. */
export function resumoConsolidado(central) {
  const sql = central.sistema();
  const um = (q, ...p) => sql.prepare(q).get(...p);

  return {
    total: um('select count(*) as n from leads_consolidados').n,
    comConsentimento: um('select count(*) as n from leads_consolidados where consentimento = 1').n,
    porInstancia: sql.prepare(
      `select instancia, empresa_nome, count(*) as n,
              coalesce(sum(valor_centavos),0) as ganho
       from leads_consolidados group by instancia, empresa_nome order by instancia`,
    ).all().map((r) => ({ ...r, nicho: metaDe(r.instancia)?.nicho ?? null })),
    porPlataforma: sql.prepare(
      `select coalesce(plataforma,'sem_atribuicao') as plataforma, count(*) as n,
              coalesce(sum(valor_centavos),0) as ganho
       from leads_consolidados group by 1 order by n desc`,
    ).all(),
    porFonte: sql.prepare(
      'select fonte, count(*) as n from leads_consolidados group by fonte order by n desc limit 12',
    ).all(),
    ultimaSincronizacao: um(
      'select max(concluido_em) as em from sincronizacoes where erro is null',
    )?.em ?? null,
  };
}

/**
 * Recebe um lead de fonte externa e decide de quem ele é.
 *
 * O roteamento é por regra declarada, não por adivinhação: a fonte diz o
 * destino, ou o formulário diz, ou cai numa instância padrão. Errar o destino
 * é pior que não rotear — um lead de tinta na fila da oficina some, porque
 * ninguém daquela equipe reconhece o assunto.
 */
export function receberLead(central, { fonte, payload = {}, destino = null }) {
  const atr = payload.atribuicao ?? {};
  const id = novoId();

  const escolhido = destino ? String(destino).toUpperCase() : null;
  const valido = escolhido && metaDe(escolhido) ? escolhido : null;

  central.sistema().prepare(
    `insert into entrada_leads (id, fonte, destino, payload, gclid, fbclid, utm_campaign,
                                status, motivo, recebido_em, roteado_em)
     values (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, String(fonte ?? 'desconhecida'), valido, JSON.stringify(payload),
    atr.gclid ?? null, atr.fbclid ?? null, atr.utm_campaign ?? null,
    valido ? 'roteado' : 'recebido',
    valido ? null : 'sem destino declarado — aguardando triagem',
    agora(), valido ? agora() : null,
  );

  return { id, destino: valido, status: valido ? 'roteado' : 'recebido' };
}

/* ── Chaves de captação — a porta pública ─────────────────────────────────── */

/**
 * Garante uma chave por empresa. Idempotente: rodar de novo preserva a que já
 * existe.
 *
 * Preservar importa mais do que parece — a chave vai colada no HTML do site do
 * cliente. Regenerar a cada subida do serviço quebraria silenciosamente todo
 * formulário publicado, e o sintoma seria "paramos de receber lead", dias
 * depois, sem erro em lugar nenhum.
 */
export function garantirChaves(central, empresas) {
  const sis = central.sistema();
  const saida = [];
  for (const e of empresas) {
    const existente = sis.prepare(
      'select * from chaves_captacao where codigo = ? order by criada_em limit 1',
    ).get(e.codigo);

    if (existente) { saida.push(existente); continue; }

    // Na federacao atual a instancia E o codigo (ver federacao.mjs). O campo
    // fica separado na tabela porque uma instancia pode vir a hospedar mais
    // de uma empresa — e ai os dois deixam de coincidir.
    const chave = `${e.codigo.toLowerCase()}_${randomBytes(16).toString('hex')}`;
    sis.prepare(
      `insert into chaves_captacao (chave, instancia, codigo, nome, canal, ativa, criada_em)
       values (?,?,?,?,?,1,?)`,
    ).run(chave, e.instancia ?? e.codigo, e.codigo, `Captação — ${e.nome}`, null, agora());
    saida.push(sis.prepare('select * from chaves_captacao where chave = ?').get(chave));
  }
  return saida;
}

export function listarChaves(central, codigo = null) {
  const sis = central.sistema();
  return codigo
    ? sis.prepare('select * from chaves_captacao where codigo = ? order by criada_em').all(codigo)
    : sis.prepare('select * from chaves_captacao order by codigo, criada_em').all();
}

/**
 * Resolve uma chave e contabiliza o uso.
 *
 * Retorna `null` tanto para chave inexistente quanto para chave desativada, e
 * quem chama devolve a MESMA resposta nos dois casos. Distinguir transformaria
 * a porta num oráculo: dá para descobrir quais chaves existem testando.
 */
export function resolverChave(central, chave) {
  const sis = central.sistema();
  const achada = sis.prepare(
    'select * from chaves_captacao where chave = ? and ativa = 1',
  ).get(String(chave ?? ''));
  if (!achada) return null;

  sis.prepare(
    'update chaves_captacao set usos = usos + 1, ultimo_uso_em = ? where chave = ?',
  ).run(agora(), achada.chave);
  return achada;
}
