/**
 * Testes da federação, da atribuição e da conversão offline.
 *
 * Separado de `selftest.mjs` porque cobre outra camada: lá é o CRM de uma
 * empresa; aqui é o que só existe quando há várias instâncias e quando o que
 * acontece no funil precisa voltar para as plataformas de anúncio.
 */

import { rmSync, readFileSync } from 'node:fs';
import { Federacao, CATALOGO } from './federacao.mjs';
import { semear } from './seed.mjs';
import {
  sincronizarCentral, resumoConsolidado, consultarConsolidado, receberLead,
  garantirChaves, listarChaves, resolverChave,
} from './central.mjs';
import { canaisDe, canal, diagnosticar, rotularOrigem, TIPOS } from './canais.mjs';
import {
  validarChave, validarCampos, formatar, garantirCamposSistema, CAMPOS_SISTEMA,
} from './propriedades.mjs';
import {
  extrairMensagens, validarAssinatura, responderDesafio, eventoBM, EVENTOS_BM,
  montarMetaBusinessMessaging, dentroDaJanela,
} from './ctwa.mjs';
import { createHmac } from 'node:crypto';
import {
  extrairAtribuicao, inferirPlataforma, montarFbc, normalizarEmail,
  normalizarTelefone, normalizarTexto, identificadoresHash, podeCorresponder, temSinal,
} from './atribuicao.mjs';
import {
  avaliarConversao, chaveIdempotencia, classificarResposta, dataGoogleAds,
  eventoDaEtapa, montarGoogleAds, montarMetaCapi, podeRepetirSozinho, esperaDeRetentativa,
} from './conversoes.mjs';
import { drenarEventos, despacharConversoes, registrarMudancaDeEtapa } from './conversoes-servico.mjs';
import { novoId, agora } from './db.mjs';
import { reancorar, ancoraDe, diagnosticoDaAncora } from './reancorar.mjs';
import { montarRegua, negarPorPapel, ROTAS, assinar, ErroHttp } from './api.mjs';
import { diagnosticarFilaVazia } from './regua.mjs';
import {
  precisaResolver, lerAnuncio, diagnosticarErro, requisicaoDoAnuncio, resolverAnuncios,
  rotularCampanha, VALIDADE_MS, ESPERA_APOS_FALHA_MS,
} from './campanhas.mjs';
import {
  cifrar, decifrar, chaveMestra, temChave, pista, lerCredencial, gravarCredencial,
  apagarCredencial, listarCredenciais, CREDENCIAIS,
} from './cofre.mjs';
import {
  CHECKLIST, NIVEIS, TAMANHO_POR_NIVEL, TOTAL_ITENS, catalogoDoNivel, exigeFoto,
  hashConteudo, itemNoNivel, itensDoChecklist, pendencias, podeIniciarOS,
  resumo as resumoVistoria,
} from './vistoria.mjs';
import {
  PLANO_PADRAO, kmEstimado, mediaKmMes, projetarServico, validarKm,
} from './veiculos.mjs';
import { hashSenha, verificarSenha, ehHash, migrarSenhas, avaliarForca } from './senha.mjs';

let passou = 0;
const falhas = [];

function teste(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas.push({ nome, erro: e.message });
    console.log(`  FALHA ${nome}\n         ${e.message}`);
  }
}
const igual = (a, b, m) => {
  if (a !== b) throw new Error(`${m ?? 'diferente'} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const verdadeiro = (v, m) => { if (!v) throw new Error(m ?? 'esperava verdadeiro'); };

/*
 * Teste assincrono, numa fila propria.
 *
 * `teste()` conta o sucesso ANTES de a promessa resolver: passar uma funcao
 * async para ele produz "ok" mesmo quando o corpo falha depois — um teste que
 * nunca reprova, que e pior que teste nenhum. Estes ficam guardados e sao
 * executados em sequencia no fim, antes do resumo.
 */
const filaAsync = [];
function testeAsync(nome, fn) {
  filaAsync.push(async () => {
    try {
      await fn();
      passou += 1;
      console.log(`  ok   ${nome}`);
    } catch (e) {
      falhas.push({ nome, erro: e.message });
      console.log(`  FALHA ${nome}
         ${e.message}`);
    }
  });
}

console.log('\n ATRIBUIÇÃO\n');

teste('extrai os parâmetros de clique de uma URL real', () => {
  const a = extrairAtribuicao(
    'https://loja.com.br/tintas?gclid=ABC123&utm_source=google&utm_medium=cpc&utm_campaign=tintas',
  );
  igual(a.gclid, 'ABC123');
  igual(a.utm_campaign, 'tintas');
  igual(a.plataforma, 'google_ads');
});

teste('orgânico do Google não vira google_ads', () => {
  igual(inferirPlataforma({ utm_source: 'google', utm_medium: 'organic' }), 'organico');
  igual(inferirPlataforma({ utm_source: 'google', utm_medium: 'cpc' }), 'google_ads');
  igual(inferirPlataforma({ utm_source: 'facebook', utm_medium: 'social' }), 'organico');
  igual(inferirPlataforma({ fbclid: 'x', utm_medium: 'organic' }), 'meta_ads',
    'parâmetro de clique é prova e vence a declaração');
});

teste('fbc é montado a partir do fbclid quando o cookie não veio', () => {
  const fbc = montarFbc('IwAR123', '2026-09-01T12:00:00.000Z');
  verdadeiro(/^fb\.1\.\d+\.IwAR123$/.test(fbc), `formato errado: ${fbc}`);
  igual(montarFbc(null), null);
});

teste('gmail normaliza ponto e rótulo — mesma caixa, mesmo hash', () => {
  igual(normalizarEmail('Joao.Silva+loja@Gmail.com'), 'joaosilva@gmail.com');
  igual(normalizarEmail('joaosilva@gmail.com'), 'joaosilva@gmail.com');
  igual(normalizarEmail('Ana.Paula+x@empresa.com.br'), 'ana.paula@empresa.com.br',
    'fora do gmail o ponto é significativo');
});

teste('telefone sai nas duas formas — Google quer +, Meta não', () => {
  const t = normalizarTelefone('(38) 99811-2233');
  igual(t.e164, '+5538998112233');
  igual(t.digitos, '5538998112233');
  igual(normalizarTelefone('123'), null);
});

teste('as duas formas de telefone geram hashes DIFERENTES', () => {
  const h = identificadoresHash({ nome: 'Ana Souza', telefone: '38998112233', email: 'a@b.com' });
  verdadeiro(h.fone_sha256 !== h.fone_digitos_sha256,
    'se fossem iguais, uma das plataformas não casaria e ninguém perceberia');
});

teste('acento e pontuação somem do texto normalizado', () => {
  igual(normalizarTexto('São Paulo'), 'saopaulo');
  igual(normalizarTexto('Antônio'), 'antonio');
});

teste('sem clique e sem pessoa, não há como corresponder', () => {
  igual(podeCorresponder({}, {}).pode, false);
  igual(podeCorresponder({ gclid: 'x' }, {}).porClique, true);
  igual(podeCorresponder({}, { email_sha256: 'x' }).porPessoa, true);
});

teste('atribuição vazia não merece linha', () => {
  igual(temSinal({}), false);
  igual(temSinal({ gclid: 'x' }), true);
  igual(temSinal({ utm_campaign: 'natal' }), true);
});

console.log('\n CONVERSÃO OFFLINE\n');

teste('data do Google Ads não é ISO — espaço e fuso explícito', () => {
  const d = dataGoogleAds('2026-09-03T15:30:00.000Z', -180);
  igual(d, '2026-09-03 12:30:00-03:00');
  verdadeiro(!d.includes('T'), 'ISO com T é recusado pela API');
});

teste('etapa vira evento de conversão', () => {
  igual(eventoDaEtapa('ganho').chave, 'venda');
  igual(eventoDaEtapa('qualificado').chave, 'lead_qualificado');
  igual(eventoDaEtapa('novo'), null);
});

teste('venda sem valor é recusada — não ensina retorno', () => {
  const base = {
    destinoConfigurado: true, consentimento: true,
    atribuicao: { gclid: 'x' }, hashes: { email_sha256: 'h' },
  };
  igual(avaliarConversao({ ...base, evento: 'venda', valorCentavos: 0 }).motivo, 'valor_obrigatorio');
  verdadeiro(avaliarConversao({ ...base, evento: 'venda', valorCentavos: 5000 }).permitido);
  verdadeiro(avaliarConversao({ ...base, evento: 'lead_qualificado', valorCentavos: 0 }).permitido,
    'lead qualificado vale sem valor — o sinal é a qualidade');
});

teste('sem consentimento nenhum hash sai daqui', () => {
  const d = avaliarConversao({
    destinoConfigurado: true, consentimento: false,
    atribuicao: { gclid: 'x' }, hashes: { email_sha256: 'h' },
    evento: 'lead_qualificado', valorCentavos: 0,
  });
  igual(d.motivo, 'sem_consentimento');
});

teste('destino não configurado vence o resto — a ordem importa', () => {
  const d = avaliarConversao({
    destinoConfigurado: false, consentimento: false,
    atribuicao: {}, hashes: {}, evento: 'venda', valorCentavos: 0,
  });
  igual(d.motivo, 'destino_nao_configurado');
});

teste('Google Ads manda UM parâmetro de clique, nunca dois', () => {
  const p = montarGoogleAds({
    cliente: { id: 'c1', nome: 'Ana Souza', email: 'a@b.com', telefone: '38998112233' },
    atribuicao: { gclid: 'G1', gbraid: 'B1', wbraid: 'W1' },
    evento: 'venda', valorCentavos: 12345, moeda: 'BRL',
    ocorridoEm: agora(), destino: { identificador: '123', acao: 'customers/1/conversionActions/2' },
  });
  const c = p.corpo.conversions[0];
  igual(c.gclid, 'G1');
  igual(c.gbraid, undefined, 'mandar dois é erro de validação na API');
  igual(c.wbraid, undefined);
  igual(c.conversionValue, 123.45, 'centavos viram reais com duas casas');
  igual(p.corpo.partialFailure, true);
});

teste('Meta CAPI usa o telefone SEM o +, diferente do Google', () => {
  const cliente = {
    id: 'c1', nome: 'Ana Souza', email: 'a@b.com', telefone: '38998112233', cidade: 'Januária',
  };
  const ctx = {
    cliente, atribuicao: { fbc: 'fb.1.100.X', fbp: 'fb.1.2.3' },
    evento: 'venda', valorCentavos: 5000, moeda: 'BRL',
    ocorridoEm: agora(), destino: { identificador: 'pix' }, idempotencyKey: 'k1',
  };
  const meta = montarMetaCapi(ctx);
  const google = montarGoogleAds({ ...ctx, destino: { identificador: '1', acao: 'a' } });

  const phMeta = meta.corpo.data[0].user_data.ph[0];
  const phGoogle = google.corpo.conversions[0].userIdentifiers
    .find((u) => u.hashedPhoneNumber)?.hashedPhoneNumber;

  verdadeiro(phMeta !== phGoogle, 'as duas plataformas exigem formatos diferentes');
  igual(meta.corpo.data[0].event_name, 'Purchase');
  igual(meta.corpo.data[0].action_source, 'system_generated');
  igual(meta.corpo.data[0].event_id, 'k1', 'event_id é o que desduplica contra o Pixel');
  igual(meta.corpo.data[0].user_data.fbc, 'fb.1.100.X');
});

teste('resposta ambígua vira desconhecido, nunca repetição', () => {
  igual(classificarResposta({ status: 0, erro: 'timeout' }), 'desconhecido');
  igual(classificarResposta({ status: 503 }), 'desconhecido');
  igual(classificarResposta({ status: 200 }), 'enviado');
  igual(classificarResposta({ status: 400 }), 'falhou');
});

teste('a chave de idempotência separa duas vendas do mesmo cliente', () => {
  const a = chaveIdempotencia({ evento: 'venda', clienteId: 'c1', oportunidadeId: 'o1', destino: 'google_ads' });
  const b = chaveIdempotencia({ evento: 'venda', clienteId: 'c1', oportunidadeId: 'o2', destino: 'google_ads' });
  const c = chaveIdempotencia({ evento: 'venda', clienteId: 'c1', oportunidadeId: 'o1', destino: 'meta_capi' });
  verdadeiro(a !== b, 'oportunidades diferentes são vendas diferentes');
  verdadeiro(a !== c, 'cada destino recebe a sua');
});

console.log('\n FEDERAÇÃO\n');

const DIR = new URL('../data/teste-fed/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
rmSync(DIR, { recursive: true, force: true });
const fed = new Federacao(DIR);
for (const e of CATALOGO) semear(fed.abrir(e.codigo), { empresa: e.codigo });

teste('cada empresa tem o SEU banco', () => {
  igual(fed.codigosDeEmpresa().length, 3);
  const arquivos = fed.existentes();
  for (const e of CATALOGO) verdadeiro(arquivos.includes(e.codigo), `falta o banco de ${e.codigo}`);
});

teste('cada instância contém UMA empresa, e só a dela', () => {
  for (const e of CATALOGO) {
    const linhas = fed.abrir(e.codigo).sistema().prepare('select codigo from empresas').all();
    igual(linhas.length, 1, `${e.codigo} deveria ter uma empresa`);
    igual(linhas[0].codigo, e.codigo);
  }
});

teste('isolamento físico: o cliente da oficina não existe no banco da loja', () => {
  const mp = fed.abrir('MP');
  const emp = mp.sistema().prepare('select id from empresas limit 1').get();
  const cliente = mp.para(emp.id).todas('select * from clientes where {ESCOPO} limit 1')[0];
  verdadeiro(cliente, 'a oficina precisa ter cliente');

  const ft = fed.abrir('FT');
  const achado = ft.sistema().prepare('select id from clientes where id = ?').get(cliente.id);
  igual(achado, undefined, 'a linha não pode existir no outro arquivo');
});

teste('instância desconhecida é recusada', () => {
  let recusou = false;
  try { fed.abrir('XX'); } catch { recusou = true; }
  verdadeiro(recusou);
});

teste('consulta federada carimba a instância de origem', () => {
  const { linhas } = fed.consultar(['MP', 'AF', 'FT'], (banco) => {
    const emp = banco.sistema().prepare('select id from empresas limit 1').get();
    return banco.para(emp.id).todas('select id, nome from clientes where {ESCOPO} limit 3');
  });
  igual(linhas.length, 9);
  for (const l of linhas) verdadeiro(l._instancia, 'sem carimbo, ids de empresas diferentes colidem');
  igual(new Set(linhas.map((l) => l._instancia)).size, 3);
});

teste('instância com falha não derruba as outras', () => {
  const { linhas, falhas: f } = fed.consultar(['MP', 'AF'], (banco) => {
    const emp = banco.sistema().prepare('select id, codigo from empresas limit 1').get();
    if (emp.codigo === 'AF') throw new Error('instância fora do ar');
    return banco.para(emp.id).todas('select id from clientes where {ESCOPO} limit 2');
  });
  igual(linhas.length, 2, 'a instância sã devolve normalmente');
  igual(f.length, 1);
  igual(f[0].instancia, 'AF');
});

console.log('\n INSTÂNCIA CENTRAL\n');

const sinc = sincronizarCentral(fed);

teste('a central recebe os leads das três instâncias', () => {
  igual(sinc.porInstancia.length, 3);
  for (const p of sinc.porInstancia) verdadeiro(p.linhas > 0, `${p.instancia} não sincronizou`);
  const r = resumoConsolidado(fed.abrirCentral());
  igual(r.total, sinc.linhas);
  igual(r.porInstancia.length, 3);
});

teste('sincronizar duas vezes não duplica', () => {
  const antes = resumoConsolidado(fed.abrirCentral()).total;
  sincronizarCentral(fed);
  sincronizarCentral(fed);
  igual(resumoConsolidado(fed.abrirCentral()).total, antes,
    'a chave é (instância, cliente) — reprocessar atualiza, não duplica');
});

teste('a central sabe de que plataforma cada lead veio', () => {
  const plataformas = resumoConsolidado(fed.abrirCentral()).porPlataforma.map((p) => p.plataforma);
  verdadeiro(plataformas.includes('google_ads'), 'deveria haver lead de Google Ads');
  verdadeiro(plataformas.includes('meta_ads'), 'deveria haver lead de Meta');
});

teste('a consulta consolidada filtra por instância', () => {
  const so = consultarConsolidado(fed.abrirCentral(), { instancia: 'FT' });
  verdadeiro(so.length > 0);
  verdadeiro(so.every((l) => l.instancia === 'FT'));
});

teste('lead externo sem destino fica aguardando triagem', () => {
  const central = fed.abrirCentral();
  igual(receberLead(central, { fonte: 'formulario', payload: {} }).status, 'recebido');

  const r2 = receberLead(central, { fonte: 'formulario', destino: 'FT', payload: {} });
  igual(r2.status, 'roteado');
  igual(r2.destino, 'FT');

  igual(receberLead(central, { fonte: 'formulario', destino: 'INEXISTENTE', payload: {} }).status,
    'recebido', 'destino inválido não roteia para lugar nenhum');
});

console.log('\n CICLO COMPLETO DE CONVERSÃO\n');

teste('mover para ganho gera evento, conversão e payload das duas plataformas', () => {
  const banco = fed.abrir('FT');
  const emp = banco.sistema().prepare('select * from empresas limit 1').get();
  const escopo = banco.para(emp.id);

  const comAtr = escopo.todas(
    `select c.* from clientes c join atribuicoes a on a.cliente_id = c.id
     where c.{ESCOPO} and c.consentimento_lgpd = 1 limit 1`,
  )[0];
  verdadeiro(comAtr, 'a carga precisa ter cliente com atribuição');

  const opId = novoId();
  escopo.inserir('oportunidades', {
    id: opId, cliente_id: comAtr.id, titulo: 'Teste de conversão', etapa: 'ganho',
    valor_centavos: 250000, probabilidade: 100, posicao: 9999, motivo_perda: null,
    criado_em: agora(), atualizado_em: agora(),
  });

  const chave = registrarMudancaDeEtapa(escopo, {
    oportunidade: escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', opId),
    etapaAnterior: 'negociacao', ator: 'teste',
  });
  igual(chave, 'venda');

  const dren = drenarEventos(banco, escopo);
  verdadeiro(dren.enfileiradas >= 2, `esperava uma conversão por destino, veio ${dren.enfileiradas}`);

  const desp = despacharConversoes(banco, escopo, emp, { ator: 'teste' });
  verdadeiro(desp.enviadas >= 2, `esperava despacho aos dois destinos, veio ${desp.enviadas}`);

  const linhas = escopo.todas('select * from conversoes where {ESCOPO} and oportunidade_id = ?', opId);
  igual(linhas.map((l) => l.destino).sort().join(','), 'google_ads,meta_capi');
  for (const l of linhas) {
    const p = JSON.parse(l.payload);
    verdadeiro(p.endpoint, 'payload sem endpoint');
    verdadeiro(p.corpo, 'payload sem corpo');
  }
});

teste('drenar duas vezes não enfileira de novo', () => {
  const banco = fed.abrir('FT');
  const emp = banco.sistema().prepare('select * from empresas limit 1').get();
  const escopo = banco.para(emp.id);
  const antes = escopo.contar('conversoes');
  drenarEventos(banco, escopo);
  drenarEventos(banco, escopo);
  igual(escopo.contar('conversoes'), antes, 'consumido_por impede reprocessar');
});

teste('cliente sem consentimento tem a conversão BLOQUEADA, não enviada', () => {
  const banco = fed.abrir('MP');
  const emp = banco.sistema().prepare('select * from empresas limit 1').get();
  const escopo = banco.para(emp.id);

  const sem = escopo.todas('select * from clientes where {ESCOPO} and consentimento_lgpd = 0 limit 1')[0];
  verdadeiro(sem, 'a carga precisa ter cliente sem consentimento');

  const opId = novoId();
  escopo.inserir('oportunidades', {
    id: opId, cliente_id: sem.id, titulo: 'Sem consentimento', etapa: 'ganho',
    valor_centavos: 100000, probabilidade: 100, posicao: 8888, motivo_perda: null,
    criado_em: agora(), atualizado_em: agora(),
  });
  registrarMudancaDeEtapa(escopo, {
    oportunidade: escopo.uma('select * from oportunidades where {ESCOPO} and id = ?', opId),
    etapaAnterior: 'negociacao', ator: 'teste',
  });
  drenarEventos(banco, escopo);
  despacharConversoes(banco, escopo, emp, { ator: 'teste' });

  const linhas = escopo.todas('select * from conversoes where {ESCOPO} and oportunidade_id = ?', opId);
  verdadeiro(linhas.length > 0);
  for (const l of linhas) {
    igual(l.status, 'bloqueado');
    igual(l.motivo, 'sem_consentimento');
  }
});

console.log('\n REANCORAGEM DA DEMONSTRAÇÃO\n');

teste('a âncora existe logo após a carga', () => {
  const b = fed.abrir('MP');
  verdadeiro(ancoraDe(b), 'sem âncora não há como saber a idade da demonstração');
  const d = diagnosticoDaAncora(b);
  verdadeiro(typeof d.horas === 'number');
  igual(d.envelhecida, false, 'carga recém-feita não pode estar envelhecida');
});

teste('deslocar por poucos segundos é recusado', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const r = reancorar(b, b.para(emp.id), { ator: 'teste' });
  igual(r.deslocouSegundos, 0);
  igual(r.motivo, 'ancora_recente', 'deslocar segundos só sujaria a auditoria');
});

teste('reancorar desliza a história e devolve a fila', () => {
  const b = fed.abrir('AF');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const esc = b.para(emp.id);

  // Envelhece à força: empurra a história 30 horas para TRÁS, como se o
  // relógio tivesse andado desde a carga.
  const sql = b.sistema();
  for (const [t, cols] of [['clientes', ['ultimo_inbound_em']], ['pedidos', ['feito_em']]]) {
    for (const c of cols) {
      sql.prepare(
        `update ${t} set ${c} = strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '-30 hours') `
        + `where empresa_id = ? and ${c} is not null`,
      ).run(emp.id);
    }
  }
  const antes = montarRegua(b, esc, emp).filter((f) => f.decisao.permitido).length;

  // E move a âncora para trás, para que o deslocamento tenha o que corrigir.
  const r = reancorar(b, esc, { ator: 'teste', minimoSegundos: 0 });
  verdadeiro(r.deslocouSegundos >= 0);

  const depois = montarRegua(b, esc, emp).filter((f) => f.decisao.permitido).length;
  verdadeiro(depois >= antes, `a fila não podia encolher: ${antes} → ${depois}`);
});

teste('reancorar NÃO quebra a cadeia de auditoria', () => {
  for (const cod of ['MP', 'AF', 'FT']) {
    const b = fed.abrir(cod);
    igual(b.verificarCadeia().length, 0, `cadeia de ${cod} quebrada após reancorar`);
  }
});

teste('nulo continua nulo — descadastro não nasce por efeito colateral', () => {
  const b = fed.abrir('FT');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const esc = b.para(emp.id);
  const semOptOutAntes = esc.contar('clientes', 'and opt_out_em is null');
  reancorar(b, esc, { ator: 'teste', minimoSegundos: 0 });
  igual(esc.contar('clientes', 'and opt_out_em is null'), semOptOutAntes,
    'deslocar data não pode inventar descadastro para quem não tinha');
});

console.log('\n SENHA\n');

teste('hash confere a senha certa e recusa a errada', () => {
  const h = hashSenha('segredo-forte-9');
  verdadeiro(verificarSenha('segredo-forte-9', h));
  igual(verificarSenha('segredo-forte-8', h), false);
});

teste('a mesma senha gera hashes diferentes — o sal e por registro', () => {
  const a = hashSenha('igual123');
  const b = hashSenha('igual123');
  verdadeiro(a !== b, 'sem sal por registro, duas contas com a mesma senha se denunciam');
  verdadeiro(verificarSenha('igual123', a) && verificarSenha('igual123', b));
});

teste('texto claro nunca e aceito como se fosse hash', () => {
  igual(verificarSenha('demo', 'demo'), false,
    'aceitar comparacao crua manteria a porta aberta para bancos antigos');
  igual(ehHash('demo'), false);
  igual(ehHash(hashSenha('demo')), true);
});

teste('hash corrompido e recusado sem lancar excecao', () => {
  igual(verificarSenha('x', 'scrypt$16384$8$1$naoehbase64!!!'), false);
  igual(verificarSenha('x', 'scrypt$'), false);
  igual(verificarSenha('x', null), false);
});

teste('os parametros de custo viajam DENTRO do registro', () => {
  const h = hashSenha('teste-1234', { n: 1024 });
  verdadeiro(h.startsWith('scrypt$1024$'), `parametros ausentes: ${h.slice(0, 20)}`);
  verdadeiro(verificarSenha('teste-1234', h),
    'sem os parametros gravados, endurecer o custo invalidaria as senhas antigas');
});

teste('a migracao converte texto claro e nao remexe no que ja e hash', () => {
  const b = fed.abrir('MP');
  const sql = b.sistema();
  const u = sql.prepare('select id from usuarios limit 1').get();
  sql.prepare('update usuarios set senha = ? where id = ?').run('emtextoclaro', u.id);

  const r = migrarSenhas(b);
  igual(r.migradas, 1);
  verdadeiro(r.jaEmHash >= 1, 'os outros ja deviam estar em hash');

  const depois = sql.prepare('select senha from usuarios where id = ?').get(u.id);
  verdadeiro(ehHash(depois.senha));
  verdadeiro(verificarSenha('emtextoclaro', depois.senha), 'a senha precisa continuar valendo');

  igual(migrarSenhas(b).migradas, 0, 'rodar de novo nao pode re-hashear');
});

teste('a politica recusa senha curta e a que repete o e-mail', () => {
  igual(avaliarForca('abc').aceitavel, false);
  igual(avaliarForca('somenteletras').aceitavel, false, 'falta numero ou simbolo');
  igual(avaliarForca('diretoria2026', { email: 'diretoria@fortgrupo.com.br' }).aceitavel, false,
    'senha que contem o proprio e-mail e a primeira que se tenta');
  igual(avaliarForca('Tinta-Forte-2026').aceitavel, true);
});


/* ── Canais de entrada ────────────────────────────────────────────────────── */

teste('cada empresa tem o proprio catalogo de canais', () => {
  const mp = canaisDe('MP').map((x) => x.id);
  const af = canaisDe('AF').map((x) => x.id);
  const ft = canaisDe('FT').map((x) => x.id);

  verdadeiro(mp.length >= 8 && af.length >= 8 && ft.length >= 8, 'catalogo raso demais');

  // A regressao que motivou o catalogo: as tres empresas dividiam a MESMA
  // lista, e canais de oficina de injecao apareciam na fazenda e na loja.
  verdadeiro(mp.includes('guincho_24h'), 'guincho pertence a oficina');
  verdadeiro(!af.includes('guincho_24h'), 'fazenda de queijo nao recebe lead de guincho');
  verdadeiro(!ft.includes('guincho_24h'), 'loja de tinta nao recebe lead de guincho');
  verdadeiro(!af.includes('site_diagnostico'), 'fazenda nao faz diagnostico de bomba injetora');
  verdadeiro(!ft.includes('site_diagnostico'), 'loja de tinta nao faz diagnostico');

  // E o que e proprio de cada uma existe.
  verdadeiro(af.includes('emporio_revenda') && af.includes('assinatura'), 'canais da fazenda');
  verdadeiro(ft.includes('pintor_parceiro') && ft.includes('construtora_obra'), 'canais da loja');
});

teste('so canal com parametro de clique e atribuivel', () => {
  igual(canal('MP', 'balcao').atribuivel, false, 'quem entra pela porta nao clicou em anuncio');
  igual(canal('MP', 'telefone').atribuivel, false);
  igual(canal('MP', 'guincho_24h').atribuivel, false);
  igual(canal('MP', 'google_ads_form').atribuivel, true);
  igual(canal('FT', 'whatsapp_anuncio').atribuivel, true, 'click-to-whatsapp traz ctwa_clid');
  igual(canal('AF', 'site_pedido').atribuivel, true);

  // WhatsApp organico NAO e atribuivel — e o erro classico, porque o numero e
  // o mesmo que o anuncio usa. So o clique distingue um do outro.
  igual(canal('AF', 'whatsapp').atribuivel, false, 'whatsapp organico nao carrega clique');
});

teste('origem fora do catalogo volta marcada, nunca adivinhada', () => {
  const bom = rotularOrigem('MP', 'guincho_24h');
  igual(bom.conhecido, true);
  igual(bom.nome, 'Guincho parceiro 24h');

  const orfao = rotularOrigem('MP', 'planilha_antiga_2019');
  igual(orfao.conhecido, false, 'origem importada desconhecida precisa aparecer como tal');
  igual(orfao.nome, 'planilha_antiga_2019', 'nao pode inventar um nome bonito');
  igual(orfao.atribuivel, false);
});

teste('a carga so da origem atribuivel a quem tem parametro de clique', () => {
  for (const cod of ['MP', 'AF', 'FT']) {
    const b = fed.abrir(cod);
    const emp = b.sistema().prepare('select * from empresas limit 1').get();
    const esc = b.para(emp.id);
    const linhas = esc.todas(
      'select c.origem as origem, a.gclid as gclid, a.fbclid as fbclid'
      + ' from clientes c left join atribuicoes a'
      + "   on a.cliente_id = c.id and a.toque = 'primeiro'"
      + ' where c.{ESCOPO}',
    );
    verdadeiro(linhas.length > 0, cod + ' sem clientes');

    for (const l of linhas) {
      const meta = canal(cod, l.origem);
      verdadeiro(meta, cod + ': origem "' + l.origem + '" fora do catalogo da empresa');
      // O contrario nao vale: canal atribuivel pode nao ter clique (alguem
      // digitou o endereco do formulario). Clique sem canal pago e que e
      // impossivel, e era o que a carga antiga produzia.
      if (l.gclid || l.fbclid) {
        verdadeiro(meta.atribuivel,
          cod + ': cliente com clique veio de "' + l.origem + '", que nao e canal pago');
      }
    }
  }
});

teste('o diagnostico separa o que da para atribuir do que nao da', () => {
  const d = diagnosticar('MP', { balcao: 6, google_ads_form: 2, site_diagnostico: 2 });
  igual(d.total, 10);
  igual(d.atribuiveis, 4);
  igual(d.naoAtribuiveis, 6);
  igual(d.cobertura, 40, 'quatro de dez');
  igual(d.orfaos.length, 0);

  const comOrfao = diagnosticar('AF', { whatsapp: 3, importado_xls: 5 });
  igual(comOrfao.orfaos.length, 1, 'origem desconhecida tem de aparecer separada');
  igual(comOrfao.orfaos[0].id, 'importado_xls');
  igual(comOrfao.total, 8, 'orfao conta no total — senao a cobertura mente para mais');
});

teste('todo canal declara tipo valido, atribuicao e explicacao', () => {
  for (const cod of ['MP', 'AF', 'FT']) {
    for (const c of canaisDe(cod)) {
      verdadeiro(TIPOS[c.tipo], cod + '/' + c.id + ': tipo "' + c.tipo + '" desconhecido');
      igual(typeof c.atribuivel, 'boolean', cod + '/' + c.id);
      verdadeiro(c.nota && c.nota.length > 20, cod + '/' + c.id + ' sem explicacao');
    }
  }
});

/* ── Chave de captacao — a porta publica ──────────────────────────────────── */

teste('a chave de captacao e criada uma vez e preservada', () => {
  const central = fed.abrirCentral();
  const primeira = garantirChaves(central, CATALOGO);
  igual(primeira.length, CATALOGO.length);

  // Preservar nao e detalhe: a chave vai colada no HTML do site do cliente.
  // Regenerar na subida quebraria todo formulario publicado, em silencio, e o
  // sintoma apareceria dias depois como "paramos de receber lead".
  const segunda = garantirChaves(central, CATALOGO);
  igual(segunda.map((x) => x.chave).join(','), primeira.map((x) => x.chave).join(','),
    'rodar de novo nao pode trocar a chave');

  verdadeiro(primeira.every((x) => x.chave.length > 24), 'chave curta demais para ficar publica');
  verdadeiro(primeira.every((x) => x.chave.startsWith(x.codigo.toLowerCase() + '_')));
});

teste('resolver a chave conta o uso; chave desconhecida some sem pista', () => {
  const central = fed.abrirCentral();
  garantirChaves(central, CATALOGO);
  const alvo = listarChaves(central, 'MP')[0];

  const antes = alvo.usos;
  const r = resolverChave(central, alvo.chave);
  verdadeiro(r, 'a chave valida tem de resolver');
  igual(r.codigo, 'MP');
  igual(listarChaves(central, 'MP')[0].usos, antes + 1, 'uso nao contabilizado');

  igual(resolverChave(central, 'nao_existe_mesmo'), null);
  igual(resolverChave(central, ''), null);
  igual(resolverChave(central, null), null);

  // Desativada tem de se comportar igual a inexistente — senao a porta vira
  // oraculo e da para descobrir quais chaves existem testando uma a uma.
  central.sistema().prepare('update chaves_captacao set ativa = 0 where chave = ?').run(alvo.chave);
  igual(resolverChave(central, alvo.chave), null, 'chave desativada nao pode resolver');
  central.sistema().prepare('update chaves_captacao set ativa = 1 where chave = ?').run(alvo.chave);
});

teste('lead da porta publica cai na central com o clique ja extraido', () => {
  const central = fed.abrirCentral();
  garantirChaves(central, CATALOGO);
  const alvo = listarChaves(central, 'FT')[0];
  const destino = resolverChave(central, alvo.chave);

  const atr = extrairAtribuicao(
    { gclid: 'CjTESTE123', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'tinta-obra' },
    { paginaEntrada: 'https://exemplo.com.br/orcamento' },
  );
  const r = receberLead(central, {
    fonte: 'site_orcamento',
    destino: destino.codigo,
    payload: { nome: 'Teste da Porta', telefone: '38999990000', atribuicao: atr },
  });

  igual(r.destino, 'FT');
  igual(r.status, 'roteado');

  const salvo = central.sistema().prepare('select * from entrada_leads where id = ?').get(r.id);
  igual(salvo.gclid, 'CjTESTE123', 'o parametro de clique precisa ser extraido na CHEGADA');
  igual(salvo.utm_campaign, 'tinta-obra');
  verdadeiro(salvo.payload.includes('Teste da Porta'));
});

teste('lead sem destino fica em triagem, nao e descartado', () => {
  const central = fed.abrirCentral();
  const r = receberLead(central, { fonte: 'formulario', destino: null, payload: { nome: 'Sem Dono' } });
  igual(r.status, 'recebido');
  igual(r.destino, null);
  const salvo = central.sistema().prepare('select * from entrada_leads where id = ?').get(r.id);
  verdadeiro(salvo.motivo && salvo.motivo.includes('triagem'), 'precisa dizer por que parou');
});

teste('recarregar sem dizer a empresa e recusado, nao grava a MP por cima', () => {
  // O bug real: `semear` tem `empresa = 'MP'` como padrao, e `recarregarDemo`
  // omitia o parametro. Recarregar a Agrofort gravava a Minas Pecas por cima —
  // linha de `empresas` inclusive — e as tres instancias passavam a se
  // apresentar como MP. Ficou escondido porque a rota quebrava antes de chegar
  // ali; consertar o crash foi o que revelou o estrago.
  const af = fed.abrir('AF');

  let recusou = false;
  try { semear(af, { reset: true }); } catch { recusou = true; }
  verdadeiro(recusou, 'reset sem empresa explicita tem de falhar alto');

  const depoisDaTentativa = af.sistema().prepare('select codigo from empresas limit 1').get();
  igual(depoisDaTentativa.codigo, 'AF', 'a tentativa recusada nao pode ter mexido na base');

  // Com o codigo certo, recarrega e continua sendo AF.
  semear(af, { empresa: 'AF', reset: true });
  const emp = af.sistema().prepare('select codigo, nome from empresas limit 1').get();
  igual(emp.codigo, 'AF');
  igual(emp.nome, 'Fazenda Agrofort');

  // E as origens continuam sendo as da fazenda, nao as da oficina.
  const esc = af.para(emp.id ?? af.sistema().prepare('select id from empresas limit 1').get().id);
  const origens = esc.todas('select origem from clientes where {ESCOPO} group by origem')
    .map((r) => r.origem);
  verdadeiro(origens.length > 0, 'a recarga precisa ter gerado clientes');
  for (const o of origens) {
    verdadeiro(canal('AF', o), `origem "${o}" nao pertence ao catalogo da Agrofort`);
  }
  verdadeiro(!origens.includes('guincho_24h') && !origens.includes('site_diagnostico'),
    'canal de oficina de injecao nao pode aparecer na fazenda depois da recarga');
});

/* ── Click-to-WhatsApp ────────────────────────────────────────────────────── */

const WEBHOOK_CTWA = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_123',
    changes: [{
      field: 'messages',
      value: {
        metadata: { display_phone_number: '5538998491017', phone_number_id: 'PN_1' },
        contacts: [{ profile: { name: 'Joana da Obra' }, wa_id: '5538988887777' }],
        messages: [{
          from: '5538988887777', id: 'wamid.ABC1', timestamp: '1788446400',
          type: 'text', text: { body: 'Quero orcamento de tinta' },
          referral: {
            source_type: 'ad', source_id: '120000000000001',
            source_url: 'https://fb.me/X', headline: 'Tinta com 30% off',
            ctwa_clid: 'AR_CLIQUE_001',
          },
        }],
      },
    }],
  }],
};

teste('o webhook e percorrido inteiro, nao so entry[0].changes[0]', () => {
  const dois = {
    entry: [
      { id: 'W1', changes: [{ field: 'messages', value: { messages: [{ from: '1', id: 'm1', type: 'text' }] } }] },
      { id: 'W2', changes: [
        { field: 'messages', value: { messages: [{ from: '2', id: 'm2', type: 'text' }] } },
        { field: 'messages', value: { messages: [{ from: '3', id: 'm3', type: 'text' }] } },
      ] },
    ],
  };
  const m = extrairMensagens(dois);
  igual(m.length, 3, 'ler so a primeira entrada descarta mensagem sem erro nenhum');
  igual(m.map((x) => x.wamid).join(','), 'm1,m2,m3');
  igual(m[1].waba_id, 'W2', 'cada mensagem carrega o WABA da PROPRIA entrada');
});

teste('a primeira mensagem de anuncio traz o ctwa_clid', () => {
  const [m] = extrairMensagens(WEBHOOK_CTWA);
  igual(m.ctwa_clid, 'AR_CLIQUE_001');
  igual(m.waba_id, 'WABA_123');
  igual(m.source_ad_id, '120000000000001', 'source_id e o Ad ID, nao o clique');
  igual(m.wa_id, '5538988887777');
  igual(m.wamid, 'wamid.ABC1');
  igual(m.de_anuncio, true);
  igual(m.sem_ctwa, false);
  igual(m.recebido_em, new Date(1788446400 * 1000).toISOString(), 'timestamp e Unix em SEGUNDOS');
});

teste('anuncio sem ctwa_clid e MARCADO, nunca preenchido', () => {
  // Acontece de verdade: posicionamento em Status do WhatsApp chega como
  // anuncio e sem o clique. Inventar um valor produziria evento que a Meta
  // aceita e que nunca casa com anuncio nenhum — o painel mostraria conversao
  // e o anunciante confiaria nela.
  const semClique = JSON.parse(JSON.stringify(WEBHOOK_CTWA));
  delete semClique.entry[0].changes[0].value.messages[0].referral.ctwa_clid;
  const [m] = extrairMensagens(semClique);
  igual(m.de_anuncio, true);
  igual(m.ctwa_clid, null, 'nao pode inventar clique');
  igual(m.sem_ctwa, true, 'a ausencia precisa ficar registrada');
});

teste('conversa organica nao ganha atribuicao inventada', () => {
  const organica = {
    entry: [{ id: 'W1', changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: '5538911112222', profile: { name: 'Passante' } }],
      messages: [{ from: '5538911112222', id: 'wamid.ORG', type: 'text', text: { body: 'oi' } }],
    } }] }],
  };
  const [m] = extrairMensagens(organica);
  igual(m.de_anuncio, false);
  igual(m.ctwa_clid, null);
  igual(m.sem_ctwa, false, 'organica nao e "anuncio sem clique"; e outra coisa');
});

teste('a assinatura e conferida sobre os BYTES, em tempo constante', () => {
  const segredo = 'segredo-do-app';
  const bruto = JSON.stringify(WEBHOOK_CTWA);
  const boa = 'sha256=' + createHmac('sha256', segredo).update(Buffer.from(bruto, 'utf8')).digest('hex');

  igual(validarAssinatura(bruto, boa, segredo).valida, true);
  igual(validarAssinatura(bruto, boa, 'outro-segredo').valida, false);
  igual(validarAssinatura(bruto + ' ', boa, segredo).valida, false, 'um byte a mais invalida');
  igual(validarAssinatura(bruto, 'sha256=00', segredo).motivo, 'assinatura_invalida');
  igual(validarAssinatura(bruto, null, segredo).motivo, 'sem_assinatura');

  // Sem segredo configurado a porta fica FECHADA. O contrario funciona em
  // desenvolvimento, vai para producao sem a variavel e vira endpoint publico
  // de escrita.
  igual(validarAssinatura(bruto, boa, null).valida, false);
  igual(validarAssinatura(bruto, boa, null).motivo, 'sem_segredo');

  // O erro classico: assinar o objeto reserializado em vez dos bytes.
  const reserializado = JSON.stringify(JSON.parse(bruto.replace('{"object"', '{ "object"')));
  const daReserializacao = 'sha256='
    + createHmac('sha256', segredo).update(reserializado).digest('hex');
  verdadeiro(daReserializacao !== boa || reserializado === bruto,
    'reserializar muda os bytes — por isso o HMAC tem de ser sobre o bruto');
});

teste('o desafio do webhook so responde com o token certo', () => {
  const p = { 'hub.mode': 'subscribe', 'hub.verify_token': 'certo', 'hub.challenge': '9988' };
  igual(responderDesafio(p, 'certo').corpo, '9988');
  igual(responderDesafio(p, 'errado').ok, false);
  igual(responderDesafio(p, null).ok, false, 'sem token esperado nao pode passar');
  igual(responderDesafio({ ...p, 'hub.mode': 'unsubscribe' }, 'certo').ok, false);
});

teste('Schedule e Opportunity NAO existem na lista de Business Messaging', () => {
  // Sao os nomes naturais para "reuniao marcada" e "oportunidade criada", e
  // nao estao na lista aceita. Mandar assim vira evento customizado, que pode
  // ser aceito e nao fica elegivel para otimizacao de campanha CTWA.
  verdadeiro(!EVENTOS_BM.has('Schedule'));
  verdadeiro(!EVENTOS_BM.has('Opportunity'));
  verdadeiro(!EVENTOS_BM.has('Lead'), 'em BM o nome e QualifiedLead/LeadSubmitted');

  igual(eventoBM('reuniao_marcada').nome, 'QualifiedLead');
  igual(eventoBM('reuniao_marcada').estagio, 'schedule');
  igual(eventoBM('oportunidade_criada').nome, 'QualifiedLead');
  igual(eventoBM('oportunidade_criada').estagio, 'opportunity');
  igual(eventoBM('venda').nome, 'Purchase');

  // Tres etapas viram QualifiedLead; so o funnel_stage distingue.
  const nomes = new Set(['lead_qualificado', 'reuniao_marcada', 'oportunidade_criada']
    .map((k) => eventoBM(k).nome));
  igual(nomes.size, 1);
  const estagios = new Set(['lead_qualificado', 'reuniao_marcada', 'oportunidade_criada']
    .map((k) => eventoBM(k).estagio));
  igual(estagios.size, 3, 'sem funnel_stage as tres etapas ficariam indistinguiveis');
});

teste('o payload de mensageria usa ctwa_clid e WABA em texto limpo', () => {
  const r = montarMetaBusinessMessaging({
    evento: 'lead_qualificado',
    ctwaClid: 'AR_CLIQUE_001',
    wabaId: 'WABA_123',
    ocorridoEm: new Date().toISOString(),
    idempotencyKey: 'prod:lead-1:qualified',
    leadId: 'lead-1',
    destino: { identificador: 'DATASET_9' },
  });
  igual(r.erro, null);
  const ev = r.corpo.data[0];

  igual(ev.action_source, 'business_messaging');
  igual(ev.messaging_channel, 'whatsapp');
  igual(ev.event_name, 'QualifiedLead');
  igual(ev.custom_data.funnel_stage, 'qualified');

  // NAO hasheados: sao identificadores de clique e de ativo, nao dado pessoal.
  // Hashear faz o evento ser aceito e nunca casar com anuncio nenhum.
  igual(ev.user_data.ctwa_clid, 'AR_CLIQUE_001');
  igual(ev.user_data.whatsapp_business_account_id, 'WABA_123');
  igual(ev.user_data.ctwa_clid.length, 'AR_CLIQUE_001'.length, 'nao pode virar hash de 64 chars');

  // Nao ha navegador nesta rota: inventar fbc/fbp seria inventar jornada.
  igual(ev.user_data.fbc, undefined);
  igual(ev.user_data.fbp, undefined);
  igual(ev.event_source_url, undefined, 'mensageria nao tem URL de origem');

  verdadeiro(r.endpoint.includes('DATASET_9'));
});

teste('mensageria sem ctwa_clid nao monta payload, e diz por que', () => {
  const r = montarMetaBusinessMessaging({
    evento: 'venda', ctwaClid: null, wabaId: 'WABA_123',
    ocorridoEm: new Date().toISOString(), idempotencyKey: 'x',
  });
  igual(r.corpo, null);
  igual(r.erro, 'sem_ctwa_clid');

  igual(montarMetaBusinessMessaging({
    evento: 'venda', ctwaClid: 'A', wabaId: null,
    ocorridoEm: new Date().toISOString(), idempotencyKey: 'x',
  }).erro, 'sem_waba_id');
});

teste('a venda em mensageria leva valor, moeda e order id', () => {
  const r = montarMetaBusinessMessaging({
    evento: 'venda', ctwaClid: 'AR_1', wabaId: 'W_1',
    ocorridoEm: new Date().toISOString(), valorCentavos: 1250000, moeda: 'BRL',
    idempotencyKey: 'prod:purchase:OS-91', pedidoId: 'OS-91',
  });
  const ev = r.corpo.data[0];
  igual(ev.event_name, 'Purchase');
  igual(ev.custom_data.value, 12500);
  igual(ev.custom_data.currency, 'BRL');
  igual(ev.custom_data.order_id, 'OS-91');
});

teste('event_time e Unix em SEGUNDOS, nunca milissegundos', () => {
  const quando = '2026-09-03T12:00:00.000Z';
  const r = montarMetaBusinessMessaging({
    evento: 'lead_qualificado', ctwaClid: 'A', wabaId: 'W',
    ocorridoEm: quando, idempotencyKey: 'k',
  });
  const t = r.corpo.data[0].event_time;
  igual(t, Math.floor(new Date(quando).getTime() / 1000));
  // Milissegundos passam pela validacao de tipo e caem milhares de anos no
  // futuro: o evento e descartado sem erro visivel.
  verdadeiro(t < 1e11, 'ficou em milissegundos');
});

teste('a janela de 7 dias e barrada ANTES de chamar a Meta', () => {
  const agoraMs = Date.parse('2026-09-03T12:00:00Z');
  const dias = (n) => new Date(agoraMs - n * 86400000).toISOString();

  igual(dentroDaJanela(dias(1), agoraMs).dentro, true);
  igual(dentroDaJanela(dias(6.9), agoraMs).dentro, true);
  igual(dentroDaJanela(dias(8), agoraMs).dentro, false);
  igual(dentroDaJanela(dias(8), agoraMs).motivo, 'fora_da_janela_de_7_dias');

  // Barrar aqui importa porque a fila tem retentativa: um evento velho que
  // falha vira tentativa infinita, e o motivo real fica escondido atras de um
  // erro generico de validacao.
  igual(dentroDaJanela(new Date(agoraMs + 86400000).toISOString(), agoraMs).motivo, 'data_no_futuro');
  igual(dentroDaJanela('nao e data', agoraMs).motivo, 'data_invalida');
});

teste('ctwa_clid conta como sinal e classifica como meta_ads', () => {
  const atr = extrairAtribuicao({ ctwa_clid: 'AR_CLIQUE_001' }, {});
  igual(atr.ctwa_clid, 'AR_CLIQUE_001');
  igual(inferirPlataforma(atr), 'meta_ads', 'clique de CTWA e anuncio pago da Meta');
  igual(temSinal(atr), true, 'sem isso o lead de CTWA passaria por "sem atribuicao"');
  igual(atr.fbc, null, 'nao ha fbclid nem navegador — fbc nao pode ser fabricado');
});

teste('o local da conversao manda no action_source, nao a origem do lead', () => {
  // A regra que mais se erra: o lead nasce no WhatsApp e a venda fecha na
  // loja. Rotular como business_messaging porque o lead veio do WhatsApp e
  // reportar mentira para quem decide a verba.
  const cliente = { id: 'c1', nome: 'Joana Silva', telefone: '38988887777', email: 'j@ex.com', cidade: 'Januária' };
  const base = {
    cliente, evento: 'venda', valorCentavos: 500000, moeda: 'BRL',
    ocorridoEm: new Date().toISOString(), idempotencyKey: 'k1',
    destino: { identificador: 'DS' },
  };

  const noChat = montarMetaCapi({ ...base, atribuicao: { ctwa_clid: 'AR_9', waba_id: 'W_9' } });
  igual(noChat.corpo.data[0].action_source, 'business_messaging');

  const naLoja = montarMetaCapi({
    ...base,
    atribuicao: { ctwa_clid: 'AR_9', waba_id: 'W_9' },
    localConversao: 'physical_store',
  });
  igual(naLoja.corpo.data[0].action_source, 'physical_store',
    'o lead veio do WhatsApp, mas a venda foi na loja');
  igual(naLoja.corpo.data[0].messaging_channel, undefined);
  verdadeiro(naLoja.corpo.data[0].user_data.ph, 'fora da mensageria o telefone hasheado volta a valer');

  const porTelefone = montarMetaCapi({ ...base, atribuicao: { fbclid: 'IwAR9', fbc: 'fb.1.100.IwAR9' }, localConversao: 'phone_call' });
  igual(porTelefone.corpo.data[0].action_source, 'phone_call');
  // fbc vale aqui: ele so existe porque houve uma visita web de verdade. O
  // proibido e fabricar onde visita nenhuma houve.
  igual(porTelefone.corpo.data[0].user_data.fbc, 'fb.1.100.IwAR9');
});

teste('429 e 400 sao opostos e nao podem cair no mesmo balde', () => {
  // 429 e "voce mandou rapido demais": o evento esta CERTO e a mesma tentativa,
  // mais tarde, funciona. 400 e "o evento esta errado": repetir produz o mesmo
  // 400 para sempre. Tratar os dois como 'falhou' joga fora conversao boa num
  // pico de trafego, ou repete lixo para sempre.
  igual(classificarResposta({ status: 429 }), 'limitado');
  igual(classificarResposta({ status: 400 }), 'falhou');
  igual(classificarResposta({ status: 401 }), 'sem_permissao');
  igual(classificarResposta({ status: 403 }), 'sem_permissao');
  igual(classificarResposta({ status: 200 }), 'enviado');
  igual(classificarResposta({ status: 503 }), 'desconhecido');
  igual(classificarResposta({ status: 0, erro: 'timeout' }), 'desconhecido');
});

teste('so o limite de taxa se repete sozinho', () => {
  igual(podeRepetirSozinho('limitado'), true);
  igual(podeRepetirSozinho('falhou'), false, '400 repetido produz o mesmo 400');
  igual(podeRepetirSozinho('sem_permissao'), false, 'token nao se conserta sozinho');

  // O caso que mais importa: resposta nunca chegou. A conversao PODE ter sido
  // registrada do outro lado, e repetir arrisca contar duas vezes — numero
  // inflado vira decisao de verba errada.
  igual(podeRepetirSozinho('desconhecido'), false, 'ambiguidade nunca se repete sozinha');
  igual(podeRepetirSozinho('enviado'), false);
});

teste('a espera cresce e tem jitter', () => {
  const amostras = [0, 1, 2, 3, 8].map((t) => esperaDeRetentativa(t));
  verdadeiro(amostras.every((ms) => ms >= 2500 && ms <= 300000), 'espera fora da faixa');
  verdadeiro(amostras[3] > amostras[0], 'a espera precisa crescer');
  verdadeiro(esperaDeRetentativa(20) <= 300000, 'tem de ter teto');

  // Sem jitter, tudo o que ficou represado volta no mesmo instante e leva 429
  // de novo, em coro.
  const repetidas = new Set(Array.from({ length: 12 }, () => esperaDeRetentativa(3)));
  verdadeiro(repetidas.size > 1, 'sem jitter as retentativas voltam em coro');
});

teste('o action_source declarado fica em coluna, nao so no blob', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const esc = b.para(emp.id);

  // Faz uma oportunidade chegar em 'ganho' e roda a cadeia inteira, em vez de
  // depender do que outro teste deixou para tras.
  const cli = esc.uma('select * from clientes where {ESCOPO} and consentimento_lgpd = 1 limit 1');
  const opId = novoId();
  esc.inserir('oportunidades', {
    id: opId, cliente_id: cli.id, titulo: 'Auditoria de action_source', etapa: 'ganho',
    valor_centavos: 250000, criado_em: agora(), atualizado_em: agora(),
  });
  registrarMudancaDeEtapa(esc, {
    oportunidade: esc.uma('select * from oportunidades where {ESCOPO} and id = ?', opId),
    etapaAnterior: 'negociacao', ator: 'teste',
  });
  drenarEventos(b, esc);
  despacharConversoes(b, esc, emp, { ator: 'teste' });

  const linhas = esc.todas(
    "select action_source, payload from conversoes where {ESCOPO} and oportunidade_id = ?", opId,
  );
  verdadeiro(linhas.length > 0, 'nenhuma conversao foi despachada');

  for (const l of linhas) {
    verdadeiro(l.action_source, 'action_source vazio — a auditoria nao teria o que responder');
    // Tem de bater com o que de fato foi montado no payload.
    const p = JSON.parse(l.payload);
    const noPayload = p?.corpo?.data?.[0]?.action_source ?? null;
    if (noPayload) {
      igual(l.action_source, noPayload, 'a coluna divergiu do que foi enviado');
    }
  }
});

/* ── Registro de propriedades e campos personalizados ─────────────────────── */

const PROPS_FT = [
  { origem: 'sistema', chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: 1 },
  { origem: 'custom', chave: 'metragem', rotulo: 'Metragem', tipo: 'numero', obrigatorio: 0 },
  {
    origem: 'custom', chave: 'superficie', rotulo: 'Superficie', tipo: 'multi_selecao',
    obrigatorio: 0, opcoes: ['alvenaria', 'madeira', 'externa'],
  },
  {
    origem: 'custom', chave: 'urgencia', rotulo: 'Urgencia', tipo: 'selecao',
    obrigatorio: 0, opcoes: ['baixa', 'alta'],
  },
  { origem: 'custom', chave: 'visita', rotulo: 'Data da visita', tipo: 'data', obrigatorio: 0 },
  { origem: 'custom', chave: 'orcado', rotulo: 'Valor orcado', tipo: 'moeda', obrigatorio: 0 },
];

teste('chave de campo tem de sobreviver a URL, coluna e JSON', () => {
  igual(validarChave('metragem_obra'), null);
  igual(validarChave('m2'), null);

  verdadeiro(validarChave(''), 'vazia tem de ser recusada');
  verdadeiro(validarChave('Metragem'), 'maiuscula recusada');
  verdadeiro(validarChave('preco (R$)'), 'espaco e simbolo recusados');
  verdadeiro(validarChave('2metros'), 'comecar por numero recusado');
  verdadeiro(validarChave('a'.repeat(60)), 'longa demais recusada');

  // O que colidiria com coluna real e o pior caso: gravaria no JSON uma chave
  // que a tela leria da coluna, e os dois valores divergiriam para sempre.
  verdadeiro(validarChave('nome'), 'chave de coluna real recusada');
  verdadeiro(validarChave('telefone'), 'chave de coluna real recusada');
  verdadeiro(validarChave('campos'), 'a propria coluna JSON recusada');
  verdadeiro(validarChave('empresa_id'), 'coluna de escopo recusada');
});

teste('valor invalido nao entra, e o erro diz qual campo e por que', () => {
  const r = validarCampos(PROPS_FT, { metragem: 'nao e numero' });
  igual(r.valido, false);
  verdadeiro(r.erros[0].includes('Metragem'), 'o erro precisa nomear o campo');
  verdadeiro(/n[uú]mero/.test(r.erros[0]), 'e dizer o que esta errado');
  igual(r.limpo.metragem, undefined, 'valor invalido nao pode chegar ao limpo');
});

teste('opcao fora da lista e recusada, em escolha unica e multipla', () => {
  igual(validarCampos(PROPS_FT, { urgencia: 'media' }).valido, false);
  igual(validarCampos(PROPS_FT, { urgencia: 'alta' }).valido, true);

  const m = validarCampos(PROPS_FT, { superficie: ['alvenaria', 'marte'] });
  igual(m.valido, false);
  verdadeiro(m.erros[0].includes('marte'), 'o erro precisa dizer QUAL valor sobrou');

  igual(validarCampos(PROPS_FT, { superficie: ['alvenaria', 'externa'] }).valido, true);
});

teste('chave desconhecida e DESCARTADA e reportada, nunca gravada', () => {
  // Gravar em silencio dado que nenhuma tela mostra e criar um vazamento
  // invisivel: ninguem sabe que esta la, ninguem apaga, e ele sai no export.
  const r = validarCampos(PROPS_FT, { metragem: 120, chave_inventada: 'lixo' });
  igual(r.limpo.metragem, 120, 'o campo valido tem de passar');
  igual(r.limpo.chave_inventada, undefined, 'a chave desconhecida NAO pode ser gravada');
  verdadeiro(r.erros.some((e) => e.includes('chave_inventada')), 'e precisa ser reportada');
});

teste('campo obrigatorio vazio bloqueia', () => {
  const props = [{ origem: 'custom', chave: 'obr', rotulo: 'Obrigatorio', tipo: 'texto', obrigatorio: 1 }];
  igual(validarCampos(props, {}).valido, false);
  igual(validarCampos(props, { obr: '' }).valido, false);
  igual(validarCampos(props, { obr: 'algo' }).valido, true);
});

teste('cada tipo converte para a forma que vai ao banco', () => {
  const r = validarCampos(PROPS_FT, {
    metragem: '287,5',
    orcado: '1250.90',
    visita: '2026-09-15T18:30:00.000Z',
    superficie: 'alvenaria, externa',
  });
  igual(r.valido, true);
  igual(r.limpo.metragem, 287.5, 'virgula decimal aceita — e como se digita aqui');
  igual(r.limpo.orcado, 1250.9);
  // Campo de data nao carrega fuso: gravar hora faz o mesmo dia aparecer
  // diferente conforme quem le.
  igual(r.limpo.visita, '2026-09-15', 'data guarda so o dia');
  igual(r.limpo.superficie.join('|'), 'alvenaria|externa', 'texto separado por virgula vira lista');
});

teste('campo do sistema nao e validado como personalizado', () => {
  // `nome` e coluna real. Mandar por engano no bloco de campos personalizados
  // tem de ser recusado, senao gravaria uma copia divergente dentro do JSON.
  const r = validarCampos(PROPS_FT, { nome: 'Outro Nome' });
  igual(r.limpo.nome, undefined, 'coluna real nao pode entrar no JSON');
  verdadeiro(r.erros.some((e) => e.includes('nome')));
});

teste('formatar devolve texto legivel, e nunca vazio', () => {
  const moeda = { tipo: 'moeda' };
  const data = { tipo: 'data' };
  const bool = { tipo: 'booleano' };
  const multi = { tipo: 'multi_selecao' };

  verdadeiro(formatar(moeda, 1250.9).includes('1.250,90'), 'moeda em pt-BR');
  igual(formatar(data, '2026-09-15'), '15/09/2026');
  igual(formatar(bool, true), 'Sim');
  igual(formatar(bool, false), 'Não');
  igual(formatar(multi, ['a', 'b']), 'a, b');

  // Vazio vira travessao, e nao "null" nem "undefined" na tela.
  igual(formatar(moeda, null), '—');
  igual(formatar({ tipo: 'texto' }, ''), '—');
  igual(formatar({ tipo: 'texto' }, undefined), '—');
});

teste('a carga semeia o registro POR EMPRESA, com o que cada negocio precisa', () => {
  const esperado = {
    MP: ['tipo_bomba', 'frota_placas'],
    AF: ['maturacao', 'entrega_dia'],
    FT: ['tipo_superficie', 'metragem'],
  };

  for (const cod of ['MP', 'AF', 'FT']) {
    const b = fed.abrir(cod);
    const emp = b.sistema().prepare('select id from empresas limit 1').get();
    const esc = b.para(emp.id);
    const props = esc.todas('select origem, chave, tipo from propriedades where {ESCOPO}');

    const sistema = props.filter((p) => p.origem === 'sistema').map((p) => p.chave);
    igual(sistema.length, CAMPOS_SISTEMA.length, `${cod}: campos de sistema`);
    verdadeiro(sistema.includes('nome') && sistema.includes('perfil'), `${cod}: colunas reais descritas`);

    const custom = props.filter((p) => p.origem === 'custom').map((p) => p.chave).sort();
    igual(custom.join(','), esperado[cod].slice().sort().join(','), `${cod}: campos proprios`);

    // O ponto de ter registro por empresa: os catalogos nao se misturam.
    for (const outro of Object.keys(esperado).filter((x) => x !== cod)) {
      for (const chave of esperado[outro]) {
        verdadeiro(!custom.includes(chave),
          `${cod} nao pode ter "${chave}", que e da ${outro}`);
      }
    }
  }
});

teste('garantirCamposSistema e idempotente', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const esc = b.para(emp.id);

  const antes = esc.contar('propriedades', "and origem = 'sistema'");
  garantirCamposSistema(esc);
  garantirCamposSistema(esc);
  igual(esc.contar('propriedades', "and origem = 'sistema'"), antes,
    'rodar de novo nao pode duplicar');
});

/* ── A central e PROJECAO, nao acumulador ────────────────────────────────── */

teste('cliente removido da origem sai da central', () => {
  const central = fed.abrirCentral();
  const sis = central.sistema();

  sincronizarCentral(fed, { codigos: ['MP'] });
  const antes = sis.prepare("select count(*) n from leads_consolidados where instancia = 'MP'").get().n;
  verdadeiro(antes > 0, 'a sincronizacao precisa ter projetado alguma coisa');

  // Apaga um cliente NA ORIGEM.
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const esc = b.para(emp.id);
  const alvo = esc.uma('select id, nome from clientes where {ESCOPO} limit 1');
  esc.remover('clientes', alvo.id);

  const r = sincronizarCentral(fed, { codigos: ['MP'] });

  const depois = sis.prepare("select count(*) n from leads_consolidados where instancia = 'MP'").get().n;
  igual(depois, antes - 1, 'a projecao do cliente apagado tinha de sair');
  igual(r.orfasRemovidas, 1, 'e a remocao tem de ser reportada');

  const sobrou = sis.prepare('select count(*) n from leads_consolidados where cliente_id = ?').get(alvo.id).n;
  igual(sobrou, 0, `a linha de "${alvo.nome}" ficou orfa na central`);
});

teste('sincronizar de novo, sem mudanca, nao remove nada', () => {
  const r1 = sincronizarCentral(fed, { codigos: ['AF'] });
  const r2 = sincronizarCentral(fed, { codigos: ['AF'] });
  igual(r2.orfasRemovidas, 0, 'execucao sem mudanca nao pode remover');
  igual(r2.linhas, r1.linhas, 'e o total tem de bater');
});

teste('sincronizar uma instancia nao mexe nas outras', () => {
  const sis = fed.abrirCentral().sistema();
  sincronizarCentral(fed);
  const antesFT = sis.prepare("select count(*) n from leads_consolidados where instancia = 'FT'").get().n;

  sincronizarCentral(fed, { codigos: ['AF'] });

  igual(sis.prepare("select count(*) n from leads_consolidados where instancia = 'FT'").get().n,
    antesFT, 'sincronizar a AF nao pode encostar na FT');
});

teste('lead em triagem sobrevive a sincronizacao', () => {
  // Ele chegou pela porta de captacao e ainda nao virou cliente de instancia
  // nenhuma. Uma remocao que olhasse so para "nao esta na origem" o apagaria,
  // destruindo a fila de quem ainda nao foi atendido.
  const central = fed.abrirCentral();
  const sis = central.sistema();

  sis.prepare(
    `insert into leads_consolidados (id, instancia, empresa_nome, cliente_id, nome, fonte,
                                     valor_centavos, consentimento, criado_em, sincronizado_em)
     values (?,?,?,?,?,?,?,?,?,?)`,
  ).run(novoId(), 'MP', 'Minas Peças', null, 'Lead sem dono', 'site',
    0, 0, agora(), '1970-01-01T00:00:00.000Z');

  sincronizarCentral(fed, { codigos: ['MP'] });

  const vivo = sis.prepare(
    "select count(*) n from leads_consolidados where cliente_id is null and nome = 'Lead sem dono'",
  ).get().n;
  igual(vivo, 1, 'lead em triagem nao pode ser apagado pela projecao');
});

teste('instancia fora do ar NAO apaga as projecoes dela', () => {
  // O caso perigoso: se a leitura falhar e a remocao rodasse assim mesmo, uma
  // indisponibilidade de minutos viraria perda de dado permanente.
  const sis = fed.abrirCentral().sistema();
  sincronizarCentral(fed, { codigos: ['FT'] });
  const antes = sis.prepare("select count(*) n from leads_consolidados where instancia = 'FT'").get().n;
  verdadeiro(antes > 0);

  const r = sincronizarCentral(fed, { codigos: ['INSTANCIA_QUE_NAO_EXISTE'] });
  verdadeiro(r.porInstancia[0].erro, 'a instancia inexistente tem de reportar erro');

  igual(sis.prepare("select count(*) n from leads_consolidados where instancia = 'FT'").get().n,
    antes, 'falha numa instancia nao pode apagar projecao de ninguem');
});

/* -- Busca global --------------------------------------------------------- */

const buscaEm = (cod, email, q) => ROTAS['GET /api/buscar'](
  fed,
  {
    headers: {
      authorization: `Bearer ${assinar({ sub: email, exp: Date.now() + 3_600_000 })}`,
      'x-instancia': cod,
    },
  },
  {}, null,
  new URL(`http://x/api/buscar?q=${encodeURIComponent(q)}`),
);

teste('digitar sem acento acha quem tem acento, e vice-versa', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();

  // O nome vem do banco, e nao escrito aqui: outro teste deste arquivo apaga um
  // cliente da MP de proposito, e um nome fixo tornaria este teste refem da
  // ordem de execucao.
  const cli = e.uma(
    'select nome from clientes where {ESCOPO} and lower(nome) <> sem_acento(nome) limit 1',
  );
  verdadeiro(cli, 'a carga precisa ter algum nome acentuado');

  const cru = cli.nome.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const pedaco = cru.split(' ').find((w) => w.length >= 4);

  const achou = (q) => buscaEm('MP', email, q).dados.some((x) => x.titulo === cli.nome);
  verdadeiro(achou(pedaco.toLowerCase()), `sem acento, "${pedaco}" nao achou ${cli.nome}`);
  verdadeiro(achou(cli.nome.split(' ')[0]), 'com acento tinha de achar igual');
});

teste('acha por telefone e por placa, que e como a pessoa identifica no balcao', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();

  const cli = e.uma("select nome, telefone from clientes where {ESCOPO} and telefone is not null limit 1");
  // Digitado com pontuacao, como ninguem guarda numero: (38) 99811-2233.
  const digitado = `(${cli.telefone.slice(2, 4)}) ${cli.telefone.slice(4, 9)}-${cli.telefone.slice(9)}`;
  igual(buscaEm('MP', email, digitado).dados.some((x) => x.titulo === cli.nome), true,
    `telefone digitado como "${digitado}" tinha de achar ${cli.nome}`);

  const v = e.uma('select placa from veiculos where {ESCOPO} limit 1');
  const comTraco = `${v.placa.slice(0, 3)}-${v.placa.slice(3)}`;
  igual(buscaEm('MP', email, comTraco).dados.some((x) => x.tipo === 'veiculo'), true,
    'placa com traco tinha de achar o veiculo');
});

teste('a busca NAO atravessa empresas — e diz onde mais procurar', () => {
  const b = fed.abrir('MP');
  // Soberano de proposito: e quem tem acesso as tres, e portanto o unico a
  // quem faz sentido oferecer a travessia.
  const { email } = b.sistema()
    .prepare("select email from usuarios where papel = 'soberano' limit 1").get();

  // "queijo" existe na Agrofort e nao na Minas Pecas. Se aparecesse aqui, o
  // isolamento por banco teria virado decoracao.
  const aqui = buscaEm('MP', email, 'queijo');
  igual(aqui.dados.length, 0, 'dado de outra empresa vazou para a busca');

  // O vazio nao pode ser um beco: a resposta carrega as outras instancias a
  // que ESTA pessoa tem acesso, e a travessia fica sendo escolha dela.
  const nomes = (aqui.meta.outras ?? []).map((o) => o.instancia).sort().join(',');
  igual(nomes, 'AF,FT');
  igual(buscaEm('AF', email, 'queijo').dados.length > 0, true, 'e na Agrofort tinha de achar');
});

teste('quem so tem uma instancia nao recebe convite para atravessar', () => {
  // O operador da Minas Pecas so existe na Minas Pecas.
  const b = fed.abrir('MP');
  const so = b.sistema()
    .prepare("select email from usuarios where papel = 'operador' limit 1").get();
  const r = buscaEm('MP', so.email, 'zzzz');
  igual(r.dados.length, 0);
  igual((r.meta.outras ?? []).length, 0, 'oferecer empresa sem acesso seria mentir');
});

teste('o nome exato vence o registro que so contem o termo', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();
  const cli = b.para(emp.id).uma('select nome from clientes where {ESCOPO} limit 1');

  const r = buscaEm('MP', email, cli.nome);
  igual(r.dados[0].tipo, 'cliente', 'o nome exato tinha de vir primeiro');
  igual(r.dados[0].titulo, cli.nome);
  igual(r.dados[0].ponto, 3, 'igualdade exata vale mais que prefixo');
});

teste('termo curto demais nao vai ao banco', () => {
  const b = fed.abrir('MP');
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();
  const r = buscaEm('MP', email, 'a');
  igual(r.dados.length, 0);
  igual(r.meta.curto, true, 'a tela precisa saber que foi curto, e nao vazio');
});

teste('todo resultado carrega para onde ir — nao existe achado sem destino', () => {
  const b = fed.abrir('MP');
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();
  const r = buscaEm('MP', email, 'a');
  const todos = ['bomba', 'os-0', 'bico'].flatMap((q) => buscaEm('MP', email, q).dados);
  verdadeiro(todos.length > 0);
  for (const x of todos) {
    verdadeiro(x.rota && !x.rota.startsWith('/'), `rota invalida em ${x.tipo}: ${x.rota}`);
    verdadeiro(x.titulo, `resultado sem titulo em ${x.tipo}`);
    // A rota tem de apontar para uma tela que existe.
    const tela = x.rota.split('?')[0];
    verdadeiro(['clientes', 'ordens', 'pedidos', 'pipeline', 'catalogo'].includes(tela),
      `tela desconhecida: ${tela}`);
  }
  igual(r.dados.length, 0);
});

teste('a busca e leitura — quem so le tambem pode procurar', () => {
  igual(negarPorPapel('GET /api/buscar', 'leitura'), null, 'busca e GET, e leitura le');
  igual(negarPorPapel('GET /api/buscar', 'operador'), null);
});

/* -- Adiar um contato: "esse eu falo amanha" ------------------------------ */

// Sessao assinada, para chamar a rota como o navegador chama. Sem `rotaChave`
// nao ha recusa por papel — quem chama de dentro ja passou por ela.
const sessaoDe = (cod, email) => ({
  headers: {
    authorization: `Bearer ${assinar({ sub: email, exp: Date.now() + 3_600_000 })}`,
    'x-instancia': cod,
  },
});
const contaLiberados = (r) => r.filter((f) => f.decisao.permitido).length;

teste('adiar tira o item da fila, e desfazer devolve', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();

  const antes = montarRegua(b, e, emp);
  const liberados = antes.filter((f) => f.decisao.permitido);
  verdadeiro(liberados.length > 1, 'sem fila nao da para testar adiamento');
  const alvo = liberados[0];

  const r = ROTAS['POST /api/regua/adiar'](fed, sessaoDe('MP', email), {}, {
    clienteId: alvo.cliente.id, gatilho: alvo.gatilho.chave, dias: 3,
  });
  igual(r.ok, true);
  igual(r.dados.cliente, alvo.cliente.nome, 'a resposta tem de dizer QUEM foi adiado');

  const depois = montarRegua(b, e, emp);
  igual(contaLiberados(depois), liberados.length - 1, 'o item tinha de sair da fila');

  // A parte que importa: sair da fila sem virar contagem seria uma fila que
  // encolhe sozinha, e ninguem descobre por que.
  igual(depois.adiados.length, 1, 'o adiado tinha de aparecer contado do outro lado');
  igual(depois.adiados[0].cliente.id, alvo.cliente.id);
  verdadeiro(depois.adiados[0].ate, 'sem a data, ninguem sabe quando volta');
  verdadeiro(depois.adiados[0].id, 'sem o id, nao ha como desfazer');

  ROTAS['POST /api/regua/adiar/:id/desfazer'](
    fed, sessaoDe('MP', email), { id: depois.adiados[0].id },
  );
  const volta = montarRegua(b, e, emp);
  igual(contaLiberados(volta), liberados.length, 'desfazer tinha de devolver o item');
  igual(volta.adiados.length, 0);
});

teste('o adiamento e por (cliente, gatilho) — nao silencia o cliente inteiro', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();

  const antes = contaLiberados(montarRegua(b, e, emp));
  const alvo = montarRegua(b, e, emp).find((f) => f.decisao.permitido);

  // Mesmo cliente, OUTRO gatilho: adiar a revisao de um caminhao nao pode
  // silenciar a cobranca de orcamento do mesmo cliente. Sao conversas
  // diferentes, e uma chave so por cliente juntaria as duas.
  const r = ROTAS['POST /api/regua/adiar'](fed, sessaoDe('MP', email), {}, {
    clienteId: alvo.cliente.id, gatilho: 'gatilho_que_nao_esta_na_fila', dias: 5,
  });
  igual(contaLiberados(montarRegua(b, e, emp)), antes,
    'adiar outro gatilho nao podia mexer neste');

  ROTAS['POST /api/regua/adiar/:id/desfazer'](fed, sessaoDe('MP', email), { id: r.dados.id });
});

teste('adiar de novo SUBSTITUI — desfazer nao pode revelar outro embaixo', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();
  const alvo = montarRegua(b, e, emp).find((f) => f.decisao.permitido);
  const chave = { clienteId: alvo.cliente.id, gatilho: alvo.gatilho.chave };

  ROTAS['POST /api/regua/adiar'](fed, sessaoDe('MP', email), {}, { ...chave, dias: 1 });
  const segundo = ROTAS['POST /api/regua/adiar'](fed, sessaoDe('MP', email), {}, { ...chave, dias: 30 });

  const vivos = e.todas(
    'select id from adiamentos where {ESCOPO} and cliente_id = ? and gatilho_chave = ? and desfeito_em is null',
    chave.clienteId, chave.gatilho,
  );
  igual(vivos.length, 1, 'empilhar adiamentos esconderia um atras do outro');
  igual(vivos[0].id, segundo.dados.id, 'o que vale e o ultimo');

  ROTAS['POST /api/regua/adiar/:id/desfazer'](fed, sessaoDe('MP', email), { id: segundo.dados.id });
  igual(montarRegua(b, e, emp).adiados.length, 0, 'um desfazer tinha de bastar');
});

teste('adiamento vencido volta sozinho — ninguem precisa lembrar de desfazer', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const e = b.para(emp.id);
  const antes = contaLiberados(montarRegua(b, e, emp));
  const alvo = montarRegua(b, e, emp).find((f) => f.decisao.permitido);

  const id = novoId();
  e.inserir('adiamentos', {
    id,
    cliente_id: alvo.cliente.id,
    gatilho_chave: alvo.gatilho.chave,
    ate: new Date(Date.now() - 3_600_000).toISOString(),
    motivo: null,
    criado_por: 'teste',
    criado_em: agora(),
  });
  const r = montarRegua(b, e, emp);
  igual(contaLiberados(r), antes, 'passada a data, o item volta por conta propria');
  igual(r.adiados.length, 0, 'e sai da contagem de adiados junto');
  e.remover('adiamentos', id);
});

teste('a rota recusa prazo fora da faixa e cliente de outra empresa', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema().prepare('select email from usuarios limit 1').get();
  const alvo = montarRegua(b, e, emp).find((f) => f.decisao.permitido);

  const recusa = (corpo, oque) => {
    try {
      ROTAS['POST /api/regua/adiar'](fed, sessaoDe('MP', email), {}, corpo);
      throw new Error(`aceitou ${oque}`);
    } catch (err) {
      verdadeiro(err instanceof ErroHttp, `${oque}: esperava ErroHttp, veio "${err.message}"`);
      return err;
    }
  };

  igual(recusa({ clienteId: alvo.cliente.id, gatilho: alvo.gatilho.chave, dias: 0 }, 'zero dia').status, 400);
  igual(recusa({ clienteId: alvo.cliente.id, gatilho: alvo.gatilho.chave, dias: 900 }, 'quase tres anos').status, 400);
  igual(recusa({ gatilho: alvo.gatilho.chave, dias: 1 }, 'pedido sem cliente').status, 400);

  // O escopo e a segunda barreira: um id valido NOUTRA empresa nao existe aqui.
  const outra = fed.abrir('AF');
  const empAF = outra.sistema().prepare('select id from empresas limit 1').get();
  const alheio = outra.para(empAF.id).uma('select id from clientes where {ESCOPO} limit 1');
  igual(recusa({ clienteId: alheio.id, gatilho: 'revisao', dias: 1 }, 'cliente de outra empresa').status, 404);
});

teste('adiar e trabalho de operador, e leitura nao adia nada', () => {
  igual(negarPorPapel('POST /api/regua/adiar', 'operador'), null);
  verdadeiro(negarPorPapel('POST /api/regua/adiar', 'leitura'), 'somente leitura nao grava');
  verdadeiro(negarPorPapel('POST /api/regua/adiar/:id/desfazer', 'leitura'));
});

teste('fila vazia por adiamento nao pode ser lida como "nao ha trabalho"', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const adiados = [{
    cliente: { id: 'x', nome: 'Fulano' },
    gatilho: { chave: 'revisao', nome: 'Revisao' },
    ate: new Date(Date.now() + 86_400_000).toISOString(),
    id: 'a1',
  }];

  const d = diagnosticarFilaVazia(e, { fila: [], adiados });
  igual(d.causa, 'tudo_adiado');
  igual(d.tranquilo, true, 'foi decisao de quem opera — nao e alarme');
  verdadeiro(d.texto.includes('adiados') || d.texto.includes('adiado'),
    'o texto precisa dizer que foi adiamento, e nao falta de trabalho');

  // Vence as outras causas: mandar mexer nos gatilhos seria mandar a pessoa
  // consertar o que nao esta quebrado.
  const ids = e.todas('select id from gatilhos where {ESCOPO}');
  ids.forEach((g) => e.atualizar('gatilhos', g.id, { ativo: 0 }));
  igual(diagnosticarFilaVazia(e, { fila: [], adiados }).causa, 'tudo_adiado',
    'a causa que o operador criou vence a que ele nao criou');
  ids.forEach((g) => e.atualizar('gatilhos', g.id, { ativo: 1 }));
});

/* -- Oficina: vida do veiculo --------------------------------------------- */

teste('a media vem do que o veiculo ANDOU, e nao do que foi digitado', () => {
  // 18.000 km em 6 meses.
  const leituras = [
    { km: 100000, medido_em: '2026-03-01T00:00:00Z' },
    { km: 118000, medido_em: '2026-09-01T00:00:00Z' },
  ];
  const m = mediaKmMes(leituras);
  verdadeiro(m > 2800 && m < 3100, `esperava ~2.980 km/mes, veio ${m}`);

  // Uma leitura so nao e historico: nao da para saber quanto andou.
  igual(mediaKmMes([leituras[0]]), null);

  // Duas leituras no mesmo dia tambem nao: o intervalo e de horas, e a conta
  // extrapolaria isso para o ano inteiro.
  igual(mediaKmMes([
    { km: 100000, medido_em: '2026-03-01T08:00:00Z' },
    { km: 100300, medido_em: '2026-03-01T18:00:00Z' },
  ]), null, 'intervalo curto demais nao vira media anual');
});

teste('o hodometro so anda para a frente', () => {
  igual(validarKm(120000, 100000).ok, true);
  igual(validarKm(90000, 100000).ok, false, 'km menor que o anterior e erro de digitacao');
  verdadeiro(validarKm(90000, 100000).motivo.includes('não anda para trás'),
    'e o motivo tem de explicar por que');
  igual(validarKm(-5, null).ok, false);
  igual(validarKm(9_000_000, null).ok, false, 'acima de 3 milhoes e digito a mais');
});

teste('o servico vence por km OU por tempo — o que chegar primeiro', () => {
  const base = Date.parse('2026-09-08T00:00:00Z');

  // Roda muito: o km chega antes do ano.
  const rodador = projetarServico(
    { intervalo_km: 10000, intervalo_meses: 12, ultimo_km: 100000, ultimo_em: '2026-06-01T00:00:00Z' },
    { kmHoje: 108000, mediaMes: 4000, refMs: base },
  );
  igual(rodador.causa, 'km', 'quem roda 4.000/mes chega aos 10.000 antes do ano');

  // Roda pouco: o fluido estraga por idade antes de o km chegar.
  const parado = projetarServico(
    { intervalo_km: 10000, intervalo_meses: 12, ultimo_km: 100000, ultimo_em: '2025-10-01T00:00:00Z' },
    { kmHoje: 101000, mediaMes: 150, refMs: base },
  );
  igual(parado.causa, 'tempo', 'caminhao parado vence por tempo, e nao por km');

  // Vencido aparece como vencido, e nao some da fila.
  const atrasado = projetarServico(
    { intervalo_km: 10000, ultimo_km: 100000 },
    { kmHoje: 115000, mediaMes: 3000, refMs: base },
  );
  igual(atrasado.vencido, true);
  verdadeiro(atrasado.dias < 0, `dias deveria ser negativo, veio ${atrasado.dias}`);
});

teste('sem media nao se inventa previsao', () => {
  const p = projetarServico(
    { intervalo_km: 10000, ultimo_km: 100000 },
    { kmHoje: 105000, mediaMes: null },
  );
  igual(p.dias, null, 'sem saber quanto roda, nao ha data');
  igual(p.porKm.faltamKm, 5000, 'mas o quanto falta em km continua sabido');
});

teste('km estimado estica a media desde a ultima leitura', () => {
  const base = Date.parse('2026-09-08T00:00:00Z');
  const km = kmEstimado(
    { km_ultima: 100000 },
    { km: 100000, medido_em: '2026-06-08T00:00:00Z' },
    3000, base,
  );
  verdadeiro(km > 108000 && km < 110000, `3 meses a 3.000 = ~109.000, veio ${km}`);
});

teste('o plano padrao cobre o que uma oficina diesel troca', () => {
  igual(PLANO_PADRAO.length, 9);
  const chaves = PLANO_PADRAO.map((p) => p.chave);
  for (const obrigatorio of ['oleo_motor', 'filtro_combustivel', 'teste_bicos', 'revisao_bomba']) {
    verdadeiro(chaves.includes(obrigatorio), `falta ${obrigatorio} no plano`);
  }
  // Todo servico tem pelo menos um criterio de vencimento.
  for (const p of PLANO_PADRAO) verdadeiro(p.km || p.meses, `${p.chave} nao vence nunca`);
});

/* -- Oficina: vistoria ---------------------------------------------------- */

teste('o check-list e guiado: todo item diz o que olhar', () => {
  const itens = itensDoChecklist();
  igual(itens.length, TOTAL_ITENS);
  verdadeiro(TOTAL_ITENS >= 80, `esperava um check-list completo, veio ${TOTAL_ITENS} itens`);

  for (const i of itens) {
    verdadeiro(i.dica && i.dica.length > 20,
      `"${i.nome}" sem dica: um check-list que so lista nomes e preenchido no automatico`);
    verdadeiro(i.chave && i.nome && i.grupo);
    verdadeiro(NIVEIS[i.nivel], `"${i.nome}" sem nivel de revisao`);
  }
  // Chave repetida quebraria a gravacao do item.
  igual(new Set(itens.map((i) => i.chave)).size, itens.length, 'ha chave repetida');
});

teste('os grupos sao a ordem do TRABALHO, e nao a dos sistemas', () => {
  /*
   * Esta e a mudanca que veio das folhas da rede. Agrupar por sistema (freios,
   * suspensao, motor) e como se PENSA num carro; nao e como se trabalha nele.
   * O tecnico levanta o elevador uma vez e confere tudo naquela altura.
   */
  for (const g of CHECKLIST) {
    verdadeiro(g.posicao && g.posicao.length > 8,
      `grupo "${g.grupo}" nao diz onde o veiculo tem de estar`);
  }
  const ordem = CHECKLIST.map((g) => g.grupo);
  const iRecepcao = ordem.findIndex((g) => /Recep/.test(g));
  const iMeia = ordem.findIndex((g) => /Meia altura/.test(g));
  const iTotal = ordem.findIndex((g) => /Altura total/.test(g));
  const iAbaixado = ordem.findIndex((g) => /abaixado/.test(g));
  const iRodagem = ordem.findIndex((g) => /Apos|Após/.test(g));

  igual(iRecepcao, 0, 'a recepcao com o cliente vem primeiro');
  verdadeiro(iMeia < iTotal, 'meia altura antes da altura total: o elevador sobe uma vez');
  verdadeiro(iTotal < iAbaixado, 'o carro desce depois de subir');
  igual(iRodagem, ordem.length - 1, 'o teste de rodagem e o ultimo');
});

teste('os quatro pneus sao medidos um a um', () => {
  // A folha da rede tem quatro caixas, uma por roda. "Dianteiro" e "traseiro"
  // escondia o pneu unico que esta gasto — e e sempre um so.
  const rodas = itensDoChecklist().filter((i) => /^sulco_/.test(i.chave));
  igual(rodas.length, 4, 'quatro rodas, quatro medidas');
  for (const r of rodas) {
    igual(r.medida.unidade, 'mm');
    igual(r.medida.min, 1.6, 'o minimo legal e o mesmo para todas');
  }
});

teste('a revisao tem tres profundidades, e a menor cabe dentro da maior', () => {
  igual(Object.keys(NIVEIS).length, 3);
  const b = TAMANHO_POR_NIVEL.bronze;
  const p = TAMANHO_POR_NIVEL.prata;
  const o = TAMANHO_POR_NIVEL.ouro;
  verdadeiro(b < p && p < o, `bronze ${b} < prata ${p} < ouro ${o}`);
  igual(o, TOTAL_ITENS, 'ouro e o catalogo inteiro');

  // Todo item de bronze aparece em prata e em ouro: os niveis sao concentricos,
  // e nao tres listas diferentes que um dia divergem.
  const chavesB = new Set(itensDoChecklist('bronze').map((i) => i.chave));
  const chavesP = new Set(itensDoChecklist('prata').map((i) => i.chave));
  for (const c of chavesB) verdadeiro(chavesP.has(c), `${c} sumiu do prata`);

  // Segurança e fluido estao no bronze: sao o que nao pode faltar para rodar.
  for (const obrigatorio of ['cintos', 'freio_estacionamento', 'oleo_nivel', 'sulco_de']) {
    verdadeiro(chavesB.has(obrigatorio), `${obrigatorio} tinha de estar no bronze`);
  }

  // A numeracao nao pula: numa revisao bronze os itens vao de 0 a 63 sem
  // buracos, e nao com os saltos dos itens de ouro que nao entraram.
  igual(itensDoChecklist('bronze').every((i, n) => i.posicao === n), true);
  igual(catalogoDoNivel('bronze').every((g) => g.itens.length > 0), true,
    'grupo vazio nao pode aparecer como aba');
});

teste('critico exige foto — e conforme, so onde a foto e o registro', () => {
  const pneu = itensDoChecklist().find((i) => i.chave === 'sulco_de');
  igual(exigeFoto(pneu, 'critico'), true, 'nao se marca vermelho sem mostrar');
  igual(exigeFoto(pneu, 'atencao'), true);
  igual(exigeFoto(pneu, 'ok'), false, 'pneu bom nao precisa de foto');

  const frente = itensDoChecklist().find((i) => i.chave === 'frente');
  igual(exigeFoto(frente, 'ok'), true, 'a face do veiculo e o registro do estado de entrada');
  igual(exigeFoto(frente, 'na'), false);
});

teste('a pendencia diz QUAL item falta, e nao so que falta', () => {
  const itens = itensDoChecklist().map((i, n) => ({
    id: `i${n}`, chave: i.chave, nome: i.nome, grupo: i.grupo, estado: 'ok',
  }));
  // Tudo marcado, nenhuma foto: sobram as obrigatorias.
  const semFoto = pendencias(itens, {});
  verdadeiro(semFoto.length > 0);
  verdadeiro(semFoto.every((p) => p.falta === 'foto_obrigatoria'));
  verdadeiro(semFoto.every((p) => p.nome && p.grupo), 'a pendencia precisa dizer o nome e o grupo');

  // Um item sem estado aparece como nao avaliado.
  const comBuraco = itens.map((i) => (i.chave === 'cintos' ? { ...i, estado: null } : i));
  verdadeiro(pendencias(comBuraco, {}).some((p) => p.chave === 'cintos' && p.falta === 'nao_avaliado'));
});

teste('o aceite vale para UM conteudo — mexer no item muda o resumo', () => {
  const v = { veiculo_id: 'v1', km: 100000 };
  const itens = [
    { id: 'a', chave: 'freios', estado: 'ok', medida: null, nota: null },
    { id: 'b', chave: 'pneus', estado: 'atencao', medida: 2.5, nota: 'gasto' },
  ];
  const h1 = hashConteudo(v, itens);
  igual(hashConteudo(v, [...itens].reverse()), h1, 'a ordem dos itens nao pode mudar o resumo');

  const mexido = itens.map((i) => (i.chave === 'freios' ? { ...i, estado: 'critico' } : i));
  verdadeiro(hashConteudo(v, mexido) !== h1, 'mudar o estado TEM de mudar o resumo');

  // A foto entra na conta: trocar a evidencia e trocar o documento.
  verdadeiro(hashConteudo(v, itens, [{ item_id: 'a', sha256: 'x' }]) !== h1);
});

teste('a OS nao comeca sem vistoria aceita, e a recusa diz o que fazer', () => {
  igual(podeIniciarOS({ status: 'aceita' }).pode, true);

  for (const [status, motivo] of [
    ['rascunho', 'em_andamento'],
    ['aguardando_aceite', 'sem_aceite'],
    ['recusada', 'recusada'],
    ['cancelada', 'cancelada'],
  ]) {
    const r = podeIniciarOS({ status, recusa_motivo: 'faltou combinar o preco' });
    igual(r.pode, false, `${status} nao pode iniciar`);
    igual(r.motivo, motivo);
    verdadeiro(r.texto.length > 30, `${status}: a recusa precisa explicar o que fazer`);
  }

  // Sem vistoria nenhuma tambem tranca — e este e o caso comum no comeco.
  const sem = podeIniciarOS(null);
  igual(sem.pode, false);
  igual(sem.motivo, 'sem_vistoria');
});

teste('o resumo conta sobre os itens DA VISTORIA, e nao do catalogo', () => {
  /*
   * Uma revisao bronze tem 64 itens. Contar sobre os 86 do catalogo faria a
   * barra parecer parada num servico que esta quase pronto.
   */
  const bronze = itensDoChecklist('bronze').map((i, n) => ({
    chave: i.chave, estado: n < 32 ? 'ok' : null,
  }));
  const r = resumoVistoria(bronze);
  igual(r.total, TAMANHO_POR_NIVEL.bronze, 'o total e o da revisao, nao o do catalogo');
  igual(r.ok, 32);
  igual(r.avaliados, 32);
  igual(r.pendente, TAMANHO_POR_NIVEL.bronze - 32);
  igual(r.percentual, 50, 'metade de uma bronze e metade, e nao 37% de 86');
});

teste('itemNoNivel: um item entra do seu nivel para cima', () => {
  igual(itemNoNivel({ nivel: 'bronze' }, 'bronze'), true);
  igual(itemNoNivel({ nivel: 'bronze' }, 'ouro'), true);
  igual(itemNoNivel({ nivel: 'ouro' }, 'bronze'), false, 'ouro nao cabe numa bronze');
  igual(itemNoNivel({ nivel: 'prata' }, 'bronze'), false);
  igual(itemNoNivel({ nivel: 'prata' }, 'prata'), true);
});

/* -- Cofre de credenciais ------------------------------------------------- */

// Chave de teste, fixa e local. Nunca sai daqui.
const AMB = { FORTCRM_CHAVE_MESTRA: 'a'.repeat(64) };

teste('falta de chave-mestra FALHA ALTO, e nao cai num padrao', () => {
  let erro = null;
  try { chaveMestra({}); } catch (e) { erro = e; }
  verdadeiro(erro, 'sem chave, cifrar tinha de ser impossivel');
  verdadeiro(erro.message.includes('FORTCRM_CHAVE_MESTRA'), 'a mensagem tem de dizer o que falta');
  verdadeiro(erro.message.includes('openssl'), 'e como gerar');

  // O ponto inteiro: um cofre que se abre sozinho e pior que nenhum cofre,
  // porque convence quem o usa de que ha protecao.
  igual(temChave({}), false);
  igual(temChave(AMB), true);

  // Passphrase curta tambem e recusada — aceitar seria fingir 256 bits.
  let curta = null;
  try { chaveMestra({ FORTCRM_CHAVE_MESTRA: 'segredo123' }); } catch (e) { curta = e; }
  verdadeiro(curta, 'passphrase curta nao pode virar chave de 256 bits');
});

teste('cifrar e decifrar fecham o ciclo, e adulteracao nao passa', () => {
  const segredo = 'EAAtokenDeMarketingComTamanhoRealistico1234567890';
  const c = cifrar(segredo, AMB);
  verdadeiro(!c.conteudo.includes('EAA'), 'o texto nao pode aparecer no cifrado');
  verdadeiro(c.iv && c.tag, 'GCM exige iv e tag guardados');
  igual(decifrar(c, AMB), segredo);

  // Cada cifragem tem IV proprio: dois iguais delatariam que o valor nao mudou.
  igual(cifrar(segredo, AMB).iv === c.iv, false);

  // A tag do GCM e o que transforma "banco adulterado" em erro, e nao em lixo
  // silencioso que segue para a Meta.
  let mexido = null;
  try {
    decifrar({ ...c, conteudo: `${c.conteudo.slice(0, -2)}00` }, AMB);
  } catch (e) { mexido = e; }
  verdadeiro(mexido, 'conteudo alterado tinha de lancar');

  // Chave errada tambem nao abre.
  let outra = null;
  try { decifrar(c, { FORTCRM_CHAVE_MESTRA: 'b'.repeat(64) }); } catch (e) { outra = e; }
  verdadeiro(outra);
});

teste('a pista mostra quatro caracteres, e nunca o suficiente para reconstruir', () => {
  igual(pista('EAAtokenLongoDeVerdade9876'), '••••9876');
  igual(pista('curto'), '••••', 'segredo curto nao mostra nem os quatro');
  verdadeiro(!pista('EAAtokenLongoDeVerdade9876').includes('EAA'));
});

teste('credencial e POR EMPRESA — e era esse o motivo de existir', () => {
  const mp = fed.abrir('MP');
  const af = fed.abrir('AF');
  const eMp = mp.para(mp.sistema().prepare('select id from empresas limit 1').get().id);
  const eAf = af.para(af.sistema().prepare('select id from empresas limit 1').get().id);

  gravarCredencial(eMp, 'meta_marketing_token', 'TOKEN_DA_MINAS_PECAS_123456', {
    ator: 'teste@fortgrupo.com.br', agoraIso: agora(), novoId, env: AMB,
  });

  igual(lerCredencial(eMp, 'meta_marketing_token', AMB).valor, 'TOKEN_DA_MINAS_PECAS_123456');
  // Uma variavel de ambiente nao consegue fazer isto: sao contas de anuncio
  // diferentes, e o token de uma nao acha o anuncio da outra.
  igual(lerCredencial(eAf, 'meta_marketing_token', AMB).valor, null);
  igual(lerCredencial(eAf, 'meta_marketing_token', AMB).origem, 'nenhuma');
});

teste('o que a empresa configurou vence o ambiente, e apagar devolve o piso', () => {
  const b = fed.abrir('FT');
  const e = b.para(b.sistema().prepare('select id from empresas limit 1').get().id);
  const amb = { ...AMB, FORTCRM_META_MARKETING_TOKEN: 'TOKEN_DO_AMBIENTE' };

  igual(lerCredencial(e, 'meta_marketing_token', amb).origem, 'ambiente',
    'sem nada configurado, o ambiente e o piso');

  gravarCredencial(e, 'meta_marketing_token', 'TOKEN_DA_FORT_TINTAS_9999', {
    ator: 'teste@fortgrupo.com.br', agoraIso: agora(), novoId, env: amb,
  });
  const r = lerCredencial(e, 'meta_marketing_token', amb);
  igual(r.valor, 'TOKEN_DA_FORT_TINTAS_9999');
  igual(r.origem, 'instancia', 'a da instancia tem de vencer');

  apagarCredencial(e, 'meta_marketing_token');
  igual(lerCredencial(e, 'meta_marketing_token', amb).origem, 'ambiente',
    'apagar devolve ao piso do servidor, e nao ao vazio');
});

teste('a listagem NUNCA devolve o valor', () => {
  const b = fed.abrir('AF');
  const e = b.para(b.sistema().prepare('select id from empresas limit 1').get().id);
  const segredo = 'EAAsegredoQueNaoPodeVoltarParaOnavegador123';
  gravarCredencial(e, 'meta_capi_token', segredo, {
    ator: 'teste@fortgrupo.com.br', agoraIso: agora(), novoId, env: AMB,
  });

  const lista = listarCredenciais(e, AMB);
  const item = lista.find((c) => c.chave === 'meta_capi_token');
  igual(item.definida, true);
  igual(item.pista, `••••${segredo.slice(-4)}`, 'a pista sao os quatro ultimos');
  // Devolver o segredo ao navegador o espalharia por cache, historico e
  // extensao instalada. Quem precisa do valor e o servidor, e ele ja o tem.
  const texto = JSON.stringify(lista);
  verdadeiro(!texto.includes(segredo), 'o segredo vazou na listagem');
  verdadeiro(!texto.includes('EAAsegredo'), 'nem um pedaco reconhecivel dele');
});

teste('identificador que nao e segredo fica legivel — e o dataset e um deles', () => {
  const b = fed.abrir('FT');
  const e = b.para(b.sistema().prepare('select id from empresas limit 1').get().id);
  igual(CREDENCIAIS.meta_dataset_id.publico, true);

  gravarCredencial(e, 'meta_dataset_id', '1234567890123456', {
    ator: 'teste@fortgrupo.com.br', agoraIso: agora(), novoId, env: AMB,
  });
  const linha = e.uma("select conteudo, valor_claro from credenciais where {ESCOPO} and chave = 'meta_dataset_id'");
  igual(linha.conteudo, null, 'cifrar um identificador so atrapalha quem precisa confere-lo');
  igual(linha.valor_claro, '1234567890123456');
  igual(lerCredencial(e, 'meta_dataset_id', AMB).valor, '1234567890123456');
});

teste('chave-mestra trocada nao devolve lixo — devolve motivo', () => {
  const b = fed.abrir('MP');
  const e = b.para(b.sistema().prepare('select id from empresas limit 1').get().id);
  gravarCredencial(e, 'meta_capi_token', 'TOKEN_CIFRADO_COM_A_CHAVE_A_123', {
    ator: 'teste@fortgrupo.com.br', agoraIso: agora(), novoId, env: AMB,
  });

  const r = lerCredencial(e, 'meta_capi_token', { FORTCRM_CHAVE_MESTRA: 'c'.repeat(64) });
  igual(r.valor, null);
  verdadeiro(r.erro, 'silencio aqui viraria "o token nao funciona" sem explicacao');
  verdadeiro(r.erro.includes('chave-mestra'), `o motivo tem de citar a chave: ${r.erro}`);
});

teste('gravar credencial e de soberano; ler, de gestor', () => {
  igual(negarPorPapel('GET /api/credenciais', 'gestor'), null);
  verdadeiro(negarPorPapel('GET /api/credenciais', 'operador'), 'balcao nao ve credencial');
  verdadeiro(negarPorPapel('PUT /api/credenciais/:chave', 'gestor'),
    'trocar credencial aponta a conversao para outro pixel — e soberano');
  igual(negarPorPapel('PUT /api/credenciais/:chave', 'soberano'), null);
  verdadeiro(negarPorPapel('DELETE /api/credenciais/:chave', 'gestor'));
});

teste('chave desconhecida e recusada, e nao gravada por engano', () => {
  const b = fed.abrir('MP');
  const e = b.para(b.sistema().prepare('select id from empresas limit 1').get().id);
  let erro = null;
  try {
    gravarCredencial(e, 'token_qualquer_inventado', 'x'.repeat(20), {
      ator: 'teste', agoraIso: agora(), novoId, env: AMB,
    });
  } catch (err) { erro = err; }
  verdadeiro(erro, 'chave fora do catalogo nao pode entrar');
  igual(lerCredencial(e, 'token_qualquer_inventado', AMB).origem, 'desconhecida');
});

/* -- Dimensao de campanha: o nome por tras do ad_id ----------------------- */

// `fetch` de mentira. A unica chamada de saida do sistema tem ponto de costura
// justamente para que o teste jamais dependa da Meta estar no ar.
function metaFalsa(respostas) {
  const chamadas = [];
  return {
    chamadas,
    buscar: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      const id = decodeURIComponent(url.split('/').pop().split('?')[0]);
      const r = respostas[id] ?? { status: 404, json: { error: { code: 803 } } };
      if (r.lancar) throw new Error(r.lancar);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
    },
  };
}

teste('so vai a Meta quando precisa — cache vale, e falha espera', () => {
  const t = Date.parse('2026-09-05T12:00:00Z');
  igual(precisaResolver(null, t), true, 'sem linha, precisa');
  igual(precisaResolver({ resolvido_em: new Date(t - 1000).toISOString() }, t), false,
    'resolvido agora nao se busca de novo');
  igual(precisaResolver({ resolvido_em: new Date(t - VALIDADE_MS - 1000).toISOString() }, t), true,
    'nome de campanha muda: passada a validade, busca de novo');

  // Falha guardada evita marretar a API com um id que nunca vai resolver.
  igual(precisaResolver({ tentado_em: new Date(t - 1000).toISOString() }, t), false);
  igual(precisaResolver({ tentado_em: new Date(t - ESPERA_APOS_FALHA_MS - 1000).toISOString() }, t), true);
});

teste('o token vai no cabecalho, nunca na query', () => {
  const { url, opcoes } = requisicaoDoAnuncio('120109', 'TOKEN_SECRETO');
  verdadeiro(!url.includes('TOKEN_SECRETO'),
    'token em query string acaba em log de proxy e no Referer');
  igual(opcoes.headers.authorization, 'Bearer TOKEN_SECRETO');
  verdadeiro(url.includes('/120109?'), 'o id precisa estar no caminho');
});

teste('resposta parcial da Meta ainda vale; resposta vazia nao', () => {
  const so = lerAnuncio({ campaign: { id: '9', name: 'Injecao diesel - setembro' } });
  igual(so.campanha_nome, 'Injecao diesel - setembro');
  igual(so.conjunto_nome, null, 'faltar conjunto nao pode derrubar a campanha');

  igual(lerAnuncio({}), null, 'sem nome nenhum nao e resposta');
  igual(lerAnuncio(null), null);
});

teste('o erro diz de QUEM e o problema — token ou anuncio', () => {
  igual(diagnosticarErro(401, {}).causa, 'token_invalido');
  igual(diagnosticarErro(200, { error: { code: 190 } }).causa, 'token_invalido');
  igual(diagnosticarErro(404, {}).causa, 'anuncio_inexistente');
  igual(diagnosticarErro(429, {}).causa, 'limite_api');
  igual(diagnosticarErro(403, {}).causa, 'sem_permissao');
  // Sao consertos diferentes: um e renovar credencial, o outro e aceitar que
  // aquele anuncio sumiu. "Erro ao resolver" nao distingue os dois.
  verdadeiro(diagnosticarErro(401, {}).texto !== diagnosticarErro(404, {}).texto);
});

testeAsync('resolver grava o nome e a tela para de mostrar so o numero', async () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const adId = '120109000000001';

  const meta = metaFalsa({
    [adId]: {
      status: 200,
      json: {
        name: 'Criativo video - bomba', effective_status: 'ACTIVE',
        campaign: { id: '23851', name: 'Injecao diesel - Januaria' },
        adset: { id: '23852', name: 'Raio 40km - frota' },
      },
    },
  });

  const r = await resolverAnuncios(e, [adId], { token: 'T', buscar: meta.buscar });
  igual(r.resolvidos, 1);
  igual(meta.chamadas.length, 1);

  const dim = e.uma('select * from dimensoes_campanha where {ESCOPO} and source_ad_id = ?', adId);
  igual(dim.campanha_nome, 'Injecao diesel - Januaria');
  igual(dim.conjunto_nome, 'Raio 40km - frota');
  verdadeiro(dim.resolvido_em, 'sem carimbo de resolucao o cache nao vence nunca');

  igual(rotularCampanha(dim, adId).rotulo, 'Injecao diesel - Januaria');
  igual(rotularCampanha(dim, adId).resolvido, true);

  // Segunda passada nao gasta chamada: o cache existe para isso.
  const r2 = await resolverAnuncios(e, [adId], { token: 'T', buscar: meta.buscar });
  igual(r2.pulados, 1);
  igual(meta.chamadas.length, 1, 'chamou a Meta de novo com o cache quente');
});

testeAsync('falha NAO apaga nome ja resolvido', async () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const adId = '120109000000002';

  const ok = metaFalsa({
    [adId]: { status: 200, json: { name: 'A', campaign: { id: '1', name: 'Campanha boa' } } },
  });
  await resolverAnuncios(e, [adId], { token: 'T', buscar: ok.buscar });

  // Envelhece para forcar nova busca, e agora a Meta recusa o token.
  const velho = new Date(Date.now() - VALIDADE_MS - 60_000).toISOString();
  const dim0 = e.uma('select id from dimensoes_campanha where {ESCOPO} and source_ad_id = ?', adId);
  e.atualizar('dimensoes_campanha', dim0.id, { resolvido_em: velho });

  const ruim = metaFalsa({ [adId]: { status: 401, json: { error: { code: 190 } } } });
  const r = await resolverAnuncios(e, [adId], { token: 'T', buscar: ruim.buscar });
  igual(r.falhas, 1);

  const dim = e.uma('select * from dimensoes_campanha where {ESCOPO} and source_ad_id = ?', adId);
  igual(dim.campanha_nome, 'Campanha boa',
    'token vencido nao pode transformar meses de nome em id cru');
  igual(dim.erro_causa, 'token_invalido', 'e o motivo tem de ficar visivel');
});

testeAsync('rede caida nao vira "anuncio inexistente"', async () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const adId = '120109000000003';
  const meta = metaFalsa({ [adId]: { lancar: 'ECONNRESET' } });
  await resolverAnuncios(e, [adId], { token: 'T', buscar: meta.buscar });
  const dim = e.uma('select * from dimensoes_campanha where {ESCOPO} and source_ad_id = ?', adId);
  igual(dim.erro_causa, 'rede', 'uma queda de minutos nao pode virar "essa campanha nao existe"');
});

testeAsync('sem token nao ha rede, e a tela sabe disso', async () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const meta = metaFalsa({});
  const r = await resolverAnuncios(e, ['1'], { token: null, buscar: meta.buscar });
  igual(r.semToken, true);
  igual(meta.chamadas.length, 0, 'sem token nao se bate na porta da Meta');
});

teste('sem nome resolvido, mostra o id — e NUNCA inventa um', () => {
  const r = rotularCampanha(null, '120109000000009');
  igual(r.resolvido, false);
  igual(r.rotulo, 'Anúncio 120109000000009');
  verdadeiro(r.porque, 'o id cru sozinho nao explica por que esta cru');
  // Um "Campanha 120109" fabricado seria pior que o id: parece resposta.
  verdadeiro(!/^Campanha/.test(r.rotulo));
});

/* -- Venda: exige valor e nao volta depois de contada --------------------- */

teste('ganhar exige valor e numero do pedido, com a pessoa na frente', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema()
    .prepare("select email from usuarios where papel = 'soberano' limit 1").get();

  const cli = e.uma('select id from clientes where {ESCOPO} limit 1');
  const opId = novoId();
  e.inserir('oportunidades', {
    id: opId, cliente_id: cli.id, titulo: 'Teste de venda', etapa: 'negociacao',
    valor_centavos: 0, probabilidade: 50, posicao: 1, criado_em: agora(), atualizado_em: agora(),
  });

  const mover = (corpo) => ROTAS['PATCH /api/oportunidades/:id'](
    fed, sessaoDe('MP', email), { id: opId }, corpo,
  );

  const recusa = (corpo, oque) => {
    try { mover(corpo); throw new Error(`aceitou ${oque}`); } catch (err) {
      verdadeiro(err instanceof ErroHttp, `${oque}: veio "${err.message}"`);
      return err;
    }
  };

  // Sem valor, `avaliarConversao` recusaria o Purchase la adiante, dentro do
  // worker, onde ninguem le. O evento mais valioso do funil era o mais facil
  // de perder em silencio.
  igual(recusa({ etapa: 'ganho' }, 'venda sem valor').codigo, 'valor_obrigatorio');
  igual(recusa({ etapa: 'ganho', valor_centavos: 150000 }, 'venda sem pedido').codigo,
    'pedido_obrigatorio');

  const r = mover({ etapa: 'ganho', valor_centavos: 150000, pedido_ref: 'OS-4242' });
  igual(r.dados.etapa, 'ganho');
  igual(r.dados.valor_centavos, 150000);
  igual(r.dados.pedido_ref, 'OS-4242');
  igual(r.dados.eventoConversao, 'venda', 'a venda tem de gerar o evento de conversao');
});

teste('venda ja contada pela Meta nao volta de etapa', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema()
    .prepare("select email from usuarios where papel = 'soberano' limit 1").get();
  const cli = e.uma('select id from clientes where {ESCOPO} limit 1');

  const opId = novoId();
  e.inserir('oportunidades', {
    id: opId, cliente_id: cli.id, titulo: 'Venda contada', etapa: 'ganho',
    valor_centavos: 90000, pedido_ref: 'OS-1', probabilidade: 100, posicao: 2,
    criado_em: agora(), atualizado_em: agora(),
  });

  const mover = (corpo) => ROTAS['PATCH /api/oportunidades/:id'](
    fed, sessaoDe('MP', email), { id: opId }, corpo,
  );

  // Conversao SIMULADA nao tranca: em demonstracao nada saiu, e nao ha nada do
  // outro lado para contradizer. Travar aqui quebraria a demonstracao por uma
  // consequencia que nao existe.
  const simulada = novoId();
  e.inserir('conversoes', {
    id: simulada, cliente_id: cli.id, oportunidade_id: opId, destino: 'meta_capi',
    evento: 'venda', valor_centavos: 90000, ocorrido_em: agora(), status: 'enviado',
    motivo: 'simulado', idempotency_key: `sim:${opId}`, criado_em: agora(),
  });
  igual(mover({ etapa: 'negociacao' }).dados.etapa, 'negociacao',
    'conversao simulada nao pode trancar o cartao');
  mover({ etapa: 'ganho', valor_centavos: 90000, pedido_ref: 'OS-1' });

  // Conversao DESPACHADA de verdade tranca: a Meta ja contou, e arrastar o
  // cartao de volta so faria o CRM discordar do que ela registrou.
  e.inserir('conversoes', {
    id: novoId(), cliente_id: cli.id, oportunidade_id: opId, destino: 'meta_capi',
    evento: 'venda', valor_centavos: 90000, ocorrido_em: agora(), status: 'enviado',
    motivo: null, idempotency_key: `real:${opId}`, criado_em: agora(),
  });

  try {
    mover({ etapa: 'negociacao' });
    throw new Error('deixou a venda voltar de etapa');
  } catch (err) {
    verdadeiro(err instanceof ErroHttp, err.message);
    igual(err.status, 409);
    igual(err.codigo, 'venda_ja_contada');
    verdadeiro(err.message.includes('Gerenciador'), 'a recusa precisa dizer onde se resolve');
  }

  // Continuar em 'ganho' segue permitido — a trava e contra VOLTAR, e nao
  // contra editar o valor de uma venda que se manteve venda.
  igual(mover({ etapa: 'ganho', valor_centavos: 95000, pedido_ref: 'OS-1' }).dados.valor_centavos,
    95000);
});

teste('resposta ambigua tranca junto — e quando MENOS se pode fingir que nada houve', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const { email } = b.sistema()
    .prepare("select email from usuarios where papel = 'soberano' limit 1").get();
  const cli = e.uma('select id from clientes where {ESCOPO} limit 1');

  const opId = novoId();
  e.inserir('oportunidades', {
    id: opId, cliente_id: cli.id, titulo: 'Venda ambigua', etapa: 'ganho',
    valor_centavos: 50000, pedido_ref: 'OS-2', probabilidade: 100, posicao: 3,
    criado_em: agora(), atualizado_em: agora(),
  });
  e.inserir('conversoes', {
    id: novoId(), cliente_id: cli.id, oportunidade_id: opId, destino: 'meta_capi',
    evento: 'venda', valor_centavos: 50000, ocorrido_em: agora(), status: 'desconhecido',
    motivo: 'sem_adaptador_de_rede', idempotency_key: `amb:${opId}`, criado_em: agora(),
  });

  try {
    ROTAS['PATCH /api/oportunidades/:id'](fed, sessaoDe('MP', email), { id: opId },
      { etapa: 'orcamento' });
    throw new Error('deixou voltar com conversao ambigua');
  } catch (err) {
    igual(err.codigo, 'venda_ja_contada');
  }
});

/* ── Fila vazia: dizer POR QUE, e nao adivinhar ──────────────────────────── */

teste('a fila vazia acusa a causa certa, na ordem em que se resolve', () => {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);

  // Estado normal: gatilhos ativos, gente com consentimento, ninguem vencendo.
  const ok = diagnosticarFilaVazia(e, { fila: [] });
  igual(ok.causa, 'coberto');
  igual(ok.tranquilo, true, 'vazio tranquilo nao pode alarmar');

  // Ha gente na fila, e o compliance recusou todos. Diferente de fila vazia.
  const bloq = diagnosticarFilaVazia(e, {
    fila: [{ decisao: { permitido: false } }, { decisao: { permitido: false } }],
  });
  igual(bloq.causa, 'todos_bloqueados');
  verdadeiro(bloq.titulo.includes('2'), 'precisa dizer quantos');
  igual(bloq.acao, null, 'os motivos ja estao na tela — acao aqui seria ruido');

  // Gatilhos desligados: a fila NUNCA vai encher sozinha, e mandar "volte
  // amanha" seria pedir que a pessoa espere por algo que nao acontece.
  const ids = e.todas('select id from gatilhos where {ESCOPO}');
  ids.forEach((g) => e.atualizar('gatilhos', g.id, { ativo: 0 }));
  const desl = diagnosticarFilaVazia(e, { fila: [] });
  igual(desl.causa, 'gatilhos_desligados');
  igual(desl.acao.rota, 'gatilhos', 'tem de levar onde se resolve');
  ids.forEach((g) => e.atualizar('gatilhos', g.id, { ativo: 1 }));

  // Sem consentimento vem ANTES de "todos bloqueados": e a causa raiz, e a
  // mais acionavel das duas.
  const cli = e.todas('select id, consentimento_lgpd from clientes where {ESCOPO}');
  cli.forEach((c) => e.atualizar('clientes', c.id, { consentimento_lgpd: 0 }));
  igual(diagnosticarFilaVazia(e, { fila: [{ decisao: { permitido: false } }] }).causa,
    'sem_consentimento', 'a causa raiz vence a consequencia');
  cli.forEach((c) => e.atualizar('clientes', c.id, { consentimento_lgpd: c.consentimento_lgpd }));

  // Base vazia vem antes de tudo: nao adianta falar de consentimento para quem
  // nao tem cliente nenhum.
  const guardados = e.todas('select * from clientes where {ESCOPO}');
  guardados.forEach((c) => e.remover('clientes', c.id));
  const vazia = diagnosticarFilaVazia(e, { fila: [] });
  igual(vazia.causa, 'base_vazia');
  verdadeiro(vazia.segunda, 'importar base tem de ser oferecido como segunda saida');

  // E devolve o que apagou. Os bancos de teste sao compartilhados pelo arquivo
  // inteiro: deixar a base vazia derrubava todo teste escrito daqui para baixo
  // com um erro que nao falava de cliente nenhum.
  guardados.forEach((c) => e.inserir('clientes', c));
});

teste('todo diagnostico diz o que fazer, ou por que nao ha o que fazer', () => {
  const b = fed.abrir('AF');
  const emp = b.sistema().prepare('select id from empresas limit 1').get();
  const e = b.para(emp.id);
  const d = diagnosticarFilaVazia(e, { fila: [] });

  verdadeiro(d.titulo && d.titulo.length > 8, 'titulo vazio nao explica nada');
  verdadeiro(d.texto && d.texto.length > 40, 'o texto precisa dizer o porque');
  // Ou ha acao, ou o motivo ja esta visivel noutro lugar da tela.
  verdadeiro(d.acao || d.causa === 'todos_bloqueados', 'beco sem saida');
});

/* ── Papel recusado no SERVIDOR, nao so escondido no menu ────────────────── */

teste('a tabela de papeis cobre toda rota de governanca', () => {
  // O padrao e `operador`. Uma rota de governanca esquecida na tabela ficaria
  // aberta ao balcao — e o erro seria silencioso.
  const governanca = [
    'GET /api/auditoria', 'GET /api/auditoria/verificar', 'GET /api/painel/grupo',
    'GET /api/central/resumo', 'GET /api/central/leads', 'POST /api/central/sincronizar',
    'GET /api/atribuicao', 'GET /api/conversoes', 'POST /api/conversoes/processar',
    'POST /api/propriedades', 'DELETE /api/propriedades/:id', 'POST /api/importar/clientes',
    'POST /api/demo/reiniciar',
  ];
  for (const r of governanca) {
    verdadeiro(negarPorPapel(r, 'operador'), `operador NAO pode chamar ${r}`);
    igual(negarPorPapel(r, 'gestor'), null, `gestor pode chamar ${r}`);
    igual(negarPorPapel(r, 'soberano'), null, `soberano pode chamar ${r}`);
  }
});

teste('a referencia da API cobre TODA rota — senao ela envelhece calada', () => {
  /*
   * docs/API.md e o contrato que outra pessoa le para integrar. Uma rota nova
   * que nao chega la nao quebra nada — e por isso ninguem percebe, ate alguem
   * precisar dela e concluir que nao existe.
   *
   * Tres rotas de campos personalizados estavam fora, e foram achadas por esta
   * conferencia, nao por leitura.
   */
  const doc = readFileSync(new URL('../docs/API.md', import.meta.url), 'utf8');
  const fora = Object.keys(ROTAS).filter((r) => !doc.includes(r.split(' ')[1]));
  igual(fora.length, 0, `rotas fora da referencia: ${fora.join(', ')}`);

  // E o numero declarado no topo tem de ser o numero real.
  const declarado = Number(/\*\*(\d+) rotas\.\*\*/.exec(doc)?.[1] ?? 0);
  igual(declarado, Object.keys(ROTAS).length,
    'o total no topo do API.md nao bate com as rotas de verdade');
});

teste('nenhuma rota do ERP fica aberta ao balcao', () => {
  /*
   * O padrao do despachante e `operador`. Uma rota de ERP esquecida na tabela
   * de papeis ficaria aberta a quem atende no balcao — e o erro seria
   * silencioso, porque nada quebra: a rota simplesmente responde.
   *
   * Este teste varre as rotas de verdade, e nao uma lista escrita a mao: lista
   * a mao envelhece na primeira rota nova que alguem acrescentar.
   */
  const doErp = Object.keys(ROTAS).filter((r) => r.includes('/api/erp/'));
  verdadeiro(doErp.length >= 20, `esperava as rotas do ERP, achei ${doErp.length}`);

  for (const r of doErp) {
    verdadeiro(negarPorPapel(r, 'operador'), `operador NAO pode chamar ${r}`);
    verdadeiro(negarPorPapel(r, 'leitura'), `leitura NAO pode chamar ${r}`);
    igual(negarPorPapel(r, 'soberano'), null, `soberano pode chamar ${r}`);
  }

  /*
   * A linha entre gestor e soberano no ERP, e o motivo dela.
   *
   * OPERAR O LIVRO e de gestor: lancar, estornar, fechar periodo, ratear e
   * sincronizar sao o trabalho de quem responde pela contabilidade. O eixo do
   * modulo ainda refina por pessoa — um gestor sem `razao` concedido nao lanca
   * nada, mesmo passando por aqui.
   *
   * CONCEDER ACESSO fica em soberano, e essa e a linha que importa. Quem pode
   * conceder pode promover qualquer pessoa a qualquer coisa, inclusive a si
   * mesmo — e o nivel soberano deixaria de existir na pratica, sem que ninguem
   * o tenha removido. Operar a contabilidade e um trabalho; distribuir poder e
   * outro.
   */
  for (const r of ['POST /api/erp/lancamentos', 'POST /api/erp/rateio',
    'POST /api/erp/periodos/:competencia/fechar', 'POST /api/erp/sincronizar',
    'POST /api/erp/lancamentos/:id/estornar', 'POST /api/erp/titulos/:id/cancelar']) {
    igual(negarPorPapel(r, 'gestor'), null, `gestor OPERA o livro (${r})`);
  }

  for (const r of ['GET /api/erp/acesso/todos', 'PUT /api/erp/acesso/:email/:modulo',
    'DELETE /api/erp/acesso/:email/:modulo']) {
    verdadeiro(negarPorPapel(r, 'gestor'),
      `gestor NAO distribui poder (${r}) — senao o nivel soberano deixa de existir`);
  }
});

teste('rota de operacao continua aberta a quem atende', () => {
  for (const r of ['GET /api/regua', 'GET /api/clientes', 'PATCH /api/clientes/:id',
    'GET /api/pipeline', 'POST /api/regua/disparar', 'GET /api/canais']) {
    igual(negarPorPapel(r, 'operador'), null, `operador precisa chamar ${r}`);
  }
});

teste('rota nao declarada cai para o lado seguro', () => {
  // O padrao e `operador`. Uma rota de GOVERNANCA esquecida na tabela ficaria
  // aberta ao balcao — e por isso o teste acima varre a lista inteira.
  igual(negarPorPapel('GET /api/rota/nova', 'operador'), null);

  // Para `leitura`, o padrao ainda protege a escrita: qualquer metodo que nao
  // seja GET e recusado, declarado ou nao.
  igual(negarPorPapel('GET /api/rota/nova', 'leitura'), null, 'leitura le o que o operador le');
  verdadeiro(negarPorPapel('POST /api/rota/nova', 'leitura'),
    'leitura nunca escreve, mesmo em rota que ninguem declarou');
  igual(negarPorPapel('DELETE /api/rota/nova', 'leitura').motivo, 'somente_leitura');
});

teste('a recusa diz o papel exigido e o que a pessoa tem', () => {
  const n = negarPorPapel('GET /api/auditoria', 'operador');
  igual(n.exigido, 'gestor');
  igual(n.papel, 'operador');
});

/* -- Carroceria, servicos e recepcao --------------------------------------- */

/**
 * Abre uma vistoria de verdade, pela rota, para os testes de avaria e servico.
 *
 * Um veiculo por chamada: a propria rota recusa abrir a segunda vistoria de um
 * veiculo que ja tem uma em andamento — que e a regra certa, e atrapalharia
 * este arranjo se todos os testes usassem o mesmo carro.
 */
let nVeiculo = 0;
function abrirVistoria(nivel = 'bronze') {
  const b = fed.abrir('MP');
  const emp = b.sistema().prepare('select * from empresas limit 1').get();
  const esc = b.para(emp.id);
  const email = b.sistema()
    .prepare("select email from usuarios where papel = 'soberano' limit 1").get().email;

  /*
   * Carro novo a cada teste, e nao um da semeadura.
   *
   * A propria rota recusa abrir a segunda vistoria de um veiculo que ja tem uma
   * em andamento — que e a regra certa. Reaproveitar os carros semeados faria
   * estes testes dependerem de quantas vistorias a demonstracao ja criou.
   */
  nVeiculo += 1;
  const clienteId = `vt-cli-${nVeiculo}`;
  esc.inserir('clientes', {
    id: clienteId, nome: `Cliente de teste ${nVeiculo}`, telefone: '38999990000',
    consentimento_lgpd: 1, criado_em: agora(),
  });
  const veiculoId = `vt-teste-${nVeiculo}`;
  esc.inserir('veiculos', {
    id: veiculoId, cliente_id: clienteId, placa: `TST${String(1000 + nVeiculo)}`,
    marca: 'Ford', modelo: 'Ranger', ano: 2020, km_ultima: 80000, ativo: 1,
    criado_em: agora(),
  });

  const sessao = sessaoDe('MP', email);
  const r = ROTAS['POST /api/vistorias'](fed, sessao, {}, { veiculo_id: veiculoId, nivel });
  return { id: r.dados.id, sessao, esc, email };
}

/** Roda e devolve o erro, para os testes de recusa. */
function recusa(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error('esperava recusa, e a chamada passou');
}

teste('a avaria e gravada em FRACAO da vista, e fora do desenho e recusada', () => {
  const { id, sessao } = abrirVistoria();
  const marcar = (corpo) => ROTAS['POST /api/vistorias/:id/avarias'](fed, sessao, { id }, corpo);

  const a = marcar({ vista: 'lateral_esq', x: 0.62, y: 0.45, tipo: 'amassado' }).dados;
  igual(a.x, 0.62);
  igual(a.vista, 'lateral_esq');

  /*
   * Pixel nao serve: o desenho tem 325 px no celular e 620 no monitor do
   * balcao. Uma coordenada de 240 seria valida numa tela e cairia fora da
   * lataria na outra — e o desenho que o cliente assinou tem de ser o mesmo.
   */
  igual(recusa(() => marcar({ vista: 'frente', x: 240, y: 60, tipo: 'risco' })).codigo,
    'coordenada_invalida');
  igual(recusa(() => marcar({ vista: 'frente', x: -0.1, y: 0.5, tipo: 'risco' })).codigo,
    'coordenada_invalida');
  igual(recusa(() => marcar({ vista: 'capo', x: 0.5, y: 0.5, tipo: 'risco' })).codigo,
    'vista_invalida');
  igual(recusa(() => marcar({ vista: 'frente', x: 0.5, y: 0.5, tipo: 'arranhadinho' })).codigo,
    'tipo_invalido');
});

teste('o desenho da carroceria entra no que o cliente assina', () => {
  const v = { veiculo_id: 'v1', km: 100000 };
  const itens = [{ id: 'a', chave: 'freios', estado: 'ok', medida: null, nota: null }];
  const semNada = hashConteudo(v, itens);

  /*
   * Lista vazia NAO muda o resumo. Se mudasse, toda vistoria ja enviada e
   * aguardando aceite passaria a acusar "o conteudo mudou" no dia da entrega
   * desta versao — numa vistoria em que ninguem tocou.
   */
  igual(hashConteudo(v, itens, [], { avarias: [], servicos: [] }), semNada,
    'lista vazia nao pode mexer no resumo de quem ja assinou');

  const comAvaria = hashConteudo(v, itens, [], {
    avarias: [{ vista: 'frente', x: 0.4, y: 0.55, tipo: 'risco', nota: null }],
  });
  verdadeiro(comAvaria !== semNada, 'marcar uma avaria TEM de mudar o resumo');

  // Mover a marca é mudar o documento: "risco na porta" e "risco no capo" nao
  // sao a mesma coisa na hora da devolucao.
  const movida = hashConteudo(v, itens, [], {
    avarias: [{ vista: 'frente', x: 0.7, y: 0.55, tipo: 'risco', nota: null }],
  });
  verdadeiro(movida !== comAvaria, 'mover a marca muda o documento');

  const comServico = hashConteudo(v, itens, [], {
    servicos: [{ ordem: 1, descricao: 'trocar oleo', origem: 'cliente', valor_centavos: 18000 }],
  });
  verdadeiro(comServico !== semNada, 'o que foi orcado faz parte do aceite');
});

teste('depois do envio, a lataria nao muda mais', () => {
  const { id, sessao, esc } = abrirVistoria();
  ROTAS['POST /api/vistorias/:id/avarias'](fed, sessao, { id },
    { vista: 'frente', x: 0.5, y: 0.5, tipo: 'risco' });

  // Curto-circuito no status: concluir de verdade exigiria as 64 marcacoes.
  esc.atualizar('vistorias', id, { status: 'aguardando_aceite' });

  igual(recusa(() => ROTAS['POST /api/vistorias/:id/avarias'](fed, sessao, { id },
    { vista: 'frente', x: 0.2, y: 0.2, tipo: 'risco' })).codigo, 'vistoria_fechada');
  igual(recusa(() => ROTAS['PATCH /api/vistorias/:id'](fed, sessao, { id },
    { preferencia_pagamento: 'pix' })).codigo, 'vistoria_fechada');
});

teste('o que o cliente pediu e o que a oficina achou ficam em listas separadas', () => {
  const { id, sessao } = abrirVistoria();
  const criar = (corpo) => ROTAS['POST /api/vistorias/:id/servicos'](fed, sessao, { id }, corpo).dados;

  const pedido = criar({ descricao: 'barulho na frente quando freia' });
  const achado = criar({ descricao: 'pastilha dianteira no limite', origem: 'vistoria' });

  igual(pedido.origem, 'cliente', 'sem origem declarada, e pedido do cliente');
  igual(achado.origem, 'vistoria');
  igual(pedido.ordem, 1);
  igual(achado.ordem, 2, 'a ordem e a da conversa, e nao a do banco');
  igual(pedido.estado, 'pendente');

  igual(recusa(() => criar({ descricao: '   ' })).codigo, 'descricao_obrigatoria');

  const lista = ROTAS['GET /api/vistorias/:id'](fed, sessao, { id }).dados.servicos;
  igual(lista.length, 2);
  igual(lista.filter((x) => x.origem === 'cliente').length, 1);
});

teste('o que foi orcado trava no envio; o que foi FEITO continua andando', () => {
  const { id, sessao, esc } = abrirVistoria();
  const sv = ROTAS['POST /api/vistorias/:id/servicos'](fed, sessao, { id },
    { descricao: 'trocar filtro de combustivel', valor_centavos: 18000, tempo_min: 40 }).dados;

  esc.atualizar('vistorias', id, { status: 'aguardando_aceite' });
  const alterar = (corpo) => ROTAS['PATCH /api/vistorias/:id/servicos/:servicoId'](
    fed, sessao, { id, servicoId: sv.id }, corpo);

  /*
   * Preco e descricao sao o que o cliente aceitou: mexer depois seria trocar o
   * documento por baixo da assinatura. O estado nao — e por ele que a lista da
   * recepcao vira a lista da entrega.
   */
  igual(recusa(() => alterar({ valor_centavos: 99000 })).codigo, 'vistoria_fechada');
  igual(recusa(() => alterar({ descricao: 'outra coisa' })).codigo, 'vistoria_fechada');
  igual(alterar({ estado: 'ok' }).dados.estado, 'ok');
  igual(recusa(() => alterar({ estado: 'quase' })).codigo, 'estado_invalido');
});

teste('o combinado na recepcao fica na vistoria que o cliente aceita', () => {
  const { id, sessao } = abrirVistoria();
  const r = ROTAS['PATCH /api/vistorias/:id'](fed, sessao, { id }, {
    proximo_servico_km: 92000,
    preferencia_pagamento: 'pix',
    entrega_prevista: '2026-09-09T17:00',
  }).dados;

  igual(r.proximo_servico_km, 92000);
  igual(r.preferencia_pagamento, 'pix');
  igual(r.entrega_prevista, '2026-09-09T17:00');

  // Forma de pagamento e lista fechada: "pix do joao" viraria relatorio sujo.
  igual(recusa(() => ROTAS['PATCH /api/vistorias/:id'](fed, sessao, { id },
    { preferencia_pagamento: 'fiado' })).codigo, 'pagamento_invalido');
});

teste('o aceite fecha em cima do desenho e do orcamento, e nao so dos itens', () => {
  /*
   * O caminho inteiro, de ponta a ponta: marcar, desenhar a lataria, orcar,
   * enviar e aceitar. E o teste que segura a mudanca do hash — incluir avaria e
   * servico no resumo assinado quebraria o aceite de um jeito que so aparece
   * com o cliente na frente, na hora de assinar.
   */
  const { id, sessao, esc } = abrirVistoria('bronze');

  ROTAS['POST /api/vistorias/:id/avarias'](fed, sessao, { id },
    { vista: 'lateral_esq', x: 0.62, y: 0.45, tipo: 'amassado', nota: 'porta traseira' });
  ROTAS['POST /api/vistorias/:id/servicos'](fed, sessao, { id },
    { descricao: 'revisao de 80 mil', valor_centavos: 89000, tempo_min: 120 });
  ROTAS['PATCH /api/vistorias/:id'](fed, sessao, { id },
    { preferencia_pagamento: 'pix', entrega_prevista: '2026-09-09T17:00' });

  // "Nao se aplica" nao pede foto: e o unico estado que fecha a vistoria sem
  // camera, e aqui interessa o caminho, nao o preenchimento.
  for (const item of itensDoChecklist('bronze')) {
    ROTAS['PATCH /api/vistorias/:id/itens/:chave'](fed, sessao, { id, chave: item.chave }, { estado: 'na' });
  }

  const enviada = ROTAS['POST /api/vistorias/:id/concluir'](fed, sessao, { id }, {}).dados;
  igual(enviada.status, 'aguardando_aceite');
  verdadeiro(enviada.conteudo_hash?.length === 64, 'sem resumo nao ha o que assinar');

  const aceita = ROTAS['POST /api/vistorias/:id/aceite'](fed, sessao, { id },
    { nome: 'Divino Souza Lima', cpf: '123.456.789-00' }).dados;
  igual(aceita.status, 'aceita');
  igual(aceita.aceite_cpf, '12345678900', 'o CPF entra so com digito');

  // E agora a trava: mexer no desenho depois do aceite e recusado.
  igual(recusa(() => ROTAS['POST /api/vistorias/:id/avarias'](fed, sessao, { id },
    { vista: 'frente', x: 0.3, y: 0.3, tipo: 'risco' })).codigo, 'vistoria_fechada');

  // O que a vistoria destrava: a ordem de servico deste veiculo.
  igual(podeIniciarOS(esc.uma('select * from vistorias where {ESCOPO} and id = ?', id)).pode, true);
});

teste('marcar um item ja devolve o que ainda falta', () => {
  /*
   * Antes a tela remarcava e recarregava a vistoria inteira para saber o que
   * faltava: duas viagens por toque, a segunda com 86 itens e a lista de
   * midias. Numa vistoria completa eram mais de cento e setenta chamadas.
   */
  const { id, sessao } = abrirVistoria();
  const r = ROTAS['PATCH /api/vistorias/:id/itens/:chave'](
    fed, sessao, { id, chave: 'cintos' }, { estado: 'ok' }).dados;

  igual(r.item.estado, 'ok');
  igual(r.resumo.ok, 1);
  verdadeiro(Array.isArray(r.pendencias), 'a resposta precisa dizer o que ainda falta');
  verdadeiro(!r.pendencias.some((p) => p.chave === 'cintos' && p.falta === 'nao_avaliado'),
    'o item recem-marcado nao pode continuar como nao avaliado');
});

// Os assincronos rodam agora, com os bancos ainda abertos.
for (const rodar of filaAsync) await rodar();

fed.fecharTudo();
rmSync(DIR, { recursive: true, force: true });

console.log('');
console.log('  ─────────────────────────────────────────────');
console.log(`  ${passou} passaram · ${falhas.length} falharam`);
console.log('');
if (falhas.length) process.exit(1);
