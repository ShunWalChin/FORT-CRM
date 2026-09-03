/**
 * Rotas do CRM. Envelope de resposta canônico, escopo de empresa resolvido do
 * token — nunca do corpo da requisição, que é o erro clássico que fura
 * multi-tenant — e nenhum efeito externo enquanto DEMO_MODE estiver ligado.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { agora, novoId } from './db.mjs';
import { avaliarCompliance, comRodape, POLITICAS_CANAL, EXPLICACAO_MOTIVO } from './compliance.mjs';
import { GATILHOS, projetarRevisao, renderizar, saudacao } from './regua.mjs';
import { laudoHtml } from './laudo.mjs';
import { semear } from './seed.mjs';
import { DEMO_MODE } from './api-modo.mjs';
import { consultarConsolidado, garantirChaves, listarChaves, receberLead, resolverChave, resumoConsolidado, sincronizarCentral } from './central.mjs';
import { canaisDe, diagnosticar, empresaDoNumero, rotularOrigem, PERGUNTA_ORIGEM, RESPOSTAS_ORIGEM, TIPOS } from './canais.mjs';
import { extrairMensagens, responderDesafio, validarAssinatura, LOCAIS_CONVERSAO } from './ctwa.mjs';
import { CATALOGO } from './federacao.mjs';
import { despacharConversoes, drenarEventos, registrarMudancaDeEtapa } from './conversoes-servico.mjs';
import { extrairAtribuicao, identificadoresHash, temSinal } from './atribuicao.mjs';
import { EVENTOS } from './conversoes.mjs';
import { reancorar, diagnosticoDaAncora } from './reancorar.mjs';
import { avaliarForca, hashSenha, verificarSenha } from './senha.mjs';

const SEGREDO = process.env.FORTCRM_SECRET ?? randomUUID();
export { DEMO_MODE } from './api-modo.mjs';

const ETAPAS = ['novo', 'qualificado', 'orcamento', 'negociacao', 'ganho', 'perdido'];
const BLOCKLIST = ['clique aqui para ganhar', 'promoção imperdível', 'renda extra'];

// ── Envelope ────────────────────────────────────────────────────────────────
export const ok = (dados, meta) => ({ ok: true, dados, ...(meta ? { meta } : {}) });
export const erro = (codigo, mensagem, detalhe) => ({
  ok: false, erro: { codigo, mensagem, ...(detalhe ? { detalhe } : {}) },
});

export class ErroHttp extends Error {
  constructor(status, codigo, mensagem, detalhe) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

// ── Token ───────────────────────────────────────────────────────────────────
function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', SEGREDO).update(corpo).digest('base64url');
  return `${corpo}.${mac}`;
}

function verificar(token) {
  const [corpo, mac] = String(token ?? '').split('.');
  if (!corpo || !mac) return null;
  const esperado = createHmac('sha256', SEGREDO).update(corpo).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

// ── Contexto da requisição ──────────────────────────────────────────────────
/**
 * Resolve usuário e empresa. A empresa vem do cabeçalho, mas só é aceita se
 * constar nas memberships do token — o cliente não escolhe o tenant, ele
 * escolhe entre os tenants que já são dele.
 */
function contexto(fed, req, { exigeEmpresa = true, url = null } = {}) {
  // O laudo abre em aba nova por link direto, e um link não carrega cabeçalho.
  // Só nessa situação o token é aceito na query — e a rota é somente leitura.
  const header = req.headers.authorization ?? '';
  const doHeader = header.replace(/^Bearer\s+/i, '');
  const sessao = verificar(doHeader || url?.searchParams.get('t') || '');
  if (!sessao) throw new ErroHttp(401, 'nao_autenticado', 'Sessão ausente ou expirada.');

  const email = String(sessao.sub ?? '').toLowerCase();

  /*
   * Identidade é federada pelo e-mail; autorização é POR INSTÂNCIA.
   *
   * Cada instância guarda o seu próprio vínculo de usuário, e é ela quem diz
   * se aquele e-mail entra. Não existe diretório central de identidade nesta
   * fase — e inventar um aqui seria fingir uma garantia que não temos, além de
   * criar exatamente o ponto único de falha que a separação por instância
   * existe para evitar.
   *
   * Instância fora do ar não invalida a sessão: ela some da lista, as outras
   * seguem. Numa federação em que cada empresa pode estar noutra máquina,
   * indisponibilidade de uma é evento normal, não erro de autenticação.
   */
  const permitidas = [];
  for (const cod of fed.codigosDeEmpresa()) {
    try {
      const b = fed.abrir(cod);
      const u = b.sistema()
        .prepare('select id, nome, email, papel from usuarios where lower(email) = ?')
        .get(email);
      if (!u) continue;
      const emp = b.sistema()
        .prepare('select id, codigo, nome, segmento, cor, whatsapp, cidade from empresas limit 1')
        .get();
      if (emp) {
        permitidas.push({
          ...emp, instancia: cod, papel: u.papel, usuarioId: u.id, usuarioNome: u.nome,
        });
      }
    } catch { /* instância indisponível não derruba a sessão */ }
  }
  if (!permitidas.length) {
    throw new ErroHttp(401, 'nao_autenticado', 'Usuário sem acesso a nenhuma instância.');
  }

  const pedida = String(
    req.headers['x-instancia'] ?? url?.searchParams.get('i') ?? '',
  ).toUpperCase();
  const pedidaId = req.headers['x-empresa'] ?? url?.searchParams.get('e') ?? null;

  let empresa = null;
  if (pedida && pedida !== 'GRUPO') {
    empresa = permitidas.find((e) => e.instancia === pedida) ?? null;
    if (!empresa) throw new ErroHttp(403, 'instancia_negada', 'Sem acesso a esta instância.');
  } else if (pedidaId) {
    empresa = permitidas.find((e) => e.id === pedidaId) ?? null;
    if (!empresa) throw new ErroHttp(403, 'instancia_negada', 'Sem acesso a esta instância.');
  } else if (exigeEmpresa) {
    empresa = permitidas[0];
  }
  if (exigeEmpresa && !empresa) {
    throw new ErroHttp(400, 'instancia_ausente', 'Nenhuma instância no contexto.');
  }

  const banco = empresa ? fed.abrir(empresa.instancia) : null;
  const base = empresa ?? permitidas[0];
  const usuario = {
    id: base.usuarioId, nome: base.usuarioNome, email, papel: base.papel,
  };

  return {
    usuario, empresa, permitidas, fed, banco,
    escopo: empresa ? banco.para(empresa.id) : null,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const num = (v, padrao = 0) => (Number.isFinite(Number(v)) ? Number(v) : padrao);

function canalPreferido(escopo) {
  const canais = escopo.todas('select * from canais where {ESCOPO} order by conectado desc');
  return canais.find((c) => c.tipo.startsWith('whatsapp')) ?? canais[0] ?? null;
}

/**
 * Monta a fila da régua: percorre os gatilhos da empresa, coleta candidatos e
 * submete cada um ao compliance ANTES de mostrar na tela. O operador vê o que
 * sairia e o que não sairia, com o motivo — que é exatamente a conversa que se
 * quer ter numa reunião de venda.
 */
function montarRegua(banco, escopo, empresa, { incluirBloqueados = true } = {}) {
  const refMs = Date.now();
  const clientes = escopo.todas('select * from clientes where {ESCOPO}');
  const ctx = {
    refMs,
    clientes,
    clientePorId: new Map(clientes.map((c) => [c.id, c])),
    veiculos: escopo.todas('select * from veiculos where {ESCOPO}'),
    veiculoPorId: new Map(),
    ordens: escopo.todas('select * from ordens_servico where {ESCOPO}'),
    pedidos: escopo.todas('select * from pedidos where {ESCOPO}'),
    oportunidades: escopo.todas('select * from oportunidades where {ESCOPO}'),
  };
  ctx.veiculoPorId = new Map(ctx.veiculos.map((v) => [v.id, v]));

  const configurados = escopo.todas('select * from gatilhos where {ESCOPO} and ativo = 1');
  const canal = canalPreferido(escopo);
  const politica = canal ? POLITICAS_CANAL[canal.tipo] : null;
  const fila = [];

  const peso = { vencido: 0, alta: 1, media: 2, baixa: 3 };

  for (const g of configurados) {
    const motor = GATILHOS[g.chave];
    if (!motor) continue;

    /*
     * Um gatilho fala UMA vez com cada contato por ciclo de cooldown, e a chave
     * de idempotência é (gatilho, cliente, dia). Um cliente com três caminhões
     * gera três candidatos no mesmo gatilho — mas eles disputam a mesma chave,
     * então dois seriam engolidos como repetição depois de aparecerem na tela
     * como linhas separadas e selecionáveis.
     *
     * A dedupe acontece aqui, antes de montar a fila: fica o caso mais urgente,
     * e os demais viram menção no contexto. Assim a tela mostra exatamente o
     * que vai sair — que é a única coisa que a tela precisa fazer certo.
     */
    const porContato = new Map();
    for (const cand of motor.buscar(ctx)) {
      const chave = cand.cliente.id;
      const atual = porContato.get(chave);
      if (!atual) {
        porContato.set(chave, { ...cand, agrupados: 0 });
      } else if ((peso[cand.urgencia] ?? 9) < (peso[atual.urgencia] ?? 9)) {
        porContato.set(chave, { ...cand, agrupados: atual.agrupados + 1 });
      } else {
        atual.agrupados += 1;
      }
    }

    for (const cand of porContato.values()) {
      const variaveis = {
        ...cand.variaveis,
        saudacao: saudacao(cand.cliente, refMs),
        nome: cand.cliente.nome,
        empresa: empresa.nome,
      };
      const corpo = comRodape(renderizar(g.template, variaveis));

      const ultimo = escopo.uma(
        `select criado_em from disparos
         where {ESCOPO} and cliente_id = ? and gatilho_chave = ? and status in ('sent','claimed')
         order by criado_em desc limit 1`,
        cand.cliente.id, g.chave,
      );

      const decisao = avaliarCompliance({
        canalTipo: canal?.tipo ?? 'whatsapp_evolution',
        canalConectado: Boolean(canal?.conectado),
        corpo,
        automatizado: true,
        consentimento: Boolean(cand.cliente.consentimento_lgpd),
        optOutEm: cand.cliente.opt_out_em,
        ultimoInboundEm: cand.cliente.ultimo_inbound_em,
        ultimoDisparoDoGatilhoEm: ultimo?.criado_em ?? null,
        cooldownMs: g.cooldown_dias * 24 * 60 * 60 * 1000,
        temTemplateAprovado: Boolean(politica?.aceitaTemplateForaDaJanela),
        blocklist: BLOCKLIST,
        agoraMs: refMs,
      });

      if (!decisao.permitido && !incluirBloqueados) continue;

      fila.push({
        id: `${g.chave}:${cand.cliente.id}`,
        gatilho: { chave: g.chave, nome: g.nome, regra: g.regra },
        cliente: {
          id: cand.cliente.id, nome: cand.cliente.nome, telefone: cand.cliente.telefone,
          perfil: cand.cliente.perfil, cidade: cand.cliente.cidade,
        },
        canal: canal ? { tipo: canal.tipo, nome: canal.nome, conectado: !!canal.conectado } : null,
        urgencia: cand.urgencia,
        vencimentoEm: cand.vencimentoEm,
        contexto: cand.agrupados
          ? `${cand.contexto} · e mais ${cand.agrupados} caso(s) do mesmo cliente neste gatilho`
          : cand.contexto,
        corpo,
        decisao,
      });
    }
  }

  fila.sort((a, b) => {
    if (a.decisao.permitido !== b.decisao.permitido) return a.decisao.permitido ? -1 : 1;
    return (peso[a.urgencia] ?? 9) - (peso[b.urgencia] ?? 9);
  });
  return fila;
}

// ── Rotas ───────────────────────────────────────────────────────────────────
export const ROTAS = {
  /**
   * Login federado: as credenciais são conferidas em CADA instância, e o
   * usuário entra com a lista das que o aceitaram. Uma senha trocada só na
   * oficina derruba o acesso dele à oficina, e não ao grupo inteiro — que é
   * o comportamento correto quando os sistemas são de fato separados.
   */
  'POST /api/sessao': (fed, req, _p, corpo) => {
    const email = String(corpo?.email ?? '').trim().toLowerCase();
    const senha = String(corpo?.senha ?? '');

    const empresas = [];
    let identidade = null;

    for (const cod of fed.codigosDeEmpresa()) {
      try {
        const b = fed.abrir(cod);
        const u = b.sistema().prepare('select * from usuarios where lower(email) = ?').get(email);
        if (!u || !verificarSenha(senha, u.senha)) continue;

        identidade ??= u;
        const emp = b.sistema()
          .prepare('select id, codigo, nome, segmento, cor, cidade from empresas limit 1')
          .get();
        if (emp) empresas.push({ ...emp, instancia: cod, papel: u.papel });

        b.auditar({
          empresaId: emp?.id ?? null, ator: u.email, acao: 'sessao.abrir',
          entidade: 'usuarios', entidadeId: u.id,
        });
      } catch { /* instância fora do ar não impede entrar nas outras */ }
    }

    if (!identidade) {
      throw new ErroHttp(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
    }

    return ok({
      // O token carrega o e-mail, não um id de usuário: o mesmo e-mail tem id
      // diferente em cada instância, e amarrar a sessão a um deles quebraria
      // a troca de instância.
      token: assinar({ sub: email, exp: Date.now() + 12 * 60 * 60 * 1000 }),
      usuario: { nome: identidade.nome, email, papel: identidade.papel },
      empresas,
      demoMode: DEMO_MODE,
    });
  },

  'GET /api/sessao': (fed, req) => {
    const c = contexto(fed, req, { exigeEmpresa: false });
    return ok({
      usuario: c.usuario, empresas: c.permitidas, empresa: c.empresa, demoMode: DEMO_MODE,
    });
  },

  // ── Painel ───────────────────────────────────────────────────────────────
  'GET /api/painel': (fed, req) => {
    const { escopo, empresa, banco } = contexto(fed, req);
    const fila = montarRegua(banco, escopo, empresa);
    const pond = escopo.todas(
      `select etapa, count(*) n, coalesce(sum(valor_centavos),0) total,
              coalesce(sum(valor_centavos * probabilidade / 100.0),0) ponderado
       from oportunidades where {ESCOPO} group by etapa`,
    );

    const veiculos = escopo.todas('select * from veiculos where {ESCOPO}');
    const revisoesVencendo = veiculos
      .map((v) => projetarRevisao(v, Date.now()))
      .filter((p) => p && p.diasFaltando <= 30).length;

    return ok({
      empresa,
      base: {
        clientes: escopo.contar('clientes'),
        comConsentimento: escopo.contar('clientes', 'and consentimento_lgpd = 1'),
        optOut: escopo.contar('clientes', 'and opt_out_em is not null'),
        veiculos: veiculos.length,
      },
      operacao: {
        osAbertas: escopo.contar('ordens_servico', "and status in ('aberta','em_bancada')"),
        osConcluidas30d: escopo.contar(
          'ordens_servico', "and status = 'concluida' and concluida_em >= ?", iso(30),
        ),
        receitaOs30d: escopo.somar(
          'ordens_servico', 'valor_centavos', "and status = 'concluida' and concluida_em >= ?", iso(30),
        ),
        pedidos30d: escopo.contar('pedidos', 'and feito_em >= ?', iso(30)),
        receitaPedidos30d: escopo.somar('pedidos', 'valor_centavos', 'and feito_em >= ?', iso(30)),
        revisoesVencendo,
      },
      pipeline: {
        porEtapa: ETAPAS.map((etapa) => {
          const r = pond.find((p) => p.etapa === etapa);
          return { etapa, n: r?.n ?? 0, total: r?.total ?? 0, ponderado: Math.round(r?.ponderado ?? 0) };
        }),
        abertoTotal: pond.filter((p) => !['ganho', 'perdido'].includes(p.etapa))
          .reduce((s, p) => s + p.total, 0),
        abertoPonderado: Math.round(
          pond.filter((p) => !['ganho', 'perdido'].includes(p.etapa))
            .reduce((s, p) => s + p.ponderado, 0),
        ),
      },
      regua: {
        total: fila.length,
        liberados: fila.filter((f) => f.decisao.permitido).length,
        bloqueados: fila.filter((f) => !f.decisao.permitido).length,
        porGatilho: Object.values(
          fila.reduce((acc, f) => {
            acc[f.gatilho.chave] ??= { chave: f.gatilho.chave, nome: f.gatilho.nome, n: 0, liberados: 0 };
            acc[f.gatilho.chave].n += 1;
            if (f.decisao.permitido) acc[f.gatilho.chave].liberados += 1;
            return acc;
          }, {}),
        ).sort((a, b) => b.n - a.n),
      },
      disparos: {
        ultimos7d: escopo.contar('disparos', 'and criado_em >= ?', iso(7)),
        enviados: escopo.contar('disparos', "and status = 'sent'"),
        bloqueados: escopo.contar('disparos', "and status = 'blocked'"),
        desconhecidos: escopo.contar('disparos', "and status = 'unknown'"),
      },
    });
  },

  /**
   * Visão consolidada do grupo. Atravessa a fronteira de propósito e por isso
   * exige motivo textual, que fica registrado na auditoria.
   */
  'GET /api/painel/grupo': (fed, req) => {
    const c = contexto(fed, req, { exigeEmpresa: false });
    const motivo = 'painel consolidado do grupo solicitado pelo gestor';
    const desde = iso(30);

    /*
     * Aqui a consulta atravessa BANCOS, não linhas.
     *
     * Antes, o consolidado era um SELECT com subqueries sobre uma tabela
     * `empresas` compartilhada. Com uma instância por empresa isso deixou de
     * existir: cada número vem de um arquivo diferente, e é a federação que
     * junta. O ganho não é de desempenho — é que uma consulta mal escrita
     * deixou de poder vazar de uma empresa para a outra, porque a linha da
     * outra não está no arquivo.
     */
    const codigos = c.permitidas.map((e) => e.instancia);
    const partes = fed.emCada(codigos, (banco, meta) => {
      const emp = banco.sistema().prepare('select id, codigo, nome, cor from empresas limit 1').get();
      if (!emp) return null;
      const escopo = banco.para(emp.id);

      // A leitura consolidada continua exigindo motivo declarado, mesmo com o
      // isolamento já sendo físico: quem lê o grupo inteiro precisa dizer por
      // quê, e isso fica na auditoria de cada instância.
      banco.grupo(motivo);
      banco.auditar({
        empresaId: emp.id, ator: c.usuario.email, acao: 'painel.grupo.ler',
        entidade: 'empresas', entidadeId: emp.id, dados: { motivo },
      });

      return {
        ...emp,
        instancia: meta?.codigo ?? emp.codigo,
        nicho: meta?.nicho ?? null,
        clientes: escopo.contar('clientes'),
        consentidos: escopo.contar('clientes', 'and consentimento_lgpd = 1'),
        veiculos: escopo.contar('veiculos'),
        receita_os_30d: escopo.somar(
          'ordens_servico', 'valor_centavos',
          "and status = 'concluida' and concluida_em >= ?", desde,
        ),
        receita_pedidos_30d: escopo.somar('pedidos', 'valor_centavos', 'and feito_em >= ?', desde),
        pipeline_aberto: escopo.somar(
          'oportunidades', 'valor_centavos', "and etapa not in ('ganho','perdido')",
        ),
        conversoes_pendentes: escopo.contar('conversoes', "and status = 'pendente'"),
      };
    });

    const empresas = partes.filter((p) => !p.erro && p.dados).map((p) => p.dados);
    const indisponiveis = partes.filter((p) => p.erro)
      .map((p) => ({ instancia: p.instancia, erro: p.erro }));

    const soma = (k) => empresas.reduce((t, l) => t + (l[k] ?? 0), 0);
    return ok({
      motivo,
      empresas,
      // Instância fora do ar aparece declarada, nunca sumida em silêncio: um
      // consolidado que esconde a filial faltante mente sobre o total.
      indisponiveis,
      consolidado: {
        instancias: empresas.length,
        clientes: soma('clientes'),
        consentidos: soma('consentidos'),
        veiculos: soma('veiculos'),
        receita30d: soma('receita_os_30d') + soma('receita_pedidos_30d'),
        pipelineAberto: soma('pipeline_aberto'),
        conversoesPendentes: soma('conversoes_pendentes'),
      },
    });
  },

  // ── Clientes ─────────────────────────────────────────────────────────────
  'GET /api/clientes': (fed, req, _p, _c, url) => {
    const { escopo, banco } = contexto(fed, req);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const perfil = url.searchParams.get('perfil');

    let sql = 'select * from clientes where {ESCOPO}';
    const params = [];
    if (q) {
      sql += ' and (lower(nome) like ? or telefone like ? or lower(coalesce(email,\'\')) like ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (perfil) { sql += ' and perfil = ?'; params.push(perfil); }
    sql += ' order by nome limit 300';

    return ok(escopo.todas(sql, ...params));
  },

  'GET /api/clientes/:id': (fed, req, p) => {
    const { escopo, banco, empresa } = contexto(fed, req);
    const cliente = escopo.uma('select * from clientes where {ESCOPO} and id = ?', p.id);
    if (!cliente) throw new ErroHttp(404, 'nao_encontrado', 'Cliente não encontrado.');

    const veiculos = escopo.todas('select * from veiculos where {ESCOPO} and cliente_id = ? order by placa', p.id)
      .map((v) => ({ ...v, revisao: projetarRevisao(v, Date.now()) }));

    return ok({
      cliente,
      // A ficha mostrava `origem: 'guincho_24h'` cru. Rotular aqui, e não no
      // navegador, mantém o catálogo como fonte única.
      origem: rotularOrigem(empresa.codigo, cliente.origem),
      veiculos,
      ordens: escopo.todas(
        'select * from ordens_servico where {ESCOPO} and cliente_id = ? order by aberta_em desc', p.id),
      pedidos: escopo.todas(
        'select * from pedidos where {ESCOPO} and cliente_id = ? order by feito_em desc', p.id),
      oportunidades: escopo.todas(
        'select * from oportunidades where {ESCOPO} and cliente_id = ? order by atualizado_em desc', p.id),
      atividades: escopo.todas(
        'select * from atividades where {ESCOPO} and cliente_id = ? order by criado_em desc limit 30', p.id),
      disparos: escopo.todas(
        'select * from disparos where {ESCOPO} and cliente_id = ? order by criado_em desc limit 20', p.id),
    });
  },

  'POST /api/clientes': (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    if (!corpo?.nome) throw new ErroHttp(422, 'nome_obrigatorio', 'Nome é obrigatório.');

    // Um cliente, um cadastro: busca pelo telefone antes de criar.
    if (corpo.telefone) {
      const existente = escopo.uma('select * from clientes where {ESCOPO} and telefone = ?', corpo.telefone);
      if (existente) {
        throw new ErroHttp(409, 'cliente_duplicado',
          `Já existe cadastro com este telefone: ${existente.nome}.`, { id: existente.id });
      }
    }

    const id = novoId();
    const consentimento = corpo.consentimento_lgpd ? 1 : 0;
    escopo.inserir('clientes', {
      id, nome: corpo.nome, telefone: corpo.telefone ?? null, email: corpo.email ?? null,
      cidade: corpo.cidade ?? null, uf: corpo.uf ?? null,
      perfil: corpo.perfil ?? 'particular', origem: corpo.origem ?? 'manual',
      consentimento_lgpd: consentimento,
      consentimento_em: consentimento ? agora() : null,
      opt_out_em: null, ultimo_inbound_em: null,
      observacao: corpo.observacao ?? null, criado_em: agora(),
    });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'cliente.criar',
      entidade: 'clientes', entidadeId: id, dados: { nome: corpo.nome, consentimento },
    });
    return ok(escopo.uma('select * from clientes where {ESCOPO} and id = ?', id));
  },

  'PATCH /api/clientes/:id': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const permitidos = ['nome', 'telefone', 'email', 'cidade', 'uf', 'perfil', 'observacao'];
    const dados = Object.fromEntries(
      Object.entries(corpo ?? {}).filter(([k]) => permitidos.includes(k)),
    );
    if (corpo?.consentimento_lgpd !== undefined) {
      dados.consentimento_lgpd = corpo.consentimento_lgpd ? 1 : 0;
      dados.consentimento_em = corpo.consentimento_lgpd ? agora() : null;
    }
    const n = escopo.atualizar('clientes', p.id, dados);
    if (!n) throw new ErroHttp(404, 'nao_encontrado', 'Cliente não encontrado.');
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'cliente.editar',
      entidade: 'clientes', entidadeId: p.id, dados,
    });
    return ok(escopo.uma('select * from clientes where {ESCOPO} and id = ?', p.id));
  },

  /** Opt-out: bloqueia qualquer envio, sem exceção e sem desfazer por engano. */
  'POST /api/clientes/:id/opt-out': (fed, req, p) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const n = escopo.atualizar('clientes', p.id, { opt_out_em: agora() });
    if (!n) throw new ErroHttp(404, 'nao_encontrado', 'Cliente não encontrado.');
    escopo.inserir('atividades', {
      id: novoId(), cliente_id: p.id, tipo: 'lgpd',
      descricao: 'Descadastro registrado. Nenhuma mensagem automática será enviada.',
      criado_em: agora(),
    });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'cliente.opt_out',
      entidade: 'clientes', entidadeId: p.id,
    });
    return ok({ id: p.id, opt_out_em: agora() });
  },

  // ── Frota ────────────────────────────────────────────────────────────────
  'GET /api/veiculos': (fed, req) => {
    const { escopo, banco } = contexto(fed, req);
    const linhas = escopo.todas(
      `select v.*, c.nome as cliente_nome, c.perfil as cliente_perfil
       from veiculos v join clientes c on c.id = v.cliente_id
       where v.{ESCOPO} order by v.placa`,
    );
    return ok(linhas.map((v) => ({ ...v, revisao: projetarRevisao(v, Date.now()) })));
  },

  'PATCH /api/veiculos/:id': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const dados = {};
    if (corpo?.km_ultima !== undefined) dados.km_ultima = num(corpo.km_ultima, null);
    if (corpo?.horimetro !== undefined) dados.horimetro = num(corpo.horimetro, null);
    if (corpo?.media_km_mes !== undefined) dados.media_km_mes = num(corpo.media_km_mes, 0);
    if (corpo?.ultima_visita_em !== undefined) dados.ultima_visita_em = corpo.ultima_visita_em;
    const n = escopo.atualizar('veiculos', p.id, dados);
    if (!n) throw new ErroHttp(404, 'nao_encontrado', 'Veículo não encontrado.');
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'veiculo.editar',
      entidade: 'veiculos', entidadeId: p.id, dados,
    });
    const v = escopo.uma('select * from veiculos where {ESCOPO} and id = ?', p.id);
    return ok({ ...v, revisao: projetarRevisao(v, Date.now()) });
  },

  // ── Ordens de serviço ────────────────────────────────────────────────────
  'GET /api/ordens': (fed, req, _p, _c, url) => {
    const { escopo, banco } = contexto(fed, req);
    const status = url.searchParams.get('status');
    let sql = `select o.*, c.nome as cliente_nome, v.placa, v.marca, v.modelo
               from ordens_servico o
               join clientes c on c.id = o.cliente_id
               left join veiculos v on v.id = o.veiculo_id
               where o.{ESCOPO}`;
    const params = [];
    if (status) { sql += ' and o.status = ?'; params.push(status); }
    sql += ' order by o.aberta_em desc limit 200';
    return ok(escopo.todas(sql, ...params));
  },

  'POST /api/ordens/:id/concluir': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const os = escopo.uma('select * from ordens_servico where {ESCOPO} and id = ?', p.id);
    if (!os) throw new ErroHttp(404, 'nao_encontrado', 'Ordem de serviço não encontrada.');
    if (os.status === 'concluida') throw new ErroHttp(409, 'ja_concluida', 'Esta OS já foi concluída.');

    const dados = {
      status: 'concluida',
      concluida_em: agora(),
      pressao_bar: num(corpo?.pressao_bar, os.pressao_bar),
      resultado_laudo: corpo?.resultado_laudo ?? os.resultado_laudo ?? 'Aprovado — dentro da faixa Bosch.',
      peca_aplicada: corpo?.peca_aplicada ?? os.peca_aplicada,
    };
    escopo.atualizar('ordens_servico', p.id, dados);
    escopo.inserir('atividades', {
      id: novoId(), cliente_id: os.cliente_id, tipo: 'ordem_servico',
      descricao: `OS ${os.numero} concluída — ${os.componente}. Laudo digital disponível.`,
      criado_em: agora(),
    });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'os.concluir',
      entidade: 'ordens_servico', entidadeId: p.id, dados,
    });
    return ok({ ...os, ...dados });
  },

  // ── Pedidos ──────────────────────────────────────────────────────────────
  'GET /api/pedidos': (fed, req) => {
    const { escopo, banco } = contexto(fed, req);
    return ok(escopo.todas(
      `select p.*, c.nome as cliente_nome, c.cidade, c.perfil
       from pedidos p join clientes c on c.id = p.cliente_id
       where p.{ESCOPO} order by p.feito_em desc limit 200`,
    ));
  },

  // ── Pipeline ─────────────────────────────────────────────────────────────
  'GET /api/pipeline': (fed, req) => {
    const { escopo, banco } = contexto(fed, req);
    const linhas = escopo.todas(
      `select o.*, c.nome as cliente_nome
       from oportunidades o left join clientes c on c.id = o.cliente_id
       where o.{ESCOPO} order by o.posicao asc`,
    );
    return ok({
      etapas: ETAPAS.map((etapa) => ({
        etapa,
        itens: linhas.filter((l) => l.etapa === etapa),
        total: linhas.filter((l) => l.etapa === etapa).reduce((s, l) => s + l.valor_centavos, 0),
      })),
    });
  },

  'PATCH /api/oportunidades/:id': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const dados = { atualizado_em: agora() };
    if (corpo?.etapa) {
      if (!ETAPAS.includes(corpo.etapa)) {
        throw new ErroHttp(422, 'etapa_invalida', `Etapa desconhecida: ${corpo.etapa}`);
      }
      dados.etapa = corpo.etapa;
      // Regra de operação: todo orçamento perdido recebe motivo.
      if (corpo.etapa === 'perdido') {
        if (!corpo.motivo_perda) {
          throw new ErroHttp(422, 'motivo_obrigatorio',
            'Oportunidade perdida exige motivo — é o dado que ensina o que corrigir.');
        }
        dados.motivo_perda = corpo.motivo_perda;
        dados.probabilidade = 0;
      }
      if (corpo.etapa === 'ganho') dados.probabilidade = 100;
    }
    if (corpo?.probabilidade !== undefined) dados.probabilidade = num(corpo.probabilidade, 20);
    if (corpo?.posicao !== undefined) dados.posicao = Number(corpo.posicao);
    if (corpo?.valor_centavos !== undefined) dados.valor_centavos = num(corpo.valor_centavos, 0);

    const antes = escopo.uma('select etapa from oportunidades where {ESCOPO} and id = ?', p.id);
    const n = escopo.atualizar('oportunidades', p.id, dados);
    if (!n) throw new ErroHttp(404, 'nao_encontrado', 'Oportunidade não encontrada.');

    const atual = escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', p.id);

    // A mudança de etapa é o gatilho da conversão offline — mas aqui só o
    // EVENTO é gravado. Decidir consentimento, identificador e destino dentro
    // desta transação deixaria a movimentação do funil refém de uma regra de
    // marketing, e um erro lá derrubaria o arrastar do cartão na tela.
    let eventoConversao = null;
    if (dados.etapa && dados.etapa !== antes?.etapa) {
      eventoConversao = registrarMudancaDeEtapa(escopo, {
        oportunidade: atual, etapaAnterior: antes?.etapa, ator: usuario.email,
      });
    }

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'oportunidade.mover',
      entidade: 'oportunidades', entidadeId: p.id, dados: { ...dados, eventoConversao },
    });
    return ok({ ...atual, eventoConversao });
  },

  'POST /api/oportunidades': (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    if (!corpo?.titulo) throw new ErroHttp(422, 'titulo_obrigatorio', 'Título é obrigatório.');
    const id = novoId();
    escopo.inserir('oportunidades', {
      id, cliente_id: corpo.cliente_id ?? null, titulo: corpo.titulo,
      etapa: ETAPAS.includes(corpo.etapa) ? corpo.etapa : 'novo',
      valor_centavos: num(corpo.valor_centavos, 0),
      probabilidade: num(corpo.probabilidade, 20),
      posicao: Date.now() % 1e7, motivo_perda: null,
      criado_em: agora(), atualizado_em: agora(),
    });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'oportunidade.criar',
      entidade: 'oportunidades', entidadeId: id, dados: { titulo: corpo.titulo },
    });
    return ok(escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', id));
  },

  // ── Régua de contato ─────────────────────────────────────────────────────
  'GET /api/regua': (fed, req) => {
    const { escopo, empresa, banco } = contexto(fed, req);
    const fila = montarRegua(banco, escopo, empresa);
    return ok({
      demoMode: DEMO_MODE,
      canal: canalPreferido(escopo),
      fila,
      resumo: {
        total: fila.length,
        liberados: fila.filter((f) => f.decisao.permitido).length,
        bloqueados: fila.filter((f) => !f.decisao.permitido).length,
        motivos: Object.entries(
          fila.filter((f) => !f.decisao.permitido)
            .reduce((a, f) => ({ ...a, [f.decisao.motivo]: (a[f.decisao.motivo] ?? 0) + 1 }), {}),
        ).map(([motivo, n]) => ({ motivo, n, explicacao: EXPLICACAO_MOTIVO[motivo] ?? motivo })),
      },
    });
  },

  'GET /api/gatilhos': (fed, req) => {
    const { escopo, banco } = contexto(fed, req);
    return ok(escopo.todas('select * from gatilhos where {ESCOPO} order by nome'));
  },

  'PATCH /api/gatilhos/:id': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const dados = {};
    if (corpo?.ativo !== undefined) dados.ativo = corpo.ativo ? 1 : 0;
    if (corpo?.template) dados.template = String(corpo.template);
    if (corpo?.cooldown_dias !== undefined) dados.cooldown_dias = num(corpo.cooldown_dias, 30);
    const n = escopo.atualizar('gatilhos', p.id, dados);
    if (!n) throw new ErroHttp(404, 'nao_encontrado', 'Gatilho não encontrado.');
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'gatilho.editar',
      entidade: 'gatilhos', entidadeId: p.id, dados,
    });
    return ok(escopo.uma('select * from gatilhos where {ESCOPO} and id = ?', p.id));
  },

  /**
   * Disparo. Grava a intenção ANTES de qualquer efeito externo — é o que
   * permite distinguir "não saiu" de "saiu e a resposta se perdeu". Com
   * DEMO_MODE ligado nenhuma rede é tocada: o registro fica `sent` marcado
   * como simulado, e a tela diz isso.
   */
  'POST /api/regua/disparar': (fed, req, _p, corpo) => {
    const { escopo, empresa, usuario, banco } = contexto(fed, req);
    /*
     * Aceita `["id"]` ou `[{id, corpo}]`. O segundo formato existe porque o
     * atendente edita a mensagem antes de mandar — e isso é o normal, não a
     * exceção: o texto gerado é um bom rascunho, não a palavra final de quem
     * conhece o cliente.
     *
     * Texto editado NÃO é aceito como veio. Ele volta pelo compliance inteiro,
     * porque a blocklist e o teto de caracteres valem sobre o corpo FINAL —
     * confiar no que o navegador mandou seria dar ao operador um caminho para
     * furar a própria regra sem perceber.
     */
    const alvos = (Array.isArray(corpo?.itens) ? corpo.itens : [])
      .map((x) => (typeof x === 'string' ? { id: x, corpo: null } : {
        id: String(x?.id ?? ''), corpo: x?.corpo ? String(x.corpo) : null,
      }))
      .filter((x) => x.id);
    if (!alvos.length) throw new ErroHttp(422, 'sem_itens', 'Nenhum item selecionado.');

    const fila = montarRegua(banco, escopo, empresa);
    const porId = new Map(fila.map((f) => [f.id, f]));
    const canal = canalPreferido(escopo);
    const resultado = [];

    for (const alvo of alvos) {
      const alvoId = alvo.id;
      const original = porId.get(alvoId);
      if (!original) {
        resultado.push({ id: alvoId, status: 'failed', motivo: 'item_fora_da_fila' });
        continue;
      }

      // Reavalia com o texto que vai sair de verdade.
      const item = alvo.corpo && alvo.corpo.trim() !== original.corpo
        ? reavaliarComCorpo(escopo, original, comRodape(alvo.corpo.trim()))
        : original;

      // Revalida no instante do envio. A fila pode ter sido montada há minutos.
      const idem = `${item.gatilho.chave}:${item.cliente.id}:${new Date().toISOString().slice(0, 10)}`;
      const jaExiste = escopo.uma(
        'select * from disparos where {ESCOPO} and idempotency_key = ?', idem,
      );
      if (jaExiste) {
        resultado.push({ id: alvoId, status: jaExiste.status, motivo: 'replay', replayed: true });
        continue;
      }

      const status = item.decisao.permitido ? (DEMO_MODE ? 'sent' : 'claimed') : 'blocked';
      escopo.inserir('disparos', {
        id: novoId(), cliente_id: item.cliente.id, gatilho_chave: item.gatilho.chave,
        canal_tipo: canal?.tipo ?? 'whatsapp_evolution', corpo: item.corpo,
        status, politica: item.decisao.politica, motivo: item.decisao.motivo,
        idempotency_key: idem, criado_em: agora(),
      });

      if (item.decisao.permitido) {
        escopo.inserir('atividades', {
          id: novoId(), cliente_id: item.cliente.id, tipo: 'regua',
          descricao: `${item.gatilho.nome}${item.editado ? ' · texto ajustado pelo atendente' : ''}`
            + `${DEMO_MODE ? ' (simulado — DEMO_MODE)' : ''}`,
          criado_em: agora(),
        });
      }

      banco.auditar({
        empresaId: empresa.id, ator: usuario.email, acao: 'regua.disparar',
        entidade: 'clientes', entidadeId: item.cliente.id,
        dados: { gatilho: item.gatilho.chave, status, motivo: item.decisao.motivo, demo: DEMO_MODE },
      });

      resultado.push({
        id: alvoId, status, motivo: item.decisao.motivo,
        editado: Boolean(item.editado),
        simulado: DEMO_MODE && item.decisao.permitido,
      });
    }

    // Repetição não conta como envio. Confundir as duas coisas é justamente o
    // que a idempotência existe para evitar — e mentir no contador desfaria a
    // garantia na única tela onde ela aparece.
    return ok({
      demoMode: DEMO_MODE,
      enviados: resultado.filter((r) => r.status === 'sent' && !r.replayed).length,
      bloqueados: resultado.filter((r) => r.status === 'blocked' && !r.replayed).length,
      repetidos: resultado.filter((r) => r.replayed).length,
      resultado,
    });
  },

  /**
   * Recarrega a demonstração.
   *
   * Existe porque disparar a fila é a parte que convence — e, feito isso, o
   * cooldown esvazia a régua pelas próximas semanas. Sem esta rota, a segunda
   * reunião do dia abriria numa tela vazia.
   *
   * Só responde com DEMO_MODE ligado. Com efeitos externos ativos isto seria
   * uma rota que apaga a base do cliente, e nenhuma conveniência paga isso.
   */
  'POST /api/demo/reiniciar': (fed, req) => {
    if (!DEMO_MODE) {
      throw new ErroHttp(403, 'demo_desligado',
        'Recarga de demonstração só existe com DEMO_MODE ligado.');
    }
    const c = contexto(fed, req, { exigeEmpresa: false });

    /*
     * Recarrega TODAS as instâncias que o usuário alcança, e não só a ativa.
     *
     * Duas razões. A primeira é que a rota estava quebrada: usava um `banco`
     * solto, que nunca existiu neste escopo — `contexto()` devolve o banco
     * dentro do objeto. Com `exigeEmpresa: false` e sem cabeçalho de instância
     * ele vem `null`, então nem trocar por `c.banco` bastaria.
     *
     * A segunda é o motivo de ser todas: a carga gera IDs novos, e a Central é
     * uma projeção das três instâncias. Recarregar uma só deixaria a Central
     * apontando para clientes que deixaram de existir — inconsistência que o
     * botão "Recarregar demonstração" existe justamente para não produzir.
     * Por isso a sincronização vem logo depois, no mesmo pedido.
     */
    const instancias = c.permitidas.map((e) => e.instancia);
    const porInstancia = [];
    for (const cod of instancias) {
      const b = fed.abrir(cod);
      b.auditar({
        ator: c.usuario.email, acao: 'demo.reiniciar',
        dados: { motivo: 'recarga da base de demonstracao', instancia: cod },
      });
      porInstancia.push({ instancia: cod, ...recarregarDemo(b, cod) });
    }
    const central = sincronizarCentral(fed);

    return ok({
      instancias: porInstancia,
      central,
      clientes: porInstancia.reduce((a, x) => a + (x.clientes ?? 0), 0),
      // Os identificadores são novos, então a sessão antiga aponta para um
      // usuário que deixou de existir. Melhor dizer isso do que deixar a tela
      // falhar em 401 no próximo clique.
      exigeNovoLogin: true,
    });
  },

  /**
   * Reancorar: desliza a história semeada para frente, sem apagar nada.
   *
   * Existe porque a carga gera datas relativas ao instante em que roda, e o
   * compliance — funcionando corretamente — vai fechando a janela de 24 h
   * conforme o relógio anda. Nove horas depois da carga a fila da oficina já
   * havia encolhido de 16 liberados para 9.
   *
   * Diferente de recarregar, preserva o que foi feito na demonstração.
   */
  'POST /api/demo/reancorar': (fed, req) => {
    if (!DEMO_MODE) {
      throw new ErroHttp(403, 'demo_desligado',
        'Reancorar a linha do tempo só existe com DEMO_MODE ligado.');
    }
    const c = contexto(fed, req, { exigeEmpresa: false });

    const partes = fed.emCada(c.permitidas.map((e) => e.instancia), (banco) => {
      const emp = banco.sistema().prepare('select id from empresas limit 1').get();
      if (!emp) throw new Error('instância sem empresa');
      return reancorar(banco, banco.para(emp.id), { ator: c.usuario.email });
    });

    // A central é projeção: depois de mover a história, ela precisa reler.
    sincronizarCentral(fed, { codigos: c.permitidas.map((e) => e.instancia) });

    return ok({
      instancias: partes.map((p) => ({
        instancia: p.instancia,
        deslocouSegundos: p.dados?.deslocouSegundos ?? 0,
        deslocouHoras: Math.round(((p.dados?.deslocouSegundos ?? 0) / 3600) * 10) / 10,
        motivo: p.dados?.motivo ?? null,
        erro: p.erro,
      })),
    });
  },

  /** Idade da demonstração — a tela usa para avisar antes de a fila secar. */
  'GET /api/demo/estado': (fed, req) => {
    const c = contexto(fed, req, { exigeEmpresa: false });
    const partes = fed.emCada(
      c.permitidas.map((e) => e.instancia),
      (banco) => diagnosticoDaAncora(banco),
    );
    const idades = partes.map((p) => p.dados?.horas).filter((h) => typeof h === 'number');
    return ok({
      demoMode: DEMO_MODE,
      instancias: partes.map((p) => ({ instancia: p.instancia, ...(p.dados ?? {}), erro: p.erro })),
      horasMaisVelha: idades.length ? Math.max(...idades) : null,
      envelhecida: partes.some((p) => p.dados?.envelhecida),
    });
  },

  /**
   * Trocar a própria senha.
   *
   * Muda em TODAS as instâncias onde aquele e-mail existe, e isso não é
   * conveniência: o login varre as instâncias e entra em cada uma que aceitar
   * a senha. Trocar só numa deixaria o usuário com acesso parcial ao próprio
   * grupo — entraria na oficina e não na loja, sem mensagem que explicasse.
   *
   * Falha parcial é reportada, nunca engolida: se uma instância estiver fora do
   * ar, quem trocou precisa saber que a senha antiga ainda vale lá.
   */
  'POST /api/senha': (fed, req, _p, corpo) => {
    const c = contexto(fed, req, { exigeEmpresa: false });
    const atual = String(corpo?.senhaAtual ?? '');
    const nova = String(corpo?.senhaNova ?? '');

    const forca = avaliarForca(nova, { email: c.usuario.email });
    if (!forca.aceitavel) {
      throw new ErroHttp(422, 'senha_fraca',
        `Senha recusada: ${forca.problemas.join('; ')}.`, { problemas: forca.problemas });
    }
    if (nova === atual) {
      throw new ErroHttp(422, 'senha_igual', 'A senha nova precisa ser diferente da atual.');
    }

    const derivada = hashSenha(nova);
    const partes = fed.emCada(c.permitidas.map((e) => e.instancia), (banco) => {
      const u = banco.sistema()
        .prepare('select id, senha from usuarios where lower(email) = ?')
        .get(c.usuario.email);
      if (!u) return { alterada: false, motivo: 'usuario_ausente' };
      if (!verificarSenha(atual, u.senha)) return { alterada: false, motivo: 'senha_atual_incorreta' };

      banco.sistema().prepare('update usuarios set senha = ? where id = ?').run(derivada, u.id);
      const emp = banco.sistema().prepare('select id from empresas limit 1').get();
      banco.auditar({
        empresaId: emp?.id ?? null, ator: c.usuario.email, acao: 'senha.trocar',
        entidade: 'usuarios', entidadeId: u.id,
      });
      return { alterada: true, motivo: null };
    });

    const alteradas = partes.filter((p) => p.dados?.alterada);
    const recusadas = partes.filter((p) => p.dados?.motivo === 'senha_atual_incorreta');

    if (!alteradas.length) {
      throw new ErroHttp(recusadas.length ? 403 : 500,
        recusadas.length ? 'senha_atual_incorreta' : 'nenhuma_instancia',
        recusadas.length ? 'Senha atual incorreta.' : 'Nenhuma instância aceitou a troca.');
    }

    return ok({
      alteradas: alteradas.map((p) => p.instancia),
      pendentes: partes.filter((p) => !p.dados?.alterada)
        .map((p) => ({ instancia: p.instancia, motivo: p.erro ?? p.dados?.motivo })),
      aviso: partes.some((p) => !p.dados?.alterada)
        ? 'Alguma instância não pôde ser atualizada — a senha antiga continua valendo nela.'
        : null,
    });
  },

  'GET /api/disparos': (fed, req) => {
    const { escopo, banco } = contexto(fed, req);
    return ok(escopo.todas(
      `select d.*, c.nome as cliente_nome from disparos d
       join clientes c on c.id = d.cliente_id
       where d.{ESCOPO} order by d.criado_em desc limit 200`,
    ));
  },

  // ── Catálogo ─────────────────────────────────────────────────────────────
  'GET /api/catalogo': (fed, req) => {
    const { escopo, banco } = contexto(fed, req);
    return ok(escopo.todas('select * from catalogo where {ESCOPO} and ativo = 1 order by categoria, nome'));
  },

  // ── Auditoria ────────────────────────────────────────────────────────────
  /**
   * Auditoria federada. Cada instância tem a SUA cadeia de hash — e é assim
   * que tem de ser: uma cadeia compartilhada obrigaria as instâncias a
   * escreverem no mesmo lugar, refazendo o acoplamento que a separação
   * desfez. O que a tela mostra é a união das cadeias, cada linha sabendo de
   * qual instância veio.
   */
  'GET /api/auditoria': (fed, req, _p, _c, url) => {
    const c = contexto(fed, req, { exigeEmpresa: false });
    const pedida = String(url?.searchParams.get('i') ?? '').toUpperCase();
    const codigos = pedida && pedida !== 'GRUPO'
      ? c.permitidas.filter((e) => e.instancia === pedida).map((e) => e.instancia)
      : c.permitidas.map((e) => e.instancia);

    const { linhas, falhas } = fed.consultar(codigos, (banco) => banco.sistema()
      .prepare(`select seq, empresa_id, ator, acao, entidade, entidade_id, dados, hash, criado_em
                from audit_log order by seq desc limit 120`)
      .all());

    linhas.sort((a, b) => Date.parse(b.criado_em) - Date.parse(a.criado_em));
    return ok(linhas.slice(0, 250), { indisponiveis: falhas });
  },

  'GET /api/auditoria/verificar': (fed, req) => {
    const c = contexto(fed, req, { exigeEmpresa: false });

    const partes = fed.emCada(c.permitidas.map((e) => e.instancia), (banco) => {
      const quebras = banco.verificarCadeia();
      const total = banco.sistema().prepare('select count(*) as n from audit_log').get().n;
      const emp = banco.sistema().prepare('select id from empresas limit 1').get();
      banco.auditar({
        empresaId: emp?.id ?? null, ator: c.usuario.email, acao: 'auditoria.verificar',
        dados: { total, quebras: quebras.length },
      });
      return { total, quebras };
    });

    const cadeias = partes.map((p) => ({
      instancia: p.instancia,
      empresa: p.meta?.nome ?? p.instancia,
      total: p.dados?.total ?? 0,
      integra: !p.erro && (p.dados?.quebras.length ?? 0) === 0,
      quebras: p.dados?.quebras ?? [],
      erro: p.erro,
    }));

    return ok({
      cadeias,
      total: cadeias.reduce((t, c2) => t + c2.total, 0),
      integra: cadeias.every((c2) => c2.integra),
      observacao:
        'Cada instância mantém a sua própria cadeia. A cadeia DETECTA adulteração; não a impede — '
        + 'quem tem acesso ao arquivo do banco pode recalcular. A defesa completa exige âncora '
        + 'externa periódica do último hash, e não está implementada.',
    });
  },

  // ── Instância central: leads de todas as fontes ─────────────────────────
  'GET /api/central/resumo': (fed, req) => {
    contexto(fed, req, { exigeEmpresa: false });
    return ok(resumoConsolidado(fed.abrirCentral()));
  },

  'GET /api/central/leads': (fed, req, _p, _c, url) => {
    const c = contexto(fed, req, { exigeEmpresa: false });
    const permitidas = new Set(c.permitidas.map((e) => e.instancia));
    const pedida = String(url?.searchParams.get('instancia') ?? '').toUpperCase();

    // A central guarda tudo, mas devolve só o que o usuário poderia ver na
    // instância de origem. Consolidar leitura não pode virar atalho para
    // atravessar uma permissão que a instância negaria.
    const linhas = consultarConsolidado(fed.abrirCentral(), {
      q: url?.searchParams.get('q') ?? '',
      instancia: pedida && permitidas.has(pedida) ? pedida : '',
      fonte: url?.searchParams.get('fonte') ?? '',
      plataforma: url?.searchParams.get('plataforma') ?? '',
    }).filter((l) => permitidas.has(l.instancia));

    return ok(linhas);
  },

  'POST /api/central/sincronizar': (fed, req) => {
    const c = contexto(fed, req, { exigeEmpresa: false });
    const r = sincronizarCentral(fed, { codigos: c.permitidas.map((e) => e.instancia) });
    return ok(r);
  },

  /**
   * Porta de entrada de lead externo (formulário, anúncio, parceiro).
   *
   * Chega na CENTRAL, não numa instância: nenhuma instância de empresa fica
   * exposta a tráfego público. A atribuição é extraída aqui, no instante da
   * chegada — depois o parâmetro de clique já se perdeu.
   */
  'POST /api/central/entrada': (fed, req, _p, corpo) => {
    contexto(fed, req, { exigeEmpresa: false });
    const atr = extrairAtribuicao(corpo?.pagina ?? corpo?.parametros ?? {}, {
      paginaEntrada: corpo?.pagina ?? null,
      referrer: corpo?.referrer ?? null,
      fbp: corpo?.fbp ?? null,
    });

    const r = receberLead(fed.abrirCentral(), {
      fonte: corpo?.fonte ?? 'formulario',
      destino: corpo?.destino ?? null,
      payload: { ...corpo, atribuicao: atr },
    });

    return ok({
      ...r,
      atribuicao: atr,
      temSinal: temSinal(atr),
      aviso: temSinal(atr)
        ? null
        : 'Nenhum parâmetro de clique nem UTM na entrada — este lead não terá conversão atribuível.',
    });
  },

  // ── Canais de entrada ────────────────────────────────────────────────────
  /**
   * O catálogo de canais da empresa ativa, cruzado com o que a base realmente
   * tem, mais a chave de captação para colar no site.
   */
  'GET /api/canais': (fed, req) => {
    const { escopo, empresa } = contexto(fed, req);

    const contagens = Object.fromEntries(
      escopo.todas('select origem, count(*) as n from clientes where {ESCOPO} group by origem')
        .map((r) => [r.origem, r.n]),
    );

    const diag = diagnosticar(empresa.codigo, contagens);
    const central = fed.abrirCentral();
    const chave = listarChaves(central, empresa.codigo)[0] ?? null;

    /*
     * Estado do webhook de Click-to-WhatsApp.
     *
     * `configurado` olha para o segredo do app, não para "já chegou mensagem":
     * sem `FORTCRM_META_APP_SECRET` a porta fica fechada e recusa tudo, e é
     * melhor a tela dizer isso do que o operador esperar por leads que nunca
     * vão entrar.
     */
    const msgs = central.sistema().prepare(
      `select count(*) as total,
              sum(case when de_anuncio = 1 then 1 else 0 end) as de_anuncio,
              sum(case when sem_ctwa = 1 then 1 else 0 end) as sem_clique
         from mensagens_entrada`,
    ).get() ?? {};

    const whatsapp = {
      configurado: Boolean(process.env.FORTCRM_META_APP_SECRET),
      numero: empresa.whatsapp ?? null,
      recebidas: msgs.total ?? 0,
      deAnuncio: msgs.de_anuncio ?? 0,
      semClique: msgs.sem_clique ?? 0,
    };

    return ok({
      empresa: { codigo: empresa.codigo, nome: empresa.nome },
      tipos: TIPOS,
      ...diag,
      pergunta: PERGUNTA_ORIGEM,
      respostas: RESPOSTAS_ORIGEM,
      chave: chave ? { chave: chave.chave, usos: chave.usos, ultimoUsoEm: chave.ultimo_uso_em } : null,
      whatsapp,
    });
  },

  /**
   * Porta pública de captação. NÃO exige sessão — um formulário de site não faz
   * login, e era exatamente por isso que a entrada anterior (`/api/central/entrada`,
   * que chama `contexto()`) nunca pôde ser usada por um site de verdade.
   *
   * O que a mantém segura, já que é a única escrita anônima do sistema:
   *
   *   - a chave só ROTEIA. Não lê, não lista e não vira sessão. Colada no HTML
   *     público do cliente, que é onde ela precisa estar, o pior uso é mandar
   *     lead falso — barulhento e auditável, nunca leitura da base;
   *   - 20 requisições por minuto por origem (`src/limite.mjs`);
   *   - o corpo para em 1 MB no servidor;
   *   - a resposta é IDÊNTICA para chave inválida, chave desativada e lead
   *     duplicado. Variar a resposta transformaria a porta num oráculo — dá
   *     para enumerar chaves, ou descobrir se um telefone já é cliente;
   *   - o lead cai na CENTRAL, em triagem. Nenhuma instância de empresa é
   *     exposta a tráfego externo, e nada entra direto na base de produção.
   */
  'POST /api/entrada/:chave': (fed, _req, p, corpo) => {
    const central = fed.abrirCentral();
    const destino = resolverChave(central, p.chave);

    // Resposta constante mesmo sem destino: ver o comentário acima.
    const recibo = (id) => ok({ recebido: true, protocolo: id });

    const atr = extrairAtribuicao(corpo?.parametros ?? corpo?.pagina ?? {}, {
      paginaEntrada: corpo?.pagina ?? null,
      referrer: corpo?.referrer ?? null,
      fbp: corpo?.fbp ?? null,
    });

    if (!destino) return recibo(randomUUID());

    const texto = (v, max) => (v == null ? null : String(v).slice(0, max));
    const r = receberLead(central, {
      fonte: texto(corpo?.canal, 60) ?? 'formulario',
      destino: destino.codigo,
      payload: {
        nome: texto(corpo?.nome, 120),
        telefone: texto(corpo?.telefone, 40),
        email: texto(corpo?.email, 160),
        mensagem: texto(corpo?.mensagem, 2000),
        canal: texto(corpo?.canal, 60),
        pagina: texto(corpo?.pagina, 500),
        referrer: texto(corpo?.referrer, 500),
        atribuicao: atr,
        temSinal: temSinal(atr),
      },
    });
    return recibo(r.id);
  },

  // ── WhatsApp Cloud API — entrada de Click-to-WhatsApp ────────────────────
  /**
   * Verificação do endpoint. A Meta chama uma vez, com `hub.challenge`, e
   * espera o desafio de volta em texto puro — não em JSON.
   */
  'GET /api/whatsapp/webhook': (_fed, _req, _p, _c, url) => {
    const params = Object.fromEntries(url.searchParams.entries());
    const r = responderDesafio(params, process.env.FORTCRM_WHATSAPP_VERIFY_TOKEN ?? null);
    if (!r.ok) throw new ErroHttp(403, 'desafio_recusado', 'Token de verificação não confere.');
    return { __texto: r.corpo };
  },

  /**
   * Mensagens recebidas.
   *
   * É a porta por onde o Click-to-WhatsApp entra — o `ctwa_clid` chega no
   * `referral` da PRIMEIRA mensagem e em nenhum outro lugar. Perder esse
   * webhook é perder a atribuição daquele lead para sempre: não existe API
   * para recuperar histórico de webhook não processado.
   *
   * Por isso a ordem aqui é: validar assinatura, gravar o corpo bruto,
   * responder, e só então processar. Se o processamento falhar, o payload
   * continua no banco e pode ser reprocessado.
   */
  'POST /api/whatsapp/webhook': (fed, req, _p, corpo) => {
    const segredo = process.env.FORTCRM_META_APP_SECRET ?? null;
    const assinatura = req.headers['x-hub-signature-256'] ?? null;
    const v = validarAssinatura(req.corpoBruto ?? '', assinatura, segredo);

    /*
     * Sem segredo configurado a porta fica FECHADA, não aberta.
     *
     * O contrário — "sem segredo, aceita tudo" — é a falha que passa
     * despercebida: funciona em desenvolvimento, vai para produção sem a
     * variável e vira endpoint público de escrita que qualquer um alimenta.
     */
    if (!v.valida) {
      throw new ErroHttp(403, 'assinatura_invalida',
        v.motivo === 'sem_segredo'
          ? 'FORTCRM_META_APP_SECRET não configurado — o webhook fica fechado até haver segredo.'
          : 'Assinatura do webhook não confere.');
    }

    const central = fed.abrirCentral();
    const sis = central.sistema();
    const bruto = String(req.corpoBruto ?? '');
    const hash = createHash('sha256').update(bruto).digest('hex');

    // Grava o payload ANTES de processar. `or ignore` porque a Meta reenvia o
    // que não recebeu 200, com frequência decrescente por até 7 dias.
    sis.prepare(
      `insert or ignore into webhooks_brutos (id, origem, assinatura_ok, corpo, corpo_hash, recebido_em)
       values (?,?,?,?,?,?)`,
    ).run(novoId(), 'whatsapp', 1, bruto, hash, agora());

    const mensagens = extrairMensagens(corpo);
    let novas = 0;
    let deAnuncio = 0;
    let semCtwa = 0;

    for (const m of mensagens) {
      if (!m.wamid) continue;
      // `wamid` é único na tabela: o reenvio do mesmo webhook não vira lead
      // novo. `changes()` diz se a linha entrou de fato.
      const res = sis.prepare(
        `insert or ignore into mensagens_entrada
           (id, wamid, waba_id, phone_number_id, wa_id, nome, tipo, texto,
            de_anuncio, ctwa_clid, source_ad_id, sem_ctwa, recebido_em, criado_em)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        novoId(), m.wamid, m.waba_id, m.phone_number_id, m.wa_id, m.nome, m.tipo, m.texto,
        m.de_anuncio ? 1 : 0, m.ctwa_clid, m.source_ad_id, m.sem_ctwa ? 1 : 0,
        m.recebido_em ?? agora(), agora(),
      );
      if (res.changes > 0) {
        novas += 1;
        if (m.de_anuncio) deAnuncio += 1;
        if (m.sem_ctwa) semCtwa += 1;

        // Só conversa vinda de anúncio gera lead com atribuição. A orgânica
        // entra como mensagem e nada mais — inventar origem para ela seria
        // exatamente o erro que o catálogo de canais existe para evitar.
        if (m.de_anuncio && m.ctwa_clid) {
          // Rotear pelo NUMERO que recebeu a mensagem. Cada empresa tem o
          // seu, e sem isso o lead fica parado na triagem esperando alguem
          // decidir de quem ele e — exatamente a demora que perde a venda.
          const dona = empresaDoNumero(m.numero_exibicao ?? m.phone_number_id, CATALOGO);
          receberLead(central, {
            fonte: 'whatsapp_anuncio',
            destino: dona?.codigo ?? null,
            payload: {
              nome: m.nome,
              telefone: m.wa_id,
              mensagem: m.texto,
              canal: 'whatsapp_anuncio',
              atribuicao: {
                plataforma: 'meta_ads',
                ctwa_clid: m.ctwa_clid,
                waba_id: m.waba_id,
                source_ad_id: m.source_ad_id,
              },
            },
          });
        }
      }
    }

    sis.prepare('update webhooks_brutos set processado_em = ? where corpo_hash = ?')
      .run(agora(), hash);

    return ok({
      recebidas: mensagens.length, novas, deAnuncio,
      // Ausência registrada, nunca preenchida: posicionamento em Status do
      // WhatsApp chega como anúncio e sem `ctwa_clid`. Inventar um valor
      // produziria evento que a Meta aceita e que nunca casa com anúncio.
      deAnuncioSemCtwaClid: semCtwa,
    });
  },

  // ── Conversões offline ───────────────────────────────────────────────────
  'GET /api/conversoes': (fed, req) => {
    const { escopo } = contexto(fed, req);
    const linhas = escopo.todas(
      `select c.*, cl.nome as cliente_nome, o.titulo as oportunidade_titulo
       from conversoes c
       join clientes cl on cl.id = c.cliente_id
       left join oportunidades o on o.id = c.oportunidade_id
       where c.{ESCOPO} order by c.criado_em desc limit 200`,
    );
    const contar = (st) => escopo.contar('conversoes', 'and status = ?', st);
    return ok({
      demoMode: DEMO_MODE,
      eventos: Object.values(EVENTOS),
      destinos: escopo.todas('select * from destinos_conversao where {ESCOPO}'),
      resumo: {
        pendentes: contar('pendente'),
        enviadas: contar('enviado'),
        bloqueadas: contar('bloqueado'),
        desconhecidas: contar('desconhecido'),
        eventosPendentes: escopo.contar('event_log', "and status = 'pendente'"),
      },
      linhas,
    });
  },

  /** Drena os eventos de etapa e despacha o que ficou pendente. */
  'POST /api/conversoes/processar': (fed, req) => {
    const { escopo, empresa, usuario, banco } = contexto(fed, req);
    const drenagem = drenarEventos(banco, escopo);
    const despacho = despacharConversoes(banco, escopo, empresa, { ator: usuario.email });
    return ok({ drenagem, despacho });
  },

  /** Payload exato que sairia para a plataforma — a prova do que se promete. */
  'GET /api/conversoes/:id': (fed, req, p) => {
    const { escopo } = contexto(fed, req);
    const c = escopo.uma('select * from conversoes where {ESCOPO} and id = ?', p.id);
    if (!c) throw new ErroHttp(404, 'nao_encontrado', 'Conversão não encontrada.');
    const cliente = escopo.uma('select * from clientes where {ESCOPO} and id = ?', c.cliente_id);
    const atribuicao = escopo.uma(
      "select * from atribuicoes where {ESCOPO} and cliente_id = ? and toque = 'primeiro'", c.cliente_id,
    );
    return ok({ conversao: c, cliente, atribuicao, payload: seguroJsonApi(c.payload) });
  },

  // ── Atribuição ───────────────────────────────────────────────────────────
  'GET /api/atribuicao': (fed, req) => {
    const { escopo } = contexto(fed, req);
    const linhas = escopo.todas(
      `select a.*, c.nome as cliente_nome, c.consentimento_lgpd
       from atribuicoes a join clientes c on c.id = a.cliente_id
       where a.{ESCOPO} order by a.capturado_em desc limit 200`,
    );
    const porPlataforma = escopo.todas(
      `select coalesce(plataforma,'sem_atribuicao') as plataforma, count(*) as n
       from atribuicoes where {ESCOPO} group by 1 order by n desc`,
    );
    const porCampanha = escopo.todas(
      `select coalesce(utm_campaign,'sem_campanha') as campanha, count(*) as n
       from atribuicoes where {ESCOPO} group by 1 order by n desc limit 15`,
    );
    return ok({ linhas, porPlataforma, porCampanha });
  },

  // ── Importação de base ───────────────────────────────────────────────────
  /**
   * Importa CSV de clientes. Cada linha exige consentimento explícito: sem
   * ele o cliente entra na base como contato histórico, mas fora da régua.
   */
  'POST /api/importar/clientes': (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const texto = String(corpo?.csv ?? '');
    if (!texto.trim()) throw new ErroHttp(422, 'csv_vazio', 'Nada para importar.');

    const linhas = texto.trim().split(/\r?\n/);
    const cabecalho = linhas.shift().split(',').map((h) => h.trim().toLowerCase());
    const idx = (nome) => cabecalho.indexOf(nome);
    const iNome = idx('nome') >= 0 ? idx('nome') : idx('fn');
    const iTel = idx('telefone') >= 0 ? idx('telefone') : idx('phone');

    if (iNome < 0) throw new ErroHttp(422, 'coluna_nome', 'CSV precisa de coluna "nome" ou "fn".');

    let criados = 0, duplicados = 0, semConsentimento = 0;
    for (const linha of linhas) {
      const col = linha.split(',');
      const nome = (col[iNome] ?? '').trim();
      if (!nome) continue;
      const telefone = iTel >= 0 ? (col[iTel] ?? '').trim() : null;

      if (telefone && escopo.uma('select id from clientes where {ESCOPO} and telefone = ?', telefone)) {
        duplicados += 1;
        continue;
      }
      const consentimento = idx('consentimento') >= 0
        && /^(1|sim|true|s)$/i.test((col[idx('consentimento')] ?? '').trim());
      if (!consentimento) semConsentimento += 1;

      escopo.inserir('clientes', {
        id: novoId(), nome,
        telefone: telefone || null,
        email: idx('email') >= 0 ? (col[idx('email')] ?? '').trim() || null : null,
        cidade: idx('cidade') >= 0 ? (col[idx('cidade')] ?? '').trim() || null : null,
        uf: null, perfil: 'particular', origem: 'importacao',
        consentimento_lgpd: consentimento ? 1 : 0,
        consentimento_em: consentimento ? agora() : null,
        opt_out_em: null, ultimo_inbound_em: null,
        observacao: 'Importado de CSV.', criado_em: agora(),
      });
      criados += 1;
    }

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'clientes.importar',
      entidade: 'clientes', dados: { criados, duplicados, semConsentimento },
    });

    return ok({
      criados, duplicados, semConsentimento,
      aviso: semConsentimento
        ? `${semConsentimento} contatos entraram sem consentimento registrado. Eles ficam na base, mas FORA da régua até o consentimento ser coletado.`
        : null,
    });
  },
};

// Rotas que devolvem HTML, tratadas fora do envelope JSON.
export const ROTAS_HTML = {
  'GET /api/ordens/:id/laudo': (fed, req, p, _c, url) => {
    const { escopo, empresa, banco } = contexto(fed, req, { url });
    const os = escopo.uma(
      `select o.*, c.nome as cliente_nome, c.telefone as cliente_telefone,
              v.placa, v.marca, v.modelo, v.ano, v.motorizacao, v.sistema_injecao
       from ordens_servico o
       join clientes c on c.id = o.cliente_id
       left join veiculos v on v.id = o.veiculo_id
       where o.{ESCOPO} and o.id = ?`, p.id,
    );
    if (!os) throw new ErroHttp(404, 'nao_encontrado', 'Ordem de serviço não encontrada.');
    return laudoHtml(os, empresa);
  },
};

/**
 * Apaga as tabelas de negócio e refaz a carga, preservando a auditoria.
 *
 * O código da empresa é OBRIGATÓRIO aqui. `semear` tem `empresa = 'MP'` como
 * padrão, e esta função o omitia: recarregar a Agrofort ou a Fort Tintas
 * gravava os dados da Minas Peças por cima — inclusive a linha de `empresas`,
 * o que fazia as três instâncias se apresentarem como MP. O defeito ficou
 * escondido porque a rota que chama isto quebrava antes de chegar aqui.
 */
function recarregarDemo(banco, codigo) {
  if (!codigo) throw new Error('recarregarDemo exige o codigo da empresa');
  return semear(banco, { empresa: codigo, reset: true });
}


/**
 * Recalcula a decisão de compliance para um corpo diferente do gerado.
 *
 * Só o corpo muda; janela, consentimento e cooldown continuam vindo do estado
 * do contato. O que esta função existe para pegar é o que o texto novo pode
 * introduzir: termo bloqueado e estouro do teto do canal.
 */
function reavaliarComCorpo(escopo, item, corpoNovo) {
  const cliente = escopo.uma('select * from clientes where {ESCOPO} and id = ?', item.cliente.id);
  const politica = POLITICAS_CANAL[item.canal?.tipo] ?? null;

  const ultimo = escopo.uma(
    `select criado_em from disparos
     where {ESCOPO} and cliente_id = ? and gatilho_chave = ? and status in ('sent','claimed')
     order by criado_em desc limit 1`,
    item.cliente.id, item.gatilho.chave,
  );

  const decisao = avaliarCompliance({
    canalTipo: item.canal?.tipo ?? 'whatsapp_evolution',
    canalConectado: Boolean(item.canal?.conectado),
    corpo: corpoNovo,
    automatizado: true,
    consentimento: Boolean(cliente?.consentimento_lgpd),
    optOutEm: cliente?.opt_out_em ?? null,
    ultimoInboundEm: cliente?.ultimo_inbound_em ?? null,
    ultimoDisparoDoGatilhoEm: ultimo?.criado_em ?? null,
    cooldownMs: 24 * 60 * 60 * 1000,
    temTemplateAprovado: Boolean(politica?.aceitaTemplateForaDaJanela),
    blocklist: BLOCKLIST,
    agoraMs: Date.now(),
  });

  return { ...item, corpo: corpoNovo, editado: true, decisao };
}

function seguroJsonApi(texto) {
  try { return JSON.parse(texto); } catch { return null; }
}

function iso(diasAtras) {
  return new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000).toISOString();
}

export { contexto, montarRegua, assinar };
