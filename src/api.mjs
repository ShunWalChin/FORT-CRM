/**
 * Rotas do CRM. Envelope de resposta canônico, escopo de empresa resolvido do
 * token — nunca do corpo da requisição, que é o erro clássico que fura
 * multi-tenant — e nenhum efeito externo enquanto DEMO_MODE estiver ligado.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { agora, novoId } from './db.mjs';
import { formatar as formatarDinheiro, paraCentavos } from './dinheiro.mjs';
import {
  balancete, conferir, estornar, fechar as fecharPeriodo, lancar, limparMovimento,
  ratearEntreEmpresas, reabrir as reabrirPeriodo, semearPlano as semearPlanoContas,
} from './razao.mjs';
import {
  abrir as abrirTitulo, baixar as baixarTitulo, cancelar as cancelarTitulo,
  carteira, posicao,
} from './titulos.mjs';
import {
  MODULOS as MODULOS_ERP, conceder, exigir as exigirModulo, mapaDeAcesso,
  permissoesDe, revogar, semearAcesso,
} from './permissoes.mjs';
import {
  COLETORES, pendencias as pendenciasDeFato, reconhecerDivergencia,
  sincronizar as sincronizarFatos,
} from './fatos.mjs';
import { avaliarCompliance, comRodape, POLITICAS_CANAL, EXPLICACAO_MOTIVO } from './compliance.mjs';
import {
  GATILHOS, projetarRevisao, renderizar, saudacao, diagnosticarFilaVazia,
} from './regua.mjs';
import { laudoHtml } from './laudo.mjs';
import { semear } from './seed.mjs';
import { DEMO_MODE } from './api-modo.mjs';
import { consultarConsolidado, garantirChaves, listarChaves, receberLead, resolverChave, resumoConsolidado, sincronizarCentral } from './central.mjs';
import { canaisDe, diagnosticar, empresaDoNumero, rotularOrigem, PERGUNTA_ORIGEM, RESPOSTAS_ORIGEM, TIPOS } from './canais.mjs';
import { extrairMensagens, responderDesafio, validarAssinatura, LOCAIS_CONVERSAO } from './ctwa.mjs';
import { CATALOGO } from './federacao.mjs';
import {
  listarPropriedades, validarCampos, validarChave, formatar, TIPOS_CAMPO,
} from './propriedades.mjs';
import { despacharConversoes, drenarEventos, registrarMudancaDeEtapa } from './conversoes-servico.mjs';
import { extrairAtribuicao, identificadoresHash, temSinal } from './atribuicao.mjs';
import { EVENTOS } from './conversoes.mjs';
import { resolverAnuncios, LOTE_MAXIMO } from './campanhas.mjs';
import {
  CHECKLIST, ESTADOS, NIVEIS, TAMANHO_POR_NIVEL, TOTAL_ITENS, catalogoDoNivel,
  exigeFoto, hashConteudo, itensDoChecklist, pendencias, podeIniciarOS,
  proximoNumero, resumo as resumoVistoria,
} from './vistoria.mjs';
import {
  PLANO_PADRAO, kmEstimado, linhaDoTempo, mediaKmMes, projetarServico,
  recalcular, registrarKm, semearPlano, validarKm,
} from './veiculos.mjs';
import { mkdirSync, createWriteStream } from 'node:fs';
import { readFile, unlink, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  CREDENCIAIS, apagarCredencial, gravarCredencial, lerCredencial, listarCredenciais, temChave,
} from './cofre.mjs';
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

  /*
   * A recusa por papel acontece AQUI, e não na tela.
   *
   * `req.rotaChave` é carimbado pelo despachante. Sem ele — chamada interna,
   * teste — nada é verificado, porque quem chama de dentro já passou por aqui.
   *
   * O papel usado é o DA INSTÂNCIA ativa (`base.papel`), não um papel global:
   * a mesma pessoa pode ser gestora numa empresa e operadora noutra, e é o
   * vínculo daquela instância que vale.
   */
  if (req.rotaChave) {
    const negado = negarPorPapel(req.rotaChave, usuario.papel);
    if (negado) {
      throw new ErroHttp(403, 'papel_insuficiente',
        negado.motivo === 'somente_leitura'
          ? 'Seu acesso é somente de leitura — esta ação grava dados.'
          : `Esta tela é de ${negado.exigido}. Seu acesso é de ${negado.papel}.`);
    }
  }

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

  /*
   * Adiamentos vivos, indexados por (cliente, gatilho).
   *
   * Lidos uma vez e mantidos em memoria: consultar por item transformaria uma
   * fila de 30 linhas em 30 consultas.
   */
  const adiados = new Map();
  for (const a of escopo.todas(
    'select * from adiamentos where {ESCOPO} and desfeito_em is null and ate > ?',
    new Date(refMs).toISOString(),
  )) {
    adiados.set(`${a.cliente_id}|${a.gatilho_chave}`, a);
  }
  const canal = canalPreferido(escopo);
  const politica = canal ? POLITICAS_CANAL[canal.tipo] : null;
  const fila = [];
  const adiadosNaFila = [];

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

      /*
       * Adiado sai da fila — mas nunca em silêncio.
       *
       * `montarRegua` devolve a contagem, e a tela mostra "3 adiados para
       * depois" com um caminho de volta. Adiamento invisível é como uma fila
       * esvazia sem ninguém perceber: o operador adia dez pessoas numa terça,
       * esquece, e na quinta a tela parece dizer que não há trabalho.
       */
      const adiado = adiados.get(`${cand.cliente.id}|${g.chave}`);
      if (adiado) {
        adiadosNaFila.push({
          cliente: { id: cand.cliente.id, nome: cand.cliente.nome },
          gatilho: { chave: g.chave, nome: g.nome },
          ate: adiado.ate,
          motivo: adiado.motivo,
          id: adiado.id,
        });
        continue;
      }

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
  fila.adiados = adiadosNaFila;

  return fila;
}

// ── Rotas ───────────────────────────────────────────────────────────────────
/**
 * Papel mínimo por rota.
 *
 * ISTO NÃO EXISTIA. O `papel` era declarado no schema, filtrava o menu no
 * navegador — e nunca era verificado no servidor. Um `operador` chamava
 * `/api/auditoria`, `/api/central/sincronizar` e `/api/importar/clientes`
 * digitando o endereço: o menu escondia, o servidor entregava.
 *
 * O menu por papel continua sendo organização de tela. A recusa é aqui.
 *
 * Rota que não aparece na tabela exige `operador` — o padrão é o mais restrito
 * que ainda deixa o sistema funcionar. Esquecer de declarar uma rota nova a
 * torna inacessível para `leitura`, e não acessível para todo mundo: o erro
 * cai para o lado seguro.
 */
const ORDEM_PAPEL = { leitura: 0, operador: 1, gestor: 2, soberano: 3 };

const PAPEL_MINIMO = {
  // Governança e dados do grupo inteiro.
  'GET /api/auditoria': 'gestor',
  'GET /api/auditoria/verificar': 'gestor',
  'GET /api/painel/grupo': 'gestor',
  'GET /api/central/resumo': 'gestor',
  'GET /api/central/leads': 'gestor',
  'POST /api/central/sincronizar': 'gestor',
  'POST /api/central/entrada': 'gestor',

  // Aquisição: decide verba, e o que sai daqui vai para plataforma de anúncio.
  'GET /api/atribuicao': 'gestor',
  'GET /api/conversoes': 'gestor',
  'GET /api/conversoes/:id': 'gestor',
  'POST /api/conversoes/processar': 'gestor',
  'POST /api/campanhas/resolver': 'gestor',

  /*
   * Credencial e a chave da conta de anuncio da empresa: quem a troca pode
   * apontar as conversoes para outro pixel. Escrita e SOBERANO; a leitura
   * (que nunca devolve o valor) fica em gestor, para quem cuida da campanha
   * poder conferir se esta configurado.
   */
  /*
   * A vistoria e trabalho de quem esta com o veiculo na mao: operador.
   * Cancelar uma vistoria ja aceita apaga a prova do estado de entrada — e
   * essa e a unica parte que sobe para gestor.
   */
  'DELETE /api/vistorias/:id': 'gestor',

  /*
   * ERP do grupo.
   *
   * Duas camadas, de proposito. Esta tabela barra pelo PAPEL, no despachante,
   * antes de qualquer trabalho de banco — e `contextoErp` barra pelo MODULO,
   * dentro da rota. A primeira e grossa e barata; a segunda e fina e cara.
   *
   * Escrever e administrar sao de soberano: um gestor le o razao do grupo, e
   * nao lanca nele. O eixo do modulo refina isso por pessoa.
   */
  'GET /api/erp/acesso': 'gestor',
  'GET /api/erp/acesso/todos': 'soberano',
  'PUT /api/erp/acesso/:email/:modulo': 'soberano',
  'DELETE /api/erp/acesso/:email/:modulo': 'soberano',

  'GET /api/erp/contas': 'gestor',
  'POST /api/erp/contas/semear': 'soberano',

  'GET /api/erp/lancamentos': 'gestor',
  'GET /api/erp/lancamentos/:id': 'gestor',
  'POST /api/erp/lancamentos': 'soberano',
  'POST /api/erp/lancamentos/:id/estornar': 'soberano',

  'GET /api/erp/balancete': 'gestor',
  'GET /api/erp/conferir': 'gestor',
  'GET /api/erp/periodos': 'gestor',
  'POST /api/erp/periodos/:competencia/fechar': 'soberano',
  'POST /api/erp/periodos/:competencia/reabrir': 'soberano',

  'GET /api/erp/titulos': 'gestor',
  'POST /api/erp/titulos': 'gestor',
  'POST /api/erp/titulos/:id/baixar': 'gestor',
  'POST /api/erp/titulos/:id/cancelar': 'soberano',
  'GET /api/erp/posicao': 'gestor',
  'POST /api/erp/rateio': 'soberano',

  'POST /api/erp/sincronizar': 'soberano',
  'GET /api/erp/fatos': 'gestor',
  'POST /api/erp/fatos/:id/reconhecer': 'soberano',
  'GET /api/erp/painel': 'gestor',

  'GET /api/erp/parceiros': 'gestor',
  'POST /api/erp/parceiros': 'gestor',
  'GET /api/erp/colaboradores': 'gestor',
  'POST /api/erp/colaboradores': 'gestor',

  'GET /api/credenciais': 'gestor',
  'PUT /api/credenciais/:chave': 'soberano',
  'DELETE /api/credenciais/:chave': 'soberano',

  // `POST /api/regua/adiar` NAO entra aqui de proposito: adiar e trabalho de
  // quem atende, e exigir gestor para isso devolveria a fila ao estado em que
  // ignorar era a unica saida.

  // Escrita estrutural: muda o CRM para todo mundo, não um registro.
  'POST /api/propriedades': 'gestor',
  'DELETE /api/propriedades/:id': 'gestor',
  'POST /api/importar/clientes': 'gestor',

  // Apaga e refaz a base.
  'POST /api/demo/reiniciar': 'gestor',
  'POST /api/demo/reancorar': 'gestor',
};

/**
 * Quem pode chamar `rota`? `null` quando pode.
 *
 * `leitura` nao e "um papel abaixo de operador" numa escala: e OUTRA coisa —
 * ve o que o operador ve, e nao escreve nada. Tratado como degrau de escala,
 * ele seria recusado em quase tudo e a conta nasceria inutil.
 */
function negarPorPapel(rota, papel) {
  const exigido = PAPEL_MINIMO[rota] ?? 'operador';

  if (papel === 'leitura') {
    const metodo = String(rota).split(' ')[0];
    if (metodo !== 'GET') return { exigido: 'operador', papel, motivo: 'somente_leitura' };
    // Le o que o operador le. Governanca continua exigindo gestor.
    return exigido === 'operador' ? null : { exigido, papel };
  }

  const tem = ORDEM_PAPEL[papel] ?? -1;
  if (tem >= ORDEM_PAPEL[exigido]) return null;
  return { exigido, papel };
}

/**
 * Token de leitura da Graph API (Marketing), DA EMPRESA ativa.
 *
 * Separado do token de CONVERSAO de proposito: este so precisa de `ads_read`,
 * e o outro de `manage_events`. Um token unico com as duas permissoes e mais
 * comodo e transforma um vazamento de leitura em permissao de escrita.
 *
 * A busca e por instancia primeiro e ambiente depois. Antes era so ambiente, e
 * uma variavel de processo nao cobre tres contas de anuncio: resolver o nome
 * das campanhas funcionava para uma empresa e falhava calado nas outras duas.
 */
function tokenDeMarketing(escopo) {
  if (!escopo) return process.env.FORTCRM_META_MARKETING_TOKEN || null;
  return lerCredencial(escopo, 'meta_marketing_token').valor;
}

/** Texto limpo e limitado, ou null. Usado por todas as escritas de oficina. */
function texto(v, max) {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Onde a midia da vistoria mora.
 *
 * Irmao do diretorio das instancias, e nao dentro dele: `VACUUM INTO` copia o
 * diretorio dos bancos toda madrugada, e foto e video nao tem por que entrar
 * nessa copia — sao imutaveis depois de gravados e tem politica de retencao
 * propria.
 */
function diretorioDeMidia(fed) {
  return join(dirname(fed.diretorio), 'midia');
}

/**
 * As cinco vistas do desenho da carroceria, na ordem em que se dá a volta no
 * veículo — a mesma ordem do grupo "Exterior" do check-list.
 */
export const VISTAS_CARROCERIA = ['frente', 'lateral_dir', 'traseira', 'lateral_esq', 'teto'];

/** Tipos de avaria, com a letra que vai dentro do pino no desenho. */
export const TIPOS_AVARIA = {
  risco: { nome: 'Risco', letra: 'R' },
  amassado: { nome: 'Amassado', letra: 'A' },
  trinca: { nome: 'Trinca', letra: 'T' },
  ferrugem: { nome: 'Ferrugem', letra: 'F' },
  faltando: { nome: 'Faltando', letra: 'X' },
  outro: { nome: 'Outro', letra: 'O' },
};

/** Formas de pagamento combinadas na recepção. */
export const PAGAMENTOS = ['dinheiro', 'pix', 'debito', 'credito', 'boleto', 'faturado'];

/**
 * O desenho da carroceria e a lista de serviços fazem parte do que se assina.
 *
 * Ficam fora do hash quando não existem, para não mudar a assinatura de toda
 * vistoria já enviada — mas onde existem, mexer neles depois do envio derruba
 * o aceite, igual a mexer num item.
 */
function extrasDaVistoria(escopo, vistoriaId) {
  return {
    avarias: escopo.todas(
      'select * from vistoria_avarias where {ESCOPO} and vistoria_id = ?', vistoriaId),
    servicos: escopo.todas(
      'select * from vistoria_servicos where {ESCOPO} and vistoria_id = ?', vistoriaId),
  };
}

/**
 * Contexto do ERP: a central, e a checagem dos dois eixos de permissão.
 *
 * Toda rota do ERP passa por aqui. A escala linear (gestor/soberano) e a
 * concessão do módulo são checadas juntas — ver `permissoes.mjs` para por que
 * são dois eixos e não um.
 *
 * O `ErroContabil` e o `ErroDePermissao` viram `ErroHttp` num lugar só: sem
 * isto, cada rota repetiria o mesmo try/catch e uma delas um dia esqueceria,
 * devolvendo 500 com o texto do erro contábil dentro.
 */
function contextoErp(fed, req, { modulo, nivel = 'ler' } = {}) {
  const { usuario, empresa, banco } = contexto(fed, req, { exigeEmpresa: false });
  const central = fed.abrirCentral();
  const sql = central.sistema();

  // A primeira subida destrava quem pode destravar. Depois disso, nunca mais.
  semearAcesso(sql, usuario.papel === 'soberano' ? usuario.email : '');

  /*
   * A recusa de modulo tem de sair como 403, e nao como 500.
   *
   * `exigirModulo` levanta `ErroDePermissao`, que o despachante nao conhece —
   * e o que o operador via era "Falha ao processar a requisicao", com o motivo
   * real so no log do servidor. Traduzir aqui, e nao em cada rota, e o que
   * garante que nenhuma esqueca.
   */
  if (modulo) {
    comoHttp(() => exigirModulo(sql, {
      email: usuario.email, papel: usuario.papel, modulo, nivel,
    }));
  }
  return { central, sql, usuario, empresa, banco };
}

/** Traduz a recusa do domínio em resposta HTTP, preservando código e detalhe. */
function comoHttp(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroHttp) throw e;
    if (e.codigo) {
      const status = e.codigo === 'sem_permissao' ? 403
        : e.codigo === 'nao_encontrado' ? 404 : 422;
      throw new ErroHttp(status, e.codigo, e.message, e.detalhe ?? undefined);
    }
    throw e;
  }
}

/**
 * Valor que chega da tela — e a recusa de adivinhar qual é a unidade.
 *
 * A primeira versao aceitava numero e tratava como centavos. O dialogo do
 * sistema converte campo decimal para REAIS em numero ("1.850,00" vira 1850), e
 * uma baixa de mil oitocentos e cinquenta reais entrou como dezoito e cinquenta
 * — sem erro nenhum, porque as duas leituras sao inteiros validos.
 *
 * Agora a unidade e explicita ou nao passa:
 *
 *   `valor_centavos` — inteiro, em centavos. O nome carrega a unidade.
 *   `valor`          — TEXTO no formato brasileiro. "1.850,00".
 *
 * Numero cru em `valor` e recusado de proposito. E ambiguo, e escolher uma das
 * duas leituras em silencio e como o erro acima acontece.
 */
function valorDoCorpo(corpo, campo = 'valor') {
  const emCentavos = corpo?.valor_centavos ?? corpo?.[`${campo}_centavos`];
  if (emCentavos != null) {
    if (!Number.isInteger(emCentavos)) {
      throw new ErroHttp(422, 'valor_invalido',
        `${campo}_centavos precisa ser inteiro — centavo nao se divide.`);
    }
    return emCentavos;
  }

  const bruto = corpo?.[campo] ?? corpo?.valor;
  if (typeof bruto === 'number') {
    throw new ErroHttp(422, 'unidade_ambigua',
      `Numero cru nao diz a unidade. Use "${campo}_centavos" para inteiro em `
      + `centavos, ou "${campo}" como texto ("1.850,00").`);
  }
  try {
    const c = paraCentavos(bruto, campo);
    if (c == null) throw new ErroHttp(422, 'valor_obrigatorio', `Informe o ${campo}.`);
    return c;
  } catch (e) {
    if (e instanceof ErroHttp) throw e;
    throw new ErroHttp(422, 'valor_invalido', e.message);
  }
}

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

  /**
   * Sonda de saude, sem sessao.
   *
   * Existe porque o healthcheck do contêiner batia em `POST /api/sessao` com
   * corpo vazio: gastava o balde de login (12/min), enchia o log de tentativas
   * falhas e, pior, respondia 200 sem tocar em banco nenhum — um SQLite
   * corrompido passava no exame de saude.
   *
   * Aqui a checagem e a que importa: da para LER cada instancia? Um processo
   * de pe com banco ilegivel nao esta saudavel, esta so escutando a porta.
   *
   * A resposta e deliberadamente pobre. E uma porta aberta a internet: nao diz
   * versao, nao diz nome de empresa, nao conta registro e nao devolve caminho
   * de arquivo. Quem esta de fora so precisa saber se pode mandar trafego.
   */
  'GET /api/health': (fed) => {
    let vivas = 0;
    let total = 0;
    for (const cod of fed.codigosDeEmpresa()) {
      total += 1;
      try {
        fed.abrir(cod).sistema().prepare('select 1 as v').get();
        vivas += 1;
      } catch { /* instancia fora conta como fora, e nao derruba a sonda */ }
    }
    if (!vivas) throw new ErroHttp(503, 'sem_instancia', 'Nenhuma instância responde.');
    return ok({ ok: true, instancias: `${vivas}/${total}` });
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
  /*
   * Busca global: um campo so, para quem nao sabe em que menu a coisa esta.
   *
   * Sao dezessete telas. Achar "a OS do Antonio" custava lembrar que OS mora
   * em Oficina, abrir a tela e varrer duzentas linhas — e quem esta no balcao
   * com o cliente na frente nao faz isso, liga para o colega.
   *
   * Busca SO a instancia ativa. Varrer as tres de uma vez seria comodo e seria
   * exatamente o vazamento que a separacao por banco existe para impedir: uma
   * lista onde o cliente da Agrofort aparece ao lado do da Minas Pecas, e um
   * clique errado leva o operador para dentro de outra empresa. Quando nao ha
   * resultado aqui, a resposta DIZ em que outras instancias a pessoa poderia
   * procurar — a travessia existe, mas e ela quem decide fazer.
   */
  'GET /api/buscar': (fed, req, _p, _c, url) => {
    const { escopo, empresa, permitidas } = contexto(fed, req);

    const bruto = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const outras = permitidas
      .filter((e) => e.id !== empresa.id)
      .map((e) => ({ instancia: e.instancia, nome: e.nome }));
    if (bruto.length < 2) return ok([], { curto: true, empresa: empresa.nome, outras });

    // `sem_acento` roda dos DOIS lados: no banco e aqui. Comparar "antonio"
    // com "Antônio" so funciona se o termo digitado passar pelo mesmo filtro.
    const q = bruto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const like = `%${q}%`;
    const digitos = bruto.replace(/\D/g, '');
    const foneLike = digitos ? `%${digitos}%` : '';
    const placa = `%${bruto.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`;

    /*
     * A pontuacao e feita aqui, e nao em `order by`: a ordem que importa e
     * ENTRE os tipos. O cliente cujo nome e exatamente o termo tem de vencer a
     * ordem de servico que apenas contem o termo no meio do componente — e
     * cinco consultas ordenadas isoladamente nunca produzem isso.
     */
    const pontos = (...campos) => {
      let melhor = 0;
      for (const c of campos) {
        const v = String(c ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
        if (!v) continue;
        if (v === q) return 3;
        if (v.startsWith(q)) melhor = Math.max(melhor, 2);
        else if (v.includes(q)) melhor = Math.max(melhor, 1);
      }
      return melhor;
    };

    const achados = [];
    const indisponiveis = [];
    /*
     * Uma consulta que falha degrada a busca; nao derruba.
     *
     * A federacao admite instancias em versoes diferentes de schema — e por
     * isso que `migracoes.mjs` existe. Uma coluna que ainda nao chegou numa
     * delas nao pode transformar a busca inteira em erro 500 no meio do
     * atendimento.
     *
     * Mas o silencio seria pior que a falha: o que caiu viaja em
     * `meta.indisponiveis`, do mesmo jeito que a consulta consolidada ja faz.
     */
    const seguro = (oque, fn) => { try { fn(); } catch { indisponiveis.push(oque); } };

    seguro('clientes', () => escopo.todas(
      `select id, nome, telefone, cpf, cidade, perfil from clientes
       where {ESCOPO} and (sem_acento(nome) like ? or sem_acento(coalesce(email,'')) like ?
                           or (? <> '' and telefone like ?)
                           or (? <> '' and coalesce(cpf,'') like ?))
       order by nome limit 8`,
      like, like, foneLike, foneLike, foneLike, foneLike,
    ).forEach((c) => achados.push({
      tipo: 'cliente', id: c.id, titulo: c.nome,
      sub: [c.cidade, c.telefone, c.cpf].filter(Boolean).join(' · '),
      rota: `clientes?ficha=${encodeURIComponent(c.id)}`,
      ponto: pontos(c.nome, c.telefone),
    })));

    seguro('veiculos', () => escopo.todas(
      `select v.id, v.placa, v.marca, v.modelo, v.cliente_id, c.nome cliente_nome
       from veiculos v join clientes c on c.id = v.cliente_id
       where v.{ESCOPO} and (replace(upper(v.placa), '-', '') like ?
                             or sem_acento(coalesce(v.modelo, '')) like ?
                             or sem_acento(coalesce(v.marca, '')) like ?)
       order by v.placa limit 6`,
      placa, like, like,
    ).forEach((v) => achados.push({
      tipo: 'veiculo', id: v.id, titulo: v.placa,
      sub: [[v.marca, v.modelo].filter(Boolean).join(' '), v.cliente_nome].filter(Boolean).join(' · '),
      // O veiculo mora dentro da ficha do dono: e la que estao o historico e a
      // revisao projetada. Mandar para a lista de frota perderia os dois.
      rota: `clientes?ficha=${encodeURIComponent(v.cliente_id)}`,
      ponto: pontos(v.placa, v.modelo, v.marca),
    })));

    seguro('ordens', () => escopo.todas(
      `select o.id, o.numero, o.componente, o.status, c.nome cliente_nome, v.placa
       from ordens_servico o
       join clientes c on c.id = o.cliente_id
       left join veiculos v on v.id = o.veiculo_id
       where o.{ESCOPO} and (sem_acento(o.numero) like ? or sem_acento(o.componente) like ?
                             or sem_acento(c.nome) like ?)
       order by o.aberta_em desc limit 6`,
      like, like, like,
    ).forEach((o) => achados.push({
      tipo: 'ordem', id: o.id, titulo: `OS ${o.numero}`,
      sub: [o.componente, o.cliente_nome, o.placa].filter(Boolean).join(' · '),
      rota: `ordens?foco=${encodeURIComponent(o.id)}`,
      ponto: pontos(o.numero, o.componente),
    })));

    seguro('pedidos', () => escopo.todas(
      `select p.id, p.numero, p.status, p.valor_centavos, c.nome cliente_nome
       from pedidos p join clientes c on c.id = p.cliente_id
       where p.{ESCOPO} and (sem_acento(p.numero) like ? or sem_acento(c.nome) like ?)
       order by p.feito_em desc limit 6`,
      like, like,
    ).forEach((x) => achados.push({
      tipo: 'pedido', id: x.id, titulo: `Pedido ${x.numero}`,
      sub: [x.cliente_nome, x.status].filter(Boolean).join(' · '),
      rota: `pedidos?foco=${encodeURIComponent(x.id)}`,
      ponto: pontos(x.numero),
    })));

    seguro('oportunidades', () => escopo.todas(
      `select o.id, o.titulo, o.etapa, coalesce(c.nome, '') cliente_nome
       from oportunidades o left join clientes c on c.id = o.cliente_id
       where o.{ESCOPO} and (sem_acento(o.titulo) like ? or sem_acento(coalesce(c.nome, '')) like ?)
       limit 6`,
      like, like,
    ).forEach((o) => achados.push({
      tipo: 'oportunidade', id: o.id, titulo: o.titulo,
      sub: [o.cliente_nome, o.etapa].filter(Boolean).join(' · '),
      rota: `pipeline?foco=${encodeURIComponent(o.id)}`,
      ponto: pontos(o.titulo),
    })));

    seguro('catalogo', () => escopo.todas(
      `select id, sku, nome, categoria from catalogo
       where {ESCOPO} and (sem_acento(nome) like ? or sem_acento(sku) like ?)
       order by nome limit 6`,
      like, like,
    ).forEach((i) => achados.push({
      tipo: 'catalogo', id: i.id, titulo: i.nome,
      sub: [i.sku, i.categoria].filter(Boolean).join(' · '),
      rota: `catalogo?foco=${encodeURIComponent(i.id)}`,
      ponto: pontos(i.nome, i.sku),
    })));

    // Empate desfeito pelo tipo: quem busca no balcao busca PESSOA na esmagadora
    // maioria das vezes, e o resto e contexto dela.
    const ordemTipo = {
      cliente: 0, veiculo: 1, ordem: 2, pedido: 3, oportunidade: 4, catalogo: 5,
    };
    achados.sort((a, b) => (b.ponto - a.ponto)
      || (ordemTipo[a.tipo] - ordemTipo[b.tipo])
      || a.titulo.localeCompare(b.titulo, 'pt-BR'));

    return ok(achados.slice(0, 20), {
      q: bruto, empresa: empresa.nome, outras, total: achados.length,
      ...(indisponiveis.length ? { indisponiveis } : {}),
    });
  },

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

    const props = listarPropriedades(escopo, 'cliente');
    const valores = seguroJsonApi(cliente.campos) ?? {};

    return ok({
      cliente,
      // A ficha mostrava `origem: 'guincho_24h'` cru. Rotular aqui, e não no
      // navegador, mantém o catálogo como fonte única.
      origem: rotularOrigem(empresa.codigo, cliente.origem),
      // O registro viaja junto com o valor: é ele que diz à tela como desenhar
      // e como rotular, sem a tela precisar saber que campos existem.
      propriedades: props.map((d) => ({
        ...d,
        valor: d.origem === 'sistema' ? cliente[d.chave] : (valores[d.chave] ?? null),
        exibicao: formatar(d, d.origem === 'sistema' ? cliente[d.chave] : valores[d.chave]),
      })),
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
      id,
      nome: corpo.nome,
      telefone: corpo.telefone ?? null,
      // Só dígitos: com e sem máscara seriam duas pessoas diferentes na busca.
      cpf: String(corpo.cpf ?? '').replace(/\D/g, '') || null,
      email: corpo.email ?? null,
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
    const permitidos = ['nome', 'telefone', 'cpf', 'email', 'cidade', 'uf', 'perfil', 'observacao'];
    const dados = Object.fromEntries(
      Object.entries(corpo ?? {}).filter(([k]) => permitidos.includes(k)),
    );
    // Mesma regra da criacao: documento entra so com digitos.
    if (dados.cpf !== undefined) dados.cpf = String(dados.cpf).replace(/\D/g, '') || null;
    if (corpo?.consentimento_lgpd !== undefined) {
      dados.consentimento_lgpd = corpo.consentimento_lgpd ? 1 : 0;
      dados.consentimento_em = corpo.consentimento_lgpd ? agora() : null;
    }

    /*
     * Campos personalizados sao validados contra o REGISTRO, no servidor.
     *
     * E o que compra de volta a integridade que a coluna JSON nao tem. Sem
     * isso, qualquer cliente da API grava qualquer chave com qualquer forma, e
     * em seis meses a coluna vira deposito de lixo que nenhuma tela mostra.
     *
     * Chave desconhecida e DESCARTADA e reportada — nunca gravada em silencio.
     */
    let avisos = [];
    if (corpo?.campos !== undefined) {
      const props = listarPropriedades(escopo, 'cliente');
      const v = validarCampos(props, corpo.campos);
      if (!v.valido && v.erros.some((e) => !e.includes('ignorado'))) {
        throw new ErroHttp(400, 'campos_invalidos', v.erros.join(' '));
      }
      avisos = v.erros;
      const atual = seguroJsonApi(
        escopo.uma('select campos from clientes where {ESCOPO} and id = ?', p.id)?.campos,
      ) ?? {};
      dados.campos = JSON.stringify({ ...atual, ...v.limpo });
    }

    const n = escopo.atualizar('clientes', p.id, dados);
    if (!n) throw new ErroHttp(404, 'nao_encontrado', 'Cliente não encontrado.');
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'cliente.editar',
      entidade: 'clientes', entidadeId: p.id, dados,
    });
    return ok({
      ...escopo.uma('select * from clientes where {ESCOPO} and id = ?', p.id),
      avisos: avisos.length ? avisos : undefined,
    });
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
    const antes = escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', p.id);
    if (!antes) throw new ErroHttp(404, 'nao_encontrado', 'Oportunidade não encontrada.');

    const dados = { atualizado_em: agora() };
    if (corpo?.etapa) {
      if (!ETAPAS.includes(corpo.etapa)) {
        throw new ErroHttp(422, 'etapa_invalida', `Etapa desconhecida: ${corpo.etapa}`);
      }

      /*
       * Venda ja contada pela Meta nao volta atras.
       *
       * O Purchase enviado pela Conversions API entra no aprendizado do
       * algoritmo e no relatorio de ROAS do Gerenciador. Arrastar o cartao de
       * volta para "negociacao" nao desfaz nada la — so faz o CRM parar de
       * concordar com o que a Meta ja acredita. A partir dai as duas telas
       * contam historias diferentes, e a divergencia so aparece na reuniao de
       * verba.
       *
       * A trava e por CONVERSAO DESPACHADA, e nao por etapa: em demonstracao
       * nada sai (o registro fica com motivo `simulado`) e o cartao continua
       * livre, que e o correto — nao ha nada do outro lado para contradizer.
       *
       * `desconhecido` tranca junto de proposito. Resposta ambigua e
       * exatamente quando NAO se pode agir como se nada tivesse acontecido.
       */
      const despachada = escopo.uma(
        `select id, destino, status, enviado_em from conversoes
         where {ESCOPO} and oportunidade_id = ? and evento = 'venda'
           and status in ('enviado', 'desconhecido')
           and coalesce(motivo, '') <> 'simulado'
         limit 1`,
        p.id,
      );
      if (despachada && corpo.etapa !== 'ganho') {
        throw new ErroHttp(409, 'venda_ja_contada',
          'Esta venda já foi enviada como conversão e não pode voltar de etapa. '
          + 'A Meta e o Google já a contabilizaram; mudar aqui só faria o CRM '
          + 'discordar do que eles registraram. Para corrigir de verdade, trate a '
          + 'devolução no Gerenciador de Anúncios.',
          { conversao: despachada.id, destino: despachada.destino, status: despachada.status });
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

      /*
       * Ganhar exige valor e numero do pedido — AQUI, com a pessoa na frente.
       *
       * Sem valor, `avaliarConversao` recusa o Purchase la adiante com
       * `valor_obrigatorio`, dentro do worker, onde ninguem le. O evento mais
       * valioso do funil era justamente o mais facil de perder em silencio.
       */
      if (corpo.etapa === 'ganho') {
        const valor = corpo?.valor_centavos !== undefined
          ? num(corpo.valor_centavos, 0)
          : (antes.valor_centavos ?? 0);
        if (!(valor > 0)) {
          throw new ErroHttp(422, 'valor_obrigatorio',
            'Venda fechada exige o valor. Sem ele a conversão não ensina retorno — '
            + 'vira só mais um "converteu", e o anúncio não aprende nada.');
        }
        const pedido = String(corpo?.pedido_ref ?? antes.pedido_ref ?? '').trim();
        if (!pedido) {
          throw new ErroHttp(422, 'pedido_obrigatorio',
            'Informe o número do pedido, contrato ou OS. É o que impede um reenvio '
            + 'de virar uma segunda venda no Gerenciador de Anúncios.');
        }
        dados.valor_centavos = valor;
        dados.pedido_ref = pedido.slice(0, 60);
        dados.probabilidade = 100;
      }
    }
    if (corpo?.probabilidade !== undefined) dados.probabilidade = num(corpo.probabilidade, 20);
    if (corpo?.posicao !== undefined) dados.posicao = Number(corpo.posicao);
    if (corpo?.valor_centavos !== undefined && dados.valor_centavos === undefined) {
      dados.valor_centavos = num(corpo.valor_centavos, 0);
    }
    escopo.atualizar('oportunidades', p.id, dados);

    const atual = escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', p.id);

    // A mudança de etapa é o gatilho da conversão offline — mas aqui só o
    // EVENTO é gravado. Decidir consentimento, identificador e destino dentro
    // desta transação deixaria a movimentação do funil refém de uma regra de
    // marketing, e um erro lá derrubaria o arrastar do cartão na tela.
    let eventoConversao = null;
    if (dados.etapa && dados.etapa !== antes.etapa) {
      eventoConversao = registrarMudancaDeEtapa(escopo, {
        oportunidade: atual, etapaAnterior: antes.etapa, ator: usuario.email,
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
      /*
       * So quando nao ha o que fazer. O diagnostico custa quatro contagens, e
       * fazer isso em toda abertura da tela seria pagar por resposta que
       * ninguem le — na fila cheia, o operador quer a fila.
       */
      /*
       * Os adiados viajam SEMPRE, não só quando a fila esvazia.
       *
       * Adiamento invisível é uma fila que encolhe sem ninguém perceber: o
       * operador adia dez pessoas numa terça, esquece, e na quinta a tela
       * parece dizer que não há trabalho.
       */
      adiados: fila.adiados ?? [],
      diagnostico: fila.some((f) => f.decisao.permitido)
        ? null
        : diagnosticarFilaVazia(escopo, { fila, adiados: fila.adiados ?? [] }),
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

    /*
     * O ERP tambem e derivado das instancias, e sofre PIOR do que a projecao.
     *
     * A chave de idempotencia dos fatos e `(instancia, tipo, ref)`, e `ref` e o
     * id da linha na instancia. Recriadas as instancias, os ids mudam — e a
     * proxima sincronizacao colhe tudo outra vez como inedito. Dezoito ordens
     * de servico viram trinta e seis, e a receita do grupo dobra sem que nada
     * acuse.
     *
     * Aconteceu de verdade: alguem recarregou a demonstracao dois minutos antes
     * de um deploy, e producao ficou com 48 fatos apontando para registros
     * mortos, esperando o proximo clique em "Sincronizar" para dobrar tudo.
     *
     * Limpa o movimento, preserva as definicoes, e ressincroniza no mesmo
     * pedido — para a recarga terminar com o livro coerente, e nao com a
     * armadilha armada.
     */
    const erpLimpo = limparMovimento(fed.abrirCentral().sistema());
    const erp = sincronizarFatos(fed, { ator: c.usuario.email });

    return ok({
      instancias: porInstancia,
      central,
      erp: { limpo: erpLimpo, resincronizado: erp.postagem?.postados ?? 0, completo: erp.completo },
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

    const { linhas, falhas, completo } = fed.consultar(codigos, (banco) => banco.sistema()
      .prepare(`select seq, empresa_id, ator, acao, entidade, entidade_id, dados, hash, criado_em
                from audit_log order by seq desc limit 120`)
      .all());

    linhas.sort((a, b) => Date.parse(b.criado_em) - Date.parse(a.criado_em));
    // A auditoria incompleta e dita, e nao inferida de uma lista de falhas que
    // a tela pode nao olhar: "nao ha registro" e "nao consegui ler" sao coisas
    // diferentes, e a segunda nao pode passar por primeira.
    return ok(linhas.slice(0, 250), { indisponiveis: falhas, completo });
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

  /**
   * Adiar um contato: "esse eu falo amanhã".
   *
   * Sem isto a fila só tinha disparar ou ignorar — e ignorar faz o item voltar
   * idêntico no dia seguinte, até o operador aprender a desconfiar da lista.
   *
   * O adiamento é por (cliente, gatilho): adiar a revisão de um caminhão não
   * silencia a cobrança de orçamento do mesmo cliente. São conversas diferentes.
   */
  'POST /api/regua/adiar': (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);

    const clienteId = String(corpo?.clienteId ?? '');
    const gatilho = String(corpo?.gatilho ?? '');
    if (!clienteId || !gatilho) {
      throw new ErroHttp(400, 'faltam_dados', 'Informe o cliente e o gatilho.');
    }

    const cliente = escopo.uma('select nome from clientes where {ESCOPO} and id = ?', clienteId);
    if (!cliente) throw new ErroHttp(404, 'nao_encontrado', 'Cliente não encontrado.');

    const dias = num(corpo?.dias, 1);
    if (dias < 1 || dias > 365) {
      throw new ErroHttp(400, 'prazo_invalido', 'O adiamento vai de 1 a 365 dias.');
    }
    const ate = new Date(Date.now() + dias * 86400000).toISOString();

    /*
     * Um adiamento vivo por (cliente, gatilho). Adiar de novo SUBSTITUI em vez
     * de empilhar — senão desfazer o de cima revelaria outro embaixo, e o
     * operador não teria como saber quantos ainda existem.
     */
    escopo.todas(
      `select id from adiamentos
       where {ESCOPO} and cliente_id = ? and gatilho_chave = ? and desfeito_em is null`,
      clienteId, gatilho,
    ).forEach((a) => escopo.atualizar('adiamentos', a.id, { desfeito_em: agora() }));

    const id = novoId();
    escopo.inserir('adiamentos', {
      id,
      cliente_id: clienteId,
      gatilho_chave: gatilho,
      ate,
      motivo: corpo?.motivo ? String(corpo.motivo).slice(0, 200) : null,
      criado_por: usuario.email,
      criado_em: agora(),
    });

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'regua.adiar',
      entidade: 'adiamentos', entidadeId: id,
      dados: { cliente: cliente.nome, gatilho, dias, ate },
    });

    return ok({ id, ate, cliente: cliente.nome, dias });
  },

  /** Desfazer: o item volta para a fila na próxima montagem. */
  'POST /api/regua/adiar/:id/desfazer': (fed, req, p) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const a = escopo.uma('select * from adiamentos where {ESCOPO} and id = ?', p.id);
    if (!a) throw new ErroHttp(404, 'nao_encontrado', 'Adiamento não encontrado.');
    if (a.desfeito_em) return ok({ desfeito: true, jaEstava: true });

    escopo.atualizar('adiamentos', p.id, { desfeito_em: agora() });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'regua.adiar.desfazer',
      entidade: 'adiamentos', entidadeId: p.id, dados: { gatilho: a.gatilho_chave },
    });
    return ok({ desfeito: true });
  },

  /**
   * Resolve o nome das campanhas por tras dos `ad_id` ja capturados.
   *
   * E a UNICA chamada de saida do sistema hoje, e de proposito e uma LEITURA:
   * ler o nome de um anuncio da propria conta nao gasta verba, nao conta
   * conversao e nao muda entrega. Por isso nao passa por `DEMO_MODE` — passa
   * por haver token, que so existe onde alguem configurou.
   *
   * Fica FORA do caminho da tela: `GET /api/atribuicao` le so o que ja esta
   * guardado. Buscar durante a renderizacao deixaria a tela de origem refem da
   * latencia da Meta, e de um token vencido.
   */
  'POST /api/campanhas/resolver': async (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);

    // Pedidos explicitos ganham prioridade; sem eles, varre os pendentes.
    const pedidos = Array.isArray(corpo?.adIds) ? corpo.adIds.map(String) : [];
    const alvo = pedidos.length ? pedidos : escopo.todas(
      `select distinct a.source_ad_id as id
       from atribuicoes a
       left join dimensoes_campanha d
         on d.empresa_id = a.empresa_id and d.source_ad_id = a.source_ad_id
       where a.{ESCOPO} and a.source_ad_id is not null and d.campanha_nome is null
       limit ?`,
      LOTE_MAXIMO,
    ).map((r) => r.id);

    if (!alvo.length) {
      return ok({ resolvidos: 0, falhas: 0, pulados: 0, nadaAFazer: true });
    }

    const token = tokenDeMarketing(escopo);
    const r = await resolverAnuncios(escopo, alvo, { token });

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'campanha.resolver',
      entidade: 'dimensoes_campanha', entidadeId: null,
      // O token NAO entra na auditoria, nem mascarado: trilha de auditoria e
      // exatamente o arquivo que se entrega a terceiro quando algo dá errado.
      dados: {
        pedidos: alvo.length, resolvidos: r.resolvidos, falhas: r.falhas,
        semToken: !!r.semToken,
      },
    });

    return ok(r, { semToken: !!r.semToken });
  },

  /**
   * O que esta configurado — e NUNCA o valor.
   *
   * Devolver o segredo ao navegador, ainda que so para quem e soberano, o
   * espalharia por cache, historico e extensao instalada. Quem precisa do valor
   * e o servidor, e ele ja o tem. A tela recebe a pista (quatro caracteres
   * finais), de onde veio e quando mudou.
   */
  'GET /api/credenciais': (fed, req) => {
    const { escopo } = contexto(fed, req);
    return ok(listarCredenciais(escopo), { temChaveMestra: temChave() });
  },

  'PUT /api/credenciais/:chave': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    if (!CREDENCIAIS[p.chave]) {
      throw new ErroHttp(404, 'credencial_desconhecida', 'Esta credencial não existe no sistema.');
    }
    if (!temChave()) {
      throw new ErroHttp(503, 'sem_chave_mestra',
        'O servidor não tem chave-mestra configurada (FORTCRM_CHAVE_MESTRA). '
        + 'Sem ela não há como guardar segredo cifrado — e guardar em claro não é opção.');
    }

    const valor = String(corpo?.valor ?? '').trim();
    if (valor.length < 8) {
      throw new ErroHttp(422, 'valor_invalido', 'Credencial curta demais para ser real.');
    }

    const r = gravarCredencial(escopo, p.chave, valor, {
      ator: usuario.email, agoraIso: agora(), novoId,
    });

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'credencial.gravar',
      entidade: 'credenciais', entidadeId: p.chave,
      // Só a pista entra na trilha. Auditoria é exatamente o arquivo que se
      // entrega a terceiro quando algo dá errado.
      dados: { chave: p.chave, pista: r.pista },
    });
    return ok(r);
  },

  'DELETE /api/credenciais/:chave': (fed, req, p) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    if (!CREDENCIAIS[p.chave]) {
      throw new ErroHttp(404, 'credencial_desconhecida', 'Esta credencial não existe no sistema.');
    }
    const apagou = apagarCredencial(escopo, p.chave);
    if (apagou) {
      banco.auditar({
        empresaId: empresa.id, ator: usuario.email, acao: 'credencial.apagar',
        entidade: 'credenciais', entidadeId: p.chave, dados: { chave: p.chave },
      });
    }
    // Apagar devolve o sistema ao que houver no ambiente — a tela precisa
    // saber disso, senão parece que a credencial continua lá por engano.
    const depois = lerCredencial(escopo, p.chave);
    return ok({ apagou, origem: depois.origem, aindaDefinida: !!depois.valor });
  },

  // ── Oficina: veiculos, vistoria e midia ──────────────────────────────────

  /** O catalogo do check-list. A tela nao guarda copia dele. */
  'GET /api/checklist': (fed, req, _p, _c, url) => {
    contexto(fed, req);
    const nivel = url?.searchParams.get('nivel');
    return ok({
      grupos: nivel ? catalogoDoNivel(nivel) : CHECKLIST,
      total: nivel ? TAMANHO_POR_NIVEL[nivel] : TOTAL_ITENS,
      estados: ESTADOS,
      niveis: NIVEIS,
      tamanhos: TAMANHO_POR_NIVEL,
    });
  },

  /**
   * Cadastrar veiculo — que ate agora so entrava pela carga inicial.
   *
   * Junto com o veiculo nasce o PLANO de manutencao. Um veiculo sem plano nao
   * aparece em previsao nenhuma, e cadastrar em dois passos garante que o
   * segundo nao aconteca.
   */
  'POST /api/veiculos': (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);

    const placa = String(corpo?.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (placa.length < 7) {
      throw new ErroHttp(422, 'placa_invalida', 'A placa precisa de 7 caracteres (ABC1D23 ou ABC1234).');
    }
    const cliente = escopo.uma('select id, nome from clientes where {ESCOPO} and id = ?', corpo?.cliente_id);
    if (!cliente) throw new ErroHttp(404, 'cliente_nao_encontrado', 'Informe o dono do veículo.');

    const repetida = escopo.uma('select id from veiculos where {ESCOPO} and placa = ?', placa);
    if (repetida) {
      throw new ErroHttp(409, 'placa_repetida',
        'Já existe um veículo com esta placa nesta empresa.', { veiculoId: repetida.id });
    }

    const id = novoId();
    const km = corpo?.km_ultima != null ? num(corpo.km_ultima, 0) : null;
    escopo.inserir('veiculos', {
      id,
      cliente_id: cliente.id,
      placa,
      marca: texto(corpo?.marca, 60),
      modelo: texto(corpo?.modelo, 80),
      ano: corpo?.ano ? num(corpo.ano, 0) : null,
      motorizacao: texto(corpo?.motorizacao, 40),
      sistema_injecao: corpo?.sistema_injecao ?? 'common_rail_cp3',
      km_ultima: km,
      horimetro: corpo?.horimetro != null ? num(corpo.horimetro, 0) : null,
      media_km_mes: 0,
      ultima_visita_em: km != null ? agora() : null,
      chassi: texto(corpo?.chassi, 30),
      renavam: texto(corpo?.renavam, 20),
      cor: texto(corpo?.cor, 30),
      combustivel: corpo?.combustivel ?? 'diesel_s10',
      apelido: texto(corpo?.apelido, 60),
      observacao: texto(corpo?.observacao, 400),
      ativo: 1,
      criado_em: agora(),
    });

    if (km != null) {
      registrarKm(escopo, id, { km, origem: 'manual', ator: usuario.email });
    }
    semearPlano(escopo, id, { kmBase: km, dataBase: km != null ? agora() : null });
    recalcular(escopo, id);

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'veiculo.criar',
      entidade: 'veiculos', entidadeId: id, dados: { placa, cliente: cliente.nome },
    });
    return ok(escopo.uma('select * from veiculos where {ESCOPO} and id = ?', id));
  },

  /**
   * A vida do veiculo numa resposta so.
   *
   * Dados, historico de km, media real, plano projetado e linha do tempo. Sao
   * cinco consultas que respondem a UMA pergunta — o que aconteceu e o que vem
   * com este caminhao — e separa-las obrigaria a tela a costurar cinco
   * chamadas para desenhar uma pagina.
   */
  'GET /api/veiculos/:id': (fed, req, p) => {
    const { escopo } = contexto(fed, req);
    const veiculo = escopo.uma(
      `select v.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.cpf as cliente_cpf
       from veiculos v join clientes c on c.id = v.cliente_id
       where v.{ESCOPO} and v.id = ?`, p.id,
    );
    if (!veiculo) throw new ErroHttp(404, 'nao_encontrado', 'Veículo não encontrado.');

    const leituras = escopo.todas(
      'select * from veiculo_km where {ESCOPO} and veiculo_id = ? order by medido_em desc limit 40', p.id);
    const media = mediaKmMes(leituras);
    const ultima = [...leituras].sort((a, b) => Date.parse(a.medido_em) - Date.parse(b.medido_em)).pop() ?? null;
    const hoje = kmEstimado(veiculo, ultima, media);

    const planos = escopo.todas(
      'select * from planos_manutencao where {ESCOPO} and veiculo_id = ? and ativo = 1 order by previsto_em', p.id,
    ).map((plano) => ({ ...plano, projecao: projetarServico(plano, { kmHoje: hoje, mediaMes: media }) }));

    return ok({
      veiculo,
      uso: {
        mediaKmMes: media,
        kmHoje: hoje,
        leituras: leituras.length,
        // Sem duas leituras nao ha media, e a tela precisa dizer isso em vez de
        // mostrar zero — zero parece um caminhao parado.
        temHistorico: leituras.length >= 2,
      },
      leituras,
      planos,
      linhaDoTempo: linhaDoTempo(escopo, p.id),
      vistorias: escopo.todas(
        'select id, numero, status, km, iniciada_em, aceite_em from vistorias where {ESCOPO} and veiculo_id = ? order by iniciada_em desc limit 10', p.id),
    });
  },

  'POST /api/veiculos/:id/km': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    try {
      const r = registrarKm(escopo, p.id, {
        km: corpo?.km,
        medidoEm: corpo?.medido_em ?? agora(),
        origem: 'manual',
        ator: usuario.email,
      });
      banco.auditar({
        empresaId: empresa.id, ator: usuario.email, acao: 'veiculo.km',
        entidade: 'veiculos', entidadeId: p.id, dados: { km: corpo?.km, media: r.media },
      });
      return ok(r);
    } catch (e) {
      throw new ErroHttp(422, 'km_invalido', e.message);
    }
  },

  /**
   * Abre a vistoria com os itens do nivel ja criados, todos sem estado.
   *
   * Criar os itens agora, e nao conforme se marca, e o que permite perguntar
   * "quanto falta" — e o que garante que a lista nao mude no meio do
   * preenchimento se o catalogo for editado.
   */
  'POST /api/vistorias': (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);

    const veiculo = escopo.uma(
      'select v.*, c.nome cliente_nome from veiculos v join clientes c on c.id = v.cliente_id where v.{ESCOPO} and v.id = ?',
      corpo?.veiculo_id,
    );
    if (!veiculo) throw new ErroHttp(404, 'veiculo_nao_encontrado', 'Informe o veículo da vistoria.');

    const aberta = escopo.uma(
      "select id, numero from vistorias where {ESCOPO} and veiculo_id = ? and status in ('rascunho','aguardando_aceite')",
      veiculo.id,
    );
    if (aberta) {
      throw new ErroHttp(409, 'vistoria_aberta',
        `Este veículo já tem a vistoria ${aberta.numero} em andamento.`, { vistoriaId: aberta.id });
    }

    // O nivel decide QUAIS itens a vistoria tem, e fica gravado: o catalogo
    // pode mudar depois, e a vistoria continua sendo a que foi feita.
    const nivel = NIVEIS[corpo?.nivel] ? corpo.nivel : 'prata';

    const id = novoId();
    const numero = proximoNumero(escopo);
    escopo.inserir('vistorias', {
      id,
      cliente_id: veiculo.cliente_id,
      veiculo_id: veiculo.id,
      ordem_id: corpo?.ordem_id ?? null,
      numero,
      nivel,
      km: corpo?.km != null ? num(corpo.km, 0) : null,
      nivel_combustivel: texto(corpo?.nivel_combustivel, 20),
      status: 'rascunho',
      tecnico: usuario.nome ?? usuario.email,
      observacao: null,
      iniciada_em: agora(),
    });

    for (const item of itensDoChecklist(nivel)) {
      escopo.inserir('vistoria_itens', {
        id: novoId(),
        vistoria_id: id,
        grupo: item.grupo,
        chave: item.chave,
        nome: item.nome,
        estado: null,
        medida: null,
        unidade: item.medida?.unidade ?? null,
        nota: null,
        posicao: item.posicao,
      });
    }

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.abrir',
      entidade: 'vistorias', entidadeId: id,
      dados: { numero, nivel, placa: veiculo.placa, cliente: veiculo.cliente_nome },
    });
    return ok({ id, numero, nivel, veiculo, itens: TAMANHO_POR_NIVEL[nivel] });
  },

  'GET /api/vistorias': (fed, req, _p, _c, url) => {
    const { escopo } = contexto(fed, req);
    const status = url.searchParams.get('status');
    let sql = `select vi.*, c.nome cliente_nome, v.placa, v.marca, v.modelo
               from vistorias vi
               join clientes c on c.id = vi.cliente_id
               join veiculos v on v.id = vi.veiculo_id
               where vi.{ESCOPO}`;
    const params = [];
    if (status) { sql += ' and vi.status = ?'; params.push(status); }
    sql += ' order by vi.iniciada_em desc limit 120';
    return ok(escopo.todas(sql, ...params));
  },

  'GET /api/vistorias/:id': (fed, req, p) => {
    const { escopo } = contexto(fed, req);
    const v = escopo.uma(
      `select vi.*, c.nome cliente_nome, c.telefone cliente_telefone, c.cpf cliente_cpf,
              ve.placa, ve.marca, ve.modelo, ve.ano, ve.cor
       from vistorias vi
       join clientes c on c.id = vi.cliente_id
       join veiculos ve on ve.id = vi.veiculo_id
       where vi.{ESCOPO} and vi.id = ?`, p.id,
    );
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');

    const itens = escopo.todas(
      'select * from vistoria_itens where {ESCOPO} and vistoria_id = ? order by posicao', p.id);
    const midias = escopo.todas(
      'select id, item_id, tipo, bytes, largura, altura, duracao_s, legenda, criado_em from vistoria_midias where {ESCOPO} and vistoria_id = ? order by criado_em',
      p.id);

    const porItem = {};
    for (const m of midias) (porItem[m.item_id] ??= []).push(m);

    return ok({
      vistoria: v,
      itens,
      midias: porItem,
      avarias: escopo.todas(
        'select * from vistoria_avarias where {ESCOPO} and vistoria_id = ? order by criado_em', p.id),
      servicos: escopo.todas(
        'select * from vistoria_servicos where {ESCOPO} and vistoria_id = ? order by ordem', p.id),
      resumo: resumoVistoria(itens),
      pendencias: pendencias(itens, porItem, v.nivel ?? 'ouro'),
      catalogo: catalogoDoNivel(v.nivel ?? 'ouro'),
      niveis: NIVEIS,
    });
  },

  /** Marca um item. E a operacao mais repetida do app — 63 vezes por vistoria. */
  'PATCH /api/vistorias/:id/itens/:chave': (fed, req, p, corpo) => {
    const { escopo, usuario } = contexto(fed, req);
    const v = escopo.uma('select id, status, nivel from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada',
        'Esta vistoria já foi enviada ao cliente e não pode mais ser alterada. '
        + 'Mudar item depois do envio quebraria o aceite — se precisa corrigir, abra outra.');
    }

    const item = escopo.uma(
      'select * from vistoria_itens where {ESCOPO} and vistoria_id = ? and chave = ?', p.id, p.chave);
    if (!item) throw new ErroHttp(404, 'item_nao_encontrado', 'Item fora do check-list.');

    const dados = {};
    if (corpo?.estado !== undefined) {
      if (corpo.estado !== null && !ESTADOS[corpo.estado]) {
        throw new ErroHttp(422, 'estado_invalido', 'Estado fora do semáforo.');
      }
      dados.estado = corpo.estado;
    }
    if (corpo?.medida !== undefined) {
      dados.medida = corpo.medida === null || corpo.medida === '' ? null : Number(corpo.medida);
      if (dados.medida !== null && !Number.isFinite(dados.medida)) {
        throw new ErroHttp(422, 'medida_invalida', 'A medida precisa ser um número.');
      }
    }
    if (corpo?.nota !== undefined) dados.nota = texto(corpo.nota, 500);

    escopo.atualizar('vistoria_itens', item.id, dados);
    const atual = escopo.uma('select * from vistoria_itens where {ESCOPO} and id = ?', item.id);

    // O km do hodometro alimenta a vida do veiculo, e nao so o papel.
    if (p.chave === 'hodometro' && dados.medida) {
      const vi = escopo.uma('select veiculo_id from vistorias where {ESCOPO} and id = ?', p.id);
      try {
        registrarKm(escopo, vi.veiculo_id, {
          km: dados.medida, origem: 'vistoria', origemId: p.id, ator: usuario.email,
        });
      } catch { /* leitura recusada nao derruba a vistoria; o item fica marcado */ }
    }

    /*
     * A resposta traz o resumo E as pendencias.
     *
     * Antes a tela remarcava o item e recarregava a vistoria inteira para saber
     * o que ainda faltava: duas viagens por toque, e a segunda pesada — 86
     * itens com a lista de midias. Numa vistoria completa isso era mais de
     * cento e setenta chamadas no 4G do celular do tecnico.
     */
    const todos = escopo.todas('select * from vistoria_itens where {ESCOPO} and vistoria_id = ?', p.id);
    const porItem2 = {};
    for (const m of escopo.todas(
      'select id, item_id from vistoria_midias where {ESCOPO} and vistoria_id = ?', p.id)) {
      (porItem2[m.item_id] ??= []).push(m);
    }
    return ok({
      item: atual,
      resumo: resumoVistoria(todos),
      pendencias: pendencias(todos, porItem2, v.nivel ?? 'ouro'),
    });
  },

  /**
   * Anexa foto ou video a um item.
   *
   * O corpo e binario cru, e nao base64 dentro de JSON: base64 infla 33%, e um
   * video de 30 MB viraria 40 MB de string para o `JSON.parse` engolir de uma
   * vez num processo de thread unica.
   *
   * O arquivo vai para o disco; no banco fica so o ponteiro. Blob em SQLite
   * levaria o banco de 370 KB a gigabytes — e com ele o backup, que copia o
   * banco inteiro toda madrugada.
   */
  'POST /api/vistorias/:id/midia': async (fed, req, p, _corpo, url) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const v = escopo.uma('select id, status, veiculo_id from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada', 'Vistoria já enviada: não aceita mais mídia.');
    }

    const bytes = req.corpoBruto;
    if (!bytes?.length) throw new ErroHttp(400, 'sem_arquivo', 'Nenhum arquivo recebido.');

    const tipo = url.searchParams.get('tipo') === 'video' ? 'video' : 'foto';
    const chave = url.searchParams.get('item');
    const item = chave
      ? escopo.uma('select id from vistoria_itens where {ESCOPO} and vistoria_id = ? and chave = ?', p.id, chave)
      : null;
    if (chave && !item) throw new ErroHttp(404, 'item_nao_encontrado', 'Item fora do check-list.');

    const ext = tipo === 'video' ? 'mp4' : 'jpg';
    const id = novoId();
    const relativo = join(empresa.codigo, p.id, `${id}.${ext}`);
    const destino = join(diretorioDeMidia(fed), relativo);
    mkdirSync(dirname(destino), { recursive: true });
    await new Promise((resolve, reject) => {
      const fluxo = createWriteStream(destino);
      fluxo.on('error', reject);
      fluxo.on('finish', resolve);
      fluxo.end(bytes);
    });

    escopo.inserir('vistoria_midias', {
      id,
      vistoria_id: p.id,
      item_id: item?.id ?? null,
      tipo,
      arquivo: relativo.replaceAll('\\', '/'),
      bytes: bytes.length,
      largura: url.searchParams.get('l') ? Number(url.searchParams.get('l')) : null,
      altura: url.searchParams.get('a') ? Number(url.searchParams.get('a')) : null,
      duracao_s: url.searchParams.get('d') ? Number(url.searchParams.get('d')) : null,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      legenda: texto(url.searchParams.get('legenda'), 200),
      criado_por: usuario.email,
      criado_em: agora(),
    });

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.midia',
      entidade: 'vistoria_midias', entidadeId: id,
      dados: { vistoria: p.id, tipo, item: chave, bytes: bytes.length },
    });
    return ok({ id, tipo, bytes: bytes.length, item: chave ?? null });
  },

  /** Serve o arquivo. Passa por sessao: vistoria e documento do cliente. */
  'GET /api/midia/:id': async (fed, req, p) => {
    const { escopo } = contexto(fed, req);
    const m = escopo.uma('select * from vistoria_midias where {ESCOPO} and id = ?', p.id);
    if (!m) throw new ErroHttp(404, 'nao_encontrado', 'Mídia não encontrada.');
    try {
      const conteudo = await readFile(join(diretorioDeMidia(fed), m.arquivo));
      return {
        __binario: conteudo,
        __tipo: m.tipo === 'video' ? 'video/mp4' : 'image/jpeg',
      };
    } catch {
      throw new ErroHttp(410, 'arquivo_sumiu',
        'O registro existe e o arquivo não está mais no disco.');
    }
  },

  'DELETE /api/vistorias/:id/midia/:midiaId': async (fed, req, p) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const v = escopo.uma('select status from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada', 'Vistoria enviada: a mídia dela é prova e não sai mais.');
    }
    const m = escopo.uma('select * from vistoria_midias where {ESCOPO} and id = ?', p.midiaId);
    if (!m) throw new ErroHttp(404, 'nao_encontrado', 'Mídia não encontrada.');

    escopo.remover('vistoria_midias', p.midiaId);
    try { await unlink(join(diretorioDeMidia(fed), m.arquivo)); } catch { /* ja sumiu */ }
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.midia.apagar',
      entidade: 'vistoria_midias', entidadeId: p.midiaId, dados: { vistoria: p.id },
    });
    return ok({ apagou: true });
  },

  /**
   * Fecha o preenchimento e envia ao cliente.
   *
   * Recusa se faltar item ou foto obrigatoria, e diz QUAIS: "nao pode enviar"
   * sem a lista obriga a caçar o pendente numa tela de sessenta e tres.
   */
  'POST /api/vistorias/:id/concluir': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const v = escopo.uma('select * from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'ja_concluida', 'Esta vistoria já foi enviada.');
    }

    const itens = escopo.todas('select * from vistoria_itens where {ESCOPO} and vistoria_id = ?', p.id);
    const midias = escopo.todas('select * from vistoria_midias where {ESCOPO} and vistoria_id = ?', p.id);
    const porItem = {};
    for (const m of midias) (porItem[m.item_id] ??= []).push(m);

    const faltas = pendencias(itens, porItem, v.nivel ?? 'ouro');
    if (faltas.length) {
      throw new ErroHttp(422, 'vistoria_incompleta',
        `Faltam ${faltas.length} item(ns) para poder enviar.`, { pendencias: faltas });
    }

    const dados = {
      status: 'aguardando_aceite',
      concluida_em: agora(),
      observacao: texto(corpo?.observacao, 1000),
      conteudo_hash: hashConteudo(v, itens, midias, extrasDaVistoria(escopo, p.id)),
    };
    escopo.atualizar('vistorias', p.id, dados);

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.concluir',
      entidade: 'vistorias', entidadeId: p.id,
      dados: { numero: v.numero, hash: dados.conteudo_hash, resumo: resumoVistoria(itens) },
    });
    return ok({ ...v, ...dados, resumo: resumoVistoria(itens) });
  },

  /**
   * Aceite do cliente. E o que destrava a ordem de servico.
   *
   * O hash e conferido de novo AQUI: se algum item mudou entre o envio e o
   * aceite, o cliente estaria assinando outra coisa. Nesse caso a vistoria
   * volta para rascunho em vez de gravar um aceite que nao corresponde.
   */
  'POST /api/vistorias/:id/aceite': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const v = escopo.uma('select * from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status === 'aceita') return ok({ ...v, jaEstava: true });
    if (v.status !== 'aguardando_aceite') {
      throw new ErroHttp(409, 'sem_envio', 'A vistoria precisa estar concluída e enviada antes do aceite.');
    }

    const itens = escopo.todas('select * from vistoria_itens where {ESCOPO} and vistoria_id = ?', p.id);
    const midias = escopo.todas('select * from vistoria_midias where {ESCOPO} and vistoria_id = ?', p.id);
    const agoraHash = hashConteudo(v, itens, midias, extrasDaVistoria(escopo, p.id));
    if (agoraHash !== v.conteudo_hash) {
      escopo.atualizar('vistorias', p.id, { status: 'rascunho', concluida_em: null });
      throw new ErroHttp(409, 'conteudo_mudou',
        'O conteúdo da vistoria mudou depois do envio. Ela voltou para preenchimento — '
        + 'envie de novo para o cliente aceitar o que está valendo agora.');
    }

    if (corpo?.recusa) {
      const motivo = texto(corpo?.motivo, 500);
      if (!motivo) throw new ErroHttp(422, 'motivo_obrigatorio', 'Recusa exige o motivo.');
      escopo.atualizar('vistorias', p.id, { status: 'recusada', recusa_motivo: motivo, aceite_em: agora() });
      banco.auditar({
        empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.recusar',
        entidade: 'vistorias', entidadeId: p.id, dados: { numero: v.numero, motivo },
      });
      return ok({ status: 'recusada', motivo });
    }

    const nome = texto(corpo?.nome, 120);
    if (!nome) throw new ErroHttp(422, 'nome_obrigatorio', 'Informe quem está aceitando.');

    const dados = {
      status: 'aceita',
      aceite_em: agora(),
      aceite_nome: nome,
      aceite_cpf: String(corpo?.cpf ?? '').replace(/\D/g, '') || null,
      aceite_meio: corpo?.meio ?? 'assinatura_tela',
      aceite_assinatura: typeof corpo?.assinatura === 'string' ? corpo.assinatura.slice(0, 200000) : null,
    };
    escopo.atualizar('vistorias', p.id, dados);

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.aceite',
      entidade: 'vistorias', entidadeId: p.id,
      dados: { numero: v.numero, nome, meio: dados.aceite_meio, hash: v.conteudo_hash },
    });
    return ok({ ...v, ...dados });
  },

  /**
   * Inicia a ordem de servico — e e aqui que a vistoria vira regra.
   *
   * Sem esta trava, a vistoria seria papel que se preenche depois, para
   * constar. Com ela, o servico so comeca com o dono de acordo sobre o estado
   * em que o veiculo entrou.
   */
  'POST /api/ordens/:id/iniciar': (fed, req, p) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const os = escopo.uma('select * from ordens_servico where {ESCOPO} and id = ?', p.id);
    if (!os) throw new ErroHttp(404, 'nao_encontrado', 'Ordem de serviço não encontrada.');
    if (os.status !== 'aberta') {
      throw new ErroHttp(409, 'ja_iniciada', `Esta OS está ${os.status}.`);
    }

    const vistoria = os.vistoria_id
      ? escopo.uma('select * from vistorias where {ESCOPO} and id = ?', os.vistoria_id)
      : escopo.uma(
        "select * from vistorias where {ESCOPO} and veiculo_id = ? and status = 'aceita' order by aceite_em desc limit 1",
        os.veiculo_id);

    const porta = podeIniciarOS(vistoria);
    if (!porta.pode) {
      throw new ErroHttp(409, 'vistoria_pendente', porta.texto,
        { motivo: porta.motivo, vistoriaId: vistoria?.id ?? null, veiculoId: os.veiculo_id });
    }

    escopo.atualizar('ordens_servico', p.id, { status: 'em_bancada', vistoria_id: vistoria.id });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'os.iniciar',
      entidade: 'ordens_servico', entidadeId: p.id,
      dados: { numero: os.numero, vistoria: vistoria.numero },
    });
    return ok({ ...os, status: 'em_bancada', vistoria_id: vistoria.id });
  },

  /**
   * Marca uma avaria na carroceria.
   *
   * O check-list responde "está funcionando?"; o diagrama responde "COMO
   * estava?" — e é essa a pergunta da devolução, quando o dono aponta um risco
   * e ninguém sabe se já estava lá.
   *
   * A coordenada chega em FRAÇÃO da vista (0 a 1), e não em pixel: o desenho
   * muda de tamanho entre o celular e o computador, e pixel gravado numa tela
   * de 375 apareceria no lugar errado numa de 1440.
   */
  'POST /api/vistorias/:id/avarias': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const v = escopo.uma('select id, status, numero from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada',
        'Esta vistoria já foi enviada: o desenho da carroceria é prova e não muda mais.');
    }

    const x = Number(corpo?.x);
    const y = Number(corpo?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new ErroHttp(422, 'coordenada_invalida', 'A marca precisa cair dentro do desenho.');
    }
    if (!VISTAS_CARROCERIA.includes(corpo?.vista)) {
      throw new ErroHttp(422, 'vista_invalida', 'Vista fora do desenho.');
    }
    if (!TIPOS_AVARIA[corpo?.tipo]) {
      throw new ErroHttp(422, 'tipo_invalido', 'Tipo de avaria desconhecido.');
    }

    const id = novoId();
    escopo.inserir('vistoria_avarias', {
      id,
      vistoria_id: p.id,
      vista: corpo.vista,
      x,
      y,
      tipo: corpo.tipo,
      nota: texto(corpo?.nota, 200),
      criado_por: usuario.email,
      criado_em: agora(),
    });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.avaria',
      entidade: 'vistoria_avarias', entidadeId: id,
      dados: { numero: v.numero, vista: corpo.vista, tipo: corpo.tipo },
    });
    return ok(escopo.uma('select * from vistoria_avarias where {ESCOPO} and id = ?', id));
  },

  'DELETE /api/vistorias/:id/avarias/:avariaId': (fed, req, p) => {
    const { escopo } = contexto(fed, req);
    const v = escopo.uma('select status from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada', 'Esta vistoria já foi enviada.');
    }
    return ok({ apagou: escopo.remover('vistoria_avarias', p.avariaId) > 0 });
  },

  /**
   * Serviços — o que o CLIENTE pediu, e o que a oficina encontrou.
   *
   * As duas listas ficam separadas de propósito, pela `origem`. É a separação
   * que permite a conversa honesta na entrega: "você pediu isto, e nós
   * encontramos aquilo". Misturadas, todo achado parece venda empurrada.
   */
  'POST /api/vistorias/:id/servicos': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const v = escopo.uma('select id, status, numero from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada', 'Esta vistoria já foi enviada.');
    }

    const descricao = texto(corpo?.descricao, 300);
    if (!descricao) throw new ErroHttp(422, 'descricao_obrigatoria', 'Descreva o serviço pedido.');

    const ultimo = escopo.uma(
      'select max(ordem) as n from vistoria_servicos where {ESCOPO} and vistoria_id = ?', p.id);
    const id = novoId();
    escopo.inserir('vistoria_servicos', {
      id,
      vistoria_id: p.id,
      ordem: (ultimo?.n ?? 0) + 1,
      descricao,
      origem: corpo?.origem === 'vistoria' ? 'vistoria' : 'cliente',
      item_chave: texto(corpo?.item_chave, 60),
      estado: 'pendente',
      tempo_min: corpo?.tempo_min == null ? null : num(corpo.tempo_min, 0),
      valor_centavos: corpo?.valor_centavos == null ? null : num(corpo.valor_centavos, 0),
      aprovado: null,
      criado_em: agora(),
    });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.servico',
      entidade: 'vistoria_servicos', entidadeId: id,
      dados: { numero: v.numero, descricao, origem: corpo?.origem ?? 'cliente' },
    });
    return ok(escopo.uma('select * from vistoria_servicos where {ESCOPO} and id = ?', id));
  },

  'PATCH /api/vistorias/:id/servicos/:servicoId': (fed, req, p, corpo) => {
    const { escopo } = contexto(fed, req);
    const v = escopo.uma('select status from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    const sv = escopo.uma('select * from vistoria_servicos where {ESCOPO} and id = ?', p.servicoId);
    if (!sv) throw new ErroHttp(404, 'nao_encontrado', 'Serviço não encontrado.');

    /*
     * Descrição, tempo e valor são o que o cliente aceitou: travam no envio.
     * O estado (feito ou não) é execução, e continua andando depois do aceite —
     * é assim que a lista da recepção vira a lista da entrega.
     */
    const dados = {};
    if (corpo?.estado !== undefined) {
      if (corpo.estado !== null && !['pendente', 'ok', 'nok'].includes(corpo.estado)) {
        throw new ErroHttp(422, 'estado_invalido', 'Use pendente, ok ou nok.');
      }
      dados.estado = corpo.estado;
    }
    if (corpo?.aprovado !== undefined) dados.aprovado = corpo.aprovado ? 1 : 0;

    const mudaConteudo = ['descricao', 'tempo_min', 'valor_centavos']
      .some((c) => corpo?.[c] !== undefined);
    if (mudaConteudo) {
      if (v.status !== 'rascunho') {
        throw new ErroHttp(409, 'vistoria_fechada',
          'Esta vistoria já foi enviada: descrição, tempo e valor não mudam mais.');
      }
      if (corpo?.descricao !== undefined) {
        const d = texto(corpo.descricao, 300);
        if (!d) throw new ErroHttp(422, 'descricao_obrigatoria', 'Descreva o serviço.');
        dados.descricao = d;
      }
      if (corpo?.tempo_min !== undefined) {
        dados.tempo_min = corpo.tempo_min === null ? null : num(corpo.tempo_min, 0);
      }
      if (corpo?.valor_centavos !== undefined) {
        dados.valor_centavos = corpo.valor_centavos === null ? null : num(corpo.valor_centavos, 0);
      }
    }

    if (!Object.keys(dados).length) return ok(sv);
    escopo.atualizar('vistoria_servicos', p.servicoId, dados);
    return ok(escopo.uma('select * from vistoria_servicos where {ESCOPO} and id = ?', p.servicoId));
  },

  'DELETE /api/vistorias/:id/servicos/:servicoId': (fed, req, p) => {
    const { escopo } = contexto(fed, req);
    const v = escopo.uma('select status from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada', 'Esta vistoria já foi enviada.');
    }
    return ok({ apagou: escopo.remover('vistoria_servicos', p.servicoId) > 0 });
  },

  /**
   * O que foi combinado na recepção: entrega, pagamento, próximo serviço.
   *
   * São promessas feitas ao cliente na entrada, e por isso ficam na vistoria
   * que ele aceita — e não num campo solto de observação.
   */
  'PATCH /api/vistorias/:id': (fed, req, p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const v = escopo.uma('select * from vistorias where {ESCOPO} and id = ?', p.id);
    if (!v) throw new ErroHttp(404, 'nao_encontrado', 'Vistoria não encontrada.');
    if (v.status !== 'rascunho') {
      throw new ErroHttp(409, 'vistoria_fechada', 'Esta vistoria já foi enviada.');
    }

    const dados = {};
    if (corpo?.tecnico !== undefined) dados.tecnico = texto(corpo.tecnico, 120);
    if (corpo?.observacao !== undefined) dados.observacao = texto(corpo.observacao, 1000);
    if (corpo?.proximo_servico_km !== undefined) {
      dados.proximo_servico_km = corpo.proximo_servico_km === null || corpo.proximo_servico_km === ''
        ? null : num(corpo.proximo_servico_km, 0);
    }
    if (corpo?.preferencia_pagamento !== undefined) {
      const forma = texto(corpo.preferencia_pagamento, 60);
      if (forma && !PAGAMENTOS.includes(forma)) {
        throw new ErroHttp(422, 'pagamento_invalido', 'Forma de pagamento desconhecida.');
      }
      dados.preferencia_pagamento = forma;
    }
    if (corpo?.entrega_prevista !== undefined) {
      dados.entrega_prevista = texto(corpo.entrega_prevista, 40);
    }

    if (!Object.keys(dados).length) return ok(v);
    escopo.atualizar('vistorias', p.id, dados);
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'vistoria.recepcao',
      entidade: 'vistorias', entidadeId: p.id, dados: { numero: v.numero, ...dados },
    });
    return ok(escopo.uma('select * from vistorias where {ESCOPO} and id = ?', p.id));
  },

  /* ══ ERP DO GRUPO ══════════════════════════════════════════════════════
   *
   * Tudo aqui roda contra a CENTRAL, que para o ERP deixa de ser projeção de
   * leitura e passa a ser fonte de verdade do grupo. Ver `erp-schema.mjs`
   * para a decisão de arquitetura e as seis invariantes.
   */

  /** O que ESTE usuário pode ver — a tela desenha o menu a partir daqui. */
  'GET /api/erp/acesso': (fed, req) => {
    const { sql, usuario } = contextoErp(fed, req);
    return ok({
      email: usuario.email,
      papel: usuario.papel,
      modulos: MODULOS_ERP,
      meus: permissoesDe(sql, usuario.email),
    });
  },

  'GET /api/erp/acesso/todos': (fed, req) => {
    const { sql } = contextoErp(fed, req, { modulo: 'admin', nivel: 'administrar' });
    return ok(mapaDeAcesso(sql));
  },

  'PUT /api/erp/acesso/:email/:modulo': (fed, req, p, corpo) => {
    const { sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'admin', nivel: 'administrar' });
    const r = comoHttp(() => conceder(sql, {
      email: p.email, modulo: p.modulo, nivel: corpo?.nivel ?? 'ler', por: usuario.email,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.conceder',
      entidade: 'erp_permissoes', entidadeId: `${p.email}:${p.modulo}`, dados: r,
    });
    return ok(r);
  },

  'DELETE /api/erp/acesso/:email/:modulo': (fed, req, p) => {
    const { sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'admin', nivel: 'administrar' });
    const r = comoHttp(() => revogar(sql, { email: p.email, modulo: p.modulo }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.revogar',
      entidade: 'erp_permissoes', entidadeId: `${p.email}:${p.modulo}`, dados: r,
    });
    return ok(r);
  },

  /* ── Plano de contas ─────────────────────────────────────────────────── */

  'GET /api/erp/contas': (fed, req) => {
    const { sql } = contextoErp(fed, req, { modulo: 'razao' });
    return ok({
      contas: sql.prepare('select * from erp_contas order by codigo').all(),
      centros: sql.prepare('select * from erp_centros_custo where ativo = 1 order by codigo').all(),
    });
  },

  'POST /api/erp/contas/semear': (fed, req) => {
    const { sql, usuario } = contextoErp(fed, req, { modulo: 'razao', nivel: 'administrar' });
    return ok(comoHttp(() => semearPlanoContas(sql, { ator: usuario.email })));
  },

  /* ── Razão ───────────────────────────────────────────────────────────── */

  'POST /api/erp/lancamentos': (fed, req, _p, corpo) => {
    const { sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'razao', nivel: 'escrever' });
    const r = comoHttp(() => lancar(sql, {
      instancia: corpo?.instancia,
      data: corpo?.data,
      historico: corpo?.historico,
      origem: 'manual',
      ator: usuario.email,
      partidas: (corpo?.partidas ?? []).map((x) => ({
        conta: x.conta,
        centro_custo: x.centro_custo ?? null,
        tipo: x.tipo,
        valor_centavos: valorDoCorpo(x, 'valor'),
      })),
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.lancar',
      entidade: 'erp_lancamentos', entidadeId: r.id,
      dados: { instancia: corpo?.instancia, total: r.total, competencia: r.competencia },
    });
    return ok(r);
  },

  'GET /api/erp/lancamentos': (fed, req, _p, _c, url) => {
    const { sql } = contextoErp(fed, req, { modulo: 'razao' });
    const cond = ['1=1'];
    const params = [];
    for (const [q, col] of [['competencia', 'l.competencia'], ['instancia', 'l.instancia'], ['origem', 'l.origem']]) {
      const v = url?.searchParams.get(q);
      if (v) { cond.push(`${col} = ?`); params.push(v); }
    }
    const linhas = sql.prepare(
      `select l.*, (select sum(valor_centavos) from erp_partidas p
                     where p.lancamento_id = l.id and p.tipo = 'D') as total
         from erp_lancamentos l
        where ${cond.join(' and ')}
        order by l.data desc, l.criado_em desc limit 200`,
    ).all(...params);
    return ok(linhas);
  },

  'GET /api/erp/lancamentos/:id': (fed, req, p) => {
    const { sql } = contextoErp(fed, req, { modulo: 'razao' });
    const l = sql.prepare('select * from erp_lancamentos where id = ?').get(p.id);
    if (!l) throw new ErroHttp(404, 'nao_encontrado', 'Lançamento não encontrado.');
    return ok({
      lancamento: l,
      partidas: sql.prepare(
        `select p.*, c.nome as conta_nome from erp_partidas p
           join erp_contas c on c.codigo = p.conta
          where p.lancamento_id = ? order by p.ordem`).all(p.id),
    });
  },

  'POST /api/erp/lancamentos/:id/estornar': (fed, req, p, corpo) => {
    const { sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'razao', nivel: 'escrever' });
    // O estorno mora no razão e não aqui: "não se edita, estorna-se" é regra
    // contábil, e uma cópia dela na rota seria a segunda versão da regra.
    const r = comoHttp(() => estornar(sql, {
      lancamentoId: p.id, data: corpo?.data, motivo: corpo?.motivo, ator: usuario.email,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.estornar',
      entidade: 'erp_lancamentos', entidadeId: p.id, dados: { estornoId: r.id, motivo: corpo?.motivo },
    });
    return ok(r);
  },

  /* ── Balancete, períodos e a prova de que o livro fecha ──────────────── */

  'GET /api/erp/balancete': (fed, req, _p, _c, url) => {
    const { sql } = contextoErp(fed, req, { modulo: 'razao' });
    const b = balancete(sql, {
      competencia: url?.searchParams.get('competencia') ?? null,
      ate: url?.searchParams.get('ate') ?? null,
      instancia: url?.searchParams.get('instancia') ?? null,
      centroCusto: url?.searchParams.get('centro') ?? null,
    });
    return ok({ ...b, legivel: { debito: formatarDinheiro(b.debito), credito: formatarDinheiro(b.credito), resultado: formatarDinheiro(b.resultado) } });
  },

  'GET /api/erp/periodos': (fed, req) => {
    const { sql } = contextoErp(fed, req, { modulo: 'razao' });
    return ok(sql.prepare('select * from erp_periodos order by competencia desc').all());
  },

  'POST /api/erp/periodos/:competencia/fechar': (fed, req, p) => {
    const { sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'razao', nivel: 'administrar' });
    const r = comoHttp(() => fecharPeriodo(sql, { competencia: p.competencia, ator: usuario.email }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.fechar_periodo',
      entidade: 'erp_periodos', entidadeId: p.competencia,
      dados: { resultado: r.resultado, receita: r.receita, despesa: r.despesa },
    });
    return ok(r);
  },

  'POST /api/erp/periodos/:competencia/reabrir': (fed, req, p, corpo) => {
    const { sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'razao', nivel: 'administrar' });
    const r = comoHttp(() => reabrirPeriodo(sql, {
      competencia: p.competencia, ator: usuario.email, motivo: corpo?.motivo,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.reabrir_periodo',
      entidade: 'erp_periodos', entidadeId: p.competencia, dados: { motivo: corpo?.motivo },
    });
    return ok(r);
  },

  /**
   * A conferência do livro.
   *
   * É a rota que se olha primeiro quando um número parece estranho. Se
   * `saudavel` vier falso, nenhum outro número do ERP vale — e é melhor a tela
   * dizer isso do que desenhar um painel bonito sobre um livro quebrado.
   */
  'GET /api/erp/conferir': (fed, req) => {
    const { sql } = contextoErp(fed, req, { modulo: 'razao' });
    const c = conferir(sql);
    const b = balancete(sql);
    return ok({ ...c, balancete: { confere: b.confere, diferenca: b.diferenca } });
  },

  /* ── Contas a pagar e a receber ──────────────────────────────────────── */

  'GET /api/erp/titulos': (fed, req, _p, _c, url) => {
    const natureza = url?.searchParams.get('natureza');
    const modulo = natureza === 'receber' ? 'contas_receber' : 'contas_pagar';
    const { sql } = contextoErp(fed, req, { modulo });
    return ok(carteira(sql, {
      natureza,
      instancia: url?.searchParams.get('instancia') ?? null,
      status: url?.searchParams.get('status') ?? null,
      ate: url?.searchParams.get('ate') ?? null,
    }));
  },

  'POST /api/erp/titulos': (fed, req, _p, corpo) => {
    const modulo = corpo?.natureza === 'receber' ? 'contas_receber' : 'contas_pagar';
    const { central, usuario, banco, empresa } = contextoErp(fed, req, { modulo, nivel: 'escrever' });
    const r = comoHttp(() => abrirTitulo(central, {
      instancia: corpo?.instancia,
      natureza: corpo?.natureza,
      parceiroId: corpo?.parceiro_id ?? null,
      numero: texto(corpo?.numero, 40),
      descricao: corpo?.descricao,
      emissao: corpo?.emissao,
      vencimento: corpo?.vencimento,
      valor: valorDoCorpo(corpo),
      conta: corpo?.conta,
      centroCusto: corpo?.centro_custo ?? null,
      ator: usuario.email,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.titulo_abrir',
      entidade: 'erp_titulos', entidadeId: r.id,
      dados: { natureza: corpo?.natureza, instancia: corpo?.instancia, valor: r.saldo },
    });
    return ok(r);
  },

  'POST /api/erp/titulos/:id/baixar': (fed, req, p, corpo) => {
    const { central, sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'contas_pagar', nivel: 'escrever' });
    const t = sql.prepare('select natureza from erp_titulos where id = ?').get(p.id);
    if (!t) throw new ErroHttp(404, 'nao_encontrado', 'Título não encontrado.');
    // A permissão segue a NATUREZA do título, e não a rota: quem só pode
    // receber não pode pagar, ainda que o caminho da URL seja o mesmo.
    if (t.natureza === 'receber') {
      contextoErp(fed, req, { modulo: 'contas_receber', nivel: 'escrever' });
    }
    const r = comoHttp(() => baixarTitulo(central, {
      tituloId: p.id,
      data: corpo?.data ?? agora().slice(0, 10),
      valor: valorDoCorpo(corpo),
      meio: corpo?.meio ?? 'pix',
      contaCaixa: corpo?.conta_caixa ?? null,
      ator: usuario.email,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.titulo_baixar',
      entidade: 'erp_titulos', entidadeId: p.id,
      dados: { valor: corpo?.valor_centavos ?? corpo?.valor, saldo: r.saldo, status: r.status },
    });
    return ok(r);
  },

  'POST /api/erp/titulos/:id/cancelar': (fed, req, p, corpo) => {
    const { central, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'contas_pagar', nivel: 'administrar' });
    const r = comoHttp(() => cancelarTitulo(central, {
      tituloId: p.id, motivo: corpo?.motivo, ator: usuario.email,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.titulo_cancelar',
      entidade: 'erp_titulos', entidadeId: p.id, dados: { motivo: corpo?.motivo, estornoId: r.estornoId },
    });
    return ok(r);
  },

  /** A posição do grupo: quanto se deve, quanto se tem a receber, e o vencido. */
  'GET /api/erp/posicao': (fed, req) => {
    const { sql } = contextoErp(fed, req, { modulo: 'financeiro' });
    return ok(posicao(sql));
  },

  /* ── Rateio entre empresas ───────────────────────────────────────────── */

  'POST /api/erp/rateio': (fed, req, _p, corpo) => {
    const { sql, usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'razao', nivel: 'escrever' });
    const r = comoHttp(() => ratearEntreEmpresas(sql, {
      data: corpo?.data,
      historico: corpo?.historico,
      contaDespesa: corpo?.conta_despesa,
      contaContrapartida: corpo?.conta_contrapartida,
      total: valorDoCorpo({ valor_centavos: corpo?.total_centavos, total: corpo?.total }, 'total'),
      pesos: corpo?.pesos ?? {},
      ator: usuario.email,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.rateio',
      entidade: 'erp_lancamentos', entidadeId: r.lancamentos.map((l) => l.id).join(','),
      dados: { total: r.total, partes: r.partes, pesos: corpo?.pesos },
    });
    return ok(r);
  },

  /* ── Fatos das instâncias ────────────────────────────────────────────── */

  /**
   * Colhe as instâncias e contabiliza o que ainda não foi.
   *
   * É o que faz o ERP conhecer o que aconteceu na operação, e não apenas o que
   * alguém digitou nele. Idempotente: rodar duas vezes não duplica receita —
   * a chave é a origem do fato, e não o instante da leitura.
   */
  'POST /api/erp/sincronizar': (fed, req, _p, corpo) => {
    const { usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'razao', nivel: 'escrever' });
    const r = comoHttp(() => sincronizarFatos(fed, {
      ator: usuario.email,
      codigos: Array.isArray(corpo?.instancias) && corpo.instancias.length ? corpo.instancias : null,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.sincronizar',
      entidade: 'erp_fatos', entidadeId: null,
      dados: {
        novos: r.colheita.novos, postados: r.postagem.postados,
        divergentes: r.colheita.divergentes, completo: r.completo,
      },
    });
    return ok(r);
  },

  /**
   * A fila que alguém precisa olhar: o que não virou lançamento, e o que
   * mudou na origem depois de já ter virado.
   */
  'GET /api/erp/fatos': (fed, req) => {
    const { sql } = contextoErp(fed, req, { modulo: 'razao' });
    return ok({ ...pendenciasDeFato(sql), coletores: COLETORES });
  },

  /**
   * Aceita a correção da origem: estorna o lançamento antigo, relê o valor e
   * devolve o fato à fila. É a única porta para resolver divergência, e ela
   * passa pelo estorno — nada aqui altera lançamento já feito.
   */
  'POST /api/erp/fatos/:id/reconhecer': (fed, req, p, corpo) => {
    const { usuario, banco, empresa } = contextoErp(fed, req, { modulo: 'razao', nivel: 'administrar' });
    const r = comoHttp(() => reconhecerDivergencia(fed, {
      fatoId: p.id, ator: usuario.email, data: corpo?.data ?? null,
    }));
    banco.auditar({
      empresaId: empresa?.id ?? null, ator: usuario.email, acao: 'erp.reconhecer_divergencia',
      entidade: 'erp_fatos', entidadeId: p.id, dados: { estornoId: r.estornoId },
    });
    return ok(r);
  },

  /**
   * O painel do grupo: uma resposta com o que a direção pergunta.
   *
   * Resultado por empresa, posição de contas a pagar e receber, a fila de
   * fatos e a saúde do livro. Numa chamada só, e não em seis — a tela abre uma
   * vez, e seis chamadas seriais num processo síncrono é o que trava o
   * atendimento enquanto o dono olha o painel.
   *
   * `completo` e `saudavel` vêm no topo de propósito: se o livro não fecha ou
   * faltou empresa, nenhum outro número desta resposta vale.
   */
  'GET /api/erp/painel': (fed, req, _p, _c, url) => {
    const { sql } = contextoErp(fed, req, { modulo: 'bi' });
    const competencia = url?.searchParams.get('competencia') ?? agora().slice(0, 7);

    const geral = balancete(sql, { competencia });
    const saude = conferir(sql);
    const fila = pendenciasDeFato(sql);
    const carteiras = posicao(sql);

    const empresas = {};
    for (const cod of [...fed.codigosDeEmpresa(), 'GRUPO']) {
      const b = balancete(sql, { competencia, instancia: cod });
      if (!b.contas.length) continue;
      empresas[cod] = {
        receita: b.receita,
        despesa: b.despesa,
        resultado: b.resultado,
        confere: b.confere,
        pagar: carteiras.porEmpresa[cod]?.pagar ?? 0,
        receber: carteiras.porEmpresa[cod]?.receber ?? 0,
        vencido: (carteiras.porEmpresa[cod]?.pagarVencido ?? 0)
          + (carteiras.porEmpresa[cod]?.receberVencido ?? 0),
      };
    }

    const meses = sql.prepare(
      `select l.competencia,
              sum(case when c.tipo = 'receita' and p.tipo = 'C' then p.valor_centavos
                       when c.tipo = 'receita' and p.tipo = 'D' then -p.valor_centavos
                       else 0 end) as receita,
              sum(case when c.tipo = 'despesa' and p.tipo = 'D' then p.valor_centavos
                       when c.tipo = 'despesa' and p.tipo = 'C' then -p.valor_centavos
                       else 0 end) as despesa
         from erp_partidas p
         join erp_lancamentos l on l.id = p.lancamento_id
         join erp_contas c on c.codigo = p.conta
        group by l.competencia order by l.competencia desc limit 13`,
    ).all().reverse().map((m) => ({ ...m, resultado: m.receita - m.despesa }));

    return ok({
      competencia,
      saudavel: saude.saudavel && geral.confere,
      confere: geral.confere,
      diferenca: geral.diferenca,
      grupo: {
        receita: geral.receita,
        despesa: geral.despesa,
        resultado: geral.resultado,
        pagar: carteiras.grupo.pagar,
        receber: carteiras.grupo.receber,
        pagarVencido: carteiras.grupo.pagarVencido,
        receberVencido: carteiras.grupo.receberVencido,
      },
      empresas,
      meses,
      fatos: {
        pendentes: fila.naoContabilizados,
        divergentes: fila.divergentes.length,
        ultimaLeitura: fila.ultimaLeitura,
      },
      alertas: [
        ...(saude.saudavel ? [] : [{ nivel: 'critico', texto: 'O razão tem inconsistência — confira antes de usar qualquer número.' }]),
        ...(geral.confere ? [] : [{ nivel: 'critico', texto: `O balancete não fecha: diferença de ${formatarDinheiro(Math.abs(geral.diferenca))}.` }]),
        ...(fila.divergentes.length ? [{ nivel: 'atencao', texto: `${fila.divergentes.length} fato(s) mudaram na origem depois de contabilizados.` }] : []),
        ...(fila.naoContabilizados.length ? [{ nivel: 'atencao', texto: `${fila.naoContabilizados.reduce((a, x) => a + x.n, 0)} fato(s) aguardando contabilização.` }] : []),
        ...(carteiras.grupo.pagarVencido ? [{ nivel: 'atencao', texto: `${formatarDinheiro(carteiras.grupo.pagarVencido)} vencidos a pagar.` }] : []),
        /*
         * O vencido a RECEBER e o alerta mais acionavel deste painel, e faltava.
         *
         * Enquanto ninguem registrar baixa, tudo que a operacao entregou nasce
         * vencido — o vencimento e a data da entrega, porque inventar trinta
         * dias esconderia atraso que ja existe. O numero grande e o sinal certo:
         * ele diz que o lado do pagamento ainda nao chegou ao sistema.
         */
        ...(carteiras.grupo.receberVencido ? [{
          nivel: 'atencao',
          texto: `${formatarDinheiro(carteiras.grupo.receberVencido)} a receber sem baixa registrada.`,
        }] : []),
      ],
    });
  },

  /* ── Parceiros e pessoas ─────────────────────────────────────────────── */

  'GET /api/erp/parceiros': (fed, req) => {
    const { sql } = contextoErp(fed, req, { modulo: 'contas_pagar' });
    return ok(sql.prepare('select * from erp_parceiros where ativo = 1 order by nome').all());
  },

  'POST /api/erp/parceiros': (fed, req, _p, corpo) => {
    const { sql, usuario } = contextoErp(fed, req, { modulo: 'contas_pagar', nivel: 'escrever' });
    const nome = texto(corpo?.nome, 160);
    if (!nome) throw new ErroHttp(422, 'nome_obrigatorio', 'Informe o nome do parceiro.');
    const id = novoId();
    sql.prepare(
      `insert into erp_parceiros (id, tipo, nome, documento, instancia, email, telefone, ativo, criado_em)
       values (?,?,?,?,?,?,?,1,?)`,
    ).run(id, corpo?.tipo ?? 'fornecedor', nome,
      String(corpo?.documento ?? '').replace(/\D/g, '') || null,
      corpo?.instancia ?? null, texto(corpo?.email, 160), texto(corpo?.telefone, 40), agora());
    void usuario;
    return ok(sql.prepare('select * from erp_parceiros where id = ?').get(id));
  },

  'GET /api/erp/colaboradores': (fed, req, _p, _c, url) => {
    const { sql } = contextoErp(fed, req, { modulo: 'rh' });
    const inst = url?.searchParams.get('instancia');
    return ok(inst
      ? sql.prepare('select * from erp_colaboradores where instancia = ? and ativo = 1 order by nome').all(inst)
      : sql.prepare('select * from erp_colaboradores where ativo = 1 order by instancia, nome').all());
  },

  'POST /api/erp/colaboradores': (fed, req, _p, corpo) => {
    const { sql } = contextoErp(fed, req, { modulo: 'rh', nivel: 'escrever' });
    const nome = texto(corpo?.nome, 160);
    if (!nome) throw new ErroHttp(422, 'nome_obrigatorio', 'Informe o nome.');
    if (!corpo?.instancia) throw new ErroHttp(422, 'instancia_obrigatoria', 'Informe a empresa.');
    const id = novoId();
    sql.prepare(
      `insert into erp_colaboradores
         (id, instancia, nome, documento, cargo, setor, centro_custo, admissao,
          salario_centavos, usuario_email, ativo, criado_em)
       values (?,?,?,?,?,?,?,?,?,?,1,?)`,
    ).run(id, corpo.instancia, nome,
      String(corpo?.documento ?? '').replace(/\D/g, '') || null,
      texto(corpo?.cargo, 80), corpo?.setor ?? null, corpo?.centro_custo ?? null,
      corpo?.admissao ?? null,
      corpo?.salario_centavos != null || corpo?.salario != null
        ? valorDoCorpo({ valor_centavos: corpo?.salario_centavos, salario: corpo?.salario }, 'salario')
        : null,
      texto(corpo?.usuario_email, 160), agora());
    return ok(sql.prepare('select * from erp_colaboradores where id = ?').get(id));
  },

  // ── Campos personalizados ────────────────────────────────────────────────
  /**
   * O registro de propriedades da empresa ativa.
   *
   * Uma tela só lê daqui para desenhar formulário, coluna de tabela e ficha —
   * é o que faz acrescentar um campo ser uma linha de dado, e não alteração em
   * quatro lugares do código.
   */
  'GET /api/propriedades': (fed, req, _p, _c, url) => {
    const { escopo } = contexto(fed, req);
    const entidade = url?.searchParams.get('entidade') ?? 'cliente';
    return ok({
      entidade,
      tipos: TIPOS_CAMPO,
      propriedades: listarPropriedades(escopo, entidade),
    });
  },

  'POST /api/propriedades': (fed, req, _p, corpo) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);

    const erroChave = validarChave(corpo?.chave);
    if (erroChave) throw new ErroHttp(400, 'chave_invalida', erroChave);
    if (!TIPOS_CAMPO[corpo?.tipo]) {
      throw new ErroHttp(400, 'tipo_invalido', `Tipo "${corpo?.tipo}" não existe.`);
    }
    const rotulo = String(corpo?.rotulo ?? '').trim();
    if (!rotulo) throw new ErroHttp(400, 'rotulo_vazio', 'O campo precisa de um nome visível.');

    const opcoes = Array.isArray(corpo?.opcoes)
      ? corpo.opcoes.map((o) => String(o).trim()).filter(Boolean)
      : [];
    if (TIPOS_CAMPO[corpo.tipo].exigeOpcoes && opcoes.length < 2) {
      throw new ErroHttp(400, 'faltam_opcoes',
        'Campo de escolha precisa de pelo menos duas opções — senão não há o que escolher.');
    }

    const jaExiste = escopo.uma(
      'select id from propriedades where {ESCOPO} and entidade = ? and chave = ?',
      corpo?.entidade ?? 'cliente', corpo.chave,
    );
    if (jaExiste) throw new ErroHttp(409, 'chave_duplicada', `Já existe um campo com a chave "${corpo.chave}".`);

    const id = novoId();
    escopo.inserir('propriedades', {
      id,
      entidade: corpo?.entidade ?? 'cliente',
      origem: 'custom',
      chave: corpo.chave,
      rotulo,
      tipo: corpo.tipo,
      opcoes: opcoes.length ? JSON.stringify(opcoes) : null,
      descricao: corpo?.descricao ? String(corpo.descricao).slice(0, 400) : null,
      obrigatorio: corpo?.obrigatorio ? 1 : 0,
      mostrar_na_tabela: corpo?.mostrarNaTabela ? 1 : 0,
      ordem: Number(corpo?.ordem) || 100,
      criado_em: agora(),
    });

    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'propriedade.criar',
      entidade: 'propriedades', entidadeId: id,
      dados: { chave: corpo.chave, tipo: corpo.tipo },
    });
    return ok({ id, criado: true });
  },

  /**
   * Arquivar, e não apagar.
   *
   * O valor continua gravado no JSON de cada cliente. Apagar a definição faria
   * o dado virar órfão ilegível — ninguém saberia mais o que aquela chave era,
   * e desarquivar traria tudo de volta. Arquivar some da tela e preserva.
   */
  'DELETE /api/propriedades/:id': (fed, req, p) => {
    const { escopo, usuario, empresa, banco } = contexto(fed, req);
    const alvo = escopo.uma('select * from propriedades where {ESCOPO} and id = ?', p.id);
    if (!alvo) throw new ErroHttp(404, 'nao_encontrado', 'Campo não encontrado.');
    if (alvo.origem === 'sistema') {
      throw new ErroHttp(409, 'campo_do_sistema',
        'Campo do sistema não pode ser removido — ele descreve uma coluna real da base.');
    }
    escopo.atualizar('propriedades', p.id, { arquivado_em: agora() });
    banco.auditar({
      empresaId: empresa.id, ator: usuario.email, acao: 'propriedade.arquivar',
      entidade: 'propriedades', entidadeId: p.id, dados: { chave: alvo.chave },
    });
    return ok({ arquivado: true, chave: alvo.chave });
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
    /*
     * A campanha vem de TRES fontes, nesta ordem — e a tela precisa saber de
     * qual veio, porque o conserto de cada caso e diferente.
     *
     *   utm     — lead de site. O nome veio da propria URL.
     *   meta    — lead de Click-to-WhatsApp com o `ad_id` ja resolvido.
     *   id_cru  — veio de anuncio e o nome ainda nao foi buscado (ou falhou).
     *   nenhuma — organico, indicacao, balcao. Nao havia campanha.
     *
     * Antes disto, TODO lead de Click-to-WhatsApp caia em "sem_campanha": o
     * canal em que a empresa gasta dinheiro era o unico sem resposta.
     */
    const porCampanha = escopo.todas(
      `select
         coalesce(nullif(a.utm_campaign, ''), d.campanha_nome, a.source_ad_id, 'sem_campanha')
           as campanha,
         case
           when nullif(a.utm_campaign, '') is not null then 'utm'
           when d.campanha_nome is not null then 'meta'
           when a.source_ad_id is not null then 'id_cru'
           else 'nenhuma'
         end as fonte_do_nome,
         max(d.conjunto_nome) as conjunto,
         max(d.anuncio_nome) as anuncio,
         max(d.situacao) as situacao,
         max(a.source_ad_id) as source_ad_id,
         max(d.erro) as erro,
         count(*) as n
       from atribuicoes a
       left join dimensoes_campanha d
         on d.empresa_id = a.empresa_id and d.source_ad_id = a.source_ad_id
       where a.{ESCOPO}
       group by 1, 2 order by n desc limit 20`,
    );

    // Quantos anuncios ainda estao sem nome, para a tela poder OFERECER o
    // conserto em vez de so exibir numero cru.
    const pendentes = escopo.uma(
      `select count(distinct a.source_ad_id) as n
       from atribuicoes a
       left join dimensoes_campanha d
         on d.empresa_id = a.empresa_id and d.source_ad_id = a.source_ad_id
       where a.{ESCOPO} and a.source_ad_id is not null and d.campanha_nome is null`,
    );

    return ok({
      linhas, porPlataforma, porCampanha,
      campanhas: {
        pendentes: pendentes?.n ?? 0,
        temToken: !!tokenDeMarketing(escopo),
        lote: LOTE_MAXIMO,
      },
    });
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

export { contexto, montarRegua, assinar, negarPorPapel, PAPEL_MINIMO };
